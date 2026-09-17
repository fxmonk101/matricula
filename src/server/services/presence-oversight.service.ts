import { dbFor } from '@/lib/tenant';
import type { Role } from '@/lib/domain/enums';
import { getSubordinateIds } from './org.service';
import {
  summariseTimesheet,
  totalBreakMinutes,
  type TimesheetTotals,
} from '@/lib/domain/presence';

/**
 * =============================================================================
 * PRESENCE, SEEN FROM ABOVE
 * =============================================================================
 *
 * A head of department needs to know who in their department was in this week.
 * A dean needs the same for their faculty. Neither should see the other
 * faculty's staff, and a lecturer should see neither.
 *
 * TWO SCOPES, NOT ONE, because staff and students are attached to a school in
 * genuinely different ways:
 *
 *   · STAFF are scoped by the REPORTING LINE. `Membership.managerId` already
 *     encodes who answers to whom, it is the line an institution actually
 *     recognises, and it is transitive — a dean sees the lecturers under their
 *     heads without anybody restating the department.
 *
 *   · STUDENTS have no manager, and never will: nobody would call a lecturer a
 *     pupil's line manager. They are scoped by the DEPARTMENT of the programme
 *     they are enrolled on, which is the only structural fact that connects a
 *     student to a head of department at all.
 *
 * Using the reporting line for staff and only falling back to the org unit
 * matters: a visiting lecturer attached to a department they do not report into
 * would otherwise appear on the wrong person's register.
 */

export type ScopeKind = 'SCHOOL' | 'FACULTY' | 'DEPARTMENT' | 'TEAM' | 'SELF';

export interface OversightScope {
  kind: ScopeKind;
  /** What to call it on the page: "Faculty of Science", "the whole school". */
  label: string;
  /** Staff memberships this person may see the register for. */
  staffMembershipIds: string[];
  /** Student memberships, scoped structurally rather than by reporting line. */
  studentMembershipIds: string[];
}

/**
 * What may this person see, and what is it called?
 *
 * The scope is resolved from the viewer's OWN record rather than from anything
 * in the request, so there is no id a crafted URL could substitute to widen it.
 */
export async function presenceScopeFor(params: {
  schoolId: string;
  membershipId: string;
  role: Role;
}): Promise<OversightScope> {
  const db = dbFor(params.schoolId);

  // The office oversees the whole institution; that is what the permission
  // means and there is nothing narrower to compute.
  const schoolWide =
    params.role === 'OWNER' ||
    params.role === 'ADMIN' ||
    params.role === 'REGISTRAR';

  if (schoolWide) {
    const [staff, students] = await Promise.all([
      db.membership.findMany({
        where: { role: { notIn: ['STUDENT', 'APPLICANT', 'GUARDIAN'] } },
        select: { id: true },
      }),
      db.membership.findMany({ where: { role: 'STUDENT' }, select: { id: true } }),
    ]);
    return {
      kind: 'SCHOOL',
      label: 'the whole school',
      staffMembershipIds: staff.map((m) => m.id),
      studentMembershipIds: students.map((m) => m.id),
    };
  }

  // Everyone else sees the people who report to them, transitively.
  const subordinates = await getSubordinateIds(params.schoolId, params.membershipId);

  // Where this person sits, so students can be scoped structurally.
  const me = await db.membership.findUnique({
    where: { id: params.membershipId },
    select: { userId: true },
  });
  const profile = me
    ? await db.instructor.findFirst({
        where: { userId: me.userId },
        include: { department: { include: { faculty: true } } },
      })
    : null;

  let studentMembershipIds: string[] = [];
  let label = 'your team';
  let kind: ScopeKind = subordinates.size > 0 ? 'TEAM' : 'SELF';

  if (profile?.department) {
    /*
     * A DEAN's reach is the faculty; an HOD's is the department. Anything else
     * — a lecturer with reports, say — gets the reporting line alone and no
     * students, because teaching somebody is not the same as overseeing their
     * attendance.
     */
    const departmentIds =
      params.role === 'DEAN'
        ? (
            await db.department.findMany({
              where: { facultyId: profile.department.facultyId },
              select: { id: true },
            })
          ).map((d) => d.id)
        : params.role === 'HOD'
          ? [profile.departmentId]
          : [];

    if (departmentIds.length > 0) {
      kind = params.role === 'DEAN' ? 'FACULTY' : 'DEPARTMENT';
      label =
        params.role === 'DEAN'
          ? profile.department.faculty.name
          : profile.department.name;

      const students = await db.student.findMany({
        where: { program: { departmentId: { in: departmentIds } } },
        select: { userId: true },
      });
      if (students.length > 0) {
        const rows = await db.membership.findMany({
          where: { userId: { in: students.map((s) => s.userId) }, role: 'STUDENT' },
          select: { id: true },
        });
        studentMembershipIds = rows.map((r) => r.id);
      }
    }
  }

  return {
    kind,
    label,
    staffMembershipIds: [...subordinates],
    studentMembershipIds,
  };
}

export interface PersonPresence {
  membershipId: string;
  name: string;
  role: string;
  title: string | null;
  unit: string | null;
  /** The number they sign the register with, as they last gave it. */
  identifier: string | null;
  totals: TimesheetTotals;
  /** Days in the window on which they recorded nothing at all. */
  daysAbsent: number;
  /** Signed in right now. */
  openNow: boolean;
  onBreak: boolean;
  lastSeen: Date | null;
  /** Sessions whose time nobody actually confirmed. */
  autoClosed: number;
  /** Times the person keyed in rather than taking the clock. */
  declared: number;
}

export interface OversightReport {
  scope: OversightScope;
  staff: PersonPresence[];
  students: PersonPresence[];
  /** Everybody in the scope who is signed in at this moment. */
  inBuildingNow: number;
  expectedDays: number;
}

/**
 * The register for everybody below this person, over a window.
 *
 * Built from ONE query per population rather than one per person: a faculty of
 * sixty staff over ninety days is otherwise sixty round trips to render a
 * single table, which is the sort of thing that works in a demo and falls over
 * in a real institution.
 */
export async function oversightReport(params: {
  schoolId: string;
  membershipId: string;
  role: Role;
  from: string;
  to: string;
  /** Working days in the window, for the absence count. */
  expectedDays: number;
}): Promise<OversightReport> {
  const scope = await presenceScopeFor(params);
  const db = dbFor(params.schoolId);

  const everyone = [...scope.staffMembershipIds, ...scope.studentMembershipIds];
  if (everyone.length === 0) {
    return { scope, staff: [], students: [], inBuildingNow: 0, expectedDays: params.expectedDays };
  }

  const [members, sessions] = await Promise.all([
    db.membership.findMany({
      where: { id: { in: everyone } },
      include: { user: true, orgUnit: { select: { name: true } } },
      orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }],
    }),
    db.presenceSession.findMany({
      where: {
        membershipId: { in: everyone },
        localDate: { gte: params.from, lte: params.to },
      },
      include: { breaks: true },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  const byMember = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const list = byMember.get(session.membershipId);
    if (list) list.push(session);
    else byMember.set(session.membershipId, [session]);
  }

  function summarise(member: (typeof members)[number]): PersonPresence {
    const mine = byMember.get(member.id) ?? [];
    const totals = summariseTimesheet(mine);
    const open = mine.find((s) => s.status === 'OPEN') ?? null;

    return {
      membershipId: member.id,
      name: `${member.user.firstName} ${member.user.lastName}`,
      role: member.role,
      title: member.title,
      // The unit as the person last DECLARED it, falling back to the org chart.
      // A register is a record of what was said, not of what is true today.
      unit: mine[0]?.unitGiven ?? member.orgUnit?.name ?? null,
      identifier: mine[0]?.identifierGiven ?? null,
      totals,
      daysAbsent: Math.max(0, params.expectedDays - totals.days),
      openNow: Boolean(open),
      onBreak: Boolean(open?.breaks.some((b) => b.endedAt === null)),
      lastSeen: mine[0]?.startedAt ?? null,
      autoClosed: mine.filter((s) => s.status === 'AUTO_CLOSED').length,
      declared: mine.filter((s) => s.startDeclared || s.endDeclared).length,
    };
  }

  const staffSet = new Set(scope.staffMembershipIds);
  const staff = members.filter((m) => staffSet.has(m.id)).map(summarise);
  const students = members.filter((m) => !staffSet.has(m.id)).map(summarise);

  return {
    scope,
    staff,
    students,
    inBuildingNow: [...staff, ...students].filter((p) => p.openNow).length,
    expectedDays: params.expectedDays,
  };
}

/** A compact line for a dashboard tile: who is in, who is missing. */
export async function presenceHeadline(params: {
  schoolId: string;
  membershipId: string;
  role: Role;
  localDate: string;
}): Promise<{ label: string; inNow: number; expected: number; absent: number } | null> {
  const scope = await presenceScopeFor(params);
  const everyone = [...scope.staffMembershipIds, ...scope.studentMembershipIds];
  if (everyone.length === 0) return null;

  const today = await dbFor(params.schoolId).presenceSession.findMany({
    where: { membershipId: { in: everyone }, localDate: params.localDate },
    select: { membershipId: true, status: true },
  });

  const seen = new Set(today.map((s) => s.membershipId));
  const inNow = new Set(
    today.filter((s) => s.status === 'OPEN').map((s) => s.membershipId),
  ).size;

  return {
    label: scope.label,
    inNow,
    expected: everyone.length,
    absent: everyone.length - seen.size,
  };
}
