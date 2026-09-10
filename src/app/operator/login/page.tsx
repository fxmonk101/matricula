import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LogoMark } from '@/components/logo';
import { getOperatorSession } from '@/lib/auth/operator';
import { OperatorLoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Operator console',
  // The vendor's own door should not be indexed, listed or previewed.
  robots: { index: false, follow: false },
};

/**
 * The vendor's entrance.
 *
 * Visually the opposite of a school's door on purpose. A school's login is
 * light, carries its crest and its colour, and welcomes students; this is dark,
 * carries the platform's mark, and says who it is for. Somebody who has landed
 * here by mistake should be able to tell in under a second — and a member of
 * staff who is used to this screen should never confuse it with a customer's.
 *
 * It offers no way to reach any school. There is no institution list, no
 * "forgot password", and no link to the public site — the fewer affordances on
 * the highest-privilege door in the system, the better.
 */
export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  // Already signed in? Go straight through. Re-presenting the form to somebody
  // holding a valid session is the small confusion that makes people type
  // their password into a page they did not need to.
  if (await getOperatorSession()) redirect('/operator');

  const { reason } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark className="h-10 w-10 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-onInk">Operator console</p>
            <p className="text-[11px] text-slate-400">Platform administration</p>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/20">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            For platform staff only. This is not the sign-in page for a university — those have
            their own addresses.
          </p>

          {reason === 'revoked' ? (
            <div className="mt-4 rounded-lg bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
              <p className="font-semibold">Your access has been withdrawn</p>
              <p className="mt-0.5">
                Your session was valid, but the platform grant behind it is no longer in place.
              </p>
            </div>
          ) : null}

          <div className="mt-5">
            <OperatorLoginForm />
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Every action taken in this console is attributed and logged across every institution it
          touches.
        </p>
      </div>
    </div>
  );
}
