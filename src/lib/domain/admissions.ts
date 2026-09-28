/**
 * =============================================================================
 * ADMISSIONS SCORING, RANKING & DECISION ENGINE
 * =============================================================================
 *
 * Pure domain logic — deterministic, side-effect free, and independently
 * testable. Admissions decisions are contestable by applicants and auditable by
 * regulators, so every number the system produces must be reconstructable from
 * the stored inputs alone. Nothing here reads a clock or a database.
 */

import { APPLICATION_TRANSITIONS, type ApplicationStatus, type ReviewRecommendation } from './enums';
import { DEFAULT_ADMISSIONS_CONFIG, type AdmissionsConfig } from './config';

export type { AdmissionsConfig };

// -----------------------------------------------------------------------------
// Rubric configuration
// -----------------------------------------------------------------------------

/**
 * Weights for the composite score. MUST sum to 1.0 — enforced at module load by
 * `assertWeightsSumToOne`. Each component is on an independent 0-100 scale, so
 * the composite is also 0-100 and directly comparable across cohorts.
 */
/** The DEFAULT rubric. A school passes its own weights. */
export const ADMISSION_WEIGHTS = DEFAULT_ADMISSIONS_CONFIG.weights;

export type ScoreComponent = keyof typeof ADMISSION_WEIGHTS;

export function assertWeightsSumToOne(
  weights: AdmissionsConfig['weights'] = DEFAULT_ADMISSIONS_CONFIG.weights,
): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`Admission weights must sum to 1.0; they sum to ${sum}.`);
  }
}

/** Applications below this composite are auto-rejected without committee time. */
export const AUTO_REJECT_THRESHOLD = DEFAULT_ADMISSIONS_CONFIG.autoRejectThreshold;
/** Applications at or above this composite are auto-admitted if capacity allows. */
export const AUTO_ADMIT_THRESHOLD = 85;
/** Minimum number of independent reviews before a decision may be issued. */
export const MIN_REVIEWS_REQUIRED = DEFAULT_ADMISSIONS_CONFIG.minReviewsRequired;
/**
 * If two reviewers' composites differ by more than this, the application is
 * flagged for a third adjudicating review rather than averaged. Averaging away
 * genuine disagreement is how bad admissions decisions get laundered into
 * defensible-looking numbers.
 */
export const REVIEWER_DISAGREEMENT_THRESHOLD = DEFAULT_ADMISSIONS_CONFIG.reviewerDisagreementThreshold;

// -----------------------------------------------------------------------------
// Composite scoring
// -----------------------------------------------------------------------------

export interface ScoreInputs {
  priorGpaScore: number | null;
  entranceExamScore: number | null;
  essayScore: number | null;
  interviewScore: number | null;
  extracurricularScore: number | null;
}

export interface CompositeResult {
  composite: number;
  /** Per-component contribution to the composite, for the decision letter. */
  breakdown: { component: ScoreComponent; raw: number; weight: number; contribution: number }[];
  /** Components that were missing and therefore excluded. */
  missingComponents: ScoreComponent[];
  /** Sum of the weights that were actually available. */
  coverage: number;
}

function clamp(value: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, value));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * ALGORITHM: WEIGHTED COMPOSITE WITH WEIGHT RENORMALISATION
 * --------------------------------------------------------
 *   composite = ( Σ  wᵢ · sᵢ ) / ( Σ  wᵢ )      over components present
 *
 * The denominator is the key detail. A naive implementation treats a missing
 * component as zero, which silently converts "we have no interview score yet"
 * into "this applicant interviewed terribly" — a 10-point penalty for an
 * administrative gap. Renormalising over available weight instead answers the
 * honest question: given what we know, how does this applicant score?
 *
 * `coverage` is returned so the caller can refuse to decide on thin evidence;
 * a composite built from 45% of the rubric is a number, not a judgement.
 *
 * Complexity: O(1) — five fixed components.
 */
export function computeCompositeScore(
  inputs: ScoreInputs,
  weights: AdmissionsConfig['weights'] = DEFAULT_ADMISSIONS_CONFIG.weights,
): CompositeResult {
  const components: { component: ScoreComponent; value: number | null }[] = [
    { component: 'priorGpa', value: inputs.priorGpaScore },
    { component: 'entranceExam', value: inputs.entranceExamScore },
    { component: 'essay', value: inputs.essayScore },
    { component: 'interview', value: inputs.interviewScore },
    { component: 'extracurricular', value: inputs.extracurricularScore },
  ];

  const breakdown: CompositeResult['breakdown'] = [];
  const missingComponents: ScoreComponent[] = [];
  let weightedSum = 0;
  let coverage = 0;

  for (const { component, value } of components) {
    const weight = weights[component];
    if (value === null || !Number.isFinite(value)) {
      missingComponents.push(component);
      continue;
    }
    const raw = clamp(value);
    weightedSum += weight * raw;
    coverage += weight;
    breakdown.push({ component, raw, weight, contribution: round2(weight * raw) });
  }

  const composite = coverage === 0 ? 0 : weightedSum / coverage;

  return {
    composite: round2(composite),
    breakdown,
    missingComponents,
    coverage: round2(coverage),
  };
}

// -----------------------------------------------------------------------------
// Reviewer aggregation
// -----------------------------------------------------------------------------

export interface ReviewerScores {
  reviewerId: string;
  academicScore: number;
  essayScore: number;
  interviewScore: number | null;
  extracurricularScore: number | null;
  recommendation: ReviewRecommendation;
}

export interface AggregatedReview {
  /** Mean of each rubric dimension across reviewers. */
  academicScore: number;
  essayScore: number;
  interviewScore: number | null;
  extracurricularScore: number | null;
  reviewCount: number;
  /** Max pairwise spread on the academic dimension. */
  disagreementSpread: number;
  /** True when spread exceeds the threshold — needs a third reviewer. */
  requiresAdjudication: boolean;
  /** Modal recommendation; ties resolve to the more conservative option. */
  consensusRecommendation: ReviewRecommendation | null;
}

/**
 * ALGORITHM: MULTI-REVIEWER AGGREGATION
 * -------------------------------------
 * 1. Mean each dimension across reviewers, ignoring nulls per dimension so one
 *    reviewer skipping the interview does not drag the interview mean to zero.
 * 2. Measure disagreement as the range (max − min) on the academic dimension,
 *    the one reviewers are most expected to agree on. A range above
 *    REVIEWER_DISAGREEMENT_THRESHOLD means the reviewers are not looking at the
 *    same applicant; flag for adjudication rather than average.
 * 3. Take the modal recommendation. Ties break CONSERVATIVELY
 *    (REJECT > WAITLIST > ADMIT), because a split committee should not admit.
 *
 * Complexity: O(r) in the number of reviewers.
 */
export function aggregateReviews(
  reviews: readonly ReviewerScores[],
  disagreementThreshold: number = DEFAULT_ADMISSIONS_CONFIG.reviewerDisagreementThreshold,
): AggregatedReview {
  if (reviews.length === 0) {
    return {
      academicScore: 0,
      essayScore: 0,
      interviewScore: null,
      extracurricularScore: null,
      reviewCount: 0,
      disagreementSpread: 0,
      requiresAdjudication: false,
      consensusRecommendation: null,
    };
  }

  const meanOf = (pick: (r: ReviewerScores) => number | null): number | null => {
    const values = reviews.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length === 0) return null;
    return round2(values.reduce((a, b) => a + b, 0) / values.length);
  };

  const academics = reviews.map((r) => r.academicScore);
  const disagreementSpread = round2(Math.max(...academics) - Math.min(...academics));

  // Modal recommendation with conservative tie-breaking.
  const tally: Record<ReviewRecommendation, number> = { ADMIT: 0, WAITLIST: 0, REJECT: 0 };
  for (const r of reviews) tally[r.recommendation] += 1;
  const priority: ReviewRecommendation[] = ['REJECT', 'WAITLIST', 'ADMIT'];
  let consensus: ReviewRecommendation = 'REJECT';
  let bestCount = -1;
  for (const rec of priority) {
    if (tally[rec] > bestCount) {
      bestCount = tally[rec];
      consensus = rec;
    }
  }

  return {
    academicScore: meanOf((r) => r.academicScore) ?? 0,
    essayScore: meanOf((r) => r.essayScore) ?? 0,
    interviewScore: meanOf((r) => r.interviewScore),
    extracurricularScore: meanOf((r) => r.extracurricularScore),
    reviewCount: reviews.length,
    disagreementSpread,
    requiresAdjudication: disagreementSpread > disagreementThreshold,
    consensusRecommendation: consensus,
  };
}

// -----------------------------------------------------------------------------
// Cohort ranking and capacity allocation
// -----------------------------------------------------------------------------

export interface RankableApplication {
  applicationId: string;
  referenceNo: string;
  composite: number;
  coverage: number;
  reviewCount: number;
  /** Earlier submissions win ties — rewards promptness, and is defensible. */
  submittedAtMs: number;
}

export interface AllocationPolicy {
  /** Seats available in this (program, term) cohort. */
  capacity: number;
  /** How many waitlist places to hold open. */
  waitlistCapacity: number;
  /** Composite below which we reject regardless of remaining capacity. */
  minimumComposite: number;
  /** Reject rather than decide when rubric coverage is below this fraction. */
  minimumCoverage: number;
  requiredReviews: number;
}

export const DEFAULT_ALLOCATION_POLICY: AllocationPolicy = {
  capacity: 0,
  waitlistCapacity: 0,
  minimumComposite: AUTO_REJECT_THRESHOLD,
  minimumCoverage: 0.7,
  requiredReviews: MIN_REVIEWS_REQUIRED,
};

export interface AllocationDecision {
  applicationId: string;
  referenceNo: string;
  rank: number;
  composite: number;
  status: Extract<ApplicationStatus, 'OFFERED' | 'WAITLISTED' | 'REJECTED' | 'UNDER_REVIEW'>;
  rationale: string;
}

/**
 * ALGORITHM: RANK-AND-FILL COHORT ALLOCATION
 * ------------------------------------------
 * The core admissions decision. Given a pool of scored applications and a fixed
 * number of seats, produce a ranked, fully-justified decision for every
 * applicant.
 *
 *   Phase 1 — SCREEN   O(n)
 *     Partition the pool. Applications failing an objective gate are decided
 *     immediately and removed from contention:
 *       · reviewCount < requiredReviews  -> UNDER_REVIEW (not yet decidable)
 *       · coverage    < minimumCoverage  -> UNDER_REVIEW (insufficient evidence)
 *       · composite   < minimumComposite -> REJECTED     (below the bar)
 *
 *   Phase 2 — RANK     O(n log n)
 *     Sort survivors by a total order:
 *       composite DESC, then coverage DESC, then submittedAt ASC.
 *     The three-key comparator guarantees determinism. A comparator that can
 *     return 0 for distinct applications makes the sort implementation-defined,
 *     which means the same pool can produce different admits on different runs
 *     — indefensible if challenged.
 *
 *   Phase 3 — FILL     O(n)
 *     Walk the ranked list assigning OFFERED while seats remain, then
 *     WAITLISTED while waitlist places remain, then REJECTED.
 *
 * Total: O(n log n) time, O(n) space.
 *
 * The function is deterministic and returns decisions for the entire pool, so
 * a committee can diff two runs under different policies before committing.
 */
export function allocateCohort(
  pool: readonly RankableApplication[],
  policy: AllocationPolicy,
): AllocationDecision[] {
  const decisions: AllocationDecision[] = [];
  const contenders: RankableApplication[] = [];

  // Phase 1 — screen.
  for (const app of pool) {
    if (app.reviewCount < policy.requiredReviews) {
      decisions.push({
        applicationId: app.applicationId,
        referenceNo: app.referenceNo,
        rank: 0,
        composite: app.composite,
        status: 'UNDER_REVIEW',
        rationale: `Awaiting review: ${app.reviewCount} of ${policy.requiredReviews} required reviews received.`,
      });
      continue;
    }
    if (app.coverage < policy.minimumCoverage) {
      decisions.push({
        applicationId: app.applicationId,
        referenceNo: app.referenceNo,
        rank: 0,
        composite: app.composite,
        status: 'UNDER_REVIEW',
        rationale: `Incomplete rubric: only ${(app.coverage * 100).toFixed(0)}% of scoring components supplied.`,
      });
      continue;
    }
    if (app.composite < policy.minimumComposite) {
      decisions.push({
        applicationId: app.applicationId,
        referenceNo: app.referenceNo,
        rank: 0,
        composite: app.composite,
        status: 'REJECTED',
        rationale: `Composite ${app.composite.toFixed(2)} is below the minimum admissible score of ${policy.minimumComposite}.`,
      });
      continue;
    }
    contenders.push(app);
  }

  // Phase 2 — rank under a strict total order.
  contenders.sort(compareApplications);

  // Phase 3 — fill.
  let seatsLeft = policy.capacity;
  let waitlistLeft = policy.waitlistCapacity;

  contenders.forEach((app, index) => {
    const rank = index + 1;

    if (seatsLeft > 0) {
      seatsLeft -= 1;
      decisions.push({
        applicationId: app.applicationId,
        referenceNo: app.referenceNo,
        rank,
        composite: app.composite,
        status: 'OFFERED',
        rationale: `Ranked ${rank} of ${contenders.length} with a composite of ${app.composite.toFixed(2)}; offer extended within a cohort capacity of ${policy.capacity}.`,
      });
      return;
    }

    if (waitlistLeft > 0) {
      waitlistLeft -= 1;
      decisions.push({
        applicationId: app.applicationId,
        referenceNo: app.referenceNo,
        rank,
        composite: app.composite,
        status: 'WAITLISTED',
        rationale: `Ranked ${rank} of ${contenders.length}; cohort capacity of ${policy.capacity} exhausted, placed on the waiting list.`,
      });
      return;
    }

    decisions.push({
      applicationId: app.applicationId,
      referenceNo: app.referenceNo,
      rank,
      composite: app.composite,
      status: 'REJECTED',
      rationale: `Ranked ${rank} of ${contenders.length}; both cohort capacity (${policy.capacity}) and the waiting list (${policy.waitlistCapacity}) are exhausted.`,
    });
  });

  return decisions;
}

/** Strict total order: composite DESC, coverage DESC, submittedAt ASC, id ASC. */
export function compareApplications(a: RankableApplication, b: RankableApplication): number {
  if (b.composite !== a.composite) return b.composite - a.composite;
  if (b.coverage !== a.coverage) return b.coverage - a.coverage;
  if (a.submittedAtMs !== b.submittedAtMs) return a.submittedAtMs - b.submittedAtMs;
  return a.applicationId.localeCompare(b.applicationId);
}

// -----------------------------------------------------------------------------
// Matriculation number allocation
// -----------------------------------------------------------------------------

/**
 * Build a matriculation number of the form  GEU/CSC/2025/0417.
 *
 * The sequence is scoped to (department, year) so it stays short and legible.
 * The caller is responsible for obtaining `sequence` inside the same
 * transaction that creates the student row — otherwise two concurrent
 * conversions can mint the same number. Uniqueness is additionally guaranteed
 * by the UNIQUE constraint on `students.matricNumber`, which turns a race into
 * a retryable error rather than a duplicate identity.
 */
export function buildMatricNumber(
  institutionShort: string,
  departmentCode: string,
  year: number,
  sequence: number,
): string {
  return [
    institutionShort.toUpperCase(),
    departmentCode.toUpperCase(),
    String(year),
    String(sequence).padStart(4, '0'),
  ].join('/');
}

/** Human-quotable application reference, e.g. APP-2025-000418. */
export function buildApplicationReference(year: number, sequence: number): string {
  return `APP-${year}-${String(sequence).padStart(6, '0')}`;
}

// -----------------------------------------------------------------------------
// Offer expiry
// -----------------------------------------------------------------------------

export const OFFER_VALIDITY_DAYS = DEFAULT_ADMISSIONS_CONFIG.offerValidityDays;

export function computeOfferExpiry(decidedAt: Date, validityDays = OFFER_VALIDITY_DAYS): Date {
  const expiry = new Date(decidedAt.getTime());
  expiry.setDate(expiry.getDate() + validityDays);
  return expiry;
}

/**
 * An offer is live only while it is OFFERED and unexpired. Expiry is evaluated
 * lazily at read time rather than by a background job: a cron that has not run
 * yet must never be able to let an applicant accept a stale offer.
 */
export function isOfferLive(
  status: ApplicationStatus,
  offerExpiresAt: Date | null,
  now: Date,
): boolean {
  if (status !== 'OFFERED') return false;
  if (!offerExpiresAt) return true;
  return now <= offerExpiresAt;
}

// -----------------------------------------------------------------------------
// What a cohort run actually does
// -----------------------------------------------------------------------------

/**
 * Places in an intake already spoken for, before a run fills any more.
 *
 * The committee enters the intake's TOTAL places. A run used to treat that
 * number as the places left to fill, so re-running with the intake size —
 * the natural thing to type — offered every place a second time.
 *
 * A place is held by a LIVE offer, an accepted one, or an enrolment. A lapsed
 * offer holds nothing even if the nightly job has not yet marked it EXPIRED:
 * nobody can accept it, and counting it would leave a real place unfilled.
 */
export function placesHeld(
  applications: readonly { status: string; offerExpiresAt: Date | null }[],
  now: Date,
): number {
  return applications.filter(
    (a) =>
      a.status === 'ACCEPTED' ||
      a.status === 'ENROLLED' ||
      isOfferLive(a.status as ApplicationStatus, a.offerExpiresAt, now),
  ).length;
}

/**
 * The status an application actually ends in when a run decides `decided`
 * for it — or null when the run leaves it as it is.
 *
 * The allocator decides; the state machine has the final word. Computed once
 * and used for BOTH the preview and the commit, so the numbers the committee
 * approves are the numbers written. They used to count decisions, and a
 * decision the state machine then refused was reported as made.
 *
 * One path is walked rather than refused: a SUBMITTED application that meets
 * the committee's screening — possible when the committee requires no reviews
 * — goes through UNDER_REVIEW to its outcome, both legal steps. Refusing it
 * was worse than untidy: it had already taken a place in the ranking, so the
 * place went to nobody.
 */
export function outcomeOf(current: ApplicationStatus, decided: ApplicationStatus): ApplicationStatus | null {
  if (decided === current) return null;
  // A holding state, not a decision: only a fresh application enters it, and
  // nothing that has already advanced is moved back into it.
  if (decided === 'UNDER_REVIEW') return current === 'SUBMITTED' ? 'UNDER_REVIEW' : null;
  if (APPLICATION_TRANSITIONS[current]?.includes(decided)) return decided;
  if (current === 'SUBMITTED' && APPLICATION_TRANSITIONS.UNDER_REVIEW.includes(decided)) return decided;
  return null;
}

// -----------------------------------------------------------------------------
// Telling the applicant
// -----------------------------------------------------------------------------

export interface DecisionNotice {
  title: string;
  body: string;
}

/**
 * What an applicant is told when a cohort run decides their application.
 *
 * Only the three outcomes an applicant can act on or needs to know. UNDER_REVIEW
 * is an internal holding state — telling somebody "your application is under
 * review" every time a committee previews a run is noise that trains them to
 * ignore the one message that matters.
 *
 * The offer names its deadline, because an offer the applicant does not know is
 * lapsing is the most expensive message to lose: they miss the place, and the
 * school leaves a seat empty that the waitlist could have filled.
 *
 * Dates arrive pre-formatted so this stays free of locale and clock.
 */
export function decisionNotice(
  status: ApplicationStatus,
  programName: string,
  offerExpiresOn: string | null,
): DecisionNotice | null {
  switch (status) {
    case 'OFFERED':
      return {
        title: `You have been offered a place on ${programName}`,
        body: offerExpiresOn
          ? `Accept or decline it in the applicant portal before ${offerExpiresOn}. An offer that is not accepted by then lapses and the place goes to somebody else.`
          : 'Accept or decline it in the applicant portal.',
      };
    case 'WAITLISTED':
      return {
        title: `Your application to ${programName} is on the waiting list`,
        body: 'No place is available yet. If one becomes free you will be offered it, and told here. There is nothing you need to do in the meantime.',
      };
    case 'REJECTED':
      return {
        title: `A decision on your application to ${programName}`,
        body: 'We are sorry to tell you that we are unable to offer you a place this time. The decision is in the applicant portal.',
      };
    default:
      return null;
  }
}
