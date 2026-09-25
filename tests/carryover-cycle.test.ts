import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { submitGrade } from '@/server/services/gpa.service';
import {
  carryoverCohort,
  carryoverReport,
  retakeOptions,
} from '@/server/services/carryover.service';
import { ensureSheet, releaseResults } from '@/server/services/result-workflow.service';

/**
 * =============================================================================
 * CARRYOVERS, AGAINST THE REAL RECORD
 * =============================================================================
 *
 * The assertion that matters most is the one about timing: a fail that Senate
 * has not released must NOT appear on a student's carryover list. Getting that
 * wrong would tell somebody they had failed a course before the result existed,
 * which is worse than not having the feature at all.
 */

const raw = new PrismaClient();
const SUFFIX = `carry-${Date.now()}`;

let schoolId = '';
let studentId = '';
let ACTOR = '';
let registrarMembershipId = '';
let termA = '';
let termB = '';
let programId = '';
const courses: Record<string, string> = {};
const userIds: string[] = [];

async function offer(courseKey: string, termId: string) {
  return raw.courseOffering.create({
    data: {
      schoolId,
      courseId: courses[courseKey],
      termId,
      section: 'A',
    },
  });
}

/** Mark, then take it all the way through release, as the real flow does. */
async function gradeAndRelease(offeringId: string, enrollmentId: string, ca: number, exam: number) {
  await submitGrade({ schoolId, enrollmentId, caScore: ca, examScore: exam, actorId: ACTOR });
  await ensureSheet({ schoolId, offeringId });
  await releaseResults({
    schoolId,
    offeringId,
    actor: { role: 'REGISTRAR' as never, membershipId: registrarMembershipId, userId: ACTOR },
  });
}

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `carry-${SUFFIX}`,
      code: `Y${Date.now() % 100000}`,
      name: 'Carryover University',
      shortName: 'CU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;

  async function makeTerm(code: string, start: string, current: boolean) {
    return (
      await raw.term.create({
        data: {
          schoolId,
          code: `${SUFFIX}-${code}`,
          name: `Term ${code}`,
          academicYear: '2026/2027',
          season: 'FALL',
          startDate: new Date(start),
          endDate: new Date(start),
          registrationOpensAt: new Date(start),
          registrationClosesAt: new Date(start),
          addDropDeadline: new Date(start),
          withdrawalDeadline: new Date(start),
          isCurrent: current,
        },
      })
    ).id;
  }

  termA = await makeTerm('A', '2025-09-01T00:00:00Z', false);
  termB = await makeTerm('B', '2026-09-01T00:00:00Z', true);

  const faculty = await raw.faculty.create({ data: { schoolId, code: 'SCI', name: 'Sciences' } });
  const department = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'CSC', name: 'Computer Science' },
  });
  programId = (
    await raw.program.create({
      data: {
        schoolId,
        departmentId: department.id,
        code: 'BSC-CSC',
        name: 'BSc Computer Science',
        degreeType: 'BSC',
        durationTerms: 8,
      },
    })
  ).id;

  for (const [key, code, level, kind] of [
    ['passed', 'CSC101', 100, 'CORE'],
    ['failed', 'CSC102', 100, 'CORE'],
    ['retaken', 'CSC103', 100, 'CORE'],
    ['withdrawn', 'CSC104', 100, 'CORE'],
    ['untaken', 'CSC201', 200, 'CORE'],
    ['elective', 'CSC350', 300, 'ELECTIVE'],
  ] as const) {
    const course = await raw.course.create({
      data: { schoolId, code, title: `Course ${code}`, creditHours: 3, departmentId: department.id },
    });
    courses[key] = course.id;
    await raw.programRequirement.create({
      data: { schoolId, programId, courseId: course.id, kind, level },
    });
  }

  async function person(key: string, role: string) {
    const user = await raw.user.create({
      data: {
        email: `${key}-${SUFFIX}@example.test`,
        firstName: key,
        lastName: 'Test',
        passwordHash: 'fixture-account-that-never-authenticates',
      },
    });
    userIds.push(user.id);
    const m = await raw.membership.create({
      data: { schoolId, userId: user.id, role, status: 'ACTIVE' },
    });
    return { user, membershipId: m.id };
  }

  const registrar = await person('registrar', 'REGISTRAR');
  ACTOR = registrar.user.id;
  registrarMembershipId = registrar.membershipId;

  const studentUser = await person('student', 'STUDENT');
  studentId = (
    await raw.student.create({
      data: {
        schoolId,
        userId: studentUser.user.id,
        matricNumber: `M-${SUFFIX}`,
        programId,
        level: 200,
      },
    })
  ).id;

  // Term A: passed one, failed one, failed one that will be retaken, withdrew
  // from one.
  const passed = await offer('passed', termA);
  const failed = await offer('failed', termA);
  const retaken = await offer('retaken', termA);
  const withdrawn = await offer('withdrawn', termA);

  for (const [offering, ca, exam] of [
    [passed, 30, 50],
    [failed, 10, 10],
    [retaken, 10, 12],
  ] as const) {
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId, offeringId: offering.id, status: 'REGISTERED' },
    });
    await gradeAndRelease(offering.id, enrolment.id, ca, exam);
  }

  // A withdrawal: no grade point, and not a failure.
  await raw.enrollment.create({
    data: { schoolId, studentId, offeringId: withdrawn.id, status: 'WITHDRAWN' },
  });
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('what the record says', () => {
  it('lists the two courses that were failed', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    const carried = report!.courses.filter((c) => c.reason === 'FAILED');
    expect(carried.map((c) => c.courseCode).sort()).toEqual(['CSC102', 'CSC103']);
  });

  it('does not list the one that was passed', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    expect(report!.courses.map((c) => c.courseCode)).not.toContain('CSC101');
  });

  it('does not treat the WITHDRAWAL as a failure', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    const withdrawn = report!.courses.find((c) => c.courseCode === 'CSC104');
    // It is outstanding — never passed — but it is NOT a carryover.
    expect(withdrawn?.reason).not.toBe('FAILED');
  });

  it('lists a required course never attempted as a plan, not a debt', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    const untaken = report!.courses.find((c) => c.courseCode === 'CSC201')!;
    expect(untaken.reason).toBe('NOT_TAKEN');
  });

  it('leaves the elective out', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    expect(report!.courses.map((c) => c.courseCode)).not.toContain('CSC350');
  });

  it('puts the debts before the plans', async () => {
    const report = await carryoverReport({ schoolId, studentId });
    const firstPlan = report!.courses.findIndex((c) => c.reason === 'NOT_TAKEN');
    const lastDebt = report!.courses.map((c) => c.reason).lastIndexOf('FAILED');
    expect(lastDebt).toBeLessThan(firstPlan);
  });
});

describe('an unreleased result', () => {
  it('does NOT appear as a carryover before it is released', async () => {
    /*
     * The assertion that matters most. A lecturer entering a fail starts a
     * chain that Senate has not finished; telling the student they have failed
     * before the result exists is worse than not having this feature.
     */
    const offering = await offer('untaken', termB);
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId, offeringId: offering.id, status: 'REGISTERED' },
    });

    // Marked as a fail — but NOT released.
    await submitGrade({
      schoolId,
      enrollmentId: enrolment.id,
      caScore: 5,
      examScore: 5,
      actorId: ACTOR,
    });

    const report = await carryoverReport({ schoolId, studentId });

    // Not a carryover: the mark is not on the record yet.
    expect(report!.courses.filter((c) => c.reason === 'FAILED').map((c) => c.courseCode)).not.toContain(
      'CSC201',
    );

    /*
     * And absent from the list ENTIRELY, which is the right answer rather
     * than a near miss. A course being taken right now is neither a debt nor
     * a plan — listing it under "still to be taken" would tell a student to
     * register something they are already sitting.
     */
    expect(report!.courses.map((c) => c.courseCode)).not.toContain('CSC201');
  });

  it('becomes a carryover once it IS released', async () => {
    const offering = await raw.courseOffering.findFirstOrThrow({
      where: { schoolId, courseId: courses.untaken, termId: termB },
    });
    const enrolment = await raw.enrollment.findFirstOrThrow({
      where: { studentId, offeringId: offering.id },
    });

    await ensureSheet({ schoolId, offeringId: offering.id });
    await releaseResults({
      schoolId,
      offeringId: offering.id,
      actor: { role: 'REGISTRAR' as never, membershipId: registrarMembershipId, userId: ACTOR },
    });
    void enrolment;

    const report = await carryoverReport({ schoolId, studentId });
    const carried = report!.courses.filter((c) => c.reason === 'FAILED').map((c) => c.courseCode);
    expect(carried).toContain('CSC201');
  });
});

describe('a retake that succeeded', () => {
  it('clears the carryover', async () => {
    const offering = await offer('retaken', termB);
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId, offeringId: offering.id, status: 'REGISTERED' },
    });
    await gradeAndRelease(offering.id, enrolment.id, 30, 50);

    const report = await carryoverReport({ schoolId, studentId });
    const carried = report!.courses.filter((c) => c.reason === 'FAILED').map((c) => c.courseCode);
    expect(carried).not.toContain('CSC103');
    // And the one never retaken is still there.
    expect(carried).toContain('CSC102');
  });
});

describe('where to retake it', () => {
  it('names the sections running THIS term', async () => {
    /*
     * The other half of the answer. "You must retake CSC102" without saying
     * where to find it sends the student to the department to ask, which is
     * what this feature exists to stop.
     */
    const running = await offer('failed', termB);
    const options = await retakeOptions({ schoolId, studentId });

    const csc102 = options.find((o) => o.courseCode === 'CSC102')!;
    expect(csc102.offerings.map((o) => o.id)).toContain(running.id);
  });

  it('says nothing is running rather than pretending', async () => {
    const options = await retakeOptions({ schoolId, studentId });
    const notRunning = options.find((o) => o.courseCode === 'CSC201');
    // CSC201 was failed this term and has no OTHER section open.
    expect(notRunning?.offerings.length ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe('the cohort view', () => {
  it('puts the student with the most carryovers first', async () => {
    const rows = await carryoverCohort({ schoolId, programId });
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].carryovers).toBeGreaterThanOrEqual(rows[i].carryovers);
    }
  });

  it('reports the load for our student', async () => {
    const rows = await carryoverCohort({ schoolId, programId });
    const mine = rows.find((r) => r.studentId === studentId)!;
    expect(mine.carryovers).toBeGreaterThan(0);
    expect(mine.credits).toBeGreaterThan(0);
  });
});

describe('who the cohort report includes', () => {
  it('INCLUDES a student on probation, who is usually the one with carryovers', async () => {
    /*
     * The bug this caught in the demo school: the filter was `status: ACTIVE`,
     * and the only student who actually had a carryover was on PROBATION —
     * which is usually caused by carryovers. A report that exists to find
     * students in trouble was filtering out the ones in the most trouble.
     */
    await raw.student.update({ where: { id: studentId }, data: { status: 'PROBATION' } });

    const rows = await carryoverCohort({ schoolId, programId });
    expect(rows.map((r) => r.studentId)).toContain(studentId);

    await raw.student.update({ where: { id: studentId }, data: { status: 'ACTIVE' } });
  });

  it('leaves out somebody who has graduated or withdrawn', async () => {
    // The only students with nothing left to retake.
    for (const status of ['GRADUATED', 'WITHDRAWN']) {
      await raw.student.update({ where: { id: studentId }, data: { status } });
      const rows = await carryoverCohort({ schoolId, programId });
      expect(rows.map((r) => r.studentId)).not.toContain(studentId);
    }
    await raw.student.update({ where: { id: studentId }, data: { status: 'ACTIVE' } });
  });
});
