/**
 * =============================================================================
 * RATE LIMITING
 * =============================================================================
 *
 * Pure: the decision only. Storage and clock live in the service.
 *
 * This exists for the two endpoints anybody on the internet can reach without
 * an account — the public application form and sign-in. Everything else in the
 * system is behind a session, where the audit trail and the role matrix already
 * make abuse attributable. These two are not.
 *
 * THE TWO-KEY DESIGN, AND WHY
 * ---------------------------
 * Limiting by IP alone is wrong for a school. A university campus, a computer
 * lab, or a whole country's mobile network can sit behind one address, so an IP
 * limit tight enough to stop a script would lock out a legitimate cohort trying
 * to register on the same afternoon.
 *
 * Limiting by identity alone is also wrong: an attacker enumerating passwords
 * simply varies the email.
 *
 * So each attempt is checked against BOTH, with different budgets — a generous
 * one per IP, a tight one per identifier — and refused if either is exceeded.
 * The IP limit catches volume; the identifier limit catches a targeted attack
 * that rotates addresses.
 */

export interface RateLimitRule {
  /** Attempts permitted inside the window. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitPolicy {
  /** Budget for one network address. Generous: campuses share addresses. */
  perAddress: RateLimitRule;
  /** Budget for one identifier — an email, a slug. Tight. */
  perIdentifier: RateLimitRule;
}

/**
 * Sign-in.
 *
 * Only FAILED attempts are recorded (see the service), so somebody signing in
 * correctly all day never approaches the limit. Ten failures from one address
 * in fifteen minutes is a script; five against one account is someone guessing
 * at that account specifically.
 */
export const SIGN_IN_POLICY: RateLimitPolicy = {
  perAddress: { limit: 30, windowSeconds: 15 * 60 },
  perIdentifier: { limit: 5, windowSeconds: 15 * 60 },
};

/**
 * Public application form.
 *
 * Each submission creates a user account and an application, so the cost of
 * abuse is real rows rather than wasted cycles. A genuine applicant submits
 * once, occasionally twice if they made a mistake; three in an hour from one
 * email address is not a person filling in a form.
 *
 * The address budget is deliberately loose because a sixth-form college's whole
 * cohort may apply from one network on results day.
 */
export const APPLY_POLICY: RateLimitPolicy = {
  perAddress: { limit: 20, windowSeconds: 60 * 60 },
  perIdentifier: { limit: 3, windowSeconds: 60 * 60 },
};

export interface RateLimitVerdict {
  allowed: boolean;
  /** Which budget was exceeded — for the log, never for the user. */
  scope?: 'address' | 'identifier';
  retryAfterSeconds?: number;
}

/**
 * ALGORITHM: SLIDING-LOG RATE LIMIT
 * ---------------------------------
 *   recent  = timestamps within the window
 *   allowed = recent.length < limit
 *   retryAfter = (oldest recent + window) - now
 *
 * A sliding log rather than a fixed window. A fixed window resets on the hour,
 * which lets an attacker spend the whole budget at 10:59 and the whole budget
 * again at 11:00 — twice the intended rate at exactly the moment somebody is
 * probing for the boundary. The log has no boundary to find.
 *
 * The cost is one row per attempt, which is affordable precisely because this
 * guards two endpoints rather than every request.
 *
 * `retryAfter` is computed from the OLDEST attempt still in the window: that is
 * the moment a slot frees. Telling somebody to wait the full window when they
 * are one second from a slot is needlessly punitive.
 */
export function checkWindow(
  attempts: readonly Date[],
  rule: RateLimitRule,
  now: Date,
): { allowed: boolean; retryAfterSeconds: number } {
  const cutoff = now.getTime() - rule.windowSeconds * 1000;
  const recent = attempts.filter((a) => a.getTime() > cutoff).sort((a, b) => a.getTime() - b.getTime());

  if (recent.length < rule.limit) return { allowed: true, retryAfterSeconds: 0 };

  const oldest = recent[0].getTime();
  const freesAt = oldest + rule.windowSeconds * 1000;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000)),
  };
}

/** Check both budgets. Refused if either is exceeded. */
export function checkRateLimit(
  attempts: { byAddress: readonly Date[]; byIdentifier: readonly Date[] },
  policy: RateLimitPolicy,
  now: Date,
): RateLimitVerdict {
  const identifier = checkWindow(attempts.byIdentifier, policy.perIdentifier, now);
  if (!identifier.allowed) {
    return { allowed: false, scope: 'identifier', retryAfterSeconds: identifier.retryAfterSeconds };
  }

  const address = checkWindow(attempts.byAddress, policy.perAddress, now);
  if (!address.allowed) {
    return { allowed: false, scope: 'address', retryAfterSeconds: address.retryAfterSeconds };
  }

  return { allowed: true };
}

/**
 * The message shown to somebody who has been refused.
 *
 * Deliberately identical whichever budget was exceeded, and it never says
 * whether the account exists. A message that distinguished "too many attempts
 * on this account" from "too many attempts from your network" would confirm
 * that an account exists, which is the same enumeration leak the sign-in form
 * already takes care to avoid with its constant-time comparison.
 */
export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? 'Too many attempts. Please wait a minute and try again.'
    : `Too many attempts. Please try again in about ${minutes} minutes.`;
}

/**
 * Normalise a client address for use as a key.
 *
 * `x-forwarded-for` is a LIST — the client appends, each proxy appends — and
 * only the entries added by infrastructure you control are trustworthy. The
 * left-most value is whatever the client sent, so it is spoofable and must
 * never be treated as identity; it is used here only as a spam-control key,
 * where the worst outcome of a forged value is that an attacker rate-limits
 * themselves under a different bucket. The per-identifier budget is what
 * actually stops that attack.
 *
 * Returns a fixed string when no address can be determined, so those requests
 * share one bucket rather than each getting a fresh budget.
 */
export function normaliseAddress(forwardedFor: string | null, realIp: string | null): string {
  const candidate = (forwardedFor ?? '').split(',')[0]?.trim() || (realIp ?? '').trim();
  if (candidate === '') return 'unknown';
  // Strip an IPv6 zone or a port, and lower-case for stable keying.
  return candidate.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase().slice(0, 64);
}
