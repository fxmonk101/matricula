import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  latestSubmission,
  loadCourseworkForStudent,
  mayReadSubmission,
  saveCoursework,
  submissionHistory,
  submitCoursework,
} from '@/server/services/coursework.service';
import { ensureSpaceForOffering, saveModule, setItemPublished, setModulePublished } from '@/server/services/lms.service';
import { __setStorageDriver, type StorageDriver } from '@/server/storage';

/**
 * =============================================================================
 * HANDING WORK IN
 * =============================================================================
 *
 * Against the real database. The assertions that matter are about who can read
 * a piece of assessed work and whether a marked attempt can be quietly
 * replaced — both of which are questions about rows, and a mock would answer
 * them however this file asked it to.
 */

const raw = new PrismaClient();
const SUFFIX = `cw-${Date.now()}`;

let schoolId = '';
let courseworkId = '';
let moduleId = '';
let itemId = '';
let enrolmentId = '';
let studentUserId = '';
let otherStudentUserId = '';
let lecturerUserId = '';
let otherLecturerUserId = '';
let ACTOR = '';
const userIds: string[] = [];

/** An in-memory store, so the test never touches the filesystem. */
const stored = new Map<string, { body: Uint8Array; mediaType: string }>();
const memoryDriver: StorageDriver = {
  async put({ key, body, mediaType }) {
    stored.set(key, { body, mediaType });
  },
  async get(key) {
    return stored.get(key) ?? null;
  },
  async delete(key) {
    stored.delete(key);
  },
};

/** A minimal ZIP container — what a .docx actually looks like at the front. */
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

function fileOf(name: string, bytes: Uint8Array): File {
  // Copied into its own ArrayBuffer: a Uint8Array over a SharedArrayBuffer is
  // not a BlobPart, and the view TextEncoder hands back is not guaranteed to be
  // backed by a plain one.
  return new File([bytes.slice().buffer as ArrayBuffer], name);
}

beforeAll(async () => {
  __setStorageDriver(memoryDriver);

  const school = await raw.school.create({
    data: {
      slug: `cw-${SUFFIX}`,
      code: `C${Date.now() % 100000}`,
      name: 'Coursework Test University',
      shortName: 'CTU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;

  const term = await raw.term.create({
    data: {
      schoolId,
      code: `${SUFFIX}-T`,
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
  const dept = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'CSC', name: 'Computer Science' },
  });
  const program = await raw.program.create({
    data: { schoolId, departmentId: dept.id, code: 'BSC', name: 'BSc', degreeType: 'BSC', durationTerms: 8 },
  });
  const course = await raw.course.create({
    data: { schoolId, code: 'CSC301', title: 'Algorithms', creditHours: 3, departmentId: dept.id },
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
  lecturerUserId = lecturer.id;
  ACTOR = lecturer.id;
  const instructor = await raw.instructor.create({
    data: { schoolId, userId: lecturer.id, staffNumber: `S-${SUFFIX}`, departmentId: dept.id },
  });

  const otherLecturer = await person('other-lecturer');
  otherLecturerUserId = otherLecturer.id;
  await raw.instructor.create({
    data: { schoolId, userId: otherLecturer.id, staffNumber: `S2-${SUFFIX}`, departmentId: dept.id },
  });

  const offering = await raw.courseOffering.create({
    data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: instructor.id },
  });

  const student = await person('student');
  studentUserId = student.id;
  const studentProfile = await raw.student.create({
    data: { schoolId, userId: student.id, matricNumber: `M-${SUFFIX}`, programId: program.id, level: 300 },
  });
  enrolmentId = (
    await raw.enrollment.create({
      data: { schoolId, studentId: studentProfile.id, offeringId: offering.id, status: 'REGISTERED' },
    })
  ).id;

  const other = await person('other-student');
  otherStudentUserId = other.id;
  await raw.student.create({
    data: { schoolId, userId: other.id, matricNumber: `M2-${SUFFIX}`, programId: program.id, level: 300 },
  });

  // A published module with a published assignment in it.
  const space = await ensureSpaceForOffering({ schoolId, offeringId: offering.id });
  const module = await saveModule({ schoolId, spaceId: space.spaceId!, title: 'Week 1', actorUserId: ACTOR });
  moduleId = module.id!;

  const work = await saveCoursework({
    schoolId,
    moduleId,
    title: 'Problem set 1',
    instructions: 'Answer all questions.',
    pointsPossible: 50,
    dueAt: new Date('2099-01-01T00:00:00Z'),
    allowsText: true,
    allowsFile: true,
    acceptsLate: true,
    actorUserId: ACTOR,
  });
  itemId = work.id!;

  await setModulePublished({ schoolId, moduleId, isPublished: true, actorUserId: ACTOR });
  await setItemPublished({ schoolId, itemId, isPublished: true, actorUserId: ACTOR });

  courseworkId = (await raw.coursework.findFirstOrThrow({ where: { moduleItemId: itemId } })).id;
});

afterAll(async () => {
  __setStorageDriver(null);
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('setting work', () => {
  it('creates the item and the coursework together', async () => {
    const item = await raw.moduleItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { coursework: true },
    });
    expect(item.kind).toBe('COURSEWORK');
    // Half a creation — an item a student can see and cannot submit to — is
    // worse than none, so they are written in one transaction.
    expect(item.coursework).not.toBeNull();
    expect(item.coursework!.pointsPossible).toBe(50);
  });

  it('refuses work nobody could hand anything in to', async () => {
    const result = await saveCoursework({
      schoolId,
      moduleId,
      title: 'Impossible',
      pointsPossible: 10,
      allowsText: false,
      allowsFile: false,
      acceptsLate: true,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
  });
});

describe('a student hands work in', () => {
  it('accepts a typed answer', async () => {
    const result = await submitCoursework({
      schoolId,
      courseworkId,
      enrollmentId: enrolmentId,
      textBody: 'My first answer.',
      actorUserId: studentUserId,
    });
    expect(result.ok).toBe(true);
    expect(result.attempt).toBe(1);
  });

  it('accepts a .docx, which cannot be re-encoded and is stored as it arrived', async () => {
    const result = await submitCoursework({
      schoolId,
      courseworkId,
      enrollmentId: enrolmentId,
      file: fileOf('essay.docx', DOCX),
      actorUserId: studentUserId,
    });
    expect(result.ok).toBe(true);

    const latest = await latestSubmission({ schoolId, courseworkId, enrollmentId: enrolmentId });
    expect(latest!.fileKey).toMatch(/^private\//);
    expect(latest!.fileKey).toContain('/submission/');
    expect(latest!.fileName).toBe('essay.docx');
    expect(stored.has(latest!.fileKey!)).toBe(true);
  });

  it('refuses a file that is not what it claims to be', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const result = await submitCoursework({
      schoolId,
      courseworkId,
      enrollmentId: enrolmentId,
      file: fileOf('essay.docx', html),
      actorUserId: studentUserId,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an empty hand-in', async () => {
    const result = await submitCoursework({
      schoolId,
      courseworkId,
      enrollmentId: enrolmentId,
      textBody: '   ',
      actorUserId: studentUserId,
    });
    expect(result.ok).toBe(false);
  });

  it('makes every hand-in a NEW ATTEMPT rather than an overwrite', async () => {
    /*
     * Work that can be silently replaced after it was marked is not evidence of
     * anything, and a question about what was submitted, and when, has to stay
     * answerable.
     */
    const history = await submissionHistory({ schoolId, courseworkId, enrollmentId: enrolmentId });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].attempt).toBeGreaterThan(history[1].attempt);
    // Newest first, and the earlier text still there.
    expect(history.at(-1)!.textBody).toBe('My first answer.');
  });

  it('REFUSES a submission to an unpublished assignment', async () => {
    await setItemPublished({ schoolId, itemId, isPublished: false, actorUserId: ACTOR });

    const result = await submitCoursework({
      schoolId,
      courseworkId,
      enrollmentId: enrolmentId,
      textBody: 'Sneaking in.',
      actorUserId: studentUserId,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not open/);

    await setItemPublished({ schoolId, itemId, isPublished: true, actorUserId: ACTOR });
  });

  it('does not return an unpublished assignment to a student at all', async () => {
    await setModulePublished({ schoolId, moduleId, isPublished: false, actorUserId: ACTOR });
    expect(await loadCourseworkForStudent({ schoolId, courseworkId })).toBeNull();
    await setModulePublished({ schoolId, moduleId, isPublished: true, actorUserId: ACTOR });
  });
});

describe('WHO MAY READ A SUBMITTED FILE', () => {
  /*
   * The gap this stage exists to close. The generic /files route authorises by
   * session and tenant, which would let every signed-in member of the school
   * read any submission whose key they learned.
   */
  let submissionId = '';

  beforeAll(async () => {
    const latest = await latestSubmission({ schoolId, courseworkId, enrollmentId: enrolmentId });
    const withFile = await raw.submission.findFirstOrThrow({
      where: { courseworkId, enrollmentId: enrolmentId, fileKey: { not: null } },
      orderBy: { attempt: 'desc' },
    });
    submissionId = withFile.id;
    expect(latest).not.toBeNull();
  });

  it('admits its author', async () => {
    expect(
      await mayReadSubmission({ schoolId, submissionId, userId: studentUserId, role: 'STUDENT' }),
    ).toBe(true);
  });

  it('REFUSES another student on the same course', async () => {
    expect(
      await mayReadSubmission({
        schoolId,
        submissionId,
        userId: otherStudentUserId,
        role: 'STUDENT',
      }),
    ).toBe(false);
  });

  it('admits the lecturer of record', async () => {
    expect(
      await mayReadSubmission({
        schoolId,
        submissionId,
        userId: lecturerUserId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(true);
  });

  it('REFUSES a lecturer who does not teach this section', async () => {
    expect(
      await mayReadSubmission({
        schoolId,
        submissionId,
        userId: otherLecturerUserId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(false);
  });

  it('admits the office, who can already override any grade', async () => {
    for (const role of ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'OWNER']) {
      expect(
        await mayReadSubmission({ schoolId, submissionId, userId: otherStudentUserId, role }),
        role,
      ).toBe(true);
    }
  });

  it('refuses a submission id that does not exist', async () => {
    expect(
      await mayReadSubmission({
        schoolId,
        submissionId: 'not-a-real-id',
        userId: lecturerUserId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(false);
  });
});

describe('the mark scheme once work is in', () => {
  it('REFUSES to change the marks available after submissions exist', async () => {
    /*
     * Changing pointsPossible silently rescales every mark already given: 8/10
     * becomes 8/20 without anybody editing a mark.
     */
    const result = await saveCoursework({
      schoolId,
      moduleId,
      itemId,
      title: 'Problem set 1',
      pointsPossible: 100,
      allowsText: true,
      allowsFile: true,
      acceptsLate: true,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/rescale/);
  });

  it('still allows the title, instructions and deadline to be corrected', async () => {
    // Fixing a typo in a question mid-assignment is normal and necessary.
    const result = await saveCoursework({
      schoolId,
      moduleId,
      itemId,
      title: 'Problem set 1 (corrected)',
      instructions: 'Answer questions 1 to 4 — question 5 was a typo.',
      pointsPossible: 50,
      dueAt: new Date('2099-06-01T00:00:00Z'),
      allowsText: true,
      allowsFile: true,
      acceptsLate: true,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);

    const item = await raw.moduleItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.title).toBe('Problem set 1 (corrected)');
  });
});
