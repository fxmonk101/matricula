import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { DEFAULT_QUIZ_SETTINGS } from '@/lib/domain/quiz';
import { ensureSpaceForOffering, saveModule } from '@/server/services/lms.service';
import {
  loadGradebook,
  postCourseworkToGradesheet,
  previewCourseworkPost,
  saveCoursework,
  markSubmission,
  submitCoursework,
} from '@/server/services/coursework.service';
import { saveQuiz, startAttempt, submitAttempt } from '@/server/services/quiz.service';

/**
 * =============================================================================
 * DOES A QUIZ MARK REACH THE ACADEMIC RECORD?
 * =============================================================================
 *
 * "A quiz is a piece of coursework that marks itself" is the claim the whole
 * design rests on, and the evidence for it so far was that submitting an
 * attempt writes a Submission row. That is necessary and nowhere near
 * sufficient: the row has to be picked up by the gradebook, weighted alongside
 * hand-marked work, and land in `Enrollment.caScore` with the school's own CA
 * weighting applied.
 *
 * This walks the whole chain with a quiz and an essay side by side, because the
 * failure worth catching is a quiz that is counted differently from the
 * assignment sitting next to it.
 */

const raw = new PrismaClient();
const SUFFIX = `qgb-${Date.now()}`;

let schoolId = '';
let offeringId = '';
let moduleId = '';
let enrolA = '';
let enrolB = '';
let ACTOR = '';
let lecturerMembershipId = '';
const userIds: string[] = [];

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `qgb-${SUFFIX}`,
      code: `G${Date.now() % 100000}`,
      name: 'Quiz Gradebook University',
      shortName: 'QGU',
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
    data: { schoolId, code: 'CSC410', title: 'Assessment', creditHours: 3, departmentId: department.id },
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
  const instructor = await raw.instructor.create({
    data: { schoolId, userId: lecturer.id, staffNumber: `S-${SUFFIX}`, departmentId: department.id },
  });
  lecturerMembershipId = (
    await raw.membership.create({
      data: { schoolId, userId: lecturer.id, role: 'INSTRUCTOR', status: 'ACTIVE' },
    })
  ).id;

  offeringId = (
    await raw.courseOffering.create({
      data: { schoolId, courseId: course.id, termId: term.id, section: 'A', instructorId: instructor.id },
    })
  ).id;

  async function student(key: string, matric: string) {
    const user = await person(key);
    const profile = await raw.student.create({
      data: { schoolId, userId: user.id, matricNumber: matric, programId: program.id, level: 400 },
    });
    return (
      await raw.enrollment.create({
        data: { schoolId, studentId: profile.id, offeringId, status: 'REGISTERED' },
      })
    ).id;
  }

  enrolA = await student('student-a', `M1-${SUFFIX}`);
  enrolB = await student('student-b', `M2-${SUFFIX}`);

  const space = await ensureSpaceForOffering({ schoolId, offeringId });
  const module = await saveModule({
    schoolId,
    spaceId: space.spaceId!,
    title: 'Assessment',
    actorUserId: ACTOR,
  });
  moduleId = module.id!;
  await raw.courseModule.update({ where: { id: moduleId }, data: { isPublished: true } });
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

let quizItemId = '';
let essayItemId = '';

describe('a quiz and an essay side by side', () => {
  it('creates one of each, worth the same marks', async () => {
    const quiz = await saveQuiz({
      schoolId,
      moduleId,
      title: 'Test 1',
      acceptsLate: true,
      settings: { ...DEFAULT_QUIZ_SETTINGS, reveal: 'AFTER_SUBMIT' },
      questions: [
        {
          kind: 'SINGLE_CHOICE',
          prompt: 'Two plus two?',
          points: 10,
          options: [
            { text: '4', isCorrect: true },
            { text: '5', isCorrect: false },
          ],
        },
      ],
      actorUserId: ACTOR,
    });
    expect(quiz.ok).toBe(true);
    quizItemId = quiz.id!;
    await raw.moduleItem.update({ where: { id: quizItemId }, data: { isPublished: true } });

    const essay = await saveCoursework({
      schoolId,
      moduleId,
      title: 'Essay 1',
      pointsPossible: 10,
      allowsText: true,
      allowsFile: false,
      acceptsLate: true,
      actorUserId: ACTOR,
    });
    expect(essay.ok).toBe(true);
    essayItemId = essay.id!;
    await raw.moduleItem.update({ where: { id: essayItemId }, data: { isPublished: true } });
  });

  it('the gradebook sees BOTH, with no idea one is a quiz', async () => {
    /*
     * The claim the whole design rests on. If the gradebook had to know about
     * quizzes there would be two answers to "what is this student's continuous
     * assessment", and one day they would disagree.
     */
    const { coursework } = await loadGradebook({ schoolId, offeringId });
    expect(coursework).toHaveLength(2);
    expect(coursework.map((c) => c.title).sort()).toEqual(['Essay 1', 'Test 1']);
  });
});

describe('marks from both routes', () => {
  it('a sat quiz marks itself', async () => {
    const started = await startAttempt({
      schoolId,
      itemId: quizItemId,
      enrollmentId: enrolA,
      actorUserId: ACTOR,
    });

    const question = await raw.quizQuestion.findFirstOrThrow({
      where: { quiz: { coursework: { moduleItemId: quizItemId } } },
      include: { options: true },
    });

    const done = await submitAttempt({
      schoolId,
      attemptId: started.attemptId!,
      enrollmentId: enrolA,
      answers: [
        { questionId: question.id, optionIds: [question.options.find((o) => o.isCorrect)!.id] },
      ],
      actorUserId: ACTOR,
    });

    expect(done.score).toBe(10);
  });

  it('a hand-marked essay reaches the same place', async () => {
    const coursework = await raw.coursework.findFirstOrThrow({
      where: { moduleItemId: essayItemId },
    });

    const student = await raw.enrollment.findUniqueOrThrow({
      where: { id: enrolA },
      include: { student: true },
    });

    const handed = await submitCoursework({
      schoolId,
      courseworkId: coursework.id,
      enrollmentId: enrolA,
      textBody: 'My essay.',
      actorUserId: student.student.userId,
    });
    expect(handed.ok).toBe(true);

    const submission = await raw.submission.findFirstOrThrow({
      where: { courseworkId: coursework.id, enrollmentId: enrolA },
    });
    const marked = await markSubmission({
      schoolId,
      submissionId: submission.id,
      score: 5,
      feedback: 'Half marks.',
      markedByMembershipId: lecturerMembershipId,
      actorUserId: ACTOR,
    });
    expect(marked.ok).toBe(true);
  });
});

describe('the roll-up into the academic record', () => {
  it('weights the quiz and the essay TOGETHER, by marks available', async () => {
    /*
     * 10 out of 10 on the quiz and 5 out of 10 on the essay is 15 of 20 = 75%.
     * Scaled by the school's CA weighting — 40 by default — that is 30.
     *
     * The number that would betray a bug is 40 (the quiz counted alone) or 20
     * (the essay counted alone).
     */
    const preview = await previewCourseworkPost({
      schoolId,
      offeringId,
      countMissingAsZero: false,
    });

    const row = preview.rows.find((r) => r.enrollmentId === enrolA)!;
    expect(preview.caWeight).toBe(40);
    expect(row.computed.caScore).toBe(30);
  });

  it('leaves the student who did neither out, rather than scoring them zero', async () => {
    const preview = await previewCourseworkPost({
      schoolId,
      offeringId,
      countMissingAsZero: false,
    });
    const absent = preview.rows.find((r) => r.enrollmentId === enrolB)!;
    expect(absent.computed.caScore).toBeNull();
  });

  it('writes it to Enrollment.caScore, which is what the transcript reads', async () => {
    const posted = await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: false,
      overwriteExisting: false,
      actorUserId: ACTOR,
    });

    expect(posted.ok).toBe(true);
    expect(posted.written).toBe(1);

    const enrolment = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolA } });
    expect(enrolment.caScore).toBe(30);
  });

  it('does NOT set an exam score or a grade — that is a different decision', async () => {
    /*
     * Posting coursework in week six must not mark the course complete. The
     * roll-up touches caScore alone; `submitGrade` is what ends a course, and
     * it needs an examination score.
     */
    const enrolment = await raw.enrollment.findUniqueOrThrow({ where: { id: enrolA } });
    expect(enrolment.examScore).toBeNull();
    expect(enrolment.letterGrade).toBeNull();
    expect(enrolment.status).toBe('REGISTERED');
  });

  it('refuses to overwrite the posted mark without being asked twice', async () => {
    const again = await postCourseworkToGradesheet({
      schoolId,
      offeringId,
      countMissingAsZero: false,
      overwriteExisting: false,
      actorUserId: ACTOR,
    });
    expect(again.written).toBe(0);
  });
});
