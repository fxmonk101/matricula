'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import { registerAction, dropAction, type RegistrationFormState } from './actions';

function Pending({
  idle,
  busy,
  ...rest
}: { idle: string; busy: string } & React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || rest.disabled} {...rest}>
      {pending ? busy : idle}
    </Button>
  );
}

export function RegisterButton({
  offeringId,
  disabled,
  full,
}: {
  offeringId: string;
  disabled: boolean;
  full: boolean;
}) {
  const [state, action] = useActionState<RegistrationFormState, FormData>(registerAction, {});

  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="offeringId" value={offeringId} />
      <Pending
        idle={full ? 'Join waitlist' : 'Register'}
        busy="Working…"
        size="sm"
        variant={full ? 'secondary' : 'primary'}
        disabled={disabled}
        className="w-full"
      />

      {/* Server-side outcome, including the reasons the pure eligibility
          engine produced. The client preview and this must agree; when they
          don't, this is the one that is right. */}
      {state.message ? (
        <p className={`text-[11px] ${state.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {state.message}
        </p>
      ) : null}
      {state.reasons && state.reasons.length > 0 && !state.ok ? (
        <ul className="space-y-0.5">
          {state.reasons.map((r) => (
            <li key={r} className="text-[11px] text-rose-600">
              {r}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function DropButton({ enrollmentId }: { enrollmentId: string }) {
  const [state, action] = useActionState<RegistrationFormState, FormData>(dropAction, {});

  return (
    <form action={action}>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <Pending idle="Drop" busy="…" size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" />
      {state.message ? (
        <p className={`mt-1 text-[11px] ${state.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
