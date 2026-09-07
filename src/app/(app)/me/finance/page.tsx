import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { getStudentAccount } from '@/server/services/finance.service';
import { formatMoney } from '@/lib/domain/money';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';

export const metadata: Metadata = { title: 'My fees' };

export default async function MyFinancePage() {
  const { db, school, schoolId, session } = await requireTenantRole('STUDENT');
  if (!session.pid) redirect('/forbidden');

  const student = await db.student.findUnique({
    where: { id: session.pid },
    select: { matricNumber: true },
  });
  if (!student) redirect('/forbidden');

  const account = await getStudentAccount(schoolId, session.pid);

  return (
    <>
      <PageHeader
        title="Fees and payments"
        description={`Statement of account for ${student.matricNumber}. All amounts in Nigerian Naira.`}
      />

      {account.summary.hasOverdue ? (
        <Alert tone="danger" title="You have an overdue balance" className="mb-4">
          {formatMoney(account.summary.overdueMinor)} is past its due date. Registration for the
          next term will be blocked until this is settled.
        </Alert>
      ) : null}

      {account.summary.creditMinor > 0 ? (
        <Alert tone="info" title="You have a credit balance" className="mb-4">
          {formatMoney(account.summary.creditMinor)} from an overpayment is held to your account and
          will be applied automatically to your next invoice.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total billed" value={formatMoney(account.summary.totalBilledMinor)} />
        <StatTile
          label="Total paid"
          value={formatMoney(account.summary.totalPaidMinor)}
          tone="success"
        />
        <StatTile
          label="Outstanding"
          value={formatMoney(account.summary.outstandingMinor)}
          tone={account.summary.outstandingMinor > 0 ? 'danger' : 'success'}
          sublabel={account.summary.outstandingMinor === 0 ? 'Account settled' : undefined}
        />
        <StatTile
          label="Credit held"
          value={formatMoney(account.summary.creditMinor)}
          tone={account.summary.creditMinor > 0 ? 'info' : 'neutral'}
        />
      </div>

      <div className="mt-4 space-y-4">
        {account.invoices.length === 0 ? (
          <Card>
            <EmptyState
              title="No invoices yet"
              description="Your invoice is raised once you register for courses in a term."
            />
          </Card>
        ) : (
          account.invoices.map((invoice) => (
            <Card key={invoice.id}>
              <CardHeader
                title={`${invoice.invoiceNo} — ${invoice.term.name}`}
                description={`Issued ${formatDate(invoice.issuedAt)} · due ${formatDate(invoice.dueDate)}`}
                actions={<Badge tone={toneForStatus(invoice.status)}>{titleCase(invoice.status)}</Badge>}
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-center">Qty</Th>
                    <Th className="text-right">Unit</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.lines.map((line) => (
                    <tr key={line.id}>
                      <Td>
                        <span className="font-mono text-[11px] text-slate-500">{line.code}</span>
                        <span className="ml-2">{line.description}</span>
                      </Td>
                      <Td className="text-center tabular-nums text-xs">{line.quantity}</Td>
                      <Td className="text-right tabular-nums text-xs">
                        {formatMoney(line.unitAmountMinor)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(line.amountMinor)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200">
                  <tr>
                    <Td colSpan={3} className="text-right text-xs text-slate-500">
                      Subtotal
                    </Td>
                    <Td className="text-right tabular-nums">{formatMoney(invoice.subtotalMinor)}</Td>
                  </tr>
                  {invoice.discountMinor > 0 ? (
                    <tr>
                      <Td colSpan={3} className="text-right text-xs text-slate-500">
                        Discounts and awards
                      </Td>
                      <Td className="text-right tabular-nums text-emerald-700">
                        −{formatMoney(invoice.discountMinor)}
                      </Td>
                    </tr>
                  ) : null}
                  <tr>
                    <Td colSpan={3} className="text-right text-xs font-medium text-slate-700">
                      Total payable
                    </Td>
                    <Td className="text-right font-semibold tabular-nums">
                      {formatMoney(invoice.totalMinor)}
                    </Td>
                  </tr>
                  <tr>
                    <Td colSpan={3} className="text-right text-xs text-slate-500">
                      Paid to date
                    </Td>
                    <Td className="text-right tabular-nums text-emerald-700">
                      {formatMoney(invoice.paidMinor)}
                    </Td>
                  </tr>
                  <tr>
                    <Td colSpan={3} className="text-right text-xs font-semibold text-slate-900">
                      Balance
                    </Td>
                    <Td className="text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(invoice.totalMinor - invoice.paidMinor)}
                    </Td>
                  </tr>
                </tfoot>
              </Table>
            </Card>
          ))
        )}

        <Card>
          <CardHeader
            title="Payment history"
            description="Every payment, and exactly which invoices it was applied to."
          />
          {account.payments.length === 0 ? (
            <EmptyState title="No payments recorded" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Received</Th>
                  <Th>Method</Th>
                  <Th>Applied to</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {account.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono text-xs">{p.receiptNo}</Td>
                    <Td className="text-xs">{formatDateTime(p.receivedAt)}</Td>
                    <Td className="text-xs">{titleCase(p.method)}</Td>
                    <Td className="text-xs">
                      {p.allocations.length === 0 ? (
                        <span className="text-slate-400">Held as credit</span>
                      ) : (
                        p.allocations.map((a) => (
                          <div key={a.id} className="font-mono text-[11px]">
                            {a.invoice.invoiceNo} · {formatMoney(a.amountMinor)}
                          </div>
                        ))
                      )}
                      {p.unappliedMinor > 0 ? (
                        <div className="text-[11px] text-sky-700">
                          {formatMoney(p.unappliedMinor)} unapplied
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatMoney(p.amountMinor)}
                    </Td>
                    <Td>
                      <Badge tone={toneForStatus(p.status)}>{titleCase(p.status)}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
