import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { teachingByStaff, teachingLog } from '@/server/services/presence.service';
import { dbFor } from '@/lib/tenant';
import { can } from '@/lib/auth/rbac';
import { addLocalDays, toLocalDate } from '@/lib/domain/time';
import { formatMinutes } from '@/lib/utils';
import {
  TEACHING_LABELS,
  formatDuration,
  toDecimalHours,
  type TeachingStatus,
} from '@/lib/domain/presence';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { TeachingForm } from './teaching-form';

export const metadata: Metadata = { title: 'Teaching log' };

/**
 * What a lecturer taught, and the hours behind it.
 *
 * A head of department or a dean also sees the roll-up across their staff —
 * which is the question they are actually asked at the end of a term, and the
 * one a timetable alone cannot answer because a timetable says what was
 * planned.
 */
export default async function TeachingLogPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { schoolId, membershipId, school, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { days } = await searchParams;

  const window = Math.min(180, Math.max(7, Number(days) || 30));
  const today = toLocalDate(new Date(), school.timezone);
  const from = addLocalDays(today, -(window - 1));

  const overseer = role === 'HOD' || role === 'DEAN' || role === 'ADMIN' || role === 'REGISTRAR';

  const [{ rows, totals }, sections, staffRollup] = await Promise.all([
    teachingLog({ schoolId, membershipId, from, to: today }),
    dbFor(schoolId).courseOffering.findMany({
      include: {
        course: { select: { code: true, title: true } },
        term: { select: { code: true, isCurrent: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    overseer ? teachingByStaff({ schoolId, from, to: today }) : Promise.resolve([]),
  ]);

  // The current term first: that is what a lecturer is recording against today.
  const sectionOptions = sections
    .sort((a, b) => Number(b.term.isCurrent) - Number(a.term.isCurrent))
    .map((s) => ({
      id: s.id,
      label: `${s.course.code} ${s.section ?? ''} — ${s.term.code}`.replace(/\s+/g, ' ').trim(),
    }));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/presence" className="hover:underline">
            ← Sign in and out
          </Link>
        }
        title="Teaching log"
        description="The classes you actually delivered. Cover lessons, catch-ups and moved slots belong here too — they are exactly the hours a timetable cannot show."
        actions={<PrintButton label="Print log" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Hours taught"
          value={formatDuration(totals.minutesTaught)}
          tone="brand"
          sublabel={`${toDecimalHours(totals.minutesTaught)} hours, last ${window} days`}
        />
        <StatTile label="Classes delivered" value={totals.delivered} />
        <StatTile
          label="Cancelled"
          value={totals.cancelled}
          tone={totals.cancelled > 0 ? 'warning' : 'success'}
          sublabel="Did not run"
        />
        <StatTile label="Sections" value={totals.sections} sublabel="Distinct sections taught" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Your classes"
              description={`${from} to ${today}.`}
              actions={
                <div className="flex gap-1">
                  {[7, 30, 90].map((d) => (
                    <Link
                      key={d}
                      href={`/presence/teaching?days=${d}`}
                      className={[
                        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                        window === d ? 'bg-slate-900 text-onInk' : 'text-slate-600 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      {d}d
                    </Link>
                  ))}
                </div>
              }
            />

            {rows.length === 0 ? (
              <EmptyState
                title="Nothing recorded yet"
                description="Record a class with the form beside this list and it appears here."
              />
            ) : (
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Section</Th>
                    <Th>Time</Th>
                    <Th className="w-24">Length</Th>
                    <Th>Outcome</Th>
                    <Th className="w-28">Signed</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className={r.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                      <Td className="whitespace-nowrap text-xs tabular-nums text-slate-700">
                        {r.localDate}
                      </Td>
                      <Td className="text-xs">
                        {r.offering ? (
                          <span className="font-medium text-slate-900">{r.offering.course.code}</span>
                        ) : (
                          <span className="text-slate-400">Not timetabled</span>
                        )}
                        {r.topic && (
                          <div className="text-[11px] text-slate-500">{r.topic}</div>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums text-slate-600">
                        {formatMinutes(r.startMinute)}–{formatMinutes(r.endMinute)}
                      </Td>
                      <Td className="text-xs tabular-nums text-slate-900">
                        {formatDuration(r.durationMinutes)}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            r.status === 'DELIVERED'
                              ? 'success'
                              : r.status === 'MOVED'
                                ? 'info'
                                : 'warning'
                          }
                        >
                          {TEACHING_LABELS[r.status as TeachingStatus] ?? r.status}
                        </Badge>
                        {r.attended !== null && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {r.attended} present
                          </div>
                        )}
                      </Td>
                      {/*
                        A signature stored and never shown is a signature nobody
                        can check, which is the same as not having one. It is
                        rendered small here and at full size on a printed log.
                      */}
                      <Td>
                        {r.signature ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.signature}
                            alt="Lecturer signature"
                            className="h-8 w-24 object-contain object-left"
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400">unsigned</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {overseer && staffRollup.length > 0 && (
            <Card>
              <CardHeader
                title="Hours taught, by lecturer"
                description="Across the whole school for this window. What did not run is kept visible — it is invisible in a total that only sums what was delivered."
              />
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Lecturer</Th>
                    <Th className="w-28">Hours</Th>
                    <Th className="w-24">Delivered</Th>
                    <Th className="w-24">Cancelled</Th>
                    <Th className="w-24">Sections</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffRollup.map((s) => (
                    <tr key={s.membershipId}>
                      <Td className="text-sm text-slate-900">{s.name}</Td>
                      <Td className="text-xs tabular-nums text-slate-900">
                        {formatDuration(s.minutesTaught)}
                      </Td>
                      <Td className="text-xs tabular-nums text-slate-600">{s.delivered}</Td>
                      <Td
                        className={
                          s.cancelled > 0
                            ? 'text-xs tabular-nums text-amber-700'
                            : 'text-xs tabular-nums text-slate-400'
                        }
                      >
                        {s.cancelled}
                      </Td>
                      <Td className="text-xs tabular-nums text-slate-600">{s.sections}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div>
          {can(role, 'attendance:record') ? (
            <TeachingForm sections={sectionOptions} today={today} />
          ) : null}
        </div>
      </div>
    </>
  );
}
