import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering } from '@/server/services/lms.service';
import { loadQuizForTeacher } from '@/server/services/quiz.service';
import { Alert, PageHeader } from '@/components/ui';
import { QuizBuilder } from '../quiz-builder';
import { PublishPanel } from './publish-panel';

export const metadata: Metadata = { title: 'Quiz' };

export default async function EditQuizPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { db, schoolId, session, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId, itemId } = await params;

  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  const quiz = await loadQuizForTeacher({ schoolId, itemId });
  // Also confirms it belongs to THIS offering: an id from another section must
  // not open here just because the role would allow it there.
  if (!quiz || quiz.offeringId !== offeringId) notFound();

  const modules = await db.courseModule.findMany({
    where: { space: { offeringId } },
    orderBy: { position: 'asc' },
    select: { id: true, title: true },
  });

  const locked = quiz.attemptsSoFar > 0;

  return (
    <>
      <PageHeader
        title={quiz.title}
        description={`${quiz.questions.length} questions · ${quiz.pointsPossible} marks`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offeringId}/quizzes/${itemId}/results`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Results →
            </Link>
            <Link
              href={`/teaching/${offeringId}/quizzes`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              ← All quizzes
            </Link>
          </div>
        }
      />

      <PublishPanel
        offeringId={offeringId}
        itemId={itemId}
        isPublished={quiz.isPublished}
        questions={quiz.questions.length}
        sat={quiz.attemptsSoFar}
      />

      {locked && (
        <Alert tone="info" className="mt-4">
          {quiz.attemptsSoFar} {quiz.attemptsSoFar === 1 ? 'student has' : 'students have'} sat
          this. The paper is frozen — see the results instead.
        </Alert>
      )}

      <div className="mt-4">
        <QuizBuilder
          offeringId={offeringId}
          moduleId={quiz.moduleId}
          itemId={itemId}
          modules={modules}
          locked={locked}
          initial={{
            title: quiz.title,
            instructions: quiz.instructions,
            dueAt: quiz.dueAt ? quiz.dueAt.toISOString().slice(0, 16) : null,
            acceptsLate: quiz.acceptsLate,
            settings: quiz.settings,
            questions: quiz.questions,
          }}
        />
      </div>
    </>
  );
}
