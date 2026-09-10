import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOperator } from '@/lib/auth/operator';
import { platformDb } from '@/lib/tenant';
import { formatDate } from '@/lib/utils';
import { currencyFor, formatMoney } from '@/lib/domain/money';
import { Badge, Card, PageHeader, Table, Td, Th, toneForStatus } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

export const metadata: Metadata = { title: 'Subscription invoice' };

export default async function SubscriptionInvoicePage({
  params,
}: {
  params: Promise<{ schoolId: string; invoiceId: string }>;
}) {
  await requireOperator();
  const { schoolId, invoiceId } = await params;

  const invoice = await platformDb.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      subscription: { include: { plan: true } },
    },
  });
  // Checked rather than assumed: the invoice id comes from the URL, and an id
  // belonging to a different school must not render under this school's heading.
  if (!invoice || invoice.schoolId !== schoolId) notFound();

  const school = await platformDb.school.findUnique({ where: { id: schoolId } });
  if (!school) notFound();

  const currency = currencyFor(invoice.currencyCode);
  const due = invoice.totalMinor - invoice.paidMinor;

  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow={
            <Link href={`/operator/${schoolId}`} className="hover:underline">
              ← {school.name}
            </Link>
          }
          title={invoice.reference}
          description="A vendor invoice to the school, distinct from anything the school bills its own students."
          actions={<PrintButton />}
        />
      </div>

      <Card className="mx-auto max-w-3xl px-8 py-8 print:max-w-none print:shadow-none print:ring-0">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Invoice</p>
            <h2 className="mt-1 font-mono text-lg font-semibold text-slate-900">
              {invoice.reference}
            </h2>
            <div className="mt-2">
              <Badge tone={toneForStatus(invoice.status)}>{invoice.status}</Badge>
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p className="text-sm font-semibold text-slate-900">Billed to</p>
            <p className="mt-1">{school.name}</p>
            <p>/s/{school.slug}</p>
            {school.country && <p>{school.country}</p>}
          </div>
        </div>

        <div className="grid gap-4 border-b border-slate-200 py-5 text-xs sm:grid-cols-3">
          <div>
            <p className="text-slate-500">Period</p>
            <p className="mt-0.5 font-medium text-slate-900">
              {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Issued</p>
            <p className="mt-0.5 font-medium text-slate-900">{formatDate(invoice.issuedAt)}</p>
          </div>
          <div>
            <p className="text-slate-500">Due</p>
            <p className="mt-0.5 font-medium text-slate-900">{formatDate(invoice.dueAt)}</p>
          </div>
        </div>

        <Table className="mt-4">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th className="w-20 text-right">Qty</Th>
              <Th className="w-32 text-right">Unit</Th>
              <Th className="w-32 text-right">Amount</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <Td className="text-sm text-slate-800">{line.description}</Td>
                <Td className="text-right text-sm tabular-nums">{line.quantity}</Td>
                <Td className="text-right text-sm tabular-nums">
                  {formatMoney(line.unitMinor, { currency })}
                </Td>
                <Td className="text-right text-sm tabular-nums">
                  {formatMoney(line.amountMinor, { currency })}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>

        <div className="mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="tabular-nums text-slate-900">
                {formatMoney(invoice.subtotalMinor, { currency })}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Tax</dt>
              <dd className="tabular-nums text-slate-900">
                {formatMoney(invoice.taxMinor, { currency })}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <dt className="text-slate-900">Total</dt>
              <dd className="tabular-nums text-slate-900">
                {formatMoney(invoice.totalMinor, { currency })}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Paid</dt>
              <dd className="tabular-nums text-emerald-700">
                {formatMoney(invoice.paidMinor, { currency })}
              </dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <dt className="text-slate-900">Due</dt>
              <dd className={due > 0 ? 'tabular-nums text-rose-700' : 'tabular-nums text-emerald-700'}>
                {formatMoney(due, { currency })}
              </dd>
            </div>
          </dl>
        </div>

        {invoice.paymentMethod && (
          <p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
            Payment received by {invoice.paymentMethod.toLowerCase().replace('_', ' ')}
            {invoice.paymentReference ? ` · ${invoice.paymentReference}` : ''}
            {invoice.paidAt ? ` · ${formatDate(invoice.paidAt)}` : ''}
          </p>
        )}
      </Card>
    </>
  );
}
