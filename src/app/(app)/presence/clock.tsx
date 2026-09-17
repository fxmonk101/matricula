'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { SignaturePad } from '@/components/signature-pad';
import {
  BREAK_KINDS,
  BREAK_LABELS,
  BREAK_TYPICAL_MINUTES,
  formatDuration,
  type BreakKind,
} from '@/lib/domain/presence';
import {
  endBreakAction,
  signInAction,
  signOutAction,
  startBreakAction,
  type PresenceFormState,
} from './actions';

/**
 * The register.
 *
 * Signing in is a FORM, not a button. What is being recorded is a declaration a
 * person made — their number, the time they say they arrived, the department
 * they belong to, and their signature — and a single button records none of
 * that. The fields are prefilled from the record where the record knows, so the
 * common case is still one glance and one tap, but what gets stored is an
 * attestation rather than a timestamp.
 *
 * The elapsed clock ticks locally from the server-provided start instant, so it
 * stays right without polling. Instants cross the boundary as ISO strings
 * because a Date cannot be serialised into a client component.
 */

function Submit({ label, tone = 'primary' }: { label: string; tone?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={tone} disabled={pending} className="w-full">
      {pending ? 'Working…' : label}
    </Button>
  );
}

function useResult(state: PresenceFormState, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not recorded',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/** "HH:MM" in the viewer's own clock, which is what a time input expects. */
function nowAsTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function PresenceClock({
  openSince,
  todayMinutes,
  identifier,
  identifierLabel,
  unit,
  breakSince,
  breakKind,
  breakMinutesToday,
}: {
  /** ISO instant the current session began, or null when signed out. */
  openSince: string | null;
  /** Minutes already banked today, from closed sessions. */
  todayMinutes: number;
  /** The number this person signs with, prefilled. Null when they have none. */
  identifier: string | null;
  identifierLabel: string;
  unit: string | null;
  /** ISO instant the running break began, or null when not on one. */
  breakSince: string | null;
  breakKind: string | null;
  breakMinutesToday: number;
}) {
  const [inState, doSignIn] = useActionState<PresenceFormState, FormData>(signInAction, {});
  const [outState, doSignOut] = useActionState<PresenceFormState, FormData>(signOutAction, {});
  const [breakInState, doStartBreak] = useActionState<PresenceFormState, FormData>(
    startBreakAction,
    {},
  );
  const [breakOutState, doEndBreak] = useActionState<PresenceFormState, FormData>(
    endBreakAction,
    {},
  );

  useResult(inState, 'Signed in');
  useResult(outState, 'Signed out');
  useResult(breakInState, 'On a break');
  useResult(breakOutState, 'Back on the clock');

  const [elapsed, setElapsed] = useState(0);
  const [onBreakFor, setOnBreakFor] = useState(0);

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

  useEffect(() => {
    if (!breakSince) {
      setOnBreakFor(0);
      return;
    }
    const began = new Date(breakSince).getTime();
    const tick = () => setOnBreakFor(Math.max(0, Math.floor((Date.now() - began) / 60_000)));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [breakSince]);

  const signedIn = Boolean(openSince);
  const onBreak = Boolean(breakSince);

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5">
      {/* --- the state line ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-5 py-4">
        <span
          className={[
            'grid h-11 w-11 shrink-0 place-items-center rounded-full',
            onBreak
              ? 'bg-amber-50 text-amber-600'
              : signedIn
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-slate-100 text-slate-400',
          ].join(' ')}
          aria-hidden
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 3.5v4.19l2.78 1.6a.75.75 0 1 1-.75 1.3l-3.16-1.82a.75.75 0 0 1-.37-.65V5.5a.75.75 0 0 1 1.5 0Z" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            {onBreak
              ? `On a ${BREAK_LABELS[breakKind as BreakKind]?.toLowerCase() ?? 'break'}`
              : signedIn
                ? 'Signed in'
                : 'Not signed in'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {onBreak ? (
              <>Away {formatDuration(onBreakFor)} · signed in {formatDuration(elapsed)} ago</>
            ) : signedIn ? (
              <>
                This session {formatDuration(elapsed)}
                {breakMinutesToday > 0 && <> · {formatDuration(breakMinutesToday)} on breaks</>}
                {todayMinutes > 0 && <> · {formatDuration(todayMinutes)} banked today</>}
              </>
            ) : todayMinutes > 0 ? (
              <>{formatDuration(todayMinutes)} recorded today</>
            ) : (
              <>Nothing recorded today</>
            )}
          </p>
        </div>
      </div>

      <div className="px-5 py-4">
        {/* --- not signed in: the full attestation ------------------------- */}
        {!signedIn && (
          <form action={doSignIn} className="space-y-3">
            {!identifier && (
              <Alert tone="warning" title="Your record carries no number">
                The register checks the number you type against your record, and yours has none.
                Ask the office to add your matriculation or staff number.
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={identifierLabel}
                htmlFor="identifier"
                required
                hint="Checked against your record, so a colleague cannot sign in on your screen."
              >
                <Input
                  id="identifier"
                  name="identifier"
                  required
                  defaultValue={identifier ?? ''}
                  autoComplete="off"
                  placeholder="GEU/CSC/2024/001"
                />
              </Field>

              <Field
                label="Time you arrived"
                htmlFor="signedAt"
                required
                hint="Change it if you got here before you reached this screen."
              >
                <Input id="signedAt" name="signedAt" type="time" required defaultValue={nowAsTimeValue()} />
              </Field>
            </div>

            <Field
              label="Department or faculty"
              htmlFor="unit"
              required
              hint="Stored as you give it, so this record still reads correctly if you move."
            >
              <Input
                id="unit"
                name="unit"
                required
                defaultValue={unit ?? ''}
                placeholder="Computer Science"
              />
            </Field>

            <SignaturePad
              name="signature"
              label="Signature"
              required
              hint="Draw with a finger, a stylus or the mouse."
            />

            <Submit label="Sign in" />
          </form>
        )}

        {/* --- signed in: breaks, then signing out -------------------------- */}
        {signedIn && (
          <div className="space-y-4">
            {onBreak ? (
              <form action={doEndBreak}>
                <Submit label={`End break (${formatDuration(onBreakFor)})`} tone="primary" />
              </form>
            ) : (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-700">Step away</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BREAK_KINDS.map((kind) => (
                    <form key={kind} action={doStartBreak}>
                      <input type="hidden" name="kind" value={kind} />
                      <BreakButton kind={kind} />
                    </form>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Short and prayer breaks count as time worked. Lunch and other breaks are
                  deducted, so your recorded hours are what you actually worked.
                </p>
              </div>
            )}

            <form action={doSignOut} className="space-y-3 border-t border-slate-100 pt-4">
              <Field
                label="Time you left"
                htmlFor="outAt"
                required
                hint="Change it if you are recording this after the fact."
              >
                <Input id="outAt" name="signedAt" type="time" required defaultValue={nowAsTimeValue()} />
              </Field>

              <SignaturePad name="signature" label="Signature" required />

              <Submit label="Sign out" tone="secondary" />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function BreakButton({ kind }: { kind: BreakKind }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg px-2 py-2 text-center ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50 disabled:opacity-50"
    >
      <span className="block text-xs font-medium text-slate-800">
        {BREAK_LABELS[kind].replace(' break', '')}
      </span>
      <span className="block text-[11px] text-slate-500">~{BREAK_TYPICAL_MINUTES[kind]}m</span>
    </button>
  );
}
