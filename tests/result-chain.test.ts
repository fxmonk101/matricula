import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { DEFAULT_RESULT_WORKFLOW } from '@/lib/domain/result-workflow';
import { buildTranscript } from '@/server/academics';
import { submitGrade } from '@/server/services/gpa.service';
import {
  approveResults,
  returnResults,
  sheetFor,
  sheetsAwaiting,
  submitResults,
} from '@/server/services/result-workflow.service';

/**
 * =============================================================================
 * A MARK BECOMING A RESULT, AGAINST THE REAL DATABASE
 * =============================================================================
 *
 * The chain exists so that no single account can turn a typo into a degree
 * classification. Most of what follows therefore checks that something did NOT
 * happen — a mark that is not on a transcript, an approval an administrator
 * could not give, a CGPA that has not moved — because those are the failures
 * that leave no trace.
 */

const raw = new PrismaClient();
const SUFFIX = `chain-${Date.now()}`;

let schoolId = '';
let offeringId = '';
let lecturerProfileId = '';
let studentId = '';
let enrolmentId = '';
let ACTOR = '';

const member: Record<string, string> = {};
const userIds: string[] = [];

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `chain-${SUFFIX}`,
      code: `C${Date.now() % 100000}`,
      name: 'Result Chain University',
      shortName: 'RCU',
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
    data: { schoolId, code: 'CSC501', title: 'Results', creditHours: 3, departmentId: department.id },
  });

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
    member[role] = m.id;
    return user;
  }

  const lecturer = await person('lecturer', 'INSTRUCTOR');
  ACTOR = lecturer.id;
  lecturerProfileId = (
    await raw.instructor.create({
      data: { schoolId, userId: lecturer.id, staffNumber: `S-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  await person('hod', 'HOD');
  await person('dean', 'DEAN');
  await person('registrar', 'REGISTRAR');
  await person('admin', 'ADMIN');

  offeringId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: lecturerProfileId },
    })
  ).id;

  const studentUser = await person('student', 'STUDENT');
  studentId = (
    await raw.student.create({
      data: { schoolId, userId: studentUser.id, matricNumber: `M-${SUFFIX}`, programId: program.id, level: 500 },
    })
  ).id;
  enrolmentId = (
    await raw.enrollment.create({
      data: { schoolId, studentId, offeringId, status: 'REGISTERED' },
    })
  ).id;
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

const actor = (role: string) => ({
  role: role as never,
  membershipId: member[role],
  userId: ACTOR,
  instructorProfileId: role === 'INSTRUCTOR' ? lecturerProfileId : null,
});

const policy = DEFAULT_RESULT_WORKFLOW;

describe('entering a mark', () => {
  it('does NOT put it on the academic record', async () => {
    /*
     * The inversion this whole feature is. Before it, this same call set the
     * enrolment COMPLETED, recomputed the CGPA and put the grade on the
     * transcript — so a typo in week six was a published classification.
     */
    const recorded = await submitGrade({
      schoolId,
      enrollmentId: enrolmentId,
      caScore: 30,
      examScore: 55,
      actorId: ACTOR,
    });
    expect(recorded.ok).toBe(true);

    const enrolment = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolmentId } });
    expect(enrolment.totalScore).toBe(85);
    expect(enrolment.letterGrade).not.toBeNull();
    // The mark is there. The STATUS is not.
    expect(enrolment.status).toBe('REGISTERED');
  });

  it('keeps it off the transcript and out of the CGPA', async () => {
    const transcript = await buildTranscript(schoolId, studentId);
    const rows = (transcript?.terms ?? []).flatMap((t) => t.rows);
    expect(rows).toHaveLength(0);

    const student = await raw.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.cgpa ?? 0).toBe(0);
  });
});

describe('the chain', () => {
  it('refuses a sheet nobody has submitted', async () => {
    const early = await approveResults({ schoolId, offeringId, policy, actor: actor('HOD') });
    expect(early.ok).toBe(false);
  });

  it('lets the lecturer submit', async () => {
    const submitted = await submitResults({ schoolId, offeringId, policy, actor: actor('INSTRUCTOR') });
    expect(submitted.ok).toBe(true);
    expect(submitted.stage).toBe('HOD_REVIEW');
  });

  it('REFUSES an administrator trying to wave it through', async () => {
    /*
     * The property the chain rests on. An ADMIN can already do almost
     * everything here; if they could approve, every other rule would be
     * decorative.
     */
    const waved = await approveResults({ schoolId, offeringId, policy, actor: actor('ADMIN') });
    expect(waved.ok).toBe(false);
    expect(waved.message).toMatch(/not waiting on you/);
    expect((await sheetFor({ schoolId, offeringId }))!.stage).toBe('HOD_REVIEW');
  });

  it('refuses an office acting out of turn', async () => {
    // The registrar carries Senate, but Senate is two stages away.
    const early = await approveResults({ schoolId, offeringId, policy, actor: actor('REGISTRAR') });
    expect(early.ok).toBe(false);
  });

  it('shows up in the right office’s queue, and only theirs', async () => {
    const hodQueue = await sheetsAwaiting({ schoolId, role: 'HOD' as never });
    const deanQueue = await sheetsAwaiting({ schoolId, role: 'DEAN' as never });

    expect(hodQueue.map((s) => s.offeringId)).toContain(offeringId);
    expect(deanQueue.map((s) => s.offeringId)).not.toContain(offeringId);
  });

  it('can be sent back, with a reason, and the lecturer is told what to fix', async () => {
    const returned = await returnResults({
      schoolId,
      offeringId,
      reason: 'The spread looks wrong — nobody scored below 70.',
      actor: actor('HOD'),
    });
    expect(returned.ok).toBe(true);

    const sheet = await sheetFor({ schoolId, offeringId });
    expect(sheet!.stage).toBe('DRAFT');
    expect(sheet!.returnedReason).toMatch(/spread looks wrong/);
  });

  it('refuses to send it back with no reason', async () => {
    // A sheet returned blank is a lecturer guessing at what to change.
    await submitResults({ schoolId, offeringId, policy, actor: actor('INSTRUCTOR') });
    const blank = await returnResults({ schoolId, offeringId, reason: '   ', actor: actor('HOD') });
    expect(blank.ok).toBe(false);
  });

  it('walks HOD, then faculty, then Senate', async () => {
    const hod = await approveResults({ schoolId, offeringId, policy, actor: actor('HOD') });
    expect(hod.stage).toBe('FACULTY_REVIEW');

    const dean = await approveResults({ schoolId, offeringId, policy, actor: actor('DEAN') });
    expect(dean.stage).toBe('SENATE_REVIEW');

    // Still not on the record.
    const before = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolmentId } });
    expect(before.status).toBe('REGISTERED');

    const senate = await approveResults({ schoolId, offeringId, policy, actor: actor('REGISTRAR') });
    expect(senate.ok).toBe(true);
    expect(senate.stage).toBe('RELEASED');
  });
});

describe('release', () => {
  it('puts the mark on the record and moves the CGPA', async () => {
    const enrolment = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolmentId } });
    expect(enrolment.status).toBe('COMPLETED');

    const transcript = await buildTranscript(schoolId, studentId);
    const rows = (transcript?.terms ?? []).flatMap((t) => t.rows);
    expect(rows).toHaveLength(1);

    const student = await raw.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.cgpa).toBeGreaterThan(0);
  });

  it('closes the section', async () => {
    const offering = await raw.courseOffering.findUniqueOrThrow({ where: { id: offeringId } });
    expect(offering.gradesPosted).toBe(true);
    expect(offering.status).toBe('CLOSED');
  });

  it('KEEPS EVERY DECISION, including the one that sent it back', async () => {
    /*
     * "The HOD queried this before it was approved" is exactly what somebody
     * needs months later when a mark is disputed, and a status column alone
     * cannot answer it.
     */
    const sheet = await sheetFor({ schoolId, offeringId });
    const decisions = sheet!.steps.map((s) => s.decision);

    expect(decisions).toContain('SUBMITTED');
    expect(decisions).toContain('RETURNED');
    expect(decisions).toContain('APPROVED');
    expect(decisions).toContain('RELEASED');

    // Two submissions, because it was sent back once.
    expect(decisions.filter((d) => d === 'SUBMITTED')).toHaveLength(2);

    const returned = sheet!.steps.find((s) => s.decision === 'RETURNED')!;
    expect(returned.by).toMatch(/hod/i);
    expect(returned.note).toMatch(/spread looks wrong/);
  });

  it('leaves nobody waiting on it', async () => {
    for (const role of ['HOD', 'DEAN', 'REGISTRAR']) {
      const queue = await sheetsAwaiting({ schoolId, role: role as never });
      expect(queue.map((s) => s.offeringId)).not.toContain(offeringId);
    }
  });
});

describe('a school that uses no chain at all', () => {
  it('releases on submission, which is what it asked for', async () => {
    const course = await raw.course.create({
      data: {
        schoolId,
        code: 'CSC502',
        title: 'Straight through',
        creditHours: 3,
        departmentId: (await raw.department.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });
    const term = await raw.term.findFirstOrThrow({ where: { schoolId } });
    const quick = await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: lecturerProfileId },
    });
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId, offeringId: quick.id, status: 'REGISTERED' },
    });
    await submitGrade({
      schoolId,
      enrollmentId: enrolment.id,
      caScore: 25,
      examScore: 40,
      actorId: ACTOR,
    });

    const none = { requireHod: false, requireFaculty: false, requireSenate: false };
    const submitted = await submitResults({
      schoolId,
      offeringId: quick.id,
      policy: none,
      actor: actor('INSTRUCTOR'),
    });

    expect(submitted.ok).toBe(true);
    expect(submitted.stage).toBe('RELEASED');

    const after = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolment.id } });
    expect(after.status).toBe('COMPLETED');
  });
});

describe('who may submit', () => {
  it('refuses a lecturer submitting somebody else’s section', async () => {
    const other = await raw.instructor.create({
      data: {
        schoolId,
        userId: (
          await raw.user.findFirstOrThrow({ where: { email: `hod-${SUFFIX}@example.test` } })
        ).id,
        staffNumber: `S9-${SUFFIX}`,
        departmentId: (await raw.department.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });

    const course = await raw.course.create({
      data: {
        schoolId,
        code: 'CSC503',
        title: 'Not yours',
        creditHours: 3,
        departmentId: (await raw.department.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });
    const term = await raw.term.findFirstOrThrow({ where: { schoolId } });
    const foreign = await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: other.id },
    });

    const refused = await submitResults({
      schoolId,
      offeringId: foreign.id,
      policy,
      actor: actor('INSTRUCTOR'),
    });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/not the lecturer of record/);
  });

  it('refuses a partly marked sheet', async () => {
    const course = await raw.course.create({
      data: {
        schoolId,
        code: 'CSC504',
        title: 'Half marked',
        creditHours: 3,
        departmentId: (await raw.department.findFirstOrThrow({ where: { schoolId } })).id,
      },
    });
    const term = await raw.term.findFirstOrThrow({ where: { schoolId } });
    const partial = await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: lecturerProfileId },
    });
    await raw.enrollment.create({
      data: { schoolId, studentId, offeringId: partial.id, status: 'REGISTERED' },
    });

    const refused = await submitResults({
      schoolId,
      offeringId: partial.id,
      policy,
      actor: actor('INSTRUCTOR'),
    });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/no mark yet/);
  });
});
