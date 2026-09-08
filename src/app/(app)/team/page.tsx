import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { getTeam } from '@/server/services/org.service';
import { getTeachingWorkload } from '@/server/services/teaching.service';
import {
  averageTurnaroundDays,
  loadImbalance,
  summariseTasks,
  viewWorkload,
  type TaskStat,
} from '@/lib/domain/tasks';
import type { TaskPriority, TaskStatus } from '@/lib/domain/enums';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { DueCell, KIND_LABEL, PriorityBadge, StatusBadge, formatRate } from '@/components/task-bits';
import { AllocatePanel } from './allocate-panel';

export const metadata: Metadata = { title: 'My team' };

export default async function TeamPage() {
  const { db, schoolId, school, membershipId, role } = await requireTenantRole(
    'ADMIN',
    'REGISTRAR',
    'INSTRUCTOR',
  );

  const team = await getTeam(schoolId, membershipId);

  // Having no reports is an ordinary fact about most staff, not a permission
  // failure — so this is an explanation, not a 403.
  if (team.length === 0) {
    return (
      <>
        <PageHeader title="My team" />
        <Alert tone="info" title="Nobody reports to you yet">
          This page shows the work of everyone below you in {school.shortName}&rsquo;s reporting
          line. An administrator sets reporting lines under{' '}
          <Link href="/org" className="font-medium underline">
            Organisation
          </Link>
          .
        </Alert>
      </>
    );
  }

  const memberIds = team.map((m) => m.membershipId);
  const term = await db.term.findFirst({ where: { isCurrent: true } });

  const [tasks, workload] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: { in: memberIds } },
      select: {
        id: true, title: true, kind: true, status: true, priority: true,
        dueAt: true, completedAt: true, createdAt: true, assigneeId: true,
      },
    }),
    term ? getTeachingWorkload(schoolId, term.id) : Promise.resolve([]),
  ]);

  const now = new Date();
  const asStat = (t: (typeof tasks)[number]): TaskStat => ({
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
  });

  const overall = summariseTasks(tasks.map(asStat), now);
  const turnaround = averageTurnaroundDays(
    tasks.map((t) => ({ status: t.status as TaskStatus, createdAt: t.createdAt, completedAt: t.completedAt })),
  );

  // Workload is restricted to the team, then measured. Measuring the whole
  // faculty and calling it "my team's load" would be a different — and
  // misleading — number.
  const teamWorkload = workload.filter((w) => memberIds.includes(w.memberId));
  const imbalance = loadImbalance(teamWorkload);
  const workloadViews = viewWorkload(teamWorkload);
  const workloadByMember = new Map(workloadViews.map((w) => [w.memberId, w]));

  const perMember = team.map((m) => {
    const theirs = tasks.filter((t) => t.assigneeId === m.membershipId);
    return {
      member: m,
      stats: summariseTasks(theirs.map(asStat), now),
      load: workloadByMember.get(m.membershipId) ?? null,
    };
  });

  // Attention first: most overdue, then least on-time. A dashboard sorted
  // alphabetically makes the reader do the ranking the software should do.
  perMember.sort(
    (a, b) =>
      b.stats.overdue - a.stats.overdue ||
      (a.stats.onTimeRate ?? 1) - (b.stats.onTimeRate ?? 1),
  );

  const needsReview = tasks
    .filter((t) => t.status === 'SUBMITTED')
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  const overdue = tasks
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.dueAt !== null && t.dueAt < now)
    .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime());

  const nameOf = (id: string | null) =>
    team.find((m) => m.membershipId === id)?.name ?? 'Unassigned';

  return (
    <>
      <PageHeader
        title="My team"
        description={`${team.length} ${team.length === 1 ? 'person' : 'people'} in your reporting line${term ? ` · ${term.name}` : ''}.`}
        actions={
          role !== 'REGISTRAR' && term ? (
            <AllocatePanel termId={term.id} />
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Overdue"
          value={overall.overdue}
          tone={overall.overdue > 0 ? 'danger' : 'success'}
          sublabel={overall.overdue > 0 ? 'Across the whole team' : 'Nothing past its deadline'}
        />
        <StatTile
          label="Awaiting your review"
          value={needsReview.length}
          tone={needsReview.length > 0 ? 'warning' : 'neutral'}
          sublabel="Submitted, not yet accepted"
        />
        <StatTile
          label="Delivered on time"
          value={formatRate(overall.onTimeRate)}
          tone="brand"
          sublabel={
            overall.onTimeRate === null
              ? 'Nothing completed with a deadline yet'
              : `${overall.completed} completed of ${overall.total - overall.cancelled} owed`
          }
        />
        <StatTile
          label="Average turnaround"
          value={turnaround === null ? '—' : `${turnaround}d`}
          sublabel="Raised to accepted, over completed work"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="People"
            description="Ordered by what needs attention — most overdue first, then lowest on-time delivery."
          />
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Open</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">On time</Th>
                <Th className="w-36">Teaching load</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {perMember.map(({ member, stats, load }) => (
                <tr key={member.membershipId}>
                  <Td>
                    <div className="font-medium text-slate-900">{member.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {member.title ?? member.role}
                      {member.orgUnitName ? ` · ${member.orgUnitName}` : ''}
                      {member.isDirectReport ? '' : ' · indirect'}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-sm">
                    {stats.open + stats.inProgress + stats.blocked + stats.submitted}
                  </Td>
                  <Td className="text-right">
                    {stats.overdue > 0 ? (
                      <Badge tone="danger">{stats.overdue}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums text-sm">
                    {formatRate(stats.onTimeRate)}
                  </Td>
                  <Td>
                    {load ? (
                      <>
                        <div className="flex items-baseline justify-between text-[11px] text-slate-500">
                          <span>
                            {load.assignedUnits}/{load.capacityUnits} cr
                          </span>
                          <span className="tabular-nums">{Math.round(load.utilisation * 100)}%</span>
                        </div>
                        <div className="mt-1">
                          <Meter
                            value={load.utilisation * 100}
                            tone={load.isOverloaded ? 'danger' : load.utilisation > 0.85 ? 'warning' : 'brand'}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Not teaching</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {teamWorkload.length > 1 ? (
            <div className="border-t border-slate-200 px-5 py-3">
              <p className="text-xs text-slate-600">
                Mean utilisation {Math.round(imbalance.mean * 100)}%, spread{' '}
                <span
                  className={
                    imbalance.spread > 0.4 ? 'font-semibold text-amber-700' : 'text-slate-600'
                  }
                >
                  {Math.round(imbalance.spread * 100)} points
                </span>
                {imbalance.spread > 0.4 && imbalance.fullest && imbalance.emptiest ? (
                  <>
                    {' '}
                    — {imbalance.fullest.name} is carrying{' '}
                    {Math.round(imbalance.fullest.utilisation * 100)}% while{' '}
                    {imbalance.emptiest.name} is at{' '}
                    {Math.round(imbalance.emptiest.utilisation * 100)}%.
                  </>
                ) : (
                  '. The team is reasonably balanced.'
                )}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Utilisation is against each person&rsquo;s own ceiling, which varies by rank — a
                professor carries research and administration a lecturer does not.
              </p>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Awaiting your review"
              description="Submitted work only you can accept."
            />
            {needsReview.length === 0 ? (
              <EmptyState title="Nothing waiting on you" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {needsReview.slice(0, 8).map((t) => (
                  <li key={t.id} className="px-5 py-3">
                    <Link href={`/tasks/${t.id}`} className="text-xs font-medium text-slate-900 hover:text-brand-700">
                      {t.title}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {nameOf(t.assigneeId)} · {KIND_LABEL[t.kind] ?? t.kind}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Overdue"
              description="Still open, past the deadline."
            />
            {overdue.length === 0 ? (
              <EmptyState title="Nothing overdue" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {overdue.slice(0, 8).map((t) => (
                  <li key={t.id} className="px-5 py-3">
                    <Link href={`/tasks/${t.id}`} className="text-xs font-medium text-slate-900 hover:text-brand-700">
                      {t.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500">{nameOf(t.assigneeId)}</span>
                      <PriorityBadge priority={t.priority as TaskPriority} />
                      <DueCell task={asStat(t)} now={now} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="All team work"
          description="Everything assigned to anyone below you, including work you did not raise."
        />
        <Table className="table-hover">
          <thead>
            <tr>
              <Th>Task</Th>
              <Th>Person</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks
              .filter((t) => t.status !== 'CANCELLED')
              .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))
              .slice(0, 40)
              .map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/tasks/${t.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">
                      {t.title}
                    </Link>
                  </Td>
                  <Td className="text-xs">{nameOf(t.assigneeId)}</Td>
                  <Td className="text-xs text-slate-500">{KIND_LABEL[t.kind] ?? t.kind}</Td>
                  <Td>
                    <StatusBadge status={t.status as TaskStatus} />
                  </Td>
                  <Td>
                    <DueCell task={asStat(t)} now={now} />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
