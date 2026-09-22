/**
 * =============================================================================
 * FROM COURSEWORK MARKS TO THE CONTINUOUS-ASSESSMENT SCORE
 * =============================================================================
 *
 * The arithmetic that turns a term's marked coursework into the `caScore` on an
 * enrolment — which feeds the total, the letter grade, the GPA, academic
 * standing, and eventually a graduation audit.
 *
 * This is the highest-consequence maths in the product, so it is pure, it is
 * explicit about what it excludes, and it refuses to guess. In particular:
 *
 *   · UNMARKED WORK IS NOT ZERO. A student whose essay the lecturer has not got
 *     to yet has not scored nothing; they have no score. Counting it as zero
 *     would quietly depress a real CGPA on the strength of a marking backlog.
 *
 *   · MISSING WORK IS ALSO NOT AUTOMATICALLY ZERO, and that is a genuinely
 *     harder call. At the end of term it plainly should be; halfway through it
 *     plainly should not. Rather than pick, this reports both figures and makes
 *     the lecturer choose — the difference between them is exactly the
 *     information they need to choose well.
 */

import { roundTo } from './grading';

export interface GradebookItem {
  courseworkId: string;
  title: string;
  pointsPossible: number;
  /** The mark given, or null when nothing has been marked. */
  score: number | null;
  /** Whether the student handed anything in at all. */
  submitted: boolean;
}

export interface CaComputation {
  /** Marks earned across the items that counted. */
  earned: number;
  /** Marks available across the items that counted. */
  possible: number;
  /** 0-100, or null when nothing counted. */
  percentage: number | null;
  /** Scaled to the school's own CA weight. Null when nothing counted. */
  caScore: number | null;
  /** How many items contributed. */
  counted: number;
  /** Marked but excluded — never happens; here so the shape is total. */
  excludedUnmarked: number;
  /** Handed in nothing, and it was not counted as zero. */
  excludedMissing: number;
}

/**
 * Turn one student's coursework into a CA score.
 *
 * WEIGHTED BY MARKS AVAILABLE, not by item count. An essay out of 100 and a
 * quiz out of 10 are not worth the same, and averaging their percentages would
 * say they were — letting a perfect quiz cancel a failed essay.
 *
 * `caWeight` comes from the school's own `assessmentWeights.ca` and is never
 * hard-coded: it is 40 by default here and is a per-school setting, so a
 * hard-coded 40 would misstate the CA of every school that changed it.
 */
export function computeCaScore(params: {
  items: readonly GradebookItem[];
  caWeight: number;
  /** Treat work that was never handed in as a zero. The lecturer's decision. */
  countMissingAsZero: boolean;
}): CaComputation {
  let earned = 0;
  let possible = 0;
  let counted = 0;
  let excludedUnmarked = 0;
  let excludedMissing = 0;

  for (const item of params.items) {
    // A piece worth nothing cannot move an average and would divide by zero.
    if (!Number.isFinite(item.pointsPossible) || item.pointsPossible <= 0) continue;

    if (item.score !== null && Number.isFinite(item.score)) {
      earned += item.score;
      possible += item.pointsPossible;
      counted += 1;
      continue;
    }

    // From here down the item has no mark.
    if (!item.submitted && params.countMissingAsZero) {
      earned += 0;
      possible += item.pointsPossible;
      counted += 1;
      continue;
    }

    if (item.submitted) excludedUnmarked += 1;
    else excludedMissing += 1;
  }

  if (possible === 0) {
    return {
      earned: 0,
      possible: 0,
      percentage: null,
      caScore: null,
      counted,
      excludedUnmarked,
      excludedMissing,
    };
  }

  const percentage = (earned / possible) * 100;

  /*
   * CLAMPED TO THE WEIGHT. A lecturer who awards 12 out of 10 for exceptional
   * work has made a deliberate choice about that piece; letting it push the CA
   * above the school's ceiling would push the TOTAL above 100 and produce a
   * grade band that does not exist.
   */
  const scaled = Math.min((percentage / 100) * params.caWeight, params.caWeight);

  return {
    earned: roundTo(earned),
    possible: roundTo(possible),
    percentage: roundTo(percentage),
    caScore: roundTo(scaled),
    counted,
    excludedUnmarked,
    excludedMissing,
  };
}

// -----------------------------------------------------------------------------
// What posting would do
// -----------------------------------------------------------------------------

export type PostOutcome =
  | 'WOULD_SET'
  | 'UNCHANGED'
  | 'WOULD_OVERWRITE'
  | 'NOTHING_TO_POST';

export interface PostPreviewRow {
  enrollmentId: string;
  studentName: string;
  matricNumber: string;
  computed: CaComputation;
  /** The caScore already on the enrolment, if any. */
  existingCaScore: number | null;
  outcome: PostOutcome;
}

/**
 * What would happen to one student if coursework were posted now.
 *
 * WOULD_OVERWRITE is the case worth surfacing. A `caScore` already on the
 * enrolment was typed by somebody on the gradesheet, and silently replacing it
 * with a computed figure destroys a human judgement — a viva mark, an agreed
 * adjustment, a penalty — with no record that it ever existed.
 */
export function previewPost(params: {
  computed: CaComputation;
  existingCaScore: number | null;
}): PostOutcome {
  if (params.computed.caScore === null) return 'NOTHING_TO_POST';
  if (params.existingCaScore === null) return 'WOULD_SET';

  // Equal to within a rounding step is not a change worth warning about.
  if (Math.abs(params.existingCaScore - params.computed.caScore) < 0.005) return 'UNCHANGED';

  return 'WOULD_OVERWRITE';
}

export interface PostSummary {
  toSet: number;
  toOverwrite: number;
  unchanged: number;
  nothingToPost: number;
  /** Students with work handed in that nobody has marked. */
  withUnmarkedWork: number;
  /** Students who did not hand something in, where that was not counted. */
  withMissingWork: number;
}

export function summarisePost(rows: readonly PostPreviewRow[]): PostSummary {
  return {
    toSet: rows.filter((r) => r.outcome === 'WOULD_SET').length,
    toOverwrite: rows.filter((r) => r.outcome === 'WOULD_OVERWRITE').length,
    unchanged: rows.filter((r) => r.outcome === 'UNCHANGED').length,
    nothingToPost: rows.filter((r) => r.outcome === 'NOTHING_TO_POST').length,
    withUnmarkedWork: rows.filter((r) => r.computed.excludedUnmarked > 0).length,
    withMissingWork: rows.filter((r) => r.computed.excludedMissing > 0).length,
  };
}

// -----------------------------------------------------------------------------
// Marking one piece of work
// -----------------------------------------------------------------------------

export function validateMark(params: {
  score: number;
  pointsPossible: number;
  feedback?: string | null;
}): string[] {
  const problems: string[] = [];

  if (!Number.isFinite(params.score)) {
    problems.push('Enter a mark.');
  } else if (params.score < 0) {
    problems.push('A mark cannot be negative.');
  } else if (params.score > params.pointsPossible * 1.5) {
    /*
     * A mark somewhat ABOVE the maximum is allowed deliberately — bonus marks
     * for exceptional work are a real thing lecturers do. Half again is where
     * it stops being generosity and starts being a typed digit too many.
     */
    problems.push(
      `That is far above the ${params.pointsPossible} available. Check it before saving.`,
    );
  }

  if (params.feedback && params.feedback.length > 10_000) {
    problems.push('That feedback is too long.');
  }

  return problems;
}

/** A mark as a percentage of what was available, for display. */
export function markPercentage(score: number, pointsPossible: number): number | null {
  if (!Number.isFinite(score) || pointsPossible <= 0) return null;
  return roundTo((score / pointsPossible) * 100);
}
