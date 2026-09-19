'use server';

import { headers } from 'next/headers';

import {
  completePasswordReset,
  requestPasswordReset,
} from '@/server/services/profile.service';

/**
 * Both actions are PUBLIC: they are reached by somebody who cannot sign in,
 * which is the entire point. Their safety comes from the token, not from a
 * session — see the notes on the service functions.
 */

export interface ResetFormState {
  ok?: boolean;
  message?: string;
  /** Development only: where the message was written, since no mail is sent. */
  localMailPath?: string;
}

/** The absolute origin this request actually arrived on. */
async function originOf(): Promise<string> {
  const head = await headers();
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000';
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function requestResetAction(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const result = await requestPasswordReset({
    identifier: String(formData.get('identifier') ?? ''),
    schoolSlug: String(formData.get('schoolSlug') ?? '') || null,
    origin: await originOf(),
  });

  return { ok: result.ok, message: result.message, localMailPath: result.localMailPath };
}

export async function completeResetAction(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const result = await completePasswordReset({
    token: String(formData.get('token') ?? ''),
    newPassword: String(formData.get('newPassword') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });

  return { ok: result.ok, message: result.message };
}
