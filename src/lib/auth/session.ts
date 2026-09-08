import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, cookieOptions, signSession, verifySession, type SessionClaims } from './jwt';
import { roleSatisfies } from './rbac';
import { platformDb } from '@/lib/tenant';
import type { Role } from '@/lib/domain/enums';

/**
 * Node-runtime session helpers: cookies, redirects, and the guards pages call.
 *
 * Password hashing lives in `./password` rather than here — it has no request
 * to be bound to, and keeping it in this `server-only` module made the seed
 * and any provisioning script pull in `next/headers`. Re-exported below so
 * existing call sites are unaffected.
 */
export {
  DUMMY_HASH,
  equaliseTiming,
  hashPassword,
  verifyPassword,
} from './password';

export async function createSession(claims: Omit<SessionClaims, 'iat' | 'exp'>): Promise<void> {
  const token = await signSession(claims);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Current session, or null. Safe to call from any server component. */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Current session, or redirect to sign-in. */
export async function requireSession(): Promise<SessionClaims> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Current session with a role assertion. Redirects to /forbidden rather than
 * /login when the user IS signed in but lacks the role — sending them back to
 * a login form they have already completed is a confusing dead end.
 *
 * The role asserted is the one held at the session's school. There is no such
 * thing as a global role in this system.
 */
export async function requireRole(...allowed: Role[]): Promise<SessionClaims> {
  const session = await requireSession();
  // `roleSatisfies`, not `includes`: OWNER holds everything ADMIN holds, so a
  // page written before OWNER existed must not lock the school's own owner out.
  if (!roleSatisfies(session.role, allowed)) redirect('/forbidden');
  return session;
}

/**
 * The school this request is acting in, taken from the signed session rather
 * than from anything the client can set. Every tenant-scoped query derives
 * from this value.
 */
export async function requireTenant(): Promise<{ session: SessionClaims; schoolId: string }> {
  const session = await requireSession();
  return { session, schoolId: session.sch };
}

/**
 * Platform operators act across tenants, so they are gated separately from the
 * per-school permission matrix — a platform admin is not a Role and can never
 * be granted by a school.
 *
 * THE DATABASE IS RE-CHECKED ON EVERY CALL, and the `pa` claim is only a fast
 * negative. A JWT lives eight hours, so trusting the claim alone means revoking
 * an operator does nothing until their session happens to expire — the one
 * grant in the system where that delay is least acceptable, since it is the
 * grant that reaches every school's data at once. Middleware still checks the
 * claim cheaply and without a query; this is the check that actually decides.
 */
export async function requirePlatformAdmin(): Promise<SessionClaims> {
  const session = await requireSession();
  if (!session.pa) redirect('/forbidden');

  const grant = await platformDb.platformAdmin.findUnique({
    where: { userId: session.sub },
    select: { id: true },
  });
  if (!grant) redirect('/forbidden');

  return session;
}

export type { SessionClaims };
