'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { generateClassReportCards, saveSubjectMarks, type MarkRow } from '@/server/k12-reports';

export interface K12FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Save a subject mark sheet for a whole form class.
 *
 * The row set is taken from the DATABASE, not from the submitted form. A form
 * can be edited before it is posted; the enrolment list cannot. Reading the
 * roster server-side means a crafted submission can neither mark a pupil who is
 * not in the class nor silently drop one who is.
 */
export async function saveMarksAction(
  _prev: K12FormState,
  formData: FormData,
): Promise<K12FormState> {
  const { db, schoolId, session, config } = await requireTenantRole(
    'INSTRUCTOR',
    'ADMIN',
    'REGISTRAR',
  );

  const assignmentId = String(formData.get('assignmentId') ?? '');
  const assignment = await db.subjectAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, formClassId: true, termId: true, teacherId: true },
  });
  if (!assignment) return { ok: false, message: 'Subject assignment not found.' };

  // A teacher marks their own subject. A registrar or administrator may mark
  // any of them — the same override split the university gradesheet uses.
  if (session.role === 'INSTRUCTOR' && assignment.teacherId !== session.pid) {
    return { ok: false, message: 'You are not the subject teacher for this class.' };
  }

  const enrolments = await db.classEnrolment.findMany({
    where: { formClassId: assignment.formClassId, termId: assignment.termId },
    select: { studentId: true },
  });

  const { ca, exam } = config.grading.assessmentWeights;
  const fieldErrors: Record<string, string> = {};
  const rows: MarkRow[] = [];

  for (const { studentId } of enrolments) {
    const rawCa = String(formData.get(`ca_${studentId}`) ?? '').trim();
    const rawExam = String(formData.get(`exam_${studentId}`) ?? '').trim();
    const remark = String(formData.get(`remark_${studentId}`) ?? '').trim() || null;

    // Both blank means "not assessed" and is written back as null, not zero —
    // a pupil who missed the paper has not scored nothing, they have no score.
    if (rawCa === '' && rawExam === '') {
      rows.push({ studentId, caScore: null, examScore: null, remark });
      continue;
    }
    if (rawCa === '' || rawExam === '') {
      fieldErrors[studentId] = 'Enter both marks, or leave both blank.';
      continue;
    }

    const caScore = Number(rawCa);
    const examScore = Number(rawExam);
    if (!Number.isFinite(caScore) || caScore < 0 || caScore > ca) {
      fieldErrors[studentId] = `Continuous assessment must be between 0 and ${ca}.`;
      continue;
    }
    if (!Number.isFinite(examScore) || examScore < 0 || examScore > exam) {
      fieldErrors[studentId] = `Examination must be between 0 and ${exam}.`;
      continue;
    }
    rows.push({ studentId, caScore, examScore, remark });
  }

  // All-or-nothing. A partially applied sheet is not safe to resubmit: the
  // teacher cannot tell which rows landed, and resending double-writes them.
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: 'Some marks are out of range. Nothing has been saved.',
      fieldErrors,
    };
  }

  const result = await saveSubjectMarks({
    schoolId,
    assignmentId,
    rows,
    actorId: session.sub,
  });

  revalidatePath(`/classes/${assignment.formClassId}`);
  return { ok: result.ok, message: result.message };
}

/**
 * Generate — or generate and publish — a class's report cards.
 *
 * Publishing is a separate act from generating because the two have different
 * consequences: a draft is a document the office can still correct, a published
 * card is one a guardian holds.
 */
export async function generateReportsAction(
  _prev: K12FormState,
  formData: FormData,
): Promise<K12FormState> {
  const { db, schoolId, school, session } = await requireTenantRole('ADMIN', 'REGISTRAR');

  const formClassId = String(formData.get('formClassId') ?? '');
  const publish = formData.get('publish') === 'true';

  const term = await db.term.findFirst({ where: { isCurrent: true } });
  if (!term) return { ok: false, message: 'No term is currently active.' };

  const result = await generateClassReportCards({
    schoolId,
    // `code`, not `slug` — the reference number series is keyed on it, and a
    // generation run that used the slug would restart the numbering.
    schoolCode: school.code,
    formClassId,
    termId: term.id,
    actorId: session.sub,
    publish,
  });

  revalidatePath(`/classes/${formClassId}`);
  revalidatePath('/reports');

  return {
    ok: result.ok,
    message: result.ok
      ? `${result.message} ${result.promoted} promoted, ${result.repeating} repeating, ${result.underReview} referred for review.`
      : result.message,
  };
}
