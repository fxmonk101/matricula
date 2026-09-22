/**
 * =============================================================================
 * COURSEWORK AND HAND-INS
 * =============================================================================
 *
 * What a piece of work is worth, when it is due, and what state a given
 * student's hand-in is in. Pure: no database, no clock of its own.
 *
 * Called coursework rather than "assignment" throughout. `SubjectAssignment`
 * already means a teaching allocation in this system, and what this ultimately
 * feeds is `caScore` — the continuous-assessment component — so coursework is
 * also the more exact word.
 */

export const INSTRUCTIONS_MAX = 20_000;
export const FEEDBACK_MAX = 10_000;
export const TEXT_SUBMISSION_MAX = 100_000;

export interface CourseworkDraft {
  title: string;
  instructions?: string | null;
  pointsPossible: number;
  dueAt?: Date | null;
  allowsText: boolean;
  allowsFile: boolean;
  acceptsLate: boolean;
}

export function validateCourseworkDraft(draft: CourseworkDraft, now: Date): string[] {
  const problems: string[] = [];

  if (!draft.title.trim()) problems.push('Give the assignment a title.');

  if (!Number.isFinite(draft.pointsPossible) || draft.pointsPossible <= 0) {
    problems.push('An assignment must be worth more than zero.');
  } else if (draft.pointsPossible > 1000) {
    // Not a rule of the universe, but a mark out of 10,000 is a typed zero too
    // many, and catching it here beats discovering it when the weighting is
    // computed.
    problems.push('That is an implausible number of marks. Use a smaller scale and weight it.');
  }

  if (draft.dueAt) {
    if (Number.isNaN(draft.dueAt.getTime())) {
      problems.push('That due date could not be read.');
    } else if (draft.dueAt.getTime() < now.getTime() - 365 * 86_400_000) {
      // A due date a year in the past is a mistyped year, not a backdated task.
      problems.push('That due date is more than a year ago. Check the year.');
    }
  }

  /*
   * A piece of work that accepts neither text nor a file cannot be handed in at
   * all. The student would see a submission page with no way to submit, and
   * conclude the system was broken rather than that it was misconfigured.
   */
  if (!draft.allowsText && !draft.allowsFile) {
    problems.push('Allow a typed answer, a file, or both — otherwise nobody can hand anything in.');
  }

  if (draft.instructions && draft.instructions.length > INSTRUCTIONS_MAX) {
    problems.push('Those instructions are too long.');
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Handing in
// -----------------------------------------------------------------------------

export interface SubmissionDraft {
  textBody?: string | null;
  hasFile: boolean;
}

export interface SubmissionRules {
  allowsText: boolean;
  allowsFile: boolean;
  acceptsLate: boolean;
  dueAt?: Date | null;
}

export function validateSubmission(
  draft: SubmissionDraft,
  rules: SubmissionRules,
  now: Date,
): string[] {
  const problems: string[] = [];

  const text = draft.textBody?.trim() ?? '';

  if (!text && !draft.hasFile) {
    problems.push('Type an answer or attach a file before submitting.');
  }
  if (text && !rules.allowsText) {
    problems.push('This assignment takes a file, not a typed answer.');
  }
  if (draft.hasFile && !rules.allowsFile) {
    problems.push('This assignment takes a typed answer, not a file.');
  }
  if (text.length > TEXT_SUBMISSION_MAX) {
    problems.push('That answer is too long. Attach it as a file instead.');
  }

  /*
   * A closed assignment is refused HERE rather than by hiding the button,
   * because a form that was already open when the deadline passed would
   * otherwise still post.
   */
  if (!rules.acceptsLate && isLate(rules.dueAt, now)) {
    problems.push('The deadline for this assignment has passed and late work is not accepted.');
  }

  return problems;
}

/** Was this hand-in late? Recorded at submission, never recomputed on read. */
export function isLate(dueAt: Date | null | undefined, at: Date): boolean {
  if (!dueAt) return false;
  return at.getTime() > dueAt.getTime();
}

// -----------------------------------------------------------------------------
// Where a student stands
// -----------------------------------------------------------------------------

export type SubmissionState =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'SUBMITTED_LATE'
  | 'GRADED'
  | 'CLOSED';

export interface SubmissionLike {
  submittedAt: Date;
  isLate: boolean;
  score: number | null;
  gradedAt: Date | null;
}

/**
 * The one thing a student wants to know, and the one thing a lecturer scanning
 * a list wants to know.
 *
 * GRADED wins over SUBMITTED_LATE: once work has been marked, its lateness is
 * something the mark already accounts for, and continuing to shout about it
 * buries the result the student came to read.
 */
export function submissionState(
  submission: SubmissionLike | null,
  rules: SubmissionRules,
  now: Date,
): SubmissionState {
  if (!submission) {
    // Nothing handed in, and it can no longer be.
    if (!rules.acceptsLate && isLate(rules.dueAt, now)) return 'CLOSED';
    return 'NOT_SUBMITTED';
  }
  if (submission.gradedAt !== null) return 'GRADED';
  return submission.isLate ? 'SUBMITTED_LATE' : 'SUBMITTED';
}

export const STATE_LABELS: Record<SubmissionState, string> = {
  NOT_SUBMITTED: 'Not submitted',
  SUBMITTED: 'Submitted',
  SUBMITTED_LATE: 'Submitted late',
  GRADED: 'Marked',
  CLOSED: 'Closed',
};

/** How long until the deadline, in words a person would use. */
export function dueIn(dueAt: Date | null | undefined, now: Date): string | null {
  if (!dueAt) return null;

  const ms = dueAt.getTime() - now.getTime();
  const overdue = ms < 0;
  const minutes = Math.floor(Math.abs(ms) / 60_000);

  const phrase =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? '' : 's'}`
      : minutes < 60 * 48
        ? `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) === 1 ? '' : 's'}`
        : `${Math.floor(minutes / (60 * 24))} days`;

  return overdue ? `${phrase} overdue` : `due in ${phrase}`;
}

// -----------------------------------------------------------------------------
// Rubrics
// -----------------------------------------------------------------------------

export interface RubricRow {
  criterion: string;
  points: number;
}

/**
 * A rubric is stored as JSON and edited whole.
 *
 * Parsing is total: anything unrecognised returns an empty rubric rather than
 * throwing. A malformed rubric must not be able to take down the page that
 * displays the assignment it belongs to — the work and the mark matter more
 * than the breakdown.
 */
export function parseRubric(json: string | null | undefined): RubricRow[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((row): RubricRow[] => {
      if (typeof row !== 'object' || row === null) return [];
      const { criterion, points } = row as Record<string, unknown>;
      if (typeof criterion !== 'string' || !criterion.trim()) return [];
      const value = typeof points === 'number' && Number.isFinite(points) ? points : 0;
      return [{ criterion: criterion.trim().slice(0, 200), points: value }];
    });
  } catch {
    return [];
  }
}

export function rubricTotal(rows: readonly RubricRow[]): number {
  return rows.reduce((sum, row) => sum + row.points, 0);
}

/**
 * A rubric whose parts do not add up to the whole is a marking error waiting to
 * happen — so it is reported, as a WARNING rather than a refusal. Plenty of
 * real rubrics deliberately do not sum, and refusing them would be wrong.
 */
export function rubricWarning(
  rows: readonly RubricRow[],
  pointsPossible: number,
): string | null {
  if (rows.length === 0) return null;
  const total = rubricTotal(rows);
  if (Math.abs(total - pointsPossible) < 0.01) return null;
  return `The rubric adds up to ${total}, but the assignment is worth ${pointsPossible}.`;
}
