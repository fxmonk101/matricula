'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { approveAction, returnAction, type ApprovalFormState } from './actions';

/**
 * Approve, or send back with a reason.
 *
 * The two buttons are deliberately NOT symmetrical. Approving is one click,
 * because an office signing off forty sheets in an afternoon should not be made
 * to type; sending one back opens a box and will not submit empty, because a
 * sheet returned with no reason is a lecturer guessing at what to change.
 */

function Pending({ label, variant }: { label: string; variant?: 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function DecisionPanel({ offeringId, code }: { offeringId: string; code: string }) {
  const [approveState, approve] = useActionState<ApprovalFormState, FormData>(approveAction, {});
  const [returnState, sendBack] = useActionState<ApprovalFormState, FormData>(returnAction, {});
  const { push } = useToast();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const state = approveState.message ? approveState : returnState.message ? returnState : null;
    if (!state?.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? code : 'Not changed',
      body: state.message,
    });
    if (state.ok) {
      setReturning(false);
      setReason('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveState, returnState]);

  if (returning) {
    return (
      <form action={sendBack} className="w-full space-y-2">
        <input type="hidden" name="offeringId" value={offeringId} />
        <Textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          required
          placeholder="What does the lecturer need to change?"
        />
        <div className="flex gap-2">
          <Pending label="Send back" />
          <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>
            Cancel
          </Button>
        </div>
        {returnState.ok === false && returnState.message && (
          <Alert tone="danger">{returnState.message}</Alert>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={approve}>
        <input type="hidden" name="offeringId" value={offeringId} />
        <Pending label="Approve" />
      </form>
      <Button type="button" size="sm" variant="secondary" onClick={() => setReturning(true)}>
        Send back
      </Button>
    </div>
  );
}
