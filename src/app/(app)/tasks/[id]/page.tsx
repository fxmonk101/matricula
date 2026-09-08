import type { Metadata } from 'next';
import Link from 'next/link';

import { getTaskForViewer } from '@/server/tasks';
import { requireTenantContext } from '@/server/tenant-context';
import { assessLateness } from '@/lib/domain/tasks';
import { TASK_TRANSITIONS, type TaskStatus } from '@/lib/domain/enums';
import { formatDateTime } from '@/lib/utils';
import { Alert, Card, CardBody, CardHeader, DetailRow, PageHeader } from '@/components/ui';
import { DueCell, KIND_LABEL, PriorityBadge, StatusBadge } from '@/components/task-bits';
import { TaskActions } from './task-actions';
import { CommentForm } from './comment-form';

export const metadata: Metadata = { title: 'Task' };

const EVENT_ICON: Record<string, string> = {
  CREATED: '●',
  STATUS_CHANGED: '→',
  REASSIGNED: '⇄',
  DUE_DATE_CHANGED: '⏱',
  PRIORITY_CHANGED: '!',
  COMMENTED: '💬',
  ESCALATED: '▲',
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 404s rather than 403s when this person has no business seeing the task —
  // the response must not confirm that it exists.
  const { task, permissions } = await getTaskForViewer(id);
  const { membershipId } = await requireTenantContext();

  const now = new Date();
  const status = task.status as TaskStatus;
  const lateness = assessLateness(
    { status, dueAt: task.dueAt, completedAt: task.completedAt },
    now,
  );

  // What the state machine allows FROM here, narrowed by what this person may
  // do. Rendering a button that the action will refuse is a worse experience
  // than not rendering it.
  const available = TASK_TRANSITIONS[status].filter((to) =>
    to === 'COMPLETED' ? permissions.canAccept : permissions.canEdit,
  );

  return (
    <>
      <PageHeader
        title={task.title}
        description={`${KIND_LABEL[task.kind] ?? task.kind} · raised ${formatDateTime(task.createdAt)}`}
        actions={
          <Link href="/tasks" className="text-sm text-brand-700 hover:underline">
            ← All tasks
          </Link>
        }
      />

      {lateness.isOverdue ? (
        <div className="mb-4">
          <Alert tone="danger" title={`Overdue by ${lateness.daysLate} day${lateness.daysLate === 1 ? '' : 's'}`}>
            {task.escalatedAt
              ? `This was escalated to the assignee's manager on ${formatDateTime(task.escalatedAt)}.`
              : 'Not yet escalated — it is still within the grace period for its priority.'}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Detail" />
            <CardBody>
              {task.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {task.description}
                </p>
              ) : (
                <p className="text-sm italic text-slate-400">No further detail was given.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="History"
              description="Append-only. Who changed what, and when — the question that gets asked when a deadline is disputed."
            />
            <CardBody>
              <ol className="space-y-3">
                {task.events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] text-slate-600"
                      aria-hidden
                    >
                      {EVENT_ICON[e.kind] ?? '•'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700">{e.summary}</p>
                      <p className="text-[11px] text-slate-400">
                        {e.actor
                          ? `${e.actor.user.firstName} ${e.actor.user.lastName}`
                          : 'System'}{' '}
                        · {formatDateTime(e.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Comments (${task.comments.length})`} />
            <CardBody className="space-y-4">
              {task.comments.length === 0 ? (
                <p className="text-xs italic text-slate-400">No comments yet.</p>
              ) : (
                <ul className="space-y-3">
                  {task.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-medium text-slate-900">
                        {c.author.user.firstName} {c.author.user.lastName}
                        <span className="ml-2 font-normal text-slate-400">
                          {formatDateTime(c.createdAt)}
                        </span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                        {c.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <CommentForm taskId={task.id} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusBadge status={status} />
                <PriorityBadge priority={task.priority as never} />
              </div>
              <dl>
                <DetailRow label="Assigned to">
                  {task.assignee
                    ? `${task.assignee.user.firstName} ${task.assignee.user.lastName}`
                    : 'Unassigned'}
                </DetailRow>
                <DetailRow label="Raised by">
                  {task.assigner
                    ? `${task.assigner.user.firstName} ${task.assigner.user.lastName}`
                    : 'System'}
                </DetailRow>
                <DetailRow label="Due">
                  <DueCell
                    task={{ status, dueAt: task.dueAt, completedAt: task.completedAt }}
                    now={now}
                  />
                </DetailRow>
                {task.orgUnit ? <DetailRow label="Unit">{task.orgUnit.name}</DetailRow> : null}
                {task.startedAt ? (
                  <DetailRow label="Started">{formatDateTime(task.startedAt)}</DetailRow>
                ) : null}
                {task.completedAt ? (
                  <DetailRow label="Completed">{formatDateTime(task.completedAt)}</DetailRow>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <TaskActions
            taskId={task.id}
            available={available}
            canAccept={permissions.canAccept}
            isAssignee={task.assigneeId === membershipId}
            status={status}
          />

          {task.watchers.length > 0 ? (
            <Card>
              <CardHeader title="Watching" />
              <CardBody>
                <ul className="space-y-1 text-xs text-slate-600">
                  {task.watchers.map((w) => (
                    <li key={w.id}>
                      {w.membership.user.firstName} {w.membership.user.lastName}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
