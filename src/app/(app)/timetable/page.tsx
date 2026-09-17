import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { loadTimetable, sectionsForTerm } from '@/server/services/timetable.service';
import { dbFor } from '@/lib/tenant';
import { can } from '@/lib/auth/rbac';
import { detectClashes, DAY_LABELS, type DayOfWeek } from '@/lib/domain/timetable';
import { formatMinutes } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
} from '@/components/ui';
import { PrintButton } from '@/components/print-button';
import { TimetableGrid } from './grid';
import { SchedulePanel } from './schedule-panel';

export const metadata: Metadata = { title: 'Timetable' };

/**
 * The faculty timetable.
 *
 * Clashes are DETECTED AND SHOWN rather than prevented. A timetable is built
 * under constraints the software cannot see — a visiting lecturer available one
 * morning, a hall released at short notice — and a system that refuses outright
 * is one a faculty keeps on paper instead. What it must never do is let a clash
 * pass unseen, which is why they are marked in the grid and listed beneath it.
 */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const { schoolId, role, school } = await requireRoute('/timetable');
  const { term: termParam } = await searchParams;

  const db = dbFor(schoolId);
  const [terms, { slots, termId }] = await Promise.all([
    db.term.findMany({ orderBy: { startDate: 'desc' }, take: 12 }),
    loadTimetable({ schoolId, termId: termParam ?? null }),
  ]);

  const [sections, instructors] = termId
    ? await Promise.all([
        sectionsForTerm(schoolId, termId),
        db.instructor.findMany({
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { user: { lastName: 'asc' } },
        }),
      ])
    : [[], []];

  const clashes = detectClashes(slots);
  const maySchedule = can(role, 'timetable:write');
  const mayAssign = can(role, 'offering:assign');

  const unassigned = sections.filter((s) => !s.instructorId).length;
  const unscheduled = sections.filter((s) => s.meetings.length === 0).length;
  const currentTerm = terms.find((t) => t.id === termId);

  return (
    <>
      <PageHeader
        title="Timetable"
        description={
          currentTerm
            ? `${school.shortName}, ${currentTerm.name}. Clashes are shown, not blocked — a timetable is built under constraints this system cannot see.`
            : `${school.shortName}. No term is set up yet.`
        }
        actions={
          <div className="flex items-center gap-2">
            {terms.length > 0 && (
              <form method="get">
                <select
                  name="term"
                  defaultValue={termId ?? ''}
                  onChange={undefined}
                  className="h-8 rounded-lg border-0 bg-white px-2 pr-7 text-xs text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300"
                >
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code}
                      {t.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="ml-1 h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-onInk hover:bg-slate-800"
                >
                  Show
                </button>
              </form>
            )}
            <PrintButton label="Print" />
          </div>
        }
      />

      {!termId ? (
        <Alert tone="info" title="No term yet">
          Nothing can be timetabled until a term exists. The registry creates them under{' '}
          <Link href="/calendar" className="font-medium underline">
            Calendar and fees
          </Link>
          .
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Scheduled slots" value={slots.length} tone="brand" />
            <StatTile
              label="Clashes"
              value={clashes.length}
              tone={clashes.length > 0 ? 'danger' : 'success'}
              sublabel={clashes.length > 0 ? 'Shown in red below' : 'Nothing contradicts'}
            />
            <StatTile
              label="Sections unscheduled"
              value={unscheduled}
              tone={unscheduled > 0 ? 'warning' : 'success'}
            />
            <StatTile
              label="Without a lecturer"
              value={unassigned}
              tone={unassigned > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Card>
                <CardHeader
                  title="The week"
                  description="Overlapping classes sit side by side, so a double-booking looks wrong rather than looking like one class."
                />
                <div className="px-3 pb-4">
                  {slots.length === 0 ? (
                    <EmptyState
                      title="Nothing timetabled yet"
                      description="Schedule a section with the panel beside this grid."
                    />
                  ) : (
                    <TimetableGrid slots={slots} clashes={clashes} />
                  )}
                </div>
              </Card>

              {clashes.length > 0 && (
                <Card>
                  <CardHeader
                    title={`${clashes.length} clash${clashes.length === 1 ? '' : 'es'}`}
                    description="Each names the resource that is double-booked — a lecturer, a room, or a section meeting itself twice."
                  />
                  <ul className="divide-y divide-slate-100">
                    {clashes.map((c, i) => (
                      <li key={i} className="flex items-start gap-3 px-5 py-3">
                        <Badge
                          tone={c.kind === 'TEACHER' ? 'danger' : c.kind === 'ROOM' ? 'warning' : 'info'}
                        >
                          {c.kind === 'TEACHER' ? 'Lecturer' : c.kind === 'ROOM' ? 'Room' : 'Section'}
                        </Badge>
                        <p className="text-xs leading-relaxed text-slate-700">{c.message}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card>
                <CardHeader
                  title="Sections this term"
                  description="Who teaches what, and when it meets."
                />
                {sections.length === 0 ? (
                  <EmptyState title="No sections in this term" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {sections.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                        <span className="text-sm font-medium text-slate-900">
                          {s.course.code} {s.section}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                          {s.course.title}
                        </span>
                        <span className="text-xs text-slate-600">
                          {s.instructor ? (
                            `${s.instructor.user.firstName} ${s.instructor.user.lastName}`
                          ) : (
                            <span className="text-amber-700">no lecturer</span>
                          )}
                        </span>
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {s.meetings.length === 0 ? (
                            <span className="text-amber-700">not timetabled</span>
                          ) : (
                            s.meetings
                              .map(
                                (m) =>
                                  `${DAY_LABELS[m.dayOfWeek as DayOfWeek]?.slice(0, 3)} ${formatMinutes(m.startMinute)}`,
                              )
                              .join(' · ')
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div>
              {maySchedule || mayAssign ? (
                <SchedulePanel
                  sections={sections.map((s) => ({
                    id: s.id,
                    label: `${s.course.code} ${s.section}`.trim(),
                    instructorId: s.instructorId,
                    room: s.room,
                  }))}
                  instructors={instructors.map((i) => ({
                    id: i.id,
                    name: `${i.user.firstName} ${i.user.lastName}`,
                  }))}
                  maySchedule={maySchedule}
                  mayAssign={mayAssign}
                />
              ) : (
                <Alert tone="info">
                  Your role can read the timetable but not change it. Scheduling belongs to the
                  dean of the faculty.
                </Alert>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
