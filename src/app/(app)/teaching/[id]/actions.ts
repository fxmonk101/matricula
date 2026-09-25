'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantRole } from '@/server/tenant-context';
import { submitGrade } from '@/server/services/gpa.service';
import { submitResults } from '@/server/services/result-workflow.service';
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
  const { db, schoolId, session } = await requireTenantRole('INSTRUCTOR', 'ADMIN', 'REGISTRAR');
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
      schoolId,
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
 * Submit the marks for approval.
 *
 * This used to be "post grades", and it used to be the whole story: it set a
 * flag, closed the section, and the marks — already COMPLETED by the
 * gradesheet save — were on students’ transcripts.
 *
 * It now starts the approval chain. The lecturer says the marking is done;
 * the head of department, the faculty board and Senate each have to agree
 * before anything reaches a student. A school that convenes none of those
 * releases on submission, which is what it has configured.
 */
export async function submitResultsAction(
  _prev: GradeFormState,
  formData: FormData,
): Promise<GradeFormState> {
  const ctx = await requireTenantRole('INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR');
  const offeringId = String(formData.get('offeringId') ?? '');

  const result = await submitResults({
    schoolId: ctx.schoolId,
    offeringId,
    policy: ctx.config.resultWorkflow,
    actor: {
      role: ctx.role,
      membershipId: ctx.membershipId,
      userId: ctx.session.sub,
      instructorProfileId: ctx.session.pid,
    },
  });

  if (result.ok) {
    revalidatePath(`/teaching/${offeringId}`);
    revalidatePath('/teaching');
    revalidatePath('/results');
    revalidatePath('/me');
  }

  return { ok: result.ok, message: result.message };
}
