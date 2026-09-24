'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, StatTile } from '@/components/ui';
import { startAttemptAction, type QuizFormState } from './actions';

/**
 * The page before the paper.
 *
 * Its whole job is to make sure nobody starts a timed examination by accident.
 * The clock begins the moment this button is pressed and there is no pausing
 * it, so the things somebody needs to know — how long, how many marks, how many
 * attempts left — are on screen before the button, not after it.
 */

function StartButton({ retake }: { retake: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Starting…' : retake ? 'Start another attempt' : 'Start the quiz'}
    </Button>
  );
}

export function StartPanel({
  offeringId,
  itemId,
  timeLimitMinutes,
  attemptsLeft,
  marks,
  instructions,
  retake,
}: {
  offeringId: string;
  itemId: string;
  timeLimitMinutes: number | null;
  attemptsLeft: number;
  marks: number;
  instructions: string | null;
  retake: boolean;
}) {
  const [state, action] = useActionState<QuizFormState, FormData>(startAttemptAction, {});

  return (
    <Card>
      <CardHeader
        title={retake ? 'Take it again' : 'Before you start'}
        description={instructions ?? undefined}
      />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Time allowed"
            value={timeLimitMinutes ? formatLimit(timeLimitMinutes) : 'No limit'}
            tone={timeLimitMinutes ? 'brand' : 'neutral'}
          />
          <StatTile label="Marks" value={marks} />
          <StatTile label="Attempts left" value={attemptsLeft} />
        </div>

        {timeLimitMinutes !== null && (
          <Alert tone="warning" title="The clock starts as soon as you begin" className="mt-4">
            There is no way to pause it. Your answers are saved as you go, so a lost connection
            will not lose your work — but the time keeps running, and when it ends your paper is
            handed in as it stands.
          </Alert>
        )}

        <form action={action} className="mt-4">
          <input type="hidden" name="offeringId" value={offeringId} />
          <input type="hidden" name="itemId" value={itemId} />
          <StartButton retake={retake} />
        </form>

        {state.ok === false && state.message && (
          <Alert tone="danger" className="mt-4">
            {state.message}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}

function formatLimit(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
