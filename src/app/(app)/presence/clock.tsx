'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { formatDuration } from '@/lib/domain/presence';
import { signInAction, signOutAction } from './actions';

/**
 * The sign-in / sign-out control.
 *
 * ONE BUTTON, whose label says what will happen — not a pair where one is
 * always disabled. A person arriving at work reads the button, not the state,
 * and a greyed-out "Sign out" beside an active "Sign in" makes them think about
 * the machine rather than about whether they are here.
 *
 * The elapsed clock ticks locally from the server-provided start instant, so it
 * is right without polling. `startedAt` crosses the boundary as an ISO string
 * because a Date cannot be serialised into a client component.
 */
export function PresenceClock({
  openSince,
  todayMinutes,
}: {
  /** ISO instant the current session began, or null when signed out. */
  openSince: string | null;
  /** Minutes already banked today, from closed sessions. */
  todayMinutes: number;
}) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!openSince) {
      setElapsed(0);
      return;
    }
    const began = new Date(openSince).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - began) / 60_000)));
    tick();
    // Every fifteen seconds rather than every second: the display is in whole
    // minutes, so a faster tick is work nobody can see.
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [openSince]);

  const run = (action: () => Promise<{ ok?: boolean; message?: string }>) =>
    start(async () => {
      const result = await action();
      push({
        tone: result.ok ? 'success' : 'danger',
        title: result.ok ? 'Done' : 'Not done',
        body: result.message ?? '',
      });
    });

  const signedIn = Boolean(openSince);
  const total = todayMinutes + (signedIn ? elapsed : 0);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-900/5">
      <span
        className={[
          'grid h-11 w-11 shrink-0 place-items-center rounded-full',
          signedIn ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400',
        ].join(' ')}
        aria-hidden
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 3.5v4.19l2.78 1.6a.75.75 0 1 1-.75 1.3l-3.16-1.82a.75.75 0 0 1-.37-.65V5.5a.75.75 0 0 1 1.5 0Z" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {signedIn ? 'Signed in' : 'Not signed in'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {signedIn ? (
            <>
              This session {formatDuration(elapsed)}
              {todayMinutes > 0 && <> · {formatDuration(total)} today</>}
            </>
          ) : todayMinutes > 0 ? (
            <>{formatDuration(todayMinutes)} recorded today</>
          ) : (
            <>Nothing recorded today</>
          )}
        </p>
      </div>

      <Button
        variant={signedIn ? 'secondary' : 'primary'}
        disabled={pending}
        onClick={() => run(signedIn ? signOutAction : signInAction)}
      >
        {pending ? 'Working…' : signedIn ? 'Sign out' : 'Sign in'}
      </Button>
    </div>
  );
}
