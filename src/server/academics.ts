/**
 * =============================================================================
 * ACADEMIC RECOMPUTATION ENGINE
 * =============================================================================
 *
 * No `server-only` guard here, deliberately. This module is imported both by
 * server actions (via gpa.service) and by plain Node scripts — the seed, and
 * any future maintenance job that needs to rebuild GPAs after a policy change.
 * `server-only` throws when resolved outside a React Server Component graph,
 * which would make those scripts impossible to write without duplicating the
 * logic. Duplicated GPA logic is a far worse outcome than a missing guard.
 */

import { db } from '@/lib/db';
import {
  computeGpa,
  determineAcademicStanding,
  type GradedAttempt,
} from '@/lib/domain/grading';

/**
 * Recompute every derived academic figure for one student:
 * per-term GPA snapshots, CGPA, credits, academic standing, and the
 * `isRepeatSuperseded` flags that implement the best-attempt repeat policy.
 *
 * Terms are processed in chronological order because standing depends on the
 * CGPA *as at the end of that term* and on the run of prior probation terms —
 * neither of which can be computed out of order.
 *
 * Complexity: O(n log n) for ordering, O(n · t) for the running CGPA where t is
 * the number of terms. With n ≈ 40 and t ≈ 8 this is negligible.
 */
export async function recomputeStudentAcademics(studentId: string): Promise<void> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true },
  });
  if (!student) return;

  const enrollments = await db.enrollment.findMany({
    where: { studentId, status: { in: ['COMPLETED', 'WITHDRAWN'] } },
    include: {
      offering: {
        include: { course: true, term: { select: { id: true, startDate: true, code: true } } },
      },
    },
  });

  // Chronological order by term start; `termSequence` is the tie-break key the
  // repeat policy uses to prefer the later attempt.
  const termOrder = [...new Set(enrollments.map((e) => e.offering.termId))]
    .map((termId) => {
      const sample = enrollments.find((e) => e.offering.termId === termId)!;
      return { termId, startDate: sample.offering.term.startDate };
    })
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const sequenceOfTerm = new Map(termOrder.map((t, i) => [t.termId, i + 1]));

  const attempts: (GradedAttempt & { termId: string })[] = enrollments.map((e) => ({
    enrollmentId: e.id,
    courseId: e.offering.courseId,
    courseCode: e.offering.course.code,
    courseTitle: e.offering.course.title,
    creditHours: e.offering.course.creditHours,
    gradePoint: e.gradePoint,
    letterGrade: e.letterGrade,
    totalScore: e.totalScore,
    termSequence: sequenceOfTerm.get(e.offering.termId) ?? 0,
    termId: e.offering.termId,
  }));

  // --- Repeat policy: mark superseded attempts --------------------------------
  const cumulative = computeGpa(attempts, true);
  const supersededSet = new Set(cumulative.supersededEnrollmentIds);

  await db.enrollment.updateMany({
    where: { studentId },
    data: { isRepeatSuperseded: false },
  });
  if (supersededSet.size > 0) {
    await db.enrollment.updateMany({
      where: { id: { in: [...supersededSet] } },
      data: { isRepeatSuperseded: true },
    });
  }

  // --- Per-term snapshots with a running CGPA --------------------------------
  let consecutiveProbationTerms = 0;
  let latestStanding = 'GOOD';
  let latestCgpa = 0;

  for (const [index, term] of termOrder.entries()) {
    const termAttempts = attempts.filter((a) => a.termId === term.termId);
    // Term GPA counts every attempt in the term as recorded — no repeat policy.
    const termResult = computeGpa(termAttempts, false);

    // Running CGPA: every attempt up to and including this term, with the
    // repeat policy applied across the whole window.
    const throughThisTerm = attempts.filter(
      (a) => (sequenceOfTerm.get(a.termId) ?? 0) <= index + 1,
    );
    const cumulativeResult = computeGpa(throughThisTerm, true);

    const standing = determineAcademicStanding({
      cumulativeGpa: cumulativeResult.gpa,
      termGpa: termResult.gpa,
      creditsAttemptedThisTerm: termResult.creditsAttempted,
      consecutiveProbationTerms,
      isFirstTerm: index === 0,
    });

    consecutiveProbationTerms =
      standing.standing === 'PROBATION' ? consecutiveProbationTerms + 1 : 0;
    latestStanding = standing.standing;
    latestCgpa = cumulativeResult.gpa;

    await db.termGpa.upsert({
      where: { studentId_termId: { studentId, termId: term.termId } },
      create: {
        studentId,
        termId: term.termId,
        creditsAttempted: termResult.creditsAttempted,
        creditsEarned: termResult.creditsEarned,
        qualityPoints: termResult.qualityPoints,
        gpa: termResult.gpa,
        cumulativeGpa: cumulativeResult.gpa,
        academicStanding: standing.standing,
      },
      update: {
        creditsAttempted: termResult.creditsAttempted,
        creditsEarned: termResult.creditsEarned,
        qualityPoints: termResult.qualityPoints,
        gpa: termResult.gpa,
        cumulativeGpa: cumulativeResult.gpa,
        academicStanding: standing.standing,
        computedAt: new Date(),
      },
    });
  }

  // --- Update the cached aggregates on the student ---------------------------
  // DISMISSED is never applied automatically; it is written to the term
  // snapshot for the registrar to action, but the live record is held at
  // PROBATION so a floating-point comparison cannot expel anyone unattended.
  const appliedStanding = latestStanding === 'DISMISSED' ? 'PROBATION' : latestStanding;

  await db.student.update({
    where: { id: studentId },
    data: {
      cgpa: latestCgpa,
      creditsEarned: cumulative.creditsEarned,
      creditsAttempted: cumulative.creditsAttempted,
      academicStanding: appliedStanding,
      status: appliedStanding === 'PROBATION' ? 'PROBATION' : 'ACTIVE',
    },
  });
}

/** Full transcript view: every attempt, grouped by term, in academic order. */
export async function buildTranscript(studentId: string) {
  const student = await db.student.findUnique({
    where: { id: studentId },
    include: {
      user: true,
      program: { include: { department: { include: { faculty: true } } } },
      termGpas: { include: { term: true }, orderBy: { term: { startDate: 'asc' } } },
    },
  });

  if (!student) return null;

  const enrollments = await db.enrollment.findMany({
    where: { studentId, status: { in: ['COMPLETED', 'WITHDRAWN'] } },
    include: {
      offering: { include: { course: true, term: true } },
    },
    orderBy: [{ offering: { term: { startDate: 'asc' } } }, { offering: { course: { code: 'asc' } } }],
  });

  const byTerm = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = byTerm.get(e.offering.termId) ?? [];
    list.push(e);
    byTerm.set(e.offering.termId, list);
  }

  return {
    student,
    terms: student.termGpas.map((tg) => ({
      term: tg.term,
      summary: tg,
      rows: byTerm.get(tg.termId) ?? [],
    })),
  };
}
