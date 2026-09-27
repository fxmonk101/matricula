/**
 * Single source of truth for every enumerated value in the system.
 *
 * The database stores these as plain strings (for cross-engine portability),
 * so this module is the boundary that makes them type-safe. Nothing outside
 * this file should hard-code an enum literal.
 */

/**
 * A role is held per-school, on `Membership` — never on `User`. The same
 * person can be an instructor at one school and a guardian at another, and
 * neither fact should authorise them at the other.
 */
export const ROLES = [
  /**
   * The school's own super administrator, created by the platform when a
   * school is provisioned. Everything ADMIN has, plus user management,
   * destructive deletes and subscription visibility — and deliberately NOT
   * removable or demotable by an ADMIN, so a mistaken or rogue admin cannot
   * lock a school out of its own account.
   */
  'OWNER',
  'ADMIN',
  /**
   * The senior academic officer, and in a university the busiest account in the
   * system. Owns the academic structure — faculties, departments, programmes,
   * courses — appoints deans and heads of department, and is the top of the
   * academic reporting line.
   */
  'REGISTRAR',
  /**
   * Head of a FACULTY. Builds the timetable for it and assigns lecturers to
   * the sections its departments own. Deans report to the Registrar.
   */
  'DEAN',
  /**
   * Head of a DEPARTMENT. Assigns teaching within it and answers to a Dean.
   * A HOD normally also lectures, which is why the role carries the teaching
   * permissions as well.
   */
  'HOD',
  /** The Bursary. Registers students and runs the fee ledger. */
  'FINANCE',
  'ADMISSIONS',
  'INSTRUCTOR',
  'STUDENT',
  'APPLICANT',
  'LIBRARIAN',
  'STAFF',
  'GUARDIAN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'School Owner',
  ADMIN: 'School Administrator',
  REGISTRAR: 'Registrar',
  DEAN: 'Dean',
  HOD: 'Head of Department',
  FINANCE: 'Bursar',
  ADMISSIONS: 'Admissions Officer',
  INSTRUCTOR: 'Lecturer',
  STUDENT: 'Student',
  APPLICANT: 'Applicant',
  LIBRARIAN: 'Librarian',
  STAFF: 'Staff',
  GUARDIAN: 'Parent / Guardian',
};

/** Landing page per role after sign-in. */
/**
 * Where each role lands after signing in.
 *
 * EVERY destination here must be reachable by that role under `ROUTE_GUARDS`,
 * or signing in bounces the user straight to /forbidden. `tests/routing.test.ts`
 * pins that invariant, because the two tables live in different files and it is
 * otherwise very easy to add a role to one and forget the other — which is
 * exactly how LIBRARIAN, STAFF and GUARDIAN ended up pointed at /dashboard, a
 * page all three are forbidden from.
 */
export const ROLE_HOME: Record<Role, string> = {
  OWNER: '/dashboard',
  ADMIN: '/dashboard',
  REGISTRAR: '/dashboard',
  // A dean and a head of department both start on the people who report to
  // them, which is the thing their job is actually organised around.
  DEAN: '/team',
  HOD: '/team',
  FINANCE: '/finance',
  ADMISSIONS: '/admissions',
  INSTRUCTOR: '/teaching',
  STUDENT: '/me',
  APPLICANT: '/portal',
  LIBRARIAN: '/forums',
  STAFF: '/tasks',
  GUARDIAN: '/family',
};

// -----------------------------------------------------------------------------
// Tenancy
// -----------------------------------------------------------------------------

/**
 * Selects which academic engines and vocabulary a school runs on. A university
 * has faculties, programs, credit hours and a CGPA; a K-12 school has year
 * groups, form classes, subjects and a termly report card. Overloading one set
 * of concepts to mean both is how school systems become unusable for either.
 */
export const ACADEMIC_MODELS = ['HIGHER_ED', 'K12'] as const;
export type AcademicModel = (typeof ACADEMIC_MODELS)[number];

export const ACADEMIC_MODEL_LABELS: Record<AcademicModel, string> = {
  HIGHER_ED: 'Higher education',
  K12: 'Primary & secondary',
};

export const SCHOOL_STATUSES = ['ACTIVE', 'TRIAL', 'SUSPENDED', 'PROVISIONING'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

/**
 * May the public reach this school at all — its branded login page, its
 * application form, the school picker?
 *
 * An ALLOW-LIST, and that is the point. Every one of these checks used to read
 * `status === 'SUSPENDED'`, which meant a school in PROVISIONING — half set up,
 * possibly with no grading scheme and no terms — was fully reachable by anyone
 * who knew its slug. A deny-list also admits by default any status added later,
 * which is exactly backwards for a gate.
 */
export function schoolAcceptsPublicTraffic(status: string): boolean {
  return status === 'ACTIVE' || status === 'TRIAL';
}

/**
 * May this person sign in to this school?
 *
 * PROVISIONING is the interesting case. The platform creates a school and its
 * OWNER together, and that owner has to get in to finish the setup — but staff
 * and pupils must not, or they arrive at a school with no grading scheme, no
 * terms and no timetable and conclude the product is broken. So the owner is
 * let through and nobody else is.
 *
 * Unrecognised statuses deny. A gate that admits what it does not understand is
 * not a gate.
 */
export function schoolAllowsSignIn(status: string, role: Role): boolean {
  if (schoolAcceptsPublicTraffic(status)) return true;
  if (status === 'PROVISIONING') return role === 'OWNER';
  return false;
}

/**
 * May the sign-in FORM be rendered for this school?
 *
 * Distinct from `schoolAcceptsPublicTraffic`, and the distinction is the whole
 * point. A school being provisioned takes no applications and belongs in no
 * public picker — but its owner was just handed a link to it and has to be able
 * to get in and finish the setup. Deciding whether to render the form with the
 * PUBLIC rule 404s that owner out of the school they were given thirty seconds
 * earlier, which is exactly what happened.
 *
 * Rendering the form is not authorisation. Whether a particular person may
 * actually sign in is still `schoolAllowsSignIn(status, role)`, applied per
 * membership once the credentials are known — so a teacher at a provisioning
 * school reaches the form and is refused, rather than being told the school
 * does not exist.
 */
export function schoolAcceptsSignIn(status: string): boolean {
  return schoolAcceptsPublicTraffic(status) || status === 'PROVISIONING';
}

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ORG_UNIT_KINDS = [
  'FACULTY',
  'DEPARTMENT',
  'ADMIN_UNIT',
  'SCHOOL_SECTION',
  'TEAM',
] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

/** Ships unused; the SSO phase reads it. */
export const IDP_KINDS = ['OIDC', 'SAML', 'GOOGLE', 'ENTRA'] as const;
export type IdpKind = (typeof IDP_KINDS)[number];

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

// -----------------------------------------------------------------------------
// Tasks (Phase 3)
// -----------------------------------------------------------------------------

export const TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'SUBMITTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Legal transitions of the task state machine.
 *
 * Three properties are deliberate:
 *
 * 1. **SUBMITTED is not COMPLETED.** Work an assignee declares finished is not
 *    the same as work the assigner has accepted. Collapsing the two would make
 *    "the teacher says they submitted grades" and "grades are in" the same
 *    fact, and a dean's dashboard would then be a report of intentions.
 * 2. **COMPLETED can reopen.** Acceptance is reversible for as long as the
 *    thing itself is — a gradesheet accepted in error must be re-openable
 *    without fabricating a second task.
 * 3. **CANCELLED is terminal.** A task withdrawn by the assigner is not
 *    resurrected; a new one is raised. That keeps the audit trail honest about
 *    what was asked and when.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'SUBMITTED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'SUBMITTED', 'OPEN', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
  SUBMITTED: ['COMPLETED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
};

/** Statuses that stop the clock — an overdue calculation ignores these. */
export const TASK_CLOSED_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED'];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_KINDS = [
  /** Teach this section this term. Raised automatically on assignment. */
  'COURSE_ASSIGNMENT',
  /** Submit and post the gradesheet for a section. */
  'GRADE_SUBMISSION',
  /** Produce or supply a document. */
  'DOCUMENT_REQUEST',
  /** New staff or student onboarding step. */
  'ONBOARDING',
  /** Review reported content. */
  'MODERATION',
  /** Review a batch of applications. */
  'ADMISSIONS_REVIEW',
  /** Anything a manager types themselves. */
  'GENERAL',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_EVENT_KINDS = [
  'CREATED',
  'STATUS_CHANGED',
  'REASSIGNED',
  'DUE_DATE_CHANGED',
  'PRIORITY_CHANGED',
  'COMMENTED',
  'ESCALATED',
] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal task transition: ${from} -> ${to}`);
  }
}

// -----------------------------------------------------------------------------
// Notifications (Phase 3)
// -----------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_ESCALATED',
  'TASK_COMMENTED',
  'TASK_COMPLETED',
  'GRADES_POSTED',
  'APPLICATION_DECIDED',
  'INVOICE_ISSUED',
  'ANNOUNCEMENT',
  // A live class has been put on the timetable. The column is a String, so
  // adding a kind needs no migration — only this union.
  'MEETING_SCHEDULED',
  // A hold stops a student registering; being told only at the registration
  // page, on the day, is how a student misses a term.
  'HOLD_PLACED',
  'HOLD_RELEASED',
  'REGISTRATION_OPEN',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// -----------------------------------------------------------------------------
// Forums (Phase 4)
// -----------------------------------------------------------------------------

/**
 * Who a forum is for.
 *
 * This is the load-bearing distinction of the whole feature: staff discuss a
 * pupil's progress, a disciplinary matter or a colleague's workload, and none
 * of it may leak into a student-visible space.
 */
export const FORUM_AUDIENCES = ['STAFF', 'STUDENT', 'ALL'] as const;
export type ForumAudience = (typeof FORUM_AUDIENCES)[number];

export const THREAD_STATUSES = ['OPEN', 'LOCKED', 'HIDDEN', 'DELETED'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const REPORT_REASONS = [
  'SPAM',
  'ABUSE',
  'OFF_TOPIC',
  'PERSONAL_DATA',
  'ACADEMIC_DISHONESTY',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['PENDING', 'UPHELD', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Reactions are a fixed, small set — not free-form emoji. */
export const REACTION_KINDS = ['LIKE', 'HELPFUL', 'AGREE'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam or advertising',
  ABUSE: 'Abusive or harassing',
  OFF_TOPIC: 'Off topic',
  PERSONAL_DATA: 'Contains personal data',
  ACADEMIC_DISHONESTY: 'Academic dishonesty',
  OTHER: 'Something else',
};
