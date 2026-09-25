import 'server-only';

import {
  outstanding,
  spilloverRisk,
  summarise,
  type AttemptRecord,
  type CarryoverSummary,
  type OutstandingCourse,
  type RequirementRecord,
} from '@/lib/domain/carryover';
import { dbFor } from '@/lib/tenant';
import { loadSchoolConfig } from '@/server/school-config';

/**
 * =============================================================================
 * WHAT A STUDENT STILL OWES, FROM THE RECORD
 * =============================================================================
 *
 * ONLY RELEASED RESULTS COUNT, and that is not an implementation detail. An
 * enrolment reaches COMPLETED at the end of the approval chain and nowhere
 * else, so reading that status is what keeps this list from telling a student
 * they have failed a course whose marks Senate has not yet seen.
 *
 * A course still being taken is neither passed nor failed: it carries a null
 * grade point and the domain excludes it. That is why in-progress enrolments
 * are fetched at all rather than filtered out in the query — the domain needs
 * to see them to know the student has not simply skipped the course.
 */

export interface CarryoverReport {
  courses: OutstandingCourse[];
  summary: CarryoverSummary;
  /** Null when the student has no programme, or it has no stated length. */
  spillover: { atRisk: boolean; termsNeeded: number; termsRemaining: number } | null;
}

export async function carryoverReport(params: {
  schoolId: string;
  studentId: string;
}): Promise<CarryoverReport | null> {
  const db = dbFor(params.schoolId);
  const { grading, enrollment: enrollmentPolicy } = await loadSchoolConfig(params.schoolId);

  const student = await db.student.findUnique({
    where: { id: params.studentId },
    select: {
      id: true,
      level: true,
      programId: true,
      program: { select: { durationTerms: true } },
    },
  });
  if (!student) return null;

  const [enrolments, requirements, termCount] = await Promise.all([
    db.enrollment.findMany({
      where: {
        studentId: student.id,
        /*
         * COMPLETED is a released result. REGISTERED is work in progress, and
         * is included deliberately so the domain can tell "being taken now"
         * from "never attempted" — the difference between a plan and a debt.
         */
        status: { in: ['COMPLETED', 'REGISTERED'] },
      },
      select: {
        gradePoint: true,
        letterGrade: true,
        status: true,
        offering: {
          select: {
            courseId: true,
            course: { select: { code: true, title: true, creditHours: true } },
            term: { select: { name: true, startDate: true } },
          },
        },
      },
    }),
    db.programRequirement.findMany({
      where: { programId: student.programId },
      select: {
        courseId: true,
        kind: true,
        level: true,
        course: { select: { code: true, title: true, creditHours: true } },
      },
    }),
    db.termGpa.count({ where: { studentId: student.id } }),
  ]);

  /*
   * Terms are ordered by their start date rather than by a sequence column,
   * because `termSequence` in the domain only has to be MONOTONIC — it answers
   * "which attempt was later", not "which term number is this".
   */
  const ordered = [...enrolments].sort(
    (a, b) => a.offering.term.startDate.getTime() - b.offering.term.startDate.getTime(),
  );

  const attempts: AttemptRecord[] = ordered.map((enrolment, index) => ({
    courseId: enrolment.offering.courseId,
    courseCode: enrolment.offering.course.code,
    courseTitle: enrolment.offering.course.title,
    creditHours: enrolment.offering.course.creditHours,
    /*
     * A REGISTERED enrolment reports NO grade point even if a lecturer has
     * typed one, because that mark has not been released. Reading it here
     * would put a course on a student's carryover list before Senate had
     * approved the result — the exact leak the approval chain closed.
     */
    gradePoint: enrolment.status === 'COMPLETED' ? enrolment.gradePoint : null,
    letterGrade: enrolment.status === 'COMPLETED' ? enrolment.letterGrade : null,
    termSequence: index,
    termName: enrolment.offering.term.name,
  }));

  const required: RequirementRecord[] = requirements.map((requirement) => ({
    courseId: requirement.courseId,
    courseCode: requirement.course.code,
    courseTitle: requirement.course.title,
    creditHours: requirement.course.creditHours,
    kind: requirement.kind,
    level: requirement.level,
  }));

  const courses = outstanding({
    attempts,
    requirements: required,
    passingGradePoint: grading.passingGradePoint,
  });
  const summary = summarise(courses);

  const duration = student.program?.durationTerms ?? 0;
  const termsRemaining = Math.max(0, duration - termCount);

  return {
    courses,
    summary,
    spillover:
      duration > 0
        ? {
            ...spilloverRisk({
              outstandingCredits: summary.outstandingCredits,
              termsRemaining,
              maxCreditsPerTerm: enrollmentPolicy.maxCreditsPerTerm,
            }),
            termsRemaining,
          }
        : null,
  };
}

/**
 * Which offerings THIS TERM would clear a carryover.
 *
 * The other half of the answer. "You must retake CSC201" is only useful if the
 * student can then find CSC201 running this semester, and a list that says
 * what is owed without saying where to get it sends them to the department to
 * ask — which is what this feature exists to stop.
 */
export async function retakeOptions(params: {
  schoolId: string;
  studentId: string;
}): Promise<
  {
    courseId: string;
    courseCode: string;
    courseTitle: string;
    offerings: { id: string; section: string | null; instructor: string | null }[];
  }[]
> {
  const db = dbFor(params.schoolId);
  const report = await carryoverReport(params);
  if (!report) return [];

  const failed = report.courses.filter((c) => c.reason === 'FAILED');
  if (failed.length === 0) return [];

  const offerings = await db.courseOffering.findMany({
    where: {
      courseId: { in: failed.map((c) => c.courseId) },
      term: { isCurrent: true },
    },
    select: {
      id: true,
      courseId: true,
      section: true,
      instructor: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });

  return failed.map((course) => ({
    courseId: course.courseId,
    courseCode: course.courseCode,
    courseTitle: course.courseTitle,
    offerings: offerings
      .filter((o) => o.courseId === course.courseId)
      .map((o) => ({
        id: o.id,
        section: o.section,
        instructor: o.instructor
          ? `${o.instructor.user.firstName} ${o.instructor.user.lastName}`.trim()
          : null,
      })),
  }));
}

/**
 * The cohort's carryover load, for a head of department.
 *
 * Sorted by who is worst off, for the same reason the attendance report is: a
 * list read to find students in trouble must not put them on page three.
 */
export async function carryoverCohort(params: {
  schoolId: string;
  programId?: string | null;
  level?: number | null;
}) {
  const db = dbFor(params.schoolId);

  /*
   * A DENY-LIST, and deliberately the opposite of the allow-list this codebase
   * uses for gates.
   *
   * It was `status: ACTIVE`, and that excluded the one student in the demo
   * school who actually had a carryover — because they were on PROBATION,
   * which is usually CAUSED by carryovers. The report existed to find students
   * in trouble and filtered out the ones in the most trouble.
   *
   * A gate defaults to refusing, because admitting somebody wrongly is the
   * harm. A report defaults to including, because missing a struggling student
   * is. Somebody who has left or graduated is the only one with nothing left
   * to retake.
   */
  const students = await db.student.findMany({
    where: {
      status: { notIn: ['WITHDRAWN', 'GRADUATED'] },
      ...(params.programId ? { programId: params.programId } : {}),
      ...(params.level ? { level: params.level } : {}),
    },
    select: {
      id: true,
      matricNumber: true,
      level: true,
      user: { select: { firstName: true, lastName: true } },
      program: { select: { code: true } },
    },
  });

  const rows = [];
  for (const student of students) {
    const report = await carryoverReport({ schoolId: params.schoolId, studentId: student.id });
    if (!report) continue;
    rows.push({
      studentId: student.id,
      name: `${student.user.firstName} ${student.user.lastName}`.trim(),
      matricNumber: student.matricNumber,
      level: student.level,
      programme: student.program?.code ?? null,
      carryovers: report.summary.carryoverCount,
      credits: report.summary.carryoverCredits,
      heavy: report.summary.heavy,
      spillover: report.spillover?.atRisk ?? false,
    });
  }

  return rows.sort(
    (a, b) => b.carryovers - a.carryovers || a.matricNumber.localeCompare(b.matricNumber),
  );
}
