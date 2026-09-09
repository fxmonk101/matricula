'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@/components/ui';
import { isValidEmail } from '@/lib/domain/people';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
import { createPersonAction, type PeopleFormState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Adding…' : 'Add person'}
    </Button>
  );
}

export function AddPersonPanel({
  orgUnits,
  assignableRoles,
}: {
  orgUnits: { id: string; name: string }[];
  assignableRoles: Role[];
}) {
  const [state, action] = useActionState<PeopleFormState, FormData>(createPersonAction, {});
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('INSTRUCTOR');

  const emailLooksWrong = email.trim().length > 0 && !isValidEmail(email);

  // The one-time password screen REPLACES the form. It is shown once and is not
  // recoverable, so leaving a form beside it — one stray click from wiping it —
  // would be a design that loses the thing it just created.
  if (state.temporaryPassword) {
    return (
      <Card>
        <CardHeader
          title="Account created"
          description="Write this down or print it now. It cannot be shown again."
        />
        <CardBody className="space-y-3">
          <Alert tone="success">{state.message}</Alert>
          <div className="rounded-xl bg-slate-900 px-4 py-4 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">One-time password</p>
            <p className="mt-1 font-mono text-xl font-semibold tracking-widest text-white">
              {state.temporaryPassword}
            </p>
            {state.personName && (
              <p className="mt-2 text-xs text-slate-400">for {state.personName}</p>
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            They will be required to set their own password the first time they sign in, and cannot
            reach anything else until they do.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 no-print"
              onClick={() => window.print()}
            >
              Print slip
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => window.location.reload()}
            >
              Add another
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Add a person"
        description="Creates their account and a one-time password, shown once."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {state.message && state.ok && !state.temporaryPassword && (
            // Somebody who already had an account keeps their own password, so
            // there is nothing to show — and saying so is important, or an
            // administrator waits for a slip that is never coming.
            <Alert tone="info">{state.message}</Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" required>
              <Input id="firstName" name="firstName" required autoComplete="off" />
            </Field>
            <Field label="Last name" htmlFor="lastName" required>
              <Input id="lastName" name="lastName" required autoComplete="off" />
            </Field>
          </div>

          <Field
            label="Email"
            htmlFor="email"
            required
            error={emailLooksWrong ? 'That does not look like an email address.' : undefined}
            hint="If they already have an account here, they keep their existing password."
          >
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Role" htmlFor="role" required>
            <Select
              id="role"
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>

          {role === 'GUARDIAN' && (
            <Alert tone="info">
              A guardian needs to be linked to a pupil before they can see anything. Do that from the
              pupil&rsquo;s own record.
            </Alert>
          )}

          <Field label="Job title" htmlFor="title" hint="Shown in the directory and on tasks.">
            <Input id="title" name="title" placeholder="Head of Mathematics" />
          </Field>

          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" autoComplete="off" />
          </Field>

          {orgUnits.length > 0 && (
            <Field label="Department" htmlFor="orgUnitId">
              <Select id="orgUnitId" name="orgUnitId" defaultValue="">
                <option value="">None</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <SubmitButton />
        </form>
      </CardBody>
    </Card>
  );
}
