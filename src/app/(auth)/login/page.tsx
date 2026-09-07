import type { Metadata } from 'next';
import Link from 'next/link';

import { platformDb } from '@/lib/tenant';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The platform-level sign-in page.
 *
 * It deliberately carries NO school branding: it serves every tenant, and one
 * school's colours here would be wrong for everyone else. Signing in through
 * this page lands the user in their primary school; `/s/<slug>/login` is the
 * branded, school-pinned entrance.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const schools = await platformDb.school.findMany({
    where: { status: { in: ['ACTIVE', 'TRIAL'] } },
    select: { slug: true, name: true, code: true, brandColor: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Platform panel — hidden on small screens where it would only push the
          form below the fold. */}
      <div className="hidden flex-col justify-between bg-slate-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-sm font-bold">
            SP
          </span>
          <span className="text-sm font-semibold">School Portal</span>
        </div>

        <div className="max-w-md">
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

        <p className="text-xs text-slate-400">Authorised users only. All access is logged.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            You will be taken to your institution automatically.
          </p>

          <div className="mt-6">
            <LoginForm next={next} />
          </div>

          {schools.length > 1 ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-xs font-medium text-slate-700">Or go straight to your institution</p>
              <ul className="mt-2 space-y-1">
                {schools.map((s) => (
                  <li key={s.slug}>
                    <Link
                      href={`/s/${s.slug}/login`}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
                        style={{ backgroundColor: s.brandColor }}
                      >
                        {s.code.slice(0, 3)}
                      </span>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-6 text-center text-xs text-slate-500">
            Applying for admission?{' '}
            <Link href="/apply" className="font-medium text-brand-700 hover:underline">
              Start an application
            </Link>
          </p>

          <DemoCredentials />
        </div>
      </div>
    </div>
  );
}

/**
 * Seeded demo accounts. Rendered only outside production so a real deployment
 * never advertises working credentials on its own login page.
 */
function DemoCredentials() {
  if (process.env.NODE_ENV === 'production') return null;

  const accounts = [
    ['GEU · Administrator', 'admin@geu.edu'],
    ['GEU · Registrar', 'registrar@geu.edu'],
    ['GEU · Dean / Instructor', 'a.okafor@geu.edu'],
    ['GEU · Student', 'chidi.eze@student.geu.edu'],
    ['MIT · Administrator', 'admin@meridian.edu.gh'],
    ['MIT · Student', 'ama.darko@student.meridian.edu.gh'],
  ];

  return (
    <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Development accounts
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Password for all seeded accounts:{' '}
        <code className="font-mono text-slate-700">Password123!</code>
      </p>
      <ul className="mt-2 space-y-0.5">
        {accounts.map(([label, email]) => (
          <li key={email} className="flex justify-between gap-3 text-[11px]">
            <span className="text-slate-500">{label}</span>
            <code className="font-mono text-slate-700">{email}</code>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">
        a.okafor@geu.edu holds a membership at both schools — sign in via a school link above to
        pick which.
      </p>
    </div>
  );
}
