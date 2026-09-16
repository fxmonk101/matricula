'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantContext, requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import {
  correctSession,
  deleteTeachingLog,
  logTeaching,
  signIn,
  signOut,
} from '@/server/services/presence.service';

/**
 * Signing in and out is available to EVERY member of the school, which is why
 * these two actions use `requireTenantContext` rather than a role list — a
 * person signs themselves in, and no role grants or withholds the ability to
 * be present in a building.
 *
 * Correcting somebody ELSE's session is a different matter and needs the
 * `attendance:record` grant, which the office holds.
 */

export interface PresenceFormState {
  ok?: boolean;
  message?: string;
  minutes?: number;
}

function refresh() {
  revalidatePath('/presence');
  revalidatePath('/presence/teaching');
  revalidatePath('/dashboard');
}

export async function signInAction(): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const result = await signIn({
    schoolId,
    membershipId,
    source: 'SELF',
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function signOutAction(): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const result = await signOut({
    schoolId,
    membershipId,
    source: 'SELF',
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message, minutes: result.minutes };
}

// -----------------------------------------------------------------------------
// The office
// -----------------------------------------------------------------------------

export async function correctSessionAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, role, membershipId, session } = await requireTenantRole(
    'ADMIN',
    'REGISTRAR',
    'HOD',
    'DEAN',
  );
  assertCan(role, 'attendance:record');

  const started = String(formData.get('startedAt') ?? '').trim();
  const ended = String(formData.get('endedAt') ?? '').trim();

  const result = await correctSession({
    schoolId,
    sessionId: String(formData.get('sessionId') ?? ''),
    // A `datetime-local` value carries no zone, so it is read as the server's
    // local time — which is what the office typing it means by it.
    startedAt: started ? new Date(started) : null,
    endedAt: ended ? new Date(ended) : null,
    reason: String(formData.get('reason') ?? ''),
    correctedByMembershipId: membershipId,
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

// -----------------------------------------------------------------------------
// The teaching log
// -----------------------------------------------------------------------------

function minuteOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export async function logTeachingAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  // A head of department lectures too, and a dean may cover. Every role that
  // can stand in front of a class can record having done so.
  const { schoolId, role, membershipId, session } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  assertCan(role, 'attendance:record');

  const attended = String(formData.get('attended') ?? '').trim();

  const result = await logTeaching({
    schoolId,
    membershipId,
    logId: String(formData.get('logId') ?? '') || null,
    offeringId: String(formData.get('offeringId') ?? '') || null,
    draft: {
      localDate: String(formData.get('localDate') ?? ''),
      startMinute: minuteOf(String(formData.get('startTime') ?? '')),
      endMinute: minuteOf(String(formData.get('endTime') ?? '')),
      status: String(formData.get('status') ?? 'DELIVERED'),
      topic: String(formData.get('topic') ?? '') || null,
      attended: attended === '' ? null : Number(attended),
    },
    note: String(formData.get('note') ?? '') || null,
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function deleteTeachingLogAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, role, session } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  assertCan(role, 'attendance:record');

  const result = await deleteTeachingLog({
    schoolId,
    logId: String(formData.get('logId') ?? ''),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}
