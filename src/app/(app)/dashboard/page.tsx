import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { platformDb } from '@/lib/tenant';
import { getReceivablesPosition } from '@/server/services/finance.service';
import { formatDate, titleCase } from '@/lib/utils';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Overview' };

export default async function DashboardPage() {
  const { db, school, schoolId, money } = await requireRoute('/dashboard');

  const currentTerm = await db.term.findFirst({ where: { isCurrent: true } });

  // Independent aggregates run concurrently — six sequential round trips would
  // dominate the page's response time for no reason.
  const [
    studentCount,
    activeStudents,
    instructorCount,
    programCount,
    offeringCount,
    registrations,
    applicationsByStatus,
    standingBreakdown,
    receivables,
    fullSections,
    recentAudit,
  ] = await Promise.all([
    db.student.count(),
    db.student.count({ where: { status: 'ACTIVE' } }),
    db.instructor.count(),
    db.program.count({ where: { isActive: true } }),
    currentTerm ? db.courseOffering.count({ where: { termId: currentTerm.id } }) : 0,
    currentTerm
      ? db.enrollment.count({
          where: { status: 'REGISTERED', offering: { termId: currentTerm.id } },
        })
      : 0,
    db.application.groupBy({ by: ['status'], _count: { _all: true } }),
    db.student.groupBy({ by: ['academicStanding'], _count: { _all: true } }),
    getReceivablesPosition(schoolId),
    currentTerm
      ? db.courseOffering.findMany({
          where: { termId: currentTerm.id },
          include: { course: true, instructor: { include: { user: true } } },
          orderBy: { seatsTaken: 'desc' },
          take: 6,
        })
      : [],
    platformDb.auditLog.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { actor: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const pendingApplications = applicationsByStatus
    .filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.status))
    .reduce((s, a) => s + a._count._all, 0);

  return (
    <>
      <PageHeader
        title="Institution overview"
        description={
          currentTerm
            ? `${currentTerm.name} · ${currentTerm.academicYear} · registration closes ${formatDate(currentTerm.registrationClosesAt)}`
            : 'No active term has been set.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Students"
          value={studentCount.toLocaleString()}
          sublabel={`${activeStudents.toLocaleString()} in active standing`}
        />
        <StatTile
          label="Registrations this term"
          value={registrations.toLocaleString()}
          sublabel={`across ${offeringCount} sections`}
          tone="brand"
        />
        <StatTile
          label="Applications in review"
          value={pendingApplications.toLocaleString()}
          sublabel="awaiting a committee decision"
          tone={pendingApplications > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Outstanding fees"
          value={money.formatCompact(receivables.outstandingMinor)}
          sublabel={`${receivables.collectionRate.toFixed(1)}% collected`}
          tone={receivables.outstandingMinor > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Sections closest to capacity"
            description="Sections filling fastest this term — candidates for an additional section or a raised cap."
            actions={
              <Link href="/offerings" className="text-xs font-medium text-brand-700 hover:underline">
                All sections →
              </Link>
            }
          />
          {fullSections.length === 0 ? (
            <EmptyState
              title="No sections scheduled"
              description="Create course offerings for the current term to see capacity here."
            />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Section</Th>
                  <Th>Instructor</Th>
                  <Th className="text-right">Seats</Th>
                  <Th className="w-40">Fill</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fullSections.map((o) => {
                  const pct = o.capacity === 0 ? 0 : (o.seatsTaken / o.capacity) * 100;
                  return (
                    <tr key={o.id}>
                      <Td>
                        <span className="font-medium text-slate-900">
                          {o.course.code}-{o.section}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">{o.course.title}</span>
                      </Td>
                      <Td className="text-xs">
                        {o.instructor
                          ? `${o.instructor.user.firstName} ${o.instructor.user.lastName}`
                          : <span className="text-amber-600">Unassigned</span>}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {o.seatsTaken}/{o.capacity}
                      </Td>
                      <Td>
                        <Meter value={pct} tone={pct >= 95 ? 'danger' : pct >= 80 ? 'warning' : 'brand'} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Academic standing" description="Live distribution across all students." />
            <CardBody className="space-y-2.5">
              {standingBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500">No student records yet.</p>
              ) : (
                standingBreakdown
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((row) => {
                    const pct = studentCount === 0 ? 0 : (row._count._all / studentCount) * 100;
                    return (
                      <div key={row.academicStanding}>
                        <div className="flex items-baseline justify-between text-xs">
                          <Badge tone={toneForStatus(row.academicStanding)}>
                            {titleCase(row.academicStanding)}
                          </Badge>
                          <span className="tabular-nums text-slate-600">
                            {row._count._all} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter value={pct} tone={toneForStatus(row.academicStanding)} />
                        </div>
                      </div>
                    );
                  })
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Receivables ageing" />
            <CardBody>
              <dl className="space-y-1.5 text-xs">
                {(
                  [
                    ['Not yet due', receivables.ageing.current, 'text-slate-700'],
                    ['1–30 days', receivables.ageing.d1_30, 'text-amber-700'],
                    ['31–60 days', receivables.ageing.d31_60, 'text-amber-800'],
                    ['61–90 days', receivables.ageing.d61_90, 'text-rose-700'],
                    ['Over 90 days', receivables.ageing.d90_plus, 'text-rose-800'],
                  ] as const
                ).map(([label, value, tone]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className={`tabular-nums font-medium ${tone}`}>{money.format(value)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <dt className="font-medium text-slate-700">Total outstanding</dt>
                  <dd className="tabular-nums font-semibold text-slate-900">
                    {money.format(receivables.ageing.totalMinor)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="At a glance" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Academic programs', programCount],
                  ['Faculty members', instructorCount],
                  ['Sections this term', offeringCount],
                  ['Invoices raised', receivables.invoiceCount],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="tabular-nums font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent activity"
            description="Every state change is recorded against the officer who made it."
            actions={
              <Link href="/admin/audit" className="text-xs font-medium text-brand-700 hover:underline">
                Full log →
              </Link>
            }
          />
          {recentAudit.length === 0 ? (
            <EmptyState title="Nothing recorded yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentAudit.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 px-5 py-2.5 text-xs">
                  <code className="shrink-0 font-mono text-[11px] text-brand-700">{entry.action}</code>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{entry.summary}</span>
                  <span className="shrink-0 text-slate-400">
                    {entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'system'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
