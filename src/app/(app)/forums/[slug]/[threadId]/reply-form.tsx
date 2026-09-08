'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, Textarea } from '@/components/ui';
import { renderMarkdown } from '@/lib/domain/markdown';
import { replyAction, type ForumFormState } from '../../actions';

function ReplyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Posting…' : 'Reply'}
    </Button>
  );
}

export function ReplyForm({ forumSlug, threadId }: { forumSlug: string; threadId: string }) {
  const [state, action] = useActionState<ForumFormState, FormData>(replyAction, {});
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);

  // Clear on success — leaving the text in place is the fastest route to the
  // same reply appearing twice.
  useEffect(() => {
    if (state.ok) {
      setBody('');
      setPreview(false);
    }
  }, [state.ok]);

  return (
    <Card>
      <CardBody>
        <form action={action} className="space-y-2">
          <input type="hidden" name="forumSlug" value={forumSlug} />
          <input type="hidden" name="threadId" value={threadId} />

          {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}

          <div className="flex items-center justify-between">
            <label htmlFor="reply-body" className="text-xs font-medium text-slate-700">
              Reply
            </label>
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              className="text-[11px] font-medium text-brand-700 hover:underline"
            >
              {preview ? 'Write' : 'Preview'}
            </button>
          </div>

          {preview ? (
            // Same renderer as the server: the preview cannot be more permissive
            // than what actually gets stored and shown to everyone else.
            <div
              className="post-body min-h-20 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ring-slate-300"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(body) || '<p class="text-slate-400">Nothing to preview.</p>',
              }}
            />
          ) : (
            <Textarea
              id="reply-body"
              name="body"
              required
              rows={4}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Markdown is supported. Mention someone with @their.email to notify them."
            />
          )}

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              Everyone already in this discussion is notified.
            </p>
            <ReplyButton />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
