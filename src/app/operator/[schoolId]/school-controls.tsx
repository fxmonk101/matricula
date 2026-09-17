'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@/components/ui';
import {
  activateSchoolAction,
  reissueOwnerPasswordAction,
  raiseInvoiceAction,
  recordPaymentAction,
  setPlanAction,
  setStatusAction,
  type PlatformFormState,
} from '../actions';

function Submit({
  children,
  variant = 'primary',
}: {
  children: string;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending} className="w-full">
      {pending ? 'Working…' : children}
    </Button>
  );
}

function Result({ state }: { state: PlatformFormState }) {
  if (!state.message) return null;
  return (
    <Alert tone={state.ok ? 'success' : 'danger'} className="mt-2">
      {state.message}
    </Alert>
  );
}

/** ISO date for a `type="date"` input, in the browser's own reckoning. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function SchoolControls({
  schoolId,
  schoolName,
  schoolStatus,
  hasSubscription,
  subscriptionStatus,
  currentPlanId,
  seatOverrideStudents,
  seatOverrideStaff,
  plans,
  openInvoices,
  currencySymbol,
}: {
  schoolId: string;
  schoolName: string;
  schoolStatus: string;
  hasSubscription: boolean;
  subscriptionStatus: string | null;
  currentPlanId: string | null;
  seatOverrideStudents: number | null;
  seatOverrideStaff: number | null;
  plans: { id: string; name: string }[];
  openInvoices: { id: string; reference: string; dueMinor: number }[];
  currencySymbol: string;
}) {
  const [activateState, activate] = useActionState<PlatformFormState, FormData>(
    activateSchoolAction,
    {},
  );
  const [reissueState, reissue] = useActionState<PlatformFormState, FormData>(
    reissueOwnerPasswordAction,
    {},
  );
  const [planState, savePlan] = useActionState<PlatformFormState, FormData>(setPlanAction, {});
  const [statusState, saveStatus] = useActionState<PlatformFormState, FormData>(
    setStatusAction,
    {},
  );
  const [invoiceState, raiseInvoice] = useActionState<PlatformFormState, FormData>(
    raiseInvoiceAction,
    {},
  );
  const [paymentState, recordPayment] = useActionState<PlatformFormState, FormData>(
    recordPaymentAction,
    {},
  );

  const today = new Date();
  const yearEnd = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());

  return (
    <div className="space-y-4">
      {schoolStatus === 'PROVISIONING' && (
        <Card>
          <CardHeader
            title="Open this school"
            description="Lets everybody sign in, not just the owner."
          />
          <CardBody>
            <form action={activate}>
              <input type="hidden" name="schoolId" value={schoolId} />
              <Submit>{`Open ${schoolName}`}</Submit>
            </form>
            <Result state={activateState} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Owner access"
          description="For an owner who cannot get in. Their current password stops working immediately."
        />
        <CardBody>
          <form action={reissue}>
            <input type="hidden" name="schoolId" value={schoolId} />
            <Submit>Issue a new owner password</Submit>
          </form>

          {/*
            Shown ONCE and never recoverable, which is the same contract as
            provisioning. It is rendered as selectable text rather than
            summarised, because the next thing that happens is somebody reading
            it down a telephone.
          */}
          {reissueState.temporaryPassword && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
              <p className="text-xs font-medium text-amber-900">
                Give this to {reissueState.ownerEmail ?? 'the owner'} now. It cannot be shown
                again, and they must change it at first sign-in.
              </p>
              <code className="mt-2 block select-all break-all rounded bg-white px-2 py-1.5 font-mono text-sm text-slate-900 ring-1 ring-inset ring-amber-200">
                {reissueState.temporaryPassword}
              </code>
            </div>
          )}
          {reissueState.message && !reissueState.temporaryPassword && (
            <Result state={reissueState} />
          )}
        </CardBody>
      </Card>

      {hasSubscription && (
        <>
          <Card>
            <CardHeader
              title="Plan and seats"
              description="An override beats the plan for this school alone. Leave blank to use the plan's own ceiling."
            />
            <CardBody>
              <form action={savePlan} className="space-y-3">
                <input type="hidden" name="schoolId" value={schoolId} />
                <Field label="Plan" htmlFor="planId">
                  <Select id="planId" name="planId" defaultValue={currentPlanId ?? ''}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Student seats" htmlFor="seatOverrideStudents" hint="Blank = plan">
                    <Input
                      id="seatOverrideStudents"
                      name="seatOverrideStudents"
                      type="number"
                      min={0}
                      defaultValue={seatOverrideStudents ?? ''}
                    />
                  </Field>
                  <Field label="Staff seats" htmlFor="seatOverrideStaff" hint="Blank = plan">
                    <Input
                      id="seatOverrideStaff"
                      name="seatOverrideStaff"
                      type="number"
                      min={0}
                      defaultValue={seatOverrideStaff ?? ''}
                    />
                  </Field>
                </div>
                <Submit variant="secondary">Save plan</Submit>
              </form>
              <Result state={planState} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Subscription status"
              description="Cancelling suspends the school. Past due does not — a school is never locked out of its own records over an unpaid invoice."
            />
            <CardBody>
              <form action={saveStatus} className="space-y-3">
                <input type="hidden" name="schoolId" value={schoolId} />
                <Field label="Status" htmlFor="status">
                  <Select id="status" name="status" defaultValue={subscriptionStatus ?? 'ACTIVE'}>
                    <option value="TRIALING">Trialing</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAST_DUE">Past due</option>
                    <option value="CANCELLED">Cancelled — suspends the school</option>
                  </Select>
                </Field>
                <Field label="Note" htmlFor="note" hint="Read by operators, never by the school.">
                  <Input id="note" name="note" placeholder="Renewal agreed by phone, 8 Sept" />
                </Field>
                <Submit variant="secondary">Update status</Submit>
              </form>
              <Result state={statusState} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Raise an invoice"
              description="Priced from the plan at this moment and copied onto the invoice, so a later price change cannot rewrite history."
            />
            <CardBody>
              <form action={raiseInvoice} className="space-y-3">
                <input type="hidden" name="schoolId" value={schoolId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Period starts" htmlFor="periodStart">
                    <Input
                      id="periodStart"
                      name="periodStart"
                      type="date"
                      defaultValue={isoDate(today)}
                      required
                    />
                  </Field>
                  <Field label="Period ends" htmlFor="periodEnd">
                    <Input
                      id="periodEnd"
                      name="periodEnd"
                      type="date"
                      defaultValue={isoDate(yearEnd)}
                      required
                    />
                  </Field>
                </div>
                <Field label="Payment terms" htmlFor="dueInDays" hint="Days until due.">
                  <Input id="dueInDays" name="dueInDays" type="number" min={0} defaultValue={14} />
                </Field>
                <Submit variant="secondary">Raise invoice</Submit>
              </form>
              <Result state={invoiceState} />
            </CardBody>
          </Card>

          {openInvoices.length > 0 && (
            <Card>
              <CardHeader
                title="Record a payment"
                description="A part payment stays a part payment — it is neither rounded up to paid nor discarded."
              />
              <CardBody>
                <form action={recordPayment} className="space-y-3">
                  <input type="hidden" name="schoolId" value={schoolId} />
                  <Field label="Invoice" htmlFor="invoiceId">
                    <Select id="invoiceId" name="invoiceId">
                      {openInvoices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.reference} — {currencySymbol}
                          {(i.dueMinor / 100).toFixed(2)} due
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={`Amount received (${currencySymbol})`} htmlFor="amount">
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Method" htmlFor="method">
                      <Select id="method" name="method" defaultValue="BANK_TRANSFER">
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="CARD">Card</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="CASH">Cash</option>
                      </Select>
                    </Field>
                    <Field label="Reference" htmlFor="reference">
                      <Input id="reference" name="reference" placeholder="FT26090812345" />
                    </Field>
                  </div>
                  <Submit variant="secondary">Record payment</Submit>
                </form>
                <Result state={paymentState} />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
