'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { PASSWORD_MIN, initialsOf } from '@/lib/domain/profile';
import {
  cancelPendingChangeAction,
  changePasswordAction,
  removeAvatarAction,
  saveAvatarAction,
  saveProfileAction,
  type ProfileFormState,
} from './actions';

function Submit({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

function useResult(state: ProfileFormState, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not saved',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export interface ProfileView {
  firstName: string;
  lastName: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

// -----------------------------------------------------------------------------

export function DetailsForm({ profile }: { profile: ProfileView }) {
  const [state, action] = useActionState<ProfileFormState, FormData>(saveProfileAction, {});
  useResult(state, 'Profile saved');

  return (
    <Card>
      <CardHeader
        title="Your details"
        description="What colleagues see, and how you sign in."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" required>
              <Input id="firstName" name="firstName" required defaultValue={profile.firstName} />
            </Field>
            <Field label="Last name" htmlFor="lastName" required>
              <Input id="lastName" name="lastName" required defaultValue={profile.lastName} />
            </Field>
          </div>

          <Field
            label="Username"
            htmlFor="username"
            hint="Letters, numbers, full stops, hyphens and underscores. You can sign in with this or with your email."
          >
            <Input
              id="username"
              name="username"
              defaultValue={profile.username ?? ''}
              placeholder="a.okafor"
              autoComplete="username"
            />
          </Field>

          <Field label="Phone" htmlFor="phone" hint="Optional.">
            <Input
              id="phone"
              name="phone"
              defaultValue={profile.phone ?? ''}
              placeholder="+234 803 000 0000"
              autoComplete="tel"
            />
          </Field>

          {/*
            Email is shown but not editable here. Changing the address a person
            is reached at is how an account gets taken over quietly, so it goes
            through the office — which is also where somebody can be identified
            in person.
          */}
          <Field label="Email" htmlFor="email" hint="Ask the office to change this.">
            <Input id="email" defaultValue={profile.email ?? 'None on file'} disabled />
          </Field>

          <Submit label="Save details" />
        </form>
      </CardBody>
    </Card>
  );
}

// -----------------------------------------------------------------------------

export function AvatarForm({ profile }: { profile: ProfileView }) {
  const [state, action] = useActionState<ProfileFormState, FormData>(saveAvatarAction, {});
  const [removeState, remove] = useActionState<ProfileFormState, FormData>(removeAvatarAction, {});
  useResult(state, 'Picture updated');
  useResult(removeState, 'Picture removed');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Profile picture" description="Shown beside your name across the school." />
      <CardBody>
        <form ref={formRef} action={action} className="flex flex-wrap items-center gap-5">
          <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-50 text-lg font-semibold text-brand-700 ring-1 ring-slate-900/5">
            {preview ?? profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview ?? profile.avatarUrl!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initialsOf(profile.firstName, profile.lastName)
            )}
          </span>

          <div className="min-w-0 flex-1 space-y-2">
            <input
              ref={fileRef}
              type="file"
              name="avatar"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Shown immediately, so somebody who picked the wrong photograph
                // finds out before they upload it rather than after.
                setPreview(file ? URL.createObjectURL(file) : null);
                if (file) formRef.current?.requestSubmit();
              }}
              className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:text-xs file:font-medium file:text-onInk hover:file:bg-slate-800"
            />
            <p className="text-[11px] text-slate-500">
              PNG, JPEG or WebP, up to 3 MB. It is cropped square and stored privately — only
              people signed in to this school can load it.
            </p>
          </div>
        </form>

        {profile.avatarUrl && (
          <form action={remove} className="mt-3">
            <Submit label="Remove picture" variant="secondary" />
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// -----------------------------------------------------------------------------

export function PasswordForm({
  confirmsByEmail,
  maskedEmail,
  mailDeliverable,
  pendingSince,
}: {
  confirmsByEmail: boolean;
  maskedEmail: string | null;
  mailDeliverable: boolean;
  pendingSince: string | null;
}) {
  const [state, action] = useActionState<ProfileFormState, FormData>(changePasswordAction, {});
  const [cancelState, cancel] = useActionState<ProfileFormState, FormData>(
    cancelPendingChangeAction,
    {},
  );
  useResult(state, state.pending ? 'Check your email' : 'Password changed');
  useResult(cancelState, 'Cancelled');

  return (
    <Card>
      <CardHeader
        title="Password"
        description={
          confirmsByEmail
            ? 'Changing it needs your current password and a link we email you.'
            : 'Changing it needs your current password.'
        }
      />
      <CardBody>
        {pendingSince && (
          <Alert tone="info" title="A change is waiting for confirmation" className="mb-4">
            You asked to change your password. It is not active until you open the link we sent.
            Your current password still works until then.
            <form action={cancel} className="mt-3">
              <Submit label="Cancel that change" variant="secondary" />
            </form>
          </Alert>
        )}

        {confirmsByEmail && !mailDeliverable && (
          <Alert tone="warning" title="No mail server is configured" className="mb-4">
            This deployment has no email provider set up, so a confirmation link cannot actually
            reach you. The message is written to a file on the server instead, which is fine for
            testing and is not fine in production — set <code>MAIL_DRIVER</code> before a real
            school relies on this.
          </Alert>
        )}

        {!confirmsByEmail && (
          <Alert tone="warning" title="This account has no email address" className="mb-4">
            There is nowhere to send a confirmation, so the change applies straight away on the
            strength of your current password. Ask the office to add an address if you would
            rather changes were confirmed.
          </Alert>
        )}

        <form action={action} className="space-y-4">
          <Field label="Current password" htmlFor="currentPassword" required>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="New password"
              htmlFor="newPassword"
              required
              hint={`At least ${PASSWORD_MIN} characters.`}
            >
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={PASSWORD_MIN}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Repeat it" htmlFor="confirmPassword" required>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
              />
            </Field>
          </div>

          <Submit
            label={confirmsByEmail ? `Email a confirmation to ${maskedEmail}` : 'Change password'}
          />
        </form>

        {state.localMailPath && (
          <Alert tone="info" title="Development only" className="mt-4">
            No mail was sent. The confirmation message — including the link — was written to{' '}
            <code className="break-all">{state.localMailPath}</code>.
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
