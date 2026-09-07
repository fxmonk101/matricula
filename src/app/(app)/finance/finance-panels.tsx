'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';

import { titleCase } from '@/lib/utils';
import {
  recordPaymentAction,
  issueInvoiceAction,
  placeHoldAction,
  releaseHoldAction,
  type FinanceState,
} from './actions';

interface Option {
  id: string;
  label: string;
}

function Submit({ label, busy, variant }: { label: string; busy: string; variant?: 'primary' | 'danger' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant ?? 'primary'} className="w-full" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function PaymentPanel({
  students,
  currencyCode,
}: {
  students: Option[];
  currencyCode: string;
}) {
  const [state, action] = useActionState<FinanceState, FormData>(recordPaymentAction, {});

  return (
    <Card>
      <CardHeader
        title="Record a payment"
        description="Allocated automatically across open invoices, oldest due date first. Any excess is held as student credit."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          {state.message ? (
            <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
          ) : null}

          <Field label="Student" htmlFor="pay-student" required>
            <Select id="pay-student" name="studentId" required defaultValue="">
              <option value="" disabled>
                Choose a student
              </option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currencyCode})`} htmlFor="amount" required>
              <Input
                id="amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="150000.00"
                className="tabular-nums"
              />
            </Field>

            <Field label="Method" htmlFor="method" required>
              <Select id="method" name="method" required defaultValue="BANK_TRANSFER">
                {['BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'SCHOLARSHIP', 'WAIVER'].map((m) => (
                  <option key={m} value={m}>
                    {titleCase(m)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label="Provider reference"
            htmlFor="externalRef"
            hint="Optional, but makes the payment idempotent — a repeated reference is never double-credited."
          >
            <Input id="externalRef" name="externalRef" placeholder="e.g. TXN-88301992" />
          </Field>

          <Field label="Note" htmlFor="note">
            <Textarea id="note" name="note" rows={2} maxLength={500} className="min-h-16" />
          </Field>

          <Submit label="Record payment" busy="Recording…" />
        </form>
      </CardBody>
    </Card>
  );
}

export function InvoicePanel({
  students,
  terms,
}: {
  students: Option[];
  terms: { id: string; name: string; isCurrent: boolean }[];
}) {
  const [state, action] = useActionState<FinanceState, FormData>(issueInvoiceAction, {});

  return (
    <Card>
      <CardHeader
        title="Assess and issue an invoice"
        description="Resolves the most specific fee structure for the student's program and level, then bills per-credit items against their actual registration."
      />
      <CardBody>
        <form action={action} className="space-y-3">
          {state.message ? (
            <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
          ) : null}

          <Field label="Student" htmlFor="inv-student" required>
            <Select id="inv-student" name="studentId" required defaultValue="">
              <option value="" disabled>
                Choose a student
              </option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Term" htmlFor="inv-term" required>
            <Select
              id="inv-term"
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

          <Field
            label="Award / discount (%)"
            htmlFor="discountPercent"
            hint="Applied against the assessed subtotal, never compounded."
          >
            <Input
              id="discountPercent"
              name="discountPercent"
              type="number"
              min={0}
              max={100}
              step="0.5"
              defaultValue={0}
            />
          </Field>

          <Submit label="Issue invoice" busy="Assessing…" />
        </form>
      </CardBody>
    </Card>
  );
}

export function HoldPanel({
  students,
  holds,
}: {
  students: Option[];
  holds: { id: string; kind: string; reason: string; studentLabel: string; placedAt: string }[];
}) {
  const [placeState, placeAction] = useActionState<FinanceState, FormData>(placeHoldAction, {});
  const [releaseState, releaseAction] = useActionState<FinanceState, FormData>(
    releaseHoldAction,
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Holds"
        description="A hold blocks registration. Placing one is always a deliberate act by a named officer; a settled account releases its financial hold automatically."
      />
      <CardBody className="space-y-4">
        <form action={placeAction} className="space-y-3">
          {placeState.message ? (
            <Alert tone={placeState.ok ? 'success' : 'danger'}>{placeState.message}</Alert>
          ) : null}

          <Field label="Student" htmlFor="hold-student" required>
            <Select id="hold-student" name="studentId" required defaultValue="">
              <option value="" disabled>
                Choose a student
              </option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Kind" htmlFor="hold-kind" required>
            <Select id="hold-kind" name="kind" required defaultValue="FINANCIAL">
              {['FINANCIAL', 'ACADEMIC', 'DISCIPLINARY', 'DOCUMENTATION', 'HEALTH'].map((k) => (
                <option key={k} value={k}>
                  {titleCase(k)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reason" htmlFor="hold-reason" required hint="Shown to the student.">
            <Input
              id="hold-reason"
              name="reason"
              required
              minLength={3}
              maxLength={300}
              placeholder="Outstanding tuition balance for 2025/2026"
            />
          </Field>

          <Submit label="Place hold" busy="Placing…" variant="danger" />
        </form>

        {holds.length > 0 ? (
          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-700">
              Active holds ({holds.length})
            </p>
            {releaseState.message ? (
              <Alert tone={releaseState.ok ? 'success' : 'danger'} className="mb-2">
                {releaseState.message}
              </Alert>
            ) : null}
            <ul className="space-y-2">
              {holds.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <Badge tone="danger">{titleCase(h.kind)}</Badge>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                      {h.studentLabel}
                    </p>
                    <p className="text-[11px] text-slate-600">{h.reason}</p>
                  </div>
                  <form action={releaseAction} className="shrink-0">
                    <input type="hidden" name="holdId" value={h.id} />
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                    >
                      Release
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
