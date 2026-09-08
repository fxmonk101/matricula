import { describe, expect, it } from 'vitest';

import {
  APPLY_POLICY,
  checkRateLimit,
  checkWindow,
  normaliseAddress,
  rateLimitMessage,
  SIGN_IN_POLICY,
} from '@/lib/domain/rate-limit';

const NOW = new Date('2026-03-15T12:00:00Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);
const minutesAgo = (m: number) => secondsAgo(m * 60);

describe('sliding window', () => {
  const rule = { limit: 3, windowSeconds: 60 };

  it('allows an attempt when the window is empty', () => {
    expect(checkWindow([], rule, NOW).allowed).toBe(true);
  });

  it('allows up to the limit', () => {
    expect(checkWindow([secondsAgo(1), secondsAgo(2)], rule, NOW).allowed).toBe(true);
  });

  it('refuses at the limit', () => {
    expect(checkWindow([secondsAgo(1), secondsAgo(2), secondsAgo(3)], rule, NOW).allowed).toBe(false);
  });

  it('ignores attempts that have aged out', () => {
    const old = [secondsAgo(61), secondsAgo(120), secondsAgo(300)];
    expect(checkWindow(old, rule, NOW).allowed).toBe(true);
  });

  it('has no boundary an attacker can spend twice at', () => {
    // The failure a fixed window has: full budget at 10:59, full budget again
    // at 11:00. With a sliding log, six attempts in two minutes is refused
    // however they straddle a clock boundary.
    const straddling = [secondsAgo(35), secondsAgo(31), secondsAgo(29), secondsAgo(25)];
    expect(checkWindow(straddling, rule, NOW).allowed).toBe(false);
  });

  it('reports when a slot frees, not the whole window', () => {
    // The oldest attempt is 50s old in a 60s window, so a slot frees in 10s.
    // Telling somebody to wait 60 seconds would be needlessly punitive.
    const v = checkWindow([secondsAgo(50), secondsAgo(20), secondsAgo(10)], rule, NOW);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(10);
  });

  it('never reports a retry of zero seconds', () => {
    // An attempt exactly at the window edge would otherwise compute 0, which
    // renders as "try again in 0 seconds".
    const v = checkWindow([secondsAgo(60), secondsAgo(1), secondsAgo(1)], rule, NOW);
    if (!v.allowed) expect(v.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('is unaffected by the order attempts arrive in', () => {
    const a = [secondsAgo(10), secondsAgo(50), secondsAgo(30)];
    const b = [secondsAgo(50), secondsAgo(30), secondsAgo(10)];
    expect(checkWindow(a, rule, NOW)).toEqual(checkWindow(b, rule, NOW));
  });
});

describe('the two-key check', () => {
  const empty = { byAddress: [], byIdentifier: [] };

  it('allows a clean request', () => {
    expect(checkRateLimit(empty, SIGN_IN_POLICY, NOW).allowed).toBe(true);
  });

  it('refuses when the identifier budget is spent, even from a clean address', () => {
    // The targeted attack: someone guessing one account's password while
    // rotating their address.
    const v = checkRateLimit(
      { byAddress: [], byIdentifier: Array.from({ length: 5 }, (_, i) => minutesAgo(i)) },
      SIGN_IN_POLICY,
      NOW,
    );
    expect(v.allowed).toBe(false);
    expect(v.scope).toBe('identifier');
  });

  it('refuses when the address budget is spent, even for a fresh identifier', () => {
    // The volume attack: a script working through a list of emails.
    const v = checkRateLimit(
      { byAddress: Array.from({ length: 30 }, (_, i) => minutesAgo(i % 14)), byIdentifier: [] },
      SIGN_IN_POLICY,
      NOW,
    );
    expect(v.allowed).toBe(false);
    expect(v.scope).toBe('address');
  });

  it('reports the identifier first when both are spent', () => {
    // The tighter, more specific budget is the more useful thing to log.
    const v = checkRateLimit(
      {
        byAddress: Array.from({ length: 40 }, () => minutesAgo(1)),
        byIdentifier: Array.from({ length: 10 }, () => minutesAgo(1)),
      },
      SIGN_IN_POLICY,
      NOW,
    );
    expect(v.scope).toBe('identifier');
  });

  it('gives an address far more headroom than an identifier', () => {
    // A whole campus shares one address; an identifier is one person.
    expect(SIGN_IN_POLICY.perAddress.limit).toBeGreaterThan(SIGN_IN_POLICY.perIdentifier.limit);
    expect(APPLY_POLICY.perAddress.limit).toBeGreaterThan(APPLY_POLICY.perIdentifier.limit);
  });

  it('lets a cohort of applicants share one network', () => {
    // Results day: nineteen people have applied from the college's address in
    // the last hour. The twentieth must still get through.
    const v = checkRateLimit(
      { byAddress: Array.from({ length: 19 }, (_, i) => minutesAgo(i * 3)), byIdentifier: [] },
      APPLY_POLICY,
      NOW,
    );
    expect(v.allowed).toBe(true);
  });

  it('still stops one applicant submitting repeatedly', () => {
    const v = checkRateLimit(
      { byAddress: [], byIdentifier: [minutesAgo(1), minutesAgo(5), minutesAgo(20)] },
      APPLY_POLICY,
      NOW,
    );
    expect(v.allowed).toBe(false);
  });
});

describe('the refusal message', () => {
  it('never distinguishes which budget was exceeded', () => {
    // Saying "too many attempts on this account" would confirm the account
    // exists — the same enumeration leak the sign-in form avoids elsewhere.
    expect(rateLimitMessage(30)).not.toMatch(/account|address|network|email/i);
    expect(rateLimitMessage(600)).not.toMatch(/account|address|network|email/i);
  });

  it('rounds up to whole minutes', () => {
    expect(rateLimitMessage(30)).toMatch(/a minute/);
    expect(rateLimitMessage(400)).toMatch(/7 minutes/);
  });
});

describe('address normalisation', () => {
  it('takes the left-most forwarded value', () => {
    expect(normaliseAddress('203.0.113.7, 70.41.3.18', null)).toBe('203.0.113.7');
  });

  it('falls back to the real-ip header', () => {
    expect(normaliseAddress(null, '198.51.100.4')).toBe('198.51.100.4');
  });

  it('buckets unknown addresses together rather than giving each a fresh budget', () => {
    // Otherwise stripping the header would be a way to reset the limit.
    expect(normaliseAddress(null, null)).toBe('unknown');
    expect(normaliseAddress('', '  ')).toBe('unknown');
  });

  it('strips IPv6 brackets and zone identifiers', () => {
    expect(normaliseAddress('[2001:db8::1]', null)).toBe('2001:db8::1');
    expect(normaliseAddress('fe80::1%eth0', null)).toBe('fe80::1');
  });

  it('caps the key length so a huge header cannot bloat the table', () => {
    expect(normaliseAddress('x'.repeat(500), null).length).toBeLessThanOrEqual(64);
  });

  it('lower-cases for stable keying', () => {
    expect(normaliseAddress('2001:DB8::AB', null)).toBe('2001:db8::ab');
  });
});
