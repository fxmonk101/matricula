import { describe, expect, it } from 'vitest';

import {
  MAX_SESSION_MINUTES,
  MIN_CORRECTION_REASON,
  autoCloseAt,
  evaluateClose,
  formatDuration,
  minutesBetween,
  summariseTeaching,
  summariseTimesheet,
  toDecimalHours,
  validateCorrection,
  validateTeachingLog,
} from '@/lib/domain/presence';
import { guardForPath } from '@/lib/auth/rbac';
import { ROLES, type Role } from '@/lib/domain/enums';

const at = (iso: string) => new Date(iso);

describe('duration', () => {
  it('floors rather than rounds', () => {
    /*
     * A timesheet that rounds up gives everybody a free half-minute per shift.
     * Across a term of daily sign-ins that is real paid time nobody worked, and
     * the institution cannot see where it went.
     */
    expect(minutesBetween(at('2026-09-16T08:00:00Z'), at('2026-09-16T08:00:59Z'))).toBe(0);
    expect(minutesBetween(at('2026-09-16T08:00:00Z'), at('2026-09-16T08:01:59Z'))).toBe(1);
  });

  it('never returns a negative', () => {
    // A clock that moved backwards must not produce negative worked time.
    expect(minutesBetween(at('2026-09-16T09:00:00Z'), at('2026-09-16T08:00:00Z'))).toBe(0);
  });

  it('formats for a timesheet column', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(445)).toBe('7h 25m');
    expect(formatDuration(null)).toBe('—');
  });

  it('converts to decimal hours for payroll', () => {
    expect(toDecimalHours(445)).toBe(7.42);
    expect(toDecimalHours(60)).toBe(1);
  });
});

describe('closing a session', () => {
  const session = { id: 's', startedAt: at('2026-09-16T08:00:00Z'), localDate: '2026-09-16' };

  it('allows an ordinary shift', () => {
    const verdict = evaluateClose(session, at('2026-09-16T16:30:00Z'));
    expect(verdict.allowed).toBe(true);
    expect(verdict.minutes).toBe(510);
  });

  it('refuses a close before the start', () => {
    // The clock moved — a laptop waking with a stale time, a server correcting
    // itself. Writing a negative shift is worse than refusing one.
    const verdict = evaluateClose(session, at('2026-09-16T07:00:00Z'));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/device clock/);
  });

  it('refuses a session left open past the cap', () => {
    const verdict = evaluateClose(session, at('2026-09-17T09:00:00Z'));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/office to close it/);
  });

  it('caps below a full day, so a forgotten session cannot accrue a second one', () => {
    expect(MAX_SESSION_MINUTES).toBeLessThan(24 * 60);
    expect(MAX_SESSION_MINUTES).toBeGreaterThanOrEqual(12 * 60);
  });

  it('auto-closes at the CAP, not when the sweep happens to run', () => {
    /*
     * A sweep running at 02:00 would otherwise credit somebody who signed in at
     * 09:00 with seventeen hours. Capping says "we do not know when they left"
     * in the only way a number can.
     */
    const closed = autoCloseAt(session.startedAt);
    expect(minutesBetween(session.startedAt, closed)).toBe(MAX_SESSION_MINUTES);
  });
});

describe('office corrections', () => {
  const now = at('2026-09-16T18:00:00Z');

  it('accepts a real correction', () => {
    expect(
      validateCorrection({
        reason: 'Forgot to sign out; confirmed with the department secretary.',
        startedAt: at('2026-09-16T08:00:00Z'),
        endedAt: at('2026-09-16T16:00:00Z'),
        now,
      }),
    ).toEqual([]);
  });

  it('refuses a reason nobody could act on', () => {
    // "fix" and "." are what get typed when a field is merely required. Someone
    // reading this six months later is answering a payroll query.
    expect(validateCorrection({ reason: 'fix', now }).join(' ')).toMatch(/audit trail/);
    expect(validateCorrection({ reason: '.', now }).join(' ')).toMatch(/at least/);
    expect(MIN_CORRECTION_REASON).toBeGreaterThan(1);
  });

  it('refuses times in the future', () => {
    expect(
      validateCorrection({
        reason: 'A perfectly good reason here.',
        endedAt: at('2026-09-17T09:00:00Z'),
        now,
      }).join(' '),
    ).toMatch(/cannot be in the future/);
  });

  it('refuses a sign-out before its sign-in', () => {
    expect(
      validateCorrection({
        reason: 'A perfectly good reason here.',
        startedAt: at('2026-09-16T16:00:00Z'),
        endedAt: at('2026-09-16T08:00:00Z'),
        now,
      }).join(' '),
    ).toMatch(/after the sign-in/);
  });

  it('refuses a corrected span longer than the cap', () => {
    expect(
      validateCorrection({
        reason: 'A perfectly good reason here.',
        startedAt: at('2026-09-15T08:00:00Z'),
        endedAt: at('2026-09-16T08:00:00Z'),
        now: at('2026-09-16T18:00:00Z'),
      }).join(' '),
    ).toMatch(/separate sessions/);
  });
});

describe('timesheet totals', () => {
  it('keeps assumed time separate from recorded time', () => {
    /*
     * The decisive case. An AUTO_CLOSED duration is a guess the system made.
     * Folding it silently into a figure presented as hours worked would make an
     * institution pay, or discipline, on an assumption it cannot see.
     */
    const totals = summariseTimesheet([
      { localDate: '2026-09-14', durationMinutes: 480, status: 'CLOSED' },
      { localDate: '2026-09-15', durationMinutes: 960, status: 'AUTO_CLOSED' },
    ]);
    expect(totals.minutes).toBe(1440);
    expect(totals.assumedMinutes).toBe(960);
    expect(totals.days).toBe(2);
  });

  it('does not count an open session as worked time', () => {
    // It has no end, so any figure would be invented.
    const totals = summariseTimesheet([
      { localDate: '2026-09-16', durationMinutes: null, status: 'OPEN' },
    ]);
    expect(totals.minutes).toBe(0);
    expect(totals.openSessions).toBe(1);
    expect(totals.days).toBe(1);
  });

  it('counts a day once however many sessions it holds', () => {
    const totals = summariseTimesheet([
      { localDate: '2026-09-16', durationMinutes: 120, status: 'CLOSED' },
      { localDate: '2026-09-16', durationMinutes: 180, status: 'CLOSED' },
    ]);
    expect(totals.days).toBe(1);
    expect(totals.minutes).toBe(300);
  });

  it('totals nothing from nothing', () => {
    expect(summariseTimesheet([])).toEqual({
      days: 0,
      minutes: 0,
      breakMinutes: 0,
      netMinutes: 0,
      assumedMinutes: 0,
      openSessions: 0,
    });
  });
});

describe('the teaching log', () => {
  const good = {
    localDate: '2026-09-16',
    startMinute: 8 * 60,
    endMinute: 10 * 60,
    status: 'DELIVERED',
  };

  it('accepts a well-formed entry', () => {
    expect(validateTeachingLog(good)).toEqual([]);
  });

  it('refuses a class that ends before it starts', () => {
    expect(
      validateTeachingLog({ ...good, endMinute: 7 * 60 }).join(' '),
    ).toMatch(/end after it starts/);
  });

  it('refuses an implausibly long class', () => {
    expect(
      validateTeachingLog({ ...good, endMinute: 23 * 60 }).join(' '),
    ).toMatch(/separate sessions/);
  });

  it('requires a date and a real outcome', () => {
    expect(validateTeachingLog({ ...good, localDate: '' }).join(' ')).toMatch(/Choose the date/);
    expect(validateTeachingLog({ ...good, status: 'MAYBE' }).join(' ')).toMatch(/delivered/);
  });

  it('treats a headcount as optional but sane', () => {
    expect(validateTeachingLog({ ...good, attended: null })).toEqual([]);
    expect(validateTeachingLog({ ...good, attended: 42 })).toEqual([]);
    expect(validateTeachingLog({ ...good, attended: -1 }).join(' ')).toMatch(/whole number/);
    expect(validateTeachingLog({ ...good, attended: 99999 }).join(' ')).toMatch(/implausibly/);
  });
});

describe('hours taught', () => {
  it('counts a moved class but not a cancelled one', () => {
    // A moved class was still taught. A cancelled one was not.
    const totals = summariseTeaching([
      { status: 'DELIVERED', durationMinutes: 120, offeringId: 'a' },
      { status: 'MOVED', durationMinutes: 60, offeringId: 'a' },
      { status: 'CANCELLED', durationMinutes: 120, offeringId: 'b' },
    ]);
    expect(totals.minutesTaught).toBe(180);
    expect(totals.delivered).toBe(1);
    expect(totals.moved).toBe(1);
    expect(totals.cancelled).toBe(1);
  });

  it('keeps what did not run visible', () => {
    /*
     * "Three of your twelve Chemistry periods did not run" is the finding a
     * head of department needs, and it is invisible in a total that only sums
     * what was delivered.
     */
    const totals = summariseTeaching(
      Array.from({ length: 3 }, () => ({
        status: 'CANCELLED',
        durationMinutes: 120,
        offeringId: 'chem',
      })),
    );
    expect(totals.cancelled).toBe(3);
    expect(totals.minutesTaught).toBe(0);
  });

  it('counts distinct sections, not entries', () => {
    const totals = summariseTeaching([
      { status: 'DELIVERED', durationMinutes: 60, offeringId: 'a' },
      { status: 'DELIVERED', durationMinutes: 60, offeringId: 'a' },
      { status: 'DELIVERED', durationMinutes: 60, offeringId: 'b' },
    ]);
    expect(totals.sections).toBe(2);
  });

  it('copes with teaching that belongs to no section', () => {
    // A seminar or an induction is teaching without a timetabled section.
    const totals = summariseTeaching([
      { status: 'DELIVERED', durationMinutes: 90, offeringId: null },
    ]);
    expect(totals.minutesTaught).toBe(90);
    expect(totals.sections).toBe(0);
  });
});

describe('who can reach it', () => {
  it('lets every member sign themselves in', () => {
    // Being present in a building is not a privilege a role grants.
    const guard = guardForPath('/presence');
    for (const role of [
      'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE',
      'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT',
    ] as Role[]) {
      expect(guard?.roles.includes(role), role).toBe(true);
    }
  });

  it('keeps guardians and applicants out', () => {
    // Neither is ever in the building as a member of it.
    const guard = guardForPath('/presence');
    expect(guard?.roles.includes('GUARDIAN')).toBe(false);
    expect(guard?.roles.includes('APPLICANT')).toBe(false);
  });

  it('limits the teaching log to people who teach', () => {
    const guard = guardForPath('/presence/teaching');
    expect(guard?.prefix).toBe('/presence/teaching');
    expect(guard?.roles.includes('STUDENT')).toBe(false);
    expect(guard?.roles.includes('LIBRARIAN')).toBe(false);
    expect(guard?.roles.includes('INSTRUCTOR')).toBe(true);
    // A head of department lectures too.
    expect(guard?.roles.includes('HOD')).toBe(true);
  });

  it('resolves the longer prefix, so the teaching guard is not bypassed', () => {
    expect(guardForPath('/presence')?.prefix).toBe('/presence');
    expect(guardForPath('/presence/teaching')?.prefix).toBe('/presence/teaching');
  });

  it('names only roles that exist', () => {
    for (const path of ['/presence', '/presence/teaching']) {
      for (const role of guardForPath(path)?.roles ?? []) {
        expect(ROLES.includes(role), `${path}: ${role}`).toBe(true);
      }
    }
  });
});
