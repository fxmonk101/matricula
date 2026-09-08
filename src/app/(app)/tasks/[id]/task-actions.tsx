'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { STATUS_LABEL } from '@/components/task-bits';
import type { TaskStatus } from '@/lib/domain/enums';
import { transitionTaskAction, type TaskFormState } from '../actions';

/** The verb, not the noun — a button says what pressing it does. */
const VERB: Record<TaskStatus, string> = {
  OPEN: 'Reopen',
  IN_PROGRESS: 'Start work',
  BLOCKED: 'Mark blocked',
  SUBMITTED: 'Submit for review',
  COMPLETED: 'Accept as complete',
  CANCELLED: 'Cancel task',
};

const VARIANT: Partial<Record<TaskStatus, 'primary' | 'secondary' | 'success' | 'danger'>> = {
  COMPLETED: 'success',
  CANCELLED: 'danger',
  SUBMITTED: 'primary',
};

function MoveButton({ to }: { to: TaskStatus }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={VARIANT[to] ?? 'secondary'}
      disabled={pending}
      className="w-full"
    >
      {pending ? 'Working…' : VERB[to]}
    </Button>
  );
}

export function TaskActions({
  taskId,
  available,
  canAccept,
  isAssignee,
  status,
}: {
  taskId: string;
  available: TaskStatus[];
  canAccept: boolean;
  isAssignee: boolean;
  status: TaskStatus;
}) {
  const [state, action] = useActionState<TaskFormState, FormData>(transitionTaskAction, {});

  if (available.length === 0) {
    return (
      <Card>
        <CardHeader title="Actions" />
        <CardBody>
          <p className="text-xs text-slate-500">
            {status === 'CANCELLED'
              ? 'This task was cancelled. Cancelled work is not resurrected — raise a new task instead.'
              : 'You can see this task but not change it. Managers can follow a subordinate’s work without editing it.'}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Actions" />
      <CardBody className="space-y-2">
        {state.message ? (
          <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
        ) : null}

        {available.map((to) => (
          <form key={to} action={action}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="to" value={to} />
            <MoveButton to={to} />
          </form>
        ))}

        {status === 'SUBMITTED' && isAssignee && !canAccept ? (
          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            Submitted. Only the person who raised this can accept it — which is what keeps
            &ldquo;I submitted it&rdquo; and &ldquo;it is done&rdquo; from being the same claim.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
