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
import {
  DEFAULT_GRADING_CONFIG,
  assertGradingConfigWellFormed,
  type DegreeClass,
  type GradeBand,
  type StandingThresholds,
} from './config';

export type { GradeBand, StandingThresholds, DegreeClass };

// -----------------------------------------------------------------------------
// Grading scale
// -----------------------------------------------------------------------------

/**
 * The DEFAULT grading scale — a 4.0 scale on Nigerian percentage cut-offs.
 *
 * A school on a different scheme passes its own bands; every function below
 * takes the scale as an optional parameter defaulting to this one, which is
 * what lets configuration arrive without changing a single existing call site.
 * Bands must be contiguous over [0, 100]; `assertGradingConfigWellFormed`
 * enforces that whenever a school saves a scale.
 */
export const GRADE_SCALE: readonly GradeBand[] = DEFAULT_GRADING_CONFIG.scale;

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
export const PASSING_GRADE_POINT = DEFAULT_GRADING_CONFIG.passingGradePoint;

/** Continuous assessment and examination weightings (must sum to 100). */
export const ASSESSMENT_WEIGHTS = DEFAULT_GRADING_CONFIG.assessmentWeights;

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
export function computeTotalScore(
  caScore: number,
  examScore: number,
  weights: { ca: number; exam: number } = DEFAULT_GRADING_CONFIG.assessmentWeights,
): number {
  if (!Number.isFinite(caScore) || !Number.isFinite(examScore)) {
    throw new GradingError('Assessment scores must be finite numbers.');
  }
  if (caScore < 0 || caScore > weights.ca) {
    throw new GradingError(
      `Continuous assessment must be between 0 and ${weights.ca}; received ${caScore}.`,
    );
  }
  if (examScore < 0 || examScore > weights.exam) {
    throw new GradingError(
      `Examination score must be between 0 and ${weights.exam}; received ${examScore}.`,
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
export function scoreToGrade(
  totalScore: number,
  scale: readonly GradeBand[] = DEFAULT_GRADING_CONFIG.scale,
): GradeBand {
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) {
    throw new GradingError(`Total score must be within [0, 100]; received ${totalScore}.`);
  }
  // Highest matching band wins, so the scale is scanned from the top down.
  const ordered = [...scale].sort((a, b) => b.min - a.min);
  for (const band of ordered) {
    if (totalScore >= band.min) return band;
  }
  // Unreachable while the scale covers 0; kept as a defensive invariant.
  throw new GradingError(`No grade band matched score ${totalScore}.`);
}

/**
 * Proof that the DEFAULT scale is contiguous and exhaustive.
 *
 * The real check now runs at config-save time via
 * `assertGradingConfigWellFormed`: a scale a school can edit has to be
 * validated when it is edited, not when a module happens to load.
 */
export function assertScaleIsWellFormed(): void {
  assertGradingConfigWellFormed(DEFAULT_GRADING_CONFIG);
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
 * @param passingGradePoint The school's pass mark on its own scale — 0.5 on a
 *                       4.0 scale, but 40 on a percentage scale. Only affects
 *                       `creditsEarned`; the GPA itself is scale-agnostic.
 */
export function computeGpa(
  attempts: readonly GradedAttempt[],
  applyRepeatPolicy = true,
  passingGradePoint: number = DEFAULT_GRADING_CONFIG.passingGradePoint,
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

    if (a.gradePoint >= passingGradePoint) {
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

/** Thresholds on the DEFAULT 4.0 scale. A school passes its own. */
export const STANDING_THRESHOLDS: StandingThresholds = DEFAULT_GRADING_CONFIG.standing;

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
export function determineAcademicStanding(
  input: StandingInput,
  thresholds: StandingThresholds = DEFAULT_GRADING_CONFIG.standing,
): StandingResult {
  const {
    cumulativeGpa,
    termGpa,
    creditsAttemptedThisTerm,
    consecutiveProbationTerms,
    isFirstTerm,
  } = input;

  if (isFirstTerm && cumulativeGpa >= thresholds.probation) {
    return {
      standing: 'GOOD',
      reason: 'First term of study — adverse standing is not assessed.',
      requiresReview: false,
    };
  }

  if (cumulativeGpa < thresholds.probation) {
    return {
      standing: 'DISMISSED',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${thresholds.probation.toFixed(2)} minimum for continued registration.`,
      requiresReview: true,
    };
  }

  if (cumulativeGpa < thresholds.warning) {
    if (consecutiveProbationTerms >= thresholds.maxConsecutiveProbationTerms) {
      return {
        standing: 'DISMISSED',
        reason: `CGPA ${cumulativeGpa.toFixed(2)} after ${consecutiveProbationTerms} consecutive terms on probation.`,
        requiresReview: true,
      };
    }
    return {
      standing: 'PROBATION',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${thresholds.warning.toFixed(2)} probation threshold.`,
      requiresReview: false,
    };
  }

  if (cumulativeGpa < thresholds.good) {
    return {
      standing: 'WARNING',
      reason: `CGPA ${cumulativeGpa.toFixed(2)} is below the ${thresholds.good.toFixed(2)} good-standing threshold.`,
      requiresReview: false,
    };
  }

  if (
    cumulativeGpa >= thresholds.deansList &&
    termGpa >= thresholds.deansList &&
    creditsAttemptedThisTerm >= thresholds.deansListMinCredits
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

/** Honours bands on the DEFAULT 4.0 scale. A school passes its own. */
export const DEGREE_CLASSES: DegreeClass[] = DEFAULT_GRADING_CONFIG.degreeClasses;

export function classifyDegree(
  cgpa: number,
  classes: readonly DegreeClass[] = DEFAULT_GRADING_CONFIG.degreeClasses,
): string {
  // Highest qualifying band wins, so the list is walked from the top down.
  const ordered = [...classes].sort((a, b) => b.min - a.min);
  for (const c of ordered) {
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
