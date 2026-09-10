import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  OPERATOR_COOKIE,
  operatorCookieOptions,
  signOperatorSession,
  verifyOperatorSession,
  type OperatorClaims,
} from './operator-jwt';
import { platformDb } from '@/lib/tenant';

/**
 * Node-runtime helpers for the vendor console.
 *
 * The counterpart of `./session`, kept separate for the same reason the cookies
 * are separate: nothing here should be reachable from a school page, and
 * nothing there should be able to mint an operator session by accident.
 */

export async function createOperatorSession(
  claims: Omit<OperatorClaims, 'iat' | 'exp'>,
): Promise<void> {
  const token = await signOperatorSession(claims);
  const store = await cookies();
  store.set(OPERATOR_COOKIE, token, operatorCookieOptions());
}

export async function destroyOperatorSession(): Promise<void> {
  const store = await cookies();
  // Deleting by name alone can miss a cookie set on a narrower path, so the
  // path is restated here exactly as it was written.
  store.set(OPERATOR_COOKIE, '', { ...operatorCookieOptions(), maxAge: 0 });
}

export async function getOperatorSession(): Promise<OperatorClaims | null> {
  const store = await cookies();
  return verifyOperatorSession(store.get(OPERATOR_COOKIE)?.value);
}

/**
 * The console's gate.
 *
 * THE DATABASE IS RE-CHECKED ON EVERY CALL. The token lives four hours, and
 * this is the grant that reaches every institution's data at once — so
 * revoking somebody has to end their live session rather than waiting for it
 * to expire. Middleware checks the cookie cheaply and without a query; this is
 * the check that actually decides.
 */
export async function requireOperator(): Promise<OperatorClaims> {
  const session = await getOperatorSession();
  if (!session) redirect('/operator/login');

  const grant = await platformDb.platformAdmin.findUnique({
    where: { userId: session.sub },
    select: { id: true },
  });
  if (!grant) redirect('/operator/login?reason=revoked');

  return session;
}
