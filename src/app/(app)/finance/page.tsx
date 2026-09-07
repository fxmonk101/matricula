import type { Metadata } from 'next';
import Link from 'next/link';

import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';
import { getReceivablesPosition } from '@/server/services/finance.service';
import { AGEING_BUCKETS } from '@/lib/domain/finance';
import { formatMoney, formatMoneyCompact } from '@/lib/domain/money';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { PaymentPanel, InvoicePanel, HoldPanel } from './finance-panels';

export const metadata: Metadata = { title: 'Finance' };

export default async function FinancePage() {
  await requireRole('ADMIN', 'FINANCE', 'REGISTRAR');

  const [position, overdue, recentPayments, students, terms, activeHolds] = await Promise.all([
    getReceivablesPosition(),
    db.invoice.findMany({
      where: { voidedAt: null, status: { in: ['OVERDUE', 'PARTIALLY_PAID', 'ISSUED'] } },
      include: {
        student: { include: { user: true, program: { select: { code: true } } } },
        term: { select: { code: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 30,
    }),
    db.payment.findMany({
      include: { student: { include: { user: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 12,
    }),
    db.student.findMany({
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { matricNumber: 'asc' },
      take: 500,
    }),
    db.term.findMany({ orderBy: { startDate: 'desc' } }),
    db.hold.findMany({
      where: { releasedAt: null },
      include: { student: { include: { user: true } } },
      orderBy: { placedAt: 'desc' },
      take: 20,
    }),
  ]);

  const now = new Date();
  const studentOptions = students.map((s) => ({
    id: s.id,
    label: `${s.matricNumber} — ${s.user.firstName} ${s.user.lastName}`,
  }));

  return (
    <>
      <PageHeader
        title="Bursary"
        description="Receivables, invoicing and payment reconciliation. Every amount is held in minor units; nothing is stored as a float."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total billed" value={formatMoneyCompact(position.billedMinor)} sublabel={`${position.invoiceCount} invoices`} />
        <StatTile label="Collected" value={formatMoneyCompact(position.collectedMinor)} tone="success" />
        <StatTile
          label="Outstanding"
          value={formatMoneyCompact(position.outstandingMinor)}
          tone={position.outstandingMinor > 0 ? 'danger' : 'success'}
        />
        <StatTile
          label="Collection rate"
          value={`${position.collectionRate.toFixed(1)}%`}
          tone={position.collectionRate >= 90 ? 'success' : position.collectionRate >= 70 ? 'warning' : 'danger'}
        />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Receivables ageing"
          description="Unpaid balances bucketed by days past due. Days are counted on whole elapsed days, the way a bursar counts them."
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-5">
            {AGEING_BUCKETS.map((bucket) => {
              const value = position.ageing[bucket.key];
              const pct =
                position.ageing.totalMinor === 0
                  ? 0
                  : (value / position.ageing.totalMinor) * 100;
              const tone =
                bucket.key === 'current'
                  ? 'success'
                  : bucket.key === 'd1_30'
                    ? 'warning'
                    : 'danger';
              return (
                <div key={bucket.key}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{bucket.label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                    {formatMoneyCompact(value)}
                  </p>
                  <p className="mb-1.5 text-[11px] tabular-nums text-slate-400">
                    {pct.toFixed(1)}% of outstanding
                  </p>
                  <Meter value={pct} tone={tone} />
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <PaymentPanel students={studentOptions} />
          <InvoicePanel students={studentOptions} terms={terms} />
          <HoldPanel students={studentOptions} holds={activeHolds.map((h) => ({
            id: h.id,
            kind: h.kind,
            reason: h.reason,
            studentLabel: `${h.student.matricNumber} — ${h.student.user.firstName} ${h.student.user.lastName}`,
            placedAt: h.placedAt.toISOString(),
          }))} />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Open invoices"
              description="Sorted by due date — the same order in which payments are automatically allocated."
            />
            {overdue.length === 0 ? (
              <EmptyState title="Nothing outstanding" description="Every issued invoice is settled." />
            ) : (
              <Table className="table-hover">
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Student</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Balance</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overdue.map((inv) => {
                    const daysPastDue = Math.floor(
                      (now.getTime() - inv.dueDate.getTime()) / 86_400_000,
                    );
                    return (
                      <tr key={inv.id}>
                        <Td className="font-mono text-xs">
                          {inv.invoiceNo}
                          <div className="text-[11px] text-slate-400">{inv.term.code}</div>
                        </Td>
                        <Td>
                          <Link
                            href={`/students/${inv.studentId}`}
                            className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                          >
                            {inv.student.user.firstName} {inv.student.user.lastName}
                          </Link>
                          <div className="font-mono text-[11px] text-slate-500">
                            {inv.student.matricNumber} · {inv.student.program.code}
                          </div>
                        </Td>
                        <Td className="text-xs">
                          {formatDate(inv.dueDate)}
                          {daysPastDue > 0 ? (
                            <div className="text-[11px] font-medium text-rose-600">
                              {daysPastDue} days past due
                            </div>
                          ) : null}
                        </Td>
                        <Td className="text-right tabular-nums text-xs">
                          {formatMoney(inv.totalMinor)}
                        </Td>
                        <Td className="text-right font-medium tabular-nums">
                          {formatMoney(inv.totalMinor - inv.paidMinor)}
                        </Td>
                        <Td>
                          <Badge tone={toneForStatus(inv.status)}>{titleCase(inv.status)}</Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent payments" />
            {recentPayments.length === 0 ? (
              <EmptyState title="No payments recorded yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Receipt</Th>
                    <Th>Student</Th>
                    <Th>Received</Th>
                    <Th>Method</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <Td className="font-mono text-xs">{p.receiptNo}</Td>
                      <Td className="text-xs">
                        {p.student.user.firstName} {p.student.user.lastName}
                        <div className="font-mono text-[11px] text-slate-400">
                          {p.student.matricNumber}
                        </div>
                      </Td>
                      <Td className="text-xs">{formatDateTime(p.receivedAt)}</Td>
                      <Td className="text-xs">{titleCase(p.method)}</Td>
                      <Td className="text-right font-medium tabular-nums">
                        {formatMoney(p.amountMinor)}
                        {p.unappliedMinor > 0 ? (
                          <div className="text-[11px] font-normal text-sky-700">
                            {formatMoney(p.unappliedMinor)} credit
                          </div>
                        ) : null}
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
      </div>
    </>
  );
}
