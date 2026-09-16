/**
 * =============================================================================
 * ACADEMIC TERMS
 * =============================================================================
 *
 * Pure rules for the academic calendar.
 *
 * A term is the spine everything else hangs a date off: sections are timetabled
 * in one, students register within one, marks belong to one, and an invoice is
 * raised for one. So the dates are not decoration — a registration window that
 * closes before it opens makes registration impossible, and a term whose
 * add/drop deadline falls after its own end date makes the withdrawal rules
 * unenforceable. Both are refused here rather than discovered in week three.
 */

export class TermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TermError';
  }
}

export const SEASONS = ['FALL', 'SPRING', 'SUMMER'] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABELS: Record<Season, string> = {
  FALL: 'First semester',
  SPRING: 'Second semester',
  SUMMER: 'Summer session',
};

export function isSeason(value: string): value is Season {
  return (SEASONS as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Codes and years
// -----------------------------------------------------------------------------

/** `2025-FALL`. Sorts chronologically as a string, which is why the year leads. */
export function buildTermCode(academicYear: string, season: Season): string {
  const startYear = academicYear.split('/')[0]?.trim() ?? academicYear.trim();
  return `${startYear}-${season}`;
}

/** `2025/2026`. The form every West African university prints on a transcript. */
const ACADEMIC_YEAR = /^(\d{4})\/(\d{4})$/;

export function isValidAcademicYear(value: string): boolean {
  const match = ACADEMIC_YEAR.exec(value.trim());
  if (!match) return false;
  const [, from, to] = match;
  // Consecutive years only. "2025/2027" is a typo, and it would put every
  // transcript line in a session that does not exist.
  return Number(to) === Number(from) + 1;
}

export function academicYearRejectionReason(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter an academic year.';
  if (!ACADEMIC_YEAR.test(trimmed)) return 'Write the session as 2025/2026.';
  if (!isValidAcademicYear(trimmed)) return 'The second year must follow the first, as in 2025/2026.';
  return null;
}

/** The session a date falls in, assuming an academic year starting in September. */
export function academicYearFor(date: Date, startMonth = 8): string {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= startMonth ? year : year - 1;
  return `${start}/${start + 1}`;
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

export interface TermDates {
  startDate: string;
  endDate: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  addDropDeadline: string;
  withdrawalDeadline: string;
}

function parse(value: string): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Validate the six dates against each other, returning every problem.
 *
 * The ordering constraints are stated as the sentences a registrar would use,
 * because "invalid date range" tells them nothing about which of six fields to
 * change.
 */
export function validateTermDates(dates: TermDates): string[] {
  const problems: string[] = [];

  const start = parse(dates.startDate);
  const end = parse(dates.endDate);
  const opens = parse(dates.registrationOpensAt);
  const closes = parse(dates.registrationClosesAt);
  const addDrop = parse(dates.addDropDeadline);
  const withdrawal = parse(dates.withdrawalDeadline);

  const required: [Date | null, string][] = [
    [start, 'a start date'],
    [end, 'an end date'],
    [opens, 'a date registration opens'],
    [closes, 'a date registration closes'],
    [addDrop, 'an add/drop deadline'],
    [withdrawal, 'a withdrawal deadline'],
  ];
  for (const [value, label] of required) {
    if (!value) problems.push(`Enter ${label}.`);
  }
  if (problems.length > 0) return problems;

  if (end!.getTime() <= start!.getTime()) {
    problems.push('The term must end after it starts.');
  }

  if (closes!.getTime() <= opens!.getTime()) {
    // The failure that makes registration literally impossible.
    problems.push('Registration must close after it opens.');
  }

  if (opens!.getTime() > end!.getTime()) {
    problems.push('Registration cannot open after the term has ended.');
  }

  if (addDrop!.getTime() < start!.getTime()) {
    problems.push('The add/drop deadline cannot fall before the term starts.');
  }
  if (addDrop!.getTime() > end!.getTime()) {
    problems.push('The add/drop deadline cannot fall after the term ends.');
  }

  if (withdrawal!.getTime() < addDrop!.getTime()) {
    // A student may drop cleanly up to add/drop and withdraw with a mark
    // afterwards, so withdrawal is necessarily the later of the two.
    problems.push('The withdrawal deadline must fall on or after the add/drop deadline.');
  }
  if (withdrawal!.getTime() > end!.getTime()) {
    problems.push('The withdrawal deadline cannot fall after the term ends.');
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Overlap
// -----------------------------------------------------------------------------

export interface TermPeriod {
  id: string;
  code: string;
  name: string;
  season: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Terms that overlap the proposed dates.
 *
 * Returned as a WARNING rather than enforced as an error, deliberately. Two
 * semesters overlapping is almost always a mistake — but a summer session that
 * runs across the tail of the second semester is a real arrangement at plenty
 * of institutions, and a rule that refused it would be one schools work around
 * by entering the wrong dates.
 *
 * Half-open comparison, so a term starting the day another ends does not count
 * as overlapping.
 */
export function overlappingTerms(
  proposed: { startDate: Date; endDate: Date; excludeId?: string },
  existing: readonly TermPeriod[],
): TermPeriod[] {
  return existing.filter((term) => {
    if (proposed.excludeId && term.id === proposed.excludeId) return false;
    return (
      proposed.startDate.getTime() < term.endDate.getTime() &&
      term.startDate.getTime() < proposed.endDate.getTime()
    );
  });
}

// -----------------------------------------------------------------------------
// Which term is now
// -----------------------------------------------------------------------------

export type RegistrationState = 'BEFORE' | 'OPEN' | 'CLOSED';

/**
 * Whether registration is open, keyed off the window rather than the term.
 *
 * A student asking "can I register?" is asking about the window, and the two
 * differ: registration typically opens weeks before a term begins and closes
 * weeks after.
 */
export function registrationState(
  term: { registrationOpensAt: Date; registrationClosesAt: Date },
  now: Date,
): RegistrationState {
  if (now.getTime() < term.registrationOpensAt.getTime()) return 'BEFORE';
  if (now.getTime() > term.registrationClosesAt.getTime()) return 'CLOSED';
  return 'OPEN';
}

/** Whether the term itself is running, which is a different question. */
export function isInSession(
  term: { startDate: Date; endDate: Date },
  now: Date,
): boolean {
  return (
    now.getTime() >= term.startDate.getTime() && now.getTime() <= term.endDate.getTime()
  );
}

/**
 * The term that should be marked current, given the calendar.
 *
 * Offered as a SUGGESTION for the UI. Which term is current stays an explicit
 * decision by the registry, because the answer between two terms — after one
 * ends and before the next begins — is a matter of institutional practice
 * rather than arithmetic, and guessing it would silently move where new marks
 * and invoices land.
 */
export function suggestCurrentTerm<T extends { id: string; startDate: Date; endDate: Date }>(
  terms: readonly T[],
  now: Date,
): T | null {
  const running = terms.filter((t) => isInSession(t, now));
  if (running.length > 0) {
    // The one that started most recently, if somehow several are running.
    return running.reduce((a, b) => (a.startDate > b.startDate ? a : b));
  }
  const upcoming = terms
    .filter((t) => t.startDate.getTime() > now.getTime())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return upcoming[0] ?? null;
}

// -----------------------------------------------------------------------------
// The draft
// -----------------------------------------------------------------------------

export interface TermDraft extends TermDates {
  code: string;
  name: string;
  academicYear: string;
  season: string;
}

const TERM_CODE = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/;

export function normaliseTermCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-');
}

export function termCodeRejectionReason(raw: string): string | null {
  const value = normaliseTermCode(raw);
  if (!value) return 'Enter a term code.';
  if (value.length < 3) return 'A term code needs at least three characters.';
  if (value.length > 32) return 'That term code is too long.';
  if (!TERM_CODE.test(value)) return 'Use capital letters, digits and hyphens.';
  return null;
}

/** Every problem at once — this form has nine fields. */
export function validateTerm(draft: TermDraft): string[] {
  const problems: string[] = [];

  const codeProblem = termCodeRejectionReason(draft.code);
  if (codeProblem) problems.push(codeProblem);

  if (draft.name.trim().length < 2) problems.push('Enter a name for the term.');
  if (draft.name.trim().length > 80) problems.push('That term name is too long.');

  const yearProblem = academicYearRejectionReason(draft.academicYear);
  if (yearProblem) problems.push(yearProblem);

  if (!isSeason(draft.season)) problems.push('Choose a season.');

  problems.push(...validateTermDates(draft));

  return problems;
}
