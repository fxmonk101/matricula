'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Badge, Button, Card, CardBody } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { setQuizPublishedAction, type QuizFormState } from '../actions';

/**
 * Publish, or withdraw.
 *
 * Kept out of the builder because it is a different kind of decision. Saving a
 * paper is reversible and private; publishing it puts it in front of a cohort,
 * and once somebody has sat it the paper can never be edited again. Those two
 * buttons should not sit next to each other looking alike.
 */

function ToggleButton({ publish, disabled }: { publish: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={publish ? 'primary' : 'secondary'}
      disabled={pending || disabled}
    >
      {pending ? 'Working…' : publish ? 'Publish' : 'Withdraw'}
    </Button>
  );
}

export function PublishPanel({
  offeringId,
  itemId,
  isPublished,
  questions,
  sat,
}: {
  offeringId: string;
  itemId: string;
  isPublished: boolean;
  questions: number;
  sat: number;
}) {
  const [state, action] = useActionState<QuizFormState, FormData>(setQuizPublishedAction, {});
  const { push } = useToast();

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Done' : 'Not changed',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const empty = questions === 0;

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={isPublished ? 'success' : 'neutral'}>
            {isPublished ? 'Published' : 'Draft'}
          </Badge>

          <span className="min-w-0 flex-1 text-xs text-slate-600">
            {isPublished
              ? sat > 0
                ? `Students can sit this. ${sat} ${sat === 1 ? 'has' : 'have'} done so.`
                : 'Students can sit this. Nobody has yet.'
              : 'Only you can see this. Publish it when the paper is ready.'}
          </span>

          <form action={action}>
            <input type="hidden" name="offeringId" value={offeringId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="publish" value={String(!isPublished)} />
            <ToggleButton publish={!isPublished} disabled={empty} />
          </form>
        </div>

        {empty && (
          <Alert tone="warning" className="mt-3">
            There are no questions yet, so there is nothing to publish.
          </Alert>
        )}

        {isPublished && sat > 0 && (
          <Alert tone="info" className="mt-3">
            Withdrawing it now hides it from students who have not sat it. Papers already handed in
            keep their marks.
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
