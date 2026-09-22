'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { markPercentage } from '@/lib/domain/gradebook';
import { formatBytes } from '@/lib/domain/upload';
import { markSubmissionAction, type MarkFormState } from './actions';

/**
 * The marking view.
 *
 * SPLIT SCREEN, as the PRD asks: the work on the left, the mark on the right.
 * The point is that a marker never has to hold a page in their head while
 * looking at a form somewhere else.
 *
 * Moving between students is a list rather than only next/previous, because
 * marking is not always sequential — a marker returns to the one they were
 * unsure about, and hunting for them through "next" fifteen times is how a
 * marking session becomes unpleasant.
 */

export interface MarkRow {
  submissionId: string | null;
  enrollmentId: string;
  studentName: string;
  matricNumber: string;
  attempt: number | null;
  submittedAt: string | null;
  isLate: boolean;
  textBody: string | null;
  fileName: string | null;
  fileSize: number | null;
  score: number | null;
  feedback: string | null;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function Marker({
  offeringId,
  courseworkId,
  pointsPossible,
  rows,
}: {
  offeringId: string;
  courseworkId: string;
  pointsPossible: number;
  rows: MarkRow[];
}) {
  const [state, action] = useActionState<MarkFormState, FormData>(markSubmissionAction, {});
  const { push } = useToast();

  // Start on the first person who has handed something in and has no mark —
  // which is who the marker opened this page to deal with.
  const [index, setIndex] = useState(() => {
    const next = rows.findIndex((r) => r.submissionId !== null && r.score === null);
    return next === -1 ? 0 : next;
  });

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Marked' : 'Not saved',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody>
          <Alert tone="info" title="Nobody is enrolled on this section">
            Marks appear here once students are registered and have submitted.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  const current = rows[Math.min(index, rows.length - 1)];
  const marked = rows.filter((r) => r.score !== null).length;
  const submitted = rows.filter((r) => r.submissionId !== null).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      {/* --- who to mark ---------------------------------------------------- */}
      <Card className="h-fit">
        <CardHeader
          title="Students"
          description={`${marked} of ${submitted} submitted marked`}
        />
        <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((row, i) => (
            <li key={row.enrollmentId}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index}
                className={[
                  'flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors',
                  i === index ? 'bg-brand-50' : 'hover:bg-slate-50',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-900">
                    {row.studentName}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {row.matricNumber}
                  </span>
                </span>
                {row.score !== null ? (
                  <span className="shrink-0 text-xs tabular-nums font-medium text-emerald-700">
                    {row.score}
                  </span>
                ) : row.submissionId ? (
                  <Badge tone={row.isLate ? 'warning' : 'info'}>
                    {row.isLate ? 'late' : 'new'}
                  </Badge>
                ) : (
                  <span className="shrink-0 text-[11px] text-slate-400">—</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* --- the work, and the mark ----------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title={current.studentName}
            description={
              current.submittedAt
                ? `Attempt ${current.attempt} · ${current.submittedAt.slice(0, 16).replace('T', ' ')}`
                : 'Nothing submitted'
            }
            actions={
              current.isLate ? <Badge tone="warning">Late</Badge> : undefined
            }
          />
          <CardBody>
            {!current.submissionId ? (
              <Alert tone="warning" title="This student has not submitted">
                There is nothing to mark. If they hand in later it will appear here, and you can
                come back to it.
              </Alert>
            ) : (
              <div className="space-y-4">
                {current.textBody && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-700">Their answer</p>
                    <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
                      {current.textBody}
                    </div>
                  </div>
                )}

                {current.fileName && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-700">Their file</p>
                    {/*
                      Addressed by SUBMISSION, never by storage key — the route
                      resolves the row and checks that this marker may read it.
                    */}
                    <a
                      href={`/submissions/${current.submissionId}/file`}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                    >
                      {current.fileName}
                      {current.fileSize ? (
                        <span className="text-xs text-slate-500">
                          {formatBytes(current.fileSize)}
                        </span>
                      ) : null}
                    </a>
                  </div>
                )}

                {!current.textBody && !current.fileName && (
                  <Alert tone="warning">This submission is empty.</Alert>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Mark" description={`Out of ${pointsPossible}.`} />
          <CardBody>
            {current.submissionId ? (
              <form
                action={action}
                className="space-y-4"
                // Remounted per student, so the fields carry that student's
                // mark rather than the previous one's.
                key={current.submissionId}
              >
                <input type="hidden" name="offeringId" value={offeringId} />
                <input type="hidden" name="courseworkId" value={courseworkId} />
                <input type="hidden" name="submissionId" value={current.submissionId} />

                <Field
                  label="Score"
                  htmlFor="score"
                  required
                  hint={
                    current.score !== null
                      ? `Currently ${current.score} (${markPercentage(current.score, pointsPossible)}%).`
                      : undefined
                  }
                >
                  <Input
                    id="score"
                    name="score"
                    type="number"
                    step="any"
                    min={0}
                    required
                    autoFocus
                    defaultValue={current.score ?? ''}
                  />
                </Field>

                <Field label="Feedback" htmlFor="feedback" hint="The student sees this.">
                  <Textarea
                    id="feedback"
                    name="feedback"
                    rows={8}
                    defaultValue={current.feedback ?? ''}
                  />
                </Field>

                <Submit label={current.score !== null ? 'Update the mark' : 'Save the mark'} />
              </form>
            ) : (
              <p className="text-xs text-slate-500">Nothing to mark yet.</p>
            )}

            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                ← Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={index >= rows.length - 1}
                onClick={() => setIndex((i) => Math.min(rows.length - 1, i + 1))}
              >
                Next →
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
