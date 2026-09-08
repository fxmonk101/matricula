'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import { setPlatformAdminAction, type PlatformFormState } from '../actions';

function Submit({ grant, disabled }: { grant: boolean; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={grant ? 'primary' : 'danger'}
      disabled={pending || disabled}
      title={disabled ? 'Grant another operator before revoking this one.' : undefined}
    >
      {pending ? '…' : grant ? 'Grant' : 'Revoke'}
    </Button>
  );
}

export function OperatorControls({
  userId,
  label,
  grant,
  soleOperator,
}: {
  userId: string;
  label: string;
  grant: boolean;
  /** The last operator cannot revoke themselves out of the system. */
  soleOperator: boolean;
}) {
  const [state, action] = useActionState<PlatformFormState, FormData>(setPlatformAdminAction, {});

  return (
    <form
      action={action}
      className="inline-flex flex-col items-end gap-1"
      onSubmit={(event) => {
        // A native confirm rather than a modal: this is a two-a-year action on
        // a page an operator visits rarely, and the cost of a dialog component
        // here is not repaid.
        if (
          !grant &&
          !window.confirm(`Revoke platform access from ${label}? They keep their school accounts.`)
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="grant" value={String(grant)} />
      <Submit grant={grant} disabled={!grant && soleOperator} />
      {state.message && (
        <span className={state.ok ? 'text-[11px] text-emerald-700' : 'text-[11px] text-rose-700'}>
          {state.message}
        </span>
      )}
    </form>
  );
}
