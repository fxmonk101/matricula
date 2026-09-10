'use client';

import { useFormStatus } from 'react-dom';

import { operatorSignOutAction } from './login/actions';

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

/**
 * Signing out of the console does NOT sign the person out of any school they
 * are also a member of — the two sessions are separate cookies on separate
 * paths, which is what lets a support engineer hold both at once.
 */
export function OperatorSignOut() {
  return (
    <form action={operatorSignOutAction}>
      <Button />
    </form>
  );
}
