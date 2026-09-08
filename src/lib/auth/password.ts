import bcrypt from 'bcryptjs';

/**
 * Password hashing, separate from `./session`.
 *
 * Split out deliberately. `session.ts` is marked `server-only` because it reads
 * cookies and calls `redirect()` — neither of which means anything outside a
 * request. Hashing a password has no such constraint: the seed and any
 * command-line provisioning script legitimately need it, and folding it into
 * the request-bound module made those callers pull in `next/headers` and fail
 * at import time.
 *
 * Still not usable from middleware: bcryptjs is a Node-runtime dependency.
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
