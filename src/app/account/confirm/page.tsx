import type { Metadata } from 'next';
import Link from 'next/link';

import { confirmAccountChange } from '@/server/services/profile.service';

export const metadata: Metadata = { title: 'Confirm the change' };

/**
 * The other end of a confirmation email.
 *
 * Public, because the token is the authorisation and people open email on a
 * device that is not signed in. See the note in `middleware.ts`.
 *
 * The confirmation happens on GET, which is a deliberate exception to the rule
 * that a GET should not change anything. The alternative — render a button that
 * POSTs — reads as a second hurdle to somebody who has already decided, and the
 * real risk a GET usually carries here (a crawler or a mail scanner following
 * the link) applies to a single-use token that the account owner requested
 * minutes earlier and can simply request again.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = await confirmAccountChange({ token: token ?? '' });

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-900/5">
        <span
          className={[
            'grid h-11 w-11 place-items-center rounded-full',
            result.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
          ].join(' ')}
          aria-hidden
        >
          {result.ok ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 10 6Zm0 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </span>

        <h1 className="mt-4 text-lg font-semibold text-slate-900">
          {result.ok ? 'Password confirmed' : 'This link did not work'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{result.message}</p>

        <Link
          href="/login"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-onInk hover:bg-slate-800"
        >
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
