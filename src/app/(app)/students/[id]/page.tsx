import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { buildTranscript } from '@/server/services/gpa.service';
import { getStudentAccount } from '@/server/services/finance.service';
import { auditGraduation, classifyDegree } from '@/lib/domain/grading';
import { formatDate, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Student record' };

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, school, schoolId, money } = await requireTenantRole('ADMIN', 'REGISTRAR', 'ADMISSIONS', 'FINANCE', 'INSTRUCTOR');
  const { id } = await params;

  const student = await db.student.findUnique({
    where: { id },
    include: {
      user: true,
      program: { include: { department: { include: { faculty: true } }, requirements: true } },
      holds: { orderBy: { placedAt: 'desc' } },
    },
  });

  if (!student) notFound();

  const [transcript, account, passedEnrollments] = await Promise.all([
    buildTranscript(schoolId, id),
    getStudentAccount(schoolId, id),
    db.enrollment.findMany({
      where: { studentId: id, gradePoint: { gte: 0.5 } },
      select: { offering: { select: { courseId: true } } },
    }),
  ]);

  const coreRequirements = student.program.requirements.filter((r) => r.kind === 'CORE');
  const graduation = auditGraduation({
    creditsEarned: student.creditsEarned,
    creditsRequired: student.program.creditsRequired,
    cgpa: student.cgpa,
    minCgpaToGraduate: student.program.minCgpaToGraduate,
    requiredCoreCourseIds: coreRequirements.map((r) => r.courseId),
    passedCourseIds: passedEnrollments.map((e) => e.offering.courseId),
    hasBlockingHold: student.holds.some((h) => !h.releasedAt),
  });

  const activeHolds = student.holds.filter((h) => !h.releasedAt);
  const progressPct =
    student.program.creditsRequired === 0
      ? 0
      : (student.creditsEarned / student.program.creditsRequired) * 100;

  return (
    <>
      <PageHeader
        title={`${student.user.firstName} ${student.user.lastName}`}
        description={`${student.matricNumber} · ${student.program.name} · ${student.program.department.faculty.name}`}
        actions={
          <>
            <Badge tone={toneForStatus(student.status)}>{titleCase(student.status)}</Badge>
            <Badge tone={toneForStatus(student.academicStanding)}>
              {titleCase(student.academicStanding)}
            </Badge>
          </>
        }
      />

      {activeHolds.length > 0 ? (
        <Alert tone="danger" title={`${activeHolds.length} active hold${activeHolds.length === 1 ? '' : 's'} on this record`} className="mb-4">
          <ul className="list-disc space-y-0.5 pl-4">
            {activeHolds.map((h) => (
              <li key={h.id}>
                <strong>{titleCase(h.kind)}</strong> — {h.reason}
                {h.blocksRegistration ? ' (blocks registration)' : ''}
                {h.blocksTranscript ? ' (blocks transcript release)' : ''}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="CGPA"
          value={student.cgpa.toFixed(2)}
          sublabel={classifyDegree(student.cgpa)}
          tone={student.cgpa >= 3.5 ? 'gold' : student.cgpa >= 2 ? 'success' : 'warning'}
        />
        <StatTile
          label="Credits earned"
          value={`${student.creditsEarned}`}
          sublabel={`of ${student.program.creditsRequired} required`}
          tone="brand"
        />
        <StatTile
          label="Account balance"
          value={money.format(account.summary.outstandingMinor)}
          sublabel={
            account.summary.hasOverdue
              ? `${money.format(account.summary.overdueMinor)} overdue`
              : 'No overdue balance'
          }
          tone={account.summary.hasOverdue ? 'danger' : account.summary.outstandingMinor > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="Graduation"
          value={graduation.eligible ? 'Eligible' : `${graduation.creditsRemaining} cr left`}
          sublabel={graduation.eligible ? graduation.classification : `${graduation.blockers.length} outstanding requirement(s)`}
          tone={graduation.eligible ? 'success' : 'neutral'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Registry details" />
            <CardBody>
              <dl>
                <DetailRow label="Matriculation number">
                  <span className="font-mono text-xs">{student.matricNumber}</span>
                </DetailRow>
                <DetailRow label="Email">
                  <span className="text-xs">{student.user.email}</span>
                </DetailRow>
                <DetailRow label="Phone">{student.user.phone ?? '—'}</DetailRow>
                <DetailRow label="Program">{student.program.code}</DetailRow>
                <DetailRow label="Department">{student.program.department.name}</DetailRow>
                <DetailRow label="Level">{student.level}</DetailRow>
                <DetailRow label="Admitted">{student.admissionTermCode ?? '—'}</DetailRow>
                <DetailRow label="Date of birth">{formatDate(student.dateOfBirth)}</DetailRow>
                <DetailRow label="Nationality">{student.nationality ?? '—'}</DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Degree progress" />
            <CardBody className="space-y-3">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-500">Credits toward the degree</span>
                  <span className="tabular-nums font-medium text-slate-900">
                    {student.creditsEarned} / {student.program.creditsRequired}
                  </span>
                </div>
                <Meter value={progressPct} tone={progressPct >= 100 ? 'success' : 'brand'} />
              </div>

              {graduation.blockers.length > 0 ? (
                <ul className="space-y-1 text-xs text-slate-600">
                  {graduation.blockers.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-amber-600">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Alert tone="success">
                  All degree requirements satisfied. Recommended classification:{' '}
                  <strong>{graduation.classification}</strong>.
                </Alert>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Academic transcript"
              description="Every graded attempt, in academic order. Superseded repeats are retained and marked."
            />
            {!transcript || transcript.terms.length === 0 ? (
              <EmptyState
                title="No graded coursework yet"
                description="Terms appear here once grades have been posted."
              />
            ) : (
              <div className="divide-y divide-slate-200">
                {transcript.terms.map(({ term, summary, rows }) => (
                  <section key={term.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 bg-slate-50 px-5 py-2.5">
                      <h3 className="text-xs font-semibold text-slate-900">
                        {term.name} · {term.academicYear}
                      </h3>
                      <div className="flex items-center gap-3 text-xs tabular-nums text-slate-600">
                        <span>
                          GPA <strong className="text-slate-900">{summary.gpa.toFixed(2)}</strong>
                        </span>
                        <span>
                          CGPA <strong className="text-slate-900">{summary.cumulativeGpa.toFixed(2)}</strong>
                        </span>
                        <span>
                          {summary.creditsEarned}/{summary.creditsAttempted} cr
                        </span>
                        <Badge tone={toneForStatus(summary.academicStanding)}>
                          {titleCase(summary.academicStanding)}
                        </Badge>
                      </div>
                    </div>

                    <Table>
                      <thead className="sr-only">
                        <tr>
                          <Th>Course</Th>
                          <Th>Credits</Th>
                          <Th>Score</Th>
                          <Th>Grade</Th>
                          <Th>Points</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                          <tr key={row.id} className={row.isRepeatSuperseded ? 'opacity-50' : undefined}>
                            <Td>
                              <span className="font-mono text-xs font-medium text-slate-900">
                                {row.offering.course.code}
                              </span>
                              <span className="ml-2 text-xs text-slate-600">
                                {row.offering.course.title}
                              </span>
                              {row.isRepeatSuperseded ? (
                                <Badge tone="neutral" className="ml-2" title="Superseded by a later attempt; excluded from the CGPA">
                                  R
                                </Badge>
                              ) : null}
                            </Td>
                            <Td className="w-16 text-right tabular-nums text-xs">
                              {row.offering.course.creditHours}
                            </Td>
                            <Td className="w-20 text-right tabular-nums text-xs">
                              {row.totalScore?.toFixed(1) ?? '—'}
                            </Td>
                            <Td className="w-16 text-center">
                              <span className="font-semibold">{row.letterGrade ?? '—'}</span>
                            </Td>
                            <Td className="w-16 text-right tabular-nums text-xs">
                              {row.gradePoint?.toFixed(1) ?? '—'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </section>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Financial account" description="Invoices raised against this record." />
            {account.invoices.length === 0 ? (
              <EmptyState title="No invoices raised" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Term</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Balance</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {account.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <Td className="font-mono text-xs">{inv.invoiceNo}</Td>
                      <Td className="text-xs">{inv.term.code}</Td>
                      <Td className="text-xs">{formatDate(inv.dueDate)}</Td>
                      <Td className="text-right tabular-nums">{money.format(inv.totalMinor)}</Td>
                      <Td className="text-right tabular-nums text-emerald-700">
                        {money.format(inv.paidMinor)}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">
                        {money.format(inv.totalMinor - inv.paidMinor)}
                      </Td>
                      <Td>
                        <Badge tone={toneForStatus(inv.status)}>{titleCase(inv.status)}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
