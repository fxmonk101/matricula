import 'server-only';

import { db } from '@/lib/db';
import { computeTotalScore, scoreToGrade } from '@/lib/domain/grading';
import { recomputeStudentAcademics, buildTranscript } from '@/server/academics';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * GRADE SUBMISSION
 * =============================================================================
 *
 * The recomputation engine itself lives in `@/server/academics`, deliberately
 * WITHOUT the `server-only` guard: the seed script and any future CLI
 * maintenance job need to run it outside a Next.js render, and `server-only`
 * throws when resolved by plain Node. This module keeps the guard, because
 * grade submission is only ever reached through a server action.
 */
export { recomputeStudentAcademics, buildTranscript };

/**
 * Grade a single enrollment. Score -> total -> letter -> point, then the
 * student's aggregates are recomputed.
 *
 * The full CGPA is recomputed rather than incrementally adjusted. An
 * incremental update is O(1) instead of O(n), but it makes the stored CGPA a
 * running total that can drift permanently from the underlying records — and
 * once it drifts there is no way to tell which of the two is wrong. A student
 * has on the order of 40 graded enrollments; a full recompute is a few
 * milliseconds and is always correct by construction.
 */
export async function submitGrade(params: {
  enrollmentId: string;
  caScore: number;
  examScore: number;
  actorId: string;
}): Promise<{ ok: boolean; message: string }> {
  const total = computeTotalScore(params.caScore, params.examScore);
  const band = scoreToGrade(total);

  const enrollment = await db.enrollment.update({
    where: { id: params.enrollmentId },
    data: {
      caScore: params.caScore,
      examScore: params.examScore,
      totalScore: total,
      letterGrade: band.letter,
      gradePoint: band.point,
      status: 'COMPLETED',
      gradedAt: new Date(),
    },
    include: { offering: { include: { course: true } } },
  });

  await recomputeStudentAcademics(enrollment.studentId);

  void recordAudit({
    actorId: params.actorId,
    action: 'grade.submit',
    entityType: 'Enrollment',
    entityId: params.enrollmentId,
    summary: `${enrollment.offering.course.code}: CA ${params.caScore} + Exam ${params.examScore} = ${total} (${band.letter}).`,
    metadata: { caScore: params.caScore, examScore: params.examScore, total, letter: band.letter },
  });

  return { ok: true, message: `Grade recorded: ${band.letter} (${total.toFixed(1)}).` };
}

