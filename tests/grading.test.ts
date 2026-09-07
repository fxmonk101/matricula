import { describe, expect, it } from 'vitest';

import {
  assertScaleIsWellFormed,
  auditGraduation,
  classifyDegree,
  computeGpa,
  computeTotalScore,
  determineAcademicStanding,
  GradingError,
  roundTo,
  scoreToGrade,
  selectGpaAttempts,
  type GradedAttempt,
} from '@/lib/domain/grading';

/** Builder so each test states only the field it actually cares about. */
function attempt(over: Partial<GradedAttempt> & { enrollmentId: string }): GradedAttempt {
  return {
    courseId: `course-${over.enrollmentId}`,
    courseCode: 'CSC101',
    courseTitle: 'Intro',
    creditHours: 3,
    gradePoint: 4,
    letterGrade: 'A',
    totalScore: 80,
    termSequence: 1,
    ...over,
  };
}

describe('grading scale', () => {
  it('is contiguous and covers [0, 100] with no gaps or overlaps', () => {
    expect(() => assertScaleIsWellFormed()).not.toThrow();
  });

  it('maps boundary scores to the correct band', () => {
    expect(scoreToGrade(100).letter).toBe('A');
    expect(scoreToGrade(70).letter).toBe('A');
    expect(scoreToGrade(69.9).letter).toBe('B');
    expect(scoreToGrade(60).letter).toBe('B');
    expect(scoreToGrade(50).letter).toBe('C');
    expect(scoreToGrade(45).letter).toBe('D');
    expect(scoreToGrade(40).letter).toBe('E');
    expect(scoreToGrade(39.9).letter).toBe('F');
    expect(scoreToGrade(0).letter).toBe('F');
  });

  it('rejects scores outside [0, 100]', () => {
    expect(() => scoreToGrade(-1)).toThrow(GradingError);
    expect(() => scoreToGrade(101)).toThrow(GradingError);
    expect(() => scoreToGrade(Number.NaN)).toThrow(GradingError);
  });
});

describe('roundTo', () => {
  it('rounds half-up despite float representation', () => {
    // The classic case: 1.005 is stored as 1.00499999999999989, so a naive
    // Math.round(x*100)/100 gives 1.00. On a grade boundary that is a whole
    // letter grade.
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(3.14159, 2)).toBe(3.14);
  });
});

describe('computeTotalScore', () => {
  it('sums the two components', () => {
    expect(computeTotalScore(35, 55)).toBe(90);
  });

  it('rejects a CA above the policy cap', () => {
    expect(() => computeTotalScore(41, 50)).toThrow(/Continuous assessment/);
  });

  it('rejects an exam above the policy cap', () => {
    expect(() => computeTotalScore(30, 61)).toThrow(/Examination/);
  });

  it('rejects non-finite input', () => {
    expect(() => computeTotalScore(Number.NaN, 10)).toThrow(GradingError);
  });
});

describe('computeGpa', () => {
  it('weights by credit hours, not by course count', () => {
    // A 4-credit A and a 1-credit F must NOT average to 2.0.
    const result = computeGpa(
      [
        attempt({ enrollmentId: 'a', courseId: 'c1', creditHours: 4, gradePoint: 4 }),
        attempt({ enrollmentId: 'b', courseId: 'c2', creditHours: 1, gradePoint: 0 }),
      ],
      false,
    );
    expect(result.qualityPoints).toBe(16);
    expect(result.gpaCredits).toBe(5);
    expect(result.gpa).toBe(3.2);
  });

  it('excludes withdrawals from BOTH numerator and denominator', () => {
    // A withdrawal must be incapable of lowering a GPA — the student did what
    // the regulations permit.
    const withW = computeGpa(
      [
        attempt({ enrollmentId: 'a', courseId: 'c1', creditHours: 3, gradePoint: 4 }),
        attempt({ enrollmentId: 'b', courseId: 'c2', creditHours: 3, gradePoint: null, letterGrade: 'W' }),
      ],
      false,
    );
    const withoutW = computeGpa(
      [attempt({ enrollmentId: 'a', courseId: 'c1', creditHours: 3, gradePoint: 4 })],
      false,
    );
    expect(withW.gpa).toBe(withoutW.gpa);
    expect(withW.gpa).toBe(4);
    expect(withW.creditsAttempted).toBe(3);
  });

  it('counts a failure in the denominator so it depresses the GPA', () => {
    // A fail and a withdrawal must NOT be numerically identical, or there is no
    // incentive to withdraw properly.
    const failed = computeGpa(
      [
        attempt({ enrollmentId: 'a', courseId: 'c1', creditHours: 3, gradePoint: 4 }),
        attempt({ enrollmentId: 'b', courseId: 'c2', creditHours: 3, gradePoint: 0 }),
      ],
      false,
    );
    expect(failed.gpa).toBe(2);
    expect(failed.creditsAttempted).toBe(6);
    expect(failed.creditsEarned).toBe(3);
  });

  it('returns zero rather than NaN when nothing is graded', () => {
    expect(computeGpa([], false).gpa).toBe(0);
    expect(
      computeGpa([attempt({ enrollmentId: 'a', gradePoint: null })], false).gpa,
    ).toBe(0);
  });
});

describe('repeat policy (best attempt)', () => {
  it('keeps the highest-scoring attempt and supersedes the rest', () => {
    const { counted, superseded } = selectGpaAttempts([
      attempt({ enrollmentId: 'first', courseId: 'CSC102', gradePoint: 0, termSequence: 1 }),
      attempt({ enrollmentId: 'retake', courseId: 'CSC102', gradePoint: 3, termSequence: 2 }),
    ]);

    expect(counted).toHaveLength(1);
    expect(counted[0].enrollmentId).toBe('retake');
    expect(superseded.map((s) => s.enrollmentId)).toEqual(['first']);
  });

  it('keeps the earlier attempt when the retake is worse', () => {
    const { counted } = selectGpaAttempts([
      attempt({ enrollmentId: 'first', courseId: 'CSC102', gradePoint: 4, termSequence: 1 }),
      attempt({ enrollmentId: 'retake', courseId: 'CSC102', gradePoint: 2, termSequence: 2 }),
    ]);
    expect(counted[0].enrollmentId).toBe('first');
  });

  it('breaks a tie in favour of the later term', () => {
    const { counted } = selectGpaAttempts([
      attempt({ enrollmentId: 'first', courseId: 'CSC102', gradePoint: 3, termSequence: 1 }),
      attempt({ enrollmentId: 'retake', courseId: 'CSC102', gradePoint: 3, termSequence: 2 }),
    ]);
    expect(counted[0].enrollmentId).toBe('retake');
  });

  it('never lets an in-progress retake erase a prior passing grade', () => {
    // Mid-term, the retake has no grade point yet. If it won, the student's
    // CGPA would silently drop the moment they registered for the retake.
    const { counted } = selectGpaAttempts([
      attempt({ enrollmentId: 'passed', courseId: 'CSC102', gradePoint: 2, termSequence: 1 }),
      attempt({ enrollmentId: 'inProgress', courseId: 'CSC102', gradePoint: null, termSequence: 2 }),
    ]);
    expect(counted[0].enrollmentId).toBe('passed');
  });

  it('is not applied when computing a term GPA', () => {
    const attempts = [
      attempt({ enrollmentId: 'first', courseId: 'CSC102', creditHours: 3, gradePoint: 0 }),
      attempt({ enrollmentId: 'retake', courseId: 'CSC102', creditHours: 3, gradePoint: 4 }),
    ];
    expect(computeGpa(attempts, true).gpa).toBe(4); // CGPA: best attempt only
    expect(computeGpa(attempts, false).gpa).toBe(2); // term GPA: both as recorded
  });
});

describe('academic standing', () => {
  const base = {
    termGpa: 3,
    creditsAttemptedThisTerm: 15,
    consecutiveProbationTerms: 0,
    isFirstTerm: false,
  };

  it('grants a grace term to first-year students', () => {
    const result = determineAcademicStanding({ ...base, cumulativeGpa: 1.2, isFirstTerm: true });
    expect(result.standing).toBe('GOOD');
  });

  it('does not shield a first-term student below the dismissal floor', () => {
    const result = determineAcademicStanding({ ...base, cumulativeGpa: 0.4, isFirstTerm: true });
    expect(result.standing).toBe('DISMISSED');
  });

  it('places a student below 1.5 on probation', () => {
    expect(determineAcademicStanding({ ...base, cumulativeGpa: 1.2 }).standing).toBe('PROBATION');
  });

  it('escalates to dismissal after the tolerated consecutive probation terms', () => {
    const result = determineAcademicStanding({
      ...base,
      cumulativeGpa: 1.2,
      consecutiveProbationTerms: 2,
    });
    expect(result.standing).toBe('DISMISSED');
  });

  it('always flags a dismissal for human review', () => {
    // Automating expulsion on a floating-point comparison is exactly the kind
    // of thing that ends up in court.
    const result = determineAcademicStanding({ ...base, cumulativeGpa: 0.5 });
    expect(result.standing).toBe('DISMISSED');
    expect(result.requiresReview).toBe(true);
  });

  it('warns between 1.5 and 2.0', () => {
    expect(determineAcademicStanding({ ...base, cumulativeGpa: 1.7 }).standing).toBe('WARNING');
  });

  it("awards the Dean's List only on a full-time load", () => {
    const fullTime = determineAcademicStanding({
      ...base,
      cumulativeGpa: 3.8,
      termGpa: 3.9,
      creditsAttemptedThisTerm: 15,
    });
    const partTime = determineAcademicStanding({
      ...base,
      cumulativeGpa: 3.8,
      termGpa: 3.9,
      creditsAttemptedThisTerm: 6,
    });
    expect(fullTime.standing).toBe('DEANS_LIST');
    expect(partTime.standing).toBe('GOOD');
  });
});

describe('degree classification', () => {
  it('maps CGPA onto the honours bands', () => {
    expect(classifyDegree(3.9)).toBe('First Class Honours');
    expect(classifyDegree(3.5)).toBe('First Class Honours');
    expect(classifyDegree(3.0)).toBe('Second Class Honours (Upper Division)');
    expect(classifyDegree(2.0)).toBe('Second Class Honours (Lower Division)');
    expect(classifyDegree(1.5)).toBe('Third Class Honours');
    expect(classifyDegree(1.0)).toBe('Pass');
    expect(classifyDegree(0.5)).toBe('Fail');
  });
});

describe('graduation audit', () => {
  const base = {
    creditsEarned: 120,
    creditsRequired: 120,
    cgpa: 3.0,
    minCgpaToGraduate: 1.5,
    requiredCoreCourseIds: ['a', 'b'],
    passedCourseIds: ['a', 'b', 'c'],
    hasBlockingHold: false,
  };

  it('passes a student who has met every requirement', () => {
    const result = auditGraduation(base);
    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('reports each unmet requirement separately', () => {
    const result = auditGraduation({
      ...base,
      creditsEarned: 100,
      cgpa: 1.2,
      passedCourseIds: ['a'],
      hasBlockingHold: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.creditsRemaining).toBe(20);
    expect(result.missingCoreCourseIds).toEqual(['b']);
    expect(result.blockers).toHaveLength(4);
  });

  it('never reports negative credits remaining for an over-achiever', () => {
    expect(auditGraduation({ ...base, creditsEarned: 140 }).creditsRemaining).toBe(0);
  });
});
