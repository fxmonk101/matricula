import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  loadGradebook,
  markSubmission,
  postCourseworkToGradesheet,
  previewCourseworkPost,
  saveCoursework,
  submitCoursework,
} from '@/server/services/coursework.service';
import {
  ensureSpaceForOffering,
  saveModule,
  setItemPublished,
  setModulePublished,
} from '@/server/services/lms.service';
import { submitGrade } from '@/server/services/gpa.service';
import { ensureSheet, releaseResults } from '@/server/services/result-workflow.service';

/**
 * =============================================================================
 * COURSEWORK REACHING THE ACADEMIC RECORD
 * =============================================================================
 *
 * The highest-consequence path in the product. A caScore written here feeds the
 * total, the letter grade, the GPA, academic standing and a graduation audit —
 * so these run against the real database and check the DERIVED figures, not
 * just the column that was written.
 *
 * The assertions that matter most are the refusals: that posting mid-term does
 * not mark anybody's enrolment complete, and that a mark somebody typed by hand
 * is not silently replaced.
 */

const raw = new PrismaClient();
const SUFFIX = `gb-${Date.now()}`;

let schoolId = '';
let offeringId = '';
let moduleId = '';
let ACTOR = '';
let markerMembershipId = '';
const userIds: string[] = [];

/** matric -> { enrollmentId, userId } */
const students = new Map<string, { enrollmentId: string; userId: string; studentId: string }>();
/** title -> courseworkId */
const work = new Map<string, string>();

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `gb-${SUFFIX}`,
      code: `G${Date.now() % 100000}`,
      name: 'Gradebook Test University',
      shortName: 'GTU',
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
  ACTOR = lecturer.id;
  markerMembershipId = (
    await raw.membership.create({
      data: { userId: lecturer.id, schoolId, role: 'INSTRUCTOR', status: 'ACTIVE' },
    })
  ).id;
  const instructor = await raw.instructor.create({
    data: { schoolId, userId: lecturer.id, staffNumber: `S-${SUFFIX}`, departmentId: dept.id },
  });

  offeringId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: instructor.id },
    })
  ).id;

  // Four students, so the interesting cases can be one each.
  for (const key of ['ada', 'bola', 'chidi', 'dami']) {
    const user = await person(key);
    const profile = await raw.student.create({
      data: {
        schoolId,
        userId: user.id,
        matricNumber: `M-${key}-${SUFFIX}`,
        programId: program.id,
        level: 300,
      },
    });
    const enrolment = await raw.enrollment.create({
      data: { schoolId, studentId: profile.id, offeringId, status: 'REGISTERED' },
    });
    students.set(key, { enrollmentId: enrolment.id, userId: user.id, studentId: profile.id });
  }

  // Two pieces of work on different scales, so weighting is actually exercised.
  const space = await ensureSpaceForOffering({ schoolId, offeringId });
  const module = await saveModule({ schoolId, spaceId: space.spaceId!, title: 'Week 1', actorUserId: ACTOR });
  moduleId = module.id!;
  await setModulePublished({ schoolId, moduleId, isPublished: true, actorUserId: ACTOR });

  for (const [title, points] of [
    ['Essay', 100],
    ['Quiz', 10],
  ] as const) {
    const created = await saveCoursework({
      schoolId,
      moduleId,
      title,
      pointsPossible: points,
      allowsText: true,
      allowsFile: false,
      acceptsLate: true,
      actorUserId: ACTOR,
    });
    await setItemPublished({ schoolId, itemId: created.id!, isPublished: true, actorUserId: ACTOR });
    const cw = await raw.coursework.findFirstOrThrow({ where: { moduleItemId: created.id! } });
    work.set(title, cw.id);
  }
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

async function submitAndMark(key: string, title: string, score: number | null) {
  const student = students.get(key)!;
  const courseworkId = work.get(title)!;

  await submitCoursework({
    schoolId,
    courseworkId,
    enrollmentId: student.enrollmentId,
    textBody: `${key}'s answer to ${title}`,
    actorUserId: student.userId,
  });

  if (score === null) return;

  const submission = await raw.submission.findFirstOrThrow({
    where: { courseworkId, enrollmentId: student.enrollmentId },
    orderBy: { attempt: 'desc' },
  });
  await markSubmission({
    schoolId,
    submissionId: submission.id,
    score,
    markedByMembershipId: markerMembershipId,
    actorUserId: ACTOR,
  });
}

describe('marking', () => {
  it('puts the mark on the submission and nowhere near the enrolment', async () => {
    /*
     * A lecturer marking one essay has not decided to republish everybody's
     * continuous assessment. Nothing academic moves until posting.
     */
    await submitAndMark('ada', 'Essay', 80);

    const submission = await raw.submission.findFirstOrThrow({
      where: { courseworkId: work.get('Essay')!, enrollmentId: students.get('ada')!.enrollmentId },
    });
    expect(submission.score).toBe(80);
    expect(submission.gradedAt).not.toBeNull();

    const enrolment = await raw.enrollment.findUniqueOrThrow({
      where: { id: students.get('ada')!.enrollmentId },
    });
    expect(enrolment.caScore).toBeNull();
    expect(enrolment.status).toBe('REGISTERED');
  });

  it('refuses a negative mark', async () => {
    const submission = await raw.submission.findFirstOrThrow({
      where: { courseworkId: work.get('Essay')!, enrollmentId: students.get('ada')!.enrollmentId },
    });
    const result = await markSubmission({
      schoolId,
      submissionId: submission.id,
      score: -5,
      markedByMembershipId: markerMembershipId,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
  });
});

describe('the gradebook', () => {
  beforeAll(async () => {
    await submitAndMark('ada', 'Quiz', 10); // strong on both
    await submitAndMark('bola', 'Essay', 40); // weak essay
    await submitAndMark('bola', 'Quiz', 10); // perfect quiz
    await submitAndMark('chidi', 'Essay', null); // handed in, not yet marked
    // dami hands nothing in at all.
  });

  it('shows every student against every piece of work', async () => {
    const { rows, coursework } = await loadGradebook({ schoolId, offeringId });
    expect(coursework).toHaveLength(2);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.items).toHaveLength(2);
  });

  it('WEIGHTS BY MARKS AVAILABLE, so a perfect quiz cannot rescue a failed essay', async () => {
    const preview = await previewCourseworkPost({
      schoolId,
      offeringId,
      countMissingAsZero: false,
    });
    const bola = preview.rows.find((r) => r.matricNumber.includes('bola'))!;
    // 50 of 110, not the 70 that averaging 40% and 100% would give.
    expect(bola.computed.earned).toBe(50);
    expect(bola.computed.possible).toBe(110);
  });

  it('EXCLUDES work handed in but not yet marked', async () => {
    const preview = await previewCourseworkPost({
      schoolId,
      offeringId,
      countMissingAsZero: false,
    });
    const chidi = preview.rows.find((r) => r.matricNumber.includes('chidi'))!;
    expect(chidi.computed.excludedUnmarked).toBe(1);
    // Nothing of theirs is marked, so there is no CA to post — not a zero.
    expect(chidi.computed.caScore).toBeNull();
    expect(chidi.outcome).toBe('NOTHING_TO_POST');
  });

  it('leaves missing work out unless told otherwise', async () => {
    const lenient = await previewCourseworkPost({ schoolId, offeringId, countMissingAsZero: false });
    const strict = await previewCourseworkPost({ schoolId, offeringId, countMissingAsZero: true });

    const damiLenient = lenient.rows.find((r) => r.matricNumber.includes('dami'))!;
    const damiStrict = strict.rows.find((r) => r.matricNumber.includes('dami'))!;

    expect(damiLenient.computed.caScore).toBeNull();
    expect(damiStrict.computed.caScore).toBe(0);
    expect(damiStrict.computed.counted).toBe(2);
  });
});

describe('posting to the gradesheet', () => {
  it('writes caScore and does NOT complete the enrolment', async () => {
    /*
     * The distinction that makes this safe to run in week six. submitGrade
     * requires an exam and marks the enrolment COMPLETED; posting coursework
     * must do neither, or every student is "completed" with a grade computed
     * against an exam that has not happened.
     */
    const result = await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: false,
      overwriteExisting: false,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);

    const ada = await raw.enrollment.findUniqueOrThrow({
      where: { id: students.get('ada')!.enrollmentId },
    });
    // 90 of 110 => 81.8% of a CA weight of 40.
    expect(ada.caScore).toBeCloseTo(32.73, 1);
    expect(ada.status).toBe('REGISTERED');
    expect(ada.examScore).toBeNull();
    expect(ada.letterGrade).toBeNull();
    expect(ada.gradedAt).toBeNull();
  });

  it('leaves a student with nothing marked completely alone', async () => {
    const chidi = await raw.enrollment.findUniqueOrThrow({
      where: { id: students.get('chidi')!.enrollmentId },
    });
    expect(chidi.caScore).toBeNull();
  });

  it('REFUSES to overwrite a CA somebody typed, unless asked', async () => {
    /*
     * A caScore on the enrolment may be a viva mark or an agreed adjustment.
     * Replacing it silently destroys a human judgement with no record.
     */
    const dami = students.get('dami')!;
    await raw.enrollment.update({ where: { id: dami.enrollmentId }, data: { caScore: 35 } });

    const refused = await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: true, // would compute 0 for dami
      overwriteExisting: false,
      actorUserId: ACTOR,
    });

    const untouched = await raw.enrollment.findUniqueOrThrow({ where: { id: dami.enrollmentId } });
    expect(untouched.caScore).toBe(35);
    expect(refused.message).toMatch(/by hand|left alone/);

    const forced = await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: true,
      overwriteExisting: true,
      actorUserId: ACTOR,
    });
    expect(forced.ok).toBe(true);

    const overwritten = await raw.enrollment.findUniqueOrThrow({ where: { id: dami.enrollmentId } });
    expect(overwritten.caScore).toBe(0);
  });
});

describe('when an exam mark already exists', () => {
  it('recomputes the total, letter and GPA through the same maths the gradesheet uses', async () => {
    const bola = students.get('bola')!;

    // The exam happens and is entered the normal way.
    await submitGrade({
      schoolId,
      enrollmentId: bola.enrollmentId,
      caScore: 20,
      examScore: 50,
      actorId: ACTOR,
    });

    const before = await raw.enrollment.findUniqueOrThrow({ where: { id: bola.enrollmentId } });
    expect(before.totalScore).toBe(70);
    expect(before.letterGrade).not.toBeNull();

    // Then coursework is posted, replacing that hand-entered CA.
    await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: false,
      overwriteExisting: true,
      actorUserId: ACTOR,
    });

    const after = await raw.enrollment.findUniqueOrThrow({ where: { id: bola.enrollmentId } });
    // 50 of 110 => 45.45% of 40 => 18.18, plus the 50 exam.
    expect(after.caScore).toBeCloseTo(18.18, 1);
    expect(after.totalScore).toBeCloseTo(68.18, 1);
    // The derived fields moved with it rather than going stale.
    expect(after.totalScore).not.toBe(before.totalScore);
    expect(after.letterGrade).not.toBeNull();
    expect(after.gradePoint).not.toBeNull();
  });

  it('keeps a mark OFF the record until it is released', async () => {
    /*
     * The inversion the approval chain introduced. A typed mark used to set
     * the enrolment COMPLETED and recompute the CGPA in the same request, so a
     * typo in week six was a published degree classification.
     */
    const bola = students.get('bola')!;

    const entered = await raw.enrollment.findUniqueOrThrow({ where: { id: bola.enrollmentId } });
    expect(entered.gradePoint).not.toBeNull();
    expect(entered.status).toBe('REGISTERED');

    // And nothing has reached the aggregates.
    expect(await raw.termGpa.count({ where: { studentId: bola.studentId } })).toBe(0);
  });

  it('LEAVES THE TERM GPA CORRECT once released, not merely the enrolment row', async () => {
    /*
     * The assertion this whole file exists for. A caScore that updates its own
     * row and leaves TermGpa stale produces a transcript that disagrees with
     * the grades it is made of, and nothing in the UI would show it.
     *
     * It now runs the FULL chain — mark, release, aggregate — because that is
     * what a student actually ends up with.
     */
    const bola = students.get('bola')!;

    // A sheet must exist: releaseResults refuses to release what was never
    // submitted, which is the whole point of the chain.
    await ensureSheet({ schoolId, offeringId });

    const released = await releaseResults({
      schoolId,
      offeringId,
      actor: {
        role: 'REGISTRAR',
        membershipId: markerMembershipId,
        userId: ACTOR,
      },
    });
    expect(released.ok).toBe(true);

    const enrolment = await raw.enrollment.findUniqueOrThrow({ where: { id: bola.enrollmentId } });
    expect(enrolment.status).toBe('COMPLETED');
    const termGpa = await raw.termGpa.findFirstOrThrow({ where: { studentId: bola.studentId } });
    const student = await raw.student.findUniqueOrThrow({ where: { id: bola.studentId } });

    // One graded course, so the term GPA is exactly its grade point.
    expect(termGpa.gpa).toBeCloseTo(enrolment.gradePoint!, 2);
    expect(student.cgpa).toBeCloseTo(enrolment.gradePoint!, 2);
  });
});
