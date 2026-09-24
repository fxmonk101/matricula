import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { ModuleItemKind } from '@/lib/domain/lms';
import { requireTenantRole } from '@/server/tenant-context';
import {
  loadSubjectSpaceForTeacher,
  mayAuthorSubject,
} from '@/server/services/k12-lms.service';
import { PageHeader } from '@/components/ui';
import { SubjectContent, type SubjectModuleView } from './subject-content';

export const metadata: Metadata = { title: 'Subject content' };

/**
 * A teacher's content for one subject taught to one form class.
 *
 * Two gates, as everywhere: the route guard says who may be in /classes at
 * all, and `mayAuthorSubject` says whether this particular class is theirs.
 * The second cannot be answered by a role.
 */
export default async function SubjectContentPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { db, schoolId, session, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: classId, assignmentId } = await params;

  const assignment = await db.subjectAssignment.findFirst({
    // Scoped by the form class in the URL too: an id from another class must
    // not open here just because the role would allow it there.
    where: { id: assignmentId, formClassId: classId },
    include: {
      subject: { select: { code: true, name: true } },
      formClass: { select: { name: true } },
      term: { select: { name: true } },
    },
  });
  if (!assignment) notFound();

  const allowed = await mayAuthorSubject({
    schoolId,
    subjectAssignmentId: assignmentId,
    instructorProfileId: session.pid,
    role,
  });
  if (!allowed) redirect('/forbidden');

  const space = await loadSubjectSpaceForTeacher({ schoolId, subjectAssignmentId: assignmentId });

  const modules: SubjectModuleView[] = (space?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    isPublished: module.isPublished,
    items: module.items.map((item) => ({
      id: item.id,
      kind: item.kind as ModuleItemKind,
      title: item.title,
      isPublished: item.isPublished,
      externalUrl: item.externalUrl,
    })),
  }));

  return (
    <>
      <PageHeader
        title={`${assignment.subject.name} — ${assignment.formClass.name}`}
        description={`${assignment.subject.code} · ${assignment.term.name}`}
        actions={
          <Link
            href={`/classes/${classId}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← {assignment.formClass.name}
          </Link>
        }
      />

      <SubjectContent classId={classId} assignmentId={assignmentId} modules={modules} />
    </>
  );
}
