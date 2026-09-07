'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { platformDb } from '@/lib/tenant';
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
  /** Present when signing in through /s/<slug>/login. */
  schoolSlug: z.string().trim().min(1).max(64).optional(),
  next: z.string().optional(),
});

export interface SignInState {
  error?: string;
}

/**
 * Credential sign-in.
 *
 * MULTI-TENANCY
 * -------------
 * Identity is global; authorisation is per-school. So authenticating a person
 * is only half the job — the session must also decide WHICH school they are
 * acting in, and carry the role they hold there.
 *
 *   · `/s/<slug>/login` pins the school. The user must hold an active
 *     membership of it, or sign-in fails with the same generic message as a
 *     bad password — otherwise the form becomes an oracle for "does this
 *     person belong to that school".
 *   · `/login` with no slug picks their primary membership, falling back to
 *     their only active one.
 *
 * Security properties deliberately maintained:
 *
 *  1. ONE generic error message for every failure — unknown email, wrong
 *     password, deactivated account, suspended school, no membership.
 *  2. CONSTANT-ISH TIMING. A missing email still costs a bcrypt comparison
 *     against a dummy hash, so latency does not reveal which addresses exist.
 *  3. The role and school in the session come from the DATABASE at sign-in,
 *     never from the form. A user cannot request a role or a school.
 */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    schoolSlug: formData.get('schoolSlug') || undefined,
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }

  const { email, password, schoolSlug, next } = parsed.data;
  const GENERIC_ERROR = 'Email or password is incorrect.';

  const user = await platformDb.user.findUnique({
    where: { email },
    include: {
      platformAdmin: { select: { id: true } },
      memberships: {
        where: { status: 'ACTIVE' },
        include: {
          school: {
            select: { id: true, slug: true, status: true, name: true },
          },
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!user) {
    await equaliseTiming();
    return { error: GENERIC_ERROR };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    return { error: GENERIC_ERROR };
  }

  // A suspended school cannot be signed into, even with a valid password.
  const usable = user.memberships.filter((m) => m.school.status !== 'SUSPENDED');

  const membership = schoolSlug
    ? usable.find((m) => m.school.slug === schoolSlug)
    : usable[0];

  // No membership of the requested school (or of any school) is reported as a
  // credential failure, not as "you don't belong here".
  if (!membership || !isRole(membership.role)) {
    return { error: GENERIC_ERROR };
  }

  // The profile row for this role AT THIS SCHOOL. A person can be a student at
  // one school and an instructor at another, so this is never a global lookup.
  const [student, instructor, applicant] = await Promise.all([
    platformDb.student.findFirst({
      where: { userId: user.id, schoolId: membership.schoolId },
      select: { id: true },
    }),
    platformDb.instructor.findFirst({
      where: { userId: user.id, schoolId: membership.schoolId },
      select: { id: true },
    }),
    platformDb.applicant.findFirst({
      where: { userId: user.id, schoolId: membership.schoolId },
      select: { id: true },
    }),
  ]);

  await createSession({
    sub: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    sch: membership.schoolId,
    mbr: membership.id,
    role: membership.role,
    slug: membership.school.slug,
    pid: student?.id ?? instructor?.id ?? applicant?.id ?? undefined,
    pa: user.platformAdmin ? true : undefined,
  });

  await platformDb.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit({
    schoolId: membership.schoolId,
    actorId: user.id,
    action: 'auth.signin',
    entityType: 'User',
    entityId: user.id,
    summary: `${user.email} signed in to ${membership.school.name} as ${membership.role}.`,
  });

  // Only accept a relative path — an absolute URL here would be an open
  // redirect straight out of the login form.
  const destination =
    next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : ROLE_HOME[membership.role];

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
