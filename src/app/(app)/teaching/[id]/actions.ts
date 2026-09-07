'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';
import { submitGrade } from '@/server/services/gpa.service';
import { ASSESSMENT_WEIGHTS } from '@/lib/domain/grading';
import { recordAudit } from '@/server/services/audit.service';

export interface GradeFormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const gradeRowSchema = z.object({
  enrollmentId: z.string().min(1),
  caScore: z.coerce
    .number()
    .min(0, 'CA cannot be negative')
    .max(ASSESSMENT_WEIGHTS.ca, `CA cannot exceed ${ASSESSMENT_WEIGHTS.ca}`),
  examScore: z.coerce
    .number()
    .min(0, 'Exam cannot be negative')
    .max(ASSESSMENT_WEIGHTS.exam, `Exam cannot exceed ${ASSESSMENT_WEIGHTS.exam}`),
});

/**
 * Save a whole gradesheet in one submission.
 *
 * Rows are validated first, ALL of them, and the batch is rejected if any row
 * fails. Partially applying a gradesheet leaves the instructor unable to tell
 * which rows saved, and re-submitting then double-writes the ones that did.
 * All-or-nothing is the only behaviour that is safe to retry.
 */
export async function saveGradesheetAction(
  _prev: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const session = await requireRole('INSTRUCTOR', 'ADMIN', 'REGISTRAR');
  const offeringId = String(formData.get('offeringId') ?? '');

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: true },
  });
  if (!offering) return { ok: false, message: 'Section not found.' };

  // Ownership: an instructor may only grade their OWN section. Registrars and
  // administrators bypass this by virtue of the grade:override permission.
  if (session.role === 'INSTRUCTOR' && offering.instructorId !== session.pid) {
    return { ok: false, message: 'You are not the instructor of record for this section.' };
  }

  const enrollments = await db.enrollment.findMany({
    where: { offeringId, status: { in: ['REGISTERED', 'COMPLETED'] } },
    select: { id: true },
  });
  const validIds = new Set(enrollments.map((e) => e.id));

  const rows: z.infer<typeof gradeRowSchema>[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const enrollmentId of validIds) {
    const ca = formData.get(`ca_${enrollmentId}`);
    const exam = formData.get(`exam_${enrollmentId}`);

    // Blank rows mean "not yet assessed" and are skipped, not zeroed. Writing
    // a 0 for an unassessed student would post a fail they never sat.
    if (ca === null || exam === null || String(ca).trim() === '' || String(exam).trim() === '') {
      continue;
    }

    const parsed = gradeRowSchema.safeParse({ enrollmentId, caScore: ca, examScore: exam });
    if (!parsed.success) {
      fieldErrors[enrollmentId] = parsed.error.issues[0]?.message ?? 'Invalid score';
      continue;
    }
    rows.push(parsed.data);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: 'Some scores are out of range. Nothing has been saved.',
      fieldErrors,
    };
  }

  if (rows.length === 0) {
    return { ok: false, message: 'No scores were entered.' };
  }

  for (const row of rows) {
    await submitGrade({
      enrollmentId: row.enrollmentId,
      caScore: row.caScore,
      examScore: row.examScore,
      actorId: session.sub,
    });
  }

  revalidatePath(`/teaching/${offeringId}`);
  revalidatePath('/teaching');

  return { ok: true, message: `Saved ${rows.length} grade${rows.length === 1 ? '' : 's'}.` };
}

/**
 * Post grades — the point at which results become visible to students and the
 * section is closed to further routine editing.
 *
 * Refuses to post an incomplete gradesheet. Publishing partial results is worse
 * than publishing none: a student with a blank cannot tell whether they failed,
 * were missed, or are still being marked.
 */
export async function postGradesAction(
  _prev: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const session = await requireRole('INSTRUCTOR', 'ADMIN', 'REGISTRAR');
  const offeringId = String(formData.get('offeringId') ?? '');

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      course: true,
      enrollments: {
        where: { status: { in: ['REGISTERED', 'COMPLETED'] } },
        select: { id: true, gradePoint: true },
      },
    },
  });
  if (!offering) return { ok: false, message: 'Section not found.' };

  if (session.role === 'INSTRUCTOR' && offering.instructorId !== session.pid) {
    return { ok: false, message: 'You are not the instructor of record for this section.' };
  }

  const ungraded = offering.enrollments.filter((e) => e.gradePoint === null).length;
  if (ungraded > 0) {
    return {
      ok: false,
      message: `${ungraded} student${ungraded === 1 ? ' is' : 's are'} still ungraded. Complete the gradesheet before posting.`,
    };
  }

  await db.courseOffering.update({
    where: { id: offeringId },
    data: { gradesPosted: true, status: 'CLOSED' },
  });

  void recordAudit({
    actorId: session.sub,
    action: 'grade.post',
    entityType: 'CourseOffering',
    entityId: offeringId,
    summary: `Grades posted for ${offering.course.code}-${offering.section} (${offering.enrollments.length} students).`,
  });

  revalidatePath(`/teaching/${offeringId}`);
  revalidatePath('/teaching');

  return { ok: true, message: 'Grades posted. Students can now see their results.' };
}
