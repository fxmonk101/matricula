/**
 * =============================================================================
 * SCHOOL-LOCAL TIME
 * =============================================================================
 *
 * Pure. No Prisma, no ambient clock — every function that needs "now" takes it
 * as an argument.
 *
 * WHY THIS EXISTS
 * ---------------
 * `School.timezone` has been stored since the tenancy phase and consumed by
 * nothing. Every date in the product is currently rendered with `en-GB` and no
 * `timeZone` option, which formats in whatever zone the SERVER happens to run
 * in. On a single-tenant deployment that is merely sloppy. On a platform where
 * a Lagos school and an Accra school share a process it is wrong, and the
 * moment a register or a clock-in stamp is compared against a school day it is
 * wrong by hours.
 *
 * The register is the sharp end. `AttendanceRecord` is uniquely constrained per
 * pupil per day, so "which day is it?" has to mean the school's calendar day —
 * not the server's, and not UTC's. A school in Lagos taking the register at
 * 08:00 on Monday is on Monday even if the server in Virginia still says
 * Sunday.
 *
 * NO DEPENDENCY
 * -------------
 * `Intl.DateTimeFormat` already knows every IANA zone and every historical DST
 * rule, because it is backed by the same ICU data a date library would ship.
 * `formatToParts` gives the wall-clock reading in a named zone, and the offset
 * falls out of comparing that reading to the instant. That is the whole trick,
 * and it is why this file has no imports.
 */

export class TimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeError';
  }
}

/** A school's calendar day, `YYYY-MM-DD`. Never carries a time component. */
export type LocalDate = string;

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): value is LocalDate {
  if (!LOCAL_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject 31 February and friends by round-tripping through UTC.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Validate an IANA zone name, falling back rather than throwing.
 *
 * A school row could carry a zone that a future ICU build has retired, and a
 * bad string in one school's settings must not take down its pages. The
 * fallback is UTC and it is deliberately loud in the return value so a caller
 * can surface "your timezone setting is not recognised" rather than silently
 * showing wrong times.
 */
export function resolveZone(timeZone: string | null | undefined): {
  zone: string;
  valid: boolean;
} {
  const candidate = (timeZone ?? '').trim();
  if (candidate === '') return { zone: 'UTC', valid: false };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return { zone: candidate, valid: true };
  } catch {
    return { zone: 'UTC', valid: false };
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Memoised formatters.
 *
 * Constructing an `Intl.DateTimeFormat` is genuinely expensive — it resolves
 * locale and zone data on every call — and a register page formats one per
 * pupil per row. The cache is keyed on the zone and bounded by the number of
 * schools in the process, which is small.
 */
const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = partFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(zone, fmt);
  }
  return fmt;
}

/** The wall-clock reading of `instant` in `zone`. */
function zonedParts(instant: Date, zone: string): ZonedParts {
  const parts = partsFormatter(zone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // `hourCycle: 'h23'` should give 0-23, but some engines have historically
    // emitted 24 for midnight. Normalising costs nothing and the alternative
    // is an off-by-one-day bug that only appears at midnight.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The zone's offset from UTC, in minutes, AT THIS INSTANT.
 *
 * Positive east of Greenwich. Computed rather than looked up: read the wall
 * clock in the zone, re-interpret that reading as if it were UTC, and the
 * difference from the real instant is the offset. This is correct across DST
 * transitions because it asks the question at a specific moment rather than
 * assuming a zone has one fixed offset.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const { zone } = resolveZone(timeZone);
  const p = zonedParts(instant, zone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard the instant's own milliseconds; they are not part of the offset.
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/**
 * The school's calendar day for an instant.
 *
 * This is the function that makes the register's uniqueness constraint mean
 * what it says. A string result cannot carry a stray time component, so it
 * cannot silently defeat a unique index the way a `DateTime` can.
 */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  const { zone } = resolveZone(timeZone);
  const p = zonedParts(instant, zone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes since local midnight — the same unit `Meeting` stores. */
export function toMinuteOfDay(instant: Date, timeZone: string): number {
  const { zone } = resolveZone(timeZone);
  const p = zonedParts(instant, zone);
  return p.hour * 60 + p.minute;
}

/**
 * The UTC instant of a local date and minute-of-day.
 *
 * TWO PASSES, and the second one is not redundant. Converting local→UTC is
 * circular: the offset depends on the instant, and the instant is what we are
 * solving for. So: guess using the offset at the naive timestamp, then re-ask
 * for the offset at that guess and correct. A single pass is wrong for roughly
 * one hour twice a year — precisely the mornings when a school in a
 * DST-observing zone takes the register an hour out.
 *
 * On a nonexistent local time (the hour a spring-forward skips) the result
 * lands on the instant the clock jumped to, which is the only defensible
 * answer. On an ambiguous one (the repeated autumn hour) it resolves to the
 * first occurrence.
 */
export function fromLocal(
  localDate: LocalDate,
  minuteOfDay: number,
  timeZone: string,
): Date {
  if (!isLocalDate(localDate)) {
    throw new TimeError(`Not a calendar date: ${localDate}`);
  }
  if (!Number.isFinite(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 24 * 60) {
    throw new TimeError(`Minute of day out of range: ${minuteOfDay}`);
  }

  const { zone } = resolveZone(timeZone);
  const [y, m, d] = localDate.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minuteOfDay * 60_000;

  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), zone) * 60_000);
  const corrected = new Date(naive - zoneOffsetMinutes(firstGuess, zone) * 60_000);
  return corrected;
}

/** Midnight, school-local, as a UTC instant. */
export function startOfLocalDay(localDate: LocalDate, timeZone: string): Date {
  return fromLocal(localDate, 0, timeZone);
}

/** The first instant of the NEXT local day — the exclusive end of a day range. */
export function endOfLocalDay(localDate: LocalDate, timeZone: string): Date {
  return new Date(startOfLocalDay(addLocalDays(localDate, 1), timeZone).getTime());
}

/** Calendar arithmetic on the date string, with no zone involved. */
export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  if (!isLocalDate(localDate)) throw new TimeError(`Not a calendar date: ${localDate}`);
  const [y, m, d] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function localDaysBetween(a: LocalDate, b: LocalDate): number {
  const toUtc = (s: LocalDate) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * ISO weekday, 1 = Monday … 7 = Sunday — the convention `Meeting.dayOfWeek`
 * already uses. JavaScript's `getUTCDay()` is 0 = Sunday, which is the classic
 * off-by-one in timetable code.
 */
export function localDayOfWeek(localDate: LocalDate): number {
  if (!isLocalDate(localDate)) throw new TimeError(`Not a calendar date: ${localDate}`);
  const [y, m, d] = localDate.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function displayFormatter(
  zone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${zone}|${JSON.stringify(options)}`;
  let fmt = displayFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
    displayFormatters.set(key, fmt);
  }
  return fmt;
}

/**
 * Render an instant in the school's zone.
 *
 * Every existing formatter in the app hardcodes `en-GB` with no zone; this is
 * the replacement that actually answers "what time was that, for this school?"
 */
export function formatInZone(
  instant: Date | string | null | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
  locale = 'en-GB',
): string {
  if (!instant) return '—';
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return '—';
  const { zone } = resolveZone(timeZone);
  return displayFormatter(zone, locale, options).format(date);
}

/** A calendar date string rendered for reading, with no zone conversion. */
export function formatLocalDate(
  localDate: LocalDate,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
  locale = 'en-GB',
): string {
  if (!isLocalDate(localDate)) return '—';
  const [y, m, d] = localDate.split('-').map(Number);
  // Formatted in UTC deliberately: the string is already a calendar date, and
  // converting it through a zone is what would shift it by a day.
  return displayFormatter('UTC', locale, options).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `485` → `"08:05"`. Mirrors `formatMinutes` in `src/lib/utils.ts`. */
export function formatMinuteOfDay(minute: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `"1h 25m"`, for a timesheet or an hours-taught total. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
