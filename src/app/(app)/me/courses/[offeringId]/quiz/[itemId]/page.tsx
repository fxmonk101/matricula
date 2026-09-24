import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { mayStartAttempt } from '@/lib/domain/quiz';
import { requireRoute } from '@/server/tenant-context';
import { enrolmentFor } from '@/server/services/lms.service';
import { attemptReview, loadPaper } from '@/server/services/quiz.service';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
} from '@/components/ui';
import { Paper } from './paper';
import { StartPanel } from './start-panel';

export const metadata: Metadata = { title: 'Quiz' };

/**
 * A student's quiz: the front page, the paper, or the result.
 *
 * One route rather than three, because they are one thing at different moments
 * and a student who refreshes mid-paper must land back on the paper. What is
 * shown is decided by the state of their attempt, never by a query parameter
 * they could change.
 */
export default async function StudentQuizPage({
  params,
}: {
  params: Promise<{ offeringId: string; itemId: string }>;
}) {
  const { db, schoolId, session } = await requireRoute('/me/courses');
  const { offeringId, itemId } = await params;

  const enrolment = session.pid
    ? await enrolmentFor({ schoolId, offeringId, studentProfileId: session.pid })
    : null;
  if (!enrolment) notFound();

  const item = await db.moduleItem.findFirst({
    where: { id: itemId, module: { space: { offeringId } } },
    include: {
      module: { select: { isPublished: true, unlockAt: true, title: true } },
      coursework: { include: { quiz: { select: { id: true, maxAttempts: true, timeLimitMinutes: true } } } },
    },
  });

  /*
   * Unpublished, locked, or not a quiz at all — all 404. A student following a
   * link a lecturer pasted too early learns nothing about what is behind it.
   */
  if (
    !item?.coursework?.quiz ||
    !item.isPublished ||
    !item.module.isPublished ||
    (item.module.unlockAt && new Date() < item.module.unlockAt)
  ) {
    notFound();
  }

  const quiz = item.coursework.quiz;
  const now = new Date();

  const attempts = await db.quizAttempt.findMany({
    where: { quizId: quiz.id, enrollmentId: enrolment.id },
    orderBy: { attempt: 'desc' },
  });

  const open = attempts.find((a) => a.submittedAt === null) ?? null;

  const header = (
    <PageHeader
      title={item.title}
      description={`${item.module.title} · ${item.coursework.pointsPossible} marks`}
      actions={
        <Link
          href={`/me/courses/${offeringId}`}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          ← Back to the course
        </Link>
      }
    />
  );

  // ------------------------------------------------------------ sitting it
  if (open) {
    const paper = await loadPaper({
      schoolId,
      attemptId: open.id,
      enrollmentId: enrolment.id,
      now,
    });
    if (!paper) notFound();

    return (
      <>
        {header}
        <Paper
          offeringId={offeringId}
          itemId={itemId}
          attemptId={paper.attemptId}
          title={paper.quizTitle}
          instructions={paper.instructions}
          questions={paper.questions}
          initialAnswers={paper.answers}
          secondsRemaining={paper.secondsRemaining}
        />
      </>
    );
  }

  // ------------------------------------------------------------- finished
  const latest = attempts[0] ?? null;
  const review = latest
    ? await attemptReview({ schoolId, attemptId: latest.id, enrollmentId: enrolment.id, now })
    : null;

  const canStart = mayStartAttempt({
    attemptsSoFar: attempts.length,
    maxAttempts: quiz.maxAttempts,
    dueAt: item.coursework.dueAt,
    acceptsLate: item.coursework.acceptsLate,
    now,
  });

  return (
    <>
      {header}

      {review && (
        <Card className="mb-4">
          <CardHeader
            title="Your result"
            description={`Handed in ${review.submittedAt.toISOString().slice(0, 16).replace('T', ' ')}`}
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Score"
                value={`${review.score} / ${review.possible}`}
                tone={review.score >= review.possible / 2 ? 'success' : 'warning'}
              />
              <StatTile
                label="Percentage"
                value={
                  review.possible > 0
                    ? `${Math.round((review.score / review.possible) * 100)}%`
                    : '—'
                }
              />
              <StatTile label="Attempts used" value={`${attempts.length} of ${quiz.maxAttempts}`} />
            </div>

            {review.needsReview && (
              <Alert tone="info" className="mt-4">
                Some of your typed answers did not exactly match what was expected, so your
                lecturer will look at them. Your mark may go up.
              </Alert>
            )}

            {!review.reveal && (
              <Alert tone="info" className="mt-4">
                The answers are not being shown for this quiz.
              </Alert>
            )}

            {review.reveal && (
              <ul className="mt-4 space-y-3">
                {review.questions.map((question, i) => (
                  <li key={question.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                        {i + 1}. {question.prompt}
                      </span>
                      <Badge tone={question.correct ? 'success' : 'danger'}>
                        {question.earned} / {question.points}
                      </Badge>
                    </div>

                    <ul className="mt-2 space-y-1">
                      {question.options.map((option) => {
                        const chose = (question.given?.optionIds ?? []).includes(option.id);
                        return (
                          <li
                            key={option.id}
                            className={[
                              'rounded px-2 py-1 text-xs',
                              option.isCorrect
                                ? 'bg-emerald-50 text-emerald-900'
                                : chose
                                  ? 'bg-rose-50 text-rose-900'
                                  : 'text-slate-600',
                            ].join(' ')}
                          >
                            {option.text}
                            {option.isCorrect && ' ✓'}
                            {chose && !option.isCorrect && ' — you chose this'}
                          </li>
                        );
                      })}
                    </ul>

                    {question.given?.text !== undefined && (
                      <p className="mt-2 text-xs text-slate-600">
                        You answered: <span className="font-medium">{question.given.text}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {canStart.ok ? (
        <StartPanel
          offeringId={offeringId}
          itemId={itemId}
          timeLimitMinutes={quiz.timeLimitMinutes}
          attemptsLeft={quiz.maxAttempts - attempts.length}
          marks={item.coursework.pointsPossible}
          instructions={item.coursework.instructions}
          retake={attempts.length > 0}
        />
      ) : (
        !review && (
          <Card>
            <EmptyState title="This quiz is closed" description={canStart.reason} />
          </Card>
        )
      )}

      {!canStart.ok && review && (
        <Alert tone="info">{canStart.reason}</Alert>
      )}
    </>
  );
}
