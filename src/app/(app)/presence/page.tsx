import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantContext } from '@/server/tenant-context';
import { timesheet, whoIsIn } from '@/server/services/presence.service';
import { can } from '@/lib/auth/rbac';
import { addLocalDays, toLocalDate } from '@/lib/domain/time';
import {
  PRESENCE_LABELS,
  formatDuration,
  toDecimalHours,
  type PresenceStatus,
} from '@/lib/domain/presence';
import { fullName } from '@/lib/utils';
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
} from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { PresenceClock } from './clock';

export const metadata: Metadata = { title: 'Sign in / sign out' };

/**
 * A person's own timesheet, and — for the office — who is in the building.
 *
 * Open to EVERY member of the school. Signing yourself in is not a privilege,
 * and a lecturer, a librarian and a student all need the same button.
 */
export default async function PresencePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { schoolId, membershipId, school, role } = await requireTenantContext();
  const { days } = await searchParams;

  const window = Math.min(90, Math.max(7, Number(days) || 30));
  const now = new Date();
  const today = toLocalDate(now, school.timezone);
  const from = addLocalDays(today, -(window - 1));

  const [{ sessions, totals }, inBuilding] = await Promise.all([
    timesheet({ schoolId, membershipId, from, to: today }),
    // Only the office needs the building-wide view; everyone else sees their
    // own record and nothing about their colleagues.
    can(role, 'attendance:record') ? whoIsIn(schoolId) : Promise.resolve([]),
  ]);

  const open = sessions.find((s) => s.status === 'OPEN') ?? null;
  const todayClosed = sessions
    .filter((s) => s.localDate === today && s.status !== 'OPEN')
    .reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);

  const mayOversee = can(role, 'attendance:record');

  return (
    <>
      <PageHeader
        title="Sign in and out"
        description={`Your own record at ${school.shortName}. Times are in ${school.timezone}, which is the school's day — not your device's.`}
        actions={<PrintButton label="Print timesheet" />}
      />

      <div className="mb-4">
        <PresenceClock openSince={open ? open.startedAt.toISOString() : null} todayMinutes={todayClosed} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Days recorded" value={totals.days} sublabel={`Last ${window} days`} />
        <StatTile
          label="Total time"
          value={formatDuration(totals.minutes)}
          tone="brand"
          sublabel={`${toDecimalHours(totals.minutes)} hours`}
        />
        <StatTile
          label="Assumed"
          value={formatDuration(totals.assumedMinutes)}
          tone={totals.assumedMinutes > 0 ? 'warning' : 'success'}
          sublabel="From sessions nobody closed"
        />
        <StatTile
          label="Still open"
          value={totals.openSessions}
          tone={totals.openSessions > 0 ? 'info' : 'neutral'}
        />
      </div>

      {totals.assumedMinutes > 0 && (
        <Alert tone="warning" title="Some of this time is an assumption" className="mt-4">
          {formatDuration(totals.assumedMinutes)} comes from sessions that were closed
          automatically because nobody signed out. That end time is a guess the system made, not a
          fact anybody recorded — ask the office to correct it if it matters.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Your sessions"
              description={`${from} to ${today}.`}
              actions={
                <div className="flex gap-1">
                  {[7, 30, 90].map((d) => (
                    <Link
                      key={d}
                      href={`/presence?days=${d}`}
                      className={[
                        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                        window === d
                          ? 'bg-slate-900 text-onInk'
                          : 'text-slate-600 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      {d}d
                    </Link>
                  ))}
                </div>
              }
            />

            {sessions.length === 0 ? (
              <EmptyState
                title="Nothing recorded yet"
                description="Sign in above and your time starts appearing here."
              />
            ) : (
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                    <Th className="w-24">Time</Th>
                    <Th>How</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <Td className="whitespace-nowrap text-xs tabular-nums text-slate-700">
                        {s.localDate}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums text-slate-600">
                        {s.startedAt.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: school.timezone,
                        })}
                      </Td>
                      <Td className="whitespace-nowrap text-xs tabular-nums text-slate-600">
                        {s.endedAt
                          ? s.endedAt.toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: school.timezone,
                            })
                          : '—'}
                      </Td>
                      <Td className="text-xs tabular-nums text-slate-900">
                        {formatDuration(s.durationMinutes)}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            s.status === 'OPEN'
                              ? 'info'
                              : s.status === 'AUTO_CLOSED'
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {PRESENCE_LABELS[s.status as PresenceStatus] ?? s.status}
                        </Badge>
                        {s.corrections.length > 0 && (
                          <div
                            className="mt-0.5 text-[11px] text-slate-500"
                            title={s.corrections[0].reason}
                          >
                            corrected
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Teaching log"
              description="Lectures delivered, and the hours behind them."
            />
            <div className="px-5 py-4">
              <Link
                href="/presence/teaching"
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Record what you taught →
              </Link>
            </div>
          </Card>

          {mayOversee && (
            <Card>
              <CardHeader
                title="In the building"
                description={`${inBuilding.length} signed in right now.`}
              />
              {inBuilding.length === 0 ? (
                <EmptyState title="Nobody is signed in" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {inBuilding.slice(0, 12).map((s) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-slate-800">
                          {fullName(s.membership.user)}
                        </p>
                        <p className="text-[11px] text-slate-500">{s.membership.role}</p>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                        {s.startedAt.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: school.timezone,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
