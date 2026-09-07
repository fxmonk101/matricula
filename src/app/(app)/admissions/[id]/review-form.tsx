'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { submitReviewAction, convertAction, type AdmissionsState } from '../actions';

interface ExistingReview {
  academicScore: number;
  essayScore: number;
  interviewScore: number | null;
  extracurricularScore: number | null;
  recommendation: string;
  comments: string | null;
}

function Submit({ label, busy, variant }: { label: string; busy: string; variant?: 'primary' | 'success' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant ?? 'primary'} disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function ReviewForm({
  applicationId,
  existing,
}: {
  applicationId: string;
  existing: ExistingReview | null;
}) {
  const [state, action] = useActionState<AdmissionsState, FormData>(submitReviewAction, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="applicationId" value={applicationId} />

      {state.message ? (
        <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Academic (0–100)" htmlFor="academicScore" required>
          <Input
            id="academicScore"
            name="academicScore"
            type="number"
            min={0}
            max={100}
            step="0.5"
            required
            defaultValue={existing?.academicScore ?? ''}
          />
        </Field>

        <Field label="Personal statement (0–100)" htmlFor="essayScore" required>
          <Input
            id="essayScore"
            name="essayScore"
            type="number"
            min={0}
            max={100}
            step="0.5"
            required
            defaultValue={existing?.essayScore ?? ''}
          />
        </Field>

        <Field label="Interview (0–100)" htmlFor="interviewScore" hint="Blank if not interviewed">
          <Input
            id="interviewScore"
            name="interviewScore"
            type="number"
            min={0}
            max={100}
            step="0.5"
            defaultValue={existing?.interviewScore ?? ''}
          />
        </Field>

        <Field
          label="Extracurricular (0–100)"
          htmlFor="extracurricularScore"
          hint="Blank if not assessed"
        >
          <Input
            id="extracurricularScore"
            name="extracurricularScore"
            type="number"
            min={0}
            max={100}
            step="0.5"
            defaultValue={existing?.extracurricularScore ?? ''}
          />
        </Field>
      </div>

      <Field label="Recommendation" htmlFor="recommendation" required>
        <Select
          id="recommendation"
          name="recommendation"
          required
          defaultValue={existing?.recommendation ?? 'WAITLIST'}
        >
          <option value="ADMIT">Admit</option>
          <option value="WAITLIST">Waitlist</option>
          <option value="REJECT">Reject</option>
        </Select>
      </Field>

      <Field label="Comments" htmlFor="comments" hint="Recorded against your name and visible to the committee.">
        <Textarea
          id="comments"
          name="comments"
          maxLength={2000}
          defaultValue={existing?.comments ?? ''}
          placeholder="Reasoning behind your scores and recommendation…"
        />
      </Field>

      <Submit label={existing ? 'Update review' : 'Submit review'} busy="Saving…" />
    </form>
  );
}

export function ConvertForm({ applicationId }: { applicationId: string }) {
  const [state, action] = useActionState<AdmissionsState, FormData>(convertAction, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      {state.message ? (
        <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-600">
        This creates the student record and issues a matriculation number in a single transaction.
        It cannot be undone from this screen.
      </p>
      <Submit label="Matriculate applicant" busy="Converting…" variant="success" />
    </form>
  );
}
