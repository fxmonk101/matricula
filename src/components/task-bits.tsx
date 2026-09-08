/**
 * Shared task presentation. Server-renderable; no state.
 *
 * Centralised so that OVERDUE is the same red on the list, the detail page and
 * the team dashboard. A status that changes colour depending on which screen
 * you are looking at teaches people to distrust the colour.
 */

import { assessLateness, type TaskTiming } from '@/lib/domain/tasks';
import type { TaskPriority, TaskStatus } from '@/lib/domain/enums';
import { Badge, type BadgeTone } from '@/components/ui';

export const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  OPEN: 'neutral',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  SUBMITTED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  SUBMITTED: 'Awaiting review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = {
  URGENT: 'danger',
  HIGH: 'warning',
  NORMAL: 'neutral',
  LOW: 'neutral',
};

export const KIND_LABEL: Record<string, string> = {
  COURSE_ASSIGNMENT: 'Teaching',
  GRADE_SUBMISSION: 'Grades',
  DOCUMENT_REQUEST: 'Document',
  ONBOARDING: 'Onboarding',
  MODERATION: 'Moderation',
  ADMISSIONS_REVIEW: 'Admissions',
  GENERAL: 'General',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  // NORMAL is the default and carries no information, so it is not rendered.
  // A badge on every row is a badge nobody reads.
  if (priority === 'NORMAL') return null;
  return (
    <Badge tone={PRIORITY_TONE[priority]}>
      {priority.charAt(0) + priority.slice(1).toLowerCase()}
    </Badge>
  );
}

/**
 * The deadline cell.
 *
 * Says "3 days late" for open work and "delivered 2 days late" for closed
 * work — the two are different facts and a dashboard that renders them
 * identically sends someone to chase a task that is already done.
 */
export function DueCell({ task, now }: { task: TaskTiming; now: Date }) {
  if (task.dueAt === null) {
    return <span className="text-xs text-slate-400">No deadline</span>;
  }

  const l = assessLateness(task, now);
  const date = task.dueAt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });

  if (l.isOverdue) {
    return (
      <span className="text-xs font-medium text-rose-700">
        {date} · {l.daysLate} day{l.daysLate === 1 ? '' : 's'} late
      </span>
    );
  }
  if (l.wasLate) {
    return (
      <span className="text-xs text-amber-700">
        {date} · delivered {l.daysLate} day{l.daysLate === 1 ? '' : 's'} late
      </span>
    );
  }
  if (task.status === 'COMPLETED') {
    return <span className="text-xs text-emerald-700">{date} · on time</span>;
  }
  const soon = (l.daysRemaining ?? 99) <= 3;
  return (
    <span className={soon ? 'text-xs font-medium text-amber-700' : 'text-xs text-slate-500'}>
      {date}
      {l.daysRemaining !== null ? ` · in ${l.daysRemaining}d` : ''}
    </span>
  );
}

/** Formats a 0-1 rate, or an em dash when there is nothing to rate. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
