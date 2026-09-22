import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'My courses' };

/**
 * The courses this student is registered on, this term.
 *
 * Driven off `Enrollment`, which is the only thing that links a student to a
 * course in this system — so a student who has not registered sees nothing
 * here, and is told to go and register rather than shown an empty list.
 */
export default async function MyCoursesPage() {
  const { db, session, school } = await requireRoute('/me/courses');

  if (!session.pid) {
    return (
      <>
        <PageHeader title="My courses" />
        <Alert tone="warning" title="Your account has no student record">
          This sign-in is a student account but is not attached to a student record, so it has no
          registrations. The registry can put that right.
        </Alert>
      </>
    );
  }

  const enrolments = await db.enrollment.findMany({
    where: {
      studentId: session.pid,
      status: { in: ['REGISTERED', 'COMPLETED', 'WAITLISTED'] },
      offering: { term: { isCurrent: true } },
    },
    include: {
      offering: {
        include: {
          course: true,
          term: true,
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
          space: {
            include: {
              modules: {
                where: { isPublished: true },
                include: { items: { where: { isPublished: true }, select: { id: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { offering: { course: { code: 'asc' } } },
  });

  return (
    <>
      <PageHeader
        title="My courses"
        description={`What you are registered on at ${school.shortName} this term.`}
      />

      {enrolments.length === 0 ? (
        <Card>
          <EmptyState
            title="You are not registered on anything this term"
            description="Course material appears here once you have registered. Registration is under Registration in the menu."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {enrolments.map((enrolment) => {
            const offering = enrolment.offering;

            /*
             * Counted from the PUBLISHED rows only — the query above filters
             * drafts out before they are ever loaded, so there is no
             * unpublished item anywhere in this payload to count or to leak.
             */
            const available = (offering.space?.modules ?? []).reduce(
              (sum, module) => sum + module.items.length,
              0,
            );

            return (
              <Card key={enrolment.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{offering.course.code}</span>
                      {enrolment.status === 'WAITLISTED' && <Badge tone="warning">Waitlisted</Badge>}
                    </span>
                  }
                  description={offering.course.title}
                />
                <div className="px-5 pb-4">
                  <p className="text-xs text-slate-500">
                    {offering.instructor
                      ? `${offering.instructor.user.firstName} ${offering.instructor.user.lastName}`
                      : 'No lecturer assigned'}
                    {' · '}
                    {offering.course.creditHours} credits
                  </p>

                  <p className="mt-2 text-xs text-slate-600">
                    {available === 0
                      ? 'No material published yet.'
                      : `${available} item${available === 1 ? '' : 's'} to work through.`}
                  </p>

                  <Link
                    href={`/me/courses/${offering.id}`}
                    className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
                  >
                    Open course →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
