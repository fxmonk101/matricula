import { DEFAULT_K12_CONFIG, type GradeBand, type GradingConfig, type K12Config } from './config';
import { scoreToGrade } from './grading';

export type { K12Config };
export { DEFAULT_K12_CONFIG };

/**
 * =============================================================================
 * K-12 ACADEMIC ENGINE
 * =============================================================================
 *
 * Pure domain logic for primary and secondary schools. No I/O, no clock.
 *
 * WHY THIS IS NOT THE DEGREE ENGINE WITH DIFFERENT LABELS
 * ------------------------------------------------------
 * Three arithmetic differences make sharing the GPA engine wrong:
 *
 *   1. NO CREDIT WEIGHTING. A K-12 subject carries no credit hours, so a termly
 *      average is a plain mean over subjects. Running it through the
 *      credit-weighted GPA with an implied weight of 1 would give the same
 *      number today and the wrong one the moment anyone added weighting.
 *
 *   2. POSITION IS THE HEADLINE. A university reports a GPA; a school reports
 *      "4th of 28". Ranking with correct tie handling is a first-class output
 *      here, and it does not exist on the degree side at all.
 *
 *   3. THE OUTPUT IS A DECISION, NOT A CLASSIFICATION. A degree ends in an
 *      honours band; a school year ends in promoted, repeating, or referred —
 *      and attendance bears on it, which it never does for a GPA.
 *
 * The grading SCALE is shared: a school has one set of bands, and a subject
 * mark is graded through the same `scoreToGrade` the degree side uses. Only
 * the aggregation differs.
 */

// -----------------------------------------------------------------------------
// Policy
// -----------------------------------------------------------------------------

export class K12Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'K12Error';
  }
}

function round1(v: number): number {
  return Math.round((v + Number.EPSILON) * 10) / 10;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// -----------------------------------------------------------------------------
// Ranking
// -----------------------------------------------------------------------------

export interface Rankable {
  id: string;
  score: number;
}

export interface RankedEntry extends Rankable {
  position: number;
  /** True when at least one other entry shares this position. */
  isTied: boolean;
}

/**
 * ALGORITHM: COMPETITION RANKING ("1224")
 * ---------------------------------------
 *   Sort by score descending, then assign:
 *     position = 1 + (number of entries strictly ahead)
 *
 * Two pupils on 82 are both 2nd, and the next pupil is 4th — the position
 * skips, exactly as it does in a race. The alternatives are wrong here:
 *
 *   · Dense ranking (1223) would make the class of 28 report positions up to
 *     20 and imply fewer pupils than there are.
 *   · Ordinal ranking (1234) would break a genuine tie arbitrarily, telling one
 *     of two pupils with identical marks that they came behind the other. On a
 *     document sent home to parents that is indefensible.
 *
 * Complexity: O(n log n) for the sort, O(n) to assign.
 *
 * Ties are broken for ORDERING only by id, so the list renders deterministically
 * — but tied entries still receive the same position, which is the point.
 */
export function rankByScore(entries: readonly Rankable[]): RankedEntry[] {
  const sorted = [...entries].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id),
  );

  const counts = new Map<number, number>();
  for (const e of sorted) counts.set(e.score, (counts.get(e.score) ?? 0) + 1);

  const ranked: RankedEntry[] = [];
  let ahead = 0;
  let lastScore: number | null = null;
  let lastPosition = 0;

  for (const [index, entry] of sorted.entries()) {
    if (lastScore === null || entry.score !== lastScore) {
      // Strictly behind everyone seen so far.
      lastPosition = index + 1;
      lastScore = entry.score;
    }
    ahead = lastPosition;
    ranked.push({
      ...entry,
      position: ahead,
      isTied: (counts.get(entry.score) ?? 0) > 1,
    });
  }

  return ranked;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st" — the report-card rendering. */
export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const lastTwo = abs % 100;
  // 11, 12 and 13 are the exceptions that catch every naive implementation.
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// -----------------------------------------------------------------------------
// Subject marks
// -----------------------------------------------------------------------------

export interface SubjectMark {
  studentId: string;
  subjectCode: string;
  subjectName: string;
  caScore: number | null;
  examScore: number | null;
}

export interface GradedSubject extends SubjectMark {
  totalScore: number | null;
  band: GradeBand | null;
}

/**
 * Grade one subject mark through the school's own scale.
 *
 * A mark with either component missing is NOT graded — it is "not yet
 * assessed", which is different from zero. Treating a blank as a zero would
 * put a fail on a report card for a paper the pupil never sat.
 */
export function gradeSubjectMark(
  mark: SubjectMark,
  grading: GradingConfig,
): GradedSubject {
  if (mark.caScore === null || mark.examScore === null) {
    return { ...mark, totalScore: null, band: null };
  }

  const { ca, exam } = grading.assessmentWeights;
  if (mark.caScore < 0 || mark.caScore > ca) {
    throw new K12Error(
      `Continuous assessment for ${mark.subjectCode} must be between 0 and ${ca}; received ${mark.caScore}.`,
    );
  }
  if (mark.examScore < 0 || mark.examScore > exam) {
    throw new K12Error(
      `Examination for ${mark.subjectCode} must be between 0 and ${exam}; received ${mark.examScore}.`,
    );
  }

  const totalScore = round1(mark.caScore + mark.examScore);
  return { ...mark, totalScore, band: scoreToGrade(totalScore, grading.scale) };
}

// -----------------------------------------------------------------------------
// Termly aggregation
// -----------------------------------------------------------------------------

export interface TermSummary {
  /** Number of subjects that carried a mark. */
  subjectsAssessed: number;
  totalMarks: number;
  /** Subjects assessed × 100. */
  maxMarks: number;
  /** Plain mean over assessed subjects — NOT credit-weighted. */
  average: number;
  overallBand: GradeBand | null;
  bestSubject: string | null;
  weakestSubject: string | null;
}

/**
 * ALGORITHM: TERMLY AGGREGATION
 * -----------------------------
 *   total   = Σ totalScore over ASSESSED subjects
 *   max     = 100 × (number assessed)
 *   average = assessed = 0 ? 0 : total / assessed
 *
 * Unassessed subjects are excluded from both the numerator and the denominator,
 * for the same reason a withdrawal is excluded from a GPA: a subject the pupil
 * has not been marked in cannot pull their average down.
 *
 * The overall grade is the average put back through the SAME scale, so the
 * headline grade and the subject grades cannot disagree about what 68 means.
 *
 * Complexity: O(n).
 */
export function summariseTerm(
  graded: readonly GradedSubject[],
  grading: GradingConfig,
): TermSummary {
  const assessed = graded.filter((g) => g.totalScore !== null);

  if (assessed.length === 0) {
    return {
      subjectsAssessed: 0,
      totalMarks: 0,
      maxMarks: 0,
      average: 0,
      overallBand: null,
      bestSubject: null,
      weakestSubject: null,
    };
  }

  const totalMarks = round1(assessed.reduce((s, g) => s + (g.totalScore ?? 0), 0));
  const average = round1(totalMarks / assessed.length);

  const ordered = [...assessed].sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));

  return {
    subjectsAssessed: assessed.length,
    totalMarks,
    maxMarks: assessed.length * 100,
    average,
    overallBand: scoreToGrade(average, grading.scale),
    bestSubject: ordered[0]?.subjectName ?? null,
    weakestSubject: ordered[ordered.length - 1]?.subjectName ?? null,
  };
}

/** Mean mark across a class for one subject — the "class average" column. */
export function classAverage(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// -----------------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------------

export interface AttendanceTally {
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface AttendanceSummary extends AttendanceTally {
  /** Sessions on which the pupil was expected. */
  totalSessions: number;
  /** Present + late, as a fraction of expected sessions. */
  rate: number;
  ratePercent: number;
}

/**
 * ALGORITHM: ATTENDANCE RATE
 * --------------------------
 *   expected = present + absent + late          (excused is NOT expected)
 *   rate     = expected = 0 ? 1 : (present + late) / expected
 *
 * Two policy decisions, both deliberate:
 *
 *   · LATE COUNTS AS PRESENT for the rate. The pupil attended; lateness is a
 *     punctuality matter reported separately, and folding it into absence would
 *     conflate two different concerns on the promotion decision.
 *   · EXCUSED ABSENCE IS NOT COUNTED AGAINST THE PUPIL and is removed from the
 *     denominator entirely. An authorised medical absence should not push a
 *     pupil below the attendance threshold for promotion.
 *
 * A pupil with no records at all is treated as fully present rather than fully
 * absent: no data means the register was not taken, which is the school's
 * omission, not the child's.
 */
export function summariseAttendance(tally: AttendanceTally): AttendanceSummary {
  const totalSessions = tally.present + tally.absent + tally.late;
  const rate = totalSessions === 0 ? 1 : (tally.present + tally.late) / totalSessions;
  return {
    ...tally,
    totalSessions,
    rate: round2(rate),
    ratePercent: round1(rate * 100),
  };
}

// -----------------------------------------------------------------------------
// Promotion
// -----------------------------------------------------------------------------

export type PromotionDecision = 'PROMOTED' | 'REPEAT' | 'REVIEW' | 'GRADUATED';

export interface PromotionInput {
  average: number;
  attendanceRate: number;
  /** Subject codes the pupil failed, from the compulsory list. */
  failedCompulsory: readonly string[];
  /** True when this is the school's final year group. */
  isTerminalYear: boolean;
}

export interface PromotionResult {
  decision: PromotionDecision;
  reason: string;
  /** True when a human must confirm before the decision takes effect. */
  requiresReview: boolean;
}

/**
 * ALGORITHM: PROMOTION DECISION
 * -----------------------------
 * A guard-clause cascade in strict priority order, so a pupil can never be
 * assigned a more favourable outcome than their worst qualifying condition:
 *
 *   1. average < repeatBelowAverage              -> REPEAT   (requires review)
 *   2. failed a compulsory subject               -> REVIEW
 *   3. attendance < promotionMinAttendance       -> REVIEW
 *   4. average < promotionMinAverage             -> REPEAT   (requires review)
 *   5. terminal year                             -> GRADUATED
 *   6. otherwise                                 -> PROMOTED
 *
 * Complexity: O(1).
 *
 * REPEAT always sets `requiresReview`. Holding a child back a year is one of
 * the most consequential decisions a school makes about them, and it must never
 * be the silent output of a floating-point comparison — the same reason
 * academic dismissal is never applied automatically on the degree side.
 */
export function decidePromotion(
  input: PromotionInput,
  config: K12Config = DEFAULT_K12_CONFIG,
): PromotionResult {
  const { average, attendanceRate, failedCompulsory, isTerminalYear } = input;

  if (average < config.repeatBelowAverage) {
    return {
      decision: 'REPEAT',
      reason: `Average of ${average.toFixed(1)} is below the ${config.repeatBelowAverage.toFixed(1)} threshold for progression.`,
      requiresReview: true,
    };
  }

  if (failedCompulsory.length > 0) {
    return {
      decision: 'REVIEW',
      reason: `Did not pass compulsory ${failedCompulsory.length === 1 ? 'subject' : 'subjects'}: ${failedCompulsory.join(', ')}.`,
      requiresReview: true,
    };
  }

  if (attendanceRate < config.promotionMinAttendance) {
    return {
      decision: 'REVIEW',
      reason: `Attendance of ${(attendanceRate * 100).toFixed(1)}% is below the ${(config.promotionMinAttendance * 100).toFixed(0)}% required for automatic promotion.`,
      requiresReview: true,
    };
  }

  if (average < config.promotionMinAverage) {
    return {
      decision: 'REPEAT',
      reason: `Average of ${average.toFixed(1)} is below the ${config.promotionMinAverage.toFixed(1)} promotion mark.`,
      requiresReview: true,
    };
  }

  if (isTerminalYear) {
    return {
      decision: 'GRADUATED',
      reason: `Completed the final year with an average of ${average.toFixed(1)}.`,
      requiresReview: false,
    };
  }

  return {
    decision: 'PROMOTED',
    reason: `Average of ${average.toFixed(1)} meets the ${config.promotionMinAverage.toFixed(1)} promotion threshold.`,
    requiresReview: false,
  };
}

// -----------------------------------------------------------------------------
// Report card assembly
// -----------------------------------------------------------------------------

export interface ReportCardInput {
  graded: readonly GradedSubject[];
  /** Class average and position per subject code, computed across the class. */
  perSubject: ReadonlyMap<string, { classAverage: number; position: number | null }>;
  attendance: AttendanceSummary;
  /** This pupil's position and the size of the class, on the termly average. */
  positionInClass: number;
  classSize: number;
  /** Mean termly average across the whole class. */
  classAverage: number;
  isTerminalYear: boolean;
}

export interface AssembledReportCard {
  summary: TermSummary;
  lines: {
    subjectCode: string;
    subjectName: string;
    caScore: number | null;
    examScore: number | null;
    totalScore: number | null;
    letterGrade: string | null;
    classAverage: number | null;
    positionInClass: number | null;
  }[];
  attendance: AttendanceSummary;
  positionInClass: number;
  positionLabel: string;
  classSize: number;
  classAverage: number;
  promotion: PromotionResult;
}

/**
 * Assemble everything a report card states, from the marks alone.
 *
 * Nothing on the card is typed in by hand: the total, the average, the overall
 * grade, the position and the promotion decision are all derived here. A card
 * whose stated total does not equal the sum of its own rows is the single most
 * embarrassing thing a school can hand a parent, and the only reliable way to
 * prevent it is to never let a human enter the summary.
 */
export function assembleReportCard(
  input: ReportCardInput,
  grading: GradingConfig,
  config: K12Config = DEFAULT_K12_CONFIG,
): AssembledReportCard {
  const summary = summariseTerm(input.graded, grading);

  const failedCompulsory = input.graded
    .filter(
      (g) =>
        config.compulsorySubjectCodes.includes(g.subjectCode) &&
        g.band !== null &&
        g.band.point < grading.passingGradePoint,
    )
    .map((g) => g.subjectCode);

  const promotion = decidePromotion(
    {
      average: summary.average,
      attendanceRate: input.attendance.rate,
      failedCompulsory,
      isTerminalYear: input.isTerminalYear,
    },
    config,
  );

  const lines = input.graded.map((g) => {
    const per = input.perSubject.get(g.subjectCode);
    return {
      subjectCode: g.subjectCode,
      subjectName: g.subjectName,
      caScore: g.caScore,
      examScore: g.examScore,
      totalScore: g.totalScore,
      letterGrade: g.band?.letter ?? null,
      classAverage: per?.classAverage ?? null,
      positionInClass: per?.position ?? null,
    };
  });

  return {
    summary,
    lines,
    attendance: input.attendance,
    positionInClass: input.positionInClass,
    positionLabel: ordinal(input.positionInClass),
    classSize: input.classSize,
    classAverage: round1(input.classAverage),
    promotion,
  };
}

/** Human-quotable report reference, e.g. RPT-GIS-2025-000418. */
export function buildReportReference(
  schoolCode: string,
  year: number,
  sequence: number,
): string {
  return `RPT-${schoolCode.toUpperCase()}-${year}-${String(sequence).padStart(6, '0')}`;
}
