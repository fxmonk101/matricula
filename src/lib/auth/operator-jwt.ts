/**
 * =============================================================================
 * OPERATOR SESSIONS
 * =============================================================================
 *
 * The vendor's own staff — the people who provision, bill and suspend schools.
 *
 * A SEPARATE COOKIE AND A SEPARATE TOKEN, not a flag on the school session.
 *
 * Why not a claim on the existing session, which is how this started: a school
 * session is REQUIRED to name a school (`sch`), because every tenant query is
 * scoped by it and a session that cannot be scoped is not a session. That meant
 * a member of the vendor's staff had to hold a membership of some customer's
 * university merely in order to sign in — and the console then rendered inside
 * that university's shell, with its crest in the corner. Vendor and customer
 * were the same account wearing a badge.
 *
 * Two cookies also means the two can be held at once. Somebody supporting a
 * university genuinely does need to be signed in to the console AND into that
 * school to reproduce what a registrar is seeing; with one cookie, doing so
 * means signing out of one to enter the other.
 *
 * THE AUDIENCE IS DIFFERENT ON PURPOSE. A school token and an operator token
 * are signed with the same key, so without distinct audiences a school session
 * cookie could be copied into the operator cookie and would verify. `jose`
 * rejects the mismatch, which makes the two token families genuinely
 * non-interchangeable rather than merely differently named.
 *
 * Runs on the edge: `jose` only, no Node APIs, no Prisma.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { authSecret, hasValidAuthSecret } from './jwt';

export const OPERATOR_COOKIE = 'ge_operator';

const ISSUER = 'golden-eagles-university';
/** Deliberately NOT `geu-portal`. See the note above. */
const AUDIENCE = 'geu-operator';

export interface OperatorClaims extends JWTPayload {
  sub: string;
  email: string;
  name: string;
}

function secretKey(): Uint8Array {
  if (!hasValidAuthSecret()) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Refusing to sign sessions with a weak key.',
    );
  }
  return authSecret();
}

/**
 * Four hours, against the school session's eight.
 *
 * This session can provision, suspend and bill every institution on the
 * platform. A shorter life is the cheapest available limit on an unattended
 * laptop, and the people holding it sign in from a desk rather than spending a
 * teaching day in the app.
 */
function ttlSeconds(): number {
  const raw = Number(process.env.OPERATOR_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 14_400;
}

export async function signOperatorSession(
  claims: Omit<OperatorClaims, 'iat' | 'exp'>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ttlSeconds())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(secretKey());
}

/** Null for any failure — expired, tampered, or a school token replayed here. */
export async function verifyOperatorSession(
  token: string | undefined,
): Promise<OperatorClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.email !== 'string') return null;
    return payload as OperatorClaims;
  } catch {
    return null;
  }
}

export function operatorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    // Scoped to the console. The browser does not send this cookie to a
    // school's pages at all, so a bug in tenant code cannot read it.
    path: '/operator',
    maxAge: ttlSeconds(),
  };
}
