import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  endOfLocalDay,
  formatDuration,
  formatInZone,
  formatLocalDate,
  formatMinuteOfDay,
  fromLocal,
  isLocalDate,
  localDayOfWeek,
  localDaysBetween,
  resolveZone,
  startOfLocalDay,
  TimeError,
  toLocalDate,
  toMinuteOfDay,
  zoneOffsetMinutes,
} from '@/lib/domain/time';

const LAGOS = 'Africa/Lagos'; // UTC+1, no DST — the platform's default
const ACCRA = 'Africa/Accra'; // UTC+0, no DST — the second seeded school
const LONDON = 'Europe/London'; // UTC+0/+1, DST — the interesting one
const CHATHAM = 'Pacific/Chatham'; // UTC+12:45 — a non-whole-hour offset

describe('calendar date strings', () => {
  it('accepts a real date', () => {
    expect(isLocalDate('2026-03-15')).toBe(true);
  });

  it('rejects anything carrying a time', () => {
    // This is the whole point of the type: a string cannot smuggle a time
    // component past the register's uniqueness constraint.
    expect(isLocalDate('2026-03-15T08:00:00Z')).toBe(false);
    expect(isLocalDate('2026-03-15 08:00')).toBe(false);
  });

  it('rejects malformed and impossible dates', () => {
    expect(isLocalDate('2026-3-5')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-02-31')).toBe(false);
    expect(isLocalDate('')).toBe(false);
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
  });
});

describe('zone resolution', () => {
  it('accepts a real IANA zone', () => {
    expect(resolveZone(LAGOS)).toEqual({ zone: LAGOS, valid: true });
  });

  it('falls back to UTC rather than throwing on a bad zone', () => {
    // A stale zone in one school's settings must not take its pages down.
    expect(resolveZone('Mars/Olympus_Mons')).toEqual({ zone: 'UTC', valid: false });
    expect(resolveZone('')).toEqual({ zone: 'UTC', valid: false });
    expect(resolveZone(null)).toEqual({ zone: 'UTC', valid: false });
  });

  it('reports the fallback rather than hiding it', () => {
    // So a settings page can say "we did not recognise that zone" instead of
    // silently showing every time in UTC.
    expect(resolveZone('nonsense').valid).toBe(false);
  });
});

describe('zone offsets', () => {
  it('computes a whole-hour offset', () => {
    expect(zoneOffsetMinutes(new Date('2026-06-15T12:00:00Z'), LAGOS)).toBe(60);
    expect(zoneOffsetMinutes(new Date('2026-06-15T12:00:00Z'), ACCRA)).toBe(0);
  });

  it('computes a non-whole-hour offset', () => {
    // 12:45 in summer. A codebase that assumes whole hours breaks here.
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), CHATHAM)).toBe(825);
  });

  it('changes across a DST boundary', () => {
    // London: GMT in January, BST in June. Asking at an instant rather than
    // assuming one fixed offset per zone is what makes this correct.
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), LONDON)).toBe(0);
    expect(zoneOffsetMinutes(new Date('2026-06-15T12:00:00Z'), LONDON)).toBe(60);
  });
});

describe('instant → school calendar day', () => {
  it('gives the school its own day, not the server or UTC one', () => {
    // 23:30 UTC on the 14th is already 00:30 on the 15th in Lagos.
    const instant = new Date('2026-03-14T23:30:00Z');
    expect(toLocalDate(instant, LAGOS)).toBe('2026-03-15');
    expect(toLocalDate(instant, ACCRA)).toBe('2026-03-14');
  });

  it('handles the far side of the date line', () => {
    const instant = new Date('2026-03-14T12:00:00Z');
    expect(toLocalDate(instant, CHATHAM)).toBe('2026-03-15');
  });

  it('is stable at local midnight', () => {
    // Midnight in Lagos is 23:00 UTC the previous day. Getting this wrong is
    // an off-by-one-day on every register taken first thing in the morning.
    const midnight = new Date('2026-03-14T23:00:00Z');
    expect(toLocalDate(midnight, LAGOS)).toBe('2026-03-15');
    expect(toMinuteOfDay(midnight, LAGOS)).toBe(0);
  });
});

describe('instant → minute of day', () => {
  it('reads the wall clock in the school zone', () => {
    const instant = new Date('2026-03-15T07:30:00Z');
    expect(toMinuteOfDay(instant, LAGOS)).toBe(8 * 60 + 30);
    expect(toMinuteOfDay(instant, ACCRA)).toBe(7 * 60 + 30);
  });

  it('handles a 45-minute offset', () => {
    // January is summer in the southern hemisphere, so Chatham is on daylight
    // time: UTC+13:45, not its standard +12:45. Midnight UTC is 13:45 there.
    expect(toMinuteOfDay(new Date('2026-01-15T00:00:00Z'), CHATHAM)).toBe(13 * 60 + 45);
    // And in July it is back on standard time.
    expect(toMinuteOfDay(new Date('2026-07-15T00:00:00Z'), CHATHAM)).toBe(12 * 60 + 45);
  });
});

describe('local → instant', () => {
  it('round-trips through the zone', () => {
    const instant = fromLocal('2026-03-15', 8 * 60, LAGOS);
    expect(instant.toISOString()).toBe('2026-03-15T07:00:00.000Z');
    expect(toLocalDate(instant, LAGOS)).toBe('2026-03-15');
    expect(toMinuteOfDay(instant, LAGOS)).toBe(8 * 60);
  });

  it('round-trips at every hour, in a DST zone, across a transition', () => {
    // The two-pass correction exists for exactly this. A single pass is wrong
    // for about an hour, twice a year — the mornings a school would take the
    // register an hour out.
    for (const day of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26']) {
      for (const hour of [0, 6, 9, 12, 15, 23]) {
        const instant = fromLocal(day, hour * 60, LONDON);
        // Spring-forward skips 01:00-02:00, so a nonexistent time legitimately
        // lands elsewhere; every other reading must round-trip exactly.
        if (day === '2026-03-29' && hour === 1) continue;
        expect(toLocalDate(instant, LONDON), `${day} ${hour}:00`).toBe(day);
        expect(toMinuteOfDay(instant, LONDON), `${day} ${hour}:00`).toBe(hour * 60);
      }
    }
  });

  it('round-trips in a non-whole-hour zone', () => {
    const instant = fromLocal('2026-03-15', 9 * 60 + 30, CHATHAM);
    expect(toLocalDate(instant, CHATHAM)).toBe('2026-03-15');
    expect(toMinuteOfDay(instant, CHATHAM)).toBe(9 * 60 + 30);
  });

  it('refuses a date with a time component', () => {
    expect(() => fromLocal('2026-03-15T08:00:00Z', 0, LAGOS)).toThrow(TimeError);
  });

  it('refuses a minute outside the day', () => {
    expect(() => fromLocal('2026-03-15', -1, LAGOS)).toThrow(TimeError);
    expect(() => fromLocal('2026-03-15', 1441, LAGOS)).toThrow(TimeError);
  });
});

describe('day boundaries', () => {
  it('starts a day at local midnight', () => {
    expect(startOfLocalDay('2026-03-15', LAGOS).toISOString()).toBe('2026-03-14T23:00:00.000Z');
  });

  it('ends a day at the start of the next one, exclusive', () => {
    // Half-open, so a query for one day cannot double-count the boundary
    // instant into two days.
    const start = startOfLocalDay('2026-03-15', LAGOS);
    const end = endOfLocalDay('2026-03-15', LAGOS);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(toLocalDate(end, LAGOS)).toBe('2026-03-16');
  });

  it('gives a 23-hour day when the clocks go forward', () => {
    const start = startOfLocalDay('2026-03-29', LONDON);
    const end = endOfLocalDay('2026-03-29', LONDON);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('gives a 25-hour day when the clocks go back', () => {
    const start = startOfLocalDay('2026-10-25', LONDON);
    const end = endOfLocalDay('2026-10-25', LONDON);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
});

describe('calendar arithmetic', () => {
  it('adds and subtracts days', () => {
    expect(addLocalDays('2026-03-15', 1)).toBe('2026-03-16');
    expect(addLocalDays('2026-03-15', -1)).toBe('2026-03-14');
  });

  it('crosses month and year boundaries', () => {
    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('crosses a leap day', () => {
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('is unaffected by DST, because it never touches a zone', () => {
    // The bug this avoids: adding 24 hours to an instant across a spring
    // transition lands on the same calendar day, not the next one.
    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addLocalDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('counts days between dates', () => {
    expect(localDaysBetween('2026-03-15', '2026-03-20')).toBe(5);
    expect(localDaysBetween('2026-03-20', '2026-03-15')).toBe(-5);
    expect(localDaysBetween('2026-03-15', '2026-03-15')).toBe(0);
  });

  it('counts across a DST boundary without losing a day', () => {
    expect(localDaysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(localDaysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('ISO weekday', () => {
  it('numbers Monday 1 through Sunday 7, matching Meeting.dayOfWeek', () => {
    // JavaScript's getUTCDay() is 0 = Sunday; using it directly is the classic
    // off-by-one in timetable code.
    expect(localDayOfWeek('2026-03-16')).toBe(1); // Monday
    expect(localDayOfWeek('2026-03-20')).toBe(5); // Friday
    expect(localDayOfWeek('2026-03-21')).toBe(6); // Saturday
    expect(localDayOfWeek('2026-03-22')).toBe(7); // Sunday, not 0
  });
});

describe('display', () => {
  it('formats an instant in the school zone', () => {
    // 23:30 UTC is the next day in Lagos, and the rendering must say so.
    const instant = new Date('2026-03-14T23:30:00Z');
    expect(formatInZone(instant, LAGOS)).toBe('15 Mar 2026');
    expect(formatInZone(instant, ACCRA)).toBe('14 Mar 2026');
  });

  it('renders an em dash for a missing or invalid instant', () => {
    expect(formatInZone(null, LAGOS)).toBe('—');
    expect(formatInZone(undefined, LAGOS)).toBe('—');
    expect(formatInZone('not a date', LAGOS)).toBe('—');
  });

  it('formats a calendar date without shifting it', () => {
    // A calendar date has no zone; converting one through a zone is exactly
    // what would move it by a day.
    expect(formatLocalDate('2026-03-15')).toBe('15 Mar 2026');
    expect(formatLocalDate('2026-01-01')).toBe('01 Jan 2026');
  });

  it('formats minutes of day', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
    expect(formatMinuteOfDay(485)).toBe('08:05');
    expect(formatMinuteOfDay(1439)).toBe('23:59');
  });

  it('formats durations for a timesheet', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(85)).toBe('1h 25m');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('the register bug this module exists to prevent', () => {
  it('gives one identical key however many times the register is taken', () => {
    // The defect: AttendanceRecord.date is a DateTime under a daily unique
    // constraint, so two registers taken at different clock times on the same
    // day were two distinct rows, and the report card double-counted them.
    const morning = new Date('2026-03-15T08:15:00Z');
    const afternoon = new Date('2026-03-15T14:42:31Z');
    const evening = new Date('2026-03-15T21:05:09Z');

    const keys = new Set([morning, afternoon, evening].map((d) => toLocalDate(d, LAGOS)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('2026-03-15');
  });

  it('still separates genuinely different school days', () => {
    const monday = new Date('2026-03-16T08:00:00Z');
    const tuesday = new Date('2026-03-17T08:00:00Z');
    expect(toLocalDate(monday, LAGOS)).not.toBe(toLocalDate(tuesday, LAGOS));
  });
});
