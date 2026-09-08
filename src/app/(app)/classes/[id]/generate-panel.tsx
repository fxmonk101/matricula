'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { generateReportsAction, type K12FormState } from './actions';

function RunButton({
  label,
  variant,
  disabled,
}: {
  label: string;
  variant: 'primary' | 'success';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending || disabled}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

export function GenerateReportsPanel({
  formClassId,
  pupils,
  marksComplete,
  alreadyPublished,
}: {
  formClassId: string;
  pupils: number;
  marksComplete: boolean;
  alreadyPublished: boolean;
}) {
  const [state, action] = useActionState<K12FormState, FormData>(generateReportsAction, {});

  return (
    <Card>
      <CardHeader
        title="End of term"
        description="Positions and promotion decisions are computed for the class as a whole, so this runs for everyone at once."
      />
      <CardBody className="space-y-3">
        {state.message ? (
          <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
        ) : null}

        {!marksComplete ? (
          <Alert tone="warning">
            Some mark sheets are incomplete. You can still generate drafts — unmarked subjects
            simply score nothing — but the positions will change once the missing marks arrive.
          </Alert>
        ) : null}

        {alreadyPublished ? (
          <Alert tone="info">
            Published cards are skipped by a re-run. What a guardian already holds cannot change
            underneath them.
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="formClassId" value={formClassId} />
            <input type="hidden" name="publish" value="false" />
            <RunButton label="Generate drafts" variant="primary" disabled={pupils === 0} />
          </form>
          <form action={action}>
            <input type="hidden" name="formClassId" value={formClassId} />
            <input type="hidden" name="publish" value="true" />
            <RunButton
              label="Generate & publish"
              variant="success"
              disabled={pupils === 0 || !marksComplete}
            />
          </form>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Publishing is refused until every subject is marked. A card with a blank subject tells a
          parent nothing about whether the pupil failed it or was never assessed.
        </p>
      </CardBody>
    </Card>
  );
}
