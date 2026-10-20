/**
 * Session token issue/verify. Uses `jose`, which runs on both the Node and the
 * Edge runtime — this module is imported by middleware, so it must never pull
 * in a Node-only dependency such as bcryptjs or the Prisma client.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { isRole, type Role } from '@/lib/domain/enums';

export const SESSION_COOKIE = 'geu_session';

export interface SessionClaims extends JWTPayload {
  sub: string; // user id
  email: string;
  name: string;
  /** The school this session is acting in. Authoritative for tenant scoping. */
  sch: string;
  /** The Membership granting `role` at `sch`. */
  mbr: string;
  /** Role held at `sch` — never a property of the user globally. */
  role: Role;
  /** School slug, for building tenant-aware public links. */
  slug?: string;
  /** Profile id for the role (studentId / instructorId / applicantId). */
  pid?: string;
  /** Platform operator. Deliberately not a Role. */
  pa?: boolean;
  /**
   * The account is on a one-time password and must set its own before doing
   * anything else.
   *
   * A claim rather than a database read because middleware runs on the Edge
   * runtime with no Prisma client, and this gate must apply to EVERY
   * authenticated route — including ones nobody has written yet. The staleness
   * that would matter runs the safe way: the claim can only be stale by saying
   * "must change" after the password has been changed, and the one action that
   * clears it re-issues the session in the same request. It can never be stale
   * in the direction that lets somebody keep using a password read aloud to
   * them across an office.
   */
  mcp?: boolean;
}

export function hasValidAuthSecret(): boolean {
  const secret = process.env.AUTH_SECRET;
  return typeof secret === 'string' && secret.length >= 32;
}

export function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!hasValidAuthSecret()) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Refusing to sign sessions with a weak key.',
    );
  }
  return new TextEncoder().encode(secret);
}

function secretKey(): Uint8Array {
  return authSecret();
}

function ttlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 28_800; // 8 hours
}

export async function signSession(claims: Omit<SessionClaims, 'iat' | 'exp'>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ttlSeconds())
    .setIssuer('golden-eagles-university')
    .setAudience('geu-portal')
    .sign(secretKey());
}

/**
 * Verify a token. Returns null rather than throwing for ANY failure — expired,
 * tampered, wrong issuer, malformed. Callers treat null as "not signed in";
 * distinguishing failure modes to the client would leak information about the
 * signing key.
 */
export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'golden-eagles-university',
      audience: 'geu-portal',
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || !isRole(payload.role)) return null;
    // A session with no school cannot be scoped, so it is not a session. This
    // is what stops a token minted before tenancy from authorising anything.
    if (typeof payload.sch !== 'string' || payload.sch.length === 0) return null;
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ttlSeconds(),
  };
}
