import 'server-only';

import {
  isReleased,
  isResultStage,
  mayApprove,
  mayReturn,
  maySubmit,
  nextStage,
  readyToSubmit,
  type ResultStage,
  type ResultWorkflowPolicy,
} from '@/lib/domain/result-workflow';
import type { Role } from '@/lib/domain/enums';
import { dbFor } from '@/lib/tenant';
import { recomputeStudentAcademics } from '@/server/academics';
import { recordAudit } from '@/server/services/audit.service';
import { notify } from '@/server/services/notification.service';

/**
 * =============================================================================
 * MOVING A SET OF MARKS THROUGH ITS APPROVAL CHAIN
 * =============================================================================
 *
 * THE ONE THING THIS FILE CHANGES ABOUT THE PRODUCT: a mark is no longer part
 * of the academic record the moment it is typed. `submitGrade` records the
 * numbers on the enrolment and leaves its status alone; the enrolment becomes
 * COMPLETED — which is what the transcript and the CGPA read — only in
 * `releaseResults`, at the end of the chain.
 *
 * That inversion is the whole point and it is the only safe place to put it.
 * Gating the TRANSCRIPT on the sheet's stage instead would have left the CGPA,
 * the academic standing and the graduation audit all quietly counting marks
 * nobody had approved, because each of those reads the enrolment rather than
 * the sheet.
 *
 * EVERY DECISION IS A ROW. A sheet returned twice and approved on the third
 * pass keeps all three steps, because "the HOD queried this before it was
 * approved" is exactly what somebody needs months later when a mark is
 * disputed — and a status column alone cannot answer it.
 */

export interface WorkflowResult {
  ok: boolean;
  message: string;
  stage?: ResultStage;
}

export interface SheetView {
  id: string;
  offeringId: string;
  stage: ResultStage;
  returnedReason: string | null;
  releasedAt: Date | null;
  steps: {
    stage: string;
    decision: string;
    note: string | null;
    at: Date;
    by: string | null;
  }[];
}

/** The sheet for a section, created on first use rather than at scheduling. */
export async function ensureSheet(params: {
  schoolId: string;
  offeringId: string;
}): Promise<{ ok: boolean; id?: string; message?: string }> {
  const db = dbFor(params.schoolId);

  // Re-read through the tenant client: a crafted id must not attach a sheet to
  // another university's section.
  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    select: { id: true },
  });
  if (!offering) return { ok: false, message: 'That section is not part of this school.' };

  const existing = await db.resultSheet.findUnique({ where: { offeringId: offering.id } });
  if (existing) return { ok: true, id: existing.id };

  const created = await db.resultSheet.create({
    data: { schoolId: params.schoolId, offeringId: offering.id, stage: 'DRAFT' },
  });
  return { ok: true, id: created.id };
}

export async function sheetFor(params: {
  schoolId: string;
  offeringId: string;
}): Promise<SheetView | null> {
  const sheet = await dbFor(params.schoolId).resultSheet.findUnique({
    where: { offeringId: params.offeringId },
    include: {
      steps: {
        orderBy: { at: 'asc' },
        include: { by: { include: { user: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });
  if (!sheet) return null;

  return {
    id: sheet.id,
    offeringId: sheet.offeringId,
    stage: (isResultStage(sheet.stage) ? sheet.stage : 'DRAFT') as ResultStage,
    returnedReason: sheet.returnedReason,
    releasedAt: sheet.releasedAt,
    steps: sheet.steps.map((step) => ({
      stage: step.stage,
      decision: step.decision,
      note: step.note,
      at: step.at,
      by: step.by ? `${step.by.user.firstName} ${step.by.user.lastName}`.trim() : null,
    })),
  };
}

/** The stage a section is at, for callers that only need the one answer. */
export async function stageOf(params: {
  schoolId: string;
  offeringId: string;
}): Promise<ResultStage> {
  const sheet = await dbFor(params.schoolId).resultSheet.findUnique({
    where: { offeringId: params.offeringId },
    select: { stage: true },
  });
  if (!sheet) return 'DRAFT';
  return (isResultStage(sheet.stage) ? sheet.stage : 'DRAFT') as ResultStage;
}

// -----------------------------------------------------------------------------
// Moving it along
// -----------------------------------------------------------------------------

interface Actor {
  role: Role;
  membershipId: string;
  userId: string;
  /** For a lecturer: their instructor profile, to check the section is theirs. */
  instructorProfileId?: string | null;
}

/** The lecturer sends the marks up. */
export async function submitResults(params: {
  schoolId: string;
  offeringId: string;
  policy: ResultWorkflowPolicy;
  actor: Actor;
}): Promise<WorkflowResult> {
  const db = dbFor(params.schoolId);

  if (!maySubmit(params.actor.role)) {
    return { ok: false, message: 'Only the lecturer of record submits results.' };
  }

  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    include: {
      course: { select: { code: true } },
      enrollments: {
        where: { status: { in: ['REGISTERED', 'COMPLETED'] } },
        select: { id: true, gradePoint: true },
      },
    },
  });
  if (!offering) return { ok: false, message: 'That section is not part of this school.' };

  /*
   * A lecturer may only submit their own. A head of department may submit on
   * behalf of a colleague who has left, which is a real and common case, but
   * they then cannot also approve it — the chain moves past their own stage.
   */
  if (
    params.actor.role === 'INSTRUCTOR' &&
    offering.instructorId !== params.actor.instructorProfileId
  ) {
    return { ok: false, message: 'You are not the lecturer of record for this section.' };
  }

  const ensured = await ensureSheet({ schoolId: params.schoolId, offeringId: params.offeringId });
  if (!ensured.ok) return { ok: false, message: ensured.message! };

  const current = await stageOf({ schoolId: params.schoolId, offeringId: params.offeringId });
  const readiness = readyToSubmit({
    stage: current,
    total: offering.enrollments.length,
    graded: offering.enrollments.filter((e) => e.gradePoint !== null).length,
  });
  if (!readiness.ok) return { ok: false, message: readiness.reason! };

  const target = nextStage('DRAFT', params.policy);

  await db.$transaction(async (tx) => {
    await tx.resultSheet.update({
      where: { id: ensured.id! },
      // The old return note is cleared: it described the previous version of a
      // sheet that has since been changed and resubmitted.
      data: { stage: target, returnedReason: null },
    });
    await tx.resultStep.create({
      data: {
        schoolId: params.schoolId,
        sheetId: ensured.id!,
        stage: 'DRAFT',
        decision: 'SUBMITTED',
        byId: params.actor.membershipId,
      },
    });
  });

  // A chain of nothing releases on submission — the school asked for that.
  if (isReleased(target)) {
    return releaseResults({
      schoolId: params.schoolId,
      offeringId: params.offeringId,
      actor: params.actor,
      alreadyAtStage: true,
    });
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actor.userId,
    action: 'result.submit',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `${offering.course.code}: ${offering.enrollments.length} results submitted for approval.`,
  });

  await notifyApprovers(params.schoolId, target, offering.course.code, params.offeringId);

  return { ok: true, message: 'Submitted for approval.', stage: target };
}

/** An office passes it on. */
export async function approveResults(params: {
  schoolId: string;
  offeringId: string;
  policy: ResultWorkflowPolicy;
  note?: string | null;
  actor: Actor;
}): Promise<WorkflowResult> {
  const db = dbFor(params.schoolId);

  const sheet = await db.resultSheet.findUnique({
    where: { offeringId: params.offeringId },
    include: { offering: { include: { course: { select: { code: true } } } } },
  });
  if (!sheet) return { ok: false, message: 'Those results have not been submitted yet.' };

  const current = (isResultStage(sheet.stage) ? sheet.stage : 'DRAFT') as ResultStage;

  /*
   * Checked against the stage the sheet is ACTUALLY at, read now — not against
   * whatever the page was showing when the button was drawn. Two approvers
   * acting at once would otherwise both succeed and the sheet would skip a
   * stage.
   */
  if (!mayApprove(current, params.actor.role)) {
    return { ok: false, message: 'These results are not waiting on you.' };
  }

  const target = nextStage(current, params.policy);

  await db.$transaction(async (tx) => {
    await tx.resultSheet.update({ where: { id: sheet.id }, data: { stage: target } });
    await tx.resultStep.create({
      data: {
        schoolId: params.schoolId,
        sheetId: sheet.id,
        stage: current,
        decision: 'APPROVED',
        byId: params.actor.membershipId,
        note: params.note?.trim() || null,
      },
    });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actor.userId,
    action: 'result.approve',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `${sheet.offering.course.code}: approved at ${current} by ${params.actor.role}.`,
  });

  if (isReleased(target)) {
    return releaseResults({
      schoolId: params.schoolId,
      offeringId: params.offeringId,
      actor: params.actor,
      alreadyAtStage: true,
    });
  }

  await notifyApprovers(params.schoolId, target, sheet.offering.course.code, params.offeringId);
  return { ok: true, message: 'Approved and passed on.', stage: target };
}

/** Sent back to the lecturer, with a reason. */
export async function returnResults(params: {
  schoolId: string;
  offeringId: string;
  reason: string;
  actor: Actor;
}): Promise<WorkflowResult> {
  const db = dbFor(params.schoolId);

  const reason = params.reason.trim();
  if (!reason) {
    // A sheet returned with no reason is a lecturer guessing at what to change.
    return { ok: false, message: 'Say what needs changing before sending it back.' };
  }

  const sheet = await db.resultSheet.findUnique({
    where: { offeringId: params.offeringId },
    include: {
      offering: {
        include: {
          course: { select: { code: true } },
          instructor: { select: { userId: true } },
        },
      },
    },
  });
  if (!sheet) return { ok: false, message: 'Those results have not been submitted yet.' };

  const current = (isResultStage(sheet.stage) ? sheet.stage : 'DRAFT') as ResultStage;
  if (!mayReturn(current, params.actor.role)) {
    return { ok: false, message: 'These results are not waiting on you.' };
  }

  await db.$transaction(async (tx) => {
    await tx.resultSheet.update({
      where: { id: sheet.id },
      data: { stage: 'DRAFT', returnedReason: reason.slice(0, 1000) },
    });
    await tx.resultStep.create({
      data: {
        schoolId: params.schoolId,
        sheetId: sheet.id,
        stage: current,
        decision: 'RETURNED',
        byId: params.actor.membershipId,
        note: reason.slice(0, 1000),
      },
    });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actor.userId,
    action: 'result.return',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `${sheet.offering.course.code}: returned to the lecturer from ${current}.`,
  });

  // The lecturer is the one who has to act, so they are the one told.
  const membership = sheet.offering.instructor
    ? await db.membership.findFirst({
        where: { userId: sheet.offering.instructor.userId, status: 'ACTIVE' },
        select: { id: true },
      })
    : null;

  if (membership) {
    void notify({
      schoolId: params.schoolId,
      membershipIds: [membership.id],
      kind: 'GRADES_POSTED',
      title: `${sheet.offering.course.code} results were sent back`,
      body: reason,
      href: `/teaching/${params.offeringId}`,
      subjectType: 'CourseOffering',
      subjectId: params.offeringId,
    });
  }

  return { ok: true, message: 'Sent back to the lecturer.', stage: 'DRAFT' };
}

/**
 * The end of the chain: the marks become the academic record.
 *
 * THIS IS THE ONLY PLACE AN ENROLMENT BECOMES COMPLETED. Everything downstream
 * — the transcript, the CGPA, academic standing, the graduation audit — reads
 * that status, so this one write is what "released" actually means.
 *
 * The CGPA is recomputed per student afterwards rather than inside the
 * transaction: a section of four hundred would otherwise hold a write lock for
 * the duration, and a recompute that fails is recoverable by running it again
 * where a half-committed release is not.
 */
export async function releaseResults(params: {
  schoolId: string;
  offeringId: string;
  actor: Actor;
  /** Set when the caller has already moved the sheet to RELEASED. */
  alreadyAtStage?: boolean;
}): Promise<WorkflowResult> {
  const db = dbFor(params.schoolId);

  const sheet = await db.resultSheet.findUnique({
    where: { offeringId: params.offeringId },
    include: { offering: { include: { course: { select: { code: true } } } } },
  });
  if (!sheet) return { ok: false, message: 'Those results have not been submitted yet.' };

  const enrolments = await db.enrollment.findMany({
    where: {
      offeringId: params.offeringId,
      status: { in: ['REGISTERED', 'COMPLETED'] },
      gradePoint: { not: null },
    },
    select: { id: true, studentId: true },
  });

  await db.$transaction(async (tx) => {
    await tx.resultSheet.update({
      where: { id: sheet.id },
      data: { stage: 'RELEASED', releasedAt: new Date(), returnedReason: null },
    });
    await tx.resultStep.create({
      data: {
        schoolId: params.schoolId,
        sheetId: sheet.id,
        stage: 'SENATE_REVIEW',
        decision: 'RELEASED',
        byId: params.actor.membershipId,
      },
    });
    await tx.enrollment.updateMany({
      where: { id: { in: enrolments.map((e) => e.id) } },
      data: { status: 'COMPLETED' },
    });
    await tx.courseOffering.update({
      where: { id: params.offeringId },
      data: { gradesPosted: true, status: 'CLOSED' },
    });
  });

  // One student at a time, outside the transaction. See the note above.
  for (const studentId of [...new Set(enrolments.map((e) => e.studentId))]) {
    try {
      await recomputeStudentAcademics(params.schoolId, studentId);
    } catch (error) {
      // A failed recompute leaves a correct enrolment and a stale aggregate,
      // which running it again fixes. Losing the release would not be.
      console.error('[results] recompute failed for', studentId, error);
    }
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actor.userId,
    action: 'result.release',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `${sheet.offering.course.code}: ${enrolments.length} results released to students.`,
  });

  const memberships = await db.membership.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      user: { students: { some: { id: { in: enrolments.map((e) => e.studentId) } } } },
    },
    select: { id: true },
  });

  void notify({
    schoolId: params.schoolId,
    membershipIds: memberships.map((m) => m.id),
    kind: 'GRADES_POSTED',
    title: `${sheet.offering.course.code} results are out`,
    body: 'Your result for this course is now on your record.',
    href: '/me',
    subjectType: 'CourseOffering',
    subjectId: params.offeringId,
  });

  void params.alreadyAtStage;

  return {
    ok: true,
    message: `Released. ${enrolments.length} ${enrolments.length === 1 ? 'result is' : 'results are'} now on the students' records.`,
    stage: 'RELEASED',
  };
}

/** Everything sitting with a given office, for their queue. */
export async function sheetsAwaiting(params: {
  schoolId: string;
  role: Role;
  instructorProfileId?: string | null;
}) {
  const db = dbFor(params.schoolId);

  const stages: ResultStage[] = (
    ['HOD_REVIEW', 'FACULTY_REVIEW', 'SENATE_REVIEW'] as ResultStage[]
  ).filter((stage) => mayApprove(stage, params.role));

  if (stages.length === 0) return [];

  const sheets = await db.resultSheet.findMany({
    where: { stage: { in: stages } },
    include: {
      offering: {
        include: {
          course: { select: { code: true, title: true } },
          term: { select: { name: true } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          _count: { select: { enrollments: true } },
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
  });

  return sheets.map((sheet) => ({
    offeringId: sheet.offeringId,
    stage: sheet.stage as ResultStage,
    code: sheet.offering.course.code,
    title: sheet.offering.course.title,
    section: sheet.offering.section,
    term: sheet.offering.term.name,
    lecturer: sheet.offering.instructor
      ? `${sheet.offering.instructor.user.firstName} ${sheet.offering.instructor.user.lastName}`.trim()
      : null,
    students: sheet.offering._count.enrollments,
    waitingSince: sheet.updatedAt,
  }));
}

async function notifyApprovers(
  schoolId: string,
  stage: ResultStage,
  courseCode: string,
  offeringId: string,
): Promise<void> {
  const roles: Role[] = (['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] as Role[]).filter((role) =>
    mayApprove(stage, role),
  );
  if (roles.length === 0) return;

  const memberships = await dbFor(schoolId).membership.findMany({
    where: { role: { in: roles }, status: 'ACTIVE' },
    select: { id: true },
  });

  void notify({
    schoolId,
    membershipIds: memberships.map((m) => m.id),
    kind: 'GRADES_POSTED',
    title: `${courseCode} results need your approval`,
    href: '/results',
    subjectType: 'CourseOffering',
    subjectId: offeringId,
  });
}
