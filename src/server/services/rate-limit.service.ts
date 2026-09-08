/**
 * Durable rate limiting for the two endpoints reachable without an account.
 *
 * No `server-only` guard — a maintenance job prunes the table.
 */

import { headers } from 'next/headers';

import { platformDb } from '@/lib/tenant';
import {
  checkRateLimit,
  normaliseAddress,
  rateLimitMessage,
  type RateLimitPolicy,
} from '@/lib/domain/rate-limit';

export type LimitedAction = 'signin' | 'apply';

export interface LimitResult {
  allowed: boolean;
  /** Ready to show the user. Never says which budget was exceeded. */
  message?: string;
}

/**
 * Read the caller's address from the request headers.
 *
 * Returns "unknown" rather than throwing when there are no headers — a server
 * action invoked outside a request (a test, a script) should not blow up, and
 * bucketing those together is the safe reading.
 */
export async function callerAddress(): Promise<string> {
  try {
    const h = await headers();
    return normaliseAddress(h.get('x-forwarded-for'), h.get('x-real-ip'));
  } catch {
    return 'unknown';
  }
}

/**
 * Check whether this attempt is permitted.
 *
 * FAILS OPEN. If the store is unreachable the request is allowed, loudly.
 *
 * That is a deliberate trade-off and the opposite of the rule everywhere else
 * in this codebase, where the tenant layer fails closed. The difference is what
 * each protects: tenant scoping is an authorisation boundary, and letting a
 * request through when it breaks would expose another school's data. Rate
 * limiting is spam control — letting an attempt through when the store is down
 * costs a little abuse, whereas failing closed would lock every legitimate user
 * out of sign-in across every school because one table was unavailable.
 *
 * Availability wins here precisely because nothing confidential is behind it.
 */
export async function checkLimit(params: {
  action: LimitedAction;
  identifier: string;
  policy: RateLimitPolicy;
  address?: string;
}): Promise<LimitResult> {
  const address = params.address ?? (await callerAddress());
  const identifier = params.identifier.trim().toLowerCase().slice(0, 200);
  const now = new Date();

  // One window covers both rules, so a single scan serves both budgets.
  const longest = Math.max(
    params.policy.perAddress.windowSeconds,
    params.policy.perIdentifier.windowSeconds,
  );
  const since = new Date(now.getTime() - longest * 1000);

  try {
    const rows = await platformDb.rateLimitHit.findMany({
      where: {
        action: params.action,
        createdAt: { gte: since },
        OR: [{ address }, { identifier }],
      },
      select: { address: true, identifier: true, createdAt: true },
      // A bound, so a sustained flood cannot turn each check into an
      // ever-growing scan. Well above any policy's limit, so it never truncates
      // a set small enough to matter.
      take: 500,
    });

    const verdict = checkRateLimit(
      {
        byAddress: rows.filter((r) => r.address === address).map((r) => r.createdAt),
        byIdentifier: rows.filter((r) => r.identifier === identifier).map((r) => r.createdAt),
      },
      params.policy,
      now,
    );

    if (verdict.allowed) return { allowed: true };

    console.warn(
      `[rate-limit] refused ${params.action} on ${verdict.scope} budget`,
      { address, identifier },
    );
    return {
      allowed: false,
      message: rateLimitMessage(verdict.retryAfterSeconds ?? 60),
    };
  } catch (error) {
    console.error('[rate-limit] store unavailable, allowing request', params.action, error);
    return { allowed: true };
  }
}

/**
 * Record an attempt.
 *
 * Called only for attempts that should count against the budget — a FAILED
 * sign-in, or a submitted application. A successful sign-in is not recorded, so
 * somebody working normally all day never approaches the limit; recording
 * successes would punish exactly the people the system exists for.
 *
 * Non-throwing: failing to write a spam-control row must never fail the
 * operation it was measuring.
 */
export async function recordAttempt(params: {
  action: LimitedAction;
  identifier: string;
  schoolId?: string | null;
  address?: string;
}): Promise<void> {
  try {
    await platformDb.rateLimitHit.create({
      data: {
        action: params.action,
        address: params.address ?? (await callerAddress()),
        identifier: params.identifier.trim().toLowerCase().slice(0, 200),
        schoolId: params.schoolId ?? null,
      },
    });
  } catch (error) {
    console.error('[rate-limit] failed to record attempt', params.action, error);
  }
}

/**
 * Clear an identifier's history.
 *
 * Called after a SUCCESSFUL sign-in, so somebody who mistyped their password
 * three times and then got it right starts clean. Without this, a person having
 * a bad morning stays one typo away from being locked out for a quarter of an
 * hour.
 *
 * WHAT THIS DOES AND DOES NOT PRESERVE
 * ------------------------------------
 * Each row carries both an address and an identifier, so deleting by identifier
 * necessarily removes that row's contribution to the ADDRESS budget as well.
 * There is no way to keep one and drop the other without keeping the row.
 *
 * That is a real weakening, and it is accepted because it does not help an
 * attacker: a success only clears rows whose identifier is the account that
 * just succeeded, which requires valid credentials for it. Failures against
 * OTHER accounts are stored under those identifiers and survive untouched, so
 * the address budget still fills from the attack itself. What gets cleared is
 * only the attacker's own fumbling with their own password — which is exactly
 * what should be forgiven.
 *
 * Preserving the address evidence exactly would mean marking rows rather than
 * deleting them, and carrying a flag through every query, for a property that
 * changes no outcome. Noted rather than built.
 */
export async function clearAttempts(action: LimitedAction, identifier: string): Promise<void> {
  try {
    await platformDb.rateLimitHit.deleteMany({
      where: { action, identifier: identifier.trim().toLowerCase() },
    });
  } catch (error) {
    console.error('[rate-limit] failed to clear attempts', action, error);
  }
}

/**
 * Delete rows older than any policy window. For a scheduled job.
 *
 * The table is append-only during normal operation, so without pruning it grows
 * for the life of the deployment — and every check would scan more rows than
 * the one before.
 */
export async function pruneRateLimitHits(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const result = await platformDb.rateLimitHit.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
