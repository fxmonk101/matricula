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
import { deriveCode, slugRejectionReason, slugify } from '@/lib/domain/provisioning';
import { GRADING_PRESETS } from '@/lib/domain/config';
import { provisionSchoolAction, type PlatformFormState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Provisioning…' : 'Provision school'}
    </Button>
  );
}

/**
 * A handful of zones, not the full IANA list. An operator setting up a school
 * knows the city; a 400-entry dropdown is worse than five right answers and a
 * free-text box for the sixth.
 */
const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
  'Asia/Dubai',
  'UTC',
];

/**
 * Codes only. The symbol and the exponent are resolved server-side from the
 * code, so this list cannot disagree with what is actually stored.
 */
const CURRENCIES: { code: string; label: string }[] = [
  { code: 'NGN', label: 'Nigerian naira' },
  { code: 'GHS', label: 'Ghanaian cedi' },
  { code: 'KES', label: 'Kenyan shilling' },
  { code: 'ZAR', label: 'South African rand' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'USD', label: 'US dollar' },
];

export function ProvisionForm({
  plans,
  takenSlugs,
}: {
  plans: { id: string; name: string; trialDays: number }[];
  takenSlugs: string[];
}) {
  const [state, action] = useActionState<PlatformFormState, FormData>(provisionSchoolAction, {});
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [code, setCode] = useState('');

  // Derived from the name until the operator types their own, which is the
  // behaviour they expect from every other admin console they have used.
  const effectiveSlug = slug || slugify(name);
  const effectiveCode = code || deriveCode(name || 'School');

  // Checked with the SAME pure functions the server uses, so a warning here
  // always matches the refusal the action would give.
  const slugProblem = effectiveSlug ? slugRejectionReason(effectiveSlug) : null;
  const slugTaken = takenSlugs.includes(effectiveSlug);

  if (state.temporaryPassword) {
    return (
      <Card>
        <CardHeader
          title="School created"
          description="This password is shown once and is not recoverable. Copy it now."
        />
        <CardBody className="space-y-3">
          <Alert tone="success">{state.message}</Alert>
          <div className="rounded-xl bg-slate-900 px-4 py-4 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">One-time password</p>
            <p className="mt-1 font-mono text-xl font-semibold tracking-widest text-white">
              {state.temporaryPassword}
            </p>
            <p className="mt-2 text-xs text-slate-400">{state.ownerEmail}</p>
          </div>
          {state.entranceUrl && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Their sign-in address
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-900">
                {state.entranceUrl}
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(state.entranceUrl!)}
                className="mt-2 text-[11px] font-medium text-brand-700 hover:underline"
              >
                Copy address
              </button>
            </div>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            This school has its own entrance and sees nothing of any other institution on the
            platform. The owner is required to set their own password before reaching anything
            else, and until you open the school they are the only person who can sign in to it.
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()} className="w-full">
            Provision another
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Provision a school"
        description="Creates the school, its configuration, its subscription and its first owner — all or nothing."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

          <Field label="School name" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Golden Eagles University"
            />
          </Field>

          <Field label="Short name" htmlFor="shortName" hint="Used in headers and on documents.">
            <Input id="shortName" name="shortName" placeholder="Golden Eagles" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Address"
              htmlFor="slug"
              hint={`/s/${effectiveSlug || '…'}/login`}
              error={
                slugTaken
                  ? 'That address is already taken — a number will be appended.'
                  : (slugProblem ?? undefined)
              }
            >
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={slugify(name) || 'golden-eagles'}
              />
            </Field>

            <Field
              label="Document prefix"
              htmlFor="code"
              hint={`INV-${effectiveCode}-2026-000001`}
            >
              <Input
                id="code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={deriveCode(name || 'School')}
                maxLength={8}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Academic model" htmlFor="academicModel" required>
              <Select id="academicModel" name="academicModel" defaultValue="HIGHER_ED">
                <option value="HIGHER_ED">Higher education</option>
                <option value="K12">K-12 school</option>
              </Select>
            </Field>

            <Field label="Grading scale" htmlFor="gradingPresetKey" required>
              <Select id="gradingPresetKey" name="gradingPresetKey" defaultValue="NIGERIAN_4">
                {Object.entries(GRADING_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label} — {preset.detail}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="timezone" required>
              <Select id="timezone" name="timezone" defaultValue="Africa/Lagos">
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Currency" htmlFor="currencyCode" required>
              <Select id="currencyCode" name="currencyCode" defaultValue="NGN">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <input type="hidden" name="locale" value="en-NG" />

          <Field label="Plan" htmlFor="planId" required>
            <Select id="planId" name="planId" required disabled={plans.length === 0}>
              {plans.length === 0 && <option value="">No plans configured</option>}
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.trialDays > 0 ? ` — ${p.trialDays}-day trial` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <div className="border-t border-slate-200/70 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              First owner
            </p>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="ownerFirstName" required>
                  <Input id="ownerFirstName" name="ownerFirstName" required />
                </Field>
                <Field label="Last name" htmlFor="ownerLastName" required>
                  <Input id="ownerLastName" name="ownerLastName" required />
                </Field>
              </div>
              <Field
                label="Email"
                htmlFor="ownerEmail"
                required
                hint="If this person already has an account here, they keep their password and gain a membership."
              >
                <Input id="ownerEmail" name="ownerEmail" type="email" required />
              </Field>
            </div>
          </div>

          <SubmitButton />

          <p className="text-[11px] leading-relaxed text-slate-500">
            The school opens in <strong>setup</strong>: only its owner can sign in, so staff are not
            invited into a school with no terms and no grading scheme. Open it from the school&rsquo;s
            page when it is ready.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
