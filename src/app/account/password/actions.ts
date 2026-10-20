'use server';

import { redirect } from 'next/navigation';

import { requireSession, createSession } from '@/lib/auth/session';
import { platformDb } from '@/lib/tenant';
import { changeOwnPassword } from '@/server/services/people.service';
import { ROLE_HOME } from '@/lib/domain/enums';
import { MIN_PASSWORD_LENGTH } from '@/lib/domain/people';

export interface PasswordFormState {
  ok?: boolean;
  message?: string;
}

export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const session = await requireSession();

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (next !== confirm) {
    return { ok: false, message: 'The two new passwords do not match.' };
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const result = await changeOwnPassword({
    userId: session.sub,
    currentPassword: current,
    newPassword: next,
    schoolId: session.sch,
  });
  if (!result.ok) return result;

  /*
   * RE-ISSUE THE SESSION.
   *
   * The `mcp` claim is what middleware reads, and it lives in a token signed
   * eight hours ago. Without minting a new one the user would change their
   * password successfully and then be redirected straight back to this page by
   * their own stale claim — a loop with no way out, which is the same shape of
   * bug that produced ERR_TOO_MANY_REDIRECTS here before.
   *
   * Every other claim is carried across unchanged. Re-deriving them would mean
   * re-running the whole sign-in lookup for a change that touches one field.
   */
  try {
    await createSession({
      sub: session.sub,
      email: session.email,
      name: session.name,
      sch: session.sch,
      mbr: session.mbr,
      role: session.role,
      slug: session.slug,
      pid: session.pid,
      pa: session.pa,
      // Deliberately absent rather than `false`: the claim is gone, not falsified.
    });
  } catch {
    return { ok: false, message: 'This sign-in is not configured correctly. Please contact support.' };
  }

  redirect(ROLE_HOME[session.role]);
}

/**
 * Whether this visit is a forced change or a voluntary one.
 *
 * Read from the DATABASE rather than the claim, because the page is also
 * reachable voluntarily from a settings link and the two cases say different
 * things to the user — one of them cannot be escaped, and saying so is the
 * difference between a clear instruction and an unexplained trap.
 */
export async function isForcedChange(): Promise<boolean> {
  const session = await requireSession();
  const user = await platformDb.user.findUnique({
    where: { id: session.sub },
    select: { mustChangePassword: true },
  });
  return user?.mustChangePassword ?? false;
}
