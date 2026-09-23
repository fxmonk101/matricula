'use server';

import { revalidatePath } from 'next/cache';

import { isAttendanceStatus, type RegisterMark } from '@/lib/domain/attendance';
import { requireTenantRole } from '@/server/tenant-context';
import { saveRegister } from '@/server/services/attendance.service';

/**
 * Saving a register.
 *
 * The two gates are the same pair as everywhere else in `/teaching`: the role
 * says who may mark a register at all, and `saveRegister` re-checks that this
 * particular section belongs to this particular lecturer. The second is not
 * something a role can answer.
 *
 * Note what this file does NOT do: it does not decide whether a cancelled class
 * takes a register, or whether a student is on the roster. Both are re-read and
 * re-checked in the service against the database, because a form is a claim
 * about the world made by whoever posted it.
 */

export interface RegisterFormState {
  ok?: boolean;
  message?: string;
}

const MARK_ROLES = ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'] as const;

export async function saveRegisterAction(
  _previous: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const ctx = await requireTenantRole(...MARK_ROLES);

  const offeringId = String(formData.get('offeringId') ?? '');
  const teachingLogId = String(formData.get('teachingLogId') ?? '');
  if (!offeringId || !teachingLogId) {
    return { ok: false, message: 'That register is missing its session.' };
  }

  /*
   * The form posts one `status.<enrollmentId>` field per student, rather than a
   * JSON blob. A blob would mean parsing user-supplied JSON on the server and
   * would lose the browser's own handling of a partially-submitted form.
   */
  const marks: RegisterMark[] = [];
  const notes: Record<string, string | null> = {};

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('status.')) {
      const enrollmentId = key.slice('status.'.length);
      const status = String(value);
      // Anything unrecognised is dropped HERE and the service is told about the
      // rest; `validateRegister` then rejects the submission rather than saving
      // a partial register that looks complete.
      if (isAttendanceStatus(status)) marks.push({ enrollmentId, status });
      else return { ok: false, message: 'That register contains a mark this system does not use.' };
    } else if (key.startsWith('note.')) {
      const enrollmentId = key.slice('note.'.length);
      const note = String(value).trim();
      if (note) notes[enrollmentId] = note.slice(0, 500);
    }
  }

  if (marks.length === 0) {
    return { ok: false, message: 'That register is empty.' };
  }

  const result = await saveRegister({
    schoolId: ctx.schoolId,
    teachingLogId,
    marks,
    notes,
    actorRole: ctx.role,
    actorMembershipId: ctx.membershipId,
    actorInstructorProfileId: ctx.session.pid,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath(`/teaching/${offeringId}/attendance`);
    revalidatePath(`/teaching/${offeringId}/attendance/${teachingLogId}`);
    // The student's own course page shows their percentage.
    revalidatePath('/me/courses');
  }

  return { ok: result.ok, message: result.message };
}
