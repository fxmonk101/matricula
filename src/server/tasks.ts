import 'server-only';

import { notFound } from 'next/navigation';

import { requireTenantContext } from '@/server/tenant-context';
import { getSubordinateIds } from '@/server/services/org.service';
import { can } from '@/lib/auth/rbac';
import {
  canAcceptTask,
  canEditTask,
  canViewTask,
  compareTasks,
  type TaskStat,
} from '@/lib/domain/tasks';
import type { TaskPriority, TaskStatus } from '@/lib/domain/enums';

/**
 * =============================================================================
 * TASK READS, WITH RECORD-LEVEL AUTHORISATION
 * =============================================================================
 *
 * The two-layer pattern the registration actions already use:
 *
 *   the ROUTE is guarded by role      — "may this person use tasks at all"
 *   the RECORD is guarded by relation — "may they see THIS one"
 *
 * The second guard cannot live in `rbac.ts`, because "a dean may see a
 * lecturer's task" is a fact about the reporting line, not about the role. It
 * lives in the pure `canViewTask`; this module supplies the reporting line it
 * needs and enforces the answer.
 */

export type TaskScope = 'mine' | 'raised' | 'team';

export interface TaskListItem extends TaskStat {
  id: string;
  title: string;
  kind: string;
  assigneeName: string | null;
  assigneeMembershipId: string | null;
  assignerName: string | null;
  createdAt: Date;
}

/**
 * Tasks in one of three scopes.
 *
 * `team` resolves the subordinate set from the reporting graph, so a lecturer
 * asking for it gets an empty list rather than an error — having no reports is
 * ordinary, not forbidden.
 */
export async function listTasks(options: {
  scope: TaskScope;
  status?: TaskStatus[];
  includeClosed?: boolean;
}): Promise<TaskListItem[]> {
  const { db, schoolId, membershipId } = await requireTenantContext();

  let where: Record<string, unknown>;
  if (options.scope === 'mine') {
    where = { assigneeId: membershipId };
  } else if (options.scope === 'raised') {
    where = { assignerId: membershipId };
  } else {
    const subordinates = await getSubordinateIds(schoolId, membershipId);
    if (subordinates.size === 0) return [];
    where = { assigneeId: { in: [...subordinates] } };
  }

  if (options.status) {
    where.status = { in: options.status };
  } else if (!options.includeClosed) {
    where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
  }

  const rows = await db.task.findMany({
    where,
    include: {
      assignee: { include: { user: { select: { firstName: true, lastName: true } } } },
      assigner: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  const now = new Date();
  return rows
    .map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      status: t.status as TaskStatus,
      priority: t.priority as TaskPriority,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      assigneeMembershipId: t.assigneeId,
      assigneeName: t.assignee
        ? `${t.assignee.user.firstName} ${t.assignee.user.lastName}`
        : null,
      assignerName: t.assigner
        ? `${t.assigner.user.firstName} ${t.assigner.user.lastName}`
        : null,
    }))
    // Ordered in the application, not the database: "overdue first" is a
    // function of the current time against a nullable column, which SQL can
    // express only awkwardly and which the pure comparator already gets right.
    .sort((a, b) => compareTasks(a, b, now));
}

/**
 * One task, with its history — or a 404 when this person may not see it.
 *
 * 404 rather than 403 on purpose, as with the guardian routes: the response
 * should not confirm that a task exists to someone with no business knowing it.
 */
export async function getTaskForViewer(taskId: string) {
  const { db, schoolId, membershipId, role } = await requireTenantContext();

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { include: { user: true } },
      assigner: { include: { user: true } },
      orgUnit: true,
      watchers: { include: { membership: { include: { user: true } } } },
      comments: {
        include: { author: { include: { user: true } } },
        orderBy: { createdAt: 'asc' },
      },
      events: {
        include: { actor: { include: { user: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!task) notFound();

  const subordinateMembershipIds = await getSubordinateIds(schoolId, membershipId);
  const visibility = {
    viewerMembershipId: membershipId,
    subordinateMembershipIds,
    hasBlanketGrant: can(role, 'task:admin'),
    task: {
      assigneeMembershipId: task.assigneeId,
      assignerMembershipId: task.assignerId,
      watcherMembershipIds: task.watchers.map((w) => w.membershipId),
    },
  };

  if (!canViewTask(visibility)) notFound();

  return {
    task,
    permissions: {
      canEdit: canEditTask(visibility),
      canAccept: canAcceptTask(visibility),
    },
  };
}

/** Throwing guard for server actions that mutate a task. */
export async function requireTaskEditor(taskId: string) {
  const result = await getTaskForViewer(taskId);
  if (!result.permissions.canEdit) notFound();
  return result;
}
