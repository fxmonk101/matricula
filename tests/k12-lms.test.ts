import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  ensureSpaceForSubject,
  loadSubjectSpaceForPupil,
  loadSubjectSpaceForTeacher,
  mayAuthorSubject,
  pupilTakesSubject,
  subjectsForPupil,
} from '@/server/services/k12-lms.service';
import { saveItem, saveModule, setItemPublished, setModulePublished } from '@/server/services/lms.service';

/**
 * =============================================================================
 * COURSE CONTENT IN A SECONDARY SCHOOL
 * =============================================================================
 *
 * The assertions that matter are the negative ones, and they are the same two
 * that matter in the university path: an unpublished item is a teacher's draft
 * and must be ABSENT from a pupil's payload rather than hidden in it, and a
 * pupil in 4B must not be able to read 4A's material by changing an id.
 */

const raw = new PrismaClient();
const SUFFIX = `k12lms-${Date.now()}`;

let schoolId = '';
let termId = '';
let assignmentA = '';
let assignmentB = '';
let teacherProfileId = '';
let otherTeacherProfileId = '';
let pupilInA = '';
let pupilInB = '';
let spaceId = '';
let ACTOR = '';
const userIds: string[] = [];

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `k12lms-${SUFFIX}`,
      code: `K${Date.now() % 100000}`,
      name: 'K12 LMS Test School',
      shortName: 'KLS',
      timezone: 'UTC',
      academicModel: 'K12',
    },
  });
  schoolId = school.id;

  termId = (
    await raw.term.create({
      data: {
        schoolId,
        code: `${SUFFIX}-T1`,
        name: 'First Term',
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
    })
  ).id;

  const yearGroup = await raw.yearGroup.create({
    data: { schoolId, code: 'JSS1', name: 'JSS 1', sequence: 1 },
  });
  const classA = await raw.formClass.create({
    data: { schoolId, yearGroupId: yearGroup.id, code: 'JSS1A', name: 'JSS 1A' },
  });
  const classB = await raw.formClass.create({
    data: { schoolId, yearGroupId: yearGroup.id, code: 'JSS1B', name: 'JSS 1B' },
  });
  const subject = await raw.subject.create({
    data: { schoolId, code: 'MTH', name: 'Mathematics' },
  });

  /*
   * A faculty and a department, even in a secondary school.
   *
   * `Instructor.departmentId` is required, and Departments hang off
   * Faculties — a university structure. `STARTER_UNIT_K12` provisions one
   * for exactly this reason, so a K-12 school can place its first member of
   * staff. The fixture does what provisioning would have done.
   */
  const faculty = await raw.faculty.create({ data: { schoolId, code: 'GEN', name: 'General Studies' } });
  const department = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'GEND', name: 'General' },
  });

  /*
   * And a Programme, because `Student.programId` is required too.
   *
   * A secondary school has no programmes — a pupil is in a form class, not
   * reading for a degree. The seeded K-12 school carries one for the same
   * reason: the Student row cannot exist without it.
   */
  const program = await raw.program.create({
    data: {
      schoolId,
      departmentId: department.id,
      code: 'GEN',
      name: 'General',
      degreeType: 'CERTIFICATE',
      durationTerms: 6,
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

  const teacher = await person('teacher');
  ACTOR = teacher.id;
  teacherProfileId = (
    await raw.instructor.create({
      data: { schoolId, userId: teacher.id, staffNumber: `S-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  const other = await person('other-teacher');
  otherTeacherProfileId = (
    await raw.instructor.create({
      data: { schoolId, userId: other.id, staffNumber: `S2-${SUFFIX}`, departmentId: department.id },
    })
  ).id;

  assignmentA = (
    await raw.subjectAssignment.create({
      data: { schoolId, subjectId: subject.id, formClassId: classA.id, termId, teacherId: teacherProfileId },
    })
  ).id;
  assignmentB = (
    await raw.subjectAssignment.create({
      data: { schoolId, subjectId: subject.id, formClassId: classB.id, termId, teacherId: otherTeacherProfileId },
    })
  ).id;

  async function pupil(key: string, formClassId: string) {
    const user = await person(key);
    const profile = await raw.student.create({
      data: { schoolId, userId: user.id, matricNumber: `${key}-${SUFFIX}`, programId: program.id },
    });
    await raw.classEnrolment.create({
      data: { schoolId, studentId: profile.id, formClassId, termId },
    });
    return profile.id;
  }

  pupilInA = await pupil('pupil-a', classA.id);
  pupilInB = await pupil('pupil-b', classB.id);
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe('the container', () => {
  it('is created for a subject assignment, once', async () => {
    const first = await ensureSpaceForSubject({ schoolId, subjectAssignmentId: assignmentA });
    expect(first.ok).toBe(true);
    spaceId = first.spaceId!;

    const second = await ensureSpaceForSubject({ schoolId, subjectAssignmentId: assignmentA });
    expect(second.spaceId).toBe(spaceId);
  });

  it('holds EXACTLY ONE owner — the subject, and not an offering', async () => {
    // The invariant the schema cannot express portably, asserted here instead
    // and from the K-12 side this time.
    const space = await raw.courseSpace.findUniqueOrThrow({ where: { id: spaceId } });
    expect(space.subjectAssignmentId).toBe(assignmentA);
    expect(space.offeringId).toBeNull();
    expect(space.termId).toBe(termId);
  });

  it('refuses a subject from another school', async () => {
    const result = await ensureSpaceForSubject({
      schoolId,
      subjectAssignmentId: 'not-a-real-id',
    });
    expect(result.ok).toBe(false);
  });
});

describe('who may author', () => {
  it('admits the teacher of record', async () => {
    expect(
      await mayAuthorSubject({
        schoolId,
        subjectAssignmentId: assignmentA,
        instructorProfileId: teacherProfileId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(true);
  });

  it('REFUSES a teacher who has a different class', async () => {
    expect(
      await mayAuthorSubject({
        schoolId,
        subjectAssignmentId: assignmentA,
        instructorProfileId: otherTeacherProfileId,
        role: 'INSTRUCTOR',
      }),
    ).toBe(false);
  });

  it('admits the office without an instructor profile', async () => {
    expect(
      await mayAuthorSubject({ schoolId, subjectAssignmentId: assignmentA, role: 'ADMIN' }),
    ).toBe(true);
  });
});

describe('who may read', () => {
  it('admits a pupil in the form class', async () => {
    expect(
      await pupilTakesSubject({
        schoolId,
        subjectAssignmentId: assignmentA,
        studentProfileId: pupilInA,
      }),
    ).toBe(true);
  });

  it('REFUSES a pupil from another form class', async () => {
    /*
     * The one that stops a pupil in 1B reading 1A's material by changing an id
     * in the address bar. A route guard cannot answer this — it is a fact
     * about two records.
     */
    expect(
      await pupilTakesSubject({
        schoolId,
        subjectAssignmentId: assignmentA,
        studentProfileId: pupilInB,
      }),
    ).toBe(false);
  });
});

describe('what reaches a pupil', () => {
  let moduleId = '';
  let draftItemId = '';

  beforeAll(async () => {
    const module = await saveModule({
      schoolId,
      spaceId,
      title: 'Week 1 — Fractions',
      actorUserId: ACTOR,
    });
    moduleId = module.id!;

    const published = await saveItem({
      schoolId,
      moduleId,
      kind: 'PAGE',
      title: 'Reading: what a fraction is',
      bodyMarkdown: 'A fraction is a part of a whole.',
      actorUserId: ACTOR,
    });
    await setItemPublished({
      schoolId,
      itemId: published.id!,
      isPublished: true,
      actorUserId: ACTOR,
    });

    const draft = await saveItem({
      schoolId,
      moduleId,
      kind: 'PAGE',
      title: 'NEXT WEEK — do not show this yet',
      bodyMarkdown: 'Long division.',
      actorUserId: ACTOR,
    });
    draftItemId = draft.id!;
  });

  it('shows the teacher everything, drafts included', async () => {
    const space = await loadSubjectSpaceForTeacher({ schoolId, subjectAssignmentId: assignmentA });
    expect(space!.modules[0].items).toHaveLength(2);
  });

  it('shows a pupil NOTHING until the module itself is published', async () => {
    const space = await loadSubjectSpaceForPupil({ schoolId, subjectAssignmentId: assignmentA });
    expect(space!.modules).toHaveLength(0);
  });

  it('OMITS the draft from the payload once the module is published', async () => {
    /*
     * Absent, not hidden. A draft filtered in the browser would still have been
     * sent, sitting in the payload for anybody who opened the network tab —
     * and next week's material is exactly the thing a pupil would look for.
     */
    await setModulePublished({ schoolId, moduleId, isPublished: true, actorUserId: ACTOR });

    const space = await loadSubjectSpaceForPupil({ schoolId, subjectAssignmentId: assignmentA });
    expect(space!.modules).toHaveLength(1);
    expect(space!.modules[0].items).toHaveLength(1);

    const serialised = JSON.stringify(space);
    expect(serialised).not.toContain('NEXT WEEK');
    expect(serialised).not.toContain(draftItemId);
    expect(serialised).toContain('what a fraction is');
  });
});

describe('a pupil’s list of subjects', () => {
  it('lists the subjects of their own form class', async () => {
    const result = await subjectsForPupil({ schoolId, studentProfileId: pupilInA });
    expect(result.formClass).toBe('JSS 1A');
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].subjectAssignmentId).toBe(assignmentA);
  });

  it('counts only what that pupil can actually open', async () => {
    // A list that says "2 items" beside a page showing one is worse than no
    // count at all, so the count runs through the same visibility rules.
    const result = await subjectsForPupil({ schoolId, studentProfileId: pupilInA });
    expect(result.subjects[0].items).toBe(1);
  });

  it('does not leak another form class’s subject', async () => {
    const result = await subjectsForPupil({ schoolId, studentProfileId: pupilInB });
    expect(result.formClass).toBe('JSS 1B');
    expect(result.subjects.map((s) => s.subjectAssignmentId)).not.toContain(assignmentA);
  });
});

describe('tenancy', () => {
  it('cannot read a subject from another school', async () => {
    const other = await raw.school.create({
      data: {
        slug: `k12lms-other-${SUFFIX}`,
        code: `L${Date.now() % 100000}`,
        name: 'Other School',
        shortName: 'OS',
        timezone: 'UTC',
        academicModel: 'K12',
      },
    });

    try {
      expect(
        await loadSubjectSpaceForTeacher({ schoolId: other.id, subjectAssignmentId: assignmentA }),
      ).toBeNull();
      expect(
        await mayAuthorSubject({
          schoolId: other.id,
          subjectAssignmentId: assignmentA,
          instructorProfileId: teacherProfileId,
          role: 'INSTRUCTOR',
        }),
      ).toBe(false);
    } finally {
      await raw.school.deleteMany({ where: { id: other.id } });
    }
  });
});
