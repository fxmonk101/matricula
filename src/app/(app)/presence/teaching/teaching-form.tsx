'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { SignaturePad } from '@/components/signature-pad';
import { TEACHING_LABELS, TEACHING_STATUSES, formatDuration } from '@/lib/domain/presence';
import { logTeachingAction, type PresenceFormState } from '../actions';

export interface SectionOption {
  id: string;
  label: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Recording…' : 'Record this class'}
    </Button>
  );
}

const minuteOf = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

export function TeachingForm({
  sections,
  today,
}: {
  sections: SectionOption[];
  /** The SCHOOL's today, not the browser's. */
  today: string;
}) {
  const [state, action] = useActionState<PresenceFormState, FormData>(logTeachingAction, {});
  const { push } = useToast();

  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('10:00');
  const [status, setStatus] = useState('DELIVERED');

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Recorded' : 'Not recorded',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const duration = minuteOf(end) - minuteOf(start);
  const backwards = duration <= 0;
  const cancelled = status === 'CANCELLED';

  return (
    <Card>
      <CardHeader
        title="Record a class"
        description="What you actually taught, which is not always what the timetable says."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field
              label="Section"
              htmlFor="offeringId"
              hint="Leave blank for a seminar, an induction, or anything not timetabled."
            >
              <Select id="offeringId" name="offeringId" defaultValue="">
                <option value="">Not a timetabled section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Date" htmlFor="localDate" required>
              <Input id="localDate" name="localDate" type="date" required defaultValue={today} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From" htmlFor="startTime" required>
              <Input
                id="startTime"
                name="startTime"
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field
              label="To"
              htmlFor="endTime"
              required
              error={backwards ? 'The class must end after it starts.' : undefined}
            >
              <Input
                id="endTime"
                name="endTime"
                type="time"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Field label="Outcome" htmlFor="status" required>
              <Select
                id="status"
                name="status"
                required
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {TEACHING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TEACHING_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!backwards && (
            <p className="text-xs text-slate-500">
              {cancelled ? (
                <>
                  Recorded as cancelled. Its {formatDuration(duration)} will not count toward hours
                  taught — but the entry stays, so &ldquo;three of twelve periods did not run&rdquo;
                  is visible rather than looking like a log nobody filled in.
                </>
              ) : (
                <>That is {formatDuration(duration)} of teaching.</>
              )}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Topic" htmlFor="topic" hint="What was covered.">
              <Input id="topic" name="topic" placeholder="Recursion and the call stack" />
            </Field>
            <Field label="Students present" htmlFor="attended" hint="Optional headcount.">
              <Input id="attended" name="attended" type="number" min={0} />
            </Field>
          </div>

          <Field label="Note" htmlFor="note">
            <Textarea id="note" name="note" rows={2} placeholder="Covering for a colleague." />
          </Field>

          {/*
            The signature is what turns the entry from a claim into a record. It
            is not required: a head of department entering a class for a
            colleague who is off sick has no signature to give, and refusing the
            row would lose the hours entirely.
          */}
          <SignaturePad
            name="signature"
            label="Lecturer signature"
            hint={
              cancelled
                ? 'Sign to confirm this class did not run.'
                : 'Sign to confirm you delivered this class. Optional, but a signed log carries weight a typed one does not.'
            }
          />

          <SubmitButton />
        </form>
      </CardBody>
    </Card>
  );
}
