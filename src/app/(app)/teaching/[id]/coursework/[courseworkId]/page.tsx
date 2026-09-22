import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering } from '@/server/services/lms.service';
import { loadCourseworkForTeacher } from '@/server/services/coursework.service';
import { Card, CardHeader, PageHeader, StatTile } from '@/components/ui';
import { Marker, type MarkRow } from './marker';

export const metadata: Metadata = { title: 'Marking' };

/**
 * Marking one piece of coursework.
 *
 * The roster drives the list, not the submissions — so a student who handed in
 * nothing appears with a dash rather than being absent from the page. A marker
 * needs to see who has not submitted at least as much as who has.
 */
export default async function MarkCourseworkPage({
  params,
}: {
  params: Promise<{ id: string; courseworkId: string }>;
}) {
  const { db, schoolId, session, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId, courseworkId } = await params;

  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  const coursework = await loadCourseworkForTeacher({ schoolId, courseworkId });
  if (!coursework) notFound();

  // The coursework must belong to the offering in the URL, or a lecturer could
  // reach another section's marking by pairing their own offering id with it.
  if (coursework.moduleItem.module.space.offeringId !== offeringId) notFound();

  const enrolments = await db.enrollment.findMany({
    where: { offeringId, status: { in: ['REGISTERED', 'COMPLETED'] } },
    include: { student: { include: { user: true } } },
    orderBy: { student: { matricNumber: 'asc' } },
  });

  // Newest attempt per student; that is the one the student was told counts.
  const latest = new Map<string, (typeof coursework.submissions)[number]>();
  for (const submission of coursework.submissions) {
    if (!latest.has(submission.enrollmentId)) latest.set(submission.enrollmentId, submission);
  }

  const rows: MarkRow[] = enrolments.map((enrolment) => {
    const submission = latest.get(enrolment.id) ?? null;
    return {
      submissionId: submission?.id ?? null,
      enrollmentId: enrolment.id,
      studentName: `${enrolment.student.user.firstName} ${enrolment.student.user.lastName}`,
      matricNumber: enrolment.student.matricNumber,
      attempt: submission?.attempt ?? null,
      submittedAt: submission?.submittedAt.toISOString() ?? null,
      isLate: submission?.isLate ?? false,
      textBody: submission?.textBody ?? null,
      fileName: submission?.fileName ?? null,
      fileSize: submission?.fileSize ?? null,
      score: submission?.score ?? null,
      feedback: submission?.feedback ?? null,
    };
  });

  const submitted = rows.filter((r) => r.submissionId !== null).length;
  const marked = rows.filter((r) => r.score !== null).length;
  const late = rows.filter((r) => r.isLate).length;

  return (
    <>
      <PageHeader
        title={coursework.moduleItem.title}
        description={`Worth ${coursework.pointsPossible} marks${coursework.dueAt ? ` · due ${coursework.dueAt.toISOString().slice(0, 10)}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offeringId}/coursework`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              All coursework →
            </Link>
            <Link
              href={`/teaching/${offeringId}/modules`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Course content →
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Enrolled" value={rows.length} />
        <StatTile
          label="Submitted"
          value={submitted}
          tone={submitted > 0 ? 'brand' : 'neutral'}
          sublabel={`${rows.length - submitted} have not`}
        />
        <StatTile
          label="Marked"
          value={marked}
          tone={marked === submitted && submitted > 0 ? 'success' : 'warning'}
          sublabel={`of ${submitted} submitted`}
        />
        <StatTile label="Late" value={late} tone={late > 0 ? 'warning' : 'neutral'} />
      </div>

      {rows.length === 0 && (
        <Card className="mt-4">
          <CardHeader title="Nobody is registered on this section yet" />
        </Card>
      )}

      <div className="mt-4">
        <Marker
          offeringId={offeringId}
          courseworkId={coursework.id}
          pointsPossible={coursework.pointsPossible}
          rows={rows}
        />
      </div>
    </>
  );
}
