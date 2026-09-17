'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantContext, requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import {
  correctSession,
  deleteTeachingLog,
  endBreak,
  logTeaching,
  signIn,
  signOut,
  startBreak,
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

/**
 * A `time` input gives "HH:MM" with no date and no zone, and the person means
 * TODAY at that time, on the device in front of them. Anchoring it to `now`
 * rather than to midnight is what makes a sign-in keyed at 07:50 land on the
 * right day when it is recorded at 08:10.
 *
 * Returns null for an empty field, which means "use the clock".
 */
function declaredInstant(value: string, now: Date): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [h, m] = trimmed.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return new Date(Number.NaN);

  const at = new Date(now);
  at.setHours(h, m, 0, 0);

  /*
   * A time later in the day than the clock, keyed just after midnight, is
   * yesterday evening — somebody signing out at 00:05 for a shift that ended at
   * 23:40. Without this it reads as a time thirteen hours in the future and is
   * refused, on the one night of the week it matters.
   */
  if (at.getTime() - now.getTime() > 12 * 60 * 60_000) {
    at.setDate(at.getDate() - 1);
  }
  return at;
}

export async function signInAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const now = new Date();

  const result = await signIn({
    schoolId,
    membershipId,
    now,
    source: 'SELF',
    actorUserId: session.sub,
    identifierGiven: String(formData.get('identifier') ?? ''),
    unitGiven: String(formData.get('unit') ?? ''),
    declaredAt: declaredInstant(String(formData.get('signedAt') ?? ''), now),
    signature: String(formData.get('signature') ?? '') || null,
    requireSignature: true,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function signOutAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const now = new Date();

  const result = await signOut({
    schoolId,
    membershipId,
    now,
    source: 'SELF',
    actorUserId: session.sub,
    declaredAt: declaredInstant(String(formData.get('signedAt') ?? ''), now),
    signature: String(formData.get('signature') ?? '') || null,
    requireSignature: true,
  });

  refresh();
  return { ok: result.ok, message: result.message, minutes: result.minutes };
}

// -----------------------------------------------------------------------------
// Breaks
// -----------------------------------------------------------------------------

/*
 * Breaks take no attestation. The person has already signed the register to get
 * into the building, and making them re-sign to go for lunch would mean nobody
 * ever records a break — leaving the institution with gross hours it believes
 * are net, which is the exact failure this whole feature exists to avoid.
 */

export async function startBreakAction(
  _prev: PresenceFormState,
  formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const result = await startBreak({
    schoolId,
    membershipId,
    kind: String(formData.get('kind') ?? ''),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function endBreakAction(
  _prev: PresenceFormState,
  _formData: FormData,
): Promise<PresenceFormState> {
  const { schoolId, membershipId, session } = await requireTenantContext();
  const result = await endBreak({ schoolId, membershipId, actorUserId: session.sub });
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
    signature: String(formData.get('signature') ?? '') || null,
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
