'use server';

import { revalidatePath } from 'next/cache';

import { assertCan } from '@/lib/auth/rbac';
import {
  ADDRESSABLE_ROLES,
  isSeverity,
  type AnnouncementSeverity,
} from '@/lib/domain/announcement';
import type { Role } from '@/lib/domain/enums';
import { requireTenantRole } from '@/server/tenant-context';
import {
  postAnnouncement,
  withdrawAnnouncement,
} from '@/server/services/announcement.service';

/**
 * Posting a school-wide notice.
 *
 * This is the loudest action in the product — it fills a bell AND sends email
 * to everybody it names — so the audience is read from what was actually
 * ticked rather than defaulted, and an unrecognised role is dropped rather
 * than widening the reach.
 */

export interface AnnouncementFormState {
  ok?: boolean;
  message?: string;
  reached?: number;
}

const POST_ROLES = ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN'] as const;

export async function postAnnouncementAction(
  _previous: AnnouncementFormState,
  formData: FormData,
): Promise<AnnouncementFormState> {
  const ctx = await requireTenantRole(...POST_ROLES);
  assertCan(ctx.role, 'announcement:write');

  const severity = String(formData.get('severity') ?? 'INFO');

  /*
   * Only roles this system actually has. An unknown value is DROPPED rather
   * than kept: keeping it would store an audience naming a role nobody holds,
   * and the safe reading of that is "nobody", which is not what was meant.
   */
  const audience = formData
    .getAll('audience')
    .map(String)
    .filter((value): value is Role => (ADDRESSABLE_ROLES as readonly string[]).includes(value));

  const rawExpiry = String(formData.get('expiresAt') ?? '').trim();
  const expiresAt = rawExpiry ? new Date(rawExpiry) : null;

  const result = await postAnnouncement({
    schoolId: ctx.schoolId,
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    severity: (isSeverity(severity) ? severity : 'INFO') as AnnouncementSeverity,
    audience,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    actorMembershipId: ctx.membershipId,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath('/announcements');
    revalidatePath('/dashboard');
    revalidatePath('/me');
  }

  return { ok: result.ok, message: result.message, reached: result.reached };
}

export async function withdrawAnnouncementAction(
  _previous: AnnouncementFormState,
  formData: FormData,
): Promise<AnnouncementFormState> {
  const ctx = await requireTenantRole(...POST_ROLES);
  assertCan(ctx.role, 'announcement:write');

  const result = await withdrawAnnouncement({
    schoolId: ctx.schoolId,
    announcementId: String(formData.get('announcementId') ?? ''),
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath('/announcements');
    revalidatePath('/dashboard');
  }

  return { ok: result.ok, message: result.message };
}
