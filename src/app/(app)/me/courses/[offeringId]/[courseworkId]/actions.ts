'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { enrolmentFor } from '@/server/services/lms.service';
import {
  loadCourseworkForStudent,
  submitCoursework,
} from '@/server/services/coursework.service';

/**
 * A student hands work in.
 *
 * THREE CHECKS, and none of them is redundant:
 *
 *   · the role gate says a STUDENT is doing this;
 *   · `loadCourseworkForStudent` returns null for anything unpublished, so work
 *     cannot be submitted against a draft somebody guessed the id of;
 *   · `enrolmentFor` says this student is on THIS course — the only one of the
 *     three that is about a record rather than a type of person, and the only
 *     one that stops a student submitting to a course they are not taking.
 */

export interface SubmitFormState {
  ok?: boolean;
  message?: string;
  attempt?: number;
}

export async function submitCourseworkAction(
  _prev: SubmitFormState,
  formData: FormData,
): Promise<SubmitFormState> {
  const { schoolId, role, session } = await requireTenantRole('STUDENT');
  assertCan(role, 'lms:read');

  const courseworkId = String(formData.get('courseworkId') ?? '');
  const offeringId = String(formData.get('offeringId') ?? '');

  if (!session.pid) {
    return { ok: false, message: 'This account has no student record, so it cannot submit work.' };
  }

  const coursework = await loadCourseworkForStudent({ schoolId, courseworkId });
  if (!coursework) return { ok: false, message: 'That assignment is not open.' };

  // The coursework knows which offering it belongs to; the form's value is not
  // trusted for anything but the redirect path.
  const owningOfferingId = coursework.moduleItem.module.space.offeringId;
  if (!owningOfferingId) {
    return { ok: false, message: 'That assignment is not attached to a course.' };
  }

  const enrolment = await enrolmentFor({
    schoolId,
    offeringId: owningOfferingId,
    studentProfileId: session.pid,
  });
  if (!enrolment) return { ok: false, message: 'You are not registered on this course.' };

  const file = formData.get('file');

  const result = await submitCoursework({
    schoolId,
    courseworkId,
    enrollmentId: enrolment.id,
    textBody: String(formData.get('textBody') ?? '') || null,
    file: file instanceof File ? file : null,
    actorUserId: session.sub,
  });

  revalidatePath(`/me/courses/${offeringId}/${courseworkId}`);
  revalidatePath(`/me/courses/${owningOfferingId}`);

  return { ok: result.ok, message: result.message, attempt: result.attempt };
}
