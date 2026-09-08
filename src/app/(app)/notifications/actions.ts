'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantContext } from '@/server/tenant-context';
import { markRead } from '@/server/services/notification.service';

/**
 * Mark this person's notifications read.
 *
 * The membership comes from the SESSION, never from the form. A notification id
 * submitted by a caller is only ever used to narrow their own set — the
 * service scopes every update by `membershipId` as well, so a crafted id
 * belonging to someone else matches nothing rather than marking their bell.
 */
export async function markAllReadAction(): Promise<void> {
  const { schoolId, membershipId } = await requireTenantContext();
  await markRead(schoolId, membershipId);
  revalidatePath('/', 'layout');
}

export async function markOneReadAction(formData: FormData): Promise<void> {
  const { schoolId, membershipId } = await requireTenantContext();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await markRead(schoolId, membershipId, [id]);
  revalidatePath('/notifications');
}
