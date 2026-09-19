import type { Metadata } from 'next';
import Link from 'next/link';

import { checkResetToken } from '@/server/services/profile.service';
import { Alert } from '@/components/ui';
import { CompleteResetForm, RequestResetForm } from './reset-forms';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * One route, two states.
 *
 * With no token it asks for an email address; with a token it asks for a new
 * password. They are the same page because they are the same errand, and a
 * person who lands on the second with a dead link needs to get to the first
 * without hunting for it.
 *
 * Public — see the note in `middleware.ts`. Somebody resetting a password by
 * definition cannot sign in, and the token is what carries the authority.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; school?: string }>;
}) {
  const { token, school } = await searchParams;

  const check = token ? await checkResetToken({ token }) : null;
  const backTo = school ? `/s/${school}/login` : '/login';

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-900/5">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {token ? 'Choose a new password' : 'Reset your password'}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          {token
            ? 'This link works once, and only for the next hour.'
            : 'We will email you a link. It works once, and only for the next hour.'}
        </p>

        <div className="mt-6">
          {!token ? (
            <RequestResetForm schoolSlug={school ?? null} backTo={backTo} />
          ) : check?.ok ? (
            <CompleteResetForm token={token} firstName={check.firstName} />
          ) : (
            <div className="space-y-4">
              <Alert tone="danger" title="This link is no longer valid">
                It may have expired, or already been used. Ask for a new one — it takes a
                moment.
              </Alert>
              <Link
                href={school ? `/account/reset?school=${school}` : '/account/reset'}
                className="block rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-onInk hover:bg-slate-800"
              >
                Send me another link
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
