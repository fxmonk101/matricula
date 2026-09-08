import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requirePlatformAdmin } from '@/lib/auth/session';
import { platformDb } from '@/lib/tenant';
import { loadEntitlement } from '@/server/services/platform.service';
import { seatUtilisation, trialDaysRemaining } from '@/lib/domain/provisioning';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import { currencyFor, formatMoney } from '@/lib/domain/money';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  Meter,
  PageHeader,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { SchoolControls } from './school-controls';

export const metadata: Metadata = { title: 'Platform — school' };

export default async function PlatformSchoolPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  await requirePlatformAdmin();
  const { schoolId } = await params;

  const school = await platformDb.school.findUnique({
    where: { id: schoolId },
    include: {
      subscription: { include: { plan: true } },
      memberships: {
        where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { role: 'asc' },
      },
    },
  });
  if (!school) notFound();

  const [plans, entitlement, invoices, audit] = await Promise.all([
    platformDb.plan.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } }),
    loadEntitlement(school.id),
    platformDb.subscriptionInvoice.findMany({
      where: { schoolId: school.id },
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { position: 'asc' } } },
    }),
    platformDb.auditLog.findMany({
      where: { schoolId: school.id, action: { startsWith: 'platform.' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { actor: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const currency = currencyFor(school.currencyCode);
  const outstanding = invoices
    .filter((i) => i.status !== 'PAID' && i.status !== 'VOID')
    .reduce((sum, i) => sum + (i.totalMinor - i.paidMinor), 0);
  const trial = trialDaysRemaining(school.subscription?.trialEndsAt ?? null, new Date());

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/platform" className="hover:underline">← All schools</Link>}
        title={school.name}
        description={`/s/${school.slug} · ${school.code} · ${school.academicModel === 'K12' ? 'K-12' : 'Higher education'} · ${school.timezone}`}
        actions={<Badge tone={toneForStatus(school.status)}>{school.status}</Badge>}
      />

      {school.status === 'PROVISIONING' && (
        <Alert tone="warning" title="This school is still in setup" className="mb-4">
          Only its owner can sign in. Open it once the school has its terms, structure and grading
          scheme in place — until then, staff and students are refused at the login page rather than
          being dropped into an empty school.
        </Alert>
      )}
      {school.status === 'SUSPENDED' && (
        <Alert tone="danger" title="Suspended" className="mb-4">
          Nobody at this school can sign in. Their data is untouched and returns the moment the
          subscription is reinstated.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Entitlement"
              description="Seats counted from active memberships. Applicants and guardians are not seats."
            />
            {entitlement ? (
              <dl className="px-5 py-1">
                <DetailRow label="Plan">{entitlement.planName}</DetailRow>
                <DetailRow label="Subscription">
                  <span className="flex items-center gap-2">
                    <Badge tone={toneForStatus(entitlement.status)}>{entitlement.status}</Badge>
                    {trial !== null && entitlement.status === 'TRIALING' && (
                      <span className="text-xs text-slate-500">
                        {trial} {trial === 1 ? 'day' : 'days'} of trial left
                      </span>
                    )}
                  </span>
                </DetailRow>
                <DetailRow label="Students">
                  <SeatBar
                    used={entitlement.usage.students}
                    limit={entitlement.limits.maxStudents}
                  />
                </DetailRow>
                <DetailRow label="Staff">
                  <SeatBar used={entitlement.usage.staff} limit={entitlement.limits.maxStaff} />
                </DetailRow>
                <DetailRow label="Outstanding">
                  {outstanding > 0 ? (
                    <span className="font-medium text-rose-700">
                      {formatMoney(outstanding, { currency })}
                    </span>
                  ) : (
                    <span className="text-emerald-700">Nothing due</span>
                  )}
                </DetailRow>
              </dl>
            ) : (
              <EmptyState
                title="No subscription"
                description="This school predates the billing layer. It keeps working; seat limits simply do not apply to it."
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Subscription invoices"
              description="Raised by hand and marked paid by hand — there is no payment gateway."
            />
            {invoices.length === 0 ? (
              <EmptyState title="No invoices raised" />
            ) : (
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Period</Th>
                    <Th>Total</Th>
                    <Th>Paid</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <Td>
                        <code className="font-mono text-[11px] text-brand-700">
                          {invoice.reference}
                        </code>
                        <div className="text-[11px] text-slate-500">
                          {invoice.lines[0]?.description ?? '—'}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">
                        {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
                        {invoice.dueAt && (
                          <div className="text-[11px] text-slate-400">
                            due {formatDate(invoice.dueAt)}
                          </div>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        {formatMoney(invoice.totalMinor, {
                          currency: currencyFor(invoice.currencyCode),
                        })}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        {formatMoney(invoice.paidMinor, {
                          currency: currencyFor(invoice.currencyCode),
                        })}
                      </Td>
                      <Td>
                        <Badge tone={toneForStatus(invoice.status)}>{invoice.status}</Badge>
                      </Td>
                      <Td className="text-right">
                        <Link
                          href={`/admin/platform/${school.id}/invoice/${invoice.id}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Open
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Administrators"
              description="Who can be contacted about this school."
            />
            {school.memberships.length === 0 ? (
              <EmptyState title="Nobody has an administrative role here" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {school.memberships.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">{fullName(m.user)}</p>
                      <p className="text-[11px] text-slate-500">{m.user.email}</p>
                    </div>
                    <Badge tone={m.role === 'OWNER' ? 'brand' : 'neutral'}>
                      {ROLE_LABELS[m.role as Role] ?? m.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Platform activity"
              description="Only operator actions. The school's own audit log is its own and is not shown here."
            />
            {audit.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {audit.map((entry) => (
                  <li key={entry.id} className="px-5 py-2.5">
                    <p className="text-xs text-slate-700">{entry.summary}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {formatDateTime(entry.createdAt)}
                      {entry.actor ? ` · ${fullName(entry.actor)}` : ' · system'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <SchoolControls
          schoolId={school.id}
          schoolName={school.name}
          schoolStatus={school.status}
          hasSubscription={entitlement !== null}
          subscriptionStatus={entitlement?.status ?? null}
          currentPlanId={school.subscription?.planId ?? null}
          seatOverrideStudents={school.subscription?.seatOverrideStudents ?? null}
          seatOverrideStaff={school.subscription?.seatOverrideStaff ?? null}
          plans={plans.map((p) => ({ id: p.id, name: p.name }))}
          openInvoices={invoices
            .filter((i) => i.status !== 'PAID' && i.status !== 'VOID')
            .map((i) => ({
              id: i.id,
              reference: i.reference,
              dueMinor: i.totalMinor - i.paidMinor,
            }))}
          currencySymbol={currency.symbol}
        />
      </div>
    </>
  );
}

function SeatBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = seatUtilisation(used, limit);
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm tabular-nums text-slate-800">
        {used}
        <span className="text-slate-400"> / {limit ?? 'unlimited'}</span>
      </span>
      {limit !== null && (
        <span className="w-20">
          <Meter value={pct} tone={pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'brand'} />
        </span>
      )}
    </span>
  );
}
