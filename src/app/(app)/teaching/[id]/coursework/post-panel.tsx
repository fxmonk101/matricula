'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { postCourseworkAction, type MarkFormState } from './[courseworkId]/actions';

/**
 * Moving marked coursework onto the academic record.
 *
 * The consequences are stated BEFORE the button, in counts, because this is the
 * one control here that changes a student's transcript. The two checkboxes are
 * unticked by default and both are judgements only the lecturer can make:
 *
 *   · counting missing work as zero is right at the end of term and wrong in
 *     week six, and the system cannot tell which it is;
 *   · overwriting a hand-entered CA destroys somebody's deliberate decision —
 *     a viva mark, an agreed adjustment — so it has to be asked for.
 */

export interface PostCounts {
  toSet: number;
  toOverwrite: number;
  unchanged: number;
  nothingToPost: number;
  withUnmarkedWork: number;
  withMissingWork: number;
  caWeight: number;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Posting…' : 'Post to continuous assessment'}
    </Button>
  );
}

export function PostPanel({
  offeringId,
  counts,
  mayPost,
}: {
  offeringId: string;
  counts: PostCounts;
  mayPost: boolean;
}) {
  const [state, action] = useActionState<MarkFormState, FormData>(postCourseworkAction, {});
  const { push } = useToast();
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Posted' : 'Not posted',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!mayPost) {
    return (
      <Card>
        <CardHeader title="Continuous assessment" />
        <CardBody>
          <Alert tone="info">
            Your role can mark work but not originate a grade, so posting to continuous assessment
            belongs to the lecturer of record.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Post to continuous assessment"
        description={`Turns marked coursework into each student's CA score, out of ${counts.caWeight}.`}
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="offeringId" value={offeringId} />

          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Will be given a CA score</dt>
              <dd className="font-medium tabular-nums text-slate-900">{counts.toSet}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Already correct</dt>
              <dd className="font-medium tabular-nums text-slate-900">{counts.unchanged}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Nothing marked yet</dt>
              <dd className="font-medium tabular-nums text-slate-900">{counts.nothingToPost}</dd>
            </div>
            {counts.toOverwrite > 0 && (
              <div className="flex justify-between">
                <dt className="font-medium text-amber-700">CA entered by hand</dt>
                <dd className="font-medium tabular-nums text-amber-700">{counts.toOverwrite}</dd>
              </div>
            )}
          </dl>

          {counts.withUnmarkedWork > 0 && (
            <Alert tone="warning" title={`${counts.withUnmarkedWork} have work you have not marked`}>
              Unmarked work is left out of the calculation rather than counted as zero — so their
              CA is computed from what you have marked so far. Finish marking before posting if
              that matters.
            </Alert>
          )}

          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              name="countMissingAsZero"
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
            />
            <span>
              Count work nobody handed in as zero
              {counts.withMissingWork > 0 && (
                <span className="font-medium"> — affects {counts.withMissingWork} student{counts.withMissingWork === 1 ? '' : 's'}</span>
              )}
              . Right at the end of term; wrong halfway through.
            </span>
          </label>

          {counts.toOverwrite > 0 && (
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                name="overwriteExisting"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
              />
              <span>
                Replace the {counts.toOverwrite} CA mark{counts.toOverwrite === 1 ? '' : 's'}{' '}
                entered by hand. Those were typed by somebody on the gradesheet and may be a viva
                mark or an agreed adjustment.
              </span>
            </label>
          )}

          <Submit />

          <p className="text-[11px] leading-relaxed text-slate-500">
            This writes each student&rsquo;s CA score only. It does not enter an exam mark and does
            not mark anybody&rsquo;s enrolment complete — where an exam mark already exists, the
            total and letter grade are recalculated with it.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
