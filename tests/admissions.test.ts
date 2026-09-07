import { describe, expect, it } from 'vitest';

import {
  aggregateReviews,
  allocateCohort,
  assertWeightsSumToOne,
  buildApplicationReference,
  buildMatricNumber,
  compareApplications,
  computeCompositeScore,
  computeOfferExpiry,
  isOfferLive,
  type AllocationPolicy,
  type RankableApplication,
} from '@/lib/domain/admissions';
import { assertApplicationTransition, APPLICATION_TRANSITIONS } from '@/lib/domain/enums';

describe('rubric weights', () => {
  it('sum to exactly 1.0', () => {
    expect(() => assertWeightsSumToOne()).not.toThrow();
  });
});

describe('composite scoring', () => {
  it('computes the weighted mean when every component is present', () => {
    const result = computeCompositeScore({
      priorGpaScore: 80,
      entranceExamScore: 80,
      essayScore: 80,
      interviewScore: 80,
      extracurricularScore: 80,
    });
    expect(result.composite).toBe(80);
    expect(result.coverage).toBe(1);
    expect(result.missingComponents).toEqual([]);
  });

  it('renormalises over available weight instead of treating a gap as zero', () => {
    // The heart of the algorithm. With only the two academic components, a
    // naive implementation scores 0.4*90 + 0.3*90 = 63 — a 27-point penalty for
    // an administrative gap. Renormalising gives the honest answer: 90.
    const result = computeCompositeScore({
      priorGpaScore: 90,
      entranceExamScore: 90,
      essayScore: null,
      interviewScore: null,
      extracurricularScore: null,
    });
    expect(result.composite).toBe(90);
    expect(result.coverage).toBe(0.7);
    expect(result.missingComponents).toEqual(['essay', 'interview', 'extracurricular']);
  });

  it('reports each component’s contribution for the decision letter', () => {
    const result = computeCompositeScore({
      priorGpaScore: 100,
      entranceExamScore: 0,
      essayScore: null,
      interviewScore: null,
      extracurricularScore: null,
    });
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toMatchObject({ component: 'priorGpa', contribution: 40 });
  });

  it('clamps out-of-range scores rather than propagating them', () => {
    const result = computeCompositeScore({
      priorGpaScore: 150,
      entranceExamScore: -20,
      essayScore: null,
      interviewScore: null,
      extracurricularScore: null,
    });
    expect(result.breakdown[0].raw).toBe(100);
    expect(result.breakdown[1].raw).toBe(0);
  });

  it('returns zero with zero coverage when nothing is scored', () => {
    const result = computeCompositeScore({
      priorGpaScore: null,
      entranceExamScore: null,
      essayScore: null,
      interviewScore: null,
      extracurricularScore: null,
    });
    expect(result.composite).toBe(0);
    expect(result.coverage).toBe(0);
  });
});

describe('reviewer aggregation', () => {
  const review = (over: Partial<Parameters<typeof aggregateReviews>[0][number]> = {}) => ({
    reviewerId: 'r1',
    academicScore: 80,
    essayScore: 75,
    interviewScore: 70,
    extracurricularScore: 65,
    recommendation: 'ADMIT' as const,
    ...over,
  });

  it('means each dimension independently, ignoring nulls per dimension', () => {
    // One reviewer skipping the interview must not drag the interview mean to
    // zero — it should simply not be their score being averaged.
    const result = aggregateReviews([
      review({ interviewScore: 80 }),
      review({ reviewerId: 'r2', interviewScore: null }),
    ]);
    expect(result.interviewScore).toBe(80);
  });

  it('flags substantial reviewer disagreement instead of averaging it away', () => {
    const result = aggregateReviews([
      review({ academicScore: 90 }),
      review({ reviewerId: 'r2', academicScore: 50 }),
    ]);
    expect(result.disagreementSpread).toBe(40);
    expect(result.requiresAdjudication).toBe(true);
  });

  it('does not flag ordinary variation', () => {
    const result = aggregateReviews([
      review({ academicScore: 80 }),
      review({ reviewerId: 'r2', academicScore: 72 }),
    ]);
    expect(result.requiresAdjudication).toBe(false);
  });

  it('takes the modal recommendation', () => {
    const result = aggregateReviews([
      review({ recommendation: 'ADMIT' }),
      review({ reviewerId: 'r2', recommendation: 'ADMIT' }),
      review({ reviewerId: 'r3', recommendation: 'REJECT' }),
    ]);
    expect(result.consensusRecommendation).toBe('ADMIT');
  });

  it('breaks a tied recommendation conservatively', () => {
    // A split committee should not admit.
    const result = aggregateReviews([
      review({ recommendation: 'ADMIT' }),
      review({ reviewerId: 'r2', recommendation: 'REJECT' }),
    ]);
    expect(result.consensusRecommendation).toBe('REJECT');
  });

  it('returns a safe empty aggregate for no reviews', () => {
    const result = aggregateReviews([]);
    expect(result.reviewCount).toBe(0);
    expect(result.consensusRecommendation).toBeNull();
  });
});

describe('cohort allocation', () => {
  const app = (over: Partial<RankableApplication> & { applicationId: string }): RankableApplication => ({
    referenceNo: over.applicationId,
    composite: 75,
    coverage: 1,
    reviewCount: 2,
    submittedAtMs: 1_000,
    ...over,
  });

  const policy: AllocationPolicy = {
    capacity: 2,
    waitlistCapacity: 1,
    minimumComposite: 40,
    minimumCoverage: 0.7,
    requiredReviews: 2,
  };

  it('offers, waitlists then rejects strictly in rank order', () => {
    const decisions = allocateCohort(
      [
        app({ applicationId: 'low', composite: 60 }),
        app({ applicationId: 'top', composite: 95 }),
        app({ applicationId: 'mid', composite: 80 }),
        app({ applicationId: 'bottom', composite: 55 }),
      ],
      policy,
    );

    const byId = Object.fromEntries(decisions.map((d) => [d.applicationId, d]));
    expect(byId.top.status).toBe('OFFERED');
    expect(byId.top.rank).toBe(1);
    expect(byId.mid.status).toBe('OFFERED');
    expect(byId.low.status).toBe('WAITLISTED');
    expect(byId.bottom.status).toBe('REJECTED');
  });

  it('screens out applications below the minimum composite', () => {
    const decisions = allocateCohort([app({ applicationId: 'weak', composite: 20 })], policy);
    expect(decisions[0].status).toBe('REJECTED');
    expect(decisions[0].rationale).toMatch(/below the minimum/);
  });

  it('holds under-reviewed applications rather than deciding them', () => {
    const decisions = allocateCohort(
      [app({ applicationId: 'thin', reviewCount: 1 })],
      policy,
    );
    expect(decisions[0].status).toBe('UNDER_REVIEW');
    expect(decisions[0].rationale).toMatch(/1 of 2/);
  });

  it('holds applications with insufficient rubric coverage', () => {
    const decisions = allocateCohort([app({ applicationId: 'sparse', coverage: 0.4 })], policy);
    expect(decisions[0].status).toBe('UNDER_REVIEW');
    expect(decisions[0].rationale).toMatch(/Incomplete rubric/);
  });

  it('returns a decision for every application in the pool', () => {
    const pool = [
      app({ applicationId: 'a' }),
      app({ applicationId: 'b', reviewCount: 0 }),
      app({ applicationId: 'c', composite: 10 }),
    ];
    expect(allocateCohort(pool, policy)).toHaveLength(3);
  });

  it('is deterministic — the same pool in any order gives the same outcome', () => {
    // Indefensible otherwise: the same committee decision must not depend on
    // row order coming back from the database.
    const pool = [
      app({ applicationId: 'a', composite: 80, submittedAtMs: 200 }),
      app({ applicationId: 'b', composite: 80, submittedAtMs: 100 }),
      app({ applicationId: 'c', composite: 80, submittedAtMs: 300 }),
    ];
    const first = allocateCohort(pool, policy);
    const second = allocateCohort([...pool].reverse(), policy);

    const norm = (d: typeof first) =>
      d.map((x) => `${x.applicationId}:${x.status}:${x.rank}`).sort();
    expect(norm(first)).toEqual(norm(second));
  });

  it('breaks a composite tie in favour of the earlier submission', () => {
    const decisions = allocateCohort(
      [
        app({ applicationId: 'late', composite: 80, submittedAtMs: 900 }),
        app({ applicationId: 'early', composite: 80, submittedAtMs: 100 }),
      ],
      { ...policy, capacity: 1, waitlistCapacity: 0 },
    );
    expect(decisions.find((d) => d.applicationId === 'early')?.status).toBe('OFFERED');
    expect(decisions.find((d) => d.applicationId === 'late')?.status).toBe('REJECTED');
  });

  it('rejects everyone when capacity is zero', () => {
    const decisions = allocateCohort(
      [app({ applicationId: 'a' }), app({ applicationId: 'b' })],
      { ...policy, capacity: 0, waitlistCapacity: 0 },
    );
    expect(decisions.every((d) => d.status === 'REJECTED')).toBe(true);
  });

  it('gives every decision a stated rationale', () => {
    const decisions = allocateCohort(
      [app({ applicationId: 'a' }), app({ applicationId: 'b', composite: 10 })],
      policy,
    );
    expect(decisions.every((d) => d.rationale.length > 20)).toBe(true);
  });
});

describe('comparator', () => {
  it('imposes a strict total order across all three keys', () => {
    const base = { referenceNo: 'x', composite: 80, coverage: 1, reviewCount: 2, submittedAtMs: 100 };
    expect(
      compareApplications({ ...base, applicationId: 'a' }, { ...base, applicationId: 'b', composite: 70 }),
    ).toBeLessThan(0);
    expect(
      compareApplications({ ...base, applicationId: 'a' }, { ...base, applicationId: 'b', coverage: 0.8 }),
    ).toBeLessThan(0);
    expect(
      compareApplications({ ...base, applicationId: 'a' }, { ...base, applicationId: 'b', submittedAtMs: 200 }),
    ).toBeLessThan(0);
    // Fully identical except id — must still be a strict order, never 0.
    expect(
      compareApplications({ ...base, applicationId: 'a' }, { ...base, applicationId: 'b' }),
    ).not.toBe(0);
  });
});

describe('offer lifecycle', () => {
  it('computes an expiry the configured number of days out', () => {
    const expiry = computeOfferExpiry(new Date('2025-09-01'), 21);
    expect(expiry.toISOString().slice(0, 10)).toBe('2025-09-22');
  });

  it('treats an offer as live only while OFFERED and unexpired', () => {
    const expires = new Date('2025-09-22');
    expect(isOfferLive('OFFERED', expires, new Date('2025-09-10'))).toBe(true);
    expect(isOfferLive('OFFERED', expires, new Date('2025-09-30'))).toBe(false);
    expect(isOfferLive('ACCEPTED', expires, new Date('2025-09-10'))).toBe(false);
    expect(isOfferLive('WAITLISTED', expires, new Date('2025-09-10'))).toBe(false);
  });
});

describe('application state machine', () => {
  it('permits the documented transitions', () => {
    expect(() => assertApplicationTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    expect(() => assertApplicationTransition('UNDER_REVIEW', 'OFFERED')).not.toThrow();
    expect(() => assertApplicationTransition('OFFERED', 'ACCEPTED')).not.toThrow();
    expect(() => assertApplicationTransition('ACCEPTED', 'ENROLLED')).not.toThrow();
    expect(() => assertApplicationTransition('WAITLISTED', 'OFFERED')).not.toThrow();
  });

  it('rejects transitions that would rewrite history', () => {
    expect(() => assertApplicationTransition('REJECTED', 'OFFERED')).toThrow();
    expect(() => assertApplicationTransition('ENROLLED', 'DRAFT')).toThrow();
    expect(() => assertApplicationTransition('DRAFT', 'ENROLLED')).toThrow();
  });

  it('makes every terminal state genuinely terminal', () => {
    for (const terminal of ['REJECTED', 'DECLINED', 'ENROLLED', 'WITHDRAWN', 'EXPIRED'] as const) {
      expect(APPLICATION_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('identifier construction', () => {
  it('builds a zero-padded matriculation number', () => {
    expect(buildMatricNumber('geu', 'csc', 2025, 7)).toBe('GEU/CSC/2025/0007');
  });

  it('builds a zero-padded application reference', () => {
    expect(buildApplicationReference(2025, 418)).toBe('APP-2025-000418');
  });
});
