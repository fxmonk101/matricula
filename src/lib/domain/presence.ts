/**
 * =============================================================================
 * PRESENCE AND THE TEACHING LOG
 * =============================================================================
 *
 * Who was in the building, and who taught what.
 *
 * Deliberately NOT called attendance. The pupil register is a different thing
 * with a different table, and if the two share a vocabulary somebody reads the
 * wrong one within a month.
 *
 * Everything here is pure: the clock arithmetic, the rounding, the rules about
 * what a person may correct. The times themselves arrive as instants and as a
 * school-local calendar day, both resolved by `./time` against the school's own
 * timezone — because "which day was this shift" has no answer that does not
 * name a place.
 */

export class PresenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresenceError';
  }
}

// -----------------------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------------------

export const PRESENCE_STATUSES = ['OPEN', 'CLOSED', 'AUTO_CLOSED'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export const PRESENCE_SOURCES = ['SELF', 'OFFICE'] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

export const PRESENCE_FIELDS = ['STARTED_AT', 'ENDED_AT', 'STATUS'] as const;
export type PresenceField = (typeof PRESENCE_FIELDS)[number];

export const TEACHING_STATUSES = ['DELIVERED', 'CANCELLED', 'MOVED'] as const;
export type TeachingStatus = (typeof TEACHING_STATUSES)[number];

export const TEACHING_LABELS: Record<TeachingStatus, string> = {
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  MOVED: 'Moved',
};

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  OPEN: 'Signed in',
  CLOSED: 'Signed out',
  // Named for what it is, not for what it looks like. A reader has to be able
  // to tell an assumption from a fact.
  AUTO_CLOSED: 'Closed automatically',
};

// -----------------------------------------------------------------------------
// Duration
// -----------------------------------------------------------------------------

/**
 * Whole minutes between two instants, never negative.
 *
 * Floored rather than rounded. A timesheet that rounds up gives everybody a
 * free half-minute per shift, which across a term of daily sign-ins is real
 * paid time nobody worked — and the institution cannot see where it went.
 */
export function minutesBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 60_000);
}

/** `7h 25m`, `45m`, `—`. What a timesheet column actually needs. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Decimal hours, for a payroll export that wants a number. */
export function toDecimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

// -----------------------------------------------------------------------------
// Opening and closing
// -----------------------------------------------------------------------------

/**
 * The longest a single session may run before it is treated as forgotten.
 *
 * Sixteen hours covers any real working day including a long shift and an
 * overrun, and is comfortably short of twenty-four — so a person who signed in
 * on Monday and never signed out does not accrue a second day on Tuesday.
 */
export const MAX_SESSION_MINUTES = 16 * 60;

export interface OpenSession {
  id: string;
  startedAt: Date;
  localDate: string;
}

export interface CloseVerdict {
  allowed: boolean;
  reason?: string;
  minutes?: number;
}

/**
 * May this open session be closed at `now`, and for how long did it run?
 *
 * The clock is not trusted blindly. A close before the start means the clock
 * moved — a laptop waking with a stale time, a server correcting itself — and
 * writing a negative shift is worse than refusing one.
 */
export function evaluateClose(session: OpenSession, now: Date): CloseVerdict {
  if (now.getTime() < session.startedAt.getTime()) {
    return {
      allowed: false,
      reason: 'That would end the session before it started. Check the device clock.',
    };
  }

  const minutes = minutesBetween(session.startedAt, now);

  if (minutes > MAX_SESSION_MINUTES) {
    return {
      allowed: false,
      minutes,
      reason: `This session has been open for ${formatDuration(minutes)}. It needs the office to close it with a recorded time.`,
    };
  }

  return { allowed: true, minutes };
}

/**
 * Where a forgotten session should be closed.
 *
 * At the CAP, not at the moment the sweep happens to run. A sweep running at
 * 02:00 would otherwise credit a person who signed in at 09:00 with seventeen
 * hours; capping it says "we do not know when they left" in the only way a
 * number can.
 */
export function autoCloseAt(startedAt: Date, cap = MAX_SESSION_MINUTES): Date {
  return new Date(startedAt.getTime() + cap * 60_000);
}

// -----------------------------------------------------------------------------
// Corrections
// -----------------------------------------------------------------------------

export const MIN_CORRECTION_REASON = 8;

/**
 * Validate an office override.
 *
 * The reason is mandatory and has a floor, because "fix" and "." are what get
 * typed when a field is merely required. Somebody reading this trail six months
 * later is trying to answer a payroll query, and a one-character reason answers
 * nothing.
 */
export function validateCorrection(params: {
  reason: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  now: Date;
}): string[] {
  const problems: string[] = [];

  const reason = params.reason.trim();
  if (reason.length < MIN_CORRECTION_REASON) {
    problems.push(
      `Give a reason of at least ${MIN_CORRECTION_REASON} characters — this is an audit trail, and it is read long after today.`,
    );
  }
  if (reason.length > 500) problems.push('That reason is too long.');

  if (params.startedAt && params.startedAt.getTime() > params.now.getTime()) {
    problems.push('A sign-in time cannot be in the future.');
  }
  if (params.endedAt && params.endedAt.getTime() > params.now.getTime()) {
    problems.push('A sign-out time cannot be in the future.');
  }
  if (
    params.startedAt &&
    params.endedAt &&
    params.endedAt.getTime() < params.startedAt.getTime()
  ) {
    problems.push('The sign-out time must be after the sign-in time.');
  }
  if (
    params.startedAt &&
    params.endedAt &&
    minutesBetween(params.startedAt, params.endedAt) > MAX_SESSION_MINUTES
  ) {
    problems.push(
      `That is longer than ${formatDuration(MAX_SESSION_MINUTES)}. Record it as separate sessions.`,
    );
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Timesheets
// -----------------------------------------------------------------------------

export interface SessionRow {
  localDate: string;
  durationMinutes: number | null;
  status: string;
}

export interface TimesheetTotals {
  days: number;
  minutes: number;
  /** Minutes contributed by sessions nobody actually closed. */
  assumedMinutes: number;
  openSessions: number;
}

/**
 * Total a set of sessions, keeping assumed time separate.
 *
 * An AUTO_CLOSED session's duration is a guess the system made. Folding it
 * silently into a total presented as hours worked would make the institution
 * pay, or discipline, on the strength of an assumption it cannot see. So it is
 * counted AND reported separately, and the caller decides what to do.
 */
export function summariseTimesheet(sessions: readonly SessionRow[]): TimesheetTotals {
  const days = new Set<string>();
  let minutes = 0;
  let assumedMinutes = 0;
  let openSessions = 0;

  for (const session of sessions) {
    days.add(session.localDate);
    if (session.status === 'OPEN') {
      openSessions += 1;
      continue;
    }
    const duration = session.durationMinutes ?? 0;
    minutes += duration;
    if (session.status === 'AUTO_CLOSED') assumedMinutes += duration;
  }

  return { days: days.size, minutes, assumedMinutes, openSessions };
}

// -----------------------------------------------------------------------------
// The teaching log
// -----------------------------------------------------------------------------

export interface TeachingDraft {
  localDate: string;
  startMinute: number;
  endMinute: number;
  status: string;
  topic?: string | null;
  attended?: number | null;
}

export function isTeachingStatus(value: string): value is TeachingStatus {
  return (TEACHING_STATUSES as readonly string[]).includes(value);
}

/** Every problem at once. */
export function validateTeachingLog(draft: TeachingDraft): string[] {
  const problems: string[] = [];

  if (!draft.localDate?.trim()) problems.push('Choose the date this was taught.');

  if (!Number.isInteger(draft.startMinute) || draft.startMinute < 0 || draft.startMinute > 1439) {
    problems.push('Enter a valid start time.');
  }
  if (!Number.isInteger(draft.endMinute) || draft.endMinute < 0 || draft.endMinute > 1440) {
    problems.push('Enter a valid end time.');
  }
  if (
    Number.isInteger(draft.startMinute) &&
    Number.isInteger(draft.endMinute) &&
    draft.endMinute <= draft.startMinute
  ) {
    problems.push('The class must end after it starts.');
  }

  const duration = draft.endMinute - draft.startMinute;
  if (duration > 8 * 60) {
    problems.push('That is longer than eight hours. Record it as separate sessions.');
  }

  if (!isTeachingStatus(draft.status)) problems.push('Choose whether it was delivered.');

  if (draft.topic && draft.topic.length > 200) problems.push('That topic is too long.');

  if (draft.attended !== null && draft.attended !== undefined) {
    if (!Number.isInteger(draft.attended) || draft.attended < 0) {
      problems.push('The headcount must be a whole number, or blank.');
    } else if (draft.attended > 2000) {
      problems.push('That headcount is implausibly large.');
    }
  }

  return problems;
}

export interface TeachingRow {
  status: string;
  durationMinutes: number;
  offeringId: string | null;
}

export interface TeachingTotals {
  delivered: number;
  cancelled: number;
  moved: number;
  minutesTaught: number;
  sections: number;
}

/**
 * Hours taught, with what did not run kept visible.
 *
 * "Three of your twelve Chemistry periods did not run" is the finding a head of
 * department is looking for, and it is invisible in a total that only sums what
 * was delivered.
 */
export function summariseTeaching(rows: readonly TeachingRow[]): TeachingTotals {
  let delivered = 0;
  let cancelled = 0;
  let moved = 0;
  let minutesTaught = 0;
  const sections = new Set<string>();

  for (const row of rows) {
    if (row.offeringId) sections.add(row.offeringId);
    if (row.status === 'CANCELLED') {
      cancelled += 1;
      continue;
    }
    if (row.status === 'MOVED') moved += 1;
    else delivered += 1;
    // A moved class was still taught, so its minutes count. A cancelled one
    // was not, and they do not.
    minutesTaught += row.durationMinutes;
  }

  return { delivered, cancelled, moved, minutesTaught, sections: sections.size };
}
