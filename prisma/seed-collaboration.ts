/**
 * =============================================================================
 * SEED: ORG HIERARCHY, TASKS AND NOTIFICATIONS (Phase 3)
 * =============================================================================
 *
 * Focused on the two universities. The point of this data is not volume but
 * SHAPE: a dean's dashboard is only worth looking at if the underlying team is
 * unevenly loaded, some work is late, some was delivered late but is finished,
 * and one section has been reallocated. A seed where everything is green
 * proves nothing about the software.
 *
 * Tasks are created through the real services — `allocateSection` and
 * `createTask` — for the same reason the K-12 report cards are: a hand-written
 * seed row is free to disagree with what the application would have produced,
 * and then the first thing anyone sees is a lie.
 */

import type { PrismaClient } from '@prisma/client';

import { createTask, transitionTask } from '../src/server/services/task.service';
import { allocateSection } from '../src/server/services/teaching.service';

interface Ctx {
  db: PrismaClient;
  schoolId: string;
  day: (offset: number) => Date;
}

/** Membership id for an email, or null. */
async function membershipFor(ctx: Ctx, email: string): Promise<string | null> {
  const m = await ctx.db.membership.findFirst({
    where: { schoolId: ctx.schoolId, user: { email } },
    select: { id: true },
  });
  return m?.id ?? null;
}

/**
 * Wire the reporting line and attach staff to org units.
 *
 * Phase 0 created the org units but left every membership detached from them,
 * which made the org chart an empty shell. This is where the hierarchy becomes
 * real enough to compute against.
 */
export async function seedHierarchy(
  ctx: Ctx,
  spec: {
    /** email -> { manager email | null, org unit code | null, title } */
    lines: Record<string, { manager: string | null; unit: string | null; title?: string }>;
    /** org unit code -> email of its head */
    heads?: Record<string, string>;
  },
): Promise<void> {
  const units = await ctx.db.orgUnit.findMany({ where: { schoolId: ctx.schoolId } });
  const unitByCode = new Map(units.map((u) => [u.code, u.id]));

  // Two passes: every membership must exist with its unit set before any
  // manager pointer is written, or an edge can name a row that is still being
  // created.
  for (const [email, line] of Object.entries(spec.lines)) {
    const id = await membershipFor(ctx, email);
    if (!id) continue;
    await ctx.db.membership.update({
      where: { id },
      data: {
        orgUnitId: line.unit ? (unitByCode.get(line.unit) ?? null) : null,
        ...(line.title ? { title: line.title } : {}),
      },
    });
  }

  for (const [email, line] of Object.entries(spec.lines)) {
    const id = await membershipFor(ctx, email);
    if (!id) continue;
    const managerId = line.manager ? await membershipFor(ctx, line.manager) : null;
    await ctx.db.membership.update({ where: { id }, data: { managerId } });
  }

  for (const [code, email] of Object.entries(spec.heads ?? {})) {
    const unitId = unitByCode.get(code);
    const headId = await membershipFor(ctx, email);
    if (unitId && headId) {
      await ctx.db.orgUnit.update({ where: { id: unitId }, data: { headMembershipId: headId } });
    }
  }
}

/**
 * Allocate this term's sections through the real allocation service, so every
 * section carries the teaching and grade-submission tasks the app would have
 * raised.
 */
export async function seedAllocations(
  ctx: Ctx,
  spec: { deanEmail: string; termIds: string[] },
): Promise<{ allocated: number; skipped: number }> {
  const deanMembershipId = await membershipFor(ctx, spec.deanEmail);
  if (!deanMembershipId) return { allocated: 0, skipped: 0 };

  const dean = await ctx.db.membership.findUnique({
    where: { id: deanMembershipId },
    select: { userId: true },
  });

  const offerings = await ctx.db.courseOffering.findMany({
    where: {
      schoolId: ctx.schoolId,
      termId: { in: spec.termIds },
      instructorId: { not: null },
    },
    select: { id: true, instructorId: true },
  });

  let allocated = 0;
  let skipped = 0;

  for (const o of offerings) {
    // Deadlines are NOT forced here: `allocateSection` derives them from the
    // term's own start and end dates. Two terms are allocated, so the result is
    // a genuine mix rather than a manufactured one — last term's grade
    // deadlines have passed, this term's are still ahead.
    const result = await allocateSection({
      schoolId: ctx.schoolId,
      offeringId: o.id,
      instructorId: o.instructorId as string,
      assignerMembershipId: deanMembershipId,
      actorUserId: dean?.userId ?? null,
    });
    if (result.ok) allocated += 1;
    else skipped += 1;
  }

  return { allocated, skipped };
}

/**
 * Drive a realistic spread of task states.
 *
 * Deliberately uneven. The states are chosen so every branch of the domain
 * logic is visible on a dashboard: on-time delivery, late-but-delivered,
 * genuinely overdue, blocked, and awaiting the dean's acceptance.
 */
export async function seedTaskActivity(
  ctx: Ctx,
  spec: { deanEmail: string; staffEmails: string[] },
): Promise<{ moved: number }> {
  const deanId = await membershipFor(ctx, spec.deanEmail);
  if (!deanId) return { moved: 0 };
  const dean = await ctx.db.membership.findUnique({
    where: { id: deanId },
    select: { userId: true },
  });

  const tasks = await ctx.db.task.findMany({
    where: { schoolId: ctx.schoolId, status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, assigneeId: true, kind: true },
  });

  // A repeating pattern rather than randomness: a seed that differs between
  // runs makes a screenshot impossible to reproduce and a bug impossible to
  // pin down.
  const pattern: ('DONE' | 'SUBMITTED' | 'PROGRESS' | 'BLOCKED' | 'LEAVE')[] = [
    'DONE', 'SUBMITTED', 'PROGRESS', 'LEAVE', 'DONE', 'BLOCKED', 'PROGRESS', 'LEAVE',
  ];

  let moved = 0;
  for (const [index, task] of tasks.entries()) {
    if (!task.assigneeId) continue;
    const action = pattern[index % pattern.length];
    if (action === 'LEAVE') continue;

    const assigneeUser = await ctx.db.membership.findUnique({
      where: { id: task.assigneeId },
      select: { userId: true },
    });

    const step = async (to: 'IN_PROGRESS' | 'BLOCKED' | 'SUBMITTED' | 'COMPLETED', by: string, byUser: string | null) =>
      transitionTask({
        schoolId: ctx.schoolId,
        taskId: task.id,
        to,
        actorMembershipId: by,
        actorUserId: byUser,
      });

    await step('IN_PROGRESS', task.assigneeId, assigneeUser?.userId ?? null);
    if (action === 'PROGRESS') { moved += 1; continue; }
    if (action === 'BLOCKED') {
      await step('BLOCKED', task.assigneeId, assigneeUser?.userId ?? null);
      moved += 1;
      continue;
    }

    await step('SUBMITTED', task.assigneeId, assigneeUser?.userId ?? null);
    if (action === 'SUBMITTED') { moved += 1; continue; }

    // Only the assigner accepts — which is exactly what the domain rule says.
    await step('COMPLETED', deanId, dean?.userId ?? null);
    await backdate(ctx, task.id, index);
    moved += 1;
  }

  return { moved };
}

/**
 * Give a completed task a plausible history in time.
 *
 * Without this every seeded task is created and completed in the same instant,
 * which makes two of the dashboard's four figures meaningless: turnaround is
 * always 0 days, and every deadline in the past is missed, so the on-time rate
 * is always 0%. Both would be arithmetically correct and completely useless —
 * the seed would be demonstrating a bug that isn't there.
 *
 * The pattern alternates deliberately so BOTH branches of `assessLateness` are
 * visible: some work lands before its deadline, some after it.
 */
async function backdate(ctx: Ctx, taskId: string, index: number): Promise<void> {
  const task = await ctx.db.task.findUnique({
    where: { id: taskId },
    select: { dueAt: true },
  });
  if (!task?.dueAt) return;

  // Raised three weeks before it was due; delivered either two days early or
  // three days late, alternating.
  const createdAt = new Date(task.dueAt.getTime() - 21 * 86400000);
  const deliveredLate = index % 3 === 0;
  const completedAt = new Date(
    task.dueAt.getTime() + (deliveredLate ? 3 : -2) * 86400000,
  );

  await ctx.db.task.update({
    where: { id: taskId },
    data: { createdAt, startedAt: new Date(createdAt.getTime() + 86400000), submittedAt: completedAt, completedAt },
  });
}

/** A few tasks a dean types by hand, so GENERAL work is represented too. */
export async function seedAdHocTasks(
  ctx: Ctx,
  spec: {
    deanEmail: string;
    items: {
      to: string;
      title: string;
      description: string;
      priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      dueInDays: number;
    }[];
  },
): Promise<number> {
  const deanId = await membershipFor(ctx, spec.deanEmail);
  if (!deanId) return 0;
  const dean = await ctx.db.membership.findUnique({
    where: { id: deanId },
    select: { userId: true },
  });

  let created = 0;
  for (const item of spec.items) {
    const assigneeId = await membershipFor(ctx, item.to);
    if (!assigneeId) continue;
    await createTask({
      schoolId: ctx.schoolId,
      title: item.title,
      description: item.description,
      kind: 'GENERAL',
      priority: item.priority,
      assigneeId,
      assignerId: deanId,
      dueAt: ctx.day(item.dueInDays),
      actorUserId: dean?.userId ?? null,
    });
    created += 1;
  }
  return created;
}
