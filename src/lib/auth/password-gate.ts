/**
 * =============================================================================
 * FORCED PASSWORD CHANGE
 * =============================================================================
 *
 * Whether this request should be redirected to the change-password page.
 *
 * Pure, and separate from the middleware, for one reason: getting this wrong
 * produces an infinite redirect — a user signed in, sent to a page, sent
 * straight back, with no way out but clearing their cookies by hand. That has
 * already happened once in this codebase, and it is not the kind of thing to
 * find out about from a screenshot. It lives here so a test can exercise the
 * exact decision the edge runtime makes.
 *
 * Edge-safe: no Node APIs, no Prisma, no `next/server`.
 */

/** Where an account on a one-time password is sent until it sets its own. */
export const FORCED_PASSWORD_PATH = '/account/password';

/**
 * The only paths reachable while a forced change is outstanding.
 *
 * The change page itself, obviously — redirecting it to itself is the loop.
 *
 * Signing out is here deliberately. Somebody who cannot complete the change —
 * wrong machine, shared laptop, did not write the password down — must be able
 * to leave. Without it the redirect is a trap rather than a gate.
 *
 * `/forbidden` is here so that a user who is BOTH in forced-change state and
 * hitting a route they lack the role for still sees an explanation rather than
 * bouncing between two redirects.
 */
export const PASSWORD_ESCAPE_PATHS: readonly string[] = [
  FORCED_PASSWORD_PATH,
  '/session/end',
  '/forbidden',
];

const ESCAPE = new Set(PASSWORD_ESCAPE_PATHS);

/**
 * Should this request be redirected to set a password?
 *
 * Deliberately takes the whole session rather than a boolean, so that a caller
 * cannot pass the wrong flag: there is exactly one claim this reads.
 */
export function requiresPasswordChange(
  pathname: string,
  session: { mcp?: boolean } | null | undefined,
): boolean {
  if (!session?.mcp) return false;
  return !ESCAPE.has(pathname);
}
