'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { mayAuthorOffering } from '@/server/services/lms.service';
import {
  markSubmission,
  postCourseworkToGradesheet,
} from '@/server/services/coursework.service';

/**
 * Marking, and posting marks to the academic record.
 *
 * Two gates as everywhere else in this feature: the role gate says a person of
 * this kind may mark at all, and `mayAuthorOffering` says this is their course.
 * A lecturer must not be able to mark a colleague's class by editing an id.
 */

export interface MarkFormState {
  ok?: boolean;
  message?: string;
}

const MARK_ROLES = ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'] as const;

async function authorise(offeringId: string) {
  const ctx = await requireTenantRole(...MARK_ROLES);
  assertCan(ctx.role, 'lms:author');

  const allowed = await mayAuthorOffering({
    schoolId: ctx.schoolId,
    offeringId,
    instructorProfileId: ctx.session.pid,
    role: ctx.role,
  });

  return { ctx, allowed };
}

const NOT_YOURS = {
  ok: false,
  message: 'That is not your course. Only its lecturer or the faculty office can mark it.',
} as const;

export async function markSubmissionAction(
  _prev: MarkFormState,
  formData: FormData,
): Promise<MarkFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const courseworkId = String(formData.get('courseworkId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await markSubmission({
    schoolId: ctx.schoolId,
    submissionId: String(formData.get('submissionId') ?? ''),
    score: Number(formData.get('score')),
    feedback: String(formData.get('feedback') ?? '') || null,
    markedByMembershipId: ctx.membershipId,
    actorUserId: ctx.session.sub,
  });

  revalidatePath(`/teaching/${offeringId}/coursework/${courseworkId}`);
  revalidatePath(`/me/courses/${offeringId}`);

  return { ok: result.ok, message: result.message };
}

/**
 * Move marked coursework onto the enrolments as continuous assessment.
 *
 * Its own action, and its own button, on purpose. Marking one essay must not
 * silently republish a whole class's academic record — the two are different
 * decisions taken at different times.
 *
 * Needs `grade:submit`, which is the permission that governs originating a
 * grade. Note that ADMIN deliberately does not hold it: an administrator may
 * override a grade but not create one, and that asymmetry is what keeps the
 * grade ledger worth trusting.
 */
export async function postCourseworkAction(
  _prev: MarkFormState,
  formData: FormData,
): Promise<MarkFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;
  assertCan(ctx.role, 'grade:submit');

  const result = await postCourseworkToGradesheet({
    schoolId: ctx.schoolId,
    offeringId,
    countMissingAsZero: formData.get('countMissingAsZero') !== null,
    overwriteExisting: formData.get('overwriteExisting') !== null,
    actorUserId: ctx.session.sub,
  });

  revalidatePath(`/teaching/${offeringId}`);
  revalidatePath(`/teaching/${offeringId}/coursework`);

  return { ok: result.ok, message: result.message };
}
