import { describe, expect, it } from 'vitest';

import {
  BREAK_IS_PAID,
  BREAK_KINDS,
  MAX_BACKDATE_MINUTES,
  MAX_BREAK_MINUTES,
  MAX_SIGNATURE_BYTES,
  evaluateBreakClose,
  identifierMatches,
  isBreakKind,
  netMinutes,
  normaliseIdentifier,
  summariseTimesheet,
  totalBreakMinutes,
  unpaidBreakMinutes,
  validateBreakStart,
  validateSignIn,
  validateSignOut,
  validateSignature,
  type BreakRow,
} from '@/lib/domain/presence';

/*
 * The register and the breaks inside it.
 *
 * Almost every test here is about a number that ends up on somebody's pay, so
 * the ones that matter most are the ones asserting that time is NOT credited:
 * a break that deducts twice, a shift that goes negative, an arrival somebody
 * invented three days later.
 */

const NOW = new Date('2026-09-16T10:00:00.000Z');

function brk(over: Partial<BreakRow> = {}): BreakRow {
  return {
    kind: 'LUNCH',
    startedAt: new Date('2026-09-16T12:00:00.000Z'),
    endedAt: new Date('2026-09-16T12:45:00.000Z'),
    minutes: 45,
    paid: false,
    ...over,
  };
}

// A one-pixel PNG, which is what the pad emits in miniature.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('identifiers', () => {
  it('reads a matriculation number the way a person does', () => {
    // The same number as printed on an ID card, typed by somebody who does not
    // remember which separator the registry used.
    expect(normaliseIdentifier('GEU/CSC/2024/001')).toBe('GEUCSC2024001');
    expect(identifierMatches('geu-csc-2024-001', 'GEU/CSC/2024/001')).toBe(true);
    expect(identifierMatches('GEU CSC 2024 001', 'GEU/CSC/2024/001')).toBe(true);
    expect(identifierMatches('  geu/csc/2024/001  ', 'GEU/CSC/2024/001')).toBe(true);
  });

  it('does not match a different number', () => {
    expect(identifierMatches('GEU/CSC/2024/002', 'GEU/CSC/2024/001')).toBe(false);
  });

  it('never matches when there is nothing to match against', () => {
    // Otherwise a person with no number on file would be waved through by an
    // empty comparison, which is the opposite of what a check is for.
    expect(identifierMatches('anything', null)).toBe(false);
    expect(identifierMatches('anything', '')).toBe(false);
    expect(identifierMatches('', null)).toBe(false);
  });

  it('does not treat two blanks as a match', () => {
    expect(identifierMatches('', '')).toBe(false);
    expect(identifierMatches('///', '---')).toBe(false);
  });
});

describe('signing in', () => {
  const base = {
    identifierGiven: 'GEU/CSC/2024/001',
    expectedIdentifier: 'GEU/CSC/2024/001',
    unitGiven: 'Computer Science',
    declaredAt: null,
    signature: PNG,
    now: NOW,
    requireSignature: true,
  };

  it('accepts a complete attestation and takes the clock', () => {
    const verdict = validateSignIn(base);
    expect(verdict.problems).toEqual([]);
    expect(verdict.effectiveAt).toEqual(NOW);
    expect(verdict.declared).toBe(false);
  });

  it('REFUSES a number that does not match the account', () => {
    // This is the whole point of asking for a number the system already holds:
    // it catches somebody signing in on a colleague's unlocked session.
    const verdict = validateSignIn({ ...base, identifierGiven: 'GEU/CSC/2024/999' });
    expect(verdict.problems.join(' ')).toMatch(/does not match this account/);
  });

  it('says so plainly when the record carries no number to check', () => {
    // Not the person's fault, and not fixable by retyping — so the message
    // points at the office instead of at the field.
    const verdict = validateSignIn({ ...base, expectedIdentifier: null });
    expect(verdict.problems.join(' ')).toMatch(/Ask the office/);
  });

  it('requires a department or faculty', () => {
    expect(validateSignIn({ ...base, unitGiven: '   ' }).problems.join(' ')).toMatch(
      /department or faculty/,
    );
  });

  it('accepts a declared arrival earlier than now, and marks it as declared', () => {
    // Somebody who reached the gate at 09:40 and a terminal at 10:00.
    const declaredAt = new Date('2026-09-16T09:40:00.000Z');
    const verdict = validateSignIn({ ...base, declaredAt });
    expect(verdict.problems).toEqual([]);
    expect(verdict.effectiveAt).toEqual(declaredAt);
    expect(verdict.declared).toBe(true);
  });

  it('does not mark a declared time that matches the clock', () => {
    // Submitting the prefilled value is not a declaration of anything, and
    // flagging it would make the marker meaningless by making it universal.
    const verdict = validateSignIn({
      ...base,
      declaredAt: new Date(NOW.getTime() - 20_000),
    });
    expect(verdict.declared).toBe(false);
  });

  it('refuses an arrival in the future', () => {
    const verdict = validateSignIn({
      ...base,
      declaredAt: new Date(NOW.getTime() + 60 * 60_000),
    });
    expect(verdict.problems.join(' ')).toMatch(/has not happened yet/);
  });

  it('tolerates a device clock that runs slightly fast', () => {
    // A phone thirty seconds ahead must not be told it is time-travelling.
    const verdict = validateSignIn({
      ...base,
      declaredAt: new Date(NOW.getTime() + 30_000),
    });
    expect(verdict.problems).toEqual([]);
  });

  it('sends a long-past arrival to the office instead of recording it', () => {
    const verdict = validateSignIn({
      ...base,
      declaredAt: new Date(NOW.getTime() - (MAX_BACKDATE_MINUTES + 30) * 60_000),
    });
    expect(verdict.problems.join(' ')).toMatch(/office/);
    // And it must NOT quietly record the clock's time instead — a refusal that
    // half-succeeds is worse than either outcome.
    expect(verdict.problems.length).toBeGreaterThan(0);
  });

  it('requires a signature when the school asks for one', () => {
    expect(
      validateSignIn({ ...base, signature: null }).problems.join(' '),
    ).toMatch(/Sign in the box/);
    expect(
      validateSignIn({ ...base, signature: null, requireSignature: false }).problems,
    ).toEqual([]);
  });

  it('reports every problem at once rather than one per submission', () => {
    const verdict = validateSignIn({
      ...base,
      identifierGiven: '',
      unitGiven: '',
      signature: null,
    });
    expect(verdict.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('signing out', () => {
  const startedAt = new Date('2026-09-16T08:00:00.000Z');
  const base = {
    declaredAt: null,
    signature: PNG,
    startedAt,
    now: NOW,
    requireSignature: true,
  };

  it('takes the clock when nothing is declared', () => {
    const verdict = validateSignOut(base);
    expect(verdict.problems).toEqual([]);
    expect(verdict.effectiveAt).toEqual(NOW);
  });

  it('refuses a departure before the arrival', () => {
    const verdict = validateSignOut({
      ...base,
      declaredAt: new Date('2026-09-16T07:30:00.000Z'),
    });
    expect(verdict.problems.join(' ')).toMatch(/before you signed in/);
  });

  it('refuses a departure in the future', () => {
    const verdict = validateSignOut({
      ...base,
      declaredAt: new Date(NOW.getTime() + 60 * 60_000),
    });
    expect(verdict.problems.join(' ')).toMatch(/has not happened yet/);
  });
});

describe('signatures', () => {
  it('accepts what the pad produces', () => {
    expect(validateSignature(PNG)).toEqual([]);
  });

  it('accepts an absent signature, leaving requiredness to the caller', () => {
    expect(validateSignature(null)).toEqual([]);
    expect(validateSignature('')).toEqual([]);
  });

  it('refuses anything that is not a PNG data URL', () => {
    // The pad only ever emits one shape, so another shape means the field was
    // set by something other than the pad.
    expect(validateSignature('https://example.com/sig.png').length).toBe(1);
    expect(validateSignature('data:text/html;base64,PHNjcmlwdD4=').length).toBe(1);
    expect(validateSignature('data:image/svg+xml;base64,PHN2Zz4=').length).toBe(1);
    expect(validateSignature('javascript:alert(1)').length).toBe(1);
  });

  it('refuses a signature that is really a file upload', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_SIGNATURE_BYTES);
    expect(validateSignature(huge).join(' ')).toMatch(/too large/);
  });
});

describe('breaks', () => {
  const sessionStartedAt = new Date('2026-09-16T08:00:00.000Z');

  it('knows its own kinds', () => {
    for (const kind of BREAK_KINDS) expect(isBreakKind(kind)).toBe(true);
    expect(isBreakKind('SIESTA')).toBe(false);
  });

  it('pays short and prayer breaks and deducts lunch', () => {
    expect(BREAK_IS_PAID.SHORT).toBe(true);
    expect(BREAK_IS_PAID.PRAYER).toBe(true);
    expect(BREAK_IS_PAID.LUNCH).toBe(false);
  });

  it('accepts a break inside an open session', () => {
    expect(
      validateBreakStart({
        kind: 'LUNCH',
        at: new Date('2026-09-16T12:00:00.000Z'),
        sessionStartedAt,
        existing: [],
      }),
    ).toEqual([]);
  });

  it('REFUSES a second open break', () => {
    /*
     * Two open breaks would each deduct the same wall-clock minutes when they
     * closed, so a person would be paid for less time than they worked. An
     * error in the institution's favour is no better than one the other way,
     * and much harder for anybody to notice.
     */
    const problems = validateBreakStart({
      kind: 'SHORT',
      at: new Date('2026-09-16T12:10:00.000Z'),
      sessionStartedAt,
      existing: [brk({ endedAt: null, minutes: null })],
    });
    expect(problems.join(' ')).toMatch(/already on a break/);
  });

  it('allows another break once the first has ended', () => {
    expect(
      validateBreakStart({
        kind: 'SHORT',
        at: new Date('2026-09-16T15:00:00.000Z'),
        sessionStartedAt,
        existing: [brk()],
      }),
    ).toEqual([]);
  });

  it('refuses a break before the session it belongs to', () => {
    expect(
      validateBreakStart({
        kind: 'SHORT',
        at: new Date('2026-09-16T07:00:00.000Z'),
        sessionStartedAt,
        existing: [],
      }).join(' '),
    ).toMatch(/cannot start before/);
  });

  it('refuses a kind it does not recognise', () => {
    expect(
      validateBreakStart({
        kind: 'HOLIDAY',
        at: new Date('2026-09-16T12:00:00.000Z'),
        sessionStartedAt,
        existing: [],
      }).join(' '),
    ).toMatch(/what kind of break/);
  });

  it('closes a break and reports its length', () => {
    const open = brk({ startedAt: new Date('2026-09-16T12:00:00.000Z'), endedAt: null, minutes: null });
    const verdict = evaluateBreakClose(open, new Date('2026-09-16T12:45:00.000Z'));
    expect(verdict.allowed).toBe(true);
    expect(verdict.minutes).toBe(45);
  });

  it('refuses to close a break before it started', () => {
    const open = brk({ startedAt: new Date('2026-09-16T12:00:00.000Z'), endedAt: null, minutes: null });
    const verdict = evaluateBreakClose(open, new Date('2026-09-16T11:00:00.000Z'));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/device clock/);
  });

  it('sends an implausibly long break to the office', () => {
    // A four-hour lunch is somebody who went home, and recording it as a break
    // inside one session both inflates the shift and hides the departure.
    const open = brk({ startedAt: new Date('2026-09-16T08:00:00.000Z'), endedAt: null, minutes: null });
    const verdict = evaluateBreakClose(
      open,
      new Date(open.startedAt.getTime() + (MAX_BREAK_MINUTES + 10) * 60_000),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/office/);
  });
});

describe('what the break time does to the total', () => {
  it('deducts only the unpaid breaks', () => {
    const breaks = [brk({ kind: 'LUNCH', minutes: 45, paid: false }), brk({ kind: 'SHORT', minutes: 15, paid: true })];
    expect(totalBreakMinutes(breaks)).toBe(60);
    expect(unpaidBreakMinutes(breaks)).toBe(45);
    // Eight hours on site, forty-five minutes of it at lunch.
    expect(netMinutes(480, breaks)).toBe(435);
  });

  it('counts an open break as nothing yet', () => {
    // Its length is not known until it ends, and guessing would be inventing.
    const breaks = [brk({ endedAt: null, minutes: null, paid: false })];
    expect(unpaidBreakMinutes(breaks)).toBe(0);
    expect(netMinutes(120, breaks)).toBe(120);
  });

  it('never returns a negative shift', () => {
    // A shift shorter than its own unpaid breaks is a data error, and negative
    // time would silently subtract from the rest of the week.
    expect(netMinutes(30, [brk({ minutes: 45, paid: false })])).toBe(0);
  });
});

describe('a timesheet with breaks in it', () => {
  it('reports gross, deducted and net separately', () => {
    const totals = summariseTimesheet([
      {
        localDate: '2026-09-16',
        durationMinutes: 480,
        breakMinutes: 45,
        netMinutes: 435,
        status: 'CLOSED',
      },
      {
        localDate: '2026-09-17',
        durationMinutes: 300,
        breakMinutes: 0,
        netMinutes: 300,
        status: 'CLOSED',
      },
    ]);
    expect(totals.days).toBe(2);
    expect(totals.minutes).toBe(780);
    expect(totals.breakMinutes).toBe(45);
    expect(totals.netMinutes).toBe(735);
  });

  it('does NOT empty out sessions recorded before breaks existed', () => {
    /*
     * Every row written before this feature has a null `netMinutes`. Reading
     * null as "worked nothing" would blank a term of timesheets on the day the
     * column arrived — so the fallback is gross, which is what those rows have
     * always meant.
     */
    const totals = summariseTimesheet([
      { localDate: '2026-01-10', durationMinutes: 420, status: 'CLOSED' },
    ]);
    expect(totals.netMinutes).toBe(420);
    expect(totals.breakMinutes).toBe(0);
  });

  it('still keeps assumed time visible alongside the net figure', () => {
    const totals = summariseTimesheet([
      {
        localDate: '2026-09-16',
        durationMinutes: 960,
        breakMinutes: 0,
        netMinutes: 960,
        status: 'AUTO_CLOSED',
      },
    ]);
    expect(totals.netMinutes).toBe(960);
    expect(totals.assumedMinutes).toBe(960);
  });

  it('counts an open session as open rather than as worked', () => {
    const totals = summariseTimesheet([
      { localDate: '2026-09-16', durationMinutes: null, status: 'OPEN' },
    ]);
    expect(totals.openSessions).toBe(1);
    expect(totals.netMinutes).toBe(0);
  });
});
