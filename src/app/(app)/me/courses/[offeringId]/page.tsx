import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRoute } from '@/server/tenant-context';
import { enrolmentFor, loadSpaceForStudent } from '@/server/services/lms.service';
import type { ModuleItemKind } from '@/lib/domain/lms';
import { renderMarkdown } from '@/lib/domain/markdown';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
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
  const { db, schoolId, session, school } = await requireRoute('/me/courses');
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

  const modules: StudentModuleView[] = (space?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    items: module.items.map((item) => ({
      id: item.id,
      kind: item.kind as ModuleItemKind,
      title: item.title,
      externalUrl: item.externalUrl,
      // Rendered on the SERVER through the existing sanitiser, so what crosses
      // to the browser is already safe HTML rather than somebody's markdown.
      bodyHtml: item.kind === 'PAGE' && item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : null,
    })),
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

      {modules.length === 0 && locked.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing published yet"
            description={`${offering.instructor ? `${offering.instructor.user.lastName} has` : 'Your lecturer has'} not published any material for this course yet. It will appear here.`}
          />
        </Card>
      ) : (
        <CourseModules modules={modules} />
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

