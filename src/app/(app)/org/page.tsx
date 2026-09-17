import type { Metadata } from 'next';

import { requireRoute } from '@/server/tenant-context';
import { getOrgTree, loadReportingGraph } from '@/server/services/org.service';
import { flattenOrgTree, resolveSubordinates } from '@/lib/domain/org';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Organisation' };

const KIND_LABEL: Record<string, string> = {
  FACULTY: 'Faculty',
  DEPARTMENT: 'Department',
  ADMIN_UNIT: 'Administrative unit',
  SCHOOL_SECTION: 'School section',
  TEAM: 'Team',
};

export default async function OrgPage() {
  const { db, schoolId, school, membershipId } = await requireRoute('/org');

  const [tree, graph, memberships] = await Promise.all([
    getOrgTree(schoolId),
    loadReportingGraph(schoolId),
    db.membership.findMany({
      where: { status: 'ACTIVE' },
      include: { user: true, orgUnit: true, _count: { select: { reports: true } } },
      orderBy: [{ user: { lastName: 'asc' } }],
    }),
  ]);

  const flat = flattenOrgTree(tree);
  const byId = new Map(memberships.map((m) => [m.id, m]));
  const unitHeadCount = new Map<string, number>();
  for (const m of memberships) {
    if (m.orgUnitId) unitHeadCount.set(m.orgUnitId, (unitHeadCount.get(m.orgUnitId) ?? 0) + 1);
  }

  // A cycle in the reporting line is a data-entry mistake, not a crash. It is
  // surfaced here because this is the page where somebody can fix it.
  const cyclic = memberships.filter((m) =>
    m.managerId ? resolveSubordinates(graph, m.id).has(m.managerId) : false,
  );

  const unmanaged = memberships.filter(
    (m) => m.managerId === null && !['STUDENT', 'APPLICANT', 'GUARDIAN'].includes(m.role),
  );

  const nameOf = (id: string | null) => {
    if (!id) return '—';
    const m = byId.get(id);
    return m ? `${m.user.firstName} ${m.user.lastName}` : 'Unknown';
  };

  return (
    <>
      <PageHeader
        title="Organisation"
        description={`${school.name}'s units and reporting lines.`}
      />

      {cyclic.length > 0 ? (
        <div className="mb-4">
          <Alert tone="danger" title="A reporting line loops back on itself">
            {cyclic.map((m) => `${m.user.firstName} ${m.user.lastName}`).join(', ')} report,
            indirectly, to someone who reports to them. Traversals terminate safely, but &ldquo;my
            team&rdquo; will not mean what you expect until this is corrected.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Units" value={flat.length} sublabel="Faculties, departments and teams" />
        <StatTile
          label="Staff"
          value={memberships.filter((m) => !['STUDENT', 'APPLICANT', 'GUARDIAN'].includes(m.role)).length}
          sublabel="Active memberships"
        />
        <StatTile
          label="Managers"
          value={memberships.filter((m) => m._count.reports > 0).length}
          sublabel="With at least one direct report"
        />
        <StatTile
          label="No manager"
          value={unmanaged.length}
          tone={unmanaged.length > 3 ? 'warning' : 'neutral'}
          sublabel="Top of a line, or not yet placed"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Units"
            description="A forest, not a tree — a school legitimately has several roots, and an orphaned unit is promoted rather than hidden."
          />
          {flat.length === 0 ? (
            <EmptyState title="No org units yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {flat.map((node) => (
                <li
                  key={node.id}
                  className="flex items-center gap-3 px-5 py-2.5"
                  style={{ paddingLeft: `${20 + node.depth * 20}px` }}
                >
                  <span className="font-mono text-[11px] text-slate-400">{node.code}</span>
                  <span className="text-sm text-slate-900">{node.name}</span>
                  <Badge tone={node.depth === 0 ? 'brand' : 'neutral'} className="ml-auto">
                    {KIND_LABEL[node.kind] ?? node.kind}
                  </Badge>
                  <span className="w-16 text-right text-[11px] text-slate-500">
                    {unitHeadCount.get(node.id) ?? 0} staff
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Reporting lines"
            description="Who answers to whom. This is what scopes 'my team' and where an overdue task escalates to."
          />
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Reports to</Th>
                <Th className="text-right">Direct reports</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {memberships
                .filter((m) => !['STUDENT', 'APPLICANT', 'GUARDIAN'].includes(m.role))
                .map((m) => (
                  <tr key={m.id} className={m.id === membershipId ? 'bg-brand-50/40' : undefined}>
                    <Td>
                      <div className="text-sm font-medium text-slate-900">
                        {m.user.firstName} {m.user.lastName}
                        {m.id === membershipId ? (
                          <span className="ml-1.5 text-[11px] font-normal text-brand-700">you</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {m.title ?? m.role}
                        {m.orgUnit ? ` · ${m.orgUnit.name}` : ''}
                      </div>
                    </Td>
                    <Td className="text-xs text-slate-600">{nameOf(m.managerId)}</Td>
                    <Td className="text-right tabular-nums text-xs">
                      {m._count.reports > 0 ? m._count.reports : '—'}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
