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
import {
  SEASONS,
  SEASON_LABELS,
  academicYearRejectionReason,
  buildTermCode,
  isSeason,
  normaliseTermCode,
  termCodeRejectionReason,
  validateTermDates,
  type Season,
} from '@/lib/domain/term';
import {
  deleteTermAction,
  saveTermAction,
  setCurrentTermAction,
  type CalendarFormState,
} from './actions';

export interface TermRow {
  id: string;
  code: string;
  name: string;
  academicYear: string;
  season: string;
  startDate: string;
  endDate: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  addDropDeadline: string;
  withdrawalDeadline: string;
  isCurrent: boolean;
  offeringCount: number;
  invoiceCount: number;
  feeStructureCount: number;
  applicationCount: number;
}

/** `2026-09-15T00:00:00.000Z` -> `2026-09-15`, which is what a date input wants. */
const asDateValue = (iso: string) => iso.slice(0, 10);

function useResult(state: CalendarFormState, onSuccess: () => void, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not saved',
      body: state.message,
    });
    // Overlaps are reported separately and do not block the save, so they are
    // announced as their own message rather than buried in the success one.
    for (const warning of state.warnings ?? []) {
      push({ tone: 'info', title: 'Check the dates', body: warning });
    }
    if (state.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function TermDialog({
  term,
  trigger,
  isFirstTerm,
}: {
  term?: TermRow;
  trigger: React.ReactNode;
  isFirstTerm?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<CalendarFormState, FormData>(saveTermAction, {});
  useResult(state, () => setOpen(false), term ? 'Term saved' : 'Term created');

  const [academicYear, setAcademicYear] = useState(term?.academicYear ?? '');
  const [season, setSeason] = useState<string>(term?.season ?? 'FALL');
  const [code, setCode] = useState(term?.code ?? '');
  const [dates, setDates] = useState({
    startDate: term ? asDateValue(term.startDate) : '',
    endDate: term ? asDateValue(term.endDate) : '',
    registrationOpensAt: term ? asDateValue(term.registrationOpensAt) : '',
    registrationClosesAt: term ? asDateValue(term.registrationClosesAt) : '',
    addDropDeadline: term ? asDateValue(term.addDropDeadline) : '',
    withdrawalDeadline: term ? asDateValue(term.withdrawalDeadline) : '',
  });

  // The code is derived until the registrar types their own — the convention
  // everywhere, and it keeps codes sorting chronologically as strings.
  const derivedCode =
    academicYear && isSeason(season) ? buildTermCode(academicYear, season as Season) : '';
  const effectiveCode = code || derivedCode;

  const yearProblem = academicYear ? academicYearRejectionReason(academicYear) : null;
  const codeProblem = effectiveCode ? termCodeRejectionReason(effectiveCode) : null;
  // Checked with the SAME function the server uses, so what the registrar is
  // told while typing is exactly what they would be refused for.
  const dateProblems = Object.values(dates).every(Boolean) ? validateTermDates(dates) : [];

  const set = (key: keyof typeof dates) => (value: string) =>
    setDates((d) => ({ ...d, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        wide
        title={term ? `Edit ${term.name}` : 'New term'}
        description="Sections, registration, marks and invoices all belong to a term, so its dates decide what is possible when."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="term-form" type="submit" size="sm">
              {term ? 'Save changes' : 'Create term'}
            </Button>
          </>
        }
      >
        <form id="term-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {term && <input type="hidden" name="termId" value={term.id} />}
          <input type="hidden" name="code" value={effectiveCode} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Academic session"
              htmlFor="academicYear"
              required
              error={yearProblem ?? undefined}
              hint="As printed on a transcript."
            >
              <Input
                id="academicYear"
                name="academicYear"
                required
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="2026/2027"
              />
            </Field>

            <Field label="Semester" htmlFor="season" required>
              <Select
                id="season"
                name="season"
                required
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              >
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {SEASON_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                required
                defaultValue={term?.name}
                placeholder="First Semester 2026/2027"
              />
            </Field>

            <Field
              label="Code"
              htmlFor="code-display"
              error={codeProblem ?? undefined}
              hint="Derived from the session and semester. Override if your registry uses another form."
            >
              <Input
                id="code-display"
                value={effectiveCode}
                onChange={(e) => setCode(normaliseTermCode(e.target.value))}
                placeholder="2026-FALL"
              />
            </Field>
          </div>

          <div className="border-t border-slate-200/70 pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
              The term itself
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="startDate" required>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  required
                  value={dates.startDate}
                  onChange={(e) => set('startDate')(e.target.value)}
                />
              </Field>
              <Field label="Ends" htmlFor="endDate" required>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  required
                  value={dates.endDate}
                  onChange={(e) => set('endDate')(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-slate-200/70 pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
              Registration window
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Opens"
                htmlFor="registrationOpensAt"
                required
                hint="Usually before the term starts."
              >
                <Input
                  id="registrationOpensAt"
                  name="registrationOpensAt"
                  type="date"
                  required
                  value={dates.registrationOpensAt}
                  onChange={(e) => set('registrationOpensAt')(e.target.value)}
                />
              </Field>
              <Field label="Closes" htmlFor="registrationClosesAt" required>
                <Input
                  id="registrationClosesAt"
                  name="registrationClosesAt"
                  type="date"
                  required
                  value={dates.registrationClosesAt}
                  onChange={(e) => set('registrationClosesAt')(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-slate-200/70 pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
              Deadlines
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Add / drop"
                htmlFor="addDropDeadline"
                required
                hint="Last day to drop with no transcript mark."
              >
                <Input
                  id="addDropDeadline"
                  name="addDropDeadline"
                  type="date"
                  required
                  value={dates.addDropDeadline}
                  onChange={(e) => set('addDropDeadline')(e.target.value)}
                />
              </Field>
              <Field
                label="Withdrawal"
                htmlFor="withdrawalDeadline"
                required
                hint="Last day to withdraw at all."
              >
                <Input
                  id="withdrawalDeadline"
                  name="withdrawalDeadline"
                  type="date"
                  required
                  value={dates.withdrawalDeadline}
                  onChange={(e) => set('withdrawalDeadline')(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {dateProblems.length > 0 && (
            <Alert tone="warning" title="These dates do not work together">
              <ul className="mt-1 space-y-0.5">
                {dateProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}

          {(isFirstTerm || term?.isCurrent) && (
            <label className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
              <input
                type="checkbox"
                name="makeCurrent"
                value="true"
                defaultChecked={isFirstTerm || term?.isCurrent}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-xs leading-relaxed text-slate-700">
                <strong className="font-medium text-slate-900">Make this the current term.</strong>{' '}
                Only one term can be current, so any other will be cleared.
              </span>
            </label>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Row actions for a term. */
export function TermActions({ term }: { term: TermRow }) {
  const [current, setCurrent] = useActionState<CalendarFormState, FormData>(
    setCurrentTermAction,
    {},
  );
  const [removed, remove] = useActionState<CalendarFormState, FormData>(deleteTermAction, {});
  const [confirming, setConfirming] = useState(false);

  useResult(current, () => {}, 'Current term changed');
  useResult(removed, () => {}, 'Term deleted');

  const used =
    term.offeringCount + term.invoiceCount + term.feeStructureCount + term.applicationCount;

  const run = (
    submit: (data: FormData) => void,
    fields: Record<string, string>,
  ) => () => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    submit(data);
  };

  return (
    <>
      <Menu>
        <MenuButton label="Manage" />
        <MenuContent>
          <TermDialog
            term={term}
            trigger={
              <DialogTrigger asChild>
                <MenuItem>Edit term</MenuItem>
              </DialogTrigger>
            }
          />
          {!term.isCurrent && (
            <MenuItem onSelect={run(setCurrent, { termId: term.id })}>
              Make current
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem destructive onSelect={() => setConfirming(true)}>
            Delete term
          </MenuItem>
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${term.name}?`}
        body={
          used > 0 ? (
            <>
              This term already has sections, invoices or fee schedules attached. A term that has
              been taught cannot be deleted — its records reference it — so this will be refused.
            </>
          ) : term.isCurrent ? (
            <>This is the current term. Make another current first.</>
          ) : (
            <>Nothing has happened in this term yet, so nothing else is affected.</>
          )
        }
        confirmLabel="Delete term"
        destructive
        onConfirm={run(remove, { termId: term.id })}
      />
    </>
  );
}
