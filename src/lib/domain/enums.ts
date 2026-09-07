/**
 * Single source of truth for every enumerated value in the system.
 *
 * The database stores these as plain strings (for cross-engine portability),
 * so this module is the boundary that makes them type-safe. Nothing outside
 * this file should hard-code an enum literal.
 */

export const ROLES = [
  'ADMIN',
  'REGISTRAR',
  'FINANCE',
  'ADMISSIONS',
  'INSTRUCTOR',
  'STUDENT',
  'APPLICANT',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'System Administrator',
  REGISTRAR: 'Registrar',
  FINANCE: 'Bursary / Finance',
  ADMISSIONS: 'Admissions Officer',
  INSTRUCTOR: 'Instructor',
  STUDENT: 'Student',
  APPLICANT: 'Applicant',
};

/** Landing page per role after sign-in. */
export const ROLE_HOME: Record<Role, string> = {
  ADMIN: '/dashboard',
  REGISTRAR: '/dashboard',
  FINANCE: '/finance',
  ADMISSIONS: '/admissions',
  INSTRUCTOR: '/teaching',
  STUDENT: '/me',
  APPLICANT: '/portal',
};

export const DEGREE_TYPES = ['BSC', 'BA', 'BENG', 'MSC', 'MA', 'PHD', 'DIPLOMA'] as const;
export type DegreeType = (typeof DEGREE_TYPES)[number];

export const TERM_SEASONS = ['FALL', 'SPRING', 'SUMMER'] as const;
export type TermSeason = (typeof TERM_SEASONS)[number];

export const OFFERING_STATUSES = ['PLANNED', 'OPEN', 'CLOSED', 'CANCELLED'] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];

export const ENROLLMENT_STATUSES = [
  'REGISTERED',
  'WAITLISTED',
  'DROPPED',
  'WITHDRAWN',
  'COMPLETED',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Statuses that consume a seat. */
export const SEAT_CONSUMING_STATUSES: EnrollmentStatus[] = ['REGISTERED', 'COMPLETED'];

export const STUDENT_STATUSES = [
  'ACTIVE',
  'PROBATION',
  'SUSPENDED',
  'WITHDRAWN',
  'GRADUATED',
  'DEFERRED',
] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const ACADEMIC_STANDINGS = [
  'GOOD',
  'DEANS_LIST',
  'WARNING',
  'PROBATION',
  'DISMISSED',
] as const;
export type AcademicStanding = (typeof ACADEMIC_STANDINGS)[number];

export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'OFFERED',
  'WAITLISTED',
  'REJECTED',
  'ACCEPTED',
  'DECLINED',
  'ENROLLED',
  'WITHDRAWN',
  'EXPIRED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Legal transitions of the admissions state machine. Any transition not listed
 * here is rejected by `assertApplicationTransition`.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'WITHDRAWN', 'REJECTED'],
  UNDER_REVIEW: ['OFFERED', 'WAITLISTED', 'REJECTED', 'WITHDRAWN'],
  WAITLISTED: ['OFFERED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
  OFFERED: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'],
  ACCEPTED: ['ENROLLED', 'WITHDRAWN'],
  REJECTED: [],
  DECLINED: [],
  ENROLLED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export const REVIEW_RECOMMENDATIONS = ['ADMIT', 'WAITLIST', 'REJECT'] as const;
export type ReviewRecommendation = (typeof REVIEW_RECOMMENDATIONS)[number];

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CARD',
  'BANK_TRANSFER',
  'CASH',
  'CHEQUE',
  'SCHOLARSHIP',
  'WAIVER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const HOLD_KINDS = [
  'FINANCIAL',
  'ACADEMIC',
  'DISCIPLINARY',
  'DOCUMENTATION',
  'HEALTH',
] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export const REQUIREMENT_KINDS = ['CORE', 'ELECTIVE', 'GENERAL_STUDIES'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const ACADEMIC_RANKS = [
  'PROFESSOR',
  'ASSOCIATE_PROFESSOR',
  'SENIOR_LECTURER',
  'LECTURER',
  'ASSISTANT_LECTURER',
] as const;
export type AcademicRank = (typeof ACADEMIC_RANKS)[number];

export const DAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** Narrowing helper: `isRole(x)` proves `x is Role`. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function assertApplicationTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (!APPLICATION_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal application transition: ${from} -> ${to}`);
  }
}
