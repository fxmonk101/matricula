'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { runAllocationAction, type AdmissionsState } from './actions';

function RunButton({ commit }: { commit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="commit"
      value={commit ? 'yes' : 'no'}
      variant={commit ? 'danger' : 'primary'}
      className="flex-1"
      disabled={pending}
    >
      {pending ? 'Running…' : commit ? 'Commit decisions' : 'Preview'}
    </Button>
  );
}

/**
 * The committee's control surface for the rank-and-fill algorithm.
 *
 * "Preview" and "Commit" post the same form to the same action, differing only
 * in the `commit` field. That is intentional: what the committee previews is
 * computed by exactly the same code path that later writes the decisions, so
 * the preview cannot diverge from the outcome.
 */
export function AllocationPanel({
  programs,
  terms,
}: {
  programs: { id: string; code: string; name: string }[];
  terms: { id: string; code: string; name: string; isCurrent: boolean }[];
}) {
  const [state, action] = useActionState<AdmissionsState, FormData>(runAllocationAction, {});
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Cohort allocation"
        description="Rank the pool and fill against capacity. Preview first — offers cannot be unsent."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          <Field label="Program" htmlFor="programId" required>
            <Select id="programId" name="programId" required defaultValue="">
              <option value="" disabled>
                Choose a program
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Intake term" htmlFor="termId" required>
            <Select
              id="termId"
              name="termId"
              required
              defaultValue={terms.find((t) => t.isCurrent)?.id ?? ''}
            >
              <option value="" disabled>
                Choose a term
              </option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Places in the intake"
              htmlFor="capacity"
              hint="The total. Offers already made count against it"
              required
            >
              <Input id="capacity" name="capacity" type="number" min={0} defaultValue={30} required />
            </Field>
            <Field label="Waitlist places" htmlFor="waitlistCapacity" required>
              <Input
                id="waitlistCapacity"
                name="waitlistCapacity"
                type="number"
                min={0}
                defaultValue={10}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Minimum composite"
              htmlFor="minimumComposite"
              hint="Auto-reject below this"
            >
              <Input
                id="minimumComposite"
                name="minimumComposite"
                type="number"
                min={0}
                max={100}
                step="0.5"
                defaultValue={40}
              />
            </Field>
            <Field label="Reviews required" htmlFor="requiredReviews" hint="Before deciding">
              <Input
                id="requiredReviews"
                name="requiredReviews"
                type="number"
                min={0}
                max={10}
                defaultValue={2}
              />
            </Field>
          </div>

          <div className="flex gap-2 pt-1">
            <RunButton commit={false} />
            <RunButton commit={true} />
          </div>
        </form>

        {state.message ? (
          <div className="mt-3">
            <Alert tone={state.dryRun ? 'info' : state.ok ? 'success' : 'danger'}>
              {state.message}
            </Alert>
          </div>
        ) : null}

        {state.summary && state.summary.decisions.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {expanded ? 'Hide' : 'Show'} the {state.summary.decisions.length} individual
              decisions and their rationale
            </button>

            {expanded ? (
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-2.5">
                {state.summary.decisions.map((d) => (
                  <li key={d.referenceNo} className="text-[11px] leading-relaxed">
                    <span className="font-mono font-medium text-slate-900">{d.referenceNo}</span>{' '}
                    <span
                      className={
                        d.status === 'OFFERED'
                          ? 'font-semibold text-emerald-700'
                          : d.status === 'WAITLISTED'
                            ? 'font-semibold text-amber-700'
                            : d.status === 'REJECTED'
                              ? 'font-semibold text-rose-700'
                              : 'font-semibold text-slate-600'
                      }
                    >
                      {d.status}
                    </span>
                    <div className="text-slate-500">{d.rationale}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
