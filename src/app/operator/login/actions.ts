'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { platformDb } from '@/lib/tenant';
import { equaliseTiming, verifyPassword } from '@/lib/auth/password';
import { createOperatorSession, destroyOperatorSession } from '@/lib/auth/operator';
import { recordAudit } from '@/server/services/audit.service';
import { SIGN_IN_POLICY } from '@/lib/domain/rate-limit';
import {
  callerAddress,
  checkLimit,
  clearAttempts,
  recordAttempt,
} from '@/server/services/rate-limit.service';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export interface OperatorSignInState {
  error?: string;
}

/**
 * Sign in to the vendor console.
 *
 * Deliberately a SEPARATE action from the school sign-in rather than a branch
 * inside it. The two differ in what they check, what they mint and what they
 * refuse, and a single function with an `if (isOperator)` in the middle is how
 * one path quietly acquires the other's weaknesses.
 *
 * The security properties of the school form are kept, because this form
 * guards more:
 *
 *  1. ONE generic message for every failure — unknown address, wrong password,
 *     deactivated account, no platform grant. In particular, "you are not a
 *     platform operator" is never said: that would turn this form into an
 *     oracle for which of the vendor's staff hold the grant.
 *  2. Constant-ish timing, via a wasted comparison against a dummy hash.
 *  3. Rate limited on the same two-key policy as the school form.
 */
export async function operatorSignInAction(
  _prev: OperatorSignInState,
  formData: FormData,
): Promise<OperatorSignInState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' };
  }

  const { email, password } = parsed.data;
  const GENERIC = 'Email or password is incorrect.';

  const address = await callerAddress();
  const limit = await checkLimit({
    // A distinct action key, so a locked-out school sign-in does not lock the
    // console and vice versa. They are different doors.
    action: 'signin',
    identifier: `operator:${email}`,
    policy: SIGN_IN_POLICY,
    address,
  });
  if (!limit.allowed) return { error: limit.message };

  const fail = async (): Promise<OperatorSignInState> => {
    await recordAttempt({ action: 'signin', identifier: `operator:${email}`, address });
    return { error: GENERIC };
  };

  const user = await platformDb.user.findUnique({
    where: { email },
    include: { platformAdmin: { select: { id: true } } },
  });

  if (!user) {
    await equaliseTiming();
    return fail();
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive) return fail();

  // Holding the grant is checked AFTER the password, and reported as the same
  // generic failure. Checking it first would let anyone probe who is an
  // operator without knowing a single password.
  if (!user.platformAdmin) return fail();

  await clearAttempts('signin', `operator:${email}`);

  await createOperatorSession({
    sub: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
  });

  await platformDb.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit({
    // No school: this is a platform-level event, which is exactly the case
    // AuditLog.schoolId is nullable for.
    schoolId: null,
    actorId: user.id,
    action: 'operator.signin',
    entityType: 'User',
    entityId: user.id,
    summary: `${user.email} signed in to the operator console.`,
  });

  redirect('/operator');
}

export async function operatorSignOutAction(): Promise<void> {
  await destroyOperatorSession();
  redirect('/operator/login');
}
