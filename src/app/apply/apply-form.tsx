'use client';

import Link from 'next/link';
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
  Textarea,
} from '@/components/ui';
import { submitApplicationAction, type ApplyState } from './actions';

const MIN_STATEMENT = 100;
const MAX_STATEMENT = 5000;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Submitting…' : 'Submit application'}
    </Button>
  );
}

export function ApplyForm({
  schoolSlug,
  programs,
  terms,
}: {
  schoolSlug: string;
  programs: { id: string; code: string; name: string; faculty: string }[];
  terms: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<ApplyState, FormData>(submitApplicationAction, {});
  const [statementLength, setStatementLength] = useState(0);

  if (state.ok) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Application received
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">
            Your reference is{' '}
            <span className="font-mono text-brand-700">{state.referenceNo}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
            Keep this reference. Sign in with the email and password you just chose to track your
            application, and to accept an offer if one is made.
          </p>
          <Link
            href={`/s/${schoolSlug}/login`}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-onAccent hover:bg-brand-700"
          >
            Sign in to the applicant portal
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {/* The tenant travels with the submission; the action re-verifies it. */}
      <input type="hidden" name="schoolSlug" value={schoolSlug} />
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <Card>
        <CardHeader title="About you" description="This becomes your portal login." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" required>
            <Input id="firstName" name="firstName" required maxLength={80} autoComplete="given-name" />
          </Field>
          <Field label="Surname" htmlFor="lastName" required>
            <Input id="lastName" name="lastName" required maxLength={80} autoComplete="family-name" />
          </Field>
          <Field label="Email address" htmlFor="email" required>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" maxLength={40} autoComplete="tel" />
          </Field>
          <Field
            label="Choose a password"
            htmlFor="password"
            required
            hint="At least 10 characters. Length matters far more than punctuation."
            className="sm:col-span-2"
          >
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Program of study" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Program" htmlFor="programId" required>
            <Select id="programId" name="programId" required defaultValue="">
              <option value="" disabled>
                Choose a program
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name} ({p.faculty})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Intake" htmlFor="termId" required>
            <Select id="termId" name="termId" required defaultValue={terms[0]?.id ?? ''}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Academic background"
          description="Leave a field blank if it does not apply. A blank is excluded from your score; it is not counted as a zero."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Previous school" htmlFor="previousSchool" className="sm:col-span-2">
            <Input id="previousSchool" name="previousSchool" maxLength={200} />
          </Field>
          <Field
            label="Prior academic performance"
            htmlFor="priorGpaScore"
            hint="Normalised to a 0–100 scale"
          >
            <Input
              id="priorGpaScore"
              name="priorGpaScore"
              type="number"
              min={0}
              max={100}
              step="0.1"
            />
          </Field>
          <Field label="Entrance examination score" htmlFor="entranceExamScore" hint="0–100">
            <Input
              id="entranceExamScore"
              name="entranceExamScore"
              type="number"
              min={0}
              max={100}
              step="0.1"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Personal statement"
          description="Why this program, and what you intend to do with it. Read and scored independently by at least two reviewers."
        />
        <CardBody>
          <Field
            label="Your statement"
            htmlFor="personalStatement"
            required
            hint={`${statementLength} / ${MAX_STATEMENT} characters (minimum ${MIN_STATEMENT})`}
          >
            <Textarea
              id="personalStatement"
              name="personalStatement"
              required
              minLength={MIN_STATEMENT}
              maxLength={MAX_STATEMENT}
              rows={10}
              className="min-h-48"
              onChange={(e) => setStatementLength(e.target.value.length)}
              placeholder="Tell the committee about your interest in this field, what you have done to pursue it, and what you hope to achieve…"
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="max-w-md text-xs leading-relaxed text-slate-500">
          By submitting you confirm the information is accurate. Applications found to contain
          false statements are withdrawn at any stage, including after admission.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
