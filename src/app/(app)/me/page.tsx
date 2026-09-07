import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { buildTranscript } from '@/server/services/gpa.service';
import { getStudentAccount } from '@/server/services/finance.service';
import { auditGraduation, classifyDegree, STANDING_THRESHOLDS } from '@/lib/domain/grading';
import { formatMoney } from '@/lib/domain/money';
import { titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkButton,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';

export const metadata: Metadata = { title: 'My record' };

export default async function MyRecordPage() {
  const { db, school, schoolId, session } = await requireTenantRole('STUDENT');
  if (!session.pid) redirect('/forbidden');

  const student = await db.student.findUnique({
    where: { id: session.pid },
    include: {
      user: true,
      program: { include: { department: true, requirements: true } },
      holds: { where: { releasedAt: null } },
    },
  });

  if (!student) redirect('/forbidden');

  const [transcript, account, passed, currentRegistrations] = await Promise.all([
    buildTranscript(schoolId, student.id),
    getStudentAccount(schoolId, student.id),
    db.enrollment.findMany({
      where: { studentId: student.id, gradePoint: { gte: 0.5 } },
      select: { offering: { select: { courseId: true } } },
    }),
    db.enrollment.findMany({
      where: { studentId: student.id, status: { in: ['REGISTERED', 'WAITLISTED'] } },
      include: { offering: { include: { course: true, term: true } } },
    }),
  ]);

  const graduation = auditGraduation({
    creditsEarned: student.creditsEarned,
    creditsRequired: student.program.creditsRequired,
    cgpa: student.cgpa,
    minCgpaToGraduate: student.program.minCgpaToGraduate,
    requiredCoreCourseIds: student.program.requirements
      .filter((r) => r.kind === 'CORE')
      .map((r) => r.courseId),
    passedCourseIds: passed.map((e) => e.offering.courseId),
    hasBlockingHold: student.holds.length > 0,
  });

  const progressPct =
    student.program.creditsRequired === 0
      ? 0
      : (student.creditsEarned / student.program.creditsRequired) * 100;

  return (
    <>
      <PageHeader
        title={`${student.user.firstName} ${student.user.lastName}`}
        description={`${student.matricNumber} · ${student.program.name} · Level ${student.level}`}
        actions={
          <Badge tone={toneForStatus(student.academicStanding)}>
            {titleCase(student.academicStanding)}
          </Badge>
        }
      />

      {student.holds.length > 0 ? (
        <Alert tone="danger" title="Your record has an active hold" className="mb-4">
          <ul className="list-disc space-y-0.5 pl-4">
            {student.holds.map((h) => (
              <li key={h.id}>
                <strong>{titleCase(h.kind)}</strong> — {h.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            You will not be able to register for courses until this is resolved.
          </p>
        </Alert>
      ) : null}

      {student.academicStanding === 'PROBATION' || student.academicStanding === 'WARNING' ? (
        <Alert tone="warning" title="Academic standing notice" className="mb-4">
          Your CGPA of {student.cgpa.toFixed(2)} is below the{' '}
          {STANDING_THRESHOLDS.good.toFixed(2)} threshold for good standing. Speak to your
          academic adviser about a study plan before the next registration window.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cumulative GPA"
          value={student.cgpa.toFixed(2)}
          sublabel={classifyDegree(student.cgpa)}
          tone={student.cgpa >= 3.5 ? 'gold' : student.cgpa >= 2 ? 'success' : 'warning'}
        />
        <StatTile
          label="Credits earned"
          value={student.creditsEarned}
          sublabel={`of ${student.program.creditsRequired}`}
          tone="brand"
        />
        <StatTile
          label="Registered this term"
          value={currentRegistrations.filter((r) => r.status === 'REGISTERED').length}
          sublabel={`${currentRegistrations.reduce((s, r) => s + (r.status === 'REGISTERED' ? r.offering.course.creditHours : 0), 0)} credit hours`}
        />
        <StatTile
          label="Fees outstanding"
          value={formatMoney(account.summary.outstandingMinor)}
          sublabel={account.summary.hasOverdue ? 'Overdue — settle now' : 'Up to date'}
          tone={account.summary.hasOverdue ? 'danger' : account.summary.outstandingMinor > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Progress to graduation" />
            <CardBody className="space-y-3">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-500">Credits</span>
                  <span className="tabular-nums font-medium">
                    {student.creditsEarned} / {student.program.creditsRequired}
                  </span>
                </div>
                <Meter value={progressPct} tone={progressPct >= 100 ? 'success' : 'brand'} />
              </div>
              {graduation.eligible ? (
                <Alert tone="success">
                  You have met every requirement. Expected classification:{' '}
                  <strong>{graduation.classification}</strong>.
                </Alert>
              ) : (
                <ul className="space-y-1 text-xs text-slate-600">
                  {graduation.blockers.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-amber-600">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="This term" />
            {currentRegistrations.length === 0 ? (
              <EmptyState
                title="Not registered for any courses"
                action={<LinkButton href="/me/registration" size="sm">Register now</LinkButton>}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {currentRegistrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-medium text-slate-900">
                        {r.offering.course.code}-{r.offering.section}
                      </p>
                      <p className="truncate text-xs text-slate-500">{r.offering.course.title}</p>
                    </div>
                    <Badge tone={toneForStatus(r.status)}>
                      {r.status === 'WAITLISTED'
                        ? `Waitlist #${r.waitlistPosition}`
                        : titleCase(r.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Academic transcript"
            description='Repeated courses show every attempt; only the best counts toward your CGPA, marked "R".'
          />
          {!transcript || transcript.terms.length === 0 ? (
            <EmptyState
              title="No results published yet"
              description="Your results appear here once your instructors post grades."
            />
          ) : (
            <div className="divide-y divide-slate-200">
              {transcript.terms.map(({ term, summary, rows }) => (
                <section key={term.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 bg-slate-50 px-5 py-2.5">
                    <h3 className="text-xs font-semibold text-slate-900">{term.name}</h3>
                    <div className="flex items-center gap-3 text-xs tabular-nums text-slate-600">
                      <span>GPA <strong className="text-slate-900">{summary.gpa.toFixed(2)}</strong></span>
                      <span>CGPA <strong className="text-slate-900">{summary.cumulativeGpa.toFixed(2)}</strong></span>
                      <Badge tone={toneForStatus(summary.academicStanding)}>
                        {titleCase(summary.academicStanding)}
                      </Badge>
                    </div>
                  </div>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Course</Th>
                        <Th className="text-center">Cr</Th>
                        <Th className="text-right">CA</Th>
                        <Th className="text-right">Exam</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="text-center">Grade</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row) => (
                        <tr key={row.id} className={row.isRepeatSuperseded ? 'opacity-50' : undefined}>
                          <Td>
                            <span className="font-mono text-xs font-medium">{row.offering.course.code}</span>
                            <span className="ml-2 text-xs text-slate-600">{row.offering.course.title}</span>
                            {row.isRepeatSuperseded ? (
                              <Badge tone="neutral" className="ml-2">R</Badge>
                            ) : null}
                          </Td>
                          <Td className="text-center tabular-nums text-xs">
                            {row.offering.course.creditHours}
                          </Td>
                          <Td className="text-right tabular-nums text-xs">
                            {row.caScore?.toFixed(1) ?? '—'}
                          </Td>
                          <Td className="text-right tabular-nums text-xs">
                            {row.examScore?.toFixed(1) ?? '—'}
                          </Td>
                          <Td className="text-right font-medium tabular-nums text-xs">
                            {row.totalScore?.toFixed(1) ?? '—'}
                          </Td>
                          <Td className="text-center font-semibold">{row.letterGrade ?? '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
