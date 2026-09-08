'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantContext } from '@/server/tenant-context';
import { getTaskForViewer } from '@/server/tasks';
import { assertCan } from '@/lib/auth/rbac';
import { TASK_KINDS, TASK_PRIORITIES, type TaskStatus } from '@/lib/domain/enums';
import {
  commentOnTask,
  createTask,
  reassignTask,
  transitionTask,
} from '@/server/services/task.service';

export interface TaskFormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const createSchema = z.object({
  title: z.string().trim().min(3, 'Give the task a title of at least 3 characters.').max(160),
  description: z.string().trim().max(4000).optional(),
  assigneeId: z.string().min(1, 'Choose who the task is for.'),
  kind: z.enum(TASK_KINDS).default('GENERAL'),
  priority: z.enum(TASK_PRIORITIES).default('NORMAL'),
  dueAt: z.string().optional(),
});

export async function createTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { db, schoolId, session, role, membershipId } = await requireTenantContext();
  assertCan(role, 'task:create');

  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    assigneeId: formData.get('assigneeId'),
    kind: formData.get('kind') || undefined,
    priority: formData.get('priority') || undefined,
    dueAt: formData.get('dueAt') || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { ok: false, message: 'Check the highlighted fields.', fieldErrors };
  }

  // The assignee is verified against the TENANT-SCOPED client, so a membership
  // id from another school resolves to nothing. That is the whole check — no
  // separate "is this person in my school" comparison to forget.
  const assignee = await db.membership.findUnique({
    where: { id: parsed.data.assigneeId },
    include: { user: true },
  });
  if (!assignee) {
    return { ok: false, message: 'That person is not a member of this school.' };
  }

  // A date-only input is midnight local; the deadline is the END of that day.
  // Without this, a task due "today" is overdue from the moment it is created.
  const dueAt = parsed.data.dueAt ? endOfDay(parsed.data.dueAt) : null;
  if (parsed.data.dueAt && dueAt === null) {
    return { ok: false, message: 'That due date could not be read.', fieldErrors: { dueAt: 'Invalid date.' } };
  }

  const task = await createTask({
    schoolId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    kind: parsed.data.kind,
    priority: parsed.data.priority,
    assigneeId: parsed.data.assigneeId,
    assignerId: membershipId,
    dueAt,
    actorUserId: session.sub,
  });

  revalidatePath('/tasks');
  revalidatePath('/team');
  return {
    ok: true,
    message: `Task raised for ${assignee.user.firstName} ${assignee.user.lastName}.`,
    fieldErrors: { taskId: task.id },
  };
}

function endOfDay(value: string): Date | null {
  const d = new Date(`${value}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Move a task.
 *
 * Two guards, in order. `getTaskForViewer` 404s if this person may not see the
 * task at all; then the pure predicates decide whether they may act on it.
 * Accepting is checked separately from editing because only the person who
 * ASKED for the work may accept it — otherwise SUBMITTED is decorative.
 */
export async function transitionTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { schoolId, session, membershipId } = await requireTenantContext();

  const taskId = String(formData.get('taskId') ?? '');
  const to = String(formData.get('to') ?? '') as TaskStatus;

  const { permissions } = await getTaskForViewer(taskId);

  if (to === 'COMPLETED' && !permissions.canAccept) {
    return {
      ok: false,
      message: 'Only the person who raised this task can accept it as complete.',
    };
  }
  if (to !== 'COMPLETED' && !permissions.canEdit) {
    return { ok: false, message: 'You cannot change this task.' };
  }

  const result = await transitionTask({
    schoolId,
    taskId,
    to,
    actorMembershipId: membershipId,
    actorUserId: session.sub,
    note: String(formData.get('note') ?? '') || null,
  });

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/team');
  return result;
}

export async function commentAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { schoolId, membershipId } = await requireTenantContext();
  const taskId = String(formData.get('taskId') ?? '');

  // Visibility, not editability: someone watching a task may discuss it
  // without being able to change its state.
  await getTaskForViewer(taskId);

  const result = await commentOnTask({
    schoolId,
    taskId,
    authorMembershipId: membershipId,
    body: String(formData.get('body') ?? ''),
  });

  revalidatePath(`/tasks/${taskId}`);
  return result;
}

export async function reassignTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { schoolId, session, membershipId, role } = await requireTenantContext();
  assertCan(role, 'task:assign');

  const taskId = String(formData.get('taskId') ?? '');
  const toMembershipId = String(formData.get('toMembershipId') ?? '');
  if (!toMembershipId) return { ok: false, message: 'Choose who to reassign it to.' };

  const { permissions } = await getTaskForViewer(taskId);
  if (!permissions.canEdit) {
    return { ok: false, message: 'Only the assignee or the person who raised this can reassign it.' };
  }

  const result = await reassignTask({
    schoolId,
    taskId,
    toMembershipId,
    actorMembershipId: membershipId,
    actorUserId: session.sub,
  });

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/team');
  return result;
}
