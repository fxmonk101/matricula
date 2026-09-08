'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
import { createTaskAction, type TaskFormState } from './actions';

export interface Candidate {
  membershipId: string;
  name: string;
  title: string | null;
  role: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Raising…' : 'Raise task'}
    </Button>
  );
}

export function NewTaskDialog({
  candidates,
  canAssignOthers,
  myMembershipId,
}: {
  candidates: Candidate[];
  canAssignOthers: boolean;
  myMembershipId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<TaskFormState, FormData>(createTaskAction, {});
  const router = useRouter();

  // Close on success and refresh, so the new task is actually in the list
  // behind the dialog rather than appearing after the next navigation.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state.ok, router]);

  // Someone who cannot assign to others may still raise work for themselves —
  // a personal to-do that their manager can see is more useful than a private
  // note nobody can pick up when they are away.
  const assignable = canAssignOthers
    ? candidates
    : candidates.filter((c) => c.membershipId === myMembershipId);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        New task
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>

      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Raise a task</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              The person you assign it to is notified immediately, and it appears in their queue.
            </p>
          </div>

          <form action={action} className="space-y-4 px-5 py-4">
            {state.message && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}

            <Field label="Title" htmlFor="title" required error={state.fieldErrors?.title}>
              <Input id="title" name="title" required maxLength={160} placeholder="What needs doing?" />
            </Field>

            <Field label="Detail" htmlFor="description" hint="Optional. What 'done' looks like.">
              <Textarea id="description" name="description" maxLength={4000} rows={3} />
            </Field>

            <Field label="Assign to" htmlFor="assigneeId" required error={state.fieldErrors?.assigneeId}>
              <Select id="assigneeId" name="assigneeId" required defaultValue={assignable.length === 1 ? assignable[0].membershipId : ''}>
                <option value="" disabled>
                  Choose a member of staff…
                </option>
                {assignable.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name} — {c.title ?? ROLE_LABELS[c.role as Role] ?? c.role}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type" htmlFor="kind">
                <Select id="kind" name="kind" defaultValue="GENERAL">
                  <option value="GENERAL">General</option>
                  <option value="DOCUMENT_REQUEST">Document</option>
                  <option value="ONBOARDING">Onboarding</option>
                  <option value="ADMISSIONS_REVIEW">Admissions</option>
                </Select>
              </Field>
              <Field label="Priority" htmlFor="priority">
                <Select id="priority" name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </Select>
              </Field>
              <Field
                label="Due"
                htmlFor="dueAt"
                hint="End of that day"
                error={state.fieldErrors?.dueAt}
              >
                <Input id="dueAt" name="dueAt" type="date" />
              </Field>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Leaving the deadline blank is a real choice, not a missing field: a task with no
              deadline is never overdue and never escalates.
            </p>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
