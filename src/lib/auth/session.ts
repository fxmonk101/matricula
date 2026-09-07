import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';

import { SESSION_COOKIE, cookieOptions, signSession, verifySession, type SessionClaims } from './jwt';
import type { Role } from '@/lib/domain/enums';

/**
 * Node-runtime session helpers. Imports bcryptjs, so this module must never be
 * pulled into middleware — use `./jwt` there instead.
 */

/**
 * Cost factor 12: roughly 250ms per hash on commodity hardware in 2025. High
 * enough to make offline cracking expensive, low enough that a login does not
 * feel slow. Revisit upward as hardware improves.
 */
const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A dummy hash compared against when the email does not exist.
 *
 * Without this, a non-existent email returns in ~1ms while a real one takes
 * ~250ms, and that timing difference is a free user-enumeration oracle. Doing
 * the wasted comparison equalises the two paths.
 */
export const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv.wxyz0123456789ABCDEFGHIJKLMNOPqr';

export async function equaliseTiming(): Promise<void> {
  await bcrypt.compare('timing-equaliser', DUMMY_HASH).catch(() => false);
}

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
 */
export async function requireRole(...allowed: Role[]): Promise<SessionClaims> {
  const session = await requireSession();
  if (!allowed.includes(session.role)) redirect('/forbidden');
  return session;
}

export type { SessionClaims };
