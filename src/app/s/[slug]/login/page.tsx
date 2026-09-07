import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { platformDb } from '@/lib/tenant';
import { LoginForm } from '@/app/(auth)/login/login-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * School-pinned sign-in. The slug fixes the tenant, so a person who belongs to
 * several schools lands in the right one; `/login` without a slug falls back to
 * their primary membership.
 */
export default async function SchoolLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { slug } = await params;
  const { next } = await searchParams;

  const school = await platformDb.school.findUnique({
    where: { slug },
    select: { name: true, shortName: true, code: true, brandColor: true, status: true },
  });
  if (!school || school.status === 'SUSPENDED') notFound();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div
        className="hidden flex-col justify-between p-10 text-white lg:flex"
        style={{ backgroundColor: school.brandColor }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-sm font-bold">
            {school.code.slice(0, 3)}
          </span>
          <span className="text-sm font-semibold">{school.name}</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            One record for every student, from application to graduation.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            Admissions, registration, assessment and the bursary run on a single authoritative
            record — so a grade, a fee and a transcript can never disagree about the same person.
          </p>
        </div>

        <p className="text-xs text-white/70">Authorised users only. All access is logged.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span
              className="grid h-10 w-10 place-items-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: school.brandColor }}
            >
              {school.code.slice(0, 3)}
            </span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Sign in to {school.shortName}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Use the credentials issued by your department.
          </p>

          <div className="mt-6">
            <LoginForm next={next} schoolSlug={slug} />
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Applying for admission?{' '}
            <Link href={`/s/${slug}/apply`} className="font-medium text-brand-700 hover:underline">
              Start an application
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
