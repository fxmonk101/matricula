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
import { SIGN_IN_POLICY } from '@/lib/domain/rate-limit';
import {
  callerAddress,
  checkLimit,
  clearAttempts,
  recordAttempt,
} from '@/server/services/rate-limit.service';

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

  /*
   * Rate limiting comes BEFORE the user lookup, deliberately.
   *
   * Checking afterwards would still do a database read and a bcrypt comparison
   * per attempt, which is the expensive part and therefore the part worth
   * denying to a script. It also means a refused attempt costs the same
   * whether or not the account exists, so the limiter cannot become the
   * enumeration oracle the generic error message exists to prevent.
   *
   * Resolved once and threaded through, so the check and the record that
   * follows it cannot disagree about which address they concern.
   */
  const address = await callerAddress();
  const limit = await checkLimit({
    action: 'signin',
    identifier: email,
    policy: SIGN_IN_POLICY,
    address,
  });
  if (!limit.allowed) {
    return { error: limit.message };
  }

  /** Records the attempt, then returns the same message every failure gives. */
  const fail = async (): Promise<SignInState> => {
    await recordAttempt({ action: 'signin', identifier: email, address });
    return { error: GENERIC_ERROR };
  };

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
    return fail();
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    return fail();
  }

  // A suspended school cannot be signed into, even with a valid password.
  const usable = user.memberships.filter((m) => m.school.status !== 'SUSPENDED');

  const membership = schoolSlug
    ? usable.find((m) => m.school.slug === schoolSlug)
    : usable[0];

  // No membership of the requested school (or of any school) is reported as a
  // credential failure, not as "you don't belong here".
  //
  // It counts against the rate limit like any other failure. This path is
  // reached with a CORRECT password, so it is not brute force — but it is the
  // way somebody with one valid credential would enumerate which schools that
  // account belongs to, by walking the slugs. Leaving it unlimited would make
  // the generic error message pointless: an attacker could simply retry until
  // the redirect behaviour differed.
  if (!membership || !isRole(membership.role)) {
    return fail();
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

  // Correct credentials clear this identifier's history, so somebody who
  // mistyped their password three times and then got it right starts clean.
  // The ADDRESS history is deliberately left alone: one user signing in
  // successfully must not wipe the evidence of an attack from the same network.
  await clearAttempts('signin', email);

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
    mcp: user.mustChangePassword ? true : undefined,
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

  // An account on a one-time password goes nowhere else, `next` included. That
  // password was read aloud or written on a slip; until it is replaced it is a
  // shared secret, and honouring a deep link here would be a way around the
  // gate rather than a convenience.
  if (user.mustChangePassword) redirect('/account/password');

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
