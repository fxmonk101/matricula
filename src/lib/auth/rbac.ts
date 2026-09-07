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
export const ROUTE_GUARDS: { prefix: string; roles: Role[] }[] = [
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
  { prefix: '/admin', roles: ['ADMIN'] },
];

/** Roles allowed on `path`, or null when the path is unguarded. */
export function rolesForPath(path: string): Role[] | null {
  let match: { prefix: string; roles: Role[] } | null = null;
  for (const guard of ROUTE_GUARDS) {
    if (path === guard.prefix || path.startsWith(`${guard.prefix}/`)) {
      if (!match || guard.prefix.length > match.prefix.length) match = guard;
    }
  }
  return match?.roles ?? null;
}
