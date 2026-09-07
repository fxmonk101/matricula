import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';
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

export const metadata: Metadata = { title: 'My teaching' };

export default async function TeachingPage() {
  const session = await requireRole('INSTRUCTOR', 'ADMIN');

  // An ADMIN has no instructor profile; they see the whole schedule instead of
  // a personal one, which is the sensible reading of "my teaching" for staff
  // who supervise rather than teach.
  const where =
    session.role === 'INSTRUCTOR' && session.pid ? { instructorId: session.pid } : {};

  if (session.role === 'INSTRUCTOR' && !session.pid) redirect('/forbidden');

  const offerings = await db.courseOffering.findMany({
    where: { ...where, term: { isCurrent: true } },
    include: {
      course: true,
      term: true,
      meetings: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
      _count: {
        select: {
          enrollments: { where: { status: { in: ['REGISTERED', 'COMPLETED'] } } },
        },
      },
      enrollments: {
        where: { status: { in: ['REGISTERED', 'COMPLETED'] } },
        select: { totalScore: true, gradePoint: true },
      },
    },
    orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
  });

  const totalStudents = offerings.reduce((s, o) => s + o._count.enrollments, 0);

  return (
    <>
      <PageHeader
        title="My teaching"
        description={
          offerings.length === 0
            ? 'No sections assigned for the current term.'
            : `${offerings.length} section${offerings.length === 1 ? '' : 's'} · ${totalStudents} students this term.`
        }
      />

      {offerings.length === 0 ? (
        <Card>
          <EmptyState
            title="No sections assigned"
            description="The Registrar assigns sections at the start of each term."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {offerings.map((o) => {
            const graded = o.enrollments.filter((e) => e.gradePoint !== null).length;
            const total = o.enrollments.length;
            const pct = total === 0 ? 0 : (graded / total) * 100;

            return (
              <Card key={o.id}>
                <CardHeader
                  title={
                    <span className="font-mono">
                      {o.course.code}-{o.section}
                    </span>
                  }
                  description={o.course.title}
                  actions={
                    o.gradesPosted ? (
                      <Badge tone="success">Grades posted</Badge>
                    ) : (
                      <Badge tone={toneForStatus(o.status)}>{titleCase(o.status)}</Badge>
                    )
                  }
                />
                <div className="space-y-3 px-5 py-4">
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Enrolled</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-slate-900">
                        {o._count.enrollments} / {o.capacity}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Credits</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-slate-900">
                        {o.course.creditHours}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Room</dt>
                      <dd className="mt-0.5 font-medium text-slate-900">{o.room ?? '—'}</dd>
                    </div>
                  </dl>

                  <p className="text-xs text-slate-500">
                    {o.meetings.length === 0
                      ? 'Not scheduled'
                      : o.meetings
                          .map(
                            (m) =>
                              `${DAY_NAMES[m.dayOfWeek]} ${formatMinutes(m.startMinute)}–${formatMinutes(m.endMinute)}`,
                          )
                          .join(' · ')}
                  </p>

                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-slate-500">Grading progress</span>
                      <span className="tabular-nums font-medium text-slate-900">
                        {graded} / {total}
                      </span>
                    </div>
                    <Meter value={pct} tone={pct === 100 ? 'success' : 'brand'} />
                  </div>

                  <Link
                    href={`/teaching/${o.id}`}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
                  >
                    {graded === total && total > 0 ? 'Review grades' : 'Enter grades'}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
