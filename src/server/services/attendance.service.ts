import 'server-only';

import {
  blankRegister,
  eligibilityFor,
  isAttendanceStatus,
  sessionAcceptsRegister,
  tally,
  validateRegister,
  type AttendancePolicyInput,
  type ClassAttendanceStatus,
  type EligibilityVerdict,
  type RegisterMark,
} from '@/lib/domain/attendance';
import { dbFor } from '@/lib/tenant';
import { recordAudit } from '@/server/services/audit.service';
import { mayAuthorOffering } from '@/server/services/lms.service';

/**
 * =============================================================================
 * TAKING AND READING THE REGISTER
 * =============================================================================
 *
 * The rules about what attendance MEANS live in `src/lib/domain/attendance.ts`
 * and are not repeated here. This file is about who may mark a register, what
 * happens when one is saved twice, and how a percentage is assembled without
 * asking the database once per student.
 */

export interface AttendanceResult {
  ok: boolean;
  message: string;
  marked?: number;
}

// -----------------------------------------------------------------------------
// The roster for one session
// -----------------------------------------------------------------------------

export interface RegisterRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  matricNumber: string | null;
  status: ClassAttendanceStatus;
  note: string | null;
}

export interface RegisterView {
  teachingLogId: string;
  offeringId: string;
  offeringLabel: string;
  localDate: string;
  startMinute: number;
  endMinute: number;
  sessionStatus: string;
  /** False for a cancelled or moved class; the UI must not offer a register. */
  acceptsRegister: boolean;
  /** True once anybody has saved it, so the UI can say "not yet taken". */
  alreadyTaken: boolean;
  rows: RegisterRow[];
}

/**
 * Load a session's register, filling in anybody not yet marked.
 *
 * The roster is read fresh every time rather than from the saved rows, so a
 * student who registered for the course after the register was first taken
 * appears on it rather than being invisible forever.
 */
export async function loadRegister(params: {
  schoolId: string;
  teachingLogId: string;
  actorRole: string;
  actorInstructorProfileId?: string | null;
}): Promise<RegisterView | null> {
  const db = dbFor(params.schoolId);

  const log = await db.teachingLog.findUnique({
    where: { id: params.teachingLogId },
    select: {
      id: true,
      offeringId: true,
      localDate: true,
      startMinute: true,
      endMinute: true,
      status: true,
    },
  });

  // A log with no section has no roster — a seminar or an induction. There is
  // nobody to mark, so there is no register, and that is not an error.
  if (!log || !log.offeringId) return null;

  const allowed = await mayAuthorOffering({
    schoolId: params.schoolId,
    offeringId: log.offeringId,
    instructorProfileId: params.actorInstructorProfileId,
    role: params.actorRole,
  });
  // 404 rather than 403, as everywhere else here: refusing with "you may not
  // see this" confirms the session exists to somebody who should not know.
  if (!allowed) return null;

  const [offering, enrolments, existing] = await Promise.all([
    db.courseOffering.findUnique({
      where: { id: log.offeringId },
      select: { section: true, course: { select: { code: true, title: true } } },
    }),
    db.enrollment.findMany({
      where: {
        offeringId: log.offeringId,
        // The same set that may see course material. A dropped student is off
        // the register; a withdrawn one keeps a record.
        status: { in: ['REGISTERED', 'COMPLETED', 'WAITLISTED'] },
      },
      select: {
        id: true,
        studentId: true,
        student: {
          select: {
            matricNumber: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    db.classAttendance.findMany({
      where: { teachingLogId: log.id },
      select: { enrollmentId: true, status: true, note: true },
    }),
  ]);

  const marks = new Map(existing.map((row) => [row.enrollmentId, row]));
  const defaults = new Map(blankRegister(enrolments.map((e) => e.id)).map((m) => [m.enrollmentId, m]));

  const rows: RegisterRow[] = enrolments
    .map((enrolment) => {
      const saved = marks.get(enrolment.id);
      const status = saved && isAttendanceStatus(saved.status)
        ? saved.status
        : (defaults.get(enrolment.id)?.status ?? 'PRESENT');

      return {
        enrollmentId: enrolment.id,
        studentId: enrolment.studentId,
        name: `${enrolment.student.user.firstName} ${enrolment.student.user.lastName}`.trim(),
        matricNumber: enrolment.student.matricNumber,
        status,
        note: saved?.note ?? null,
      };
    })
    // By matriculation number where there is one: it is the order the paper
    // sheet is in, and a lecturer transcribing from paper should not have to
    // hunt.
    .sort((a, b) =>
      (a.matricNumber ?? a.name).localeCompare(b.matricNumber ?? b.name, undefined, {
        numeric: true,
      }),
    );

  return {
    teachingLogId: log.id,
    offeringId: log.offeringId,
    offeringLabel: offering
      ? `${offering.course.code}${offering.section ? ` ${offering.section}` : ''} — ${offering.course.title}`
      : 'This section',
    localDate: log.localDate,
    startMinute: log.startMinute,
    endMinute: log.endMinute,
    sessionStatus: log.status,
    acceptsRegister: sessionAcceptsRegister(log.status),
    alreadyTaken: existing.length > 0,
    rows,
  };
}

// -----------------------------------------------------------------------------
// Saving it
// -----------------------------------------------------------------------------

export async function saveRegister(params: {
  schoolId: string;
  teachingLogId: string;
  marks: readonly RegisterMark[];
  notes?: Record<string, string | null>;
  actorRole: string;
  actorMembershipId: string;
  actorInstructorProfileId?: string | null;
  actorUserId: string;
}): Promise<AttendanceResult> {
  const db = dbFor(params.schoolId);

  const log = await db.teachingLog.findUnique({
    where: { id: params.teachingLogId },
    select: { id: true, offeringId: true, status: true, localDate: true },
  });
  if (!log || !log.offeringId) {
    return { ok: false, message: 'That session is not one this school recorded.' };
  }

  const allowed = await mayAuthorOffering({
    schoolId: params.schoolId,
    offeringId: log.offeringId,
    instructorProfileId: params.actorInstructorProfileId,
    role: params.actorRole,
  });
  if (!allowed) return { ok: false, message: 'That session is not one this school recorded.' };

  /*
   * A cancelled class carries no register. Refused here as well as hidden in
   * the UI, because the UI is not an authorisation — and because a lecturer
   * may cancel a class AFTER taking the register, which is exactly when a
   * stale form would post absences for a lecture that did not happen.
   */
  if (!sessionAcceptsRegister(log.status)) {
    return {
      ok: false,
      message: 'That class was not delivered, so it takes no register.',
    };
  }

  const roster = await db.enrollment.findMany({
    where: {
      offeringId: log.offeringId,
      status: { in: ['REGISTERED', 'COMPLETED', 'WAITLISTED'] },
    },
    select: { id: true },
  });

  const problems = validateRegister(params.marks, roster.map((r) => r.id));
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  /*
   * One transaction, and an upsert per student rather than delete-then-insert.
   *
   * Deleting the register first would mean that a failure halfway through
   * leaves the session with no attendance at all — worse than the state it was
   * in before somebody pressed save.
   */
  try {
    await db.$transaction(
      params.marks.map((mark) =>
        db.classAttendance.upsert({
          where: {
            teachingLogId_enrollmentId: {
              teachingLogId: log.id,
              enrollmentId: mark.enrollmentId,
            },
          },
          create: {
            schoolId: params.schoolId,
            teachingLogId: log.id,
            enrollmentId: mark.enrollmentId,
            status: mark.status,
            note: params.notes?.[mark.enrollmentId]?.trim() || null,
            markedById: params.actorMembershipId,
          },
          update: {
            status: mark.status,
            note: params.notes?.[mark.enrollmentId]?.trim() || null,
            markedById: params.actorMembershipId,
            markedAt: new Date(),
          },
        }),
      ),
    );
  } catch (error) {
    console.error('[attendance] save failed', error);
    return { ok: false, message: 'Could not save that register.' };
  }

  const absent = params.marks.filter((m) => m.status === 'ABSENT').length;

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'attendance.register',
    entityType: 'TeachingLog',
    entityId: log.id,
    // The count of absences is the part somebody will later dispute, so it is
    // the part the audit entry states.
    summary: `Register for ${log.localDate}: ${params.marks.length} marked, ${absent} absent.`,
  });

  return { ok: true, message: 'Register saved.', marked: params.marks.length };
}

// -----------------------------------------------------------------------------
// Reading it back
// -----------------------------------------------------------------------------

export interface StudentAttendance {
  enrollmentId: string;
  studentId: string;
  name: string;
  matricNumber: string | null;
  attended: number;
  missed: number;
  excused: number;
  counted: number;
  percentage: number | null;
  verdict: EligibilityVerdict;
}

export interface OfferingAttendance {
  offeringId: string;
  /** Delivered sessions, whether or not a register was taken for them. */
  sessionsHeld: number;
  /** Of those, how many have a register. The honest denominator. */
  sessionsMarked: number;
  students: StudentAttendance[];
}

/**
 * Every student's attendance on one section.
 *
 * Three queries regardless of cohort size: the sessions, the roster, and every
 * mark. The tallying is done in memory because a four-hundred-student section
 * is four hundred rows, not four hundred queries.
 */
export async function attendanceForOffering(params: {
  schoolId: string;
  offeringId: string;
  policy?: AttendancePolicyInput;
}): Promise<OfferingAttendance> {
  const db = dbFor(params.schoolId);

  const sessions = await db.teachingLog.findMany({
    where: { offeringId: params.offeringId, status: 'DELIVERED' },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  const [enrolments, marks] = await Promise.all([
    db.enrollment.findMany({
      where: {
        offeringId: params.offeringId,
        status: { in: ['REGISTERED', 'COMPLETED', 'WAITLISTED'] },
      },
      select: {
        id: true,
        studentId: true,
        student: {
          select: {
            matricNumber: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    sessionIds.length === 0
      ? Promise.resolve([] as { enrollmentId: string; status: string; teachingLogId: string }[])
      : db.classAttendance.findMany({
          where: { teachingLogId: { in: sessionIds } },
          select: { enrollmentId: true, status: true, teachingLogId: true },
        }),
  ]);

  const byEnrolment = new Map<string, ClassAttendanceStatus[]>();
  const markedSessions = new Set<string>();
  for (const mark of marks) {
    markedSessions.add(mark.teachingLogId);
    if (!isAttendanceStatus(mark.status)) continue;
    const list = byEnrolment.get(mark.enrollmentId) ?? [];
    list.push(mark.status);
    byEnrolment.set(mark.enrollmentId, list);
  }

  const students: StudentAttendance[] = enrolments
    .map((enrolment) => {
      const tallied = tally(byEnrolment.get(enrolment.id) ?? []);
      return {
        enrollmentId: enrolment.id,
        studentId: enrolment.studentId,
        name: `${enrolment.student.user.firstName} ${enrolment.student.user.lastName}`.trim(),
        matricNumber: enrolment.student.matricNumber,
        attended: tallied.attended,
        missed: tallied.missed,
        excused: tallied.excused,
        counted: tallied.counted,
        percentage: tallied.percentage,
        verdict: eligibilityFor(tallied, params.policy),
      };
    })
    /*
     * Worst first. This list is read when somebody is looking for the students
     * in trouble, and putting them on page three of an alphabetical table is
     * how they are missed until the week of the examination. UNKNOWN sorts to
     * the bottom: it is not a low score, it is no score.
     */
    .sort((a, b) => {
      if (a.percentage === null && b.percentage === null) return a.name.localeCompare(b.name);
      if (a.percentage === null) return 1;
      if (b.percentage === null) return -1;
      if (a.percentage !== b.percentage) return a.percentage - b.percentage;
      return a.name.localeCompare(b.name);
    });

  return {
    offeringId: params.offeringId,
    sessionsHeld: sessions.length,
    sessionsMarked: markedSessions.size,
    students,
  };
}

/** One student's attendance on one section — for their own course page. */
export async function attendanceForEnrolment(params: {
  schoolId: string;
  enrollmentId: string;
  policy?: AttendancePolicyInput;
}): Promise<{
  attended: number;
  missed: number;
  excused: number;
  counted: number;
  percentage: number | null;
  verdict: EligibilityVerdict;
}> {
  const db = dbFor(params.schoolId);

  const marks = await db.classAttendance.findMany({
    where: {
      enrollmentId: params.enrollmentId,
      // Only sessions that actually ran. A register left attached to a class
      // later marked CANCELLED must not count against anybody.
      teachingLog: { status: 'DELIVERED' },
    },
    select: { status: true },
  });

  const tallied = tally(
    marks.map((m) => m.status).filter(isAttendanceStatus),
  );

  return { ...tallied, verdict: eligibilityFor(tallied, params.policy) };
}

/**
 * The sessions of a section, with whether each has a register.
 *
 * Drives the lecturer's list. "Not taken" is shown rather than hidden, because
 * a gap the lecturer can see is a gap they can close, and a percentage computed
 * over the sessions somebody remembered to mark is only honest if the ones they
 * did not are visible next to it.
 */
export async function sessionsForOffering(params: {
  schoolId: string;
  offeringId: string;
}): Promise<
  {
    teachingLogId: string;
    localDate: string;
    startMinute: number;
    endMinute: number;
    status: string;
    topic: string | null;
    markedCount: number;
    absentCount: number;
  }[]
> {
  const db = dbFor(params.schoolId);

  const logs = await db.teachingLog.findMany({
    where: { offeringId: params.offeringId },
    select: {
      id: true,
      localDate: true,
      startMinute: true,
      endMinute: true,
      status: true,
      topic: true,
      attendance: { select: { status: true } },
    },
    orderBy: [{ localDate: 'desc' }, { startMinute: 'desc' }],
  });

  return logs.map((log) => ({
    teachingLogId: log.id,
    localDate: log.localDate,
    startMinute: log.startMinute,
    endMinute: log.endMinute,
    status: log.status,
    topic: log.topic,
    markedCount: log.attendance.length,
    absentCount: log.attendance.filter((a) => a.status === 'ABSENT').length,
  }));
}
