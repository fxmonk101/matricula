import { describe, expect, it } from 'vitest';

import {
  ProvisioningError,
  checkSeat,
  deriveCode,
  disambiguate,
  effectiveLimits,
  formatTemporaryPassword,
  isValidCode,
  isValidSlug,
  schoolStatusFor,
  seatUtilisation,
  slugRejectionReason,
  slugify,
  trialDaysRemaining,
} from '@/lib/domain/provisioning';

describe('slugs', () => {
  it('derives a URL address from a school name', () => {
    expect(slugify('Golden Eagles University')).toBe('golden-eagles-university');
    expect(slugify('St. Mary’s College')).toBe('st-mary-s-college');
  });

  it('strips diacritics rather than dropping the letter', () => {
    // A slug is typed off a printed letter and read down a phone line, so it
    // is ASCII — but "Ọ̀yọ́" must become "Oyo", not vanish.
    expect(slugify('Ọ̀yọ́ State Academy')).toBe('oyo-state-academy');
    expect(slugify('Lycée Français')).toBe('lycee-francais');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugify('  ***Hope & Glory--School!!  ')).toBe('hope-glory-school');
  });

  it('accepts a well-formed slug', () => {
    expect(isValidSlug('golden-eagles')).toBe(true);
    expect(isValidSlug('school2')).toBe(true);
  });

  it('refuses reserved words the router already means something by', () => {
    for (const reserved of ['admin', 'api', 'login', 'files', 'settings']) {
      expect(isValidSlug(reserved), reserved).toBe(false);
      expect(slugRejectionReason(reserved), reserved).toMatch(/reserved/);
    }
  });

  it('refuses the "s" prefix the tenant routes are mounted on', () => {
    // Rejected for length before it is rejected for being reserved, which is
    // the more useful message of the two — so this only pins that it is
    // refused, not which rule catches it first.
    expect(isValidSlug('s')).toBe(false);
  });

  it('refuses malformed slugs, and says which rule was broken', () => {
    expect(slugRejectionReason('a')).toMatch(/two characters/);
    expect(slugRejectionReason('Has Capitals')).toMatch(/lowercase/);
    expect(slugRejectionReason('-leading')).toMatch(/start with/);
    expect(slugRejectionReason('trailing-')).toMatch(/end with/);
    expect(slugRejectionReason('double--hyphen')).toMatch(/two hyphens/);
  });

  it('accepts a valid slug with no complaint', () => {
    expect(slugRejectionReason('golden-eagles')).toBeNull();
  });
});

describe('document codes', () => {
  it('takes initials of the significant words', () => {
    expect(deriveCode('Golden Eagles University')).toBe('GEU');
    expect(deriveCode('Meridian Institute of Technology')).toBe('MIT');
  });

  it('skips joining words so the code stays pronounceable', () => {
    // "of" and "the" would make MOIT and turn every invoice number to soup.
    expect(deriveCode('University of the Arts')).toBe('UA');
  });

  it('falls back to leading letters for a single-word name', () => {
    expect(deriveCode('Harrow')).toBe('HARR');
  });

  it('never returns an empty code', () => {
    expect(deriveCode('!!!')).toBe('SCH');
    expect(deriveCode('')).toBe('SCH');
  });

  it('validates the shape used in document numbers', () => {
    expect(isValidCode('GEU')).toBe(true);
    expect(isValidCode('GE')).toBe(true);
    expect(isValidCode('G')).toBe(false);
    expect(isValidCode('geu')).toBe(false);
    expect(isValidCode('GEU-2')).toBe(false);
  });
});

describe('disambiguation', () => {
  it('leaves a free candidate alone', () => {
    expect(disambiguate('harrow', new Set())).toBe('harrow');
  });

  it('appends a counter until it finds a gap', () => {
    expect(disambiguate('harrow', new Set(['harrow']))).toBe('harrow-2');
    expect(disambiguate('harrow', new Set(['harrow', 'harrow-2']))).toBe('harrow-3');
  });

  it('gives up rather than looping forever', () => {
    const taken = new Set(['x', ...Array.from({ length: 200 }, (_, i) => `x-${i + 2}`)]);
    expect(() => disambiguate('x', taken, 20)).toThrow(ProvisioningError);
  });
});

describe('temporary passwords', () => {
  const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i * 7));

  it('formats readable groups', () => {
    expect(formatTemporaryPassword(bytes(12))).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('excludes every character pair confused when read aloud', () => {
    // The password gets read across an office at least once. O/0, I/l/1, S/5,
    // Z/2 and B/8 are worth more than the few bits they cost.
    const all = formatTemporaryPassword(new Uint8Array(Array.from({ length: 300 }, (_, i) => i)), 75, 4);
    for (const banned of ['O', '0', 'I', 'L', '1', 'S', '5', 'Z', '2', 'B', '8']) {
      expect(all.includes(banned), `contains ${banned}`).toBe(false);
    }
  });

  it('refuses to run short of randomness rather than repeating bytes', () => {
    expect(() => formatTemporaryPassword(bytes(4))).toThrow(ProvisioningError);
  });
});

describe('seat limits', () => {
  const plan = { maxStudents: 200, maxStaff: 20 };

  it('uses the plan when there is no override', () => {
    expect(effectiveLimits(plan, {})).toEqual(plan);
  });

  it('lets a per-school override beat the plan', () => {
    // A negotiated deal must not raise the ceiling for everybody else.
    expect(effectiveLimits(plan, { maxStudents: 500 })).toEqual({ maxStudents: 500, maxStaff: 20 });
  });

  it('treats an explicit null override as unlimited', () => {
    expect(effectiveLimits(plan, { maxStudents: null }).maxStudents).toBeNull();
  });

  it('allows a seat below the limit', () => {
    expect(checkSeat('student', { students: 199, staff: 0 }, plan).allowed).toBe(true);
  });

  it('refuses AT the limit, so a plan sold as 200 holds 200', () => {
    const verdict = checkSeat('student', { students: 200, staff: 0 }, plan);
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toMatch(/200 student places/);
    expect(verdict.message).toMatch(/200 are in use/);
  });

  it('names both numbers, so an admin knows what to buy', () => {
    const verdict = checkSeat('staff', { students: 0, staff: 20 }, plan);
    expect(verdict.message).toMatch(/20 staff places/);
  });

  it('never refuses when the limit is unlimited', () => {
    const unlimited = { maxStudents: null, maxStaff: null };
    expect(checkSeat('student', { students: 100000, staff: 0 }, unlimited).allowed).toBe(true);
  });

  it('distinguishes unlimited from zero', () => {
    // A plan with maxStaff 0 sells nothing; one with null sells everything.
    expect(checkSeat('staff', { students: 0, staff: 0 }, { maxStudents: null, maxStaff: 0 }).allowed).toBe(false);
    expect(checkSeat('staff', { students: 0, staff: 0 }, { maxStudents: null, maxStaff: null }).allowed).toBe(true);
  });

  it('reads unlimited as empty on a usage meter, not as full', () => {
    expect(seatUtilisation(50, null)).toBe(0);
    expect(seatUtilisation(50, 100)).toBe(50);
    expect(seatUtilisation(150, 100)).toBe(100);
  });
});

describe('subscription status → school status', () => {
  const now = new Date('2026-03-15T12:00:00Z');
  const future = new Date('2026-04-01T00:00:00Z');
  const past = new Date('2026-03-01T00:00:00Z');

  it('keeps a live trial on TRIAL', () => {
    expect(schoolStatusFor('TRIALING', future, now)).toBe('TRIAL');
  });

  it('does NOT lock a school out when its trial lapses', () => {
    // Locking a school out of its own records the morning a trial ends is how
    // a vendor loses a customer it had already won. Chasing the invoice is a
    // commercial problem, not a technical one.
    expect(schoolStatusFor('TRIALING', past, now)).toBe('ACTIVE');
  });

  it('does NOT lock a school out for being past due', () => {
    expect(schoolStatusFor('PAST_DUE', null, now)).toBe('ACTIVE');
  });

  it('suspends only on an actual cancellation', () => {
    expect(schoolStatusFor('CANCELLED', null, now)).toBe('SUSPENDED');
  });

  it('counts trial days remaining, never negative', () => {
    expect(trialDaysRemaining(future, now)).toBe(17);
    expect(trialDaysRemaining(past, now)).toBe(0);
    expect(trialDaysRemaining(null, now)).toBeNull();
  });
});
