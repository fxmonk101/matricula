'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { withdrawAnnouncementAction, type AnnouncementFormState } from './actions';

/**
 * Take a notice down.
 *
 * It expires rather than being deleted. A notice that a fee deadline moved is
 * something people acted on, and "it was never posted" is not a true answer to
 * a dispute about it three months later.
 */
function Inner() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? '…' : 'Take down'}
    </Button>
  );
}

export function WithdrawButton({ announcementId }: { announcementId: string }) {
  const [state, action] = useActionState<AnnouncementFormState, FormData>(
    withdrawAnnouncementAction,
    {},
  );
  const { push } = useToast();

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Taken down' : 'Not changed',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="announcementId" value={announcementId} />
      <Inner />
    </form>
  );
}
