import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { requireGuardianChild } from '@/server/guardian';
import { ReportCardDocument } from '@/components/k12/report-card';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Report card' };

export default async function FamilyChildPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { db, school, config } = await requireTenantRole('GUARDIAN');
  const { studentId } = await params;
  const { term: requestedTerm } = await searchParams;

  // Authorisation by LINK, not by role — see `@/server/guardian`. A pupil who
  // is not this guardian's child 404s rather than 403s, so the response does
  // not confirm the pupil exists.
  const child = await requireGuardianChild(studentId);

  const cards = await db.reportCard.findMany({
    where: { studentId, publishedAt: { not: null } },
    include: { term: true, lines: { orderBy: { position: 'asc' } } },
    orderBy: { term: { startDate: 'desc' } },
  });

  const card = requestedTerm ? cards.find((c) => c.termId === requestedTerm) : cards[0];

  return (
    <>
      <PageHeader
        title={child.name}
        description={[child.formClassName, `Admission no. ${child.admissionNo}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Link href="/family" className="text-sm text-brand-700 hover:underline">
            ← My family
          </Link>
        }
      />

      {cards.length === 0 ? (
        <Card>
          <EmptyState
            title="No report card has been issued yet"
            description="Report cards appear here once the school publishes them at the end of a term."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {cards.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Term:</span>
              {cards.map((c) => {
                const active = c.id === card?.id;
                return (
                  <Link
                    key={c.id}
                    href={`/family/${studentId}?term=${c.termId}`}
                    className={
                      active
                        ? 'rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-onAccent'
                        : 'rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
                    }
                  >
                    {c.term.name} {c.term.academicYear}
                  </Link>
                );
              })}
            </div>
          ) : null}

          {!card ? (
            <Alert tone="warning">
              No published report card exists for the requested term.
            </Alert>
          ) : (
            <ReportCardDocument
              card={card}
              pupil={{ name: child.name, admissionNo: child.admissionNo }}
              school={school}
              term={{ name: card.term.name, academicYear: card.term.academicYear }}
              showPosition={config.k12.showClassPosition}
            />
          )}

          <p className="text-xs text-slate-500">
            Questions about this report should go to the form teacher in the first instance.
            Quote the reference number shown at the top of the card.
          </p>
        </div>
      )}
    </>
  );
}
