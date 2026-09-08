'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Alert, Badge, Button, Field, Select } from '@/components/ui';
import { allocateSectionAction, type AllocateFormState } from './actions';

export interface AllocOption {
  offeringId: string;
  label: string;
  creditHours: number;
  currentInstructor: string | null;
  suggestedInstructorId: string | null;
  suggestedName: string | null;
}

export interface AllocInstructor {
  instructorId: string;
  name: string;
  rank: string;
  assignedUnits: number;
  capacityUnits: number;
  utilisation: number;
}

function AllocateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Allocating…' : 'Allocate and raise tasks'}
    </Button>
  );
}

export function AllocateDialog({
  options,
  instructors,
}: {
  options: AllocOption[];
  instructors: AllocInstructor[];
}) {
  const [open, setOpen] = useState(false);
  const [offeringId, setOfferingId] = useState('');
  const [instructorId, setInstructorId] = useState('');
  const [state, action] = useActionState<AllocateFormState, FormData>(allocateSectionAction, {});
  const router = useRouter();

  const selected = options.find((o) => o.offeringId === offeringId) ?? null;

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setOfferingId('');
      setInstructorId('');
      router.refresh();
    }
  }, [state.ok, router]);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Allocate a section
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim/50 p-4 pt-16">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-lg ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-200/70 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Allocate a section</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Allocating raises two tasks for the lecturer — teaching, and grade submission — with
            deadlines taken from the term.
          </p>
        </div>

        <form action={action} className="space-y-4 px-5 py-4">
          {state.message ? (
            <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
          ) : null}

          <Field label="Section" htmlFor="offeringId" required>
            <Select
              id="offeringId"
              name="offeringId"
              required
              value={offeringId}
              onChange={(e) => {
                setOfferingId(e.target.value);
                setInstructorId('');
              }}
            >
              <option value="" disabled>
                Choose a section…
              </option>
              {options.map((o) => (
                <option key={o.offeringId} value={o.offeringId}>
                  {o.label} ({o.creditHours} cr)
                  {o.currentInstructor ? ` — currently ${o.currentInstructor}` : ' — unallocated'}
                </option>
              ))}
            </Select>
          </Field>

          {selected?.currentInstructor ? (
            <Alert tone="warning">
              {selected.currentInstructor} currently holds this section. Reallocating cancels their
              open tasks for it — the history stays, so it remains clear the work was once asked of
              them.
            </Alert>
          ) : null}

          <Field
            label="Instructor"
            htmlFor="instructorId"
            required
            hint="Utilisation is against each person's own ceiling, which varies by academic rank."
          >
            <Select
              id="instructorId"
              name="instructorId"
              required
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
            >
              <option value="" disabled>
                Choose an instructor…
              </option>
              {instructors.map((i) => (
                <option key={i.instructorId} value={i.instructorId}>
                  {i.name} — {i.assignedUnits}/{i.capacityUnits} cr ({Math.round(i.utilisation * 100)}%)
                  {i.utilisation >= 1 ? ' · at capacity' : ''}
                </option>
              ))}
            </Select>
          </Field>

          {selected ? (
            selected.suggestedInstructorId ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
                <Badge tone="brand">Suggestion</Badge>
                <span className="text-xs text-slate-600">
                  {selected.suggestedName} has the most headroom for {selected.creditHours} credit
                  hours.
                </span>
                <button
                  type="button"
                  onClick={() => setInstructorId(selected.suggestedInstructorId as string)}
                  className="ml-auto text-xs font-medium text-brand-700 hover:underline"
                >
                  Use
                </button>
              </div>
            ) : (
              <Alert tone="warning">
                No instructor has {selected.creditHours} credit hours of headroom. You can still
                allocate deliberately — but somebody will go over their ceiling.
              </Alert>
            )
          ) : null}

          <p className="text-[11px] leading-relaxed text-slate-500">
            This is a suggestion, not a decision. Specialism, research leave and departmental
            commitments are not visible to the calculation, so the choice stays yours.
          </p>

          <div className="flex justify-end gap-2 border-t border-slate-200/70 pt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <AllocateButton />
          </div>
        </form>
      </div>
    </div>
  );
}
