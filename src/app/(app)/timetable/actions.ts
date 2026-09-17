'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import {
  assignLecturer,
  removeSlot,
  saveSlot,
} from '@/server/services/timetable.service';

/**
 * Scheduling is the Dean's, and `timetable:write` says so. A head of department
 * can assign teaching within their department (`offering:assign`) without being
 * able to move the faculty's timetable around them.
 */

export interface TimetableFormState {
  ok?: boolean;
  message?: string;
  clashes?: string[];
}

function minuteOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function refresh() {
  revalidatePath('/timetable');
  revalidatePath('/offerings');
  revalidatePath('/teaching');
}

export async function saveSlotAction(
  _prev: TimetableFormState,
  formData: FormData,
): Promise<TimetableFormState> {
  const { schoolId, role, session } = await requireTenantRole(
    'ADMIN',
    'REGISTRAR',
    'DEAN',
  );
  assertCan(role, 'timetable:write');

  const result = await saveSlot({
    schoolId,
    meetingId: String(formData.get('meetingId') ?? '') || null,
    offeringId: String(formData.get('offeringId') ?? ''),
    draft: {
      dayOfWeek: Number(formData.get('dayOfWeek') ?? 1),
      startMinute: minuteOf(String(formData.get('startTime') ?? '')),
      endMinute: minuteOf(String(formData.get('endTime') ?? '')),
      room: String(formData.get('room') ?? '') || null,
    },
    // A dean who has read the clashes may schedule anyway — a timetable is
    // built under constraints the software cannot see. What it must never do
    // is let one pass unseen.
    overrideClashes: formData.get('override') === 'true',
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message, clashes: result.clashes };
}

export async function removeSlotAction(
  _prev: TimetableFormState,
  formData: FormData,
): Promise<TimetableFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR', 'DEAN');
  assertCan(role, 'timetable:write');

  const result = await removeSlot({
    schoolId,
    meetingId: String(formData.get('meetingId') ?? ''),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function assignLecturerAction(
  _prev: TimetableFormState,
  formData: FormData,
): Promise<TimetableFormState> {
  // A head of department assigns teaching within their department, which is
  // why HOD is admitted here and not to the scheduling actions above.
  const { schoolId, role, session } = await requireTenantRole(
    'ADMIN',
    'REGISTRAR',
    'DEAN',
    'HOD',
  );
  assertCan(role, 'offering:assign');

  const result = await assignLecturer({
    schoolId,
    offeringId: String(formData.get('offeringId') ?? ''),
    instructorId: String(formData.get('instructorId') ?? '') || null,
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message, clashes: result.clashes };
}
