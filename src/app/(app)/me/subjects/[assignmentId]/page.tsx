import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { classTiming, startsIn } from '@/lib/domain/lms';
import { renderMarkdown } from '@/lib/domain/markdown';
import { requireRoute } from '@/server/tenant-context';
import {
  loadSubjectSpaceForPupil,
  pupilTakesSubject,
} from '@/server/services/k12-lms.service';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { CourseModules, type StudentModuleView } from '../../courses/[offeringId]/course-modules';

export const metadata: Metadata = { title: 'Subject' };

/**
 * One subject, as a pupil sees it.
 *
 * TWO INDEPENDENT CHECKS, both needed. The route guard says only a STUDENT gets
 * here; `pupilTakesSubject` says only a pupil in THIS form class gets to THIS
 * subject. Without the second, a pupil in 1B could read 1A's material by
 * editing the id in the address bar.
 *
 * What is loaded is already filtered — `loadSubjectSpaceForPupil` builds a
 * smaller result rather than marking rows hidden — so no draft exists in this
 * page's payload for anybody to find in the network tab.
 */
export default async function PupilSubjectPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { db, schoolId, session } = await requireRoute('/me/subjects');
  const { assignmentId } = await params;

  const takes = session.pid
    ? await pupilTakesSubject({
        schoolId,
        subjectAssignmentId: assignmentId,
        studentProfileId: session.pid,
      })
    : false;
  if (!takes) notFound();

  const assignment = await db.subjectAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      subject: { select: { code: true, name: true } },
      formClass: { select: { name: true } },
      teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!assignment) notFound();

  const now = new Date();
  const space = await loadSubjectSpaceForPupil({
    schoolId,
    subjectAssignmentId: assignmentId,
    now,
  });

  const modules: StudentModuleView[] = (space?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    items: module.items.map((item) => ({
      id: item.id,
      kind: item.kind as StudentModuleView['items'][number]['kind'],
      title: item.title,
      externalUrl: item.externalUrl,
      // Rendered on the SERVER through the sanitiser the forums already use,
      // so what crosses to the browser is safe HTML rather than markdown.
      bodyHtml:
        item.kind === 'PAGE' && item.bodyMarkdown ? renderMarkdown(item.bodyMarkdown) : null,
      courseworkId: null,
      dueLabel: null,
      stateLabel: null,
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
    })),
  }));

  return (
    <>
      <PageHeader
        title={assignment.subject.name}
        description={`${assignment.subject.code} · ${assignment.formClass.name}${
          assignment.teacher
            ? ` · ${assignment.teacher.user.firstName} ${assignment.teacher.user.lastName}`
            : ''
        }`}
        actions={
          <Link href="/me/subjects" className="text-xs font-medium text-brand-700 hover:underline">
            ← All subjects
          </Link>
        }
      />

      {modules.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing published yet"
            description="Your teacher has not put anything here yet. It will appear as they do."
          />
        </Card>
      ) : (
        <CourseModules modules={modules} offeringId={assignmentId} />
      )}
    </>
  );
}
