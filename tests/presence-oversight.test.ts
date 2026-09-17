import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  oversightReport,
  presenceScopeFor,
} from '@/server/services/presence-oversight.service';

/**
 * =============================================================================
 * WHO MAY READ WHOSE ATTENDANCE
 * =============================================================================
 *
 * This is an isolation test, not a feature test. Attendance records say where a
 * person was and for how long, and the failure that matters is not "the page is
 * empty" — it is a head of one department quietly being able to read the staff
 * of another, or a lecturer reading their colleagues.
 *
 * So the assertions below are mostly NEGATIVE. They build two complete
 * faculties and then try to see across the boundary between them.
 *
 * Against the real database, in the style of `tenant.test.ts`: the scope is
 * computed from the reporting line and the department structure, both of which
 * are Prisma queries, and mocking them would test the mock.
 */

const raw = new PrismaClient();
const SUFFIX = `oversight-${Date.now()}`;

let schoolId = '';
const ids: Record<string, string> = {};
const userIds: string[] = [];

/** Create a user + membership, and return the membership id. */
async function person(params: {
  key: string;
  role: string;
  departmentId?: string;
  managerKey?: string;
  staffNo?: string;
}) {
  const user = await raw.user.create({
    data: {
      email: `${params.key}-${SUFFIX}@example.test`,
      firstName: params.key,
      lastName: 'Test',
      passwordHash: 'fixture-account-that-never-authenticates',
    },
  });
  userIds.push(user.id);

  const membership = await raw.membership.create({
    data: {
      userId: user.id,
      schoolId,
      role: params.role,
      status: 'ACTIVE',
      managerId: params.managerKey ? ids[params.managerKey] : null,
    },
  });
  ids[params.key] = membership.id;

  if (params.departmentId && params.staffNo) {
    await raw.instructor.create({
      data: {
        schoolId,
        userId: user.id,
        staffNumber: params.staffNo,
        departmentId: params.departmentId,
      },
    });
  }
  return membership.id;
}

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `o-${SUFFIX}`,
      code: `O${Date.now() % 100000}`,
      name: 'Oversight Test University',
      shortName: 'OTU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;

  // Two complete faculties, so the boundary between them is a real one.
  const sci = await raw.faculty.create({ data: { schoolId, code: 'SCI', name: 'Sciences' } });
  const eng = await raw.faculty.create({ data: { schoolId, code: 'ENG', name: 'Engineering' } });

  const csc = await raw.department.create({
    data: { schoolId, facultyId: sci.id, code: 'CSC', name: 'Computer Science' },
  });
  const eee = await raw.department.create({
    data: { schoolId, facultyId: eng.id, code: 'EEE', name: 'Electrical Engineering' },
  });

  await person({ key: 'registrar', role: 'REGISTRAR' });
  await person({ key: 'sciDean', role: 'DEAN', departmentId: csc.id, staffNo: 'S-000', managerKey: 'registrar' });
  await person({ key: 'engDean', role: 'DEAN', departmentId: eee.id, staffNo: 'E-000', managerKey: 'registrar' });
  await person({ key: 'cscHod', role: 'HOD', departmentId: csc.id, staffNo: 'S-100', managerKey: 'sciDean' });
  await person({ key: 'eeeHod', role: 'HOD', departmentId: eee.id, staffNo: 'E-100', managerKey: 'engDean' });
  await person({ key: 'cscLecturer', role: 'INSTRUCTOR', departmentId: csc.id, staffNo: 'S-101', managerKey: 'cscHod' });
  await person({ key: 'eeeLecturer', role: 'INSTRUCTOR', departmentId: eee.id, staffNo: 'E-101', managerKey: 'eeeHod' });

  // A student in each faculty, attached by programme rather than by manager.
  for (const [key, dept] of [
    ['cscStudent', csc],
    ['eeeStudent', eee],
  ] as const) {
    const program = await raw.program.create({
      data: {
        schoolId,
        departmentId: dept.id,
        code: `P-${dept.code}`,
        name: `Programme ${dept.code}`,
        degreeType: 'BSC',
        durationTerms: 8,
      },
    });
    const membershipId = await person({ key, role: 'STUDENT' });
    const membership = await raw.membership.findUniqueOrThrow({ where: { id: membershipId } });
    await raw.student.create({
      data: {
        schoolId,
        userId: membership.userId,
        matricNumber: `${dept.code}/2024/1`,
        programId: program.id,
        level: 100,
      },
    });
  }
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('a head of department', () => {
  it('sees their own department, staff and students alike', async () => {
    const scope = await presenceScopeFor({
      schoolId,
      membershipId: ids.cscHod,
      role: 'HOD',
    });
    expect(scope.kind).toBe('DEPARTMENT');
    expect(scope.label).toBe('Computer Science');
    expect(scope.staffMembershipIds).toContain(ids.cscLecturer);
    expect(scope.studentMembershipIds).toContain(ids.cscStudent);
  });

  it('CANNOT see another department, at any level', async () => {
    // The assertion that matters. A head reading another department's staff is
    // the failure this scoping exists to prevent.
    const scope = await presenceScopeFor({ schoolId, membershipId: ids.cscHod, role: 'HOD' });
    expect(scope.staffMembershipIds).not.toContain(ids.eeeLecturer);
    expect(scope.staffMembershipIds).not.toContain(ids.eeeHod);
    expect(scope.studentMembershipIds).not.toContain(ids.eeeStudent);
  });

  it('cannot see their own dean, or the registrar above them', async () => {
    // Oversight runs DOWN the line, never up it.
    const scope = await presenceScopeFor({ schoolId, membershipId: ids.cscHod, role: 'HOD' });
    expect(scope.staffMembershipIds).not.toContain(ids.sciDean);
    expect(scope.staffMembershipIds).not.toContain(ids.registrar);
  });
});

describe('a dean', () => {
  it('sees the whole faculty, through their heads', async () => {
    const scope = await presenceScopeFor({ schoolId, membershipId: ids.sciDean, role: 'DEAN' });
    expect(scope.kind).toBe('FACULTY');
    expect(scope.label).toBe('Sciences');
    // Transitive: the lecturer reports to the head, who reports to the dean.
    expect(scope.staffMembershipIds).toContain(ids.cscHod);
    expect(scope.staffMembershipIds).toContain(ids.cscLecturer);
    expect(scope.studentMembershipIds).toContain(ids.cscStudent);
  });

  it('CANNOT see another faculty', async () => {
    const scope = await presenceScopeFor({ schoolId, membershipId: ids.sciDean, role: 'DEAN' });
    for (const outsider of [ids.engDean, ids.eeeHod, ids.eeeLecturer]) {
      expect(scope.staffMembershipIds).not.toContain(outsider);
    }
    expect(scope.studentMembershipIds).not.toContain(ids.eeeStudent);
  });

  it('is symmetric — the other dean cannot see this faculty either', async () => {
    const scope = await presenceScopeFor({ schoolId, membershipId: ids.engDean, role: 'DEAN' });
    expect(scope.staffMembershipIds).toContain(ids.eeeLecturer);
    expect(scope.staffMembershipIds).not.toContain(ids.cscLecturer);
    expect(scope.studentMembershipIds).not.toContain(ids.cscStudent);
  });
});

describe('a lecturer', () => {
  it('oversees nobody', async () => {
    /*
     * Teaching somebody is not overseeing them. A lecturer with no reports has
     * no register but their own — which is why /presence/team is not offered to
     * INSTRUCTOR in the navigation, and refused to it by the route guard.
     */
    const scope = await presenceScopeFor({
      schoolId,
      membershipId: ids.cscLecturer,
      role: 'INSTRUCTOR',
    });
    expect(scope.staffMembershipIds).toEqual([]);
    expect(scope.studentMembershipIds).toEqual([]);
  });

  it('cannot see their own students, even the ones they teach', async () => {
    const scope = await presenceScopeFor({
      schoolId,
      membershipId: ids.cscLecturer,
      role: 'INSTRUCTOR',
    });
    expect(scope.studentMembershipIds).not.toContain(ids.cscStudent);
  });
});

describe('the office', () => {
  it('sees the whole school, both faculties included', async () => {
    const scope = await presenceScopeFor({
      schoolId,
      membershipId: ids.registrar,
      role: 'REGISTRAR',
    });
    expect(scope.kind).toBe('SCHOOL');
    for (const anyone of [ids.cscLecturer, ids.eeeLecturer, ids.sciDean, ids.engDean]) {
      expect(scope.staffMembershipIds).toContain(anyone);
    }
    expect(scope.studentMembershipIds).toContain(ids.cscStudent);
    expect(scope.studentMembershipIds).toContain(ids.eeeStudent);
  });

  it('does not count students as staff', async () => {
    const scope = await presenceScopeFor({
      schoolId,
      membershipId: ids.registrar,
      role: 'REGISTRAR',
    });
    expect(scope.staffMembershipIds).not.toContain(ids.cscStudent);
  });
});

describe('the report itself', () => {
  beforeAll(async () => {
    // One closed day for the lecturer, and nothing at all for the student.
    const startedAt = new Date('2026-09-14T08:00:00.000Z');
    await raw.presenceSession.create({
      data: {
        schoolId,
        membershipId: ids.cscLecturer,
        localDate: '2026-09-14',
        startedAt,
        endedAt: new Date('2026-09-14T17:00:00.000Z'),
        durationMinutes: 540,
        breakMinutes: 45,
        netMinutes: 495,
        status: 'CLOSED',
        identifierGiven: 'S-101',
        unitGiven: 'Computer Science',
      },
    });
  });

  it('reports worked time net of unpaid breaks', async () => {
    const report = await oversightReport({
      schoolId,
      membershipId: ids.cscHod,
      role: 'HOD',
      from: '2026-09-14',
      to: '2026-09-14',
      expectedDays: 1,
    });
    const lecturer = report.staff.find((p) => p.membershipId === ids.cscLecturer)!;
    expect(lecturer.totals.minutes).toBe(540);
    expect(lecturer.totals.breakMinutes).toBe(45);
    expect(lecturer.totals.netMinutes).toBe(495);
    expect(lecturer.daysAbsent).toBe(0);
  });

  it('LISTS somebody who never signed in, rather than omitting them', async () => {
    /*
     * The single most important behaviour on the page. A person with no
     * sessions has no rows, and a report built from rows alone would leave them
     * off entirely — which is precisely the person a head is looking for.
     */
    const report = await oversightReport({
      schoolId,
      membershipId: ids.cscHod,
      role: 'HOD',
      from: '2026-09-14',
      to: '2026-09-14',
      expectedDays: 1,
    });
    const student = report.students.find((p) => p.membershipId === ids.cscStudent);
    expect(student).toBeDefined();
    expect(student!.totals.days).toBe(0);
    expect(student!.daysAbsent).toBe(1);
    expect(student!.lastSeen).toBeNull();
  });

  it('never leaks a row from the other faculty into the report', async () => {
    const report = await oversightReport({
      schoolId,
      membershipId: ids.cscHod,
      role: 'HOD',
      from: '2026-01-01',
      to: '2026-12-31',
      expectedDays: 250,
    });
    const everyone = [...report.staff, ...report.students].map((p) => p.membershipId);
    expect(everyone).not.toContain(ids.eeeLecturer);
    expect(everyone).not.toContain(ids.eeeStudent);
  });
});
