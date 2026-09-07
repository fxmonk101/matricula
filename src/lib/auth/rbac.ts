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
  ],

  REGISTRAR: [
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
  ],

  FINANCE: [
    'student:read',
    'invoice:read:any', 'invoice:write',
    'payment:record', 'payment:read:any',
    'fee:configure',
    'hold:manage', 'audit:read',
  ],

  ADMISSIONS: [
    'student:read',
    'course:read', 'offering:read',
    'application:read:any', 'application:review', 'application:decide', 'application:convert',
    'announcement:write',
  ],

  INSTRUCTOR: [
    'student:read',
    'course:read', 'offering:read',
    'enrollment:read:any',
    'grade:submit', 'grade:read:any',
  ],

  STUDENT: [
    'course:read', 'offering:read',
    'enrollment:read:own', 'enrollment:write:own',
    'grade:read:own', 'transcript:read:own',
    'invoice:read:own', 'payment:read:own',
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
  ],

  /** Generic non-teaching staff: office holders, technicians, support. */
  STAFF: [
    'course:read', 'offering:read',
    'directory:read',
  ],

  /** Reads their own children's records. Scoped in the K-12 phase. */
  GUARDIAN: [
    'grade:read:own', 'invoice:read:own', 'payment:read:own',
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
