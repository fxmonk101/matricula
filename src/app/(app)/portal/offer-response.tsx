'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button } from '@/components/ui';
import { respondToOfferAction, type OfferState } from './actions';

function ResponseButton({
  decision,
  label,
}: {
  decision: 'accept' | 'decline';
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      variant={decision === 'accept' ? 'success' : 'secondary'}
      disabled={pending}
      className="flex-1"
    >
      {pending ? 'Sending…' : label}
    </Button>
  );
}

export function OfferResponse({ applicationId }: { applicationId: string }) {
  const [state, action] = useActionState<OfferState, FormData>(respondToOfferAction, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      {state.message ? (
        <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
      ) : null}
      <div className="flex gap-2">
        <ResponseButton decision="accept" label="Accept offer" />
        <ResponseButton decision="decline" label="Decline" />
      </div>
    </form>
  );
}
