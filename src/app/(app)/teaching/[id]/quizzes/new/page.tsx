import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { ensureSpaceForOffering, mayAuthorOffering } from '@/server/services/lms.service';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { QuizBuilder } from '../quiz-builder';

export const metadata: Metadata = { title: 'New quiz' };

export default async function NewQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, schoolId, session, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId } = await params;

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: true },
  });
  if (!offering) notFound();

  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  // A quiz lives in a module, so the container has to exist before one can.
  await ensureSpaceForOffering({ schoolId, offeringId });

  const modules = await db.courseModule.findMany({
    where: { space: { offeringId } },
    orderBy: { position: 'asc' },
    select: { id: true, title: true },
  });

  return (
    <>
      <PageHeader
        title="New quiz"
        description={`${offering.course.code}${offering.section ? ` ${offering.section}` : ''}`}
        actions={
          <Link
            href={`/teaching/${offeringId}/quizzes`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← All quizzes
          </Link>
        }
      />

      {modules.length === 0 ? (
        <Card>
          <EmptyState
            title="Add a module first"
            description="A quiz sits inside a module, alongside the readings it belongs with."
          />
        </Card>
      ) : (
        <QuizBuilder offeringId={offeringId} moduleId={modules[0].id} modules={modules} />
      )}
    </>
  );
}
