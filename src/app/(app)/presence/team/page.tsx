import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { oversightReport } from '@/server/services/presence-oversight.service';
import { addLocalDays, toLocalDate } from '@/lib/domain/time';
import { formatDuration, toDecimalHours } from '@/lib/domain/presence';
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
import type { PersonPresence } from '@/server/services/presence-oversight.service';

export const metadata: Metadata = { title: 'Team register' };

/**
 * The register, seen from above.
 *
 * A head of department opens this to answer one question — who has been in, and
 * who has not — so absence is a COLUMN rather than something you infer from a
 * missing row. A person who never signed in all month is otherwise invisible
 * here, which is precisely the person the page exists to surface.
 *
 * The scope comes from the viewer's own record, never from the URL, so there is
 * no id to substitute to see another faculty.
 */

/** Rough count of working days in a window, Monday to Friday. */
function workingDaysBetween(from: string, to: string): number {
  let days = 0;
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

function PresenceRows({ people, expectedDays }: { people: PersonPresence[]; expectedDays: number }) {
  return (
    <Table className="table-zebra">
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Department</Th>
          <Th className="w-16">Days</Th>
          <Th className="w-20">Worked</Th>
          <Th className="w-20">Breaks</Th>
          <Th className="w-16">Absent</Th>
          <Th>Now</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {people.map((p) => (
          <tr key={p.membershipId}>
            <Td className="text-xs">
              <span className="font-medium text-slate-900">{p.name}</span>
              <div className="text-[11px] text-slate-500">
                {p.title ?? p.role}
                {p.identifier ? ` · ${p.identifier}` : ''}
              </div>
            </Td>
            <Td className="text-xs text-slate-600">{p.unit ?? '—'}</Td>
            <Td className="text-xs tabular-nums text-slate-700">{p.totals.days}</Td>
            <Td className="text-xs tabular-nums text-slate-900">
              {formatDuration(p.totals.netMinutes)}
            </Td>
            <Td className="text-xs tabular-nums text-slate-500">
              {p.totals.breakMinutes > 0 ? formatDuration(p.totals.breakMinutes) : '—'}
            </Td>
            <Td className="text-xs tabular-nums">
              {/*
                Absence is shown, not inferred. Somebody who has not signed in
                once this month has no rows at all, and a table that only lists
                what happened would leave them off it entirely — which is the
                one person a head of department is looking for.
              */}
              <span
                className={
                  p.daysAbsent > expectedDays / 2
                    ? 'font-medium text-rose-700'
                    : p.daysAbsent > 0
                      ? 'text-amber-700'
                      : 'text-slate-400'
                }
              >
                {p.daysAbsent}
              </span>
            </Td>
            <Td>
              {p.onBreak ? (
                <Badge tone="warning">On a break</Badge>
              ) : p.openNow ? (
                <Badge tone="success">In</Badge>
              ) : (
                <span className="text-[11px] text-slate-400">
                  {p.lastSeen ? `last ${p.lastSeen.toISOString().slice(0, 10)}` : 'never'}
                </span>
              )}
              {p.autoClosed > 0 && (
                <div
                  className="mt-0.5 text-[11px] text-amber-700"
                  title="Closed by the nightly sweep — the end time is an assumption, not a fact"
                >
                  {p.autoClosed} assumed
                </div>
              )}
              {p.declared > 0 && (
                <div
                  className="mt-0.5 text-[11px] text-slate-500"
                  title="The person keyed the time in rather than taking the clock's"
                >
                  {p.declared} keyed
                </div>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function TeamPresencePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { schoolId, membershipId, role, school } = await requireRoute('/presence/team');
  const { days } = await searchParams;

  const window = Math.min(90, Math.max(7, Number(days) || 30));
  const today = toLocalDate(new Date(), school.timezone);
  const from = addLocalDays(today, -(window - 1));
  const expectedDays = workingDaysBetween(from, today);

  const report = await oversightReport({
    schoolId,
    membershipId,
    role,
    from,
    to: today,
    expectedDays,
  });

  const everyone = [...report.staff, ...report.students];

  if (everyone.length === 0) {
    return (
      <>
        <PageHeader
          title="Team register"
          description="Sign-in records for the people who report to you."
        />
        <Alert tone="info" title="Nobody reports to you yet">
          This page shows the register for your department or faculty. Nobody is currently placed
          under you in the org chart, so there is nothing to show — which is an ordinary fact about
          most staff, not a fault. Your own record is on{' '}
          <Link href="/presence" className="font-medium underline">
            Sign in and out
          </Link>
          .
        </Alert>
      </>
    );
  }

  const totalNet = everyone.reduce((sum, p) => sum + p.totals.netMinutes, 0);
  const neverSignedIn = everyone.filter((p) => p.totals.days === 0).length;
  const assumed = everyone.reduce((sum, p) => sum + p.autoClosed, 0);

  return (
    <>
      <PageHeader
        title="Team register"
        description={`${report.scope.label === 'the whole school' ? school.shortName : report.scope.label} · ${from} to ${today}. Times are in ${school.timezone}.`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/presence/team?days=${d}`}
                  className={[
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                    window === d ? 'bg-slate-900 text-onInk' : 'text-slate-600 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {d}d
                </Link>
              ))}
            </div>
            <PrintButton label="Print" />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="In right now"
          value={report.inBuildingNow}
          tone={report.inBuildingNow > 0 ? 'success' : 'neutral'}
          sublabel={`Of ${everyone.length} people`}
        />
        <StatTile
          label="Time worked"
          value={formatDuration(totalNet)}
          tone="brand"
          sublabel={`${toDecimalHours(totalNet)} hours, after breaks`}
        />
        <StatTile
          label="Never signed in"
          value={neverSignedIn}
          tone={neverSignedIn > 0 ? 'danger' : 'success'}
          sublabel={`In the last ${window} days`}
        />
        <StatTile
          label="Assumed closures"
          value={assumed}
          tone={assumed > 0 ? 'warning' : 'success'}
          sublabel="Nobody signed out"
        />
      </div>

      {neverSignedIn > 0 && (
        <Alert tone="warning" title={`${neverSignedIn} people have no record at all`} className="mt-4">
          They have not signed in once in this window. That is either genuine absence or a person
          who has never been shown how the register works — and the two look identical from here,
          so it is worth asking rather than assuming.
        </Alert>
      )}

      <div className="mt-4 space-y-4">
        <Card>
          <CardHeader
            title={`Staff (${report.staff.length})`}
            description="Everybody who reports to you, through however many levels."
          />
          {report.staff.length === 0 ? (
            <EmptyState title="No staff report to you" />
          ) : (
            <PresenceRows people={report.staff} expectedDays={expectedDays} />
          )}
        </Card>

        {report.students.length > 0 && (
          <Card>
            <CardHeader
              title={`Students (${report.students.length})`}
              description={
                report.scope.kind === 'FACULTY'
                  ? 'Enrolled on a programme in your faculty.'
                  : 'Enrolled on a programme in your department.'
              }
            />
            <PresenceRows people={report.students} expectedDays={expectedDays} />
          </Card>
        )}
      </div>
    </>
  );
}
