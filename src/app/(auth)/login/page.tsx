import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { LoginForm } from './login-form';
import { FindSchool } from './find-school';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The platform-level sign-in page.
 *
 * It deliberately carries NO school branding: it serves every tenant, and one
 * school's colours here would be wrong for everyone else. Signing in through
 * this page lands the user in their primary school; `/s/<slug>/login` is the
 * branded, school-pinned entrance.
 *
 * It also deliberately lists NO schools. It used to render every active tenant
 * with its name, code and colours, which amounted to publishing the customer
 * list — and it broke the thing each institution is actually paying for, which
 * is that their portal is theirs and does not advertise anybody else's.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Platform panel — hidden on small screens where it would only push the
          form below the fold.

          The photograph is self-hosted rather than hotlinked. The CSP allows
          `img-src 'self'` only, so a remote URL would silently render nothing;
          serving it ourselves also means the sign-in page has no third-party
          dependency and leaks no visitor to a CDN. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-onInk lg:flex">
        <Image
          src="/images/campus-hero.jpg"
          alt=""
          fill
          sizes="50vw"
          priority
          className="absolute inset-0 object-cover"
        />
        {/* A scrim, not a tint: white text over an unknown photograph is only
            legible if something guarantees the contrast underneath it. */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-ink/95 via-ink/85 to-ink/70"
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-sm font-bold backdrop-blur-sm">
            SP
          </span>
          <span className="text-sm font-semibold">School Portal</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            One record for every student, from application to graduation.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Admissions, registration, assessment and the bursary run on a single authoritative
            record — so a grade, a fee and a transcript can never disagree about the same person.
          </p>

          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              { k: 'Admissions', v: 'Rubric-scored' },
              { k: 'Registration', v: 'Rule-checked' },
              { k: 'Bursary', v: 'Fully reconciled' },
            ].map((item) => (
              <div key={item.k}>
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">{item.k}</dt>
                <dd className="mt-0.5 text-sm font-medium">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-slate-300">Authorised users only. All access is logged.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            You will be taken to your institution automatically.
          </p>

          <div className="mt-6">
            {reason === 'expired' ? (
              // Set by /session/end when a signature-valid token names a school
              // or membership that no longer exists. Saying so beats presenting
              // an empty form to somebody who believed they were signed in.
              <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
                <p className="font-semibold">Your session has ended</p>
                <p className="mt-0.5">
                  It referred to an account or school that is no longer available. Please sign in
                  again.
                </p>
              </div>
            ) : null}
            <LoginForm next={next} />
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Your institution has its own sign-in page, with its own address. If you have it,
              go there directly.
            </p>
            <FindSchool />
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Applying for admission?{' '}
            <Link href="/apply" className="font-medium text-brand-700 hover:underline">
              Start an application
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
