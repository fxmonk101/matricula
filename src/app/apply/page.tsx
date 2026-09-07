import type { Metadata } from 'next';
import Link from 'next/link';

import { db } from '@/lib/db';
import { INSTITUTION } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui';
import { ApplyForm } from './apply-form';

export const metadata: Metadata = { title: 'Apply for admission' };

export default async function ApplyPage() {
  const [programs, terms] = await Promise.all([
    db.program.findMany({
      where: { isActive: true },
      include: { department: { include: { faculty: true } } },
      orderBy: { code: 'asc' },
    }),
    // Only intakes whose application window has not closed. Showing a term
    // nobody can be admitted to just collects applications that must be
    // rejected on a technicality.
    db.term.findMany({
      where: { registrationClosesAt: { gte: new Date() } },
      orderBy: { startDate: 'asc' },
    }),
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
              {INSTITUTION.short.slice(0, 3)}
            </span>
            <span className="text-sm font-semibold text-slate-900">{INSTITUTION.name}</span>
          </Link>
          <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Already applied? Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Apply for admission
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Applications are scored on a published rubric — prior academic performance,
            entrance examination, personal statement, interview and extracurricular record —
            then ranked within the cohort and filled against the available places. You will be
            able to track your application at every stage.
          </p>
        </div>

        {programs.length === 0 || terms.length === 0 ? (
          <Card>
            <EmptyState
              title="Applications are not open"
              description="There is no intake currently accepting applications. Please check back later."
            />
          </Card>
        ) : (
          <ApplyForm
            programs={programs.map((p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              faculty: p.department.faculty.name,
            }))}
            terms={terms.map((t) => ({ id: t.id, name: t.name }))}
          />
        )}
      </main>
    </div>
  );
}
