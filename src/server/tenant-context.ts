import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { dbFor, platformDb, type TenantClient } from '@/lib/tenant';
import { loadSchoolConfig } from './school-config';
import { makeMoney, type Money } from '@/lib/domain/money';
import type { SchoolConfigBundle } from '@/lib/domain/config';
import { getSession } from '@/lib/auth/session';
import { guardForPath, roleSatisfies } from '@/lib/auth/rbac';
import type { SessionClaims } from '@/lib/auth/jwt';
import { schoolAllowsSignIn, type AcademicModel, type Role } from '@/lib/domain/enums';

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
  /** This school's grading scale, credit limits, rubric, currency, branding. */
  config: SchoolConfigBundle;
  /** Formatters bound to this school's currency. */
  money: Money;
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
  // The session names a school that no longer exists, or is not open to this
  // person right now. Treating that as signed-out is the safe reading: a
  // suspended school's staff should not keep working off a token minted before
  // the suspension, and a half-provisioned school should admit only its owner.
  //
  // An ALLOW-LIST via schoolAllowsSignIn, not the `=== 'SUSPENDED'` test this
  // replaces — that deny-list let a PROVISIONING school be used in full by
  // anyone holding a membership of it.
  if (!school || !schoolAllowsSignIn(school.status, session.role)) return null;

  const config = await loadSchoolConfig(school.id);

  return {
    session,
    schoolId: school.id,
    school,
    role: session.role,
    membershipId: session.mbr,
    db: dbFor(school.id),
    config,
    money: makeMoney(config.finance.currency),
    isPlatformAdmin: session.pa === true,
  };
});

/**
 * Tenant context, or send the user to sign in.
 *
 * Redirects to `/session/end`, NOT to `/login`, and the difference matters.
 *
 * Middleware runs at the edge and can only check that the token's signature and
 * expiry are good. This function additionally checks that the school still
 * exists and is not suspended. When those two disagree — a token that is
 * cryptographically fine but names a school that has been deleted, or a
 * membership that has been revoked — redirecting to `/login` produces an
 * INFINITE LOOP: middleware sees a valid cookie on the login page and bounces
 * the user back to their role's home, which rejects them again.
 *
 * `/session/end` clears the cookie first, so the next request arrives anonymous
 * and the two layers agree. A React Server Component cannot delete a cookie
 * during render, which is why this has to be a redirect to a route handler
 * rather than a call made here.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) redirect('/session/end?reason=expired');
  return ctx;
}

/**
 * Tenant context for a PAGE, with its roles read from the route table.
 *
 * Use this in a page rather than listing roles by hand. The two used to be
 * written separately — ROUTE_GUARDS in one file, requireTenantRole(...) in each
 * page — and they drifted: adding DEAN and HOD to the guards without touching
 * the pages meant middleware admitted them and the page then bounced them to
 * /forbidden. A role advertised in the sidebar and refused on arrival is worse
 * than one that was never offered.
 *
 * Taking the prefix as an argument rather than reading the request path is
 * deliberate: a page states which guard it is under, so a mistyped prefix is a
 * visible string rather than a silent mismatch, and a nested page can opt into
 * its parent's guard on purpose.
 */
export async function requireRoute(prefix: string): Promise<TenantContext> {
  const guard = guardForPath(prefix);
  if (!guard) {
    // An unguarded page still needs a tenant, but asserts no role — better than
    // silently admitting everybody through an empty allow-list.
    return requireTenantContext();
  }
  return requireTenantRole(...guard.roles);
}

/**
 * Tenant context with a role assertion — for actions, and for pages whose
 * allowed roles genuinely differ from their route guard.
 * Guards the ROUTE; guarding the RECORD is still the caller's job.
 */
export async function requireTenantRole(...allowed: Role[]): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  // `roleSatisfies`, not `allowed.includes` — OWNER outranks ADMIN, and that
  // rule lives in one function rather than in every call site.
  if (!roleSatisfies(ctx.role, allowed)) redirect('/forbidden');
  return ctx;
}
