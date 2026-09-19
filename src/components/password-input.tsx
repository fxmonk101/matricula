'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A password field with a reveal control.
 *
 * Worth having for a reason beyond convenience. The people typing passwords
 * into this system are largely typing a GENERATED one-time password read off a
 * handover slip or down a telephone — `THFH-6DE6-3HG6` — and a masked field
 * gives them no way to tell a mistyped character from a wrong password. The
 * result is a person who concludes their credentials are broken when they made
 * a typo, which lands on the school office as a support call.
 *
 * Defaults to HIDDEN, and reverts to hidden on every page load. Revealing is a
 * deliberate act by somebody who has judged their own surroundings; remembering
 * that choice would un-mask the field later in a room they had not judged.
 *
 * The button is `tabIndex={-1}` so tabbing runs field → submit as it should.
 * Somebody navigating by keyboard alone can still reach it, but it does not sit
 * between the password and the thing that submits it.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        aria-describedby={props['aria-describedby'] ?? hintId}
        className={cn(
          'block h-9 w-full rounded-lg border-0 bg-white px-3 pr-10 text-sm text-slate-900 shadow-xs ring-1 ring-inset',
          'ring-slate-300 transition-shadow placeholder:text-slate-400',
          'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-600',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          className,
        )}
      />

      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        // The label states the ACTION, not the state: a screen-reader user
        // pressing "Show password" expects it to become shown.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus-visible:text-brand-700"
      >
        {visible ? (
          // Struck-through eye: currently visible, pressing hides it.
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden>
            <path
              d="M3 3l14 14M8.2 8.3a2.5 2.5 0 003.5 3.5M6.1 6.2C4.4 7.2 3 8.9 2.2 10c1.6 2.6 4.5 4.8 7.8 4.8 1.3 0 2.5-.3 3.6-.9M12.4 6.1A7.9 7.9 0 0010 5.7c-.5 0-1 0-1.4.1M15.2 8c1 .8 1.9 1.6 2.6 2.4-.5.8-1.2 1.6-2 2.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4" aria-hidden>
            <path
              d="M2.2 10C3.8 7.4 6.7 5.2 10 5.2s6.2 2.2 7.8 4.8c-1.6 2.6-4.5 4.8-7.8 4.8S3.8 12.6 2.2 10Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
