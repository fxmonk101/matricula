'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import type { ThreadStatus } from '@/lib/domain/enums';
import type { ModerationAction } from '@/lib/domain/forum';
import { moderateAction, type ForumFormState } from '../../actions';

const LABEL: Record<ModerationAction, string> = {
  REPORT: 'Report',
  DISMISS_REPORT: 'Dismiss a report',
  HIDE: 'Hide',
  RESTORE: 'Restore',
  LOCK: 'Lock',
  UNLOCK: 'Unlock',
  PIN: 'Pin to top',
  UNPIN: 'Unpin',
  DELETE: 'Delete permanently',
};

function ActionButton({ action }: { action: ModerationAction }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={action === 'DELETE' ? 'danger' : 'secondary'}
      disabled={pending}
      className="w-full"
    >
      {pending ? 'Working…' : LABEL[action]}
    </Button>
  );
}

export function ModerationBar({
  forumSlug,
  threadId,
  status,
  isPinned,
  reportCount,
}: {
  forumSlug: string;
  threadId: string;
  status: ThreadStatus;
  isPinned: boolean;
  reportCount: number;
}) {
  const [state, action] = useActionState<ForumFormState, FormData>(moderateAction, {});

  // Only actions the pure reducer would actually accept from this state are
  // offered. Rendering a button the action will refuse is a worse experience
  // than not rendering it.
  const available: ModerationAction[] = [];
  if (status === 'OPEN') available.push('LOCK', 'HIDE');
  if (status === 'LOCKED') available.push('UNLOCK', 'HIDE');
  if (status === 'HIDDEN') available.push('RESTORE');
  available.push(isPinned ? 'UNPIN' : 'PIN');
  if (reportCount > 0) available.push('DISMISS_REPORT');
  available.push('DELETE');

  return (
    <Card>
      <CardHeader
        title="Moderation"
        description="You can see this because you moderate this forum."
      />
      <CardBody className="space-y-2">
        {state.message ? (
          <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
        ) : null}

        {available.map((a) => (
          <form key={a} action={action}>
            <input type="hidden" name="forumSlug" value={forumSlug} />
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="action" value={a} />
            <ActionButton action={a} />
          </form>
        ))}

        <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
          Deletion is final — nothing transitions out of it. If content needs to come back it is
          reposted, so the record shows what happened rather than hiding it.
        </p>
      </CardBody>
    </Card>
  );
}
