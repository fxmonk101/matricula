'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { renderMarkdown } from '@/lib/domain/markdown';
import { createThreadAction, type ForumFormState } from '../actions';

function PostButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Posting…' : 'Start discussion'}
    </Button>
  );
}

export function NewThreadButton({
  forumSlug,
  categories,
}: {
  forumSlug: string;
  categories: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [state, action] = useActionState<ForumFormState, FormData>(createThreadAction, {});

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        New discussion
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/50 p-4 pt-12">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Start a discussion</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Everyone who can see this forum will be able to read it.
          </p>
        </div>

        <form action={action} className="space-y-4 px-5 py-4">
          <input type="hidden" name="forumSlug" value={forumSlug} />

          {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}

          <Field label="Title" htmlFor="title" required>
            <Input id="title" name="title" required minLength={4} maxLength={200} />
          </Field>

          {categories.length > 0 ? (
            <Field label="Category" htmlFor="categoryId">
              <Select id="categoryId" name="categoryId" defaultValue="">
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="body" className="block text-xs font-medium text-slate-700">
                Body <span className="text-rose-600">*</span>
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
              /*
               * The preview runs the SAME renderer the server runs, so what an
               * author sees here is exactly what everyone else will see. A
               * second, looser client-side renderer would be a way to convince
               * someone their post is safe when it is not.
               */
              <div
                className="post-body min-h-24 rounded-lg px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-300"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(body) || '<p class="text-slate-400">Nothing to preview.</p>' }}
              />
            ) : (
              <Textarea
                id="body"
                name="body"
                required
                rows={10}
                maxLength={20000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Markdown is supported: **bold**, *italic*, `code`, > quotes, - lists, and [links](https://example.edu)."
              />
            )}
            <p className="text-[11px] text-slate-500">
              Raw HTML is not supported and is shown as plain text.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <PostButton />
          </div>
        </form>
      </div>
    </div>
  );
}
