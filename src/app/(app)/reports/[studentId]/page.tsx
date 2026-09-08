import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { Alert, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { ReportCardDocument } from '@/components/k12/report-card';
import { ordinal } from '@/lib/domain/k12';

export const metadata: Metadata = { title: 'Report card' };

export default async function StudentReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ term?: string }>;
}) {
  const { db, school, config } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR');
  const { studentId } = await params;
  const { term: requestedTerm } = await searchParams;

  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { user: true },
  });
  if (!student) notFound();

  // Every card this pupil has, so the page doubles as their termly history.
  const cards = await db.reportCard.findMany({
    where: { studentId },
    include: { term: true, lines: { orderBy: { position: 'asc' } } },
    orderBy: { term: { startDate: 'desc' } },
  });

  const card = requestedTerm ? cards.find((c) => c.termId === requestedTerm) : cards[0];

  const pupilName = `${student.user.firstName} ${student.user.lastName}`;

  return (
    <>
      <PageHeader
        title={pupilName}
        description={`Admission number ${student.matricNumber}`}
        actions={
          <Link href="/reports" className="text-sm text-brand-700 hover:underline">
            ← All report cards
          </Link>
        }
      />

      {cards.length === 0 ? (
        <Card>
          <EmptyState
            title="No report cards yet"
            description={`${pupilName} has no generated report card. Generate one from the class page once the mark sheets are complete.`}
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
                    href={`/reports/${studentId}?term=${c.termId}`}
                    className={
                      active
                        ? 'rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white'
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
              No report card exists for the requested term. Showing nothing rather than another
              term&rsquo;s card, which would be worse.
            </Alert>
          ) : (
            <>
              {card.publishedAt === null ? (
                <Alert tone="warning" title="Draft">
                  This card has not been published. Guardians cannot see it, and regenerating the
                  class will overwrite it.
                </Alert>
              ) : null}

              <ReportCardDocument
                card={card}
                pupil={{ name: pupilName, admissionNo: student.matricNumber }}
                school={school}
                term={{ name: card.term.name, academicYear: card.term.academicYear }}
                showPosition={config.k12.showClassPosition}
              />
            </>
          )}

          {cards.length > 1 ? (
            <Card>
              <CardHeader
                title="Across the terms"
                description="Each row is that term's card as issued; nothing here is recomputed."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Term</Th>
                    <Th>Class</Th>
                    <Th className="text-right">Average</Th>
                    <Th className="text-right">Class average</Th>
                    <Th className="text-center">Position</Th>
                    <Th className="text-center">Grade</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...cards].reverse().map((c) => (
                    <tr key={c.id}>
                      <Td className="text-xs">
                        {c.term.name} · {c.term.academicYear}
                      </Td>
                      <Td className="text-xs">{c.formClassCode}</Td>
                      <Td className="text-right font-medium tabular-nums">{c.average.toFixed(1)}</Td>
                      <Td className="text-right tabular-nums text-slate-500">
                        {c.classAverage.toFixed(1)}
                      </Td>
                      <Td className="text-center text-xs tabular-nums">
                        {ordinal(c.positionInClass)} of {c.classSize}
                      </Td>
                      <Td className="text-center text-xs font-medium">{c.overallGrade}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
