import 'server-only';

import { dbFor } from '@/lib/tenant';
import { computeTotalScore, scoreToGrade } from '@/lib/domain/grading';
import { loadSchoolConfig } from '@/server/school-config';
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
 * Record a mark against one enrolment. Score -> total -> letter -> point.
 *
 * THIS NO LONGER MAKES THE MARK PART OF THE ACADEMIC RECORD, and that is the
 * most consequential line in this file.
 *
 * It used to set `status: COMPLETED` and recompute the CGPA in the same
 * request — so a lecturer typing a score published a degree classification,
 * and a typo in week six was on a transcript before anybody had looked at it.
 * The enrolment now stays REGISTERED and carries the numbers; it becomes
 * COMPLETED only in `releaseResults`, at the end of the approval chain.
 *
 * WHY HERE RATHER THAN IN THE TRANSCRIPT. Gating the transcript on the
 * approval stage would have left the CGPA, the academic standing and the
 * graduation audit all quietly counting unapproved marks, because every one
 * of those reads the ENROLMENT and not the sheet. There is one status, and it
 * is what "released" means.
 *
 * The aggregates are still recomputed, for the case that matters: a mark
 * CORRECTED after release, where the enrolment is already COMPLETED and the
 * CGPA must follow the correction.
 */
export async function submitGrade(params: {
  schoolId: string;
  enrollmentId: string;
  caScore: number;
  examScore: number;
  actorId: string;
}): Promise<{ ok: boolean; message: string }> {
  const db = dbFor(params.schoolId);
  // Both the assessment caps and the band boundaries are this school's.
  const { grading } = await loadSchoolConfig(params.schoolId);
  const total = computeTotalScore(params.caScore, params.examScore, grading.assessmentWeights);
  const band = scoreToGrade(total, grading.scale);

  const enrollment = await db.enrollment.update({
    where: { id: params.enrollmentId },
    data: {
      caScore: params.caScore,
      examScore: params.examScore,
      totalScore: total,
      letterGrade: band.letter,
      gradePoint: band.point,
      gradedAt: new Date(),
      /*
       * `status` is deliberately ABSENT. Setting it here is what used to make
       * a typed mark a published result. `releaseResults` sets it, once the
       * approval chain is done.
       */
    },
    include: { offering: { include: { course: true } } },
  });

  await recomputeStudentAcademics(params.schoolId, enrollment.studentId);

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorId,
    action: 'grade.submit',
    entityType: 'Enrollment',
    entityId: params.enrollmentId,
    summary: `${enrollment.offering.course.code}: CA ${params.caScore} + Exam ${params.examScore} = ${total} (${band.letter}).`,
    metadata: { caScore: params.caScore, examScore: params.examScore, total, letter: band.letter },
  });

  return { ok: true, message: `Mark recorded: ${band.letter} (${total.toFixed(1)}).` };
}

