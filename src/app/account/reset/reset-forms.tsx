'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';

import { Alert, Button, Field, Input } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';
import { PASSWORD_MIN } from '@/lib/domain/profile';
import { completeResetAction, requestResetAction, type ResetFormState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Working…' : label}
    </Button>
  );
}

/** Ask for a link. */
export function RequestResetForm({
  schoolSlug,
  backTo,
}: {
  schoolSlug: string | null;
  backTo: string;
}) {
  const [state, action] = useActionState<ResetFormState, FormData>(requestResetAction, {});

  /*
   * The confirmation replaces the form rather than sitting beside it. Leaving
   * the form up invites a second and third press, and each one is another email
   * to somebody who may not have asked for the first.
   */
  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Check your email">
          {state.message}
        </Alert>
        {state.localMailPath && (
          <Alert tone="info" title="Development only">
            No mail server is configured, so nothing was actually sent. The message — including
            the link — was written to <code className="break-all">{state.localMailPath}</code>.
          </Alert>
        )}
        <Link
          href={backTo}
          className="block text-center text-sm font-medium text-brand-700 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.message && !state.ok && (
        <Alert tone="danger" title="Not sent">
          {state.message}
        </Alert>
      )}

      {schoolSlug && <input type="hidden" name="schoolSlug" value={schoolSlug} />}

      <Field
        label="Email or username"
        htmlFor="identifier"
        required
        hint="Whichever you use to sign in."
      >
        <Input
          id="identifier"
          name="identifier"
          required
          autoComplete="username"
          autoFocus
          placeholder="you@school.edu"
        />
      </Field>

      <Submit label="Email me a reset link" />

      <p className="text-center text-xs leading-relaxed text-slate-500">
        No email address on your account? Your school office can reset it for you in person —
        which is how most schools would rather do it anyway.
      </p>

      <Link
        href={backTo}
        className="block text-center text-sm font-medium text-brand-700 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}

/** Choose the new password. */
export function CompleteResetForm({ token, firstName }: { token: string; firstName?: string }) {
  const [state, action] = useActionState<ResetFormState, FormData>(completeResetAction, {});

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password reset">
          {state.message}
        </Alert>
        <Link
          href="/login"
          className="block rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-onInk hover:bg-slate-800"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.message && (
        <Alert tone="danger" title="Not changed">
          {state.message}
        </Alert>
      )}

      {/* The token travels WITH the password, so the form carries no authority
          of its own and cannot be replayed without it. */}
      <input type="hidden" name="token" value={token} />

      {firstName && <p className="text-sm text-slate-600">Hello {firstName}. Choose a new password.</p>}

      <Field
        label="New password"
        htmlFor="newPassword"
        required
        hint={`At least ${PASSWORD_MIN} characters. A long phrase beats a short one with symbols in it.`}
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          required
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          autoFocus
        />
      </Field>

      <Field label="Repeat it" htmlFor="confirmPassword" required>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          required
          autoComplete="new-password"
        />
      </Field>

      <Submit label="Set my new password" />
    </form>
  );
}
