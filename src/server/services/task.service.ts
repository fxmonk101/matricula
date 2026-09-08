/**
 * =============================================================================
 * TASK SERVICE
 * =============================================================================
 *
 * The pure decisions — legality of a transition, lateness, escalation,
 * visibility, workload — live in `@/lib/domain/tasks` and `@/lib/domain/org`.
 * This module reads a consistent snapshot, hands it to those functions, and
 * writes the result atomically.
 *
 * No `server-only` guard: the seed creates tasks, and a scheduled escalation
 * sweep will run outside a request.
 */

import { dbFor } from '@/lib/tenant';
import {
  assertTaskTransition,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/domain/enums';
import { nextEscalation } from '@/lib/domain/tasks';
import { getManagerId } from './org.service';
import { notify } from './notification.service';
import { recordAudit } from './audit.service';

export interface CreateTaskInput {
  schoolId: string;
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
  assigneeId: string | null;
  assignerId: string | null;
  orgUnitId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  dueAt?: Date | null;
  /** Membership ids to follow the task without owning it. */
  watcherIds?: readonly string[];
  /** User id for the audit trail. Null for a system-initiated run. */
  actorUserId: string | null;
}

/**
 * Raise a task.
 *
 * The task row, its CREATED event and its watchers are written in ONE
 * transaction. A task whose history does not begin with its own creation is a
 * task nobody can reconstruct later, and the history is the artefact that gets
 * consulted when a deadline is disputed.
 *
 * The notification is fired AFTER the transaction commits, deliberately: it is
 * a courtesy about a fact, and it must not be able to roll the fact back.
 */
export async function createTask(input: CreateTaskInput) {
  const db = dbFor(input.schoolId);

  const task = await db.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        schoolId: input.schoolId,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind ?? 'GENERAL',
        priority: input.priority ?? 'NORMAL',
        status: 'OPEN',
        assigneeId: input.assigneeId,
        assignerId: input.assignerId,
        orgUnitId: input.orgUnitId ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        dueAt: input.dueAt ?? null,
      },
    });

    await tx.taskEvent.create({
      data: {
        schoolId: input.schoolId,
        taskId: created.id,
        kind: 'CREATED',
        actorId: input.assignerId,
        toValue: 'OPEN',
        summary: input.assigneeId
          ? `Task raised and assigned.`
          : `Task raised, unassigned.`,
      },
    });

    const watchers = [...new Set(input.watcherIds ?? [])].filter(
      (id) => id !== input.assigneeId && id !== input.assignerId,
    );
    if (watchers.length > 0) {
      await tx.taskWatcher.createMany({
        data: watchers.map((membershipId) => ({
          schoolId: input.schoolId,
          taskId: created.id,
          membershipId,
        })),
      });
    }

    return created;
  });

  if (input.assigneeId) {
    void notify({
      schoolId: input.schoolId,
      membershipIds: [input.assigneeId],
      kind: 'TASK_ASSIGNED',
      title: input.title,
      body: input.dueAt ? `Due ${input.dueAt.toDateString()}.` : 'No deadline set.',
      href: `/tasks/${task.id}`,
      subjectType: 'Task',
      subjectId: task.id,
      exceptMembershipId: input.assignerId,
    });
  }

  void recordAudit({
    schoolId: input.schoolId,
    actorId: input.actorUserId,
    action: 'task.create',
    entityType: 'Task',
    entityId: task.id,
    summary: `Task raised: ${input.title}`,
  });

  return task;
}

export interface TransitionResult {
  ok: boolean;
  message: string;
}

/**
 * Move a task through its state machine.
 *
 * The legality check is the pure `assertTaskTransition`; this function's job is
 * the side effects that accompany a legal move — the timestamps, the event, the
 * notification back to whoever is waiting on the work.
 *
 * Timestamps are set on FIRST entry to a state and never cleared on re-entry.
 * `startedAt` is when the work was first picked up; a task that goes back to
 * IN_PROGRESS after a rejection has not started again, and overwriting it would
 * make turnaround statistics measure the last attempt rather than the elapsed
 * wait.
 */
export async function transitionTask(params: {
  schoolId: string;
  taskId: string;
  to: TaskStatus;
  /** Membership performing the move. */
  actorMembershipId: string;
  actorUserId: string | null;
  note?: string | null;
}): Promise<TransitionResult> {
  const db = dbFor(params.schoolId);

  const task = await db.task.findUnique({
    where: { id: params.taskId },
    include: { watchers: { select: { membershipId: true } } },
  });
  if (!task) return { ok: false, message: 'Task not found.' };

  const from = task.status as TaskStatus;
  if (from === params.to) return { ok: true, message: 'Already in that state.' };

  try {
    assertTaskTransition(from, params.to);
  } catch {
    return {
      ok: false,
      message: `A task that is ${from.toLowerCase().replace('_', ' ')} cannot move straight to ${params.to.toLowerCase().replace('_', ' ')}.`,
    };
  }

  const now = new Date();
  const stamps: Record<string, Date | null> = {};
  if (params.to === 'IN_PROGRESS' && task.startedAt === null) stamps.startedAt = now;
  if (params.to === 'SUBMITTED') stamps.submittedAt = now;
  if (params.to === 'COMPLETED') stamps.completedAt = now;
  // Reopening genuinely un-completes the task: leaving completedAt set would
  // make it count as finished in every statistic while sitting in the queue.
  if (from === 'COMPLETED' && params.to !== 'COMPLETED') stamps.completedAt = null;

  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: params.taskId },
      data: { status: params.to, ...stamps },
    });
    await tx.taskEvent.create({
      data: {
        schoolId: params.schoolId,
        taskId: params.taskId,
        kind: 'STATUS_CHANGED',
        actorId: params.actorMembershipId,
        fromValue: from,
        toValue: params.to,
        summary: params.note ?? `Status changed from ${from} to ${params.to}.`,
      },
    });
  });

  // Tell the person who is waiting. On submission that is the assigner; on
  // acceptance it is the assignee, plus anyone watching.
  const audience =
    params.to === 'SUBMITTED'
      ? [task.assignerId]
      : params.to === 'COMPLETED'
        ? [task.assigneeId, ...task.watchers.map((w) => w.membershipId)]
        : [];

  const recipients = audience.filter((id): id is string => id !== null);
  if (recipients.length > 0) {
    void notify({
      schoolId: params.schoolId,
      membershipIds: recipients,
      kind: params.to === 'COMPLETED' ? 'TASK_COMPLETED' : 'TASK_ASSIGNED',
      title:
        params.to === 'SUBMITTED'
          ? `Submitted for your review: ${task.title}`
          : `Accepted: ${task.title}`,
      href: `/tasks/${params.taskId}`,
      subjectType: 'Task',
      subjectId: params.taskId,
      exceptMembershipId: params.actorMembershipId,
    });
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'task.transition',
    entityType: 'Task',
    entityId: params.taskId,
    summary: `${task.title}: ${from} → ${params.to}`,
  });

  return { ok: true, message: `Moved to ${params.to.toLowerCase().replace('_', ' ')}.` };
}

/** Reassign a task, recording who moved it and from whom. */
export async function reassignTask(params: {
  schoolId: string;
  taskId: string;
  toMembershipId: string;
  actorMembershipId: string;
  actorUserId: string | null;
}): Promise<TransitionResult> {
  const db = dbFor(params.schoolId);

  const task = await db.task.findUnique({ where: { id: params.taskId } });
  if (!task) return { ok: false, message: 'Task not found.' };
  if (task.assigneeId === params.toMembershipId) {
    return { ok: true, message: 'Already assigned to that person.' };
  }
  if (task.status === 'CANCELLED') {
    return { ok: false, message: 'A cancelled task cannot be reassigned. Raise a new one.' };
  }

  const target = await db.membership.findUnique({
    where: { id: params.toMembershipId },
    include: { user: true },
  });
  // The tenant client scopes this lookup, so a membership from another school
  // simply does not resolve — which is the correct refusal, not an error to
  // explain.
  if (!target) return { ok: false, message: 'That person is not a member of this school.' };

  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: params.taskId },
      // A reassigned task has not been escalated to the NEW assignee's manager,
      // so the suppression flag is cleared along with the assignment.
      data: { assigneeId: params.toMembershipId, escalatedAt: null },
    });
    await tx.taskEvent.create({
      data: {
        schoolId: params.schoolId,
        taskId: params.taskId,
        kind: 'REASSIGNED',
        actorId: params.actorMembershipId,
        fromValue: task.assigneeId,
        toValue: params.toMembershipId,
        summary: `Reassigned to ${target.user.firstName} ${target.user.lastName}.`,
      },
    });
  });

  void notify({
    schoolId: params.schoolId,
    membershipIds: [params.toMembershipId],
    kind: 'TASK_ASSIGNED',
    title: task.title,
    body: 'This task has been assigned to you.',
    href: `/tasks/${params.taskId}`,
    subjectType: 'Task',
    subjectId: params.taskId,
    exceptMembershipId: params.actorMembershipId,
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'task.reassign',
    entityType: 'Task',
    entityId: params.taskId,
    summary: `${task.title} reassigned to ${target.user.email}.`,
  });

  return { ok: true, message: `Reassigned to ${target.user.firstName} ${target.user.lastName}.` };
}

export async function commentOnTask(params: {
  schoolId: string;
  taskId: string;
  authorMembershipId: string;
  body: string;
}): Promise<TransitionResult> {
  const db = dbFor(params.schoolId);
  const body = params.body.trim();
  if (body.length === 0) return { ok: false, message: 'A comment cannot be empty.' };

  const task = await db.task.findUnique({
    where: { id: params.taskId },
    include: { watchers: { select: { membershipId: true } } },
  });
  if (!task) return { ok: false, message: 'Task not found.' };

  await db.$transaction(async (tx) => {
    await tx.taskComment.create({
      data: {
        schoolId: params.schoolId,
        taskId: params.taskId,
        authorId: params.authorMembershipId,
        body,
      },
    });
    await tx.taskEvent.create({
      data: {
        schoolId: params.schoolId,
        taskId: params.taskId,
        kind: 'COMMENTED',
        actorId: params.authorMembershipId,
        summary: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      },
    });
  });

  void notify({
    schoolId: params.schoolId,
    membershipIds: [
      task.assigneeId,
      task.assignerId,
      ...task.watchers.map((w) => w.membershipId),
    ].filter((id): id is string => id !== null),
    kind: 'TASK_COMMENTED',
    title: `New comment: ${task.title}`,
    body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
    href: `/tasks/${params.taskId}`,
    subjectType: 'Task',
    subjectId: params.taskId,
    exceptMembershipId: params.authorMembershipId,
  });

  return { ok: true, message: 'Comment added.' };
}

// -----------------------------------------------------------------------------
// Escalation sweep
// -----------------------------------------------------------------------------

export interface SweepResult {
  examined: number;
  escalated: number;
  reminded: number;
}

/**
 * Walk a school's open tasks and fire reminders and escalations.
 *
 * Designed to run on a schedule and to be SAFE TO RUN REPEATEDLY: `escalatedAt`
 * is set at the moment of escalation and consulted by `nextEscalation`, so a
 * sweep every hour escalates each task exactly once. Reminders are allowed to
 * repeat — a nudge two days before a deadline is useful more than once, whereas
 * a manager told daily about the same slipped task stops reading.
 */
export async function runEscalationSweep(
  schoolId: string,
  now = new Date(),
): Promise<SweepResult> {
  const db = dbFor(schoolId);

  const open = await db.task.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      dueAt: { not: null },
    },
    select: {
      id: true, title: true, status: true, priority: true,
      dueAt: true, completedAt: true, escalatedAt: true, assigneeId: true,
    },
  });

  let escalated = 0;
  let reminded = 0;

  for (const task of open) {
    const action = nextEscalation(
      {
        status: task.status as TaskStatus,
        priority: task.priority as TaskPriority,
        dueAt: task.dueAt,
        completedAt: task.completedAt,
        alreadyEscalated: task.escalatedAt !== null,
      },
      now,
    );

    if (action === 'NONE' || task.assigneeId === null) continue;

    if (action === 'REMIND') {
      await notify({
        schoolId,
        membershipIds: [task.assigneeId],
        kind: 'TASK_DUE_SOON',
        title: `Due soon: ${task.title}`,
        href: `/tasks/${task.id}`,
        subjectType: 'Task',
        subjectId: task.id,
      });
      reminded += 1;
      continue;
    }

    const managerId = await getManagerId(schoolId, task.assigneeId);

    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { escalatedAt: now } });
      await tx.taskEvent.create({
        data: {
          schoolId,
          taskId: task.id,
          kind: 'ESCALATED',
          actorId: null,
          summary: managerId
            ? 'Overdue past its grace period; the assignee’s manager was notified.'
            : 'Overdue past its grace period; no manager is on record to notify.',
        },
      });
    });

    // The assignee is always told. The manager is told only if there is one —
    // a dean with nobody above them still needs to know their own work slipped.
    await notify({
      schoolId,
      membershipIds: [task.assigneeId, ...(managerId ? [managerId] : [])],
      kind: 'TASK_ESCALATED',
      title: `Overdue: ${task.title}`,
      href: `/tasks/${task.id}`,
      subjectType: 'Task',
      subjectId: task.id,
    });
    escalated += 1;
  }

  return { examined: open.length, escalated, reminded };
}
