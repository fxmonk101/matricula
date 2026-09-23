import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRoute } from '@/server/tenant-context';
import { enrolmentFor, loadSpaceForStudent } from '@/server/services/lms.service';
import type { ModuleItemKind } from '@/lib/domain/lms';
import { STATE_LABELS, dueIn, submissionState } from '@/lib/domain/coursework';
import { classTiming, startsIn } from '@/lib/domain/lms';
import { renderMarkdown } from '@/lib/domain/markdown';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { attendanceForEnrolment } from '@/server/services/attendance.service';
import { classesNeededToClear, formatRate } from '@/lib/domain/attendance';
import { CourseModules, type StudentModuleView } from './course-modules';

export const metadata: Metadata = { title: 'Course' };

/**
 * A student's view of one course.
 *
 * TWO INDEPENDENT CHECKS, both necessary. The route guard says only a STUDENT
 * reaches this page; `enrolmentFor` says only a student ON THIS COURSE reaches
 * THIS one. Without the second, any student could read any course by editing
 * the id in the address bar.
 *
 * What is loaded is already filtered: `loadSpaceForStudent` builds a smaller
 * result rather than marking rows hidden, so no draft exists in this page's
 * payload to be found by anybody who opens the network tab.
 */
export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { db, schoolId, session, school, config } = await requireRoute('/me/courses');
  const { offeringId } = await params;

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      course: true,
      term: true,
      instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!offering) notFound();

  const enrolment = session.pid
    ? await enrolmentFor({ schoolId, offeringId, studentProfileId: session.pid })
    : null;

  if (!enrolment) {
    // Deliberately an explanation rather than /forbidden: the commonest reason
    // to land here is having dropped the course, which is not an attack.
    return (
      <>
        <PageHeader title={offering.course.code} description={offering.course.title} />
        <Alert tone="warning" title="You are not registered on this course">
          Course material is only available to students registered on it. If you think that is
          wrong, the registry can check your registration.
        </Alert>
      </>
    );
  }

  const now = new Date();
  const space = await loadSpaceForStudent({ schoolId, offeringId, now });

  /*
   * Their own attendance, and the verdict under THIS school’s policy.
   *
   * Shown to the student rather than only to the lecturer, because the whole
   * value of an attendance rule is that somebody can act on it while there is
   * still term left. A student who first learns they are barred in the week of
   * the examination has been failed by the system, not by the rule.
   */
  const attendance = await attendanceForEnrolment({
    schoolId,
    enrollmentId: enrolment.id,
    policy: config.attendance,
  });

  /*
   * The actionable number: how many classes in a row would clear the bar.
   *
   * “You are below 75%” tells a student they have a problem. “Attending the
   * next four would fix it” tells them what to do about it, which is the only
   * reason to show them any of this while there is still term left.
   */
  const needed = classesNeededToClear(attendance, config.attendance);

  /*
   * This student's own latest attempt at each piece of coursework, fetched in
   * ONE query rather than one per assignment — a course with twenty pieces of
   * work would otherwise be twenty round trips to render a list.
   */
  const courseworkIds = (space?.modules ?? []).flatMap((module) =>
    module.items.flatMap((item) => (item.coursework ? [item.coursework.id] : [])),
  );

  const attempts = courseworkIds.length
    ? await db.submission.findMany({
        where: { courseworkId: { in: courseworkIds }, enrollmentId: enrolment.id },
        orderBy: { attempt: 'desc' },
      })
    : [];

  // Newest first, so the first one seen for a given piece of work is the latest.
  const latestByCoursework = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestByCoursework.has(attempt.courseworkId)) {
      latestByCoursework.set(attempt.courseworkId, attempt);
    }
  }

  const modules: StudentModuleView[] = (space?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    items: module.items.map((item) => {
      const coursework = item.coursework ?? null;
      const latest = coursework ? (latestByCoursework.get(coursework.id) ?? null) : null;

      return {
        id: item.id,
        kind: item.kind as ModuleItemKind,
        title: item.title,
        externalUrl: item.externalUrl,
        // Rendered on the SERVER through the existing sanitiser, so what crosses
        // to the browser is already safe HTML rather than somebody's markdown.
        bodyHtml:
          item.kind === 'PAGE' && item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : null,
        // A class can be joined from a little before it starts until it ends.
        // Fifteen minutes of grace, because students arrive early and a link
        // that refuses them until the exact second is simply annoying.
        timingLabel: item.virtualClass
          ? startsIn(item.virtualClass.startsAt, item.virtualClass.endsAt, now)
          : null,
        joinable: item.virtualClass
          ? classTiming(
              new Date(item.virtualClass.startsAt.getTime() - 15 * 60_000),
              item.virtualClass.endsAt,
              now,
            ) !== 'FINISHED'
          : false,
        fileName: item.fileName,
        courseworkId: coursework?.id ?? null,
        dueLabel: coursework?.dueAt ? dueIn(coursework.dueAt, now) : null,
        stateLabel: coursework
          ? STATE_LABELS[
              submissionState(
                latest,
                {
                  allowsText: true,
                  allowsFile: true,
                  // The list only needs to know whether it is still open, and
                  // acceptsLate is not on the summary projection — so a closed
                  // assignment reads as not-submitted here and says so plainly
                  // on the assignment page itself.
                  acceptsLate: true,
                  dueAt: coursework.dueAt,
                },
                now,
              )
            ]
          : null,
      };
    }),
  }));

  /*
   * Locked modules are listed but carry no contents. A student should know that
   * next week exists and when it opens; they should not receive it early.
   */
  const locked = (
    await db.courseModule.findMany({
      where: { space: { offeringId }, isPublished: true, unlockAt: { gt: now } },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, unlockAt: true },
    })
  ).map((module) => ({
    id: module.id,
    title: module.title,
    unlocksAt: module.unlockAt!.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title={`${offering.course.code} ${offering.section}`}
        description={`${offering.course.title} · ${offering.term.name}${
          offering.instructor
            ? ` · ${offering.instructor.user.firstName} ${offering.instructor.user.lastName}`
            : ''
        }`}
        actions={
          <Link href="/me/courses" className="text-xs font-medium text-brand-700 hover:underline">
            ← All courses
          </Link>
        }
      />

      {/*
        Attendance sits ABOVE the course content, not in a tab.

        A student who is short of the threshold needs to see it without going
        looking, and the only useful time to see it is while there are still
        classes left to attend.
      */}
      {attendance.percentage !== null && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-slate-500">Your attendance</span>
              <span className="mt-0.5 block text-lg font-semibold tabular-nums text-slate-900">
                {formatRate(attendance)}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {attendance.attended} of {attendance.counted} classes
                  {attendance.excused > 0 ? ` · ${attendance.excused} excused` : ''}
                </span>
              </span>
            </span>

            <Badge
              tone={
                attendance.verdict === 'BARRED' || attendance.verdict === 'BELOW'
                  ? 'danger'
                  : attendance.verdict === 'AT_RISK'
                    ? 'warning'
                    : 'success'
              }
            >
              {attendance.verdict === 'BARRED' || attendance.verdict === 'BELOW'
                ? 'Below the requirement'
                : attendance.verdict === 'AT_RISK'
                  ? 'Close to the limit'
                  : 'Meeting the requirement'}
            </Badge>
          </div>

          {/*
            BARRED and BELOW are the same shortfall; only the consequence
            differs. Both say so plainly, and neither is told they are
            “close to” a figure they are nowhere near — a student on 0% read
            that before this was split, and false reassurance is the one
            thing that would stop them acting while there is term left.
          */}
          {(attendance.verdict === 'BARRED' || attendance.verdict === 'BELOW') && (
            <Alert tone="danger" className="mx-5 mb-5">
              You have attended {attendance.attended} of {attendance.counted} classes, below the{' '}
              {config.attendance.examEligibilityThreshold}% this school requires to sit the
              examination.
              {needed !== null && needed > 0 && (
                <>
                  {' '}Attending the next {needed} {needed === 1 ? 'class' : 'classes'} would
                  bring you back above it.
                </>
              )}{' '}
              Speak to your lecturer or the faculty office — there may be absences that should
              have been recorded as excused.
            </Alert>
          )}

          {attendance.verdict === 'AT_RISK' && (
            <Alert tone="warning" className="mx-5 mb-5">
              You are close to the {config.attendance.examEligibilityThreshold}% this school
              requires to sit the examination. Missing more classes puts that at risk.
            </Alert>
          )}
        </Card>
      )}

      {modules.length === 0 && locked.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing published yet"
            description={`${offering.instructor ? `${offering.instructor.user.lastName} has` : 'Your lecturer has'} not published any material for this course yet. It will appear here.`}
          />
        </Card>
      ) : (
        <CourseModules modules={modules} offeringId={offeringId} />
      )}

      {locked.map((module) => (
        <Card key={module.id} className="mt-3">
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2 text-slate-500">
                <span>{module.title}</span>
                <Badge tone="info">
                  Opens {module.unlocksAt.slice(0, 16).replace('T', ' ')}
                </Badge>
              </span>
            }
            description="This module is not open yet."
          />
        </Card>
      ))}
    </>
  );
}

