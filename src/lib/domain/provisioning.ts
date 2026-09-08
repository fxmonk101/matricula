/**
 * =============================================================================
 * PROVISIONING AND ENTITLEMENT
 * =============================================================================
 *
 * Pure. Slug and code derivation, seat arithmetic, temporary passwords.
 */

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

// -----------------------------------------------------------------------------
// Identifiers
// -----------------------------------------------------------------------------

/**
 * Words that must never become a school slug, because the router would then
 * have two meanings for one path.
 *
 * `/s/<slug>/login` is namespaced, so this is belt and braces rather than the
 * only defence — but a school called "admin" or "api" is confusing to a human
 * even where it is unambiguous to the router.
 */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'auth', 'login', 'logout', 'signin', 'signup',
  'apply', 'files', 'session', 'settings', 'static', 'public', 'assets',
  '_next', 'new', 'edit', 'delete', 'null', 'undefined', 'test', 's',
]);

/**
 * Derive a URL slug from a school's name.
 *
 * Deliberately ASCII-only. A slug appears in a URL, gets typed from a printed
 * letter, read down a phone line and pasted into a spreadsheet; a diacritic or
 * a non-Latin script survives none of that reliably. The school's real name
 * keeps its own spelling — this is only the address.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    // Strip combining marks, so "Ọ̀yọ́" becomes "Oyo" rather than vanishing.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base;
}

export function isValidSlug(slug: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)) return false;
  if (slug.includes('--')) return false;
  return !RESERVED_SLUGS.has(slug);
}

export function slugRejectionReason(slug: string): string | null {
  if (slug.length < 2) return 'The address needs at least two characters.';
  if (slug.length > 48) return 'That address is too long.';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use only lowercase letters, numbers and hyphens.';
  if (!/^[a-z0-9]/.test(slug)) return 'The address must start with a letter or number.';
  if (slug.endsWith('-')) return 'The address cannot end with a hyphen.';
  if (slug.includes('--')) return 'The address cannot contain two hyphens in a row.';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved and cannot be used as an address.`;
  return null;
}

/**
 * Derive the document-number prefix — the "GEU" in `INV-GEU-2026-000001`.
 *
 * Initials of the significant words, so "Golden Eagles University" gives GEU.
 * Falls back to the first letters of the name when there is only one word.
 */
export function deriveCode(name: string): string {
  const skip = new Set(['of', 'the', 'and', 'for', 'de', 'la', 'at', 'in']);
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0 && !skip.has(w.toLowerCase()));

  if (words.length === 0) return 'SCH';
  const initials = words.map((w) => w[0]).join('').toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 6);
  return words[0].slice(0, 4).toUpperCase();
}

export function isValidCode(code: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(code);
}

/** Append `-2`, `-3` … until the candidate is free. */
export function disambiguate(
  candidate: string,
  taken: ReadonlySet<string>,
  maxAttempts = 100,
): string {
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; n <= maxAttempts; n += 1) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) return next;
  }
  throw new ProvisioningError(`Could not find a free variant of "${candidate}".`);
}

// -----------------------------------------------------------------------------
// Temporary passwords
// -----------------------------------------------------------------------------

/**
 * The alphabet a one-time password is drawn from.
 *
 * Deliberately excludes every character pair a person confuses when reading a
 * password off a printed slip and typing it into a phone: O/0, I/l/1, 5/S,
 * 2/Z, 8/B. The password is going to be read aloud across an office at least
 * once, and a character set that survives that is worth more than the handful
 * of bits it costs.
 */
const PASSWORD_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

/**
 * Format a random byte sequence into a readable one-time password.
 *
 * Grouped with hyphens because an unbroken twelve-character string is
 * mistyped far more often than three groups of four. Takes its randomness as
 * an argument so this stays pure and testable; the caller supplies
 * `crypto.randomBytes`.
 */
export function formatTemporaryPassword(randomBytes: Uint8Array, groups = 3, size = 4): string {
  const needed = groups * size;
  if (randomBytes.length < needed) {
    throw new ProvisioningError(`Need at least ${needed} random bytes.`);
  }
  const chars: string[] = [];
  for (let i = 0; i < needed; i += 1) {
    chars.push(PASSWORD_ALPHABET[randomBytes[i] % PASSWORD_ALPHABET.length]);
  }
  const out: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    out.push(chars.slice(g * size, (g + 1) * size).join(''));
  }
  return out.join('-');
}

// -----------------------------------------------------------------------------
// Seats
// -----------------------------------------------------------------------------

export interface SeatLimits {
  /** Null means unlimited — which is NOT the same as zero. */
  maxStudents: number | null;
  maxStaff: number | null;
}

export interface SeatUsage {
  students: number;
  staff: number;
}

export type SeatKind = 'student' | 'staff';

/**
 * Resolve the ceilings that actually apply: a per-school override beats the
 * plan, and `null` at either level means unlimited.
 */
export function effectiveLimits(
  plan: SeatLimits,
  override: Partial<SeatLimits>,
): SeatLimits {
  return {
    maxStudents:
      override.maxStudents === undefined ? plan.maxStudents : override.maxStudents,
    maxStaff: override.maxStaff === undefined ? plan.maxStaff : override.maxStaff,
  };
}

export interface SeatVerdict {
  allowed: boolean;
  /** Shown to the operator or admin. Names the limit rather than being vague. */
  message?: string;
  used: number;
  limit: number | null;
}

/**
 * May one more person of this kind be added?
 *
 * Refuses AT the limit, not past it: a plan sold as "200 students" must hold
 * 200, so the 201st is the one refused. The message names both numbers,
 * because "seat limit reached" without saying the limit leaves an administrator
 * guessing what to buy.
 */
export function checkSeat(
  kind: SeatKind,
  usage: SeatUsage,
  limits: SeatLimits,
): SeatVerdict {
  const used = kind === 'student' ? usage.students : usage.staff;
  const limit = kind === 'student' ? limits.maxStudents : limits.maxStaff;

  if (limit === null) return { allowed: true, used, limit: null };
  if (used < limit) return { allowed: true, used, limit };

  const noun = kind === 'student' ? 'student' : 'staff';
  return {
    allowed: false,
    used,
    limit,
    message: `This school's plan allows ${limit} ${noun} ${limit === 1 ? 'place' : 'places'} and ${used} are in use. Upgrade the plan or remove an unused account.`,
  };
}

/** 0-100, for a usage meter. Unlimited reads as 0 rather than as full. */
export function seatUtilisation(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

// -----------------------------------------------------------------------------
// Trials
// -----------------------------------------------------------------------------

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

/**
 * What a subscription's status implies for the SCHOOL's status.
 *
 * Kept as a pure mapping so the two never drift: a cancelled subscription
 * suspends the school, an expired trial does NOT — it moves to PAST_DUE, which
 * still lets people in. Locking a school out of its own records the morning a
 * trial lapses is how a vendor loses a customer it had already won; chasing
 * the invoice is a commercial problem, not a technical one.
 */
export function schoolStatusFor(
  status: SubscriptionStatus,
  trialEndsAt: Date | null,
  now: Date,
): 'ACTIVE' | 'TRIAL' | 'SUSPENDED' {
  if (status === 'CANCELLED') return 'SUSPENDED';
  if (status === 'PAST_DUE') return 'ACTIVE';
  if (status === 'TRIALING') {
    if (trialEndsAt && trialEndsAt.getTime() <= now.getTime()) return 'ACTIVE';
    return 'TRIAL';
  }
  return 'ACTIVE';
}

export function trialDaysRemaining(trialEndsAt: Date | null, now: Date): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
