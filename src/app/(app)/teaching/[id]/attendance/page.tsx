import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  ATTENDANCE_STATUS_LABELS,
  type EligibilityVerdict,
} from '@/lib/domain/attendance';
import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering } from '@/server/services/lms.service';
import {
  attendanceForOffering,
  sessionsForOffering,
} from '@/server/services/attendance.service';
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

export const metadata: Metadata = { title: 'Attendance' };

/** Minutes from midnight, the timetable's own representation. */
function clock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const VERDICT_TONE: Record<EligibilityVerdict, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ELIGIBLE: 'success',
  AT_RISK: 'warning',
  // BELOW is the same shortfall as BARRED and carries no consequence yet, so
  // it is coloured as the problem it is rather than as a gentle warning.
  BELOW: 'danger',
  BARRED: 'danger',
  UNKNOWN: 'neutral',
};

const VERDICT_LABEL: Record<EligibilityVerdict, string> = {
  ELIGIBLE: 'Eligible',
  AT_RISK: 'At risk',
  BELOW: 'Below the bar',
  BARRED: 'Barred',
  UNKNOWN: 'No record',
};

/**
 * Attendance for one section: who is short, and which sessions have no register.
 *
 * The two halves answer different questions and both are needed. The student
 * table answers "who is in trouble"; the session list answers "is this table
 * worth trusting" — because a percentage computed over the four sessions
 * somebody remembered to mark, out of eleven held, is not an attendance record.
 */
export default async function AttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, schoolId, session, role, config } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId } = await params;

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: true, term: true },
  });
  if (!offering) notFound();

  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  const policy = config.attendance;

  const [report, sessions] = await Promise.all([
    attendanceForOffering({ schoolId, offeringId, policy }),
    sessionsForOffering({ schoolId, offeringId }),
  ]);

  const unmarked = sessions.filter((s) => s.status === 'DELIVERED' && s.markedCount === 0);
  const atRisk = report.students.filter(
    (s) => s.verdict === 'AT_RISK' || s.verdict === 'BELOW' || s.verdict === 'BARRED',
  );

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`${offering.course.code}${offering.section ? ` ${offering.section}` : ''} · ${offering.term.name}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offeringId}/modules`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Course content →
            </Link>
            <Link
              href={`/teaching/${offeringId}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Gradesheet →
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Classes delivered" value={report.sessionsHeld} />
        <StatTile
          label="Registers taken"
          value={`${report.sessionsMarked} of ${report.sessionsHeld}`}
          tone={
            report.sessionsHeld > 0 && report.sessionsMarked < report.sessionsHeld
              ? 'warning'
              : 'success'
          }
        />
        <StatTile label="Students" value={report.students.length} />
        <StatTile
          label={policy.enforced ? 'Below the bar' : 'Below the bar (not enforced)'}
          value={atRisk.length}
          tone={atRisk.length > 0 ? 'warning' : 'success'}
          sublabel={`Needs ${policy.examEligibilityThreshold}% to sit`}
        />
      </div>

      {!policy.enforced && (
        <Alert tone="info" title="The attendance rule is not being enforced" className="mt-4">
          Percentages are recorded and shown, but nobody is barred from an examination. A school
          officer can turn enforcement on in the school settings once registers are being taken
          reliably — doing it before then would bar students for classes nobody marked.
        </Alert>
      )}

      {unmarked.length > 0 && (
        <Alert
          tone="warning"
          title={`${unmarked.length} delivered ${unmarked.length === 1 ? 'class has' : 'classes have'} no register`}
          className="mt-4"
        >
          Those classes count towards nobody&rsquo;s attendance. The percentages below are over the{' '}
          {report.sessionsMarked} {report.sessionsMarked === 1 ? 'session' : 'sessions'} that were
          marked.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Students"
              description="Lowest attendance first — the people worth finding before the examination, not after."
            />
            {report.students.length === 0 ? (
              <EmptyState
                title="Nobody is registered on this section yet"
                description="Once students register, they appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="table-zebra">
                  <thead>
                    <tr>
                      <Th>Student</Th>
                      <Th className="whitespace-nowrap">Attended</Th>
                      <Th className="whitespace-nowrap">Missed</Th>
                      <Th className="whitespace-nowrap">Excused</Th>
                      <Th className="whitespace-nowrap">Rate</Th>
                      <Th className="whitespace-nowrap">Examination</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.students.map((student) => (
                      <tr key={student.enrollmentId}>
                        <Td className="whitespace-nowrap text-xs">
                          <span className="font-medium text-slate-900">{student.name}</span>
                          <span className="block text-[11px] text-slate-500">
                            {student.matricNumber ?? '—'}
                          </span>
                        </Td>
                        <Td className="text-xs tabular-nums">{student.attended}</Td>
                        <Td className="text-xs tabular-nums">
                          {student.missed > 0 ? (
                            <span className="font-medium text-rose-700">{student.missed}</span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </Td>
                        <Td className="text-xs tabular-nums text-slate-500">
                          {student.excused > 0 ? student.excused : <span className="text-slate-300">0</span>}
                        </Td>
                        <Td className="whitespace-nowrap text-xs tabular-nums">
                          {student.percentage === null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className="font-medium text-slate-900">
                              {student.percentage.toFixed(1)}%
                            </span>
                          )}
                        </Td>
                        <Td>
                          <Badge tone={VERDICT_TONE[student.verdict]}>
                            {VERDICT_LABEL[student.verdict]}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader
              title="Sessions"
              description="Every class logged for this section, newest first."
            />
            {sessions.length === 0 ? (
              <EmptyState
                title="No classes logged yet"
                description="Log a class in the teaching log, then take its register here."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {sessions.map((item) => {
                  const delivered = item.status === 'DELIVERED';
                  return (
                    <li key={item.teachingLogId} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          {delivered ? (
                            <Link
                              href={`/teaching/${offeringId}/attendance/${item.teachingLogId}`}
                              className="block truncate text-sm font-medium text-brand-700 hover:underline"
                            >
                              {item.localDate}
                            </Link>
                          ) : (
                            <span className="block truncate text-sm text-slate-500">
                              {item.localDate}
                            </span>
                          )}
                          <span className="block text-[11px] text-slate-500">
                            {clock(item.startMinute)}–{clock(item.endMinute)}
                            {item.topic ? ` · ${item.topic}` : ''}
                          </span>
                        </span>

                        {!delivered ? (
                          // A class that did not run takes no register, and
                          // saying so is more useful than hiding the row.
                          <Badge tone="neutral">{item.status === 'CANCELLED' ? 'Cancelled' : 'Moved'}</Badge>
                        ) : item.markedCount === 0 ? (
                          <Badge tone="warning">Not taken</Badge>
                        ) : (
                          <Badge tone="success">
                            {item.markedCount} marked
                            {item.absentCount > 0 ? ` · ${item.absentCount} absent` : ''}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader title="How the rate is worked out" />
            <div className="space-y-2 px-5 pb-5 text-xs leading-relaxed text-slate-600">
              <p>
                <strong>{ATTENDANCE_STATUS_LABELS.LATE}</strong> counts as having attended. A
                student who arrived ten minutes into a lecture was at the lecture.
              </p>
              <p>
                <strong>{ATTENDANCE_STATUS_LABELS.EXCUSED}</strong> is left out of the calculation
                altogether — neither attended nor missed — so three weeks in hospital neither
                penalises a student nor inflates their rate.
              </p>
              <p>
                A student with no marks at all shows <strong>no record</strong> rather than 0%.
                Nothing is known about them yet, which is not the same as their having missed
                everything.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
