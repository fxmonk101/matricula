'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';
import {
  MIN_PASSWORD_LENGTH,
  passwordProblems,
  passwordStrength,
  STRENGTH_LABELS,
} from '@/lib/domain/people';
import { changePasswordAction, type PasswordFormState } from './actions';

function SubmitButton({ forced }: { forced: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Saving…' : forced ? 'Set my password and continue' : 'Change password'}
    </Button>
  );
}

const METER_TONES = [
  'bg-slate-300',
  'bg-rose-500',
  'bg-amber-500',
  'bg-sky-500',
  'bg-emerald-500',
];

export function PasswordForm({
  forced,
  person,
}: {
  forced: boolean;
  person: { email?: string; firstName: string; lastName: string };
}) {
  const [state, action] = useActionState<PasswordFormState, FormData>(changePasswordAction, {});
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  // Checked with the SAME functions the server uses, so what the user is told
  // while typing is exactly what they will be refused for.
  const strength = passwordStrength(next);
  const problems = next.length > 0 ? passwordProblems(next, person) : [];
  const mismatch = confirm.length > 0 && next !== confirm;

  return (
    <form action={action} className="space-y-4">
      {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

      <Field
        label={forced ? 'The password you were given' : 'Current password'}
        htmlFor="currentPassword"
        required
        hint={
          forced
            ? 'Typed once more, to prove it is you sitting here and not somebody at your unlocked screen.'
            : undefined
        }
      >
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field
        label="New password"
        htmlFor="newPassword"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length is what makes a password hard to break — a long phrase beats a short one with symbols in it.`}
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>

      {next.length > 0 && (
        <div>
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i < strength ? METER_TONES[strength] : 'bg-slate-200'}`}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500" role="status">
            {STRENGTH_LABELS[strength]}
          </p>
          {problems.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {problems.map((p) => (
                <li key={p} className="text-[11px] text-rose-700">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        required
        error={mismatch ? 'The two passwords do not match.' : undefined}
      >
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <SubmitButton forced={forced} />
    </form>
  );
}
