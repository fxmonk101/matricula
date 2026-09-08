'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Textarea } from '@/components/ui';
import { commentAction, type TaskFormState } from '../actions';

function PostButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Posting…' : 'Comment'}
    </Button>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState<TaskFormState, FormData>(commentAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the box on success. Leaving the text in place after a successful
  // post is the fastest way to get the same comment twice.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-2 border-t border-slate-200 pt-3">
      <input type="hidden" name="taskId" value={taskId} />
      {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
      <Textarea
        name="body"
        rows={2}
        maxLength={4000}
        placeholder="Add a comment — everyone on this task is notified."
        aria-label="Comment"
        required
      />
      <div className="flex justify-end">
        <PostButton />
      </div>
    </form>
  );
}
