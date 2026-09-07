import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';
import { getStudentAccount } from '@/server/services/finance.service';
import { REGISTRATION_POLICY, checkPrerequisites, detectTimetableConflicts } from '@/lib/domain/enrollment';
import { DAY_NAMES } from '@/lib/domain/enums';
import { formatMoney } from '@/lib/domain/money';
import { formatDate, formatMinutes, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { RegisterButton, DropButton } from './registration-buttons';

export const metadata: Metadata = { title: 'Registration' };

export default async function RegistrationPage() {
  const session = await requireRole('STUDENT');
  if (!session.pid) redirect('/forbidden');

  const now = new Date();

  const student = await db.student.findUnique({
    where: { id: session.pid },
    include: {
      program: true,
      holds: { where: { releasedAt: null, blocksRegistration: true } },
    },
  });
  if (!student) redirect('/forbidden');

  const term = await db.term.findFirst({ where: { isCurrent: true } });
  if (!term) {
    return (
      <>
        <PageHeader title="Course registration" />
        <Card>
          <EmptyState
            title="Registration is not open"
            description="No academic term is currently active. Check back when the registration window opens."
          />
        </Card>
      </>
    );
  }

  const [allEnrollments, offerings, account] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId: student.id },
      include: { offering: { include: { course: true, meetings: true, term: true } } },
    }),
    db.courseOffering.findMany({
      where: { termId: term.id, status: 'OPEN' },
      include: {
        course: {
          include: {
            department: true,
            prerequisites: { include: { prerequisite: { select: { id: true, code: true } } } },
          },
        },
        instructor: { include: { user: true } },
        meetings: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
        _count: { select: { enrollments: { where: { status: 'WAITLISTED' } } } },
      },
      orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
    }),
    getStudentAccount(student.id),
  ]);

  const current = allEnrollments.filter(
    (e) => e.offering.termId === term.id && ['REGISTERED', 'WAITLISTED'].includes(e.status),
  );
  const registered = current.filter((e) => e.status === 'REGISTERED');
  const registeredCredits = registered.reduce((s, e) => s + e.offering.course.creditHours, 0);
  const registeredOfferingIds = new Set(current.map((e) => e.offeringId));

  const completed = allEnrollments
    .filter((e) => e.gradePoint !== null)
    .map((e) => ({ courseId: e.offering.courseId, gradePoint: e.gradePoint }));
  const concurrentCourseIds = registered.map((e) => e.offering.courseId);

  const existingMeetings = registered.map((e) => ({
    offeringLabel: `${e.offering.course.code}-${e.offering.section}`,
    meetings: e.offering.meetings,
  }));

  const windowOpen = now >= term.registrationOpensAt && now <= term.registrationClosesAt;
  const blockers: string[] = [];
  if (!windowOpen) {
    blockers.push(
      now < term.registrationOpensAt
        ? `Registration opens on ${formatDate(term.registrationOpensAt)}.`
        : `Registration closed on ${formatDate(term.registrationClosesAt)}.`,
    );
  }
  for (const h of student.holds) blockers.push(`${titleCase(h.kind)} hold: ${h.reason}`);
  if (account.summary.outstandingMinor > REGISTRATION_POLICY.outstandingBalanceToleranceMinor) {
    blockers.push(
      `An outstanding balance of ${formatMoney(account.summary.outstandingMinor)} must be settled first.`,
    );
  }

  /*
   * Eligibility is previewed here for every section so the button explains
   * itself BEFORE the student clicks. The authoritative check still runs
   * server-side inside the registration transaction — this preview is a
   * courtesy, never a substitute.
   */
  const catalogue = offerings.map((o) => {
    const prereq = checkPrerequisites(
      o.course.prerequisites.map((p) => ({
        prerequisiteCourseId: p.prerequisiteId,
        prerequisiteCourseCode: p.prerequisite.code,
        minGradePoint: p.minGradePoint,
        isConcurrent: p.isConcurrent,
      })),
      completed,
      concurrentCourseIds,
    );

    const conflicts = detectTimetableConflicts(existingMeetings, {
      offeringLabel: `${o.course.code}-${o.section}`,
      meetings: o.meetings,
    });

    const wouldExceed =
      registeredCredits + o.course.creditHours > REGISTRATION_POLICY.maxCreditsPerTerm;
    const isFull = o.seatsTaken >= o.capacity;
    const alreadyIn = registeredOfferingIds.has(o.id);

    const issues: string[] = [];
    if (!prereq.satisfied) issues.push(`Prerequisites: ${prereq.unmet.join('; ')}`);
    if (conflicts.length > 0) {
      // A section with two weekly meetings that both clash produces two
      // conflict records against the same offering. Deduplicate for display —
      // "Clashes with CSC201-A, CSC201-A" reads like a bug to the student.
      const clashLabels = [...new Set(conflicts.map((c) => c.existingOffering))];
      const clashDays = [...new Set(conflicts.map((c) => c.day))];
      issues.push(`Clashes with ${clashLabels.join(', ')} on ${clashDays.join(', ')}`);
    }
    if (wouldExceed) {
      issues.push(`Exceeds the ${REGISTRATION_POLICY.maxCreditsPerTerm}-credit term maximum`);
    }

    return { offering: o, issues, isFull, alreadyIn, blocked: blockers.length > 0 };
  });

  const loadPct = (registeredCredits / REGISTRATION_POLICY.maxCreditsPerTerm) * 100;

  return (
    <>
      <PageHeader
        title="Course registration"
        description={`${term.name} · window ${formatDate(term.registrationOpensAt)} – ${formatDate(term.registrationClosesAt)} · add/drop ends ${formatDate(term.addDropDeadline)}`}
      />

      {blockers.length > 0 ? (
        <Alert tone="danger" title="You cannot register at the moment" className="mb-4">
          <ul className="list-disc space-y-0.5 pl-4">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:order-2">
          <CardHeader
            title="Your schedule"
            description={`${registeredCredits} of a maximum ${REGISTRATION_POLICY.maxCreditsPerTerm} credit hours.`}
          />
          <CardBody className="space-y-3">
            <Meter
              value={loadPct}
              tone={
                registeredCredits < REGISTRATION_POLICY.minCreditsPerTerm
                  ? 'warning'
                  : loadPct >= 100
                    ? 'danger'
                    : 'success'
              }
            />
            {registeredCredits < REGISTRATION_POLICY.minCreditsPerTerm ? (
              <p className="text-xs text-amber-700">
                Full-time status requires at least {REGISTRATION_POLICY.minCreditsPerTerm} credit
                hours.
              </p>
            ) : null}

            {current.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing registered yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {current.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium text-slate-900">
                          {e.offering.course.code}-{e.offering.section}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {e.offering.course.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {e.offering.meetings
                            .map(
                              (m) =>
                                `${DAY_NAMES[m.dayOfWeek]?.slice(0, 3)} ${formatMinutes(m.startMinute)}`,
                            )
                            .join(' · ') || 'Not scheduled'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={toneForStatus(e.status)}>
                          {e.status === 'WAITLISTED' ? `#${e.waitlistPosition}` : `${e.offering.course.creditHours} cr`}
                        </Badge>
                        <DropButton enrollmentId={e.id} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
              Dropping on or before {formatDate(term.addDropDeadline)} removes the course from your
              record entirely. After that and up to {formatDate(term.withdrawalDeadline)}, a
              &ldquo;W&rdquo; appears on your transcript.
            </p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2 lg:order-1">
          <CardHeader
            title="Open sections"
            description="Sections you cannot take are shown with the reason, so nothing fails silently at the point of clicking."
          />
          {catalogue.length === 0 ? (
            <EmptyState title="No open sections this term" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Section</Th>
                  <Th>Meets</Th>
                  <Th className="text-right">Seats</Th>
                  <Th className="w-44">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {catalogue.map(({ offering: o, issues, isFull, alreadyIn, blocked }) => (
                  <tr key={o.id} className={issues.length > 0 ? 'bg-slate-50/60' : undefined}>
                    <Td>
                      <div className="font-mono text-xs font-medium text-slate-900">
                        {o.course.code}-{o.section}
                      </div>
                      <div className="text-xs text-slate-600">{o.course.title}</div>
                      <div className="text-[11px] text-slate-400">
                        {o.course.creditHours} credits
                        {o.instructor
                          ? ` · ${o.instructor.user.firstName} ${o.instructor.user.lastName}`
                          : ''}
                      </div>
                      {issues.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {issues.map((issue) => (
                            <li key={issue} className="text-[11px] text-rose-600">
                              {issue}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Td>
                    <Td className="text-[11px] tabular-nums">
                      {o.meetings.length === 0 ? (
                        <span className="text-slate-400">TBA</span>
                      ) : (
                        o.meetings.map((m) => (
                          <div key={m.id}>
                            {DAY_NAMES[m.dayOfWeek]?.slice(0, 3)} {formatMinutes(m.startMinute)}–
                            {formatMinutes(m.endMinute)}
                          </div>
                        ))
                      )}
                    </Td>
                    <Td className="text-right text-xs tabular-nums">
                      {o.seatsTaken}/{o.capacity}
                      {o._count.enrollments > 0 ? (
                        <div className="text-[11px] text-amber-600">
                          {o._count.enrollments} waiting
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      {alreadyIn ? (
                        <Badge tone="success">On your schedule</Badge>
                      ) : (
                        <RegisterButton
                          offeringId={o.id}
                          disabled={blocked || issues.length > 0}
                          full={isFull}
                        />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
