import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { can } from '@/lib/auth/rbac';
import {
  ensureSpaceForOffering,
  loadSpaceForTeacher,
  mayAuthorOffering,
} from '@/server/services/lms.service';
import { summariseSpace, type ModuleItemKind } from '@/lib/domain/lms';
import { Alert, PageHeader, StatTile } from '@/components/ui';
import { ModuleBuilder, type ModuleView } from './module-builder';

export const metadata: Metadata = { title: 'Course content' };

/**
 * Where a lecturer builds the course their students will read.
 *
 * Under `/teaching/[id]` rather than `/courses`, for two reasons: this is where
 * the gradesheet for the same section already lives, and the `/courses` guard
 * admits ADMISSIONS, who have no business reading coursework.
 */
export default async function CourseContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, schoolId, session, role, school } = await requireTenantRole(
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
      course: true,
      term: true,
      instructor: { include: { user: true } },
      _count: { select: { enrollments: true } },
    },
  });
  if (!offering) notFound();

  // Being allowed on the PAGE is not being allowed on the RECORD. The guard
  // admits every lecturer; this admits the lecturer of this section.
  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId: offering.id,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  // Created on first visit rather than alongside every offering: most sections
  // in a new school will never have content, and an empty container reads the
  // same as none to everything downstream.
  await ensureSpaceForOffering({ schoolId, offeringId: offering.id });
  const space = await loadSpaceForTeacher({ schoolId, offeringId: offering.id });

  const summary = summariseSpace(space?.modules ?? []);
  const mayPublish = can(role, 'lms:publish');

  const modules: ModuleView[] = (space?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    isPublished: module.isPublished,
    // Dates cross to the client as ISO strings; a Date cannot be serialised
    // into a client component.
    unlockAt: module.unlockAt?.toISOString() ?? null,
    items: module.items.map((item) => ({
      id: item.id,
      kind: item.kind as ModuleItemKind,
      title: item.title,
      isPublished: item.isPublished,
      externalUrl: item.externalUrl,
      dueAt: item.coursework?.dueAt?.toISOString() ?? null,
      meetingStartsAt: item.virtualClass?.startsAt.toISOString() ?? null,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Course content"
        description={`${offering.course.code} ${offering.section} · ${offering.term.name} · ${school.shortName}`}
        actions={
          <Link
            href={`/teaching/${offering.id}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Gradesheet →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Modules" value={summary.modules} sublabel={`${summary.publishedModules} published`} />
        <StatTile label="Items" value={summary.items} tone="brand" />
        <StatTile
          label="Students can see"
          value={summary.publishedItems}
          tone={summary.publishedItems > 0 ? 'success' : 'neutral'}
          sublabel={`of ${summary.items} items`}
        />
        <StatTile label="Enrolled" value={offering._count.enrollments} />
      </div>

      {summary.allDraft && (
        <Alert tone="warning" title="None of this is visible to students yet" className="mt-4">
          You have built {summary.items} item{summary.items === 1 ? '' : 's'} and published none of
          them. A student opening this course right now sees an empty page. Publish a module, and
          the items inside it, when you are ready.
        </Alert>
      )}

      <div className="mt-4">
        <ModuleBuilder
          offeringId={offering.id}
          spaceId={space?.id ?? null}
          modules={modules}
          mayPublish={mayPublish}
        />
      </div>
    </>
  );
}
