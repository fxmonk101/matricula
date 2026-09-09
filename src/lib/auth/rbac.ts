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
  'instructor:read', 'instructor:write',
  // Curriculum
  'course:read', 'course:write',
  'offering:read', 'offering:write',
  'term:write',
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
  // Collaboration (Phase 3)
  'task:read:own', 'task:create', 'task:assign', 'task:admin',
  'team:read', 'notification:read',
  // Owner tier and user management
  'user:create', 'user:role:set', 'user:suspend', 'user:password:reset',
  'school:delete', 'subscription:read',
  // Forums (Phase 4)
  'forum:read', 'forum:post', 'forum:moderate',
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

  REGISTRAR: [
    'class:read', 'class:manage', 'report:generate', 'attendance:record',
    'student:read', 'student:write',
    'instructor:read',
    'course:read', 'course:write',
    'offering:read', 'offering:write', 'term:write',
    'enrollment:read:any', 'enrollment:write:any',
    'grade:read:any', 'grade:override',
    'transcript:read:any',
    'application:read:any', 'application:convert',
    'invoice:read:any',
    'hold:manage', 'audit:read', 'announcement:write',
    'task:read:own', 'task:create', 'task:assign', 'task:admin', 'team:read', 'notification:read',
    'forum:read', 'forum:post', 'forum:moderate',
    'library:read', 'library:manage', 'library:analytics',
  ],

  FINANCE: [
    'student:read',
    'invoice:read:any', 'invoice:write',
    'payment:record', 'payment:read:any',
    'fee:configure',
    'hold:manage', 'audit:read',
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
    'task:read:own', 'task:create', 'task:assign', 'team:read', 'notification:read',
    'forum:read', 'forum:post',
    'library:read',
  ],

  STUDENT: [
    'course:read', 'offering:read',
    'enrollment:read:own', 'enrollment:write:own',
    'grade:read:own', 'transcript:read:own',
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
  /**
   * Platform-operator routes. These sit OUTSIDE the per-school role matrix —
   * a school administrator must never reach them by holding a role, so they
   * are checked against the session's platform-admin claim instead.
   */
  platformOnly?: boolean;
}

export const ROUTE_GUARDS: RouteGuard[] = [
  { prefix: '/dashboard', roles: ['OWNER', 'ADMIN', 'REGISTRAR'] },
  { prefix: '/students', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'ADMISSIONS', 'FINANCE'] },
  { prefix: '/instructors', roles: ['OWNER', 'ADMIN', 'REGISTRAR'] },
  { prefix: '/courses', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'] },
  { prefix: '/offerings', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT'] },
  { prefix: '/admissions', roles: ['OWNER', 'ADMIN', 'ADMISSIONS', 'REGISTRAR'] },
  { prefix: '/finance', roles: ['OWNER', 'ADMIN', 'FINANCE', 'REGISTRAR'] },
  { prefix: '/teaching', roles: ['INSTRUCTOR', 'ADMIN'] },
  { prefix: '/me', roles: ['STUDENT'] },
  { prefix: '/portal', roles: ['APPLICANT'] },
  { prefix: '/classes', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/reports', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/family', roles: ['GUARDIAN'] },
  // Tasks are open to every staff role. Which tasks a person actually sees is
  // a RELATIONSHIP question answered per record by `canViewTask`, not a role
  // question — the guard here only says "may use the task system at all".
  { prefix: '/tasks', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
  // Reachable by any instructor; a lecturer with no reports sees an empty team
  // rather than a 403, because having no subordinates is an ordinary fact
  // about most staff, not a permission failure.
  { prefix: '/team', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/org', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  // Guardians and applicants are absent on purpose: a parent in the staff
  // room is obviously wrong, and a parent in the student common room is
  // subtler but no better. Which forums a member then sees is decided per
  // forum by `canReadAudience`, not here.
  // Guardians and applicants are absent: the library is for the school's own
  // staff and students. A guardian's access to their child's material runs
  // through the family portal.
  { prefix: '/library', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/library/manage', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'LIBRARIAN'] },
  { prefix: '/forums', roles: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/people', roles: ['OWNER', 'ADMIN', 'REGISTRAR'] },
  { prefix: '/setup', roles: ['OWNER', 'ADMIN'] },
  { prefix: '/settings/school', roles: ['OWNER', 'ADMIN'] },
  // Longest-prefix wins, so this stays reachable by a school ADMIN while
  // /admin/platform below is platform-only.
  { prefix: '/admin', roles: ['OWNER', 'ADMIN'] },
  { prefix: '/admin/platform', roles: [], platformOnly: true },
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
