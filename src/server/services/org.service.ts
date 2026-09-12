/**
 * Reporting-line and org-unit queries.
 *
 * No `server-only` guard, for the same reason as `@/server/academics` and
 * `@/server/k12-reports`: the seed and maintenance jobs resolve reporting lines
 * to fan out tasks, and the guard throws outside a React Server Component
 * graph. Nothing client-side imports it, which is what actually keeps it off
 * the browser.
 */

import { cache } from 'react';

import { dbFor } from '@/lib/tenant';
import {
  resolveManagerChain,
  resolveSubordinates,
  buildOrgTree,
  type OrgTreeNode,
  type ReportingNode,
} from '@/lib/domain/org';

/**
 * Every reporting edge in a school.
 *
 * Loaded WHOLE and traversed in memory rather than walked level by level with
 * a query per level. A school's staff list is thousands of rows at the very
 * outside — one indexed scan — whereas recursive descent costs a round trip per
 * level of hierarchy and cannot detect a cycle without extra bookkeeping.
 *
 * `cache()` memoises for the request, so a page rendering a team dashboard, a
 * breadcrumb and a task list resolves the graph once.
 */
export const loadReportingGraph = cache(async (schoolId: string): Promise<ReportingNode[]> => {
  const rows = await dbFor(schoolId).membership.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, managerId: true },
  });
  return rows.map((r) => ({ membershipId: r.id, managerId: r.managerId }));
});

/** Everyone below this membership, transitively. Request-cached. */
export const getSubordinateIds = cache(
  async (schoolId: string, membershipId: string): Promise<Set<string>> =>
    resolveSubordinates(await loadReportingGraph(schoolId), membershipId),
);

/** The chain of command above this membership, nearest first. */
export const getManagerChain = cache(
  async (schoolId: string, membershipId: string): Promise<string[]> =>
    resolveManagerChain(await loadReportingGraph(schoolId), membershipId),
);

/** The immediate manager's membership id, for escalation. */
export async function getManagerId(
  schoolId: string,
  membershipId: string,
): Promise<string | null> {
  const chain = await getManagerChain(schoolId, membershipId);
  return chain[0] ?? null;
}

export interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  role: string;
  title: string | null;
  orgUnitName: string | null;
  /** Instructor profile id, where the person has one. */
  instructorId: string | null;
  isDirectReport: boolean;
}

/**
 * The people below `membershipId`, with enough detail to render a team page.
 *
 * Returns [] rather than throwing for someone with no reports. "Nobody reports
 * to you" is an ordinary fact about most staff, not an error.
 */
export async function getTeam(
  schoolId: string,
  membershipId: string,
): Promise<TeamMember[]> {
  const subordinateIds = await getSubordinateIds(schoolId, membershipId);
  if (subordinateIds.size === 0) return [];

  const db = dbFor(schoolId);
  const rows = await db.membership.findMany({
    where: { id: { in: [...subordinateIds] } },
    include: { user: true, orgUnit: true },
    orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }],
  });

  // One query for the instructor profiles rather than one per member.
  const instructors = await db.instructor.findMany({
    where: { userId: { in: rows.map((r) => r.userId) } },
    select: { id: true, userId: true },
  });
  const instructorByUser = new Map(instructors.map((i) => [i.userId, i.id]));

  return rows.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: `${m.user.firstName} ${m.user.lastName}`,
    email: m.user.email,
    role: m.role,
    title: m.title,
    orgUnitName: m.orgUnit?.name ?? null,
    instructorId: instructorByUser.get(m.userId) ?? null,
    isDirectReport: m.managerId === membershipId,
  }));
}

/** The school's org-unit forest, ready to render. */
export async function getOrgTree(schoolId: string): Promise<OrgTreeNode[]> {
  const units = await dbFor(schoolId).orgUnit.findMany({
    select: { id: true, parentId: true, code: true, name: true, kind: true },
  });
  return buildOrgTree(units);
}
