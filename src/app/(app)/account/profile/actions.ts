'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requireTenantContext } from '@/server/tenant-context';
import {
  cancelPendingChange,
  removeAvatar,
  requestPasswordChange,
  saveAvatar,
  saveProfile,
} from '@/server/services/profile.service';

/**
 * Every action here acts on the CALLER's own account.
 *
 * None of them takes a user id. The id comes from the session and nowhere else,
 * so there is no parameter to tamper with and no way to reach another person's
 * profile through this file at all — which is why these need no role check
 * beyond "is signed in". Editing somebody ELSE's account is a different thing
 * living under /people, behind the office's permissions.
 */

export interface ProfileFormState {
  ok?: boolean;
  message?: string;
  pending?: boolean;
  localMailPath?: string;
}

function refresh() {
  revalidatePath('/account/profile');
  // The shell renders the person's name and picture on every page.
  revalidatePath('/', 'layout');
}

export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { session } = await requireTenantContext();

  const result = await saveProfile({
    userId: session.sub,
    draft: {
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      username: String(formData.get('username') ?? ''),
      phone: String(formData.get('phone') ?? ''),
    },
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function saveAvatarAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { session } = await requireTenantContext();

  const file = formData.get('avatar');
  if (!(file instanceof File)) {
    return { ok: false, message: 'Choose a picture first.' };
  }

  const result = await saveAvatar({ userId: session.sub, file });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function removeAvatarAction(
  _prev: ProfileFormState,
  _formData: FormData,
): Promise<ProfileFormState> {
  const { session } = await requireTenantContext();
  const result = await removeAvatar(session.sub);
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function changePasswordAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const { session } = await requireTenantContext();

  /*
   * The confirmation link has to be absolute, and its host must be the one the
   * person is actually using — a school on its own domain would otherwise be
   * emailed a link to somebody else's. Taken from the request headers rather
   * than from configuration so it is right without per-deployment setup.
   */
  const head = await headers();
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000';
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  const result = await requestPasswordChange({
    userId: session.sub,
    origin: `${proto}://${host}`,
    draft: {
      currentPassword: String(formData.get('currentPassword') ?? ''),
      newPassword: String(formData.get('newPassword') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    },
  });

  refresh();
  return {
    ok: result.ok,
    message: result.message,
    pending: result.pending,
    localMailPath: result.localMailPath,
  };
}

export async function cancelPendingChangeAction(
  _prev: ProfileFormState,
  _formData: FormData,
): Promise<ProfileFormState> {
  const { session } = await requireTenantContext();
  const result = await cancelPendingChange(session.sub);
  refresh();
  return { ok: result.ok, message: result.message };
}
