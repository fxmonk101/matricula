import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  deleteItem,
  ensureSpaceForOffering,
  enrolmentFor,
  loadSpaceForStudent,
  loadSpaceForTeacher,
  mayAuthorOffering,
  moveModule,
  saveItem,
  saveModule,
  setItemPublished,
  setModulePublished,
} from '@/server/services/lms.service';

/**
 * =============================================================================
 * WHAT REACHES A STUDENT
 * =============================================================================
 *
 * Against the real database, because the assertions that matter are about what
 * a query RETURNS, and a mock would return whatever this file told it to.
 *
 * Most of these are negative. An unpublished module is a lecturer's draft —
 * next week's reading, an exam being assembled — and "absent from the payload"
 * is a different guarantee from "not rendered". Only the first survives somebody
 * opening the network tab.
 */

const raw = new PrismaClient();
const SUFFIX = `lms-${Date.now()}`;

let schoolId = '';
let termId = '';
let offeringId = '';
let otherOfferingId = '';
let lecturerProfileId = '';
let otherLecturerProfileId = '';
let enrolledStudentId = '';
let outsiderStudentId = '';
let spaceId = '';
const userIds: string[] = [];

/*
 * A REAL user id. recordAudit writes a row with an actor foreign key and
 * swallows its own failures by design, so a made-up id still passes every
 * assertion — while filling the run with stack traces that look like faults.
 */
let ACTOR = '';

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `lms-${SUFFIX}`,
      code: `L${Date.now() % 100000}`,
      name: 'LMS Test University',
      shortName: 'LTU',
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
    data: { schoolId, code: 'CSC301', title: 'Algorithms', creditHours: 3, departmentId: department.id },
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
      data: { schoolId, userId: lecturer.id, staffNumber: `S-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  const otherLecturer = await person('other-lecturer');
  otherLecturerProfileId = (
    await raw.instructor.create({
      data: { schoolId, userId: otherLecturer.id, staffNumber: `S2-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  offeringId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId, section: 'A', instructorId: lecturerProfileId },
    })
  ).id;

  otherOfferingId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId, section: 'B', instructorId: otherLecturerProfileId },
    })
  ).id;

  const enrolled = await person('enrolled');
  enrolledStudentId = (
    await raw.student.create({
      data: { schoolId, userId: enrolled.id, matricNumber: `M1-${SUFFIX}`, programId: program.id, level: 300 },
    })
  ).id;
  await raw.enrollment.create({
    data: { schoolId, studentId: enrolledStudentId, offeringId, status: 'REGISTERED' },
  });

  const outsider = await person('outsider');
  outsiderStudentId = (
    await raw.student.create({
      data: { schoolId, userId: outsider.id, matricNumber: `M2-${SUFFIX}`, programId: program.id, level: 300 },
    })
  ).id;
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('the course container', () => {
  it('is created once and found thereafter', async () => {
    const first = await ensureSpaceForOffering({ schoolId, offeringId });
    expect(first.ok).toBe(true);
    spaceId = first.spaceId!;

    const second = await ensureSpaceForOffering({ schoolId, offeringId });
    expect(second.spaceId).toBe(spaceId);

    expect(await raw.courseSpace.count({ where: { offeringId } })).toBe(1);
  });

  it('holds EXACTLY ONE owner — the offering, and not a subject assignment', async () => {
    // The invariant the schema cannot express portably, asserted here instead.
    const space = await raw.courseSpace.findUniqueOrThrow({ where: { id: spaceId } });
    expect(space.offeringId).toBe(offeringId);
    expect(space.subjectAssignmentId).toBeNull();
    expect(space.termId).toBe(termId);
  });

  it('refuses an offering that is not in this school', async () => {
    const result = await ensureSpaceForOffering({ schoolId, offeringId: 'not-a-real-id' });
    expect(result.ok).toBe(false);
  });
});

describe('who may author a course', () => {
  it('admits the lecturer of record', async () => {
    expect(
      await mayAuthorOffering({
        schoolId,
        offeringId,
        instructorProfileId: lecturerProfileId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(true);
  });

  it('REFUSES a lecturer who teaches a different section', async () => {
    /*
     * The route guard admits every instructor. This is the check that stops one
     * lecturer editing a colleague's course by changing an id in a form.
     */
    expect(
      await mayAuthorOffering({
        schoolId,
        offeringId,
        instructorProfileId: otherLecturerProfileId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(false);
  });

  it('admits the faculty office, who oversee every course', async () => {
    for (const role of ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'OWNER']) {
      expect(
        await mayAuthorOffering({ schoolId, offeringId, instructorProfileId: null, role }),
        role,
      ).toBe(true);
    }
  });
});

describe('building a course', () => {
  let moduleId = '';
  let pageItemId = '';

  it('creates a module as a DRAFT', async () => {
    const result = await saveModule({
      schoolId,
      spaceId,
      title: 'Week 1 — Foundations',
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    moduleId = result.id!;

    const module = await raw.courseModule.findUniqueOrThrow({ where: { id: moduleId } });
    // Nothing reaches a class by accident.
    expect(module.isPublished).toBe(false);
  });

  it('refuses a module with no title', async () => {
    const result = await saveModule({ schoolId, spaceId, title: '  ', actorUserId: ACTOR });
    expect(result.ok).toBe(false);
  });

  it('adds an item as a draft too', async () => {
    const result = await saveItem({
      schoolId,
      moduleId,
      kind: 'PAGE',
      title: 'Reading: chapter 3',
      bodyMarkdown: 'Read chapter 3 before the lecture.',
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    pageItemId = result.id!;

    const item = await raw.moduleItem.findUniqueOrThrow({ where: { id: pageItemId } });
    expect(item.isPublished).toBe(false);
    expect(item.kind).toBe('PAGE');
  });

  it('REFUSES a javascript: link', async () => {
    const result = await saveItem({
      schoolId,
      moduleId,
      kind: 'LINK',
      title: 'Nasty',
      externalUrl: 'javascript:alert(1)',
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/http and https/);
  });

  it('nulls the fields of the other kinds when saving', async () => {
    // Otherwise changing a page to a link leaves the old body in every payload,
    // invisible on screen and still on the wire.
    const link = await saveItem({
      schoolId,
      moduleId,
      kind: 'LINK',
      title: 'Lecture slides',
      externalUrl: 'https://example.edu/slides',
      bodyMarkdown: 'this should not be stored',
      actorUserId: ACTOR,
    });
    const item = await raw.moduleItem.findUniqueOrThrow({ where: { id: link.id! } });
    expect(item.bodyMarkdown).toBeNull();
    expect(item.externalUrl).toBe('https://example.edu/slides');
  });

  it('will not let an item change kind once it exists', async () => {
    const result = await saveItem({
      schoolId,
      moduleId,
      itemId: pageItemId,
      kind: 'LINK',
      title: 'Reading: chapter 3',
      externalUrl: 'https://example.edu',
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot change kind/);
  });

  it('keeps modules in order, with gaps', async () => {
    const second = await saveModule({ schoolId, spaceId, title: 'Week 2', actorUserId: ACTOR });
    const third = await saveModule({ schoolId, spaceId, title: 'Week 3', actorUserId: ACTOR });

    const before = await raw.courseModule.findMany({
      where: { spaceId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    expect(before.map((m) => m.id)).toEqual([moduleId, second.id, third.id]);

    await moveModule({ schoolId, spaceId, moduleId: third.id!, toIndex: 0, actorUserId: ACTOR });

    const after = await raw.courseModule.findMany({
      where: { spaceId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    expect(after.map((m) => m.id)).toEqual([third.id, moduleId, second.id]);
  });

  it('gives the teacher everything, drafts included', async () => {
    const space = await loadSpaceForTeacher({ schoolId, offeringId });
    expect(space).not.toBeNull();
    expect(space!.modules.length).toBeGreaterThanOrEqual(3);
    // The point: a draft is present for the person who wrote it.
    expect(space!.modules.some((m) => !m.isPublished)).toBe(true);
  });

  it('publishes a module and its item', async () => {
    await setModulePublished({ schoolId, moduleId, isPublished: true, actorUserId: ACTOR });
    await setItemPublished({ schoolId, itemId: pageItemId, isPublished: true, actorUserId: ACTOR });

    const module = await raw.courseModule.findUniqueOrThrow({ where: { id: moduleId } });
    expect(module.isPublished).toBe(true);
  });

  it('warns when an item is published inside a draft module', async () => {
    const draft = await saveModule({ schoolId, spaceId, title: 'Week 9', actorUserId: ACTOR });
    const item = await saveItem({
      schoolId,
      moduleId: draft.id!,
      kind: 'PAGE',
      title: 'Hidden',
      bodyMarkdown: 'x',
      actorUserId: ACTOR,
    });
    const result = await setItemPublished({
      schoolId,
      itemId: item.id!,
      isPublished: true,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    // Saves the obvious support call: "I published it and they still can't see it."
    expect(result.message).toMatch(/still a draft/);
  });
});

describe('WHAT A STUDENT ACTUALLY RECEIVES', () => {
  it('sends the published module', async () => {
    const space = await loadSpaceForStudent({ schoolId, offeringId });
    expect(space).not.toBeNull();
    expect(space!.modules.map((m) => m.title)).toContain('Week 1 — Foundations');
  });

  it('sends NO draft module at all', async () => {
    /*
     * The assertion the whole feature rests on. Not "renders none" — CONTAINS
     * none, so there is nothing in the payload for anybody to find.
     */
    const space = await loadSpaceForStudent({ schoolId, offeringId });
    expect(space!.modules.every((m) => m.isPublished)).toBe(true);
    expect(space!.modules.map((m) => m.title)).not.toContain('Week 2');
    expect(space!.modules.map((m) => m.title)).not.toContain('Week 9');
  });

  it('sends no draft ITEM from inside a published module', async () => {
    const space = await loadSpaceForStudent({ schoolId, offeringId });
    for (const module of space!.modules) {
      expect(module.items.every((i) => i.isPublished)).toBe(true);
    }
  });

  it('withdraws a module from students without destroying it', async () => {
    const module = await raw.courseModule.findFirstOrThrow({
      where: { spaceId, title: 'Week 1 — Foundations' },
    });

    await setModulePublished({ schoolId, moduleId: module.id, isPublished: false, actorUserId: ACTOR });
    const withdrawn = await loadSpaceForStudent({ schoolId, offeringId });
    expect(withdrawn!.modules.map((m) => m.title)).not.toContain('Week 1 — Foundations');

    // Still there for the lecturer, with its items intact.
    const teacherView = await loadSpaceForTeacher({ schoolId, offeringId });
    const still = teacherView!.modules.find((m) => m.id === module.id);
    expect(still).toBeDefined();
    expect(still!.items.length).toBeGreaterThan(0);

    await setModulePublished({ schoolId, moduleId: module.id, isPublished: true, actorUserId: ACTOR });
  });

  it('hides a module that is published but not yet unlocked', async () => {
    const module = await raw.courseModule.findFirstOrThrow({
      where: { spaceId, title: 'Week 1 — Foundations' },
    });
    await raw.courseModule.update({
      where: { id: module.id },
      data: { unlockAt: new Date('2099-01-01T00:00:00Z') },
    });

    const space = await loadSpaceForStudent({ schoolId, offeringId });
    expect(space!.modules.map((m) => m.id)).not.toContain(module.id);

    await raw.courseModule.update({ where: { id: module.id }, data: { unlockAt: null } });
  });
});

describe('who may open a course', () => {
  it('admits the enrolled student', async () => {
    const enrolment = await enrolmentFor({
      schoolId,
      offeringId,
      studentProfileId: enrolledStudentId,
    });
    expect(enrolment).not.toBeNull();
  });

  it('REFUSES a student who is not enrolled', async () => {
    // Otherwise any student reads any course by editing the address bar.
    expect(
      await enrolmentFor({ schoolId, offeringId, studentProfileId: outsiderStudentId }),
    ).toBeNull();
  });

  it('refuses a student who dropped the course', async () => {
    const enrolment = await raw.enrollment.findFirstOrThrow({
      where: { offeringId, studentId: enrolledStudentId },
    });
    await raw.enrollment.update({ where: { id: enrolment.id }, data: { status: 'DROPPED' } });

    expect(
      await enrolmentFor({ schoolId, offeringId, studentProfileId: enrolledStudentId }),
    ).toBeNull();

    await raw.enrollment.update({ where: { id: enrolment.id }, data: { status: 'REGISTERED' } });
  });

  it('finds nothing for a course the student is not on', async () => {
    expect(
      await enrolmentFor({ schoolId, offeringId: otherOfferingId, studentProfileId: enrolledStudentId }),
    ).toBeNull();
  });
});

describe('deleting', () => {
  it('deletes an item that nobody has submitted to', async () => {
    const module = await raw.courseModule.findFirstOrThrow({ where: { spaceId } });
    const item = await saveItem({
      schoolId,
      moduleId: module.id,
      kind: 'PAGE',
      title: 'Throwaway',
      bodyMarkdown: 'x',
      actorUserId: ACTOR,
    });

    const result = await deleteItem({ schoolId, itemId: item.id!, actorUserId: ACTOR });
    expect(result.ok).toBe(true);
    expect(await raw.moduleItem.findUnique({ where: { id: item.id! } })).toBeNull();
  });
});

describe('files handed out to a class', () => {
  let fileItemId = '';

  beforeAll(async () => {
    const { saveFileItem } = await import('@/server/services/lms.service');
    const { __setStorageDriver } = await import('@/server/storage');

    const stored = new Map<string, { body: Uint8Array; mediaType: string }>();
    __setStorageDriver({
      async put({ key, body, mediaType }) {
        stored.set(key, { body, mediaType });
      },
      async get(key) {
        return stored.get(key) ?? null;
      },
      async delete(key) {
        stored.delete(key);
      },
    });

    const module = await raw.courseModule.findFirstOrThrow({
      where: { spaceId, isPublished: true },
    });

    // A minimal PDF — sniffed by its leading bytes, not by its name.
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const result = await saveFileItem({
      schoolId,
      moduleId: module.id,
      title: 'Lecture 3 slides',
      file: new File([pdf.slice().buffer as ArrayBuffer], 'slides.pdf'),
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    fileItemId = result.id!;
  });

  it('stores a key rather than a URL, under the school', async () => {
    const item = await raw.moduleItem.findUniqueOrThrow({ where: { id: fileItemId } });
    expect(item.kind).toBe('FILE');
    expect(item.fileKey).toMatch(/^private\//);
    expect(item.fileKey).toContain('/material/');
    expect(item.fileName).toBe('slides.pdf');
  });

  it('is a DRAFT until published, like every other item', async () => {
    const item = await raw.moduleItem.findUniqueOrThrow({ where: { id: fileItemId } });
    expect(item.isPublished).toBe(false);
  });

  it('REFUSES a student while it is still a draft', async () => {
    const { mayReadMaterial } = await import('@/server/services/lms.service');
    /*
     * A withdrawn or unpublished reading must actually stop being fetchable.
     * A file that stays reachable after withdrawal makes the button a lie.
     */
    expect(
      await mayReadMaterial({
        schoolId,
        itemId: fileItemId,
        userId: 'anyone',
        role: 'STUDENT',
        studentProfileId: enrolledStudentId,
      }),
    ).toBe(false);
  });

  it('lets the lecturer read their own draft', async () => {
    const { mayReadMaterial } = await import('@/server/services/lms.service');
    expect(
      await mayReadMaterial({
        schoolId,
        itemId: fileItemId,
        userId: 'lecturer',
        role: 'INSTRUCTOR',
        instructorProfileId: lecturerProfileId,
      }),
    ).toBe(true);
  });

  it('lets an ENROLLED student read it once published, and nobody else', async () => {
    const { mayReadMaterial, setItemPublished } = await import('@/server/services/lms.service');
    await setItemPublished({ schoolId, itemId: fileItemId, isPublished: true, actorUserId: ACTOR });

    expect(
      await mayReadMaterial({
        schoolId,
        itemId: fileItemId,
        userId: 'x',
        role: 'STUDENT',
        studentProfileId: enrolledStudentId,
      }),
    ).toBe(true);

    // The assertion that matters: course material is not school-wide.
    expect(
      await mayReadMaterial({
        schoolId,
        itemId: fileItemId,
        userId: 'x',
        role: 'STUDENT',
        studentProfileId: outsiderStudentId,
      }),
    ).toBe(false);
  });

  it('refuses an item that carries no file', async () => {
    const { mayReadMaterial } = await import('@/server/services/lms.service');
    const page = await raw.moduleItem.findFirstOrThrow({ where: { schoolId, kind: 'PAGE' } });
    expect(
      await mayReadMaterial({
        schoolId,
        itemId: page.id,
        userId: 'x',
        role: 'ADMIN',
      }),
    ).toBe(false);
  });
});
