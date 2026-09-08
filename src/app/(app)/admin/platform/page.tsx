import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformAdmin } from '@/lib/auth/session';
import { platformDb } from '@/lib/tenant';
import { countSeats, loadEntitlement } from '@/server/services/platform.service';
import { seatUtilisation, trialDaysRemaining } from '@/lib/domain/provisioning';
import { formatDate } from '@/lib/utils';
import { currencyFor, formatMoney } from '@/lib/domain/money';
import {
  Alert,
  Badge,
  Card,
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
import { ProvisionForm } from './provision-form';

export const metadata: Metadata = { title: 'Platform — schools' };

export default async function PlatformPage() {
  // Re-checks the database, so revoking an operator ends their access on the
  // next page load rather than when their eight-hour token happens to expire.
  await requirePlatformAdmin();

  const [schools, plans] = await Promise.all([
    platformDb.school.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { memberships: true } },
      },
    }),
    platformDb.plan.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } }),
  ]);

  const usage = await Promise.all(
    schools.map(async (school) => ({
      schoolId: school.id,
      seats: await countSeats(school.id),
      entitlement: await loadEntitlement(school.id),
    })),
  );
  const usageById = new Map(usage.map((u) => [u.schoolId, u]));

  const live = schools.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL');
  const provisioning = schools.filter((s) => s.status === 'PROVISIONING');
  const suspended = schools.filter((s) => s.status === 'SUSPENDED');
  const totalStudents = usage.reduce((sum, u) => sum + u.seats.students, 0);

  return (
    <>
      <PageHeader
        title="Platform"
        description="Every school on this installation. This console belongs to the vendor, not to any school — nothing here is scoped to the school you are signed in to."
        actions={
          <Link href="/admin/platform/operators" className="text-sm text-brand-700 hover:underline">
            Operators →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Live schools" value={live.length} tone="brand" sublabel="Active or on trial" />
        <StatTile
          label="Being set up"
          value={provisioning.length}
          tone={provisioning.length > 0 ? 'warning' : 'neutral'}
          sublabel="Only the owner can sign in"
        />
        <StatTile
          label="Suspended"
          value={suspended.length}
          tone={suspended.length > 0 ? 'danger' : 'success'}
          sublabel="Nobody can sign in"
        />
        <StatTile label="Students on platform" value={totalStudents} sublabel="Active student seats" />
      </div>

      {plans.length === 0 && (
        <Alert tone="warning" className="mt-4">
          There are no plans yet, so no school can be provisioned. Run <code>npm run db:seed</code>{' '}
          to create the starter plans, or add one directly.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Schools"
              description="Seat usage is counted from active memberships — applicants and guardians are not seats."
            />
            {schools.length === 0 ? (
              <EmptyState
                title="No schools yet"
                description="Provision the first one with the form beside this list."
              />
            ) : (
              <Table className="table-hover">
                <thead>
                  <tr>
                    <Th>School</Th>
                    <Th>Status</Th>
                    <Th>Plan</Th>
                    <Th className="w-40">Students</Th>
                    <Th className="w-40">Staff</Th>
                    <Th>Added</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schools.map((school) => {
                    const u = usageById.get(school.id);
                    const limits = u?.entitlement?.limits;
                    const trial = trialDaysRemaining(
                      school.subscription?.trialEndsAt ?? null,
                      new Date(),
                    );
                    return (
                      <tr key={school.id}>
                        <Td>
                          <Link
                            href={`/admin/platform/${school.id}`}
                            className="text-sm font-medium text-slate-900 hover:text-brand-700"
                          >
                            {school.name}
                          </Link>
                          <div className="text-[11px] text-slate-500">
                            /s/{school.slug} · {school.code} ·{' '}
                            {school.academicModel === 'K12' ? 'K-12' : 'Higher ed'}
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={toneForStatus(school.status)}>{school.status}</Badge>
                          {school.status === 'TRIAL' && trial !== null && (
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              {trial} {trial === 1 ? 'day' : 'days'} left
                            </div>
                          )}
                        </Td>
                        <Td className="text-xs">
                          {school.subscription?.plan.name ?? (
                            <span className="text-slate-400">none</span>
                          )}
                        </Td>
                        <Td>
                          <SeatCell
                            used={u?.seats.students ?? 0}
                            limit={limits?.maxStudents ?? null}
                          />
                        </Td>
                        <Td>
                          <SeatCell used={u?.seats.staff ?? 0} limit={limits?.maxStaff ?? null} />
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-slate-500">
                          {formatDate(school.createdAt)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Plans"
              description="What a school can be sold. A null ceiling is unlimited, which is not the same as zero."
            />
            {plans.length === 0 ? (
              <EmptyState title="No plans configured" />
            ) : (
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Plan</Th>
                    <Th>Price</Th>
                    <Th>Students</Th>
                    <Th>Staff</Th>
                    <Th>Trial</Th>
                    <Th>Schools</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <Td>
                        <div className="text-sm font-medium text-slate-900">{plan.name}</div>
                        <div className="text-[11px] text-slate-500">{plan.description}</div>
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums">
                        {formatMoney(plan.priceMinor, {
                          currency: currencyFor(plan.currencyCode),
                        })}
                        <div className="text-[11px] text-slate-400">
                          per {plan.billingPeriod.toLowerCase()}
                        </div>
                      </Td>
                      <Td className="text-xs tabular-nums">{plan.maxStudents ?? 'Unlimited'}</Td>
                      <Td className="text-xs tabular-nums">{plan.maxStaff ?? 'Unlimited'}</Td>
                      <Td className="text-xs tabular-nums">
                        {plan.trialDays > 0 ? `${plan.trialDays} days` : '—'}
                      </Td>
                      <Td className="text-xs tabular-nums">
                        {schools.filter((s) => s.subscription?.planId === plan.id).length}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <ProvisionForm
          plans={plans.map((p) => ({
            id: p.id,
            name: p.name,
            trialDays: p.trialDays,
          }))}
          takenSlugs={schools.map((s) => s.slug)}
        />
      </div>
    </>
  );
}

function SeatCell({ used, limit }: { used: number; limit: number | null }) {
  const pct = seatUtilisation(used, limit);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-700">
        {used}
        <span className="text-slate-400"> / {limit ?? '∞'}</span>
      </span>
      <div className="w-14">
        <Meter value={pct} tone={pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'brand'} />
      </div>
    </div>
  );
}
