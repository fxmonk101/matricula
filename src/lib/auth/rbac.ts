/**
 * =============================================================================
 * ROLE-BASED ACCESS CONTROL
 * =============================================================================
 *
 * Permissions are declared once, as data, and consulted everywhere. The
 * alternative — scattering `if (role === 'ADMIN' || role === 'REGISTRAR')`
 * across route handlers — guarantees that the day a role is added, some check
 * is missed. A missed check in a student record system is a privacy incident.
 *
 * This module is runtime-agnostic (no Node or Prisma imports) so middleware can
 * use it for route gating.
 */

import type { Role } from '@/lib/domain/enums';

export const PERMISSIONS = [
  // People
  'student:read', 'student:write',
  /**
   * Admitting a person as a student of this university: matriculation number,
   * programme, level. Separate from `student:write` (editing a record that
   * already exists) because in a real university these are different desks —
   * the bursary registers, everyone else amends.
   */
  'student:register',
  'instructor:read', 'instructor:write',
  // Academic structure — the Registrar's office
  'faculty:write', 'department:write', 'program:write',
  // Curriculum
  'course:read', 'course:write',
  'offering:read', 'offering:write',
  /**
   * Putting a named lecturer in front of a named section. Held by deans and
   * heads of department rather than by the registry: who teaches what is a
   * faculty decision, and the registry finding out afterwards is the normal
   * order of things.
   */
  'offering:assign',
  'term:write',
  // Timetable
  'timetable:read', 'timetable:write',
  // Registration
  'enrollment:read:any', 'enrollment:read:own', 'enrollment:write:own', 'enrollment:write:any',
  // Assessment
  'grade:submit', 'grade:read:any', 'grade:read:own', 'grade:override',
  'transcript:read:any', 'transcript:read:own',
  // Admissions
  'application:read:any', 'application:read:own', 'application:write:own',
  'application:review', 'application:decide', 'application:convert',
  // Finance
  'invoice:read:any', 'invoice:read:own', 'invoice:write',
  'payment:record', 'payment:read:any', 'payment:read:own',
  'fee:configure',
  // Administration
  'hold:manage', 'user:manage', 'audit:read', 'announcement:write',
  // K-12
  'class:read', 'class:manage', 'marks:enter', 'report:generate', 'report:read:own', 'attendance:record',

  // Course content. `lms:read` is what a STUDENT holds: it means "may open the
  // material of a course I am enrolled on", and enrolment is checked per record.
  // Authoring and publishing are separate because they are separate decisions —
  // writing next week's module is routine, releasing it to a class is not.
  'lms:read', 'lms:author', 'lms:publish',
  // Collaboration (Phase 3)
  'task:read:own', 'task:create', 'task:assign', 'task:admin',
  'team:read', 'notification:read',
  // Owner tier and user management
  'user:create', 'user:role:set', 'user:suspend', 'user:password:reset',
  'school:delete', 'subscription:read',
  // Forums (Phase 4)
  'forum:read', 'forum:post', 'forum:moderate',
  /** Opening a new forum. The registry runs the university's noticeboards. */
  'forum:create',
  // Library (Phase 5)
  'library:read', 'library:manage', 'library:analytics',
  // School configuration & organisation (tenant-scoped)
  'school:config:read', 'school:config:write',
  'org:read', 'org:manage',
  'directory:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Everything a school administrator holds. Named because OWNER is built from
 * it — see below.
 */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  'student:read', 'student:write',
  'instructor:read', 'instructor:write',
  'course:read', 'course:write',
  'offering:read', 'offering:write', 'term:write',
  'enrollment:read:any', 'enrollment:write:any',
  'grade:read:any', 'grade:override',
  'transcript:read:any',
  'application:read:any', 'application:decide', 'application:convert',
  'invoice:read:any', 'invoice:write', 'payment:record', 'payment:read:any', 'fee:configure',
  'hold:manage', 'user:manage', 'audit:read', 'announcement:write',
  'school:config:read', 'school:config:write', 'org:read', 'org:manage', 'directory:read',
  'class:read', 'class:manage', 'report:generate', 'attendance:record',
  'task:read:own', 'task:create', 'task:assign', 'task:admin', 'team:read', 'notification:read',
  'forum:read', 'forum:post', 'forum:moderate',
  'library:read', 'library:manage', 'library:analytics',
  // Running a school means adding and removing the people in it. These are
  // held by ADMIN as well as OWNER: an administrator who cannot enrol a
  // teacher is not an administrator. What an admin cannot do is act on the
  // OWNER's own record, and that is enforced per-ROW in the people service,
  // because it is a fact about the row and not about the actor's role.
  'user:create', 'user:role:set', 'user:suspend', 'user:password:reset',
  // The structural grants added for the university role model. ADMIN keeps a
  // superset of every school role, so a school with nobody in a given seat
  // can still be operated by its administrator.
  'faculty:write', 'department:write', 'program:write',
  'offering:assign', 'student:register',
  'lms:read', 'lms:author', 'lms:publish',
  'timetable:read', 'timetable:write',
  'forum:create',
];

/**
 * What an OWNER holds that an ADMIN does not.
 *
 * Two things, and they are the two an administrator must not be able to do
 * unilaterally: end the school's relationship with the vendor, and see what it
 * is being charged. Everything else an owner can do, an admin can do — with the
 * single per-record exception that only an owner may act on the owner.
 */
const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ['school:delete', 'subscription:read'];

/**
 * The authorisation matrix.
 *
 * Note that ADMIN is NOT granted `grade:submit`. An administrator can override
 * a grade — an audited, deliberate act — but cannot originate one. Separating
 * those two capabilities is what keeps the grade ledger trustworthy.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  /**
   * The school's super administrator. Composed from ADMIN rather than restating
   * it: the two lists were duplicated line for line, which is a guarantee that
   * a permission added to one will one day be missing from the other.
   */
  OWNER: [...ADMIN_PERMISSIONS, ...OWNER_ONLY_PERMISSIONS],

  ADMIN: ADMIN_PERMISSIONS,

  /**
   * In a university this is the senior academic office, and the app now
   * reflects that: the Registrar builds the institution’s structure
   * (faculties, departments, programmes, courses), appoints the deans and
   * heads of department who run it, opens the forums the institution talks
   * on, and sits at the top of the academic reporting line.
   *
   * Note what is NOT here: student:register. Admitting a student is the
   * Bursary’s desk — see FINANCE below for why.
   */
  REGISTRAR: [
    'class:read', 'class:manage', 'report:generate', 'attendance:record',
    'student:read', 'student:write',
    'instructor:read', 'instructor:write',
    'faculty:write', 'department:write', 'program:write',
    'course:read', 'course:write',
    'offering:read', 'offering:write', 'offering:assign', 'term:write',
    'timetable:read', 'timetable:write',
    'enrollment:read:any', 'enrollment:write:any',
    'grade:read:any', 'grade:override',
    'transcript:read:any',
    'application:read:any', 'application:convert',
    'invoice:read:any',
    'hold:manage', 'audit:read', 'announcement:write',
    'org:read', 'org:manage', 'directory:read',
    'user:create', 'user:role:set', 'user:suspend', 'user:password:reset', 'user:manage',
    'task:read:own', 'task:create', 'task:assign', 'task:admin', 'team:read', 'notification:read',
    'forum:read', 'forum:post', 'forum:moderate', 'forum:create',
    'library:read', 'library:manage', 'library:analytics',
  ],

  /**
   * Head of a faculty. Owns the TIMETABLE and decides who teaches what
   * within it — the two things a dean is actually asked for. Reads across
   * the faculty’s students and grades and manages the departments under
   * them, but holds nothing reaching the fee ledger or another faculty.
   */
  DEAN: [
    'student:read',
    'instructor:read',
    'department:write',
    'course:read', 'course:write',
    'offering:read', 'offering:write', 'offering:assign',
    'lms:read', 'lms:author', 'lms:publish',
    'timetable:read', 'timetable:write',
    'enrollment:read:any',
    'grade:read:any',
    'transcript:read:any',
    'class:read', 'report:generate',
    'announcement:write',
    'org:read', 'directory:read',
    'task:read:own', 'task:create', 'task:assign', 'task:admin', 'team:read', 'notification:read',
    'forum:read', 'forum:post', 'forum:moderate',
    'library:read',
  ],

  /**
   * Head of a department, who in almost every university also lectures. So
   * this is the INSTRUCTOR grant plus the departmental ones: assigning
   * teaching, seeing the department’s grades, managing its staff.
   */
  HOD: [
    'class:read', 'marks:enter', 'attendance:record',
    'student:read',
    'instructor:read',
    'course:read', 'course:write',
    'offering:read', 'offering:write', 'offering:assign',
    'lms:read', 'lms:author', 'lms:publish',
    'timetable:read',
    'enrollment:read:any',
    'grade:submit', 'grade:read:any',
    'report:generate',
    'org:read', 'directory:read',
    'task:read:own', 'task:create', 'task:assign', 'task:admin', 'team:read', 'notification:read',
    'forum:read', 'forum:post', 'forum:moderate',
    'library:read',
  ],

  /**
   * The Bursary. REGISTERS STUDENTS as well as running the fee ledger —
   * deliberately, and it is the one grant here that looks surprising.
   *
   * In a Nigerian or Ghanaian university, registration completes at the
   * bursary: a student is not registered until fees are settled, and the
   * office that confirms the payment is the office that issues the
   * matriculation number. Putting it anywhere else describes a process no
   * school follows, and the registry ends up keeping a spreadsheet instead.
   */
  FINANCE: [
    'student:read', 'student:write', 'student:register',
    'course:read', 'offering:read',
    'enrollment:read:any',
    'invoice:read:any', 'invoice:write',
    'payment:record', 'payment:read:any',
    'fee:configure',
    'hold:manage', 'audit:read',
    'directory:read',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  ADMISSIONS: [
    'student:read',
    'course:read', 'offering:read',
    'application:read:any', 'application:review', 'application:decide', 'application:convert',
    'announcement:write',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  INSTRUCTOR: [
    'class:read', 'marks:enter', 'attendance:record',
    'student:read',
    'course:read', 'offering:read',
    'enrollment:read:any',
    'grade:submit', 'grade:read:any',
    'lms:read', 'lms:author', 'lms:publish',
    'task:read:own', 'task:create', 'task:assign', 'team:read', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  STUDENT: [
    'course:read', 'offering:read',
    'enrollment:read:own', 'enrollment:write:own',
    'grade:read:own', 'transcript:read:own',
    // Read only. A student opens the material of a course they are enrolled on;
    // whether they are enrolled is a question about a record, asked per request.
    'lms:read',
    'invoice:read:own', 'payment:read:own',
    'task:read:own', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  APPLICANT: [
    'course:read',
    'application:read:own', 'application:write:own',
  ],

  // --- roles introduced with multi-tenancy -----------------------------------
  // Their surfaces (library, forums, tasks) arrive in later phases; the roles
  // exist now so the matrix is total and a membership can already be issued.

  LIBRARIAN: [
    'student:read',
    'course:read', 'offering:read',
    'directory:read',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
    'library:read', 'library:manage', 'library:analytics',
  ],

  /** Generic non-teaching staff: office holders, technicians, support. */
  STAFF: [
    'course:read', 'offering:read',
    'directory:read',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  /**
   * Reads their own children's records only. Every guardian route resolves the
   * child list from the signed-in guardian and then checks the requested pupil
   * is on it — the role grants the SHAPE of the access, the link grants the
   * subject.
   */
  GUARDIAN: [
    'grade:read:own', 'invoice:read:own', 'payment:read:own', 'report:read:own',
  ],
};

/**
 * Does `actual` satisfy a requirement expressed as a list of roles?
 *
 * OWNER is a strict superset of ADMIN, so it satisfies anywhere ADMIN would.
 * Stated ONCE, here, rather than prepending 'OWNER' to the thirty-six
 * `requireTenantRole('ADMIN', …)` calls across the pages — which would work
 * today and then quietly fail on the thirty-seventh, written by someone who
 * did not know the rule.
 *
 * This is a hierarchy between two roles, not a general one. Every other role
 * is a peer: a REGISTRAR is not a lesser ADMIN, it is a different job.
 */
export function roleSatisfies(actual: Role, allowed: readonly Role[]): boolean {
  if (allowed.includes(actual)) return true;
  if (actual === 'OWNER' && allowed.includes('ADMIN')) return true;
  return false;
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(role: Role, ...permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function canAll(role: Role, ...permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

/** Throwing variant for use inside server actions. */
export class ForbiddenError extends Error {
  constructor(permission: Permission, role: Role) {
    super(`Role ${role} lacks the required permission: ${permission}.`);
    this.name = 'ForbiddenError';
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission, role);
}

// -----------------------------------------------------------------------------
// Route gating
// -----------------------------------------------------------------------------

/**
 * Path prefix -> roles permitted to reach it. Evaluated longest-prefix-first by
 * `rolesForPath`, so a more specific rule always beats a broader one regardless
 * of declaration order.
 */
export interface RouteGuard {
  prefix: string;
  roles: Role[];
}

/*
 * There is no `platformOnly` guard any more. The vendor console lives at
 * /operator behind its own cookie and its own middleware branch, so it is not
 * reachable through this table at all — which is stronger than being listed
 * here with an empty role array and a flag.
 */

export const ROUTE_GUARDS: RouteGuard[] = [
  // HOD belongs here. A head of department runs a unit with staff and
  // students in it, and leaving them off the dashboard left the role with no
  // landing page at all — they were bounced to /forbidden by their own home.
  { prefix: '/dashboard', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] },
  { prefix: '/students', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'ADMISSIONS', 'FINANCE'] },
  // Longest-prefix wins. Registration is the Bursary's desk, so a lecturer
  // who may read the student list cannot reach the form that creates one.
  { prefix: '/students/register', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE'] },
  { prefix: '/instructors', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] },
  { prefix: '/courses', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'] },
  { prefix: '/offerings', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT'] },
  { prefix: '/admissions', roles: ['OWNER', 'ADMIN', 'ADMISSIONS', 'REGISTRAR'] },
  { prefix: '/finance', roles: ['OWNER', 'ADMIN', 'FINANCE', 'REGISTRAR'] },
  /*
   * Everyone who can be an INSTRUCTOR OF RECORD, plus the offices that
   * oversee them.
   *
   * DEAN and REGISTRAR are here because every page under this prefix already
   * admits them and `mayAuthorOffering` already trusts them — the guard was
   * the only layer that disagreed, and it silently won. In the demo school
   * that locked a dean out of the five sections they teach: the nav item was
   * missing and the URL bounced to /forbidden, so their own gradesheet,
   * course content and register were unreachable.
   *
   * Senior academics teach. A guard that assumes otherwise is wrong about
   * universities, not about permissions.
   */
  { prefix: '/teaching', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  /*
   * The approval queue. INSTRUCTOR is absent: a lecturer submits results and
   * has no stage of their own to act on, and a page that showed them other
   * departments' marks with every button disabled would be a leak dressed as
   * a courtesy.
   */
  { prefix: '/results', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] },
  { prefix: '/me', roles: ['STUDENT'] },
  // Course content a student is enrolled on. Under /me rather than /courses
  // because that guard admits ADMISSIONS, who have no business reading
  // coursework, and because this is the student's own view of their own course.
  { prefix: '/me/courses', roles: ['STUDENT'] },
  // The K-12 counterpart. A pupil does not register for subjects — they are
  // in a form class and the class has subjects — but the audience is the same.
  { prefix: '/me/subjects', roles: ['STUDENT'] },
  { prefix: '/portal', roles: ['APPLICANT'] },
  { prefix: '/classes', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  { prefix: '/reports', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  { prefix: '/family', roles: ['GUARDIAN'] },
  // Tasks are open to every staff role. Which tasks a person actually sees is
  // a RELATIONSHIP question answered per record by `canViewTask`, not a role
  // question — the guard here only says "may use the task system at all".
  { prefix: '/tasks', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
  // Reachable by any instructor; a lecturer with no reports sees an empty team
  // rather than a 403, because having no subordinates is an ordinary fact
  // about most staff, not a permission failure.
  { prefix: '/team', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  { prefix: '/org', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  // Guardians and applicants are absent on purpose: a parent in the staff
  // room is obviously wrong, and a parent in the student common room is
  // subtler but no better. Which forums a member then sees is decided per
  // forum by `canReadAudience`, not here.
  // Guardians and applicants are absent: the library is for the school's own
  // staff and students. A guardian's access to their child's material runs
  // through the family portal.
  { prefix: '/library', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/library/manage', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'LIBRARIAN'] },
  // Everybody who signs in can read a notice; writing one is gated by
  // `announcement:write` inside the page, not by the route.
  {
    prefix: '/announcements',
    roles: [
      'OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS',
      'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT', 'GUARDIAN',
    ],
  },
  { prefix: '/forums', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/people', roles: ['OWNER', 'ADMIN', 'REGISTRAR'] },
  { prefix: '/structure', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] },
  { prefix: '/timetable', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT'] },
  { prefix: '/setup', roles: ['OWNER', 'ADMIN'] },
  // The registry owns the calendar and the bursary owns the fees, and the two
  // are inseparable: a schedule belongs to a term.
  { prefix: '/calendar', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE'] },
  // EVERY member signs themselves in and out — a lecturer, a librarian and a
  // student all need the same button, and being present in a building is not a
  // privilege any role grants or withholds. Guardians and applicants are absent
  // because neither is ever in the building as a member of it.
  { prefix: '/presence', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/presence/teaching', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'] },
  // Reading somebody ELSE's register is oversight, not self-service, so this
  // needs its own guard: without it the rule above would apply by longest
  // prefix and hand a student the attendance of everybody in the building.
  // INSTRUCTOR is absent deliberately — teaching somebody is not overseeing
  // them, and a lecturer's own reports (if any) are on /team.
  { prefix: '/presence/team', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] },
  { prefix: '/settings/school', roles: ['OWNER', 'ADMIN'] },
  { prefix: '/admin', roles: ['OWNER', 'ADMIN'] },
];

/** The guard covering `path`, or null when the path is unguarded. */
export function guardForPath(path: string): RouteGuard | null {
  let match: RouteGuard | null = null;
  for (const guard of ROUTE_GUARDS) {
    if (path === guard.prefix || path.startsWith(`${guard.prefix}/`)) {
      // Longest matching prefix wins, so a specific rule always beats a
      // broader one regardless of declaration order.
      if (!match || guard.prefix.length > match.prefix.length) match = guard;
    }
  }
  return match;
}

/** Roles allowed on `path`, or null when the path is unguarded. */
export function rolesForPath(path: string): Role[] | null {
  return guardForPath(path)?.roles ?? null;
}
