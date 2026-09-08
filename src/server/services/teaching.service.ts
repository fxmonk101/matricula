/**
 * =============================================================================
 * TEACHING ALLOCATION
 * =============================================================================
 *
 * Assigning a section to a lecturer is not a field update. It is a request for
 * work, and the system's job is to make the request visible on both sides: the
 * lecturer gets a task with a deadline, the dean gets something to monitor.
 * Setting `instructorId` and stopping there is how allocation becomes an email
 * thread nobody can audit.
 *
 * No `server-only` guard — the seed allocates sections.
 */

import { dbFor } from '@/lib/tenant';
import type { WorkloadEntry } from '@/lib/domain/tasks';
import { createTask } from './task.service';
import { recordAudit } from './audit.service';

export interface AllocationResult {
  ok: boolean;
  message: string;
  taskId?: string;
}

/**
 * Assign a section to an instructor, raising the tasks that follow from it.
 *
 * TWO tasks are created, not one, and the distinction matters:
 *
 *   COURSE_ASSIGNMENT — "teach this", due at the start of term
 *   GRADE_SUBMISSION  — "submit the gradesheet", due after teaching ends
 *
 * They have different deadlines, different completion criteria, and the dean
 * chases them at different points in the term. Collapsing them into one task
 * would mean the teaching task sits open for four months and tells nobody
 * anything, then becomes overdue for a reason that has nothing to do with
 * teaching.
 *
 * Reassigning a section supersedes the previous holder's open tasks rather than
 * deleting them: the record that the work was once asked of someone else is
 * part of what a dean needs when a section goes wrong.
 */
export async function allocateSection(params: {
  schoolId: string;
  offeringId: string;
  instructorId: string;
  /** Membership of the dean or head making the allocation. */
  assignerMembershipId: string;
  actorUserId: string | null;
  /** Deadline for the teaching task. Defaults to the term start. */
  teachBy?: Date | null;
  /** Deadline for the gradesheet. Defaults to two weeks after the term ends. */
  gradesBy?: Date | null;
}): Promise<AllocationResult> {
  const db = dbFor(params.schoolId);

  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    include: { course: true, term: true },
  });
  if (!offering) return { ok: false, message: 'Section not found.' };
  if (offering.status === 'CANCELLED') {
    return { ok: false, message: 'A cancelled section cannot be allocated.' };
  }

  const instructor = await db.instructor.findUnique({
    where: { id: params.instructorId },
    include: { user: true, department: true },
  });
  if (!instructor) return { ok: false, message: 'That instructor is not on staff at this school.' };

  const membership = await db.membership.findFirst({
    where: { userId: instructor.userId, status: 'ACTIVE' },
  });
  // A staff record with no active membership cannot be given a task — there is
  // no queue to put it in. Refuse rather than silently allocate without one.
  if (!membership) {
    return {
      ok: false,
      message: `${instructor.user.firstName} ${instructor.user.lastName} has no active account at this school, so the work cannot be assigned to them.`,
    };
  }

  const label = `${offering.course.code}-${offering.section}`;
  const previousInstructorId = offering.instructorId;

  await db.$transaction(async (tx) => {
    await tx.courseOffering.update({
      where: { id: params.offeringId },
      data: { instructorId: params.instructorId },
    });

    // Supersede, do not delete. The previous holder's open tasks are cancelled
    // so they leave that person's queue, but the history stays readable.
    if (previousInstructorId && previousInstructorId !== params.instructorId) {
      const previous = await tx.instructor.findUnique({
        where: { id: previousInstructorId },
        select: { userId: true },
      });
      const previousMembership = previous
        ? await tx.membership.findFirst({ where: { userId: previous.userId } })
        : null;

      if (previousMembership) {
        const stale = await tx.task.findMany({
          where: {
            assigneeId: previousMembership.id,
            subjectType: 'CourseOffering',
            subjectId: params.offeringId,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          select: { id: true },
        });
        for (const t of stale) {
          await tx.task.update({ where: { id: t.id }, data: { status: 'CANCELLED' } });
          await tx.taskEvent.create({
            data: {
              schoolId: params.schoolId,
              taskId: t.id,
              kind: 'STATUS_CHANGED',
              actorId: params.assignerMembershipId,
              toValue: 'CANCELLED',
              summary: `Superseded — ${label} was reallocated to another member of staff.`,
            },
          });
        }
      }
    }
  });

  const teachTask = await createTask({
    schoolId: params.schoolId,
    title: `Teach ${label} — ${offering.course.title}`,
    description: `${offering.course.creditHours} credit hours, ${offering.term.name} ${offering.term.academicYear}. Capacity ${offering.capacity}.`,
    kind: 'COURSE_ASSIGNMENT',
    priority: 'HIGH',
    assigneeId: membership.id,
    assignerId: params.assignerMembershipId,
    subjectType: 'CourseOffering',
    subjectId: params.offeringId,
    dueAt: params.teachBy ?? offering.term.startDate,
    actorUserId: params.actorUserId,
  });

  await createTask({
    schoolId: params.schoolId,
    title: `Submit grades for ${label}`,
    description: `Gradesheet for ${offering.course.title}, ${offering.term.name}. Post only when every registered student has been assessed.`,
    kind: 'GRADE_SUBMISSION',
    priority: 'NORMAL',
    assigneeId: membership.id,
    assignerId: params.assignerMembershipId,
    subjectType: 'CourseOffering',
    subjectId: params.offeringId,
    dueAt: params.gradesBy ?? addDays(offering.term.endDate, 14),
    actorUserId: params.actorUserId,
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'teaching.allocate',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `${label} allocated to ${instructor.user.email}${previousInstructorId ? ' (reallocated)' : ''}.`,
  });

  return {
    ok: true,
    message: `${label} allocated to ${instructor.user.firstName} ${instructor.user.lastName}. Two tasks raised: teaching and grade submission.`,
    taskId: teachTask.id,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Teaching load per instructor for a term, in credit hours.
 *
 * Capacity comes from academic rank rather than being uniform, because it is
 * not uniform in any real department: a professor carries research and
 * administration a lecturer does not, and giving both an 18-hour ceiling would
 * make the fairness calculation propose exactly the wrong person.
 *
 * These defaults are a starting point, not a policy — a school that wants its
 * own numbers should lift them into `SchoolConfig`, which is the same move
 * Phase 1 made for grading.
 */
export const RANK_TEACHING_CAPACITY: Record<string, number> = {
  PROFESSOR: 9,
  ASSOCIATE_PROFESSOR: 12,
  SENIOR_LECTURER: 15,
  LECTURER: 18,
  ASSISTANT_LECTURER: 18,
};

export async function getTeachingWorkload(
  schoolId: string,
  termId: string,
): Promise<(WorkloadEntry & { instructorId: string; rank: string })[]> {
  const db = dbFor(schoolId);

  const instructors = await db.instructor.findMany({
    include: {
      user: true,
      offerings: {
        where: { termId, status: { not: 'CANCELLED' } },
        include: { course: { select: { creditHours: true } } },
      },
    },
  });

  const memberships = await db.membership.findMany({
    where: { userId: { in: instructors.map((i) => i.userId) } },
    select: { id: true, userId: true },
  });
  const membershipByUser = new Map(memberships.map((m) => [m.userId, m.id]));

  return instructors.map((i) => ({
    memberId: membershipByUser.get(i.userId) ?? i.id,
    instructorId: i.id,
    rank: i.rank,
    name: `${i.user.firstName} ${i.user.lastName}`,
    assignedUnits: i.offerings.reduce((s, o) => s + o.course.creditHours, 0),
    assignedItems: i.offerings.length,
    capacityUnits: RANK_TEACHING_CAPACITY[i.rank] ?? 18,
  }));
}
