'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Select, Textarea } from '@/components/ui';
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from '@/lib/domain/enums';
import { cn } from '@/lib/utils';
import { reactAction, reportAction, type ForumFormState } from '../../actions';

function ReactButton({ reacted, count }: { reacted: boolean; count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        reacted
          ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
      )}
      aria-pressed={reacted}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <path d="M10 17.5 3.8 11.4a4 4 0 0 1 5.7-5.6l.5.5.5-.5a4 4 0 1 1 5.7 5.6L10 17.5Z" />
      </svg>
      {count > 0 ? count : 'Helpful'}
    </button>
  );
}

function SubmitReport() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="danger" disabled={pending}>
      {pending ? 'Reporting…' : 'Report'}
    </Button>
  );
}

export function PostActions({
  forumSlug,
  threadId,
  postId,
  reactionCount,
  reacted,
  canReport,
}: {
  forumSlug: string;
  threadId: string;
  postId: string;
  reactionCount: number;
  reacted: boolean;
  canReport: boolean;
}) {
  const [reporting, setReporting] = useState(false);
  const [state, action] = useActionState<ForumFormState, FormData>(reportAction, {});

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1">
        <form action={reactAction}>
          <input type="hidden" name="forumSlug" value={forumSlug} />
          <input type="hidden" name="threadId" value={threadId} />
          <input type="hidden" name="postId" value={postId} />
          <ReactButton reacted={reacted} count={reactionCount} />
        </form>

        {canReport ? (
          <button
            type="button"
            onClick={() => setReporting((r) => !r)}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            Report
          </button>
        ) : null}
      </div>

      {state.message ? (
        <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
      ) : null}

      {reporting && !state.ok ? (
        <form action={action} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <input type="hidden" name="forumSlug" value={forumSlug} />
          <input type="hidden" name="threadId" value={threadId} />
          <input type="hidden" name="postId" value={postId} />

          <Field label="Why are you reporting this?" htmlFor={`reason-${postId}`} required>
            <Select id={`reason-${postId}`} name="reason" required defaultValue="">
              <option value="" disabled>
                Choose a reason…
              </option>
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REPORT_REASON_LABELS[r as ReportReason]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Anything else?" htmlFor={`detail-${postId}`} hint="Optional.">
            <Textarea id={`detail-${postId}`} name="detail" rows={2} maxLength={1000} />
          </Field>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Reports go to a moderator as a task. Content is never deleted automatically — enough
            reports hide it pending review, and a person decides what happens next.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setReporting(false)}>
              Cancel
            </Button>
            <SubmitReport />
          </div>
        </form>
      ) : null}
    </div>
  );
}
