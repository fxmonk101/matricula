/**
 * =============================================================================
 * WHAT A STUDENT STILL OWES
 * =============================================================================
 *
 * The single most-asked question by a student in this market, and the app could
 * not answer it. The maths underneath was already right — `isRepeatSuperseded`
 * implements best-attempt correctly — but nothing anywhere told a student
 * "you failed CSC201 and must register it again", so they asked the department,
 * and the department looked it up on paper.
 *
 * THE WORDS MATTER, because a registry uses them precisely and a product that
 * uses them loosely reads as foreign:
 *
 *   CARRYOVER   A course taken and FAILED, not since passed. It must be
 *               registered again, and it still counts against the CGPA.
 *   OUTSTANDING A required course not yet PASSED — which includes every
 *               carryover, plus required courses never attempted at all.
 *   SPILLOVER   Being unable to graduate within the programme's normal length
 *               because of what is outstanding. An extra session.
 *
 * A carryover is therefore a subset of outstanding, and the difference is
 * whether the student has sat the course. Conflating them produces a list that
 * tells a first-year they are "carrying" every course in their degree.
 */

export interface AttemptRecord {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditHours: number;
  /** Null for withdrawn or in-progress work: no verdict either way. */
  gradePoint: number | null;
  letterGrade: string | null;
  /** Ordering key, so "most recent attempt" is answerable. */
  termSequence: number;
  termName: string;
}

export interface RequirementRecord {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditHours: number;
  /** CORE | ELECTIVE | GENERAL_STUDIES */
  kind: string;
  /** The level it is normally taken at. */
  level: number;
}

export type OutstandingReason =
  /** Sat and failed. Must be retaken. */
  | 'FAILED'
  /** Required by the programme and never attempted. */
  | 'NOT_TAKEN';

export interface OutstandingCourse {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditHours: number;
  reason: OutstandingReason;
  /** FAILED only: what they got, and when. */
  lastGrade: string | null;
  lastTermName: string | null;
  attempts: number;
  /** The level the programme expects this at, where it is a requirement. */
  level: number | null;
  kind: string | null;
}

/**
 * Has this student passed this course, on any attempt?
 *
 * ANY attempt, not the latest. A student who passed CSC101 at the second
 * attempt and then sat it a third time for a better grade has still passed it;
 * reading only the most recent result would put it back on their carryover
 * list, which is how a registry loses faith in a system.
 */
export function hasPassed(
  attempts: readonly AttemptRecord[],
  passingGradePoint: number,
): boolean {
  return attempts.some((a) => a.gradePoint !== null && a.gradePoint >= passingGradePoint);
}

/**
 * The courses this student has sat and not passed.
 *
 * Attempts with no grade point — withdrawn, incomplete, in progress — are NOT
 * failures. A student who withdrew from a course has not failed it, and telling
 * them they are carrying it is both wrong and alarming.
 */
export function carryovers(
  attempts: readonly AttemptRecord[],
  passingGradePoint: number,
): OutstandingCourse[] {
  const byCourse = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    const list = byCourse.get(attempt.courseId) ?? [];
    list.push(attempt);
    byCourse.set(attempt.courseId, list);
  }

  const out: OutstandingCourse[] = [];

  for (const [courseId, list] of byCourse) {
    if (hasPassed(list, passingGradePoint)) continue;

    // Only a graded attempt makes it a carryover. Withdrawals do not.
    const graded = list.filter((a) => a.gradePoint !== null);
    if (graded.length === 0) continue;

    const latest = graded.reduce((a, b) => (b.termSequence >= a.termSequence ? b : a));

    out.push({
      courseId,
      courseCode: latest.courseCode,
      courseTitle: latest.courseTitle,
      creditHours: latest.creditHours,
      reason: 'FAILED',
      lastGrade: latest.letterGrade,
      lastTermName: latest.termName,
      attempts: graded.length,
      level: null,
      kind: null,
    });
  }

  return out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/**
 * Everything standing between this student and their degree.
 *
 * Carryovers first, then requirements never attempted — because a carryover is
 * a debt and an untaken course is a plan, and a list that mixes them by course
 * code buries the three courses somebody has to act on among the thirty they
 * have not reached yet.
 */
export function outstanding(params: {
  attempts: readonly AttemptRecord[];
  requirements: readonly RequirementRecord[];
  passingGradePoint: number;
  /** Electives are counted by credit, not individually — see below. */
  includeElectives?: boolean;
}): OutstandingCourse[] {
  const failed = carryovers(params.attempts, params.passingGradePoint);
  const failedIds = new Set(failed.map((c) => c.courseId));

  const attemptsByCourse = new Map<string, AttemptRecord[]>();
  for (const attempt of params.attempts) {
    const list = attemptsByCourse.get(attempt.courseId) ?? [];
    list.push(attempt);
    attemptsByCourse.set(attempt.courseId, list);
  }

  const byId = new Map(params.requirements.map((r) => [r.courseId, r]));

  // Carryovers gain the programme's own view of the course where it has one.
  const enriched = failed.map((course) => {
    const requirement = byId.get(course.courseId);
    return requirement
      ? { ...course, level: requirement.level, kind: requirement.kind }
      : course;
  });

  const notTaken: OutstandingCourse[] = [];
  for (const requirement of params.requirements) {
    /*
     * ELECTIVES are excluded by default, and that is a real decision rather
     * than an omission. A programme lists twenty electives of which a student
     * takes four; listing the sixteen they did not choose as "outstanding"
     * would be nonsense. Elective SHORTFALL is a credit count, not a list of
     * courses, and belongs with the graduation audit.
     */
    if (requirement.kind === 'ELECTIVE' && !params.includeElectives) continue;
    if (failedIds.has(requirement.courseId)) continue;

    const sat = attemptsByCourse.get(requirement.courseId) ?? [];
    if (hasPassed(sat, params.passingGradePoint)) continue;
    // Currently being taken, or withdrawn from: not a debt.
    if (sat.length > 0) continue;

    notTaken.push({
      courseId: requirement.courseId,
      courseCode: requirement.courseCode,
      courseTitle: requirement.courseTitle,
      creditHours: requirement.creditHours,
      reason: 'NOT_TAKEN',
      lastGrade: null,
      lastTermName: null,
      attempts: 0,
      level: requirement.level,
      kind: requirement.kind,
    });
  }

  return [
    ...enriched.sort((a, b) => a.courseCode.localeCompare(b.courseCode)),
    ...notTaken.sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.courseCode.localeCompare(b.courseCode),
    ),
  ];
}

// -----------------------------------------------------------------------------
// What it adds up to
// -----------------------------------------------------------------------------

export interface CarryoverSummary {
  carryoverCount: number;
  carryoverCredits: number;
  outstandingCount: number;
  outstandingCredits: number;
  /** True when the carryover load is heavy enough to be worth warning about. */
  heavy: boolean;
}

/**
 * Where the "heavy" line sits.
 *
 * Three is the figure most Nigerian universities treat as the point at which a
 * student is in trouble rather than merely unlucky — enough to crowd out a
 * normal load and push them towards an extra session. It is a warning and
 * never a block: deciding who may register is the registry's job, and this
 * module does not make that call.
 */
export const HEAVY_CARRYOVER_COUNT = 3;

export function summarise(courses: readonly OutstandingCourse[]): CarryoverSummary {
  const failed = courses.filter((c) => c.reason === 'FAILED');
  return {
    carryoverCount: failed.length,
    carryoverCredits: failed.reduce((sum, c) => sum + c.creditHours, 0),
    outstandingCount: courses.length,
    outstandingCredits: courses.reduce((sum, c) => sum + c.creditHours, 0),
    heavy: failed.length >= HEAVY_CARRYOVER_COUNT,
  };
}

/**
 * Will this student need longer than the programme allows?
 *
 * Deliberately crude, and honest about it: outstanding credits divided by what
 * a term can hold, against the terms they have left. It answers "is spillover
 * likely" and not "when will you graduate" — the second depends on which
 * courses run in which term, which is a timetable question and not this one.
 */
export function spilloverRisk(params: {
  outstandingCredits: number;
  termsRemaining: number;
  maxCreditsPerTerm: number;
}): { atRisk: boolean; termsNeeded: number } {
  if (params.maxCreditsPerTerm <= 0) return { atRisk: false, termsNeeded: 0 };

  const termsNeeded = Math.ceil(params.outstandingCredits / params.maxCreditsPerTerm);
  return { atRisk: termsNeeded > params.termsRemaining, termsNeeded };
}

/** One line a student can read without knowing the vocabulary. */
export function describe(summary: CarryoverSummary): string {
  if (summary.carryoverCount === 0 && summary.outstandingCount === 0) {
    return 'You have passed everything your programme requires so far.';
  }
  if (summary.carryoverCount === 0) {
    return `${summary.outstandingCount} required ${summary.outstandingCount === 1 ? 'course is' : 'courses are'} still to be taken.`;
  }
  return (
    `${summary.carryoverCount} ${summary.carryoverCount === 1 ? 'carryover' : 'carryovers'} ` +
    `(${summary.carryoverCredits} ${summary.carryoverCredits === 1 ? 'credit' : 'credits'}) to retake.`
  );
}
