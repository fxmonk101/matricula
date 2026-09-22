import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireRoute } from '@/server/tenant-context';
import { enrolmentFor } from '@/server/services/lms.service';
import {
  loadCourseworkForStudent,
  submissionHistory,
} from '@/server/services/coursework.service';
import {
  STATE_LABELS,
  dueIn,
  isLate,
  parseRubric,
  submissionState,
} from '@/lib/domain/coursework';
import { renderMarkdown } from '@/lib/domain/markdown';
import { formatBytes } from '@/lib/domain/upload';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, StatTile, Table, Td, Th } from '@/components/ui';
import { SubmitForm } from './submit-form';

export const metadata: Metadata = { title: 'Assignment' };

/**
 * One piece of work, from the student's side: what was asked, when it is due,
 * what they have already sent, and the form to send more.
 */
export default async function StudentCourseworkPage({
  params,
}: {
  params: Promise<{ offeringId: string; courseworkId: string }>;
}) {
  const { schoolId, session } = await requireRoute('/me/courses');
  const { offeringId, courseworkId } = await params;

  // Returns null for anything unpublished, so a draft cannot be reached by
  // guessing an id — there is no flag here for a caller to forget to check.
  const coursework = await loadCourseworkForStudent({ schoolId, courseworkId });
  if (!coursework) notFound();

  const enrolment = session.pid
    ? await enrolmentFor({ schoolId, offeringId, studentProfileId: session.pid })
    : null;

  if (!enrolment) {
    return (
      <>
        <PageHeader title={coursework.moduleItem.title} />
        <Alert tone="warning" title="You are not registered on this course">
          Assignments are only available to students registered on the course they belong to.
        </Alert>
      </>
    );
  }

  const now = new Date();
  const attempts = await submissionHistory({ schoolId, courseworkId, enrollmentId: enrolment.id });
  const latest = attempts[0] ?? null;

  const rules = {
    allowsText: coursework.allowsText,
    allowsFile: coursework.allowsFile,
    acceptsLate: coursework.acceptsLate,
    dueAt: coursework.dueAt,
  };
  const state = submissionState(latest, rules, now);
  const rubric = parseRubric(coursework.rubricJson);
  const overdue = isLate(coursework.dueAt, now);

  return (
    <>
      <PageHeader
        title={coursework.moduleItem.title}
        description={`Worth ${coursework.pointsPossible} marks`}
        actions={
          <Link
            href={`/me/courses/${offeringId}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← Back to the course
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Status"
          value={STATE_LABELS[state]}
          tone={
            state === 'GRADED'
              ? 'success'
              : state === 'CLOSED'
                ? 'danger'
                : state === 'SUBMITTED_LATE'
                  ? 'warning'
                  : state === 'SUBMITTED'
                    ? 'success'
                    : 'neutral'
          }
        />
        <StatTile
          label="Due"
          value={coursework.dueAt ? coursework.dueAt.toISOString().slice(0, 10) : 'No deadline'}
          sublabel={dueIn(coursework.dueAt, now) ?? undefined}
          tone={overdue && state === 'NOT_SUBMITTED' ? 'danger' : 'neutral'}
        />
        <StatTile label="Attempts" value={attempts.length} />
        <StatTile
          label="Mark"
          value={
            latest?.score !== null && latest?.score !== undefined
              ? `${latest.score} / ${coursework.pointsPossible}`
              : '—'
          }
          tone={latest?.gradedAt ? 'brand' : 'neutral'}
        />
      </div>

      {overdue && coursework.acceptsLate && state === 'NOT_SUBMITTED' && (
        <Alert tone="warning" title="This is overdue" className="mt-4">
          Late work is still accepted for this assignment, and will be recorded as late.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {coursework.instructions && (
            <Card>
              <CardHeader title="What to do" />
              <CardBody>
                <div
                  className="prose-sm max-w-none text-sm leading-relaxed text-slate-800"
                  // Sanitised on the server by the renderer the forums use.
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(coursework.instructions) }}
                />
              </CardBody>
            </Card>
          )}

          <SubmitForm
            courseworkId={coursework.id}
            offeringId={offeringId}
            allowsText={coursework.allowsText}
            allowsFile={coursework.allowsFile}
            hasSubmitted={attempts.length > 0}
            closed={state === 'CLOSED'}
          />

          {latest?.gradedAt && latest.feedback && (
            <Card>
              <CardHeader title="Feedback" description="From your lecturer." />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {latest.feedback}
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {rubric.length > 0 && (
            <Card>
              <CardHeader title="How it is marked" />
              <ul className="divide-y divide-slate-100">
                {rubric.map((row, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                    <span className="text-xs text-slate-700">{row.criterion}</span>
                    <span className="shrink-0 text-xs tabular-nums font-medium text-slate-900">
                      {row.points}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="What you have sent"
              description="Every attempt is kept. Your lecturer marks the most recent."
            />
            {attempts.length === 0 ? (
              <div className="px-5 py-4 text-xs text-slate-500">Nothing submitted yet.</div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-12">#</Th>
                    <Th>Sent</Th>
                    <Th>File</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <Td className="text-xs tabular-nums text-slate-700">{attempt.attempt}</Td>
                      <Td className="text-xs tabular-nums text-slate-600">
                        {attempt.submittedAt.toISOString().slice(0, 16).replace('T', ' ')}
                        {attempt.isLate && (
                          <Badge tone="warning" className="ml-1">
                            late
                          </Badge>
                        )}
                      </Td>
                      <Td className="text-xs">
                        {attempt.fileKey ? (
                          // Addressed by SUBMISSION, never by storage key — the
                          // route resolves the row and checks who is asking.
                          <a
                            href={`/submissions/${attempt.id}/file`}
                            className="text-brand-700 hover:underline"
                          >
                            {attempt.fileName ?? 'file'}
                            {attempt.fileSize ? ` (${formatBytes(attempt.fileSize)})` : ''}
                          </a>
                        ) : (
                          <span className="text-slate-400">typed answer</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
