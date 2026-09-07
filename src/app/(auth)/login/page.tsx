import type { Metadata } from 'next';
import Link from 'next/link';

import { INSTITUTION } from '@/lib/utils';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens where it would only push the
          form below the fold. */}
      <div className="hidden flex-col justify-between bg-brand-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-sm font-bold">
            {INSTITUTION.short.slice(0, 3)}
          </span>
          <span className="text-sm font-semibold">{INSTITUTION.name}</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            One record for every student, from application to graduation.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-brand-100">
            Admissions, registration, assessment and the bursary run on a single
            authoritative record — so a grade, a fee and a transcript can never
            disagree about the same person.
          </p>

          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              { k: 'Admissions', v: 'Rubric-scored' },
              { k: 'Registration', v: 'Rule-checked' },
              { k: 'Bursary', v: 'Fully reconciled' },
            ].map((item) => (
              <div key={item.k}>
                <dt className="text-[11px] uppercase tracking-wide text-brand-300">{item.k}</dt>
                <dd className="mt-0.5 text-sm font-medium">{item.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-brand-300">
          Authorised users only. All access is logged.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">
              {INSTITUTION.short.slice(0, 3)}
            </span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Sign in to the portal
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Use the credentials issued by your department.
          </p>

          <div className="mt-6">
            <LoginForm next={next} />
          </div>

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
    ['Administrator', 'admin@geu.edu'],
    ['Registrar', 'registrar@geu.edu'],
    ['Admissions', 'admissions@geu.edu'],
    ['Bursary', 'bursary@geu.edu'],
    ['Instructor', 'a.okafor@geu.edu'],
    ['Student', 'chidi.eze@student.geu.edu'],
    ['Applicant', 'hopeful@example.com'],
  ];

  return (
    <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Development accounts
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Password for all seeded accounts: <code className="font-mono text-slate-700">Password123!</code>
      </p>
      <ul className="mt-2 space-y-0.5">
        {accounts.map(([label, email]) => (
          <li key={email} className="flex justify-between gap-3 text-[11px]">
            <span className="text-slate-500">{label}</span>
            <code className="font-mono text-slate-700">{email}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
