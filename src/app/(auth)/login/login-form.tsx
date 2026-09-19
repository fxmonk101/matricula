'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';
import { signInAction, type SignInState } from '../actions';

function SubmitButton() {
  // useFormStatus must be read from a child of the <form>, not the form itself.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ next, schoolSlug }: { next?: string; schoolSlug?: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signInAction, {});

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {/* Pins the tenant when signing in through /s/<slug>/login. Absent, the
          action falls back to the user's primary membership. */}
      {schoolSlug ? <input type="hidden" name="schoolSlug" value={schoolSlug} /> : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {/*
        `type="text"`, NOT `type="email"`.

        The browser refuses to submit an email input whose value has no
        at-sign, so a student typing their username would be blocked by the
        field itself — with a browser-native bubble the app cannot reword or
        even see. The field name stays `email` so password managers that have
        already saved a credential for it keep autofilling.
      */}
      <Field
        label="Email address or username"
        htmlFor="email"
        required
        hint="Whichever your institution issued you."
      >
        <Input
          id="email"
          name="email"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="you@university.edu or a.okafor"
        />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </Field>

      <div className="-mt-1 text-right">
        <Link
          href={schoolSlug ? `/account/reset?school=${schoolSlug}` : '/account/reset'}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Forgotten your password?
        </Link>
      </div>

      <SubmitButton />
    </form>
  );
}
