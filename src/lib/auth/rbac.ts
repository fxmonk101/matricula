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
  // Forums (Phase 4)
  'forum:read', 'forum:post', 'forum:moderate',
  // School configuration & organisation (tenant-scoped)
  'school:config:read', 'school:config:write',
  'org:read', 'org:manage',
  'directory:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The authorisation matrix.
 *
 * Note that ADMIN is NOT granted `grade:submit`. An administrator can override
 * a grade — an audited, deliberate act — but cannot originate one. Separating
 * those two capabilities is what keeps the grade ledger trustworthy.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: [
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
  ],

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
  ],

  FINANCE: [
    'student:read',
    'invoice:read:any', 'invoice:write',
    'payment:record', 'payment:read:any',
    'fee:configure',
    'hold:manage', 'audit:read',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
  ],

  ADMISSIONS: [
    'student:read',
    'course:read', 'offering:read',
    'application:read:any', 'application:review', 'application:decide', 'application:convert',
    'announcement:write',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
  ],

  INSTRUCTOR: [
    'class:read', 'marks:enter', 'attendance:record',
    'student:read',
    'course:read', 'offering:read',
    'enrollment:read:any',
    'grade:submit', 'grade:read:any',
    'task:read:own', 'task:create', 'task:assign', 'team:read', 'notification:read',
    'forum:read', 'forum:post',
  ],

  STUDENT: [
    'course:read', 'offering:read',
    'enrollment:read:own', 'enrollment:write:own',
    'grade:read:own', 'transcript:read:own',
    'invoice:read:own', 'payment:read:own',
    'task:read:own', 'notification:read',
    'forum:read', 'forum:post',
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
  ],

  /** Generic non-teaching staff: office holders, technicians, support. */
  STAFF: [
    'course:read', 'offering:read',
    'directory:read',
    'task:read:own', 'task:create', 'notification:read',
    'forum:read', 'forum:post',
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
  { prefix: '/dashboard', roles: ['ADMIN', 'REGISTRAR'] },
  { prefix: '/students', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'ADMISSIONS', 'FINANCE'] },
  { prefix: '/instructors', roles: ['ADMIN', 'REGISTRAR'] },
  { prefix: '/courses', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'] },
  { prefix: '/offerings', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT'] },
  { prefix: '/admissions', roles: ['ADMIN', 'ADMISSIONS', 'REGISTRAR'] },
  { prefix: '/finance', roles: ['ADMIN', 'FINANCE', 'REGISTRAR'] },
  { prefix: '/teaching', roles: ['INSTRUCTOR', 'ADMIN'] },
  { prefix: '/me', roles: ['STUDENT'] },
  { prefix: '/portal', roles: ['APPLICANT'] },
  { prefix: '/classes', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/reports', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/family', roles: ['GUARDIAN'] },
  // Tasks are open to every staff role. Which tasks a person actually sees is
  // a RELATIONSHIP question answered per record by `canViewTask`, not a role
  // question — the guard here only says "may use the task system at all".
  { prefix: '/tasks', roles: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
  // Reachable by any instructor; a lecturer with no reports sees an empty team
  // rather than a 403, because having no subordinates is an ordinary fact
  // about most staff, not a permission failure.
  { prefix: '/team', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  { prefix: '/org', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'] },
  // Guardians and applicants are absent on purpose: a parent in the staff
  // room is obviously wrong, and a parent in the student common room is
  // subtler but no better. Which forums a member then sees is decided per
  // forum by `canReadAudience`, not here.
  { prefix: '/forums', roles: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'] },
  { prefix: '/settings/school', roles: ['ADMIN'] },
  // Longest-prefix wins, so this stays reachable by a school ADMIN while
  // /admin/platform below is platform-only.
  { prefix: '/admin', roles: ['ADMIN'] },
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
