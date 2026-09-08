import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { platformDb } from '@/lib/tenant';
import { ACADEMIC_MODEL_LABELS, type AcademicModel } from '@/lib/domain/enums';
import { Card, EmptyState } from '@/components/ui';

export const metadata: Metadata = { title: 'Apply for admission' };

/**
 * The platform-level entry point.
 *
 * An application has to belong to a school, so with more than one school on the
 * platform this page is a chooser rather than a form; the form itself lives at
 * `/s/<slug>/apply`, where the tenant is unambiguous. With exactly one school
 * it forwards straight through, so a single-school deployment never sees a
 * pointless choice.
 */
export default async function ApplyChooserPage() {
  const schools = await platformDb.school.findMany({
    where: { status: { in: ['ACTIVE', 'TRIAL'] } },
    select: {
      slug: true, name: true, shortName: true, code: true, country: true,
      brandColor: true, academicModel: true,
      _count: { select: { memberships: true } },
    },
    orderBy: { name: 'asc' },
  });

  if (schools.length === 1) redirect(`/s/${schools[0].slug}/apply`);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold text-slate-900">Apply for admission</span>
          <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Already applied? Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Choose where you are applying
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Each institution sets its own programmes, entry requirements and deadlines. Pick one to
            begin — you can apply to more than one with the same email address.
          </p>
        </div>

        {schools.length === 0 ? (
          <Card>
            <EmptyState
              title="No institutions are accepting applications"
              description="Please check back later."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {schools.map((s) => (
              <Link
                key={s.slug}
                href={`/s/${s.slug}/apply`}
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-card transition-colors hover:border-brand-400"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-onAccent"
                    style={{ backgroundColor: s.brandColor }}
                  >
                    {s.code.slice(0, 3)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 group-hover:text-brand-700">
                      {s.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {ACADEMIC_MODEL_LABELS[s.academicModel as AcademicModel]}
                      {s.country ? ` · ${s.country}` : ''}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Apply to {s.shortName} →
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
