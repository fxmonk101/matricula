import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering } from '@/server/services/lms.service';
import { loadQuizForTeacher, quizResults } from '@/server/services/quiz.service';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Quiz results' };

/**
 * What the cohort did.
 *
 * The per-question analysis is the part worth reading. A question the whole
 * cohort got wrong is usually a badly worded question rather than a cohort
 * that did not revise, and that is a finding a lecturer can act on this term.
 */
export default async function QuizResultsPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { schoolId, session, role } = await requireTenantRole(
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
  if (!quiz || quiz.offeringId !== offeringId) notFound();

  const results = await quizResults({ schoolId, itemId });
  if (!results) notFound();

  return (
    <>
      <PageHeader
        title={`${results.title} — results`}
        description={`${results.possible} marks`}
        actions={
          <Link
            href={`/teaching/${offeringId}/quizzes/${itemId}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← The paper
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Sat" value={results.summary.sat} />
        <StatTile
          label="Average"
          value={results.summary.average === null ? '—' : `${results.summary.average}`}
          sublabel={`out of ${results.possible}`}
        />
        <StatTile
          label="Range"
          value={
            results.summary.lowest === null
              ? '—'
              : `${results.summary.lowest}–${results.summary.highest}`
          }
        />
        <StatTile
          label="Need a look"
          value={results.summary.needsReview}
          tone={results.summary.needsReview > 0 ? 'warning' : 'success'}
        />
      </div>

      {results.summary.needsReview > 0 && (
        <Alert tone="warning" className="mt-4" title="Some typed answers did not match">
          Those are scored zero for now and flagged rather than trusted. Open the student&rsquo;s
          submission from the gradebook to change a mark.
        </Alert>
      )}

      {results.summary.sat === 0 ? (
        <Card className="mt-4">
          <EmptyState
            title="Nobody has sat this yet"
            description="Results and per-question analysis appear here as papers come in."
          />
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Per question"
              description="A question most of the cohort got wrong is usually a question worth rewriting."
            />
            <div className="overflow-x-auto">
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Question</Th>
                    <Th className="whitespace-nowrap">Right</Th>
                    <Th className="whitespace-nowrap">Rate</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.analysis.map((row, i) => (
                    <tr key={row.questionId}>
                      <Td className="text-xs">
                        <span className="text-slate-400">{i + 1}.</span> {row.prompt.slice(0, 90)}
                        {row.prompt.length > 90 ? '…' : ''}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        {row.correct} / {row.answered}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {row.percentCorrect === null ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <Badge
                            tone={
                              row.percentCorrect >= 70
                                ? 'success'
                                : row.percentCorrect >= 40
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {row.percentCorrect}%
                          </Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Papers" description="Most recent first." />
            <div className="overflow-x-auto">
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th className="whitespace-nowrap">Score</Th>
                    <Th className="whitespace-nowrap">Handed in</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.attempts.map((attempt) => (
                    <tr key={attempt.attemptId}>
                      <Td className="whitespace-nowrap text-xs">
                        <span className="font-medium text-slate-900">{attempt.name}</span>
                        <span className="block text-[11px] text-slate-500">
                          {attempt.matricNumber ?? '—'}
                          {attempt.attempt > 1 ? ` · attempt ${attempt.attempt}` : ''}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        <span className="font-medium text-slate-900">{attempt.score}</span>
                        <span className="text-slate-400"> / {results.possible}</span>
                        {attempt.needsReview && (
                          <Badge tone="warning" className="ml-2">
                            check
                          </Badge>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-[11px] text-slate-500">
                        {attempt.submittedAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
