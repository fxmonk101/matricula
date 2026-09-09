'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Select } from '@/components/ui';
import { canActOn } from '@/lib/domain/people';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
import {
  changeRoleAction,
  resetPasswordAction,
  setStatusAction,
  type PeopleFormState,
} from './actions';

function Pending({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? '…' : children}</>;
}

export function PersonActions({
  person,
  actorRole,
  actorMembershipId,
  assignableRoles,
}: {
  person: { membershipId: string; name: string; role: Role; status: string };
  actorRole: Role;
  actorMembershipId: string;
  assignableRoles: Role[];
}) {
  const [open, setOpen] = useState(false);
  const [roleState, changeRole] = useActionState<PeopleFormState, FormData>(changeRoleAction, {});
  const [statusState, setStatus] = useActionState<PeopleFormState, FormData>(setStatusAction, {});
  const [pwState, resetPw] = useActionState<PeopleFormState, FormData>(resetPasswordAction, {});

  const actor = { role: actorRole, membershipId: actorMembershipId };
  const target = { membershipId: person.membershipId, role: person.role };

  // Checked with the SAME function the server uses. An action the server would
  // refuse is not rendered — a disabled-looking button that fails on click is
  // worse than no button, because the user assumes they did something wrong.
  const mayChangeRole = canActOn(actor, target, 'role');
  const maySuspend = canActOn(actor, target, 'suspend');
  const mayResetPassword = canActOn(actor, target, 'password');

  const suspended = person.status === 'SUSPENDED';
  const message = pwState.message ?? statusState.message ?? roleState.message;
  const messageOk = pwState.message ? pwState.ok : statusState.message ? statusState.ok : roleState.ok;

  if (pwState.temporaryPassword) {
    return (
      <div className="inline-block rounded-lg bg-slate-900 px-3 py-2 text-left">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">New one-time password</p>
        <p className="font-mono text-sm font-semibold tracking-widest text-white">
          {pwState.temporaryPassword}
        </p>
        <p className="mt-0.5 text-[10px] text-slate-400">Shown once. {person.name}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brand-700 hover:underline"
      >
        Manage
      </button>
    );
  }

  return (
    <div className="inline-flex flex-col items-end gap-1.5">
      {mayChangeRole.allowed ? (
        <form action={changeRole} className="flex items-center gap-1.5">
          <input type="hidden" name="membershipId" value={person.membershipId} />
          <Select
            name="newRole"
            defaultValue={person.role}
            className="h-7 w-32 px-2 pr-6 text-[11px]"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-[11px]">
            <Pending>Set</Pending>
          </Button>
        </form>
      ) : (
        <span className="text-[10px] text-slate-400">{mayChangeRole.reason}</span>
      )}

      <div className="flex gap-1.5">
        {mayResetPassword.allowed && (
          <form
            action={resetPw}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Issue a new one-time password for ${person.name}? Their current password stops working immediately.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="membershipId" value={person.membershipId} />
            <input type="hidden" name="personName" value={person.name} />
            <Button type="submit" size="sm" variant="secondary" className="h-7 px-2 text-[11px]">
              <Pending>Reset password</Pending>
            </Button>
          </form>
        )}

        {maySuspend.allowed && (
          <form
            action={setStatus}
            onSubmit={(e) => {
              if (
                !suspended &&
                !window.confirm(
                  `Suspend ${person.name}? They keep their account and any membership at another school — only their access here stops.`,
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="membershipId" value={person.membershipId} />
            <input type="hidden" name="suspend" value={String(!suspended)} />
            <Button
              type="submit"
              size="sm"
              variant={suspended ? 'secondary' : 'danger'}
              className="h-7 px-2 text-[11px]"
            >
              <Pending>{suspended ? 'Reinstate' : 'Suspend'}</Pending>
            </Button>
          </form>
        )}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>

      {message && (
        <span className={messageOk ? 'text-[10px] text-emerald-700' : 'text-[10px] text-rose-700'}>
          {message}
        </span>
      )}
    </div>
  );
}
