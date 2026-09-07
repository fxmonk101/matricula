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
  role: Role;
  name: string;
  /** Profile id for the role (studentId / instructorId / applicantId). */
  pid?: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Refusing to sign sessions with a weak key.',
    );
  }
  return new TextEncoder().encode(secret);
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
