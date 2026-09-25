import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { ASSESSMENT_WEIGHTS, GRADE_SCALE, computeGpa } from '@/lib/domain/grading';
import { Alert, Card, CardHeader, EmptyState, PageHeader, StatTile } from '@/components/ui';
import { attendanceForOffering } from '@/server/services/attendance.service';
import { STAGE_LABELS, isEditable, waitingOn } from '@/lib/domain/result-workflow';
import { sheetFor } from '@/server/services/result-workflow.service';
import { Gradesheet } from './gradesheet';

export const metadata: Metadata = { title: 'Gradesheet' };

export default async function GradesheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, school, schoolId, session, config } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id } = await params;

  const offering = await db.courseOffering.findUnique({
    where: { id },
    include: {
      course: { include: { department: true } },
      term: true,
      instructor: { include: { user: true } },
      enrollments: {
        where: { status: { in: ['REGISTERED', 'COMPLETED'] } },
        include: { student: { include: { user: true } } },
        orderBy: { student: { matricNumber: 'asc' } },
      },
    },
  });

  if (!offering) notFound();

  if (session.role === 'INSTRUCTOR' && offering.instructorId !== session.pid) {
    redirect('/forbidden');
  }

  /*
   * The attendance bar, fetched ONLY when this school enforces one.
   *
   * A school that has not turned the rule on gets no query and no column:
   * showing a percentage nobody has agreed to act on, beside the box where
   * a mark is typed, would read as an instruction.
   */
  const barred = config.attendance.enforced
    ? await attendanceForOffering({
        schoolId,
        offeringId: offering.id,
        policy: config.attendance,
      })
    : null;

  const barsByEnrolment = new Map(
    (barred?.students ?? [])
      .filter((s) => s.verdict === 'BARRED' && s.percentage !== null)
      .map((s) => [
        s.enrollmentId,
        { percentage: s.percentage!, threshold: config.attendance.examEligibilityThreshold },
      ]),
  );

  /*
   * Where these marks are in the approval chain.
   *
   * A lecturer who has submitted and hears nothing assumes it published. The
   * stage, and who is being waited on, are the two facts that stop them
   * chasing the wrong office when a student says a result is missing.
   */
  const sheet = await sheetFor({ schoolId, offeringId: offering.id });
  const stage = sheet?.stage ?? 'DRAFT';

  const graded = offering.enrollments.filter((e) => e.gradePoint !== null);

  // Class statistics, computed from the same pure functions the transcript
  // uses — so the mean the instructor sees is the mean that reached the record.
  const classStats = computeGpa(
    graded.map((e) => ({
      enrollmentId: e.id,
      courseId: offering.courseId,
      courseCode: offering.course.code,
      courseTitle: offering.course.title,
      creditHours: offering.course.creditHours,
      gradePoint: e.gradePoint,
      letterGrade: e.letterGrade,
      totalScore: e.totalScore,
      termSequence: 1,
    })),
    false,
  );

  const scores = graded.map((e) => e.totalScore ?? 0);
  const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
  const passRate =
    graded.length === 0
      ? 0
      : (graded.filter((e) => (e.gradePoint ?? 0) >= 0.5).length / graded.length) * 100;

  const distribution = GRADE_SCALE.map((band) => ({
    letter: band.letter,
    count: graded.filter((e) => e.letterGrade === band.letter).length,
  }));

  return (
    <>
      <PageHeader
        title={`${offering.course.code}-${offering.section} — ${offering.course.title}`}
        description={`${offering.term.name} · ${offering.enrollments.length} students · ${offering.course.creditHours} credit hours`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offering.id}/coursework`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Coursework →
            </Link>
            <Link
              href={`/teaching/${offering.id}/quizzes`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Quizzes →
            </Link>
            <Link
              href={`/teaching/${offering.id}/attendance`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Attendance →
            </Link>
            <Link
              href={`/teaching/${offering.id}/modules`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Course content →
            </Link>
            <Link href="/teaching" className="text-sm text-brand-700 hover:underline">
              ← All sections
            </Link>
          </div>
        }
      />

      {offering.gradesPosted ? (
        <Alert tone="success" title="Grades have been posted" className="mb-4">
          Students can see these results. Further changes require a registrar override and are
          recorded in the audit log.
        </Alert>
      ) : (
        <Alert tone="info" title="Draft gradesheet" className="mb-4">
          Scores save as you submit, but stay hidden from students until you post them. Continuous
          assessment is out of {ASSESSMENT_WEIGHTS.ca}; the examination is out of{' '}
          {ASSESSMENT_WEIGHTS.exam}.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Graded"
          value={`${graded.length}/${offering.enrollments.length}`}
          sublabel={
            graded.length === offering.enrollments.length
              ? 'Complete'
              : `${offering.enrollments.length - graded.length} outstanding`
          }
          tone={graded.length === offering.enrollments.length ? 'success' : 'warning'}
        />
        <StatTile label="Class mean" value={mean.toFixed(1)} sublabel="out of 100" tone="brand" />
        <StatTile
          label="Pass rate"
          value={`${passRate.toFixed(0)}%`}
          tone={passRate >= 70 ? 'success' : passRate >= 50 ? 'warning' : 'danger'}
        />
        <StatTile label="Class GPA" value={classStats.gpa.toFixed(2)} sublabel="credit-weighted" />
      </div>

      {graded.length > 0 ? (
        <Card className="mt-4">
          <CardHeader title="Grade distribution" />
          <div className="flex items-end gap-3 px-5 py-4">
            {distribution.map((d) => {
              const pct = graded.length === 0 ? 0 : (d.count / graded.length) * 100;
              return (
                <div key={d.letter} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-xs tabular-nums text-slate-500">{d.count}</span>
                  <div className="flex h-24 w-full items-end">
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${Math.max(2, pct)}%` }}
                      title={`${d.letter}: ${d.count} student(s), ${pct.toFixed(0)}%`}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{d.letter}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {sheet && stage !== 'DRAFT' && (
        <Alert
          tone={stage === 'RELEASED' ? 'success' : 'info'}
          title={STAGE_LABELS[stage]}
          className="mt-4"
        >
          {stage === 'RELEASED'
            ? 'These results are on students’ records and count towards their CGPA.'
            : `Submitted and waiting on the ${waitingOn(stage)}. The marks cannot be changed while they are under review.`}
        </Alert>
      )}

      {sheet?.returnedReason && (
        <Alert tone="warning" title="These results were sent back" className="mt-4">
          {sheet.returnedReason}
        </Alert>
      )}

      <div className="mt-4">
        {offering.enrollments.length === 0 ? (
          <Card>
            <EmptyState
              title="No students registered"
              description="Students appear here once they register for this section."
            />
          </Card>
        ) : (
          <Gradesheet
            offeringId={offering.id}
            /*
             * Locked once submitted, for everybody and not only the lecturer.
             * A mark changing underneath a reviewer who has already approved
             * it is the exact failure the chain exists to prevent.
             */
            locked={!isEditable(stage)}
            rows={offering.enrollments.map((e) => ({
              enrollmentId: e.id,
              matricNumber: e.student.matricNumber,
              name: `${e.student.user.firstName} ${e.student.user.lastName}`,
              caScore: e.caScore,
              examScore: e.examScore,
              totalScore: e.totalScore,
              letterGrade: e.letterGrade,
              gradePoint: e.gradePoint,
              attendanceBar: barsByEnrolment.get(e.id) ?? null,
            }))}
          />
        )}
      </div>
    </>
  );
}
