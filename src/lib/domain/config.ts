import { z } from 'zod';

import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicyInput } from './attendance';
import {
  DEFAULT_RESULT_WORKFLOW,
  type ResultWorkflowPolicy,
} from './result-workflow';

/*
 * The attendance policy is DEFINED in ./attendance, next to the functions that
 * act on it, and only wired into the bundle here. Duplicating the shape would
 * mean a school could save a threshold the eligibility maths never reads.
 */
export type { AttendancePolicyInput, ResultWorkflowPolicy };
export { DEFAULT_ATTENDANCE_POLICY, DEFAULT_RESULT_WORKFLOW };

/**
 * =============================================================================
 * SCHOOL CONFIGURATION
 * =============================================================================
 *
 * Every policy that differs between institutions lives here as DATA rather than
 * as a constant in the code: the grading scale, the credit ceilings, the
 * admissions rubric weights, the currency, the refund schedule.
 *
 * This module is PURE — types, defaults, named presets, validators. It performs
 * no I/O. `SchoolConfig` rows are parsed into these shapes at the request
 * boundary and passed down into the domain functions, which stay pure.
 *
 * WHY VALIDATION MOVED
 * --------------------
 * `assertScaleIsWellFormed` used to run at module load, which was fine when the
 * scale was a constant nobody could change. Now that a school administrator can
 * edit it, the check has to run at SAVE time — otherwise a bad scale is only
 * discovered when it silently mis-grades someone. `assertGradingConfigWellFormed`
 * is the boundary; the Zod schemas below are the shape guard.
 */

// -----------------------------------------------------------------------------
// Grading
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

export interface StandingThresholds {
  deansList: number;
  good: number;
  warning: number;
  probation: number;
  /** Minimum full-time load for Dean's List eligibility. */
  deansListMinCredits: number;
  /** Consecutive probation terms tolerated before dismissal. */
  maxConsecutiveProbationTerms: number;
}

export interface DegreeClass {
  min: number;
  label: string;
}

export interface GradingConfig {
  /** Highest grade point on this school's scale — 4.0, 5.0, 7.0 … */
  maxGradePoint: number;
  scale: GradeBand[];
  /** The minimum grade point that constitutes a pass. Below this, no credit. */
  passingGradePoint: number;
  /** Continuous assessment and examination weightings (must sum to 100). */
  assessmentWeights: { ca: number; exam: number };
  standing: StandingThresholds;
  degreeClasses: DegreeClass[];
}

// -----------------------------------------------------------------------------
// Enrollment
// -----------------------------------------------------------------------------

export interface EnrollmentPolicy {
  minCreditsPerTerm: number;
  maxCreditsPerTerm: number;
  /** Registrar-approved overload ceiling. */
  maxCreditsWithOverloadApproval: number;
  /** CGPA at or above which an overload may be requested. */
  overloadMinCgpa: number;
  /** Outstanding balance (minor units) tolerated before registration is blocked. */
  outstandingBalanceToleranceMinor: number;
}

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

export interface AdmissionsConfig {
  /** Rubric weights. MUST sum to 1.0. */
  weights: {
    priorGpa: number;
    entranceExam: number;
    essay: number;
    interview: number;
    extracurricular: number;
  };
  /** Composite below which an application is rejected without committee time. */
  autoRejectThreshold: number;
  /** Independent reviews required before any decision may be issued. */
  minReviewsRequired: number;
  /** Reviewer spread above which an adjudicating third review is demanded. */
  reviewerDisagreementThreshold: number;
  /** Fraction of the rubric that must be present before deciding. */
  minimumCoverage: number;
  offerValidityDays: number;
}

// -----------------------------------------------------------------------------
// Finance
// -----------------------------------------------------------------------------

export interface CurrencyConfig {
  code: string;
  symbol: string;
  /** Decimal places in the minor unit. 2 for NGN/USD, 0 for JPY. */
  exponent: number;
}

export interface FinanceConfig {
  currency: CurrencyConfig;
  holdPolicy: {
    /** Balance may not exceed this before a hold is raised. */
    toleranceMinor: number;
    /** Days past due before a hold is raised. */
    graceDays: number;
  };
  /** Declining tuition refund, by week elapsed since the term began. */
  refundSchedule: { throughWeek: number; percent: number }[];
}

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

export interface BrandingConfig {
  name: string;
  short: string;
  brandColor: string;
  logoUrl: string | null;
}

export interface LocaleConfig {
  locale: string;
  timezone: string;
  /** 1 = Monday, 7 = Sunday (ISO-8601). */
  firstDayOfWeek: number;
  dateFormat: string;
}

/**
 * K-12 policy. Nullable in storage because a higher-education school never
 * reads it; `parseSchoolConfig` supplies the defaults when it is absent so
 * a school that later switches academic model is immediately usable.
 */
export interface K12Config {
  /** Termly average at or above which a pupil is promoted. */
  promotionMinAverage: number;
  /** Attendance rate (0-1) below which promotion is referred for review. */
  promotionMinAttendance: number;
  /** Average below which a pupil repeats the year outright. */
  repeatBelowAverage: number;
  /** Behaviour and skills assessed on the report card, rated 1-5. */
  traits: string[];
  /** Subjects a pupil must pass regardless of their overall average. */
  compulsorySubjectCodes: string[];
  showClassPosition: boolean;
}

export const DEFAULT_K12_CONFIG: K12Config = {
  promotionMinAverage: 50,
  promotionMinAttendance: 0.75,
  repeatBelowAverage: 40,
  traits: ['Punctuality', 'Neatness', 'Cooperation', 'Participation', 'Handwriting'],
  compulsorySubjectCodes: [],
  showClassPosition: true,
};

export const K12ConfigZ = z.object({
  promotionMinAverage: z.number().min(0).max(100),
  promotionMinAttendance: z.number().min(0).max(1),
  repeatBelowAverage: z.number().min(0).max(100),
  traits: z.array(z.string().min(1).max(40)).max(12),
  compulsorySubjectCodes: z.array(z.string().max(32)),
  showClassPosition: z.boolean(),
});

export function assertK12ConfigWellFormed(config: K12Config): void {
  if (config.repeatBelowAverage > config.promotionMinAverage) {
    throw new ConfigError(
      'The repeat floor cannot be above the promotion mark — a pupil would fall into both.',
    );
  }
}

export interface RegistrationPortalConfig {
  collectPriorGpa: boolean;
  collectEntranceExam: boolean;
  requirePersonalStatement: boolean;
  minStatementLength: number;
  /** Program codes open for application; empty means all active programs. */
  openProgramCodes: string[];
}

/** The whole bundle, as loaded once per request. */
export interface SchoolConfigBundle {
  grading: GradingConfig;
  enrollment: EnrollmentPolicy;
  admissions: AdmissionsConfig;
  finance: FinanceConfig;
  branding: BrandingConfig;
  locale: LocaleConfig;
  registrationPortal: RegistrationPortalConfig;
  k12: K12Config;
  attendance: AttendancePolicyInput;
  resultWorkflow: ResultWorkflowPolicy;
}

// -----------------------------------------------------------------------------
// Scale builders
// -----------------------------------------------------------------------------

/**
 * Build a grade scale from percentage cut-offs and a maximum grade point.
 *
 * Most national systems share the same shape — descending percentage bands
 * mapped onto descending grade points — and differ only in the maximum. This
 * generates the common case so a school does not have to hand-type six rows,
 * while `scale` stays a plain array anyone can override band by band.
 */
export function buildLinearScale(maxGradePoint: number): GradeBand[] {
  const step = maxGradePoint / 4;
  return [
    { min: 70, max: 100, letter: 'A', point: maxGradePoint, description: 'Excellent' },
    { min: 60, max: 69.999999, letter: 'B', point: round2(maxGradePoint - step), description: 'Very Good' },
    { min: 50, max: 59.999999, letter: 'C', point: round2(maxGradePoint - 2 * step), description: 'Good' },
    { min: 45, max: 49.999999, letter: 'D', point: round2(maxGradePoint - 3 * step), description: 'Pass' },
    { min: 40, max: 44.999999, letter: 'E', point: round2(Math.max(0.5, maxGradePoint - 3.5 * step)), description: 'Marginal Pass' },
    { min: 0, max: 39.999999, letter: 'F', point: 0, description: 'Fail' },
  ];
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Standing thresholds as fractions of the maximum grade point. */
export function buildStandingThresholds(maxGradePoint: number): StandingThresholds {
  return {
    deansList: round2(maxGradePoint * 0.875),
    good: round2(maxGradePoint * 0.5),
    warning: round2(maxGradePoint * 0.375),
    probation: round2(maxGradePoint * 0.25),
    deansListMinCredits: 12,
    maxConsecutiveProbationTerms: 2,
  };
}

export function buildDegreeClasses(maxGradePoint: number): DegreeClass[] {
  const f = (fraction: number) => round2(maxGradePoint * fraction);
  return [
    { min: f(0.875), label: 'First Class Honours' },
    { min: f(0.75), label: 'Second Class Honours (Upper Division)' },
    { min: f(0.5), label: 'Second Class Honours (Lower Division)' },
    { min: f(0.375), label: 'Third Class Honours' },
    { min: f(0.25), label: 'Pass' },
    { min: 0, label: 'Fail' },
  ];
}

// -----------------------------------------------------------------------------
// Defaults and presets
// -----------------------------------------------------------------------------

export function gradingPreset(maxGradePoint: number): GradingConfig {
  return {
    maxGradePoint,
    scale: buildLinearScale(maxGradePoint),
    passingGradePoint: 0.5,
    assessmentWeights: { ca: 40, exam: 60 },
    standing: buildStandingThresholds(maxGradePoint),
    degreeClasses: buildDegreeClasses(maxGradePoint),
  };
}

/**
 * The default IS the behaviour the system had before configuration existed —
 * a 4.0 scale on Nigerian percentage cut-offs. Keeping the default identical to
 * the old constants is what lets every pure function take an optional config
 * parameter without changing a single existing test's expectations.
 */
export const DEFAULT_GRADING_CONFIG: GradingConfig = gradingPreset(4.0);

export const GRADING_PRESETS: Record<string, { label: string; detail: string; config: GradingConfig }> = {
  NIGERIAN_4: {
    label: 'Nigerian 4-point',
    detail: 'A–F · 4.00 max',
    config: gradingPreset(4.0),
  },
  NIGERIAN_5: {
    label: 'Nigerian 5-point',
    detail: 'A–F · 5.00 max',
    config: gradingPreset(5.0),
  },
  US_4: {
    label: 'US 4.0',
    detail: 'A+–F · 4.00 max',
    config: {
      ...gradingPreset(4.0),
      scale: [
        { min: 93, max: 100, letter: 'A', point: 4.0, description: 'Excellent' },
        { min: 90, max: 92.999999, letter: 'A-', point: 3.7, description: 'Excellent' },
        { min: 87, max: 89.999999, letter: 'B+', point: 3.3, description: 'Good' },
        { min: 83, max: 86.999999, letter: 'B', point: 3.0, description: 'Good' },
        { min: 80, max: 82.999999, letter: 'B-', point: 2.7, description: 'Good' },
        { min: 77, max: 79.999999, letter: 'C+', point: 2.3, description: 'Satisfactory' },
        { min: 73, max: 76.999999, letter: 'C', point: 2.0, description: 'Satisfactory' },
        { min: 70, max: 72.999999, letter: 'C-', point: 1.7, description: 'Satisfactory' },
        { min: 60, max: 69.999999, letter: 'D', point: 1.0, description: 'Poor' },
        { min: 0, max: 59.999999, letter: 'F', point: 0, description: 'Fail' },
      ],
    },
  },
  PERCENTAGE: {
    label: 'Percentage only',
    detail: 'No letter grades',
    config: {
      ...gradingPreset(100),
      scale: [
        { min: 40, max: 100, letter: 'P', point: 100, description: 'Pass' },
        { min: 0, max: 39.999999, letter: 'F', point: 0, description: 'Fail' },
      ],
      passingGradePoint: 40,
    },
  },
};

export const DEFAULT_ENROLLMENT_POLICY: EnrollmentPolicy = {
  minCreditsPerTerm: 9,
  maxCreditsPerTerm: 24,
  maxCreditsWithOverloadApproval: 30,
  overloadMinCgpa: 3.0,
  outstandingBalanceToleranceMinor: 0,
};

export const DEFAULT_ADMISSIONS_CONFIG: AdmissionsConfig = {
  weights: {
    priorGpa: 0.40,
    entranceExam: 0.30,
    essay: 0.15,
    interview: 0.10,
    extracurricular: 0.05,
  },
  autoRejectThreshold: 40,
  minReviewsRequired: 2,
  reviewerDisagreementThreshold: 20,
  minimumCoverage: 0.7,
  offerValidityDays: 21,
};

export const DEFAULT_FINANCE_CONFIG: FinanceConfig = {
  currency: { code: 'NGN', symbol: '₦', exponent: 2 },
  holdPolicy: { toleranceMinor: 0, graceDays: 7 },
  refundSchedule: [
    { throughWeek: 1, percent: 100 },
    { throughWeek: 2, percent: 75 },
    { throughWeek: 4, percent: 50 },
    { throughWeek: 6, percent: 25 },
  ],
};

export const DEFAULT_LOCALE_CONFIG: LocaleConfig = {
  locale: 'en-NG',
  timezone: 'Africa/Lagos',
  firstDayOfWeek: 1,
  dateFormat: 'dd MMM yyyy',
};

export const DEFAULT_REGISTRATION_PORTAL_CONFIG: RegistrationPortalConfig = {
  collectPriorGpa: true,
  collectEntranceExam: true,
  requirePersonalStatement: true,
  minStatementLength: 100,
  openProgramCodes: [],
};

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const gradeBandZ = z.object({
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
  letter: z.string().min(1).max(4),
  point: z.number().min(0).max(100),
  description: z.string().max(60),
});

export const ResultWorkflowPolicyZ = z.object({
  requireHod: z.boolean(),
  requireFaculty: z.boolean(),
  requireSenate: z.boolean(),
});

export const AttendancePolicyZ = z
  .object({
    examEligibilityThreshold: z.number().min(0).max(100),
    warningThreshold: z.number().min(0).max(100),
    enforced: z.boolean(),
  })
  /*
   * The warning line cannot sit BELOW the bar. If it did, a student would be
   * barred from the examination without ever having been shown the warning
   * state that exists to give them time to do something about it.
   */
  .refine((p) => p.warningThreshold >= p.examEligibilityThreshold, {
    message: 'The warning level must be at or above the level that bars a student.',
    path: ['warningThreshold'],
  });

export const GradingConfigZ = z.object({
  maxGradePoint: z.number().positive().max(100),
  scale: z.array(gradeBandZ).min(2).max(20),
  passingGradePoint: z.number().min(0).max(100),
  assessmentWeights: z.object({ ca: z.number().min(0).max(100), exam: z.number().min(0).max(100) }),
  standing: z.object({
    deansList: z.number().min(0),
    good: z.number().min(0),
    warning: z.number().min(0),
    probation: z.number().min(0),
    deansListMinCredits: z.number().int().min(0).max(60),
    maxConsecutiveProbationTerms: z.number().int().min(0).max(10),
  }),
  degreeClasses: z.array(z.object({ min: z.number().min(0), label: z.string().min(1).max(80) })).min(1),
});

export const EnrollmentPolicyZ = z.object({
  minCreditsPerTerm: z.number().int().min(0).max(60),
  maxCreditsPerTerm: z.number().int().min(1).max(60),
  maxCreditsWithOverloadApproval: z.number().int().min(1).max(80),
  overloadMinCgpa: z.number().min(0).max(100),
  outstandingBalanceToleranceMinor: z.number().int().min(0),
});

export const AdmissionsConfigZ = z.object({
  weights: z.object({
    priorGpa: z.number().min(0).max(1),
    entranceExam: z.number().min(0).max(1),
    essay: z.number().min(0).max(1),
    interview: z.number().min(0).max(1),
    extracurricular: z.number().min(0).max(1),
  }),
  autoRejectThreshold: z.number().min(0).max(100),
  minReviewsRequired: z.number().int().min(0).max(10),
  reviewerDisagreementThreshold: z.number().min(0).max(100),
  minimumCoverage: z.number().min(0).max(1),
  offerValidityDays: z.number().int().min(1).max(365),
});

export const FinanceConfigZ = z.object({
  currency: z.object({
    code: z.string().length(3),
    symbol: z.string().min(1).max(4),
    exponent: z.number().int().min(0).max(4),
  }),
  holdPolicy: z.object({
    toleranceMinor: z.number().int().min(0),
    graceDays: z.number().int().min(0).max(365),
  }),
  refundSchedule: z.array(z.object({
    throughWeek: z.number().int().min(1).max(52),
    percent: z.number().min(0).max(100),
  })),
});

export const BrandingConfigZ = z.object({
  name: z.string().min(1).max(120),
  short: z.string().min(1).max(40),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #1b5df5'),
  logoUrl: z.string().url().nullable(),
});

export const LocaleConfigZ = z.object({
  locale: z.string().min(2).max(12),
  timezone: z.string().min(3).max(64),
  firstDayOfWeek: z.number().int().min(1).max(7),
  dateFormat: z.string().min(1).max(32),
});

export const RegistrationPortalConfigZ = z.object({
  collectPriorGpa: z.boolean(),
  collectEntranceExam: z.boolean(),
  requirePersonalStatement: z.boolean(),
  minStatementLength: z.number().int().min(0).max(5000),
  openProgramCodes: z.array(z.string().max(32)),
});

/**
 * The grade scale must be CONTIGUOUS over [0, 100] — no gaps, no overlaps.
 *
 * A gap means some score maps to no grade at all; an overlap means a score maps
 * to two, and which one wins depends on array order. Either way a student gets
 * a grade nobody can justify. This ran at module load when the scale was a
 * constant; now that it is editable it runs before every save.
 */
export function assertGradingConfigWellFormed(config: GradingConfig): void {
  const { ca, exam } = config.assessmentWeights;
  if (Math.abs(ca + exam - 100) > 1e-9) {
    throw new ConfigError(
      `Continuous assessment (${ca}) and examination (${exam}) must total 100; they total ${ca + exam}.`,
    );
  }

  const sorted = [...config.scale].sort((a, b) => a.min - b.min);
  if (sorted.length === 0) throw new ConfigError('The grade scale is empty.');
  if (sorted[0].min !== 0) throw new ConfigError('The grade scale must start at 0.');
  if (sorted[sorted.length - 1].max !== 100) throw new ConfigError('The grade scale must end at 100.');

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].min - sorted[i - 1].max;
    if (gap > 0.001) {
      throw new ConfigError(
        `Gap in the grade scale between ${sorted[i - 1].letter} and ${sorted[i].letter}: scores between ${sorted[i - 1].max} and ${sorted[i].min} map to no grade.`,
      );
    }
    if (gap < -0.001) {
      throw new ConfigError(
        `Overlap in the grade scale between ${sorted[i - 1].letter} and ${sorted[i].letter}.`,
      );
    }
  }

  for (const band of config.scale) {
    if (band.point > config.maxGradePoint) {
      throw new ConfigError(
        `Grade ${band.letter} carries ${band.point} points, above the scale maximum of ${config.maxGradePoint}.`,
      );
    }
  }

  const { deansList, good, warning, probation } = config.standing;
  if (!(deansList >= good && good > warning && warning > probation)) {
    throw new ConfigError(
      'Academic standing thresholds must descend: Dean’s list ≥ good > warning > probation.',
    );
  }
}

/**
 * Rubric weights must sum to 1.0. They are renormalised over *available*
 * components at scoring time, so a set that does not total 1 would silently
 * rescale every composite.
 */
export function assertAdmissionsConfigWellFormed(config: AdmissionsConfig): void {
  const sum = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new ConfigError(`Admission rubric weights must total 1.00; they total ${sum.toFixed(4)}.`);
  }
}

export function assertEnrollmentPolicyWellFormed(policy: EnrollmentPolicy): void {
  if (policy.minCreditsPerTerm > policy.maxCreditsPerTerm) {
    throw new ConfigError('The minimum credit load cannot exceed the maximum.');
  }
  if (policy.maxCreditsWithOverloadApproval < policy.maxCreditsPerTerm) {
    throw new ConfigError('The overload ceiling cannot be below the normal maximum.');
  }
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

/**
 * Parse one stored JSON column, falling back to the default when it is absent
 * or unreadable.
 *
 * Falling back rather than throwing is deliberate: a school with one corrupt
 * config column should still be able to sign in and fix it, not be locked out
 * of its own settings page. The failure is logged so it is not invisible.
 */
function parseColumn<T>(raw: string | null | undefined, schema: z.ZodType<T>, fallback: T, label: string): T {
  if (!raw) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`[config] ${label} failed validation, using defaults:`, parsed.error.issues[0]?.message);
      return fallback;
    }
    return parsed.data;
  } catch (error) {
    console.error(`[config] ${label} is not valid JSON, using defaults:`, error);
    return fallback;
  }
}

export interface RawSchoolConfig {
  attendanceJson?: string | null;
  resultWorkflowJson?: string | null;
  k12Json?: string | null;
  gradingJson?: string | null;
  enrollmentJson?: string | null;
  admissionsJson?: string | null;
  financeJson?: string | null;
  brandingJson?: string | null;
  localeJson?: string | null;
  registrationPortalJson?: string | null;
}

/** Turn the stored row into the typed bundle the domain layer consumes. */
export function parseSchoolConfig(
  raw: RawSchoolConfig | null | undefined,
  defaults: { name: string; short: string; brandColor: string; logoUrl: string | null },
): SchoolConfigBundle {
  return {
    grading: parseColumn(raw?.gradingJson, GradingConfigZ, DEFAULT_GRADING_CONFIG, 'grading'),
    enrollment: parseColumn(raw?.enrollmentJson, EnrollmentPolicyZ, DEFAULT_ENROLLMENT_POLICY, 'enrollment'),
    admissions: parseColumn(raw?.admissionsJson, AdmissionsConfigZ, DEFAULT_ADMISSIONS_CONFIG, 'admissions'),
    finance: parseColumn(raw?.financeJson, FinanceConfigZ, DEFAULT_FINANCE_CONFIG, 'finance'),
    branding: parseColumn(raw?.brandingJson, BrandingConfigZ, defaults, 'branding'),
    locale: parseColumn(raw?.localeJson, LocaleConfigZ, DEFAULT_LOCALE_CONFIG, 'locale'),
    registrationPortal: parseColumn(
      raw?.registrationPortalJson,
      RegistrationPortalConfigZ,
      DEFAULT_REGISTRATION_PORTAL_CONFIG,
      'registrationPortal',
    ),
    k12: parseColumn(raw?.k12Json, K12ConfigZ, DEFAULT_K12_CONFIG, 'k12'),
    attendance: parseColumn(
      raw?.attendanceJson,
      AttendancePolicyZ,
      DEFAULT_ATTENDANCE_POLICY,
      'attendance',
    ),
    resultWorkflow: parseColumn(
      raw?.resultWorkflowJson,
      ResultWorkflowPolicyZ,
      DEFAULT_RESULT_WORKFLOW,
      'resultWorkflow',
    ),
  };
}

/** The bundle every school starts from before it configures itself. */
export function defaultConfigBundle(defaults: {
  name: string;
  short: string;
  brandColor: string;
  logoUrl: string | null;
}): SchoolConfigBundle {
  return {
    grading: DEFAULT_GRADING_CONFIG,
    enrollment: DEFAULT_ENROLLMENT_POLICY,
    admissions: DEFAULT_ADMISSIONS_CONFIG,
    finance: DEFAULT_FINANCE_CONFIG,
    branding: defaults,
    locale: DEFAULT_LOCALE_CONFIG,
    registrationPortal: DEFAULT_REGISTRATION_PORTAL_CONFIG,
    k12: DEFAULT_K12_CONFIG,
    attendance: DEFAULT_ATTENDANCE_POLICY,
    resultWorkflow: DEFAULT_RESULT_WORKFLOW,
  };
}
