import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { ordinal } from '@/lib/domain/k12';
import { formatDate } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { GenerateReportsPanel } from './generate-panel';

export const metadata: Metadata = { title: 'Class' };

const DECISION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'gold' | 'neutral'> = {
  PROMOTED: 'success',
  GRADUATED: 'gold',
  REVIEW: 'warning',
  REPEAT: 'danger',
  PENDING: 'neutral',
};

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, role } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR');
  const { id } = await params;

  const term = await db.term.findFirst({ where: { isCurrent: true } });
  if (!term) notFound();

  const formClass = await db.formClass.findUnique({
    where: { id },
    include: { yearGroup: true, formTeacher: { include: { user: true } } },
  });
  if (!formClass) notFound();

  const [enrolments, assignments, reportCards] = await Promise.all([
    db.classEnrolment.findMany({
      where: { formClassId: id, termId: term.id },
      include: { student: { include: { user: true } } },
      orderBy: { student: { user: { lastName: 'asc' } } },
    }),
    db.subjectAssignment.findMany({
      where: { formClassId: id, termId: term.id },
      include: {
        subject: true,
        teacher: { include: { user: true } },
        results: { select: { totalScore: true } },
      },
      orderBy: { subject: { code: 'asc' } },
    }),
    db.reportCard.findMany({
      where: { termId: term.id, formClassCode: formClass.code },
      include: { student: { select: { id: true } } },
    }),
  ]);

  const cardByStudent = new Map(reportCards.map((c) => [c.studentId, c]));
  const marksComplete = assignments.filter(
    (a) => a.results.filter((r) => r.totalScore !== null).length === enrolments.length,
  ).length;
  const published = reportCards.filter((c) => c.publishedAt).length;

  return (
    <>
      <PageHeader
        title={formClass.name}
        description={`${formClass.yearGroup.name} · ${term.name} · form teacher ${formClass.formTeacher ? `${formClass.formTeacher.user.firstName} ${formClass.formTeacher.user.lastName}` : 'unassigned'}`}
        actions={
          <Link href="/classes" className="text-sm text-brand-700 hover:underline">
            ← All classes
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Pupils" value={enrolments.length} sublabel={`of ${formClass.capacity} places`} />
        <StatTile
          label="Subjects marked"
          value={`${marksComplete}/${assignments.length}`}
          tone={marksComplete === assignments.length ? 'success' : 'warning'}
          sublabel={marksComplete === assignments.length ? 'Complete' : 'Mark sheets outstanding'}
        />
        <StatTile
          label="Report cards"
          value={`${published}/${enrolments.length}`}
          tone={published === enrolments.length && published > 0 ? 'success' : 'neutral'}
          sublabel={published > 0 ? 'Published to guardians' : 'Not yet published'}
        />
        <StatTile
          label="Class average"
          value={
            reportCards.length > 0
              ? (reportCards.reduce((s, c) => s + c.average, 0) / reportCards.length).toFixed(1)
              : '—'
          }
          tone="brand"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Subject mark sheets"
              description="Marks are saved for the whole class at once — the class average and each pupil's position cannot be computed from one row."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Subject</Th>
                  <Th className="text-right">Marked</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((a) => {
                  const marked = a.results.filter((r) => r.totalScore !== null).length;
                  const complete = marked === enrolments.length && enrolments.length > 0;
                  return (
                    <tr key={a.id}>
                      <Td>
                        <div className="text-sm font-medium text-slate-900">{a.subject.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {a.teacher
                            ? `${a.teacher.user.firstName} ${a.teacher.user.lastName}`
                            : 'No teacher assigned'}
                        </div>
                      </Td>
                      <Td className="text-right">
                        <span className="tabular-nums text-xs">
                          {marked}/{enrolments.length}
                        </span>
                        <div className="mt-1 w-16">
                          <Meter
                            value={enrolments.length ? (marked / enrolments.length) * 100 : 0}
                            tone={complete ? 'success' : 'warning'}
                          />
                        </div>
                      </Td>
                      <Td className="text-right">
                        <span className="inline-flex items-center gap-3">
                          <Link
                            href={`/classes/${id}/subjects/${a.id}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Content
                          </Link>
                          <Link
                            href={`/classes/${id}/marks/${a.id}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            {complete ? 'Review' : 'Enter'}
                          </Link>
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {role === 'ADMIN' || role === 'REGISTRAR' ? (
            <GenerateReportsPanel
              formClassId={id}
              pupils={enrolments.length}
              marksComplete={marksComplete === assignments.length && assignments.length > 0}
              alreadyPublished={published > 0}
            />
          ) : null}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Register"
            description={
              reportCards.length > 0
                ? 'Positions and promotion decisions are computed from the marks; nothing here is typed in.'
                : 'Report cards have not been generated for this term yet.'
            }
          />
          {enrolments.length === 0 ? (
            <EmptyState title="No pupils enrolled for this term" />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Pupil</Th>
                  <Th>Admission no.</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Average</Th>
                  <Th className="text-center">Position</Th>
                  <Th>Decision</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {enrolments.map((e) => {
                  const card = cardByStudent.get(e.studentId);
                  return (
                    <tr key={e.id}>
                      <Td>
                        <div className="font-medium text-slate-900">
                          {e.student.user.firstName} {e.student.user.lastName}
                        </div>
                        <div className="text-[11px] text-slate-500">{e.student.user.email}</div>
                      </Td>
                      <Td className="font-mono text-xs">{e.student.matricNumber}</Td>
                      <Td className="text-right tabular-nums text-xs">
                        {card ? `${card.totalMarks}/${card.maxMarks}` : '—'}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">
                        {card ? card.average.toFixed(1) : '—'}
                      </Td>
                      <Td className="text-center tabular-nums text-xs">
                        {card ? `${ordinal(card.positionInClass)} of ${card.classSize}` : '—'}
                      </Td>
                      <Td>
                        {card ? (
                          <Badge tone={DECISION_TONE[card.promotionDecision] ?? 'neutral'}>
                            {card.promotionDecision === 'REVIEW' ? 'Referred' : card.promotionDecision.charAt(0) + card.promotionDecision.slice(1).toLowerCase()}
                          </Badge>
                        ) : (
                          <Badge tone={toneForStatus('PENDING')}>Pending</Badge>
                        )}
                      </Td>
                      <Td className="text-right">
                        {card ? (
                          <Link
                            href={`/reports/${e.studentId}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Report card
                          </Link>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          {published > 0 ? (
            <div className="border-t border-slate-200 px-5 py-3">
              <Alert tone="success">
                {published} report card{published === 1 ? '' : 's'} published
                {reportCards[0]?.publishedAt ? ` on ${formatDate(reportCards[0].publishedAt)}` : ''}.
                Published cards are frozen — regenerating will not change what a guardian already
                holds.
              </Alert>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
