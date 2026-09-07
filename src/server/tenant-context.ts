import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { dbFor, platformDb, type TenantClient } from '@/lib/tenant';
import { getSession } from '@/lib/auth/session';
import type { SessionClaims } from '@/lib/auth/jwt';
import type { AcademicModel, Role } from '@/lib/domain/enums';

/**
 * Request-scoped tenant context.
 *
 * `cache()` memoises for the lifetime of one request, so a page that renders a
 * header, a sidebar and three cards resolves the school once rather than four
 * times. It is React's per-request cache, not a cross-request one — two users
 * never share a context.
 *
 * This module is deliberately separate from `@/lib/tenant`: that one is
 * runtime-agnostic and importable by seed and maintenance scripts, whereas
 * this one reads cookies and can only run inside a request.
 */

export interface School {
  id: string;
  slug: string;
  code: string;
  name: string;
  shortName: string;
  academicModel: AcademicModel;
  status: string;
  locale: string;
  timezone: string;
  currencyCode: string;
  brandColor: string;
  logoUrl: string | null;
}

export interface TenantContext {
  session: SessionClaims;
  schoolId: string;
  school: School;
  role: Role;
  membershipId: string;
  /** Tenant-scoped Prisma client. Use this, not the bare `db`. */
  db: TenantClient;
  isPlatformAdmin: boolean;
}

/** Resolve the school row for a session, cached per request. */
const loadSchool = cache(async (schoolId: string): Promise<School | null> => {
  const row = await platformDb.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      slug: true,
      code: true,
      name: true,
      shortName: true,
      academicModel: true,
      status: true,
      locale: true,
      timezone: true,
      currencyCode: true,
      brandColor: true,
      logoUrl: true,
    },
  });
  return row ? ({ ...row, academicModel: row.academicModel as AcademicModel }) : null;
});

/**
 * The tenant context for the current request, or null when signed out.
 *
 * Returns null rather than throwing so that shared layouts can render a
 * signed-out state; use `requireTenantContext()` on any page that needs a
 * school.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const school = await loadSchool(session.sch);
  // The session names a school that no longer exists, or has been suspended.
  // Treating that as signed-out is the safe reading: a suspended school's
  // staff should not keep working off a token minted before the suspension.
  if (!school || school.status === 'SUSPENDED') return null;

  return {
    session,
    schoolId: school.id,
    school,
    role: session.role,
    membershipId: session.mbr,
    db: dbFor(school.id),
    isPlatformAdmin: session.pa === true,
  };
});

/** Tenant context, or redirect to sign-in. */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) redirect('/login');
  return ctx;
}

/**
 * Tenant context with a role assertion — the common case in a page or action.
 * Guards the ROUTE; guarding the RECORD is still the caller's job.
 */
export async function requireTenantRole(...allowed: Role[]): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  if (!allowed.includes(ctx.role)) redirect('/forbidden');
  return ctx;
}
