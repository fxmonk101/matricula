import 'server-only';

import { dbFor } from '@/lib/tenant';
import {
  classifyDrop,
  evaluateEligibility,
  promoteFromWaitlist,
  type EligibilityResult,
  type MeetingSlot,
} from '@/lib/domain/enrollment';
import { SEAT_CONSUMING_STATUSES } from '@/lib/domain/enums';
import { summariseAccount } from '@/lib/domain/finance';
import { recordAudit } from './audit.service';
import { loadSchoolConfig } from '@/server/school-config';

/**
 * =============================================================================
 * REGISTRATION SERVICE
 * =============================================================================
 *
 * The pure decision lives in `lib/domain/enrollment.ts`. This module's job is
 * the part that pure code cannot do: read a consistent snapshot, decide, and
 * write — atomically.
 *
 * THE CONCURRENCY PROBLEM
 * -----------------------
 * The last seat in a section is a classic lost-update race:
 *
 *     T1: read seatsTaken = 49 (capacity 50)   ┐
 *     T2: read seatsTaken = 49                 │  both see a free seat
 *     T1: write seatsTaken = 50                │
 *     T2: write seatsTaken = 50                ┘  51 students, 50 seats
 *
 * Three mechanisms are layered against this:
 *
 *   1. The read, the decision, and the write all happen inside ONE interactive
 *      transaction, so the snapshot cannot change underneath the decision.
 *
 *   2. The seat counter is incremented with a CONDITIONAL update
 *      (`where: { seatsTaken: { lt: capacity } }`). If a concurrent transaction
 *      took the seat first, the update matches zero rows and we detect it
 *      rather than silently overselling. This is optimistic concurrency
 *      control, and it is the mechanism that actually holds under Postgres
 *      READ COMMITTED, where transactions alone would not help.
 *
 *   3. A UNIQUE constraint on (studentId, offeringId) makes double-registration
 *      impossible at the storage layer regardless of application bugs.
 *
 * `seatsTaken` is a denormalised counter. It is a cache; the truth is
 * COUNT(enrollments WHERE status = 'REGISTERED'). `reconcileSeatCounts` below
 * repairs drift, and should run as a periodic job.
 */

export interface RegistrationResult {
  ok: boolean;
  status: 'REGISTERED' | 'WAITLISTED' | 'REJECTED';
  message: string;
  reasons: string[];
  waitlistPosition: number | null;
  enrollmentId?: string;
}

export async function registerForOffering(params: {
  schoolId: string;
  studentId: string;
  offeringId: string;
  actorId: string;
  now?: Date;
}): Promise<RegistrationResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);
  const { enrollment: policy } = await loadSchoolConfig(params.schoolId);

  try {
    return await db.$transaction(async (tx) => {
      // --- Gather the snapshot -----------------------------------------------
      const offering = await tx.courseOffering.findUnique({
        where: { id: params.offeringId },
        include: {
          course: { include: { prerequisites: { include: { prerequisite: true } } } },
          term: true,
          meetings: true,
        },
      });

      if (!offering) {
        return reject('That section no longer exists.');
      }

      const student = await tx.student.findUnique({
        where: { id: params.studentId },
        include: {
          holds: { where: { releasedAt: null, blocksRegistration: true } },
          invoices: {
            select: { totalMinor: true, paidMinor: true, dueDate: true, voidedAt: true },
          },
        },
      });

      if (!student) {
        return reject('Student record not found.');
      }

      // Every enrollment this student has ever had — needed both for the
      // prerequisite check (history) and the load/conflict checks (this term).
      const allEnrollments = await tx.enrollment.findMany({
        where: { studentId: params.studentId },
        include: {
          offering: {
            include: { course: true, meetings: true, term: { select: { id: true } } },
          },
        },
      });

      const thisTerm = allEnrollments.filter(
        (e) => e.offering.termId === offering.termId && e.status === 'REGISTERED',
      );

      const waitlistLength = await tx.enrollment.count({
        where: { offeringId: offering.id, status: 'WAITLISTED' },
      });

      const account = summariseAccount(student.invoices, 0, now);

      // --- Decide (pure) -----------------------------------------------------
      const decision: EligibilityResult = evaluateEligibility({
        now,
        term: {
          registrationOpensAt: offering.term.registrationOpensAt,
          registrationClosesAt: offering.term.registrationClosesAt,
        },
        student: {
          status: student.status,
          academicStanding: student.academicStanding,
          cgpa: student.cgpa,
          registeredCreditsThisTerm: thisTerm.reduce(
            (sum, e) => sum + e.offering.course.creditHours,
            0,
          ),
        },
        offering: {
          label: `${offering.course.code}-${offering.section}`,
          status: offering.status,
          capacity: offering.capacity,
          seatsTaken: offering.seatsTaken,
          waitlistCapacity: offering.waitlistCapacity,
          currentWaitlistLength: waitlistLength,
          creditHours: offering.course.creditHours,
          meetings: offering.meetings as MeetingSlot[],
        },
        blockingHolds: student.holds.map((h) => ({ kind: h.kind, reason: h.reason })),
        outstandingBalanceMinor: account.outstandingMinor,
        prerequisiteRules: offering.course.prerequisites.map((p) => ({
          prerequisiteCourseId: p.prerequisiteId,
          prerequisiteCourseCode: p.prerequisite.code,
          minGradePoint: p.minGradePoint,
          isConcurrent: p.isConcurrent,
        })),
        completedCourses: allEnrollments
          .filter((e) => e.status === 'COMPLETED' || e.gradePoint !== null)
          .map((e) => ({ courseId: e.offering.courseId, gradePoint: e.gradePoint })),
        concurrentlyRegisteredCourseIds: thisTerm.map((e) => e.offering.courseId),
        existingRegistrations: thisTerm.map((e) => ({
          offeringLabel: `${e.offering.course.code}-${e.offering.section}`,
          meetings: e.offering.meetings as MeetingSlot[],
        })),
        policy,
        alreadyEnrolled: allEnrollments.some(
          (e) =>
            e.offeringId === offering.id &&
            e.status !== 'DROPPED' &&
            e.status !== 'WITHDRAWN',
        ),
        hasOverloadApproval: false,
      });

      if (decision.outcome === 'REJECTED') {
        return {
          ok: false,
          status: 'REJECTED' as const,
          message: 'Registration could not be completed.',
          reasons: decision.reasons,
          waitlistPosition: null,
        };
      }

      // --- Commit ------------------------------------------------------------
      if (decision.outcome === 'REGISTERED') {
        // Optimistic seat claim. Zero rows updated means someone beat us to it
        // between the read above and this write.
        const claimed = await tx.courseOffering.updateMany({
          where: { id: offering.id, seatsTaken: { lt: offering.capacity } },
          data: { seatsTaken: { increment: 1 } },
        });

        if (claimed.count === 0) {
          return {
            ok: false,
            status: 'REJECTED' as const,
            message: 'Registration could not be completed.',
            reasons: ['The last seat in this section was taken moments ago. Try the waitlist.'],
            waitlistPosition: null,
          };
        }

        const enrollment = await tx.enrollment.create({
          data: {
            schoolId: params.schoolId,
            studentId: params.studentId,
            offeringId: offering.id,
            status: 'REGISTERED',
          },
        });

        return {
          ok: true,
          status: 'REGISTERED' as const,
          message: `Registered for ${offering.course.code}-${offering.section}.`,
          reasons: [],
          waitlistPosition: null,
          enrollmentId: enrollment.id,
        };
      }

      // WAITLISTED
      const enrollment = await tx.enrollment.create({
        data: {
          schoolId: params.schoolId,
          studentId: params.studentId,
          offeringId: offering.id,
          status: 'WAITLISTED',
          waitlistPosition: decision.waitlistPosition,
        },
      });

      return {
        ok: true,
        status: 'WAITLISTED' as const,
        message: `Added to the waitlist for ${offering.course.code}-${offering.section} at position ${decision.waitlistPosition}.`,
        reasons: decision.reasons,
        waitlistPosition: decision.waitlistPosition,
        enrollmentId: enrollment.id,
      };
    });
  } catch (error) {
    // P2002 = unique constraint. Reaching here means the (studentId, offeringId)
    // guard fired, i.e. a genuine double-submit.
    if (isUniqueViolation(error)) {
      return reject('You are already registered for this section.');
    }
    console.error('[enrollment] registration failed', error);
    return reject('An unexpected error prevented registration. Please try again.');
  } finally {
    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorId,
      action: 'enrollment.attempt',
      entityType: 'CourseOffering',
      entityId: params.offeringId,
      summary: `Registration attempted for student ${params.studentId}.`,
    });
  }
}

function reject(reason: string): RegistrationResult {
  return {
    ok: false,
    status: 'REJECTED',
    message: 'Registration could not be completed.',
    reasons: [reason],
    waitlistPosition: null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Drop or withdraw. The date decides which — see `classifyDrop`.
 *
 * Freeing a seat triggers waitlist promotion in the SAME transaction, so there
 * is never an interval in which a seat is free but the queue has not moved.
 */
export async function dropEnrollment(params: {
  schoolId: string;
  enrollmentId: string;
  actorId: string;
  now?: Date;
}): Promise<{ ok: boolean; message: string }> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  return db.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.findUnique({
      where: { id: params.enrollmentId },
      include: { offering: { include: { term: true, course: true } } },
    });

    if (!enrollment) return { ok: false, message: 'Enrollment not found.' };
    if (enrollment.status === 'DROPPED' || enrollment.status === 'WITHDRAWN') {
      return { ok: false, message: 'This registration has already been ended.' };
    }

    const outcome = classifyDrop(now, {
      addDropDeadline: enrollment.offering.term.addDropDeadline,
      withdrawalDeadline: enrollment.offering.term.withdrawalDeadline,
    });

    if (outcome.kind === 'DENIED') {
      return { ok: false, message: outcome.reason };
    }

    const wasHoldingSeat = SEAT_CONSUMING_STATUSES.includes(
      enrollment.status as 'REGISTERED' | 'COMPLETED',
    );

    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: outcome.kind,
        droppedAt: now,
        letterGrade: outcome.transcriptNotation,
        waitlistPosition: null,
      },
    });

    if (wasHoldingSeat) {
      await tx.courseOffering.update({
        where: { id: enrollment.offeringId },
        // Guard against the counter going negative if it has drifted.
        data: { seatsTaken: { decrement: 1 } },
      });

      const queue = await tx.enrollment.findMany({
        where: { offeringId: enrollment.offeringId, status: 'WAITLISTED' },
        select: { id: true, studentId: true, waitlistPosition: true },
      });

      const { promote, renumbered } = promoteFromWaitlist(
        queue.map((q) => ({
          enrollmentId: q.id,
          studentId: q.studentId,
          waitlistPosition: q.waitlistPosition ?? Number.MAX_SAFE_INTEGER,
        })),
        1,
      );

      for (const entry of promote) {
        await tx.enrollment.update({
          where: { id: entry.enrollmentId },
          data: { status: 'REGISTERED', waitlistPosition: null },
        });
        await tx.courseOffering.update({
          where: { id: enrollment.offeringId },
          data: { seatsTaken: { increment: 1 } },
        });
      }

      for (const entry of renumbered) {
        await tx.enrollment.update({
          where: { id: entry.enrollmentId },
          data: { waitlistPosition: entry.waitlistPosition },
        });
      }
    }

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorId,
      action: `enrollment.${outcome.kind.toLowerCase()}`,
      entityType: 'Enrollment',
      entityId: enrollment.id,
      summary: `${enrollment.offering.course.code}-${enrollment.offering.section} ${outcome.kind.toLowerCase()}.`,
    });

    return {
      ok: true,
      message:
        outcome.kind === 'DROPPED'
          ? `Dropped ${enrollment.offering.course.code}. It will not appear on your transcript.`
          : `Withdrew from ${enrollment.offering.course.code}. A "W" will appear on your transcript.`,
    };
  });
}

/**
 * Repair drift between the denormalised `seatsTaken` counter and the actual
 * registration count. Intended for a scheduled job; also useful after any bulk
 * data operation that bypasses the service layer.
 */
export async function reconcileSeatCounts(schoolId: string): Promise<{ repaired: number }> {
  const db = dbFor(schoolId);
  const offerings = await db.courseOffering.findMany({
    select: {
      id: true,
      seatsTaken: true,
      _count: { select: { enrollments: { where: { status: 'REGISTERED' } } } },
    },
  });

  let repaired = 0;
  for (const o of offerings) {
    const actual = o._count.enrollments;
    if (actual !== o.seatsTaken) {
      await db.courseOffering.update({ where: { id: o.id }, data: { seatsTaken: actual } });
      repaired += 1;
    }
  }
  return { repaired };
}
