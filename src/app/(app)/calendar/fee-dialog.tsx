'use client';

import { useActionState, useEffect, useState } from 'react';

import { Alert, Button, Field, Input, Select } from '@/components/ui';
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Menu,
  MenuButton,
  MenuContent,
  MenuItem,
  MenuSeparator,
  useToast,
} from '@/components/ui/overlays';
import { FEE_CODES } from '@/lib/domain/finance';
import {
  deleteFeeStructureAction,
  saveFeeStructureAction,
  setFeeStructureActiveAction,
  type CalendarFormState,
} from './actions';

export interface FeeLine {
  code: string;
  description: string;
  /** MAJOR units, for the form. */
  amount: string;
  perCreditHour: boolean;
  isMandatory: boolean;
}

export interface FeeStructureRow {
  id: string;
  name: string;
  termId: string;
  termCode: string;
  programId: string | null;
  programCode: string | null;
  level: number | null;
  isActive: boolean;
  items: FeeLine[];
  totalMinor: number;
}

export interface TermOption {
  id: string;
  code: string;
  name: string;
  isCurrent: boolean;
}
export interface ProgrammeOption {
  id: string;
  code: string;
  name: string;
}

function useResult(state: CalendarFormState, onSuccess: () => void, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not saved',
      body: state.message,
    });
    if (state.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

const BLANK: FeeLine = {
  code: 'TUITION',
  description: '',
  amount: '',
  perCreditHour: false,
  isMandatory: true,
};

export function FeeStructureDialog({
  structure,
  terms,
  programmes,
  levels,
  currencySymbol,
  trigger,
}: {
  structure?: FeeStructureRow;
  terms: TermOption[];
  programmes: ProgrammeOption[];
  levels: number[];
  currencySymbol: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<CalendarFormState, FormData>(
    saveFeeStructureAction,
    {},
  );
  useResult(state, () => setOpen(false), structure ? 'Fee schedule saved' : 'Fee schedule created');

  const [lines, setLines] = useState<FeeLine[]>(
    structure?.items.length ? structure.items : [{ ...BLANK }],
  );

  const total = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const update = (index: number, patch: Partial<FeeLine>) =>
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        wide
        title={structure ? `Edit ${structure.name}` : 'New fee schedule'}
        description="What a student is charged for a term. Leave programme or level blank to apply it to all of them."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="fee-form" type="submit" size="sm">
              {structure ? 'Save changes' : 'Create schedule'}
            </Button>
          </>
        }
      >
        <form id="fee-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {structure && <input type="hidden" name="structureId" value={structure.id} />}

          <Field label="Name" htmlFor="fee-name" required>
            <Input
              id="fee-name"
              name="name"
              required
              defaultValue={structure?.name}
              placeholder="Undergraduate fees, first semester"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Term" htmlFor="fee-term" required>
              <Select
                id="fee-term"
                name="termId"
                required
                defaultValue={structure?.termId ?? terms.find((t) => t.isCurrent)?.id ?? ''}
              >
                <option value="" disabled>
                  Choose a term
                </option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                    {t.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Programme"
              htmlFor="fee-programme"
              hint="Blank applies to all."
            >
              <Select
                id="fee-programme"
                name="programId"
                defaultValue={structure?.programId ?? ''}
              >
                <option value="">Every programme</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Level" htmlFor="fee-level" hint="Blank applies to all.">
              <Select id="fee-level" name="level" defaultValue={structure?.level?.toString() ?? ''}>
                <option value="">Every level</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* ------------------------------------------------------- the lines */}
          <div className="border-t border-slate-200/70 pt-4">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Fee lines
              </p>
              <p className="text-xs tabular-nums text-slate-600">
                Total {currencySymbol}
                {total.toLocaleString()}
              </p>
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200 sm:grid-cols-[7rem_1fr_8rem_auto]"
                >
                  <Select
                    name="itemCode"
                    value={line.code}
                    onChange={(e) => update(index, { code: e.target.value })}
                    className="h-8 text-xs"
                    aria-label="Fee code"
                  >
                    {FEE_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>

                  <Input
                    name="itemDescription"
                    value={line.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Tuition"
                    className="h-8 text-xs"
                    aria-label="Description"
                  />

                  <Input
                    name="itemAmount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.amount}
                    onChange={(e) => update(index, { amount: e.target.value })}
                    placeholder="0"
                    className="h-8 text-xs"
                    aria-label={`Amount in ${currencySymbol}`}
                  />

                  {/*
                    Carried as explicit hidden values, not checkboxes.
                    A browser omits an unticked checkbox from the payload
                    entirely, so the parallel arrays the server zips would fall
                    out of alignment and every flag after the first blank row
                    would attach to the wrong line.
                  */}
                  <input type="hidden" name="itemPerCredit" value={String(line.perCreditHour)} />
                  <input type="hidden" name="itemMandatory" value={String(line.isMandatory)} />

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={line.perCreditHour}
                        onChange={(e) => update(index, { perCreditHour: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      per credit
                    </label>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLines((c) => c.filter((_, i) => i !== index))}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label="Remove this line"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setLines((c) => [...c, { ...BLANK }])}
            >
              Add a line
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FeeStructureActions({
  structure,
  terms,
  programmes,
  levels,
  currencySymbol,
}: {
  structure: FeeStructureRow;
  terms: TermOption[];
  programmes: ProgrammeOption[];
  levels: number[];
  currencySymbol: string;
}) {
  const [activeState, setActive] = useActionState<CalendarFormState, FormData>(
    setFeeStructureActiveAction,
    {},
  );
  const [removed, remove] = useActionState<CalendarFormState, FormData>(
    deleteFeeStructureAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  useResult(activeState, () => {}, 'Fee schedule updated');
  useResult(removed, () => {}, 'Fee schedule deleted');

  const run = (submit: (d: FormData) => void, fields: Record<string, string>) => () => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    submit(data);
  };

  return (
    <>
      <Menu>
        <MenuButton label="Manage" />
        <MenuContent>
          <FeeStructureDialog
            structure={structure}
            terms={terms}
            programmes={programmes}
            levels={levels}
            currencySymbol={currencySymbol}
            trigger={
              <DialogTrigger asChild>
                <MenuItem>Edit schedule</MenuItem>
              </DialogTrigger>
            }
          />
          <MenuItem
            onSelect={run(setActive, {
              structureId: structure.id,
              isActive: String(!structure.isActive),
            })}
          >
            {structure.isActive ? 'Withdraw' : 'Reinstate'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setConfirming(true)}>
            Delete schedule
          </MenuItem>
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${structure.name}?`}
        body={
          <>
            Invoices already raised from this schedule copied their amounts at the time and are not
            affected. Only future invoices change.
          </>
        }
        confirmLabel="Delete schedule"
        destructive
        onConfirm={run(remove, { structureId: structure.id })}
      />
    </>
  );
}
