import type { Metadata } from 'next';

import { requireRoute } from '@/server/tenant-context';
import { DAY_NAMES } from '@/lib/domain/enums';
import { formatMinutes, titleCase } from '@/lib/utils';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Sections' };

export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const { db, school, schoolId } = await requireRoute('/offerings');
  const { term: termParam } = await searchParams;

  const terms = await db.term.findMany({ orderBy: { startDate: 'desc' } });
  const activeTerm =
    terms.find((t) => t.id === termParam) ?? terms.find((t) => t.isCurrent) ?? terms[0];

  if (!activeTerm) {
    return (
      <>
        <PageHeader title="Sections" />
        <Card>
          <EmptyState
            title="No academic terms defined"
            description="An administrator must create a term before sections can be scheduled."
          />
        </Card>
      </>
    );
  }

  const offerings = await db.courseOffering.findMany({
    where: { termId: activeTerm.id },
    include: {
      course: { include: { department: true } },
      instructor: { include: { user: true } },
      meetings: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
      _count: { select: { enrollments: { where: { status: 'WAITLISTED' } } } },
    },
    orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
  });

  const totalSeats = offerings.reduce((s, o) => s + o.capacity, 0);
  const takenSeats = offerings.reduce((s, o) => s + o.seatsTaken, 0);

  return (
    <>
      <PageHeader
        title="Course sections"
        description={`${activeTerm.name} · ${activeTerm.academicYear} — ${takenSeats} of ${totalSeats} seats filled across ${offerings.length} sections.`}
        actions={
          <form>
            <select
              name="term"
              defaultValue={activeTerm.id}
              // Auto-submitting on change keeps the term switcher to one
              // interaction; the surrounding GET form keeps it URL-driven.
              className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isCurrent ? '(current)' : ''}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-onInk hover:opacity-90"
            >
              Go
            </button>
          </form>
        }
      />

      <Card>
        <CardHeader
          title="Timetable"
          description="Meeting times are shown in institution local time. Overlapping sections cannot be registered together."
        />
        {offerings.length === 0 ? (
          <EmptyState
            title="No sections scheduled for this term"
            description="Sections must be created before students can register."
          />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Section</Th>
                <Th>Instructor</Th>
                <Th>Meets</Th>
                <Th>Room</Th>
                <Th className="text-right">Seats</Th>
                <Th className="w-32">Fill</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {offerings.map((o) => {
                const pct = o.capacity === 0 ? 0 : (o.seatsTaken / o.capacity) * 100;
                return (
                  <tr key={o.id}>
                    <Td>
                      <div className="font-mono text-xs font-medium text-slate-900">
                        {o.course.code}-{o.section}
                      </div>
                      <div className="text-xs text-slate-600">{o.course.title}</div>
                      <div className="text-[11px] text-slate-400">
                        {o.course.creditHours} credits · {o.course.department.code}
                      </div>
                    </Td>
                    <Td className="text-xs">
                      {o.instructor ? (
                        <>
                          {o.instructor.user.firstName} {o.instructor.user.lastName}
                          <div className="text-[11px] text-slate-400">
                            {titleCase(o.instructor.rank)}
                          </div>
                        </>
                      ) : (
                        <Badge tone="warning">Unassigned</Badge>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {o.meetings.length === 0 ? (
                        <span className="text-slate-400">Not scheduled</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {o.meetings.map((m) => (
                            <li key={m.id} className="tabular-nums">
                              {DAY_NAMES[m.dayOfWeek]?.slice(0, 3)} {formatMinutes(m.startMinute)}–
                              {formatMinutes(m.endMinute)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Td>
                    <Td className="text-xs">{o.room ?? '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {o.seatsTaken}/{o.capacity}
                      {o._count.enrollments > 0 ? (
                        <div className="text-[11px] text-amber-600">
                          +{o._count.enrollments} waiting
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <Meter value={pct} tone={pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'brand'} />
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={toneForStatus(o.status)}>{titleCase(o.status)}</Badge>
                        {o.gradesPosted ? <Badge tone="success">Graded</Badge> : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
