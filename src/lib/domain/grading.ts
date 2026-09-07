/**
 * =============================================================================
 * GRADING & GPA ENGINE
 * =============================================================================
 *
 * This module is pure: no I/O, no database, no clock. Every function is a total
 * function of its inputs. That is deliberate — the GPA is the single most
 * consequential number the institution computes about a person, and it must be
 * reproducible, unit-testable, and reviewable without a running system.
 *
 * ALGORITHM: CREDIT-WEIGHTED GRADE POINT AVERAGE
 * ---------------------------------------------
 *   Input : E = [(creditHours_i, gradePoint_i, countsTowardGpa_i)]
 *   Output: GPA in [0.00, 4.00]
 *
 *     qualityPoints = Σ  creditHours_i · gradePoint_i   for i where countsTowardGpa_i
 *     gpaCredits    = Σ  creditHours_i                  for i where countsTowardGpa_i
 *     GPA           = gpaCredits = 0 ? 0 : qualityPoints / gpaCredits
 *
 *   Complexity: O(n) time, O(1) space.
 *
 *   Correctness hinges on three policy decisions, made explicit here rather
 *   than buried in a query:
 *
 *   (1) WITHDRAWALS ("W") carry no grade point and no credits. They are
 *       excluded from BOTH numerator and denominator — a withdrawal must not
 *       be able to lower a GPA, or students are penalised for a decision the
 *       institution explicitly permits.
 *
 *   (2) REPEATS use a BEST-ATTEMPT policy. When a course is taken more than
 *       once, only the highest-scoring attempt enters the GPA; earlier attempts
 *       are marked `isRepeatSuperseded` and retained on the transcript with an
 *       "R" notation. This is a deliberate choice over grade-replacement or
 *       attempt-averaging; see `selectGpaAttempts` for the mechanism.
 *
 *   (3) A FAILING grade ("F") earns 0 quality points but DOES consume credits
 *       in the denominator. A failure must depress the GPA, otherwise failing
 *       and withdrawing become numerically identical and the incentive to
 *       withdraw properly disappears.
 *
 * NUMERICAL NOTE
 * --------------
 * GPA is computed in float and rounded once, at the end, to 2 decimal places
 * using half-up rounding. Intermediate values are never rounded — rounding a
 * per-term GPA and then averaging those is a classic and materially wrong
 * shortcut (it silently equal-weights terms of unequal credit load).
 */

import type { AcademicStanding } from './enums';

// -----------------------------------------------------------------------------
// Grading scale
// -----------------------------------------------------------------------------

export interface GradeBand {
  /** Inclusive lower bound of the 0-100 total score. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  letter: string;
  point: number;
  description: string;
}

/**
 * Institutional grading scale. Bands are contiguous and cover [0, 100] with no
 * gaps and no overlaps — `assertScaleIsWellFormed` proves this at module load
 * in development, so a bad edit fails fast rather than silently mis-grading.
 */
export const GRADE_SCALE: readonly GradeBand[] = [
  { min: 70, max: 100, letter: 'A', point: 4.0, description: 'Excellent' },
  { min: 60, max: 69.999999, letter: 'B', point: 3.0, description: 'Very Good' },
  { min: 50, max: 59.999999, letter: 'C', point: 2.0, description: 'Good' },
  { min: 45, max: 49.999999, letter: 'D', point: 1.0, description: 'Pass' },
  { min: 40, max: 44.999999, letter: 'E', point: 0.5, description: 'Marginal Pass' },
  { min: 0, max: 39.999999, letter: 'F', point: 0.0, description: 'Fail' },
] as const;

/** Non-numeric grade notations that bypass the scale. */
export const SPECIAL_GRADES = {
  /** Withdrew after the add/drop deadline. Excluded from GPA entirely. */
  W: { letter: 'W', point: null, countsTowardGpa: false, earnsCredit: false },
  /** Coursework outstanding. Excluded until resolved. */
  I: { letter: 'I', point: null, countsTowardGpa: false, earnsCredit: false },
  /** Audited. No credit, no grade. */
  AU: { letter: 'AU', point: null, countsTowardGpa: false, earnsCredit: false },
  /** Passed on a pass/fail basis. Earns credit but does not move the GPA. */
  P: { letter: 'P', point: null, countsTowardGpa: false, earnsCredit: true },
} as const;

export type SpecialGrade = keyof typeof SPECIAL_GRADES;

/** The minimum grade point that constitutes a pass. Below this, no credit. */
export const PASSING_GRADE_POINT = 0.5;

/** Continuous assessment and examination weightings (must sum to 100). */
export const ASSESSMENT_WEIGHTS = { ca: 40, exam: 60 } as const;

// -----------------------------------------------------------------------------
// Score -> grade
// -----------------------------------------------------------------------------

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingError';
  }
}

/**
 * Round half-up to `dp` decimal places.
 *
 * Note the `+Number.EPSILON` nudge: JavaScript floats represent 1.005 as
 * 1.00499999999999989, so a naive `Math.round(x * 100) / 100` rounds it DOWN
 * to 1.00. On a grade boundary that is the difference between a B and a C.
 */
export function roundTo(value: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Combine continuous assessment and examination into a 0-100 total.
 * Both components are validated against their policy caps.
 */
export function computeTotalScore(caScore: number, examScore: number): number {
  if (!Number.isFinite(caScore) || !Number.isFinite(examScore)) {
    throw new GradingError('Assessment scores must be finite numbers.');
  }
  if (caScore < 0 || caScore > ASSESSMENT_WEIGHTS.ca) {
    throw new GradingError(
      `Continuous assessment must be between 0 and ${ASSESSMENT_WEIGHTS.ca}; received ${caScore}.`,
    );
  }
  if (examScore < 0 || examScore > ASSESSMENT_WEIGHTS.exam) {
    throw new GradingError(
      `Examination score must be between 0 and ${ASSESSMENT_WEIGHTS.exam}; received ${examScore}.`,
    );
  }
  return roundTo(caScore + examScore, 2);
}

/**
 * Map a 0-100 total score onto the grading scale.
 *
 * Implemented as a linear scan over six bands. A binary search would be
 * O(log n) but n is 6 and fixed; the scan is faster in practice and far easier
 * to audit against the published academic regulations.
 */
export function scoreToGrade(totalScore: number): GradeBand {
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) {
    throw new GradingError(`Total score must be within [0, 100]; received ${totalScore}.`);
  }
  for (const band of GRADE_SCALE) {
    if (totalScore >= band.min) return band;
  }
  // Unreachable while the scale covers 0; kept as a defensive invariant.
  throw new GradingError(`No grade band matched score ${totalScore}.`);
}

/** Development-time proof that the scale is contiguous and exhaustive. */
export function assertScaleIsWellFormed(): void {
  const sorted = [...GRADE_SCALE].sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 0) throw new GradingError('Grade scale must start at 0.');
  if (sorted[sorted.length - 1].max !== 100) throw new GradingError('Grade scale must end at 100.');
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].min - sorted[i - 1].max;
    if (gap > 0.001) {
      throw new GradingError(
        `Gap in grade scale between ${sorted[i - 1].letter} and ${sorted[i].letter}.`,
      );
    }
    if (gap < -0.001) {
      throw new GradingError(
        `Overlap in grade scale between ${sorted[i - 1].letter} and ${sorted[i].letter}.`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// GPA computation
// -----------------------------------------------------------------------------

export interface GradedAttempt {
  /** Stable identifier for the enrollment row. */
  enrollmentId: string;
  /** Course identity — used to detect repeats. */
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditHours: number;
  /** Null when the course is ungraded (in progress, W, I, AU, P). */
  gradePoint: number | null;
  letterGrade: string | null;
  totalScore: number | null;
  /** Ordering key for tie-breaking repeats (later term wins a tie). */
  termSequence: number;
}

export interface GpaResult {
  /** Credits enrolled in and carried past the drop deadline. */
  creditsAttempted: number;
  /** Credits actually earned (grade point >= PASSING_GRADE_POINT). */
  creditsEarned: number;
  /** Credits that entered the GPA denominator. */
  gpaCredits: number;
  /** Σ credit · point. */
  qualityPoints: number;
  /** Rounded to 2dp. */
  gpa: number;
  /** Enrollment ids excluded from the GPA because a better attempt exists. */
  supersededEnrollmentIds: string[];
}

/**
 * Apply the BEST-ATTEMPT repeat policy.
 *
 * For each courseId, keep exactly one attempt: the one with the highest grade
 * point. Ties are broken by the later term (a student who retakes and matches
 * their prior grade has the more recent attempt count, which keeps the
 * transcript chronologically coherent).
 *
 * Ungraded attempts (gradePoint === null) never win, and never suppress a
 * graded attempt — an in-progress retake must not erase a prior passing grade
 * from the CGPA mid-term.
 *
 * Complexity: O(n) — a single pass with a Map keyed by courseId.
 */
export function selectGpaAttempts(attempts: readonly GradedAttempt[]): {
  counted: GradedAttempt[];
  superseded: GradedAttempt[];
} {
  const best = new Map<string, GradedAttempt>();
  const superseded: GradedAttempt[] = [];

  for (const attempt of attempts) {
    const incumbent = best.get(attempt.courseId);

    if (!incumbent) {
      best.set(attempt.courseId, attempt);
      continue;
    }

    if (challengerWins(attempt, incumbent)) {
      best.set(attempt.courseId, attempt);
      superseded.push(incumbent);
    } else {
      superseded.push(attempt);
    }
  }

  return { counted: [...best.values()], superseded };
}

function challengerWins(challenger: GradedAttempt, incumbent: GradedAttempt): boolean {
  const c = challenger.gradePoint;
  const i = incumbent.gradePoint;

  // A graded attempt always beats an ungraded one.
  if (c !== null && i === null) return true;
  if (c === null && i !== null) return false;
  // Both ungraded: prefer the most recent.
  if (c === null && i === null) return challenger.termSequence > incumbent.termSequence;
  // Both graded: higher point wins, later term breaks the tie.
  if (c! > i!) return true;
  if (c! < i!) return false;
  return challenger.termSequence > incumbent.termSequence;
}

/**
 * Compute a GPA over a set of attempts.
 *
 * @param attempts       The attempts in scope. For a term GPA, pass one term's
 *                       attempts. For a CGPA, pass the student's entire history.
 * @param applyRepeatPolicy When true (the CGPA case), collapse repeats to the
 *                       best attempt. When false (the term GPA case), every
 *                       attempt in the term counts as recorded.
 */
export function computeGpa(
  attempts: readonly GradedAttempt[],
  applyRepeatPolicy = true,
): GpaResult {
  const { counted, superseded } = applyRepeatPolicy
    ? selectGpaAttempts(attempts)
    : { counted: [...attempts], superseded: [] as GradedAttempt[] };

  let qualityPoints = 0;
  let gpaCredits = 0;
  let creditsEarned = 0;
  let creditsAttempted = 0;

  for (const a of counted) {
    if (a.creditHours <= 0) continue;

    // A null grade point means W / I / AU / P / in-progress: no GPA impact.
    if (a.gradePoint === null) continue;

    creditsAttempted += a.creditHours;
    gpaCredits += a.creditHours;
    qualityPoints += a.creditHours * a.gradePoint;

    if (a.gradePoint >= PASSING_GRADE_POINT) {
      creditsEarned += a.creditHours;
    }
  }

  const gpa = gpaCredits === 0 ? 0 : qualityPoints / gpaCredits;

  return {
    creditsAttempted,
    creditsEarned,
    gpaCredits,
    qualityPoints: roundTo(qualityPoints, 2),
    gpa: roundTo(gpa, 2),
    supersededEnrollmentIds: superseded.map((s) => s.enrollmentId),
  };
}

// -----------------------------------------------------------------------------
// Academic standing
// -----------------------------------------------------------------------------

export const STANDING_THRESHOLDS = {
  deansList: 3.5,
  good: 2.0,
  warning: 1.5,
  probation: 1.0,
  /** Minimum full-time load for Dean's List eligibility. */
  deansListMinCredits: 12,
  /** Consecutive probation terms tolerated before dismissal. */
  maxConsecutiveProbationTerms: 2,
} as const;

export interface StandingInput {
  cumulativeGpa: number;
  termGpa: number;
  creditsAttemptedThisTerm: number;
  /** How many consecutive prior terms already ended in PROBATION. */
  consecutiveProbationTerms: number;
  /** Standing is not assessed in a student's very first term. */
  isFirstTerm: boolean;
}

export interface StandingResult {
  standing: AcademicStanding;
  reason: string;
  /** True when the outcome requires registrar sign-off before it takes effect. */
  requiresReview: boolean;
}

/**
 * ALGORITHM: ACADEMIC STANDING DETERMINATION
 * -----------------------------------------
 * A guard-clause cascade evaluated in strict priority order. Order matters:
 * dismissal is checked before probation, and probation before good standing,
 * so a student can never be assigned a more favourable standing than their
 * worst qualifying condition.
 *
 *   1. First term            -> GOOD (a grace term; no adverse action)
 *   2. CGPA < 1.0            -> DISMISSED       (requires registrar review)
 *   3. CGPA < 1.5            -> PROBATION, escalating to DISMISSED after
 *                               `maxConsecutiveProbationTerms` consecutive terms
 *   4. CGPA < 2.0            -> WARNING
 *   5. CGPA >= 3.5 AND full-time load -> DEANS_LIST
 *   6. otherwise             -> GOOD
 *
 * Complexity: O(1).
 *
 * Note that dismissal is never applied automatically — `requiresReview` forces
 * a human decision. Automating a life-altering outcome on a floating-point
 * comparison is precisely the kind of thing that ends up in a lawsuit.
 */
export function determineAcademicStanding(input: StandingInput): StandingResult {
  const {
    cumulativeGpa,
    termGpa,
    creditsAttemptedThisTerm,
    consecutiveProbationTerms,
    isFirstTerm,
  } = input;

  if (isFirstTerm && cumulativeGpa >= STANDING_THRESHOLDS.probation) {
    return {
      standing: 'GOOD',
      reason: 'First term of study — adverse standing is not assessed.',
      requiresReview: false,
    };
  }

  if (cumulativeGpa < STANDING_THRESHOLDS.probation) {
    return {
      standing: 'DISMISSED',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${STANDING_THRESHOLDS.probation.toFixed(2)} minimum for continued registration.`,
      requiresReview: true,
    };
  }

  if (cumulativeGpa < STANDING_THRESHOLDS.warning) {
    if (consecutiveProbationTerms >= STANDING_THRESHOLDS.maxConsecutiveProbationTerms) {
      return {
        standing: 'DISMISSED',
        reason: `CGPA ${cumulativeGpa.toFixed(2)} after ${consecutiveProbationTerms} consecutive terms on probation.`,
        requiresReview: true,
      };
    }
    return {
      standing: 'PROBATION',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${STANDING_THRESHOLDS.warning.toFixed(2)} probation threshold.`,
      requiresReview: false,
    };
  }

  if (cumulativeGpa < STANDING_THRESHOLDS.good) {
    return {
      standing: 'WARNING',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${STANDING_THRESHOLDS.good.toFixed(2)} good-standing threshold.`,
      requiresReview: false,
    };
  }

  if (
    cumulativeGpa >= STANDING_THRESHOLDS.deansList &&
    termGpa >= STANDING_THRESHOLDS.deansList &&
    creditsAttemptedThisTerm >= STANDING_THRESHOLDS.deansListMinCredits
  ) {
    return {
      standing: 'DEANS_LIST',
      reason: `Term GPA ${termGpa.toFixed(2)} on a full-time load of ${creditsAttemptedThisTerm} credits.`,
      requiresReview: false,
    };
  }

  return {
    standing: 'GOOD',
    reason: `CGPA ${cumulativeGpa.toFixed(2)} meets institutional requirements.`,
    requiresReview: false,
  };
}

// -----------------------------------------------------------------------------
// Degree classification
// -----------------------------------------------------------------------------

export const DEGREE_CLASSES = [
  { min: 3.5, label: 'First Class Honours' },
  { min: 3.0, label: 'Second Class Honours (Upper Division)' },
  { min: 2.0, label: 'Second Class Honours (Lower Division)' },
  { min: 1.5, label: 'Third Class Honours' },
  { min: 1.0, label: 'Pass' },
  { min: 0.0, label: 'Fail' },
] as const;

export function classifyDegree(cgpa: number): string {
  for (const c of DEGREE_CLASSES) {
    if (cgpa >= c.min) return c.label;
  }
  return 'Fail';
}

// -----------------------------------------------------------------------------
// Graduation audit
// -----------------------------------------------------------------------------

export interface GraduationAuditInput {
  creditsEarned: number;
  creditsRequired: number;
  cgpa: number;
  minCgpaToGraduate: number;
  /** Course ids the program marks CORE. */
  requiredCoreCourseIds: readonly string[];
  /** Course ids the student has passed. */
  passedCourseIds: readonly string[];
  hasBlockingHold: boolean;
}

export interface GraduationAuditResult {
  eligible: boolean;
  creditsRemaining: number;
  missingCoreCourseIds: string[];
  classification: string;
  blockers: string[];
}

/**
 * ALGORITHM: GRADUATION AUDIT
 * ---------------------------
 * Set difference between required core courses and passed courses, plus two
 * scalar comparisons. Uses a Set for O(1) membership, giving O(|core|) overall
 * rather than the O(|core| · |passed|) of a nested scan.
 */
export function auditGraduation(input: GraduationAuditInput): GraduationAuditResult {
  const passed = new Set(input.passedCourseIds);
  const missingCoreCourseIds = input.requiredCoreCourseIds.filter((id) => !passed.has(id));
  const creditsRemaining = Math.max(0, input.creditsRequired - input.creditsEarned);
  const blockers: string[] = [];

  if (creditsRemaining > 0) {
    blockers.push(`${creditsRemaining} credit hours outstanding.`);
  }
  if (missingCoreCourseIds.length > 0) {
    blockers.push(`${missingCoreCourseIds.length} required core course(s) not yet passed.`);
  }
  if (input.cgpa < input.minCgpaToGraduate) {
    blockers.push(
      `CGPA ${input.cgpa.toFixed(2)} is below the ${input.minCgpaToGraduate.toFixed(2)} graduation minimum.`,
    );
  }
  if (input.hasBlockingHold) {
    blockers.push('An unresolved hold blocks degree conferral.');
  }

  return {
    eligible: blockers.length === 0,
    creditsRemaining,
    missingCoreCourseIds,
    classification: classifyDegree(input.cgpa),
    blockers,
  };
}
