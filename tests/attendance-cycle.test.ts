import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  attendanceForEnrolment,
  attendanceForOffering,
  loadRegister,
  saveRegister,
  sessionsForOffering,
} from '@/server/services/attendance.service';

/**
 * =============================================================================
 * THE REGISTER, AGAINST THE REAL DATABASE
 * =============================================================================
 *
 * The domain tests cover what attendance MEANS. These cover what the database
 * actually holds afterwards, which is where the silent failures live: a
 * register saved twice that appends instead of correcting, a lecturer marking
 * another lecturer's cohort, absences attached to a class that was cancelled.
 *
 * Every one of those produces a plausible-looking page and a wrong answer to
 * "may this student sit the examination".
 */

const raw = new PrismaClient();
const SUFFIX = `att-${Date.now()}`;

let schoolId = '';
let termId = '';
let offeringId = '';
let otherOfferingId = '';
let lecturerProfileId = '';
let otherLecturerProfileId = '';
let lecturerMembershipId = '';
let logDelivered = '';
let logCancelled = '';
let logSecond = '';
let logNoOffering = '';
let enrolA = '';
let enrolB = '';
let lateJoinerEnrolment = '';
let lateJoinerStudentId = '';
const userIds: string[] = [];
let ACTOR = '';

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `att-${SUFFIX}`,
      code: `A${Date.now() % 100000}`,
      name: 'Attendance Test University',
      shortName: 'ATU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;

  const term = await raw.term.create({
    data: {
      schoolId,
      code: `${SUFFIX}-T1`,
      name: 'First Semester',
      academicYear: '2026/2027',
      season: 'FALL',
      startDate: new Date('2026-09-15T12:00:00Z'),
      endDate: new Date('2026-12-20T12:00:00Z'),
      registrationOpensAt: new Date('2026-08-15T12:00:00Z'),
      registrationClosesAt: new Date('2026-09-30T12:00:00Z'),
      addDropDeadline: new Date('2026-10-15T12:00:00Z'),
      withdrawalDeadline: new Date('2026-11-15T12:00:00Z'),
      isCurrent: true,
    },
  });
  termId = term.id;

  const faculty = await raw.faculty.create({ data: { schoolId, code: 'SCI', name: 'Sciences' } });
  const department = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'CSC', name: 'Computer Science' },
  });
  const program = await raw.program.create({
    data: {
      schoolId,
      departmentId: department.id,
      code: 'BSC-CSC',
      name: 'BSc Computer Science',
      degreeType: 'BSC',
      durationTerms: 8,
    },
  });
  const course = await raw.course.create({
    data: {
      schoolId,
      code: 'CSC305',
      title: 'Operating Systems',
      creditHours: 3,
      departmentId: department.id,
    },
  });

  async function person(key: string) {
    const user = await raw.user.create({
      data: {
        email: `${key}-${SUFFIX}@example.test`,
        firstName: key,
        lastName: 'Test',
        passwordHash: 'fixture-account-that-never-authenticates',
      },
    });
    userIds.push(user.id);
    return user;
  }

  const lecturer = await person('lecturer');
  ACTOR = lecturer.id;
  lecturerProfileId = (
    await raw.instructor.create({
      data: {
        schoolId,
        userId: lecturer.id,
        staffNumber: `S-${SUFFIX}`,
        departmentId: department.id,
      },
    })
  ).id;
  lecturerMembershipId = (
    await raw.membership.create({
      data: { schoolId, userId: lecturer.id, role: 'INSTRUCTOR', status: 'ACTIVE' },
    })
  ).id;

  const other = await person('other-lecturer');
  otherLecturerProfileId = (
    await raw.instructor.create({
      data: { schoolId, userId: other.id, staffNumber: `S2-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  offeringId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId, section: 'A', instructorId: lecturerProfileId },
    })
  ).id;
  otherOfferingId = (
    await raw.courseOffering.create({
      data: {
        schoolId,
        courseId: course.id,
        termId,
        section: 'B',
        instructorId: otherLecturerProfileId,
      },
    })
  ).id;

  async function student(key: string, matric: string, offering: string) {
    const user = await person(key);
    const profile = await raw.student.create({
      data: { schoolId, userId: user.id, matricNumber: matric, programId: program.id, level: 300 },
    });
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId: profile.id, offeringId: offering, status: 'REGISTERED' },
    });
    return { profileId: profile.id, enrolmentId: enrolment.id };
  }

  enrolA = (await student('student-a', `M1-${SUFFIX}`, offeringId)).enrolmentId;
  enrolB = (await student('student-b', `M2-${SUFFIX}`, offeringId)).enrolmentId;

  async function log(localDate: string, status: string, offering: string | null) {
    return (
      await raw.teachingLog.create({
        data: {
          schoolId,
          membershipId: lecturerMembershipId,
          offeringId: offering,
          localDate,
          startMinute: 540,
          endMinute: 660,
          durationMinutes: 120,
          status,
        },
      })
    ).id;
  }

  logDelivered = await log('2026-10-01', 'DELIVERED', offeringId);
  logSecond = await log('2026-10-08', 'DELIVERED', offeringId);
  logCancelled = await log('2026-10-15', 'CANCELLED', offeringId);
  logNoOffering = await log('2026-10-22', 'DELIVERED', null);
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('opening a register', () => {
  it('lists the whole roster, everybody present, before anybody marks it', async () => {
    const view = await loadRegister({
      schoolId,
      teachingLogId: logDelivered,
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
    });

    expect(view).not.toBeNull();
    expect(view!.rows).toHaveLength(2);
    expect(view!.rows.every((r) => r.status === 'PRESENT')).toBe(true);
    expect(view!.alreadyTaken).toBe(false);
    expect(view!.acceptsRegister).toBe(true);
  });

  it('orders by matriculation number, the order the paper sheet is in', async () => {
    const view = await loadRegister({
      schoolId,
      teachingLogId: logDelivered,
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
    });
    const matrics = view!.rows.map((r) => r.matricNumber);
    expect(matrics).toEqual([...matrics].sort((a, b) => a!.localeCompare(b!, undefined, { numeric: true })));
  });

  it('REFUSES a lecturer who does not teach the section', async () => {
    // Null, not an error and not an empty roster: a refusal that confirms the
    // session exists tells somebody something they should not have.
    const view = await loadRegister({
      schoolId,
      teachingLogId: logDelivered,
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: otherLecturerProfileId,
    });
    expect(view).toBeNull();
  });

  it('admits the head of department without an instructor profile', async () => {
    const view = await loadRegister({
      schoolId,
      teachingLogId: logDelivered,
      actorRole: 'HOD',
      actorInstructorProfileId: null,
    });
    expect(view).not.toBeNull();
  });

  it('has no register for a session with no section', async () => {
    // A seminar or an induction. Nobody to mark, and that is not a fault.
    expect(
      await loadRegister({
        schoolId,
        teachingLogId: logNoOffering,
        actorRole: 'ADMIN',
      }),
    ).toBeNull();
  });

  it('marks a cancelled class as taking no register', async () => {
    const view = await loadRegister({
      schoolId,
      teachingLogId: logCancelled,
      actorRole: 'ADMIN',
    });
    expect(view!.acceptsRegister).toBe(false);
  });
});

describe('saving a register', () => {
  it('writes one row per student', async () => {
    const result = await saveRegister({
      schoolId,
      teachingLogId: logDelivered,
      marks: [
        { enrollmentId: enrolA, status: 'PRESENT' },
        { enrollmentId: enrolB, status: 'ABSENT' },
      ],
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(await raw.classAttendance.count({ where: { teachingLogId: logDelivered } })).toBe(2);
  });

  it('CORRECTS on a second save rather than appending a second opinion', async () => {
    /*
     * The bug this guards: two rows for one student in one session, and a
     * percentage computed over a denominator that grew every time somebody
     * pressed save.
     */
    await saveRegister({
      schoolId,
      teachingLogId: logDelivered,
      marks: [
        { enrollmentId: enrolA, status: 'PRESENT' },
        { enrollmentId: enrolB, status: 'LATE' },
      ],
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    expect(await raw.classAttendance.count({ where: { teachingLogId: logDelivered } })).toBe(2);
    const b = await raw.classAttendance.findFirstOrThrow({
      where: { teachingLogId: logDelivered, enrollmentId: enrolB },
    });
    expect(b.status).toBe('LATE');
  });

  it('REFUSES a register for a cancelled class', async () => {
    /*
     * Refused in the service, not merely hidden in the UI — a lecturer may
     * cancel a class AFTER opening the register, and a stale form would
     * otherwise post absences for a lecture that did not happen.
     */
    const result = await saveRegister({
      schoolId,
      teachingLogId: logCancelled,
      marks: [{ enrollmentId: enrolA, status: 'ABSENT' }],
      actorRole: 'ADMIN',
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not delivered/i);
    expect(await raw.classAttendance.count({ where: { teachingLogId: logCancelled } })).toBe(0);
  });

  it('REFUSES a lecturer who does not teach the section', async () => {
    const result = await saveRegister({
      schoolId,
      teachingLogId: logSecond,
      marks: [{ enrollmentId: enrolA, status: 'ABSENT' }],
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: otherLecturerProfileId,
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(await raw.classAttendance.count({ where: { teachingLogId: logSecond } })).toBe(0);
  });

  it('REFUSES a mark for somebody enrolled on a different section', async () => {
    const outsider = await raw.user.create({
      data: {
        email: `outsider-${SUFFIX}@example.test`,
        firstName: 'Outsider',
        lastName: 'Test',
        passwordHash: 'fixture-account-that-never-authenticates',
      },
    });
    userIds.push(outsider.id);
    const profile = await raw.student.create({
      data: {
        schoolId,
        userId: outsider.id,
        matricNumber: `M9-${SUFFIX}`,
        programId: (await raw.program.findFirstOrThrow({ where: { schoolId } })).id,
        level: 300,
      },
    });
    const foreign = await raw.enrollment.create({
      data: { schoolId, studentId: profile.id, offeringId: otherOfferingId, status: 'REGISTERED' },
    });

    const result = await saveRegister({
      schoolId,
      teachingLogId: logSecond,
      marks: [{ enrollmentId: foreign.id, status: 'PRESENT' }],
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not on this course/i);
  });
});

describe('a student who registers after the register was taken', () => {
  it('appears on it rather than being invisible forever', async () => {
    const user = await raw.user.create({
      data: {
        email: `latecomer-${SUFFIX}@example.test`,
        firstName: 'Late',
        lastName: 'Joiner',
        passwordHash: 'fixture-account-that-never-authenticates',
      },
    });
    userIds.push(user.id);
    const profile = await raw.student.create({
      data: {
        schoolId,
        userId: user.id,
        matricNumber: `M3-${SUFFIX}`,
        programId: (await raw.program.findFirstOrThrow({ where: { schoolId } })).id,
        level: 300,
      },
    });
    lateJoinerStudentId = profile.id;
    lateJoinerEnrolment = (
      await raw.enrollment.create({
        data: { schoolId, studentId: profile.id, offeringId, status: 'REGISTERED' },
      })
    ).id;

    // The register for logDelivered was saved before this enrolment existed.
    const view = await loadRegister({
      schoolId,
      teachingLogId: logDelivered,
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
    });

    const row = view!.rows.find((r) => r.enrollmentId === lateJoinerEnrolment);
    expect(row).toBeDefined();
    expect(row!.status).toBe('PRESENT');
    // And the marks already saved are untouched.
    expect(view!.rows.find((r) => r.enrollmentId === enrolB)!.status).toBe('LATE');
  });
});

describe('reading attendance back', () => {
  it('counts only sessions that were actually delivered', async () => {
    /*
     * There is a CANCELLED log on this section. If it ever contributed a
     * denominator, every student's percentage would drop for a class that did
     * not happen.
     */
    const report = await attendanceForOffering({ schoolId, offeringId });
    expect(report.sessionsHeld).toBe(2); // logDelivered + logSecond, not the cancelled one
    expect(report.sessionsMarked).toBe(1); // only logDelivered has marks
  });

  it('puts the students in trouble first, and UNKNOWN last', async () => {
    const report = await attendanceForOffering({ schoolId, offeringId });
    const known = report.students.filter((s) => s.percentage !== null);
    const unknown = report.students.filter((s) => s.percentage === null);

    // Ascending by percentage among those with a record...
    for (let i = 1; i < known.length; i += 1) {
      expect(known[i].percentage!).toBeGreaterThanOrEqual(known[i - 1].percentage!);
    }
    // ...and everybody without one sorted below them.
    if (unknown.length > 0 && known.length > 0) {
      expect(report.students.indexOf(unknown[0])).toBeGreaterThan(
        report.students.indexOf(known[known.length - 1]),
      );
    }
  });

  it('gives the late joiner UNKNOWN, not 0%', async () => {
    const report = await attendanceForOffering({ schoolId, offeringId });
    const late = report.students.find((s) => s.enrollmentId === lateJoinerEnrolment);
    expect(late!.percentage).toBeNull();
    expect(late!.verdict).toBe('UNKNOWN');
  });

  it('agrees with the per-student read', async () => {
    const report = await attendanceForOffering({ schoolId, offeringId });
    const fromList = report.students.find((s) => s.enrollmentId === enrolB)!;
    const direct = await attendanceForEnrolment({ schoolId, enrollmentId: enrolB });

    expect(direct.attended).toBe(fromList.attended);
    expect(direct.missed).toBe(fromList.missed);
    expect(direct.percentage).toBe(fromList.percentage);
  });

  it('never bars anybody while the rule is off', async () => {
    const report = await attendanceForOffering({ schoolId, offeringId });
    expect(report.students.every((s) => s.verdict !== 'BARRED')).toBe(true);
  });

  it('bars only once a school turns the rule on', async () => {
    await saveRegister({
      schoolId,
      teachingLogId: logSecond,
      marks: [
        { enrollmentId: enrolA, status: 'ABSENT' },
        { enrollmentId: enrolB, status: 'ABSENT' },
      ],
      actorRole: 'INSTRUCTOR',
      actorInstructorProfileId: lecturerProfileId,
      actorMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });

    const enforced = {
      examEligibilityThreshold: 75,
      warningThreshold: 80,
      enforced: true,
    };
    const report = await attendanceForOffering({ schoolId, offeringId, policy: enforced });

    // enrolB: LATE then ABSENT = 1 of 2 = 50%.
    const b = report.students.find((s) => s.enrollmentId === enrolB)!;
    expect(b.percentage).toBe(50);
    expect(b.verdict).toBe('BARRED');

    // The late joiner still has no record, and no record is not a bar.
    const late = report.students.find((s) => s.enrollmentId === lateJoinerEnrolment)!;
    expect(late.verdict).toBe('UNKNOWN');
  });
});

describe('the session list a lecturer works from', () => {
  it('shows cancelled sessions and unmarked ones rather than hiding them', async () => {
    /*
     * A gap a lecturer can see is a gap they can close. A percentage computed
     * over the sessions somebody remembered to mark is only honest if the ones
     * they did not are visible beside it.
     */
    const sessions = await sessionsForOffering({ schoolId, offeringId });
    expect(sessions).toHaveLength(3);

    const cancelled = sessions.find((s) => s.teachingLogId === logCancelled)!;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.markedCount).toBe(0);

    const marked = sessions.find((s) => s.teachingLogId === logDelivered)!;
    expect(marked.markedCount).toBeGreaterThan(0);
  });

  it('is newest first', async () => {
    const sessions = await sessionsForOffering({ schoolId, offeringId });
    const dates = sessions.map((s) => s.localDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe('tenancy', () => {
  it('does not reach another school with a crafted id', async () => {
    const other = await raw.school.create({
      data: {
        slug: `att-other-${SUFFIX}`,
        code: `B${Date.now() % 100000}`,
        name: 'Another University',
        shortName: 'AU',
        timezone: 'UTC',
      },
    });

    try {
      // A real, valid teaching-log id — belonging to a different school.
      const view = await loadRegister({
        schoolId: other.id,
        teachingLogId: logDelivered,
        actorRole: 'ADMIN',
      });
      expect(view).toBeNull();

      const result = await saveRegister({
        schoolId: other.id,
        teachingLogId: logDelivered,
        marks: [{ enrollmentId: enrolA, status: 'ABSENT' }],
        actorRole: 'ADMIN',
        actorMembershipId: lecturerMembershipId,
        actorUserId: ACTOR,
      });
      expect(result.ok).toBe(false);
    } finally {
      await raw.school.deleteMany({ where: { id: other.id } });
    }
  });
});
