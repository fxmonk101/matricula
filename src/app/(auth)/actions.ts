'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import {
  createSession,
  destroySession,
  equaliseTiming,
  verifyPassword,
} from '@/lib/auth/session';
import { ROLE_HOME, isRole } from '@/lib/domain/enums';
import { recordAudit } from '@/server/services/audit.service';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

export interface SignInState {
  error?: string;
}

/**
 * Credential sign-in.
 *
 * Security properties this implementation deliberately maintains:
 *
 *  1. ONE generic error message for every failure — unknown email, wrong
 *     password, deactivated account. Distinguishing them turns the login form
 *     into a user-enumeration oracle.
 *
 *  2. CONSTANT-ISH TIMING. When the email does not exist we still perform a
 *     bcrypt comparison against a dummy hash, so a missing account takes about
 *     as long as a wrong password. Without it, response latency alone reveals
 *     which addresses are registered.
 *
 *  3. The profile id (student/instructor/applicant) is resolved once here and
 *     carried in the session, so every subsequent request avoids a join — but
 *     authorisation still re-reads the database, never trusting the claim.
 */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }

  const { email, password, next } = parsed.data;
  const GENERIC_ERROR = 'Email or password is incorrect.';

  const user = await db.user.findUnique({
    where: { email },
    include: {
      student: { select: { id: true } },
      instructor: { select: { id: true } },
      applicant: { select: { id: true } },
    },
  });

  if (!user) {
    await equaliseTiming();
    return { error: GENERIC_ERROR };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive || !isRole(user.role)) {
    return { error: GENERIC_ERROR };
  }

  const profileId =
    user.student?.id ?? user.instructor?.id ?? user.applicant?.id ?? undefined;

  await createSession({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: `${user.firstName} ${user.lastName}`,
    pid: profileId,
  });

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit({
    actorId: user.id,
    action: 'auth.signin',
    entityType: 'User',
    entityId: user.id,
    summary: `${user.email} signed in as ${user.role}.`,
  });

  // Only accept a relative path — an absolute URL here would be an open
  // redirect straight out of the login form.
  const destination =
    next && next.startsWith('/') && !next.startsWith('//') ? next : ROLE_HOME[user.role];

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
