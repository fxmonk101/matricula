import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { ordinal } from '@/lib/domain/k12';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  type BadgeTone,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Report cards' };

const DECISION_TONE: Record<string, BadgeTone> = {
  PROMOTED: 'success',
  GRADUATED: 'gold',
  REVIEW: 'warning',
  REPEAT: 'danger',
  PENDING: 'neutral',
};

export default async function ReportsPage() {
  const { db, school, config } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR');

  if (school.academicModel !== 'K12') {
    return (
      <>
        <PageHeader title="Report cards" />
        <Alert tone="info" title="This school runs on the higher-education model">
          Termly report cards belong to the primary and secondary model. {school.shortName} issues{' '}
          <Link href="/students" className="font-medium underline">
            transcripts
          </Link>{' '}
          instead.
        </Alert>
      </>
    );
  }

  const term = await db.term.findFirst({ where: { isCurrent: true } });

  const cards = term
    ? await db.reportCard.findMany({
        where: { termId: term.id },
        include: { student: { include: { user: true } } },
        orderBy: [{ formClassCode: 'asc' }, { positionInClass: 'asc' }],
      })
    : [];

  const published = cards.filter((c) => c.publishedAt).length;
  const referred = cards.filter(
    (c) => c.promotionDecision === 'REVIEW' || c.promotionDecision === 'REPEAT',
  ).length;
  const mean =
    cards.length === 0 ? null : cards.reduce((s, c) => s + c.average, 0) / cards.length;

  return (
    <>
      <PageHeader
        title="Report cards"
        description={
          term
            ? `${term.name} · ${term.academicYear}`
            : 'No term is currently active.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cards" value={cards.length} sublabel="Generated this term" />
        <StatTile
          label="Published"
          value={published}
          tone={published === cards.length && cards.length > 0 ? 'success' : 'warning'}
          sublabel={`${cards.length - published} still in draft`}
        />
        <StatTile
          label="Referred or repeating"
          value={referred}
          tone={referred > 0 ? 'warning' : 'success'}
          sublabel="Need a conversation with the family"
        />
        <StatTile
          label="Cohort average"
          value={mean === null ? '—' : mean.toFixed(1)}
          tone="brand"
          sublabel={`Promotion mark is ${config.k12.promotionMinAverage}`}
        />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="All cards"
          description="Generate and publish from the class page — positions are a property of the class, not of one pupil."
        />
        {cards.length === 0 ? (
          <EmptyState
            title="No report cards for this term yet"
            description="Open a class, complete its mark sheets, then generate."
            action={
              <Link href="/classes" className="text-sm font-medium text-brand-700 hover:underline">
                Go to classes →
              </Link>
            }
          />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Pupil</Th>
                <Th>Class</Th>
                <Th>Reference</Th>
                <Th className="text-right">Average</Th>
                <Th className="text-center">Position</Th>
                <Th className="text-center">Grade</Th>
                <Th>Decision</Th>
                <Th>State</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cards.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium text-slate-900">
                    {c.student.user.firstName} {c.student.user.lastName}
                    <div className="font-mono text-[11px] font-normal text-slate-500">
                      {c.student.matricNumber}
                    </div>
                  </Td>
                  <Td className="text-xs">{c.formClassCode}</Td>
                  <Td className="font-mono text-[11px] text-slate-500">{c.referenceNo}</Td>
                  <Td className="text-right font-medium tabular-nums">{c.average.toFixed(1)}</Td>
                  <Td className="text-center text-xs tabular-nums">
                    {ordinal(c.positionInClass)} of {c.classSize}
                  </Td>
                  <Td className="text-center">
                    <Badge tone="neutral">{c.overallGrade}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={DECISION_TONE[c.promotionDecision] ?? 'neutral'}>
                      {c.promotionDecision === 'REVIEW'
                        ? 'Referred'
                        : c.promotionDecision.charAt(0) + c.promotionDecision.slice(1).toLowerCase()}
                    </Badge>
                  </Td>
                  <Td>
                    {c.publishedAt ? (
                      <Badge tone="success">Published</Badge>
                    ) : (
                      <Badge tone="warning">Draft</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/reports/${c.studentId}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
