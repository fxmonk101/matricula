'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, Field, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { SUBMISSION_LIMITS, formatBytes } from '@/lib/domain/upload';
import { submitCourseworkAction, type SubmitFormState } from './actions';

/**
 * The hand-in form.
 *
 * Deliberately plain: a text box, a file picker, and one button. The thing a
 * student is doing here is stressful and often last-minute, and every extra
 * control is another thing to get wrong at ten to midnight.
 */

/*
 * Taken from the rule the server enforces, never retyped.
 *
 * This number was written out by hand in four places — here, twice in the
 * hint text, and once in the module builder — while next.config.mjs capped
 * server actions at 2 MB. A student picking a 3 MB PDF was told it was fine,
 * and the hand-in then failed in the framework before any of this code ran.
 */
const MAX_BYTES = SUBMISSION_LIMITS.maxBytes;
const MAX_LABEL = formatBytes(MAX_BYTES);

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Submitting…' : label}
    </Button>
  );
}

export function SubmitForm({
  courseworkId,
  offeringId,
  allowsText,
  allowsFile,
  hasSubmitted,
  closed,
}: {
  courseworkId: string;
  offeringId: string;
  allowsText: boolean;
  allowsFile: boolean;
  hasSubmitted: boolean;
  closed: boolean;
}) {
  const [state, action] = useActionState<SubmitFormState, FormData>(submitCourseworkAction, {});
  const { push } = useToast();
  const [chosen, setChosen] = useState<File | null>(null);

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Submitted' : 'Not submitted',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (closed) {
    return (
      <Card>
        <CardHeader title="This assignment is closed" />
        <CardBody>
          <Alert tone="warning">
            The deadline has passed and this assignment does not accept late work. Speak to your
            lecturer if there is a reason you could not submit in time.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  // Checked here for the message only. The server checks it again against the
  // real bytes, which is the check that counts.
  const tooBig = chosen !== null && chosen.size > MAX_BYTES;

  return (
    <Card>
      <CardHeader
        title={hasSubmitted ? 'Submit again' : 'Your submission'}
        description={
          hasSubmitted
            ? 'This creates a new attempt. Your earlier one is kept, and your lecturer sees the most recent.'
            : undefined
        }
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <input type="hidden" name="courseworkId" value={courseworkId} />
          <input type="hidden" name="offeringId" value={offeringId} />

          {allowsText && (
            <Field label="Your answer" htmlFor="textBody" hint="Plain text.">
              <Textarea id="textBody" name="textBody" rows={8} />
            </Field>
          )}

          {allowsFile && (
            <Field
              label="Attach a file"
              htmlFor="file"
              hint={`PDF, Word, Excel, PowerPoint or an image, up to ${MAX_LABEL}.`}
            >
              <input
                id="file"
                type="file"
                name="file"
                accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setChosen(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:text-xs file:font-medium file:text-onInk hover:file:bg-slate-800"
              />
            </Field>
          )}

          {chosen && (
            <p className={tooBig ? 'text-xs text-rose-700' : 'text-xs text-slate-500'}>
              {chosen.name} — {formatBytes(chosen.size)}
              {tooBig && ` · too large, the limit is ${MAX_LABEL}`}
            </p>
          )}

          {!allowsFile && (
            <Alert tone="info">This assignment takes a typed answer rather than a file.</Alert>
          )}
          {!allowsText && (
            <Alert tone="info">This assignment takes a file rather than a typed answer.</Alert>
          )}

          <Submit label={hasSubmitted ? 'Submit a new attempt' : 'Submit'} />
        </form>
      </CardBody>
    </Card>
  );
}
