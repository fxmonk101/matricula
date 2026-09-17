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
  /** Unpaid break minutes already deducted, materialised on close. */
  breakMinutes?: number | null;
  /** Gross minus unpaid breaks, materialised on close. */
  netMinutes?: number | null;
}

export interface TimesheetTotals {
  days: number;
  /** GROSS: from sign-in to sign-out, breaks included. */
  minutes: number;
  /** Unpaid break time, deducted below. */
  breakMinutes: number;
  /** What was actually worked. This is the number a payroll run wants. */
  netMinutes: number;
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
  let breakMinutes = 0;
  let net = 0;
  let assumedMinutes = 0;
  let openSessions = 0;

  for (const session of sessions) {
    days.add(session.localDate);
    if (session.status === 'OPEN') {
      openSessions += 1;
      continue;
    }
    const duration = session.durationMinutes ?? 0;
    const deducted = session.breakMinutes ?? 0;
    minutes += duration;
    breakMinutes += deducted;
    /*
     * Fall back to gross rather than to zero when a row predates breaks
     * entirely. `netMinutes` is null on every session recorded before this
     * existed, and treating null as "worked nothing" would silently empty out
     * a term of timesheets the day the column arrived.
     */
    net += session.netMinutes ?? Math.max(0, duration - deducted);
    if (session.status === 'AUTO_CLOSED') assumedMinutes += duration;
  }

  return {
    days: days.size,
    minutes,
    breakMinutes,
    netMinutes: net,
    assumedMinutes,
    openSessions,
  };
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

// -----------------------------------------------------------------------------
// Breaks
// -----------------------------------------------------------------------------

/**
 * A break is an interval INSIDE a session that may not count as time worked.
 *
 * Modelled as its own rows rather than as a running total on the session, for
 * the same reason the session is an interval and not an event log: a total can
 * only be corrected by somebody who already knows what it was made of, and by
 * the time a payroll query arrives nobody does.
 *
 * PRAYER is here because this is built for West African institutions, where a
 * midday prayer break is a normal part of the working day. Filing it under
 * "other" would make it invisible in exactly the report that needs to see it.
 */
export const BREAK_KINDS = ['SHORT', 'LUNCH', 'PRAYER', 'OTHER'] as const;
export type BreakKind = (typeof BREAK_KINDS)[number];

export const BREAK_LABELS: Record<BreakKind, string> = {
  SHORT: 'Short break',
  LUNCH: 'Lunch break',
  PRAYER: 'Prayer break',
  OTHER: 'Other break',
};

/**
 * Whether a kind of break counts as time worked, BY DEFAULT.
 *
 * A default, not a rule: the value is copied onto the break row when the break
 * is taken, so changing this never rewrites a timesheet somebody has already
 * been paid against. The same denormalisation discipline the rest of this
 * codebase uses — the policy is the source of truth for new rows only.
 */
export const BREAK_IS_PAID: Record<BreakKind, boolean> = {
  // A ten-minute breather is part of the working day in every institution.
  SHORT: true,
  // Lunch is the one almost everybody deducts.
  LUNCH: false,
  PRAYER: true,
  OTHER: false,
};

/** What the buttons offer, so nobody types a duration to take a breather. */
export const BREAK_TYPICAL_MINUTES: Record<BreakKind, number> = {
  SHORT: 15,
  LUNCH: 45,
  PRAYER: 20,
  OTHER: 30,
};

/**
 * The longest a break may run before it stops being a break.
 *
 * A four-hour "lunch" is a person who went home, and recording it as a break
 * inside one session both inflates the shift and hides the departure.
 */
export const MAX_BREAK_MINUTES = 4 * 60;

export function isBreakKind(value: string): value is BreakKind {
  return (BREAK_KINDS as readonly string[]).includes(value);
}

export interface BreakRow {
  kind: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
  paid: boolean;
}

/**
 * May a break start now, given the session and the breaks already on it?
 *
 * The one-open-break test is the one that matters. Two open breaks would each
 * deduct the same wall-clock minutes, so a person would be credited with less
 * time than they actually worked — an error in the institution's favour, which
 * is no better than one in the other direction and much harder to notice.
 */
export function validateBreakStart(params: {
  kind: string;
  at: Date;
  sessionStartedAt: Date;
  sessionEndedAt?: Date | null;
  existing: readonly BreakRow[];
}): string[] {
  const problems: string[] = [];

  if (!isBreakKind(params.kind)) problems.push('Choose what kind of break this is.');

  if (params.at.getTime() < params.sessionStartedAt.getTime()) {
    problems.push('A break cannot start before the session it belongs to.');
  }
  if (params.sessionEndedAt && params.at.getTime() > params.sessionEndedAt.getTime()) {
    problems.push('That session has already ended.');
  }
  if (params.existing.some((b) => b.endedAt === null)) {
    problems.push('You are already on a break. End it before starting another.');
  }

  return problems;
}

export interface BreakCloseVerdict {
  allowed: boolean;
  reason?: string;
  minutes?: number;
}

export function evaluateBreakClose(open: BreakRow, now: Date): BreakCloseVerdict {
  if (now.getTime() < open.startedAt.getTime()) {
    return {
      allowed: false,
      reason: 'That would end the break before it started. Check the device clock.',
    };
  }

  const minutes = minutesBetween(open.startedAt, now);
  if (minutes > MAX_BREAK_MINUTES) {
    return {
      allowed: false,
      minutes,
      reason: `This break has run for ${formatDuration(minutes)}, which is longer than a break. The office needs to record it.`,
    };
  }

  return { allowed: true, minutes };
}

/** Unpaid minutes across a set of breaks. An open break contributes nothing yet. */
export function unpaidBreakMinutes(breaks: readonly BreakRow[]): number {
  return breaks.reduce((sum, b) => (b.paid ? sum : sum + (b.minutes ?? 0)), 0);
}

/** Every break minute, paid or not — what the person actually spent away. */
export function totalBreakMinutes(breaks: readonly BreakRow[]): number {
  return breaks.reduce((sum, b) => sum + (b.minutes ?? 0), 0);
}

/**
 * Time worked, after unpaid breaks.
 *
 * Floored at zero. A session whose unpaid breaks exceed its own length is a
 * data error, and the honest answer is to show no time rather than negative
 * time — a negative shift silently subtracts from the rest of the week.
 */
export function netMinutes(grossMinutes: number, breaks: readonly BreakRow[]): number {
  return Math.max(0, grossMinutes - unpaidBreakMinutes(breaks));
}

// -----------------------------------------------------------------------------
// Signing the register
// -----------------------------------------------------------------------------

/**
 * A signature is stored as a PNG data URL drawn in the browser.
 *
 * Capped hard. An uncapped data URL is a file upload wearing a text field's
 * clothes: it arrives through a form action with none of the checks the upload
 * path applies, and it is read back on every timesheet page. 96 KB is generous
 * for a signature at the size the pad draws, and small enough that a term of
 * them does not bloat the table.
 */
export const MAX_SIGNATURE_BYTES = 96 * 1024;

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export function validateSignature(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  // A malformed value cannot come from the pad, which only ever emits a PNG
  // data URL — so it means the field was set by something other than the pad.
  // The message stays neutral rather than announcing what was detected.
  if (!PNG_DATA_URL.test(trimmed)) {
    return ['That signature did not arrive in a form this system can store.'];
  }
  if (trimmed.length > MAX_SIGNATURE_BYTES) return ['That signature is too large.'];
  return [];
}

/**
 * Compare an identifier the way a person would, not the way a string does.
 *
 * `GEU/CSC/2024/001`, `geu-csc-2024-001` and `GEU CSC 2024 001` are one
 * matriculation number to everybody who has ever read one aloud. Comparing raw
 * strings would turn a person away for typing their own number with the
 * punctuation the registry prints on their ID card.
 */
export function normaliseIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function identifierMatches(given: string, expected: string | null | undefined): boolean {
  if (!expected) return false;
  const a = normaliseIdentifier(given);
  return a.length > 0 && a === normaliseIdentifier(expected);
}

/**
 * How far back a person may declare their own arrival.
 *
 * Somebody who reached the gate at 07:50 and a terminal at 08:10 is telling the
 * truth, and a system that can only record 08:10 makes them lose twenty minutes
 * every working day. Somebody declaring an arrival eleven hours ago is not
 * remembering, they are reconstructing, and that belongs to the office with a
 * reason attached. Four hours covers the honest case and stops the other one.
 */
export const MAX_BACKDATE_MINUTES = 4 * 60;

export interface SignInAttestation {
  /** The matriculation or staff number, as typed. */
  identifierGiven: string;
  /** What the record says it should be. */
  expectedIdentifier: string | null;
  /** Department or faculty, as given. */
  unitGiven: string;
  /** The arrival time the person is declaring, or null to take the clock's. */
  declaredAt: Date | null;
  signature: string | null;
  now: Date;
  requireSignature: boolean;
}

export interface AttestationVerdict {
  problems: string[];
  /** The time that will actually be recorded. */
  effectiveAt: Date;
  /** True when the person typed the time rather than taking the clock's. */
  declared: boolean;
}

/**
 * Check a sign-in attestation, and settle what time it happened.
 *
 * The identifier is VERIFIED, not merely collected. Asking a signed-in person
 * to retype a number the system already holds would be pointless data entry;
 * checking it against the record is what makes it a control — it is the step
 * that catches somebody signing in on a colleague's unlocked session, which is
 * most of what a register exists to prevent.
 */
export function validateSignIn(att: SignInAttestation): AttestationVerdict {
  const problems: string[] = [];

  const given = att.identifierGiven.trim();
  if (!given) {
    problems.push('Enter your matriculation or staff number.');
  } else if (!att.expectedIdentifier) {
    // Not the person's fault, and not something retyping can fix.
    problems.push(
      'Your record carries no matriculation or staff number, so it cannot be checked. Ask the office to add one.',
    );
  } else if (!identifierMatches(given, att.expectedIdentifier)) {
    problems.push(
      'That number does not match this account. If you are signing in for somebody else, the office has to do it.',
    );
  }

  const unit = att.unitGiven.trim();
  if (!unit) problems.push('Enter your department or faculty.');
  else if (unit.length > 120) problems.push('That department or faculty name is too long.');

  let effectiveAt = att.now;
  let declared = false;

  if (att.declaredAt) {
    if (Number.isNaN(att.declaredAt.getTime())) {
      problems.push('That sign-in time could not be read.');
    } else {
      const delta = att.now.getTime() - att.declaredAt.getTime();
      // A minute of slack absorbs a device clock that runs slightly fast.
      if (delta < -60_000) {
        problems.push('You cannot sign in for a time that has not happened yet.');
      } else if (delta > MAX_BACKDATE_MINUTES * 60_000) {
        problems.push(
          `That is more than ${formatDuration(MAX_BACKDATE_MINUTES)} ago. A late sign-in is recorded by the office, with a reason.`,
        );
      } else {
        effectiveAt = att.declaredAt;
        declared = Math.abs(delta) > 60_000;
      }
    }
  }

  problems.push(...validateSignature(att.signature));
  if (att.requireSignature && !att.signature) problems.push('Sign in the box before signing in.');

  return { problems, effectiveAt, declared };
}

/** The same rules on the way out, minus the parts that only apply on arrival. */
export function validateSignOut(params: {
  declaredAt: Date | null;
  signature: string | null;
  startedAt: Date;
  now: Date;
  requireSignature: boolean;
}): AttestationVerdict {
  const problems: string[] = [];

  let effectiveAt = params.now;
  let declared = false;

  if (params.declaredAt) {
    if (Number.isNaN(params.declaredAt.getTime())) {
      problems.push('That sign-out time could not be read.');
    } else {
      const delta = params.now.getTime() - params.declaredAt.getTime();
      if (delta < -60_000) {
        problems.push('You cannot sign out for a time that has not happened yet.');
      } else if (delta > MAX_BACKDATE_MINUTES * 60_000) {
        problems.push(
          `That is more than ${formatDuration(MAX_BACKDATE_MINUTES)} ago. The office records that, with a reason.`,
        );
      } else if (params.declaredAt.getTime() < params.startedAt.getTime()) {
        problems.push('You cannot sign out for a time before you signed in.');
      } else {
        effectiveAt = params.declaredAt;
        declared = Math.abs(delta) > 60_000;
      }
    }
  }

  problems.push(...validateSignature(params.signature));
  if (params.requireSignature && !params.signature) {
    problems.push('Sign in the box before signing out.');
  }

  return { problems, effectiveAt, declared };
}
