import { dbFor } from '@/lib/tenant';
import {
  detectClashes,
  validateSlot,
  wouldClash,
  type ScheduledSlot,
  type SlotDraft,
} from '@/lib/domain/timetable';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * THE TIMETABLE
 * =============================================================================
 *
 * The Dean's page. Scheduling a section, and assigning the lecturer who teaches
 * it.
 *
 * A clash is REPORTED, and saving is refused only when the dean has not said to
 * override. A timetable is built under constraints the software does not know
 * about — a visiting lecturer available one morning, a hall released at short
 * notice — and a system that refuses outright is one a faculty keeps on paper
 * instead. What it must never do is let a clash pass unseen.
 */

export interface TimetableResult {
  ok: boolean;
  message: string;
  id?: string;
  /** Populated when a save was refused for clashing, so the UI can explain. */
  clashes?: string[];
}

/**
 * Every scheduled slot for a term, shaped for the grid and the clash detector.
 *
 * The lecturer is resolved through the OFFERING rather than stored on the
 * meeting: a section has one instructor, and duplicating that onto each weekly
 * slot would create a second place for it to be wrong.
 */
export async function loadTimetable(params: {
  schoolId: string;
  termId?: string | null;
}): Promise<{ slots: ScheduledSlot[]; termId: string | null }> {
  const db = dbFor(params.schoolId);

  const term = params.termId
    ? await db.term.findUnique({ where: { id: params.termId } })
    : await db.term.findFirst({ where: { isCurrent: true } });

  if (!term) return { slots: [], termId: null };

  const meetings = await db.meeting.findMany({
    where: { offering: { termId: term.id } },
    include: {
      offering: {
        include: {
          course: { select: { code: true, title: true } },
          instructor: {
            include: { user: { select: { firstName: true, lastName: true, id: true } } },
          },
        },
      },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });

  // The membership id, not the instructor id: clash detection is about a
  // PERSON's time, and a person is a membership at this school.
  const instructorUserIds = meetings
    .map((m) => m.offering.instructor?.userId)
    .filter((id): id is string => Boolean(id));

  const memberships = instructorUserIds.length
    ? await db.membership.findMany({
        where: { userId: { in: instructorUserIds } },
        select: { id: true, userId: true },
      })
    : [];
  const membershipByUser = new Map(memberships.map((m) => [m.userId, m.id]));

  const slots: ScheduledSlot[] = meetings.map((m) => {
    const instructor = m.offering.instructor;
    return {
      id: m.id,
      dayOfWeek: m.dayOfWeek,
      startMinute: m.startMinute,
      endMinute: m.endMinute,
      // The meeting's own room wins; the offering's is the fallback.
      room: m.room ?? m.offering.room ?? null,
      offeringId: m.offeringId,
      offeringLabel: `${m.offering.course.code} ${m.offering.section}`.trim(),
      teacherId: instructor ? (membershipByUser.get(instructor.userId) ?? null) : null,
      teacherName: instructor
        ? `${instructor.user.firstName} ${instructor.user.lastName}`
        : null,
    };
  });

  return { slots, termId: term.id };
}

export async function saveSlot(params: {
  schoolId: string;
  meetingId?: string | null;
  offeringId: string;
  draft: SlotDraft;
  /** The dean has seen the clashes and chosen to schedule it anyway. */
  overrideClashes?: boolean;
  actorUserId: string;
}): Promise<TimetableResult> {
  const db = dbFor(params.schoolId);

  const problems = validateSlot(params.draft);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // Re-read through the tenant client: a crafted id must not schedule another
  // university's section into this one's timetable.
  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    include: {
      course: { select: { code: true } },
      instructor: { select: { userId: true } },
    },
  });
  if (!offering) return { ok: false, message: 'Choose a section from this school.' };

  const { slots } = await loadTimetable({ schoolId: params.schoolId, termId: offering.termId });

  const membership = offering.instructor
    ? await db.membership.findFirst({
        where: { userId: offering.instructor.userId },
        select: { id: true },
      })
    : null;

  const candidate: ScheduledSlot = {
    id: params.meetingId ?? 'candidate',
    dayOfWeek: params.draft.dayOfWeek,
    startMinute: params.draft.startMinute,
    endMinute: params.draft.endMinute,
    room: params.draft.room?.trim() || offering.room || null,
    offeringId: offering.id,
    offeringLabel: `${offering.course.code} ${offering.section}`.trim(),
    teacherId: membership?.id ?? null,
    teacherName: null,
  };

  const clashes = wouldClash(candidate, slots);
  if (clashes.length > 0 && !params.overrideClashes) {
    return {
      ok: false,
      message: `This clashes with ${clashes.length} other ${clashes.length === 1 ? 'class' : 'classes'}.`,
      clashes: clashes.map((c) => c.message),
    };
  }

  const data = {
    offeringId: offering.id,
    dayOfWeek: params.draft.dayOfWeek,
    startMinute: params.draft.startMinute,
    endMinute: params.draft.endMinute,
    room: params.draft.room?.trim() || null,
  };

  const meeting = params.meetingId
    ? await db.meeting.update({ where: { id: params.meetingId }, data })
    : await db.meeting.create({ data: { ...data, schoolId: params.schoolId } });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.meetingId ? 'timetable.update' : 'timetable.create',
    entityType: 'Meeting',
    entityId: meeting.id,
    summary:
      `${candidate.offeringLabel} scheduled day ${data.dayOfWeek} ${data.startMinute}-${data.endMinute}` +
      (clashes.length > 0 ? ` — OVERRIDDEN over ${clashes.length} clash(es).` : '.'),
  });

  return {
    ok: true,
    message:
      clashes.length > 0
        ? `Scheduled, over ${clashes.length} clash${clashes.length === 1 ? '' : 'es'}.`
        : 'Scheduled.',
    id: meeting.id,
    clashes: clashes.length > 0 ? clashes.map((c) => c.message) : undefined,
  };
}

export async function removeSlot(params: {
  schoolId: string;
  meetingId: string;
  actorUserId: string;
}): Promise<TimetableResult> {
  const db = dbFor(params.schoolId);
  const meeting = await db.meeting.findUnique({ where: { id: params.meetingId } });
  if (!meeting) return { ok: false, message: 'That slot is not part of this school.' };

  await db.meeting.delete({ where: { id: meeting.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'timetable.delete',
    entityType: 'Meeting',
    entityId: meeting.id,
    summary: 'Timetable slot removed.',
  });
  return { ok: true, message: 'Slot removed.' };
}

/**
 * Put a lecturer in front of a section.
 *
 * The Dean's other power, and it lives here rather than with the curriculum
 * because who teaches what is a scheduling decision — it changes the timetable
 * the moment it is made, and can create a clash that did not exist a second
 * earlier.
 */
export async function assignLecturer(params: {
  schoolId: string;
  offeringId: string;
  instructorId: string | null;
  actorUserId: string;
}): Promise<TimetableResult> {
  const db = dbFor(params.schoolId);

  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    include: { course: { select: { code: true } } },
  });
  if (!offering) return { ok: false, message: 'That section is not part of this school.' };

  if (params.instructorId) {
    const instructor = await db.instructor.findUnique({ where: { id: params.instructorId } });
    if (!instructor) return { ok: false, message: 'Choose a lecturer from this school.' };
  }

  await db.courseOffering.update({
    where: { id: offering.id },
    data: { instructorId: params.instructorId },
  });

  // Recomputed AFTER the assignment: the point is to tell the dean what they
  // have just created, not to refuse it.
  const { slots } = await loadTimetable({ schoolId: params.schoolId, termId: offering.termId });
  const created = detectClashes(slots).filter(
    (c) => c.kind === 'TEACHER' && (c.a.offeringId === offering.id || c.b.offeringId === offering.id),
  );

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'timetable.assign',
    entityType: 'CourseOffering',
    entityId: offering.id,
    summary: params.instructorId
      ? `${offering.course.code} ${offering.section} assigned a lecturer.`
      : `${offering.course.code} ${offering.section} left unassigned.`,
  });

  return {
    ok: true,
    message: params.instructorId
      ? created.length > 0
        ? `Assigned — but that lecturer is now double-booked in ${created.length} slot${created.length === 1 ? '' : 's'}.`
        : 'Lecturer assigned.'
      : 'Lecturer removed.',
    clashes: created.length > 0 ? created.map((c) => c.message) : undefined,
  };
}

/** Sections in a term, for the assignment panel. */
export async function sectionsForTerm(schoolId: string, termId: string) {
  const db = dbFor(schoolId);
  return db.courseOffering.findMany({
    where: { termId },
    include: {
      course: { select: { code: true, title: true } },
      instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      meetings: true,
    },
    orderBy: { course: { code: 'asc' } },
  });
}
