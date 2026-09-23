import { describe, expect, it, vi } from 'vitest';

import {
  AttendancePolicyZ,
  ConfigError,
  DEFAULT_ADMISSIONS_CONFIG,
  DEFAULT_ATTENDANCE_POLICY,
  DEFAULT_GRADING_CONFIG,
  GRADING_PRESETS,
  assertAdmissionsConfigWellFormed,
  assertEnrollmentPolicyWellFormed,
  assertGradingConfigWellFormed,
  buildLinearScale,
  defaultConfigBundle,
  gradingPreset,
  parseSchoolConfig,
  DEFAULT_ENROLLMENT_POLICY,
} from '@/lib/domain/config';
import {
  classifyDegree,
  computeGpa,
  computeTotalScore,
  determineAcademicStanding,
  scoreToGrade,
} from '@/lib/domain/grading';
import { computeCompositeScore } from '@/lib/domain/admissions';
import { evaluateEligibility } from '@/lib/domain/enrollment';
import { formatMoney, makeMoney, toMinor } from '@/lib/domain/money';

const BRANDING = { name: 'Test School', short: 'Test', brandColor: '#1b5df5', logoUrl: null };

describe('shipped presets are well-formed', () => {
  it('every preset passes the same validation a school save must pass', () => {
    for (const [key, preset] of Object.entries(GRADING_PRESETS)) {
      expect(() => assertGradingConfigWellFormed(preset.config), key).not.toThrow();
    }
  });

  it('the default rubric weights total exactly 1.00', () => {
    expect(() => assertAdmissionsConfigWellFormed(DEFAULT_ADMISSIONS_CONFIG)).not.toThrow();
  });

  it('the default enrolment policy is internally consistent', () => {
    expect(() => assertEnrollmentPolicyWellFormed(DEFAULT_ENROLLMENT_POLICY)).not.toThrow();
  });
});

describe('grading scale validation', () => {
  it('rejects a gap — some score would map to no grade at all', () => {
    const bad = {
      ...DEFAULT_GRADING_CONFIG,
      scale: [
        { min: 60, max: 100, letter: 'A', point: 4, description: 'Good' },
        { min: 0, max: 50, letter: 'F', point: 0, description: 'Fail' },
      ],
    };
    expect(() => assertGradingConfigWellFormed(bad)).toThrow(/Gap/);
  });

  it('rejects an overlap — a score would map to two grades', () => {
    const bad = {
      ...DEFAULT_GRADING_CONFIG,
      scale: [
        { min: 40, max: 100, letter: 'A', point: 4, description: 'Good' },
        { min: 0, max: 50, letter: 'F', point: 0, description: 'Fail' },
      ],
    };
    expect(() => assertGradingConfigWellFormed(bad)).toThrow(/Overlap/);
  });

  it('rejects a scale that does not start at 0 or end at 100', () => {
    expect(() =>
      assertGradingConfigWellFormed({
        ...DEFAULT_GRADING_CONFIG,
        scale: [{ min: 10, max: 100, letter: 'A', point: 4, description: 'x' }],
      }),
    ).toThrow(/start at 0/);
    expect(() =>
      assertGradingConfigWellFormed({
        ...DEFAULT_GRADING_CONFIG,
        scale: [{ min: 0, max: 90, letter: 'A', point: 4, description: 'x' }],
      }),
    ).toThrow(/end at 100/);
  });

  it('rejects assessment weights that do not total 100', () => {
    expect(() =>
      assertGradingConfigWellFormed({
        ...DEFAULT_GRADING_CONFIG,
        assessmentWeights: { ca: 30, exam: 60 },
      }),
    ).toThrow(/total 100/);
  });

  it('rejects a band worth more than the scale maximum', () => {
    expect(() =>
      assertGradingConfigWellFormed({
        ...gradingPreset(4),
        scale: buildLinearScale(4).map((b) => (b.letter === 'A' ? { ...b, point: 9 } : b)),
      }),
    ).toThrow(/above the scale maximum/);
  });

  it('rejects standing thresholds that do not descend', () => {
    expect(() =>
      assertGradingConfigWellFormed({
        ...DEFAULT_GRADING_CONFIG,
        standing: { ...DEFAULT_GRADING_CONFIG.standing, warning: 0.5, probation: 1.5 },
      }),
    ).toThrow(/descend/);
  });
});

describe('admissions rubric validation', () => {
  it('rejects weights that do not total 1.00', () => {
    // Renormalisation means any other total silently rescales every composite,
    // so this has to be a hard failure rather than a warning.
    expect(() =>
      assertAdmissionsConfigWellFormed({
        ...DEFAULT_ADMISSIONS_CONFIG,
        weights: { priorGpa: 0.5, entranceExam: 0.5, essay: 0.2, interview: 0, extracurricular: 0 },
      }),
    ).toThrow(ConfigError);
  });
});

describe('the same score grades differently on different scales', () => {
  const four = gradingPreset(4);
  const five = gradingPreset(5);

  it('awards a different number of points for an identical mark', () => {
    expect(scoreToGrade(84, four.scale).point).toBe(4);
    expect(scoreToGrade(84, five.scale).point).toBe(5);
    // Same letter, different value — which is exactly why the point cannot be
    // treated as a stored fact independent of the school's scale.
    expect(scoreToGrade(84, four.scale).letter).toBe(scoreToGrade(84, five.scale).letter);
  });

  it('produces a different CGPA from identical coursework', () => {
    const attempt = (point: number) => ({
      enrollmentId: 'e1', courseId: 'c1', courseCode: 'X', courseTitle: 'X',
      creditHours: 3, gradePoint: point, letterGrade: 'A', totalScore: 84, termSequence: 1,
    });
    expect(computeGpa([attempt(scoreToGrade(84, four.scale).point)], false).gpa).toBe(4);
    expect(computeGpa([attempt(scoreToGrade(84, five.scale).point)], false).gpa).toBe(5);
  });

  it('scales standing thresholds with the maximum', () => {
    // Good standing is half the maximum: 2.00 on a 4.0 scale, 2.50 on a 5.0
    // one. A CGPA of 2.20 therefore sits on opposite sides of that line at the
    // two schools — the same number, two different verdicts.
    const input = {
      cumulativeGpa: 2.2, termGpa: 2.2, creditsAttemptedThisTerm: 15,
      consecutiveProbationTerms: 0, isFirstTerm: false,
    };
    expect(determineAcademicStanding(input, four.standing).standing).toBe('GOOD');
    expect(determineAcademicStanding(input, five.standing).standing).toBe('WARNING');
  });

  it('scales degree classification with the maximum', () => {
    expect(classifyDegree(3.5, four.degreeClasses)).toBe('First Class Honours');
    expect(classifyDegree(3.5, five.degreeClasses)).toBe('Second Class Honours (Lower Division)');
  });

  it('validates assessment scores against the school’s own caps', () => {
    // A school running 30/70 must reject a CA of 35 that a 40/60 school allows.
    expect(computeTotalScore(35, 55)).toBe(90);
    expect(() => computeTotalScore(35, 55, { ca: 30, exam: 70 })).toThrow(/Continuous assessment/);
  });
});

describe('per-school policy reaches the other engines', () => {
  it('applies the school’s credit ceiling, not the default', () => {
    const base = {
      now: new Date('2025-09-01'),
      term: { registrationOpensAt: new Date('2025-08-01'), registrationClosesAt: new Date('2025-09-30') },
      student: { status: 'ACTIVE', academicStanding: 'GOOD', cgpa: 3, registeredCreditsThisTerm: 12 },
      offering: {
        label: 'X-A', status: 'OPEN', capacity: 30, seatsTaken: 1, waitlistCapacity: 5,
        currentWaitlistLength: 0, creditHours: 3, meetings: [],
      },
      blockingHolds: [], outstandingBalanceMinor: 0, prerequisiteRules: [],
      completedCourses: [], concurrentlyRegisteredCourseIds: [], existingRegistrations: [],
      alreadyEnrolled: false, hasOverloadApproval: false,
    };

    expect(evaluateEligibility(base).outcome).toBe('REGISTERED');
    expect(
      evaluateEligibility({
        ...base,
        policy: { ...DEFAULT_ENROLLMENT_POLICY, maxCreditsPerTerm: 12 },
      }).outcome,
    ).toBe('REJECTED');
  });

  it('applies the school’s rubric weights', () => {
    const inputs = {
      priorGpaScore: 100, entranceExamScore: 0,
      essayScore: null, interviewScore: null, extracurricularScore: null,
    };
    // Default weights the prior GPA at 0.40 against exam 0.30 -> 57.14.
    expect(computeCompositeScore(inputs).composite).toBeCloseTo(57.14, 1);
    // A school weighting the exam far higher gets a materially lower composite.
    expect(
      computeCompositeScore(inputs, {
        priorGpa: 0.1, entranceExam: 0.6, essay: 0.1, interview: 0.1, extracurricular: 0.1,
      }).composite,
    ).toBeCloseTo(14.29, 1);
  });
});

describe('currency is per school', () => {
  it('formats with the school’s own symbol', () => {
    expect(formatMoney(150075)).toBe('₦1,500.75');
    expect(formatMoney(150075, { currency: { code: 'GHS', symbol: '₵', exponent: 2 } }))
      .toBe('₵1,500.75');
  });

  it('handles a zero-decimal currency without a stray point', () => {
    const yen = makeMoney({ code: 'JPY', symbol: '¥', exponent: 0 });
    expect(yen.format(1500)).toBe('¥1,500');
    expect(yen.toMinor(1500)).toBe(1500);
  });

  it('binds a whole formatter set to one currency', () => {
    const cedi = makeMoney({ code: 'GHS', symbol: '₵', exponent: 2 });
    expect(cedi.format(toMinor(12))).toBe('₵12.00');
    expect(cedi.formatCompact(toMinor(2_400_000))).toBe('₵2.4M');
  });
});

describe('parsing a stored config', () => {
  it('round-trips a valid bundle', () => {
    const stored = { gradingJson: JSON.stringify(gradingPreset(5)) };
    expect(parseSchoolConfig(stored, BRANDING).grading.maxGradePoint).toBe(5);
  });

  it('falls back to defaults on unreadable JSON rather than locking the school out', () => {
    // A school with one corrupt column must still be able to sign in and fix
    // it, not be locked out of its own settings page.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parsed = parseSchoolConfig({ gradingJson: 'not json at all' }, BRANDING);
    expect(parsed.grading.maxGradePoint).toBe(DEFAULT_GRADING_CONFIG.maxGradePoint);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back when the shape is valid JSON but the wrong shape', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parsed = parseSchoolConfig({ gradingJson: '{"scale":[]}' }, BRANDING);
    expect(parsed.grading.scale.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('uses the school’s branding when no config row exists', () => {
    const bundle = defaultConfigBundle(BRANDING);
    expect(bundle.branding.name).toBe('Test School');
    expect(bundle.grading.maxGradePoint).toBe(4);
  });
});

// -----------------------------------------------------------------------------
// Attendance policy
// -----------------------------------------------------------------------------

describe('the attendance policy', () => {
  it('is off by default, so a fresh school bars nobody', () => {
    expect(DEFAULT_ATTENDANCE_POLICY.enforced).toBe(false);
    expect(defaultConfigBundle(BRANDING).attendance.enforced).toBe(false);
  });

  it('REFUSES a warning line below the bar that bars a student', () => {
    /*
     * If the warning sat below the bar, a student would be barred from an
     * examination without ever having been shown the warning state that exists
     * to give them time to do something about it. The rule is therefore a
     * property of the policy, not of the form that edits it.
     */
    expect(() =>
      AttendancePolicyZ.parse({ examEligibilityThreshold: 75, warningThreshold: 70, enforced: true }),
    ).toThrow();

    expect(() =>
      AttendancePolicyZ.parse({ examEligibilityThreshold: 75, warningThreshold: 75, enforced: true }),
    ).not.toThrow();
  });

  it('keeps percentages inside 0–100', () => {
    expect(() =>
      AttendancePolicyZ.parse({ examEligibilityThreshold: 120, warningThreshold: 130, enforced: false }),
    ).toThrow();
  });

  it('survives a round trip through the stored column', () => {
    const policy = { examEligibilityThreshold: 70, warningThreshold: 80, enforced: true };
    const parsed = parseSchoolConfig(
      { attendanceJson: JSON.stringify(policy) },
      BRANDING,
    );
    expect(parsed.attendance).toEqual(policy);
  });

  it('falls back to the safe default when the column is nonsense', () => {
    // A corrupt column must not enforce a rule nobody configured.
    const parsed = parseSchoolConfig({ attendanceJson: '{ not json' }, BRANDING);
    expect(parsed.attendance).toEqual(DEFAULT_ATTENDANCE_POLICY);
    expect(parsed.attendance.enforced).toBe(false);
  });
});
