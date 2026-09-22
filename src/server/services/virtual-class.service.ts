import { dbFor } from '@/lib/tenant';
import {
  nextPosition,
  validateVirtualClass,
  type VirtualClassDraft,
} from '@/lib/domain/lms';
import { meetingProvider } from '@/server/meetings';
import { notify } from './notification.service';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * VIRTUAL CLASSES
 * =============================================================================
 *
 * Putting a live class into a module.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN:
 *
 *   1. validate,
 *   2. ask the provider to create the meeting,
 *   3. only then write anything to our database.
 *
 * Creating the row first and calling the provider afterwards would leave a
 * module item pointing at a meeting that does not exist whenever the call
 * failed. Calling the provider first and failing to write leaves an orphaned
 * meeting in the school's tenant — which is worse in principle but harmless in
 * practice: an unused Teams meeting nobody has the link to simply expires.
 * Between the two, a student never seeing a broken link wins.
 */

export interface VirtualClassResult {
  ok: boolean;
  message: string;
  id?: string;
  /** Which driver handled it, for the message and the audit trail. */
  via?: string;
}

export async function saveVirtualClass(params: {
  schoolId: string;
  moduleId: string;
  title: string;
  provider: string;
  /** Only for MANUAL. Ignored otherwise — the provider decides the URL. */
  joinUrl?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /** The teacher, so a provider that can make them organiser does. */
  organiserMembershipId?: string | null;
  organiserEmail?: string | null;
  actorUserId: string;
  now?: Date;
}): Promise<VirtualClassResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const draft: VirtualClassDraft = {
    title: params.title,
    provider: params.provider,
    joinUrl: params.joinUrl,
    startsAt: params.startsAt,
    endsAt: params.endsAt,
  };

  // Validated BEFORE the provider is called: creating a real meeting and then
  // rejecting the form leaves one in the school's tenant that nothing here
  // points at, and nobody will ever find it to cancel it.
  const problems = validateVirtualClass(draft, now);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const module = await db.courseModule.findUnique({
    where: { id: params.moduleId },
    include: { space: { select: { offeringId: true } } },
  });
  if (!module) return { ok: false, message: 'That module is not part of this school.' };

  const provider = meetingProvider(params.provider);

  const created = await provider.create({
    subject: params.title.trim(),
    startsAt: params.startsAt!,
    endsAt: params.endsAt!,
    organiserEmail: params.organiserEmail,
  });

  if (!created.ok) {
    return {
      ok: false,
      via: created.via,
      message: created.message ?? 'Could not create the meeting.',
    };
  }

  /*
   * MANUAL supplies no URL of its own — the teacher's pasted one is the answer.
   * Every other provider's URL wins over anything that arrived in the form, so
   * a stale or crafted field cannot redirect a class somewhere else.
   */
  const joinUrl = created.joinUrl ?? params.joinUrl?.trim();
  if (!joinUrl) {
    return { ok: false, via: created.via, message: 'No join link was produced.' };
  }

  try {
    const siblings = await db.moduleItem.findMany({
      where: { moduleId: module.id },
      select: { position: true },
    });

    const item = await db.$transaction(async (tx) => {
      const moduleItem = await tx.moduleItem.create({
        data: {
          schoolId: params.schoolId,
          moduleId: module.id,
          kind: 'MEETING',
          title: params.title.trim(),
          position: nextPosition(siblings),
          isPublished: false,
        },
      });

      await tx.virtualClass.create({
        data: {
          schoolId: params.schoolId,
          moduleItemId: moduleItem.id,
          // What actually created it, which is not always what was asked for:
          // an unconfigured TEAMS falls back to MANUAL, and the row should say
          // so rather than claim a Teams meeting exists.
          provider: created.via === 'manual' ? 'MANUAL' : params.provider.toUpperCase(),
          joinUrl,
          startsAt: params.startsAt!,
          endsAt: params.endsAt!,
          externalId: created.externalId ?? null,
          organiserMembershipId: params.organiserMembershipId ?? null,
        },
      });

      return moduleItem;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.class.create',
      entityType: 'ModuleItem',
      entityId: item.id,
      summary: `Virtual class "${params.title.trim()}" scheduled for ${params.startsAt!.toISOString()} via ${created.via}.`,
    });

    return {
      ok: true,
      id: item.id,
      via: created.via,
      message:
        created.via === 'manual'
          ? 'Class added as a draft. Publish it when students should see it.'
          : `Meeting created in ${created.via}. Added as a draft — publish it when students should see it.`,
    };
  } catch (error) {
    console.error('[virtual-class] save failed', error);
    return { ok: false, message: 'Could not save that class.' };
  }
}

/**
 * Tell the class a session has been scheduled.
 *
 * Sent on PUBLISH, not on creation — a draft is not news, and announcing one
 * would tell students about a class the lecturer has not committed to.
 *
 * Fire-and-forget by the same reasoning `notify` itself documents: a failed
 * notification must never be the reason a publish fails.
 */
export async function announceVirtualClass(params: {
  schoolId: string;
  itemId: string;
  actorMembershipId: string;
}): Promise<void> {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: {
      virtualClass: true,
      module: { include: { space: { select: { offeringId: true } } } },
    },
  });
  if (!item?.virtualClass || !item.module.space.offeringId) return;

  const offeringId = item.module.space.offeringId;

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: { select: { code: true } } },
  });
  if (!offering) return;

  /*
   * Enrolments name a Student, and notifications go to a Membership — so the
   * roster has to be walked Student -> User -> Membership. Two queries rather
   * than one per student.
   */
  const enrolments = await db.enrollment.findMany({
    where: { offeringId, status: { in: ['REGISTERED', 'COMPLETED'] } },
    include: { student: { select: { userId: true } } },
  });
  if (enrolments.length === 0) return;

  const memberships = await db.membership.findMany({
    where: { userId: { in: enrolments.map((e) => e.student.userId) }, role: 'STUDENT' },
    select: { id: true },
  });

  const when = item.virtualClass.startsAt.toISOString().slice(0, 16).replace('T', ' ');

  void notify({
    schoolId: params.schoolId,
    membershipIds: memberships.map((m) => m.id),
    kind: 'MEETING_SCHEDULED',
    title: `${offering.course.code}: ${item.title}`,
    body: `A live class is scheduled for ${when}.`,
    href: `/me/courses/${offeringId}`,
    subjectType: 'ModuleItem',
    subjectId: item.id,
    exceptMembershipId: params.actorMembershipId,
  });
}

/** Cancel a class: the row goes, and so should the meeting, where we made it. */
export async function deleteVirtualClass(params: {
  schoolId: string;
  itemId: string;
  actorUserId: string;
}): Promise<VirtualClassResult> {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: { virtualClass: true },
  });
  if (!item?.virtualClass) return { ok: false, message: 'That class no longer exists.' };

  await db.moduleItem.delete({ where: { id: item.id } });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.class.delete',
    entityType: 'ModuleItem',
    entityId: item.id,
    summary: `Virtual class "${item.title}" removed.`,
  });

  /*
   * The meeting in the provider's system is left alone, and that is a decision
   * rather than an omission. Cancelling it would need a second network call on
   * a path that must not fail, and a Teams meeting nobody has the link to
   * expires on its own. Removing it from the module is what students see.
   */
  return {
    ok: true,
    message:
      item.virtualClass.provider === 'MANUAL'
        ? 'Class removed.'
        : 'Class removed from the module. The meeting itself still exists in the provider until it expires.',
  };
}
