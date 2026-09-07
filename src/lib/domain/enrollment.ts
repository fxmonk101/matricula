/**
 * =============================================================================
 * ENROLLMENT ELIGIBILITY & SEAT ALLOCATION ENGINE
 * =============================================================================
 *
 * Pure domain logic. The database transaction that persists an enrollment lives
 * in `src/server/services/enrollment.service.ts`; this file decides *whether*
 * an enrollment is permissible and *what should happen*, and nothing else.
 *
 * Separating the decision from the write is what makes registration testable.
 * The eligibility rules are the part that changes every academic session; the
 * transaction is the part that must never change.
 */

import { PASSING_GRADE_POINT } from './grading';
import { DAY_NAMES } from './enums';
import { DEFAULT_ENROLLMENT_POLICY, type EnrollmentPolicy } from './config';

export type { EnrollmentPolicy };

// -----------------------------------------------------------------------------
// Policy constants
// -----------------------------------------------------------------------------

/**
 * The DEFAULT registration policy. A school passes its own through
 * `EligibilityInput.policy`; this is what applies when it does not.
 */
export const REGISTRATION_POLICY: EnrollmentPolicy = DEFAULT_ENROLLMENT_POLICY;

// -----------------------------------------------------------------------------
// Timetable conflict detection
// -----------------------------------------------------------------------------

export interface MeetingSlot {
  dayOfWeek: number; // 1 = Monday .. 7 = Sunday
  startMinute: number; // minutes from midnight
  endMinute: number;
}

export interface TimetableConflict {
  day: string;
  existingOffering: string;
  candidateOffering: string;
  overlapMinutes: number;
}

/**
 * Two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 *
 *     aStart < bEnd  AND  bStart < aEnd
 *
 * Half-open is the right model: a class ending at 10:00 and one starting at
 * 10:00 do not conflict. Using closed intervals here would reject every
 * back-to-back timetable the registrar builds.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * ALGORITHM: TIMETABLE CONFLICT DETECTION
 * ---------------------------------------
 * Bucket every already-registered meeting by weekday, then test the candidate's
 * meetings only against the same weekday's bucket.
 *
 *   Naive:   O(n · m)      — compare every pair
 *   Here:    O(n + m · k)  — where k is the average meetings-per-weekday,
 *                            typically 2-4 even for a heavy load.
 *
 * A student registers for at most ~8 courses, so this is not a performance
 * problem in absolute terms; the bucketing exists because it also makes the
 * conflict *report* naturally grouped by day, which is what the UI needs.
 */
export function detectTimetableConflicts(
  existing: readonly { offeringLabel: string; meetings: readonly MeetingSlot[] }[],
  candidate: { offeringLabel: string; meetings: readonly MeetingSlot[] },
): TimetableConflict[] {
  const byDay = new Map<number, { label: string; slot: MeetingSlot }[]>();

  for (const e of existing) {
    for (const slot of e.meetings) {
      const bucket = byDay.get(slot.dayOfWeek) ?? [];
      bucket.push({ label: e.offeringLabel, slot });
      byDay.set(slot.dayOfWeek, bucket);
    }
  }

  const conflicts: TimetableConflict[] = [];

  for (const slot of candidate.meetings) {
    for (const other of byDay.get(slot.dayOfWeek) ?? []) {
      if (
        intervalsOverlap(slot.startMinute, slot.endMinute, other.slot.startMinute, other.slot.endMinute)
      ) {
        conflicts.push({
          day: DAY_NAMES[slot.dayOfWeek] ?? `Day ${slot.dayOfWeek}`,
          existingOffering: other.label,
          candidateOffering: candidate.offeringLabel,
          overlapMinutes: overlapMinutes(
            slot.startMinute,
            slot.endMinute,
            other.slot.startMinute,
            other.slot.endMinute,
          ),
        });
      }
    }
  }

  return conflicts;
}

// -----------------------------------------------------------------------------
// Prerequisite satisfaction
// -----------------------------------------------------------------------------

export interface PrerequisiteRule {
  prerequisiteCourseId: string;
  prerequisiteCourseCode: string;
  minGradePoint: number;
  isConcurrent: boolean;
}

export interface CompletedCourse {
  courseId: string;
  gradePoint: number | null;
}

/**
 * ALGORITHM: PREREQUISITE SATISFACTION
 * ------------------------------------
 * The curriculum is a directed acyclic graph whose edges are prerequisites.
 * Checking one course means testing its immediate in-edges only — transitive
 * prerequisites are guaranteed satisfied by induction, because the student
 * could not have passed the direct prerequisite without having satisfied its
 * own prerequisites first. This is why we do NOT walk the graph: a single-level
 * check is both correct and O(|prereqs|).
 *
 * A CONCURRENT prerequisite is satisfied by being registered in the same term,
 * which is why the caller passes `concurrentlyRegisteredCourseIds` separately.
 */
export function checkPrerequisites(
  rules: readonly PrerequisiteRule[],
  completed: readonly CompletedCourse[],
  concurrentlyRegisteredCourseIds: readonly string[] = [],
): { satisfied: boolean; unmet: string[] } {
  // Best grade point achieved per course — a retake that improved the grade
  // must be able to unlock a downstream course.
  const bestByCourse = new Map<string, number>();
  for (const c of completed) {
    if (c.gradePoint === null) continue;
    const prev = bestByCourse.get(c.courseId);
    if (prev === undefined || c.gradePoint > prev) {
      bestByCourse.set(c.courseId, c.gradePoint);
    }
  }

  const concurrent = new Set(concurrentlyRegisteredCourseIds);
  const unmet: string[] = [];

  for (const rule of rules) {
    const achieved = bestByCourse.get(rule.prerequisiteCourseId);

    if (achieved !== undefined && achieved >= rule.minGradePoint) continue;
    if (rule.isConcurrent && concurrent.has(rule.prerequisiteCourseId)) continue;

    if (achieved === undefined) {
      unmet.push(`${rule.prerequisiteCourseCode} (not taken)`);
    } else {
      unmet.push(
        `${rule.prerequisiteCourseCode} (grade point ${achieved.toFixed(1)} < required ${rule.minGradePoint.toFixed(1)})`,
      );
    }
  }

  return { satisfied: unmet.length === 0, unmet };
}

// -----------------------------------------------------------------------------
// The eligibility decision
// -----------------------------------------------------------------------------

export type EnrollmentOutcome = 'REGISTERED' | 'WAITLISTED' | 'REJECTED';

export interface EligibilityInput {
  now: Date;
  term: {
    registrationOpensAt: Date;
    registrationClosesAt: Date;
  };
  student: {
    status: string;
    academicStanding: string;
    cgpa: number;
    /** Credits already registered this term, excluding the candidate. */
    registeredCreditsThisTerm: number;
  };
  offering: {
    label: string;
    status: string;
    capacity: number;
    seatsTaken: number;
    waitlistCapacity: number;
    currentWaitlistLength: number;
    creditHours: number;
    meetings: readonly MeetingSlot[];
  };
  /** Active holds that block registration. */
  blockingHolds: readonly { kind: string; reason: string }[];
  outstandingBalanceMinor: number;
  prerequisiteRules: readonly PrerequisiteRule[];
  completedCourses: readonly CompletedCourse[];
  concurrentlyRegisteredCourseIds: readonly string[];
  existingRegistrations: readonly { offeringLabel: string; meetings: readonly MeetingSlot[] }[];
  /** True when the student already has any non-dropped row for this offering. */
  alreadyEnrolled: boolean;
  /** Registrar override for the credit ceiling. */
  hasOverloadApproval: boolean;
  /** This school's credit ceilings and tolerances. Defaults when omitted. */
  policy?: EnrollmentPolicy;
}

export interface EligibilityResult {
  outcome: EnrollmentOutcome;
  /** Ordered, human-readable reasons. Empty when outcome is REGISTERED. */
  reasons: string[];
  /** 1-based queue position when the outcome is WAITLISTED. */
  waitlistPosition: number | null;
  conflicts: TimetableConflict[];
}

/**
 * ALGORITHM: ENROLLMENT ELIGIBILITY
 * ---------------------------------
 * A short-circuiting rule pipeline. Hard rules are evaluated first and cause
 * immediate rejection; only if every hard rule passes do we consider capacity,
 * which decides between REGISTERED and WAITLISTED.
 *
 *   HARD REJECT (any one is fatal)
 *     R1  duplicate enrollment
 *     R2  registration window closed
 *     R3  offering not OPEN
 *     R4  student status not registrable
 *     R5  blocking hold present
 *     R6  outstanding balance beyond tolerance
 *     R7  unmet prerequisites
 *     R8  timetable conflict
 *     R9  credit ceiling exceeded
 *
 *   CAPACITY (evaluated last)
 *     seatsTaken <  capacity                      -> REGISTERED
 *     waitlist   <  waitlistCapacity              -> WAITLISTED at position n+1
 *     otherwise                                   -> REJECTED (section full)
 *
 * Ordering is not arbitrary. Cheap, unambiguous checks run before expensive,
 * data-heavy ones, and capacity runs last so that a student who would be
 * rejected anyway never consumes a seat or a waitlist slot.
 *
 * Complexity: O(P + M·K) — prerequisites plus conflict detection. Everything
 * else is O(1).
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const policy = input.policy ?? DEFAULT_ENROLLMENT_POLICY;
  const reasons: string[] = [];

  // R1 — idempotence guard.
  if (input.alreadyEnrolled) {
    return {
      outcome: 'REJECTED',
      reasons: ['You already hold a registration or waitlist place in this section.'],
      waitlistPosition: null,
      conflicts: [],
    };
  }

  // R2 — registration window.
  if (input.now < input.term.registrationOpensAt) {
    reasons.push(
      `Registration for this term opens on ${input.term.registrationOpensAt.toDateString()}.`,
    );
  } else if (input.now > input.term.registrationClosesAt) {
    reasons.push(
      `Registration for this term closed on ${input.term.registrationClosesAt.toDateString()}.`,
    );
  }

  // R3 — offering must be accepting registrations.
  if (input.offering.status !== 'OPEN') {
    reasons.push(`Section ${input.offering.label} is ${input.offering.status.toLowerCase()}.`);
  }

  // R4 — student must be in a registrable state.
  const registrableStatuses = ['ACTIVE', 'PROBATION'];
  if (!registrableStatuses.includes(input.student.status)) {
    reasons.push(
      `Your record is marked ${input.student.status}. Contact the Registrar to register.`,
    );
  }
  if (input.student.academicStanding === 'DISMISSED') {
    reasons.push('Registration is not permitted while under academic dismissal.');
  }

  // R5 — holds.
  for (const hold of input.blockingHolds) {
    reasons.push(`${hold.kind} hold: ${hold.reason}`);
  }

  // R6 — finance.
  if (input.outstandingBalanceMinor > policy.outstandingBalanceToleranceMinor) {
    reasons.push(
      `An outstanding balance must be settled before registration (see the Finance tab).`,
    );
  }

  // R7 — prerequisites.
  const prereq = checkPrerequisites(
    input.prerequisiteRules,
    input.completedCourses,
    input.concurrentlyRegisteredCourseIds,
  );
  if (!prereq.satisfied) {
    reasons.push(`Prerequisites not satisfied: ${prereq.unmet.join('; ')}.`);
  }

  // R8 — timetable.
  const conflicts = detectTimetableConflicts(input.existingRegistrations, {
    offeringLabel: input.offering.label,
    meetings: input.offering.meetings,
  });
  for (const c of conflicts) {
    reasons.push(
      `Timetable clash on ${c.day} with ${c.existingOffering} (${c.overlapMinutes} minutes).`,
    );
  }

  // R9 — credit load ceiling.
  const projectedCredits =
    input.student.registeredCreditsThisTerm + input.offering.creditHours;
  const ceiling = input.hasOverloadApproval
    ? policy.maxCreditsWithOverloadApproval
    : policy.maxCreditsPerTerm;
  if (projectedCredits > ceiling) {
    reasons.push(
      `This would bring you to ${projectedCredits} credits, above the ${ceiling}-credit maximum.`,
    );
  }

  if (reasons.length > 0) {
    return { outcome: 'REJECTED', reasons, waitlistPosition: null, conflicts };
  }

  // Capacity — the only branch that can still succeed.
  if (input.offering.seatsTaken < input.offering.capacity) {
    return { outcome: 'REGISTERED', reasons: [], waitlistPosition: null, conflicts: [] };
  }

  if (input.offering.currentWaitlistLength < input.offering.waitlistCapacity) {
    return {
      outcome: 'WAITLISTED',
      reasons: [
        `Section ${input.offering.label} is full. You have been placed on the waitlist.`,
      ],
      waitlistPosition: input.offering.currentWaitlistLength + 1,
      conflicts: [],
    };
  }

  return {
    outcome: 'REJECTED',
    reasons: [`Section ${input.offering.label} and its waitlist are both full.`],
    waitlistPosition: null,
    conflicts: [],
  };
}

// -----------------------------------------------------------------------------
// Waitlist promotion
// -----------------------------------------------------------------------------

export interface WaitlistEntry {
  enrollmentId: string;
  studentId: string;
  waitlistPosition: number;
}

/**
 * ALGORITHM: WAITLIST PROMOTION (FIFO with compaction)
 * ----------------------------------------------------
 * When a seat is freed, the lowest-position waitlist entry is promoted and the
 * remaining queue is compacted so positions stay dense (1, 2, 3, ...) rather
 * than developing holes.
 *
 * Dense positions matter because students are shown "you are number 4"; a
 * sparse queue would make that number lie. Compaction is O(n log n) for the
 * sort plus O(n) to renumber — with n bounded by `waitlistCapacity` (typically
 * ≤ 20), this is trivially cheap and worth the clarity.
 *
 * `freedSeats` may exceed 1 when a batch drop occurs (e.g. a cancelled cohort).
 */
export function promoteFromWaitlist(
  queue: readonly WaitlistEntry[],
  freedSeats: number,
): { promote: WaitlistEntry[]; renumbered: { enrollmentId: string; waitlistPosition: number }[] } {
  if (freedSeats <= 0 || queue.length === 0) {
    return { promote: [], renumbered: [] };
  }

  const ordered = [...queue].sort((a, b) => a.waitlistPosition - b.waitlistPosition);
  const promote = ordered.slice(0, freedSeats);
  const remaining = ordered.slice(freedSeats);

  const renumbered = remaining.map((entry, index) => ({
    enrollmentId: entry.enrollmentId,
    waitlistPosition: index + 1,
  }));

  return { promote, renumbered };
}

// -----------------------------------------------------------------------------
// Drop / withdraw classification
// -----------------------------------------------------------------------------

export type DropOutcome =
  | { kind: 'DROPPED'; transcriptNotation: null; refundEligible: true }
  | { kind: 'WITHDRAWN'; transcriptNotation: 'W'; refundEligible: false }
  | { kind: 'DENIED'; reason: string };

/**
 * ALGORITHM: DROP vs WITHDRAW
 * ---------------------------
 * The date the student acts determines the consequence:
 *
 *   now <= addDropDeadline      -> DROPPED   : vanishes from the record, refundable
 *   now <= withdrawalDeadline   -> WITHDRAWN : stays on the transcript as "W", no refund
 *   now >  withdrawalDeadline   -> DENIED    : the student must sit the assessment
 *
 * Encoding this as data rather than scattered `if (date > x)` checks across the
 * UI is what keeps the academic regulations enforceable in one place.
 */
export function classifyDrop(
  now: Date,
  deadlines: { addDropDeadline: Date; withdrawalDeadline: Date },
): DropOutcome {
  if (now <= deadlines.addDropDeadline) {
    return { kind: 'DROPPED', transcriptNotation: null, refundEligible: true };
  }
  if (now <= deadlines.withdrawalDeadline) {
    return { kind: 'WITHDRAWN', transcriptNotation: 'W', refundEligible: false };
  }
  return {
    kind: 'DENIED',
    reason: `The withdrawal deadline (${deadlines.withdrawalDeadline.toDateString()}) has passed.`,
  };
}

/** Convenience re-export so callers need only one import for pass checks. */
export { PASSING_GRADE_POINT };
