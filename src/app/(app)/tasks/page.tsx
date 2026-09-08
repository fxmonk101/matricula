import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantContext } from '@/server/tenant-context';
import { listTasks, type TaskScope } from '@/server/tasks';
import { getSubordinateIds } from '@/server/services/org.service';
import { summariseTasks } from '@/lib/domain/tasks';
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { DueCell, KIND_LABEL, PriorityBadge, StatusBadge, formatRate } from '@/components/task-bits';
import { NewTaskButton } from './new-task';

export const metadata: Metadata = { title: 'Tasks' };

const SCOPES: { key: TaskScope; label: string; blurb: string }[] = [
  { key: 'mine', label: 'Assigned to me', blurb: 'Work you owe someone.' },
  { key: 'raised', label: 'Raised by me', blurb: 'Work you are waiting on.' },
  { key: 'team', label: 'My team', blurb: 'Everyone below you in the reporting line.' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; closed?: string }>;
}) {
  const { schoolId, membershipId } = await requireTenantContext();
  const { scope: rawScope, closed } = await searchParams;

  const scope: TaskScope =
    rawScope === 'raised' || rawScope === 'team' ? rawScope : 'mine';
  const includeClosed = closed === '1';

  const [tasks, subordinates] = await Promise.all([
    listTasks({ scope, includeClosed }),
    getSubordinateIds(schoolId, membershipId),
  ]);

  const now = new Date();
  const stats = summariseTasks(tasks, now);
  const current = SCOPES.find((s) => s.key === scope) as (typeof SCOPES)[number];

  return (
    <>
      <PageHeader
        title="Tasks"
        description={current.blurb}
        actions={<NewTaskButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Showing" value={stats.total} sublabel={includeClosed ? 'Including closed' : 'Open work only'} />
        <StatTile
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue > 0 ? 'danger' : 'success'}
          sublabel={stats.overdue > 0 ? 'Past the deadline and still open' : 'Nothing past its deadline'}
        />
        <StatTile
          label="Awaiting review"
          value={stats.submitted}
          tone={stats.submitted > 0 ? 'warning' : 'neutral'}
          sublabel="Submitted, not yet accepted"
        />
        <StatTile
          label="Delivered on time"
          value={formatRate(stats.onTimeRate)}
          tone="brand"
          sublabel={stats.onTimeRate === null ? 'Nothing completed with a deadline yet' : 'Of completed work that had a deadline'}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {SCOPES.map((s) => {
          const active = s.key === scope;
          const disabled = s.key === 'team' && subordinates.size === 0;
          if (disabled) {
            return (
              <span
                key={s.key}
                title="Nobody reports to you"
                className="cursor-not-allowed rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-300"
              >
                {s.label}
              </span>
            );
          }
          return (
            <Link
              key={s.key}
              href={`/tasks?scope=${s.key}${includeClosed ? '&closed=1' : ''}`}
              className={
                active
                  ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white'
                  : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
              }
            >
              {s.label}
            </Link>
          );
        })}
        <Link
          href={`/tasks?scope=${scope}${includeClosed ? '' : '&closed=1'}`}
          className="ml-auto text-xs font-medium text-brand-700 hover:underline"
        >
          {includeClosed ? 'Hide completed and cancelled' : 'Show completed and cancelled'}
        </Link>
      </div>

      <Card className="mt-3">
        <CardHeader
          title={current.label}
          description="Overdue work first, then by priority, then by deadline — the order in which it costs something to ignore."
        />
        {tasks.length === 0 ? (
          <EmptyState
            title={scope === 'team' ? 'Nothing outstanding across your team' : 'Nothing outstanding'}
            description={
              includeClosed
                ? 'No tasks in this view at all.'
                : 'Completed and cancelled work is hidden — use the link above to include it.'
            }
          />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Type</Th>
                {scope === 'mine' ? <Th>Raised by</Th> : <Th>Assigned to</Th>}
                <Th>Status</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {t.title}
                    </Link>
                    <div className="mt-0.5">
                      <PriorityBadge priority={t.priority} />
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-500">{KIND_LABEL[t.kind] ?? t.kind}</Td>
                  <Td className="text-xs">
                    {scope === 'mine' ? (t.assignerName ?? '—') : (t.assigneeName ?? 'Unassigned')}
                  </Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                  <Td>
                    <DueCell task={t} now={now} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
