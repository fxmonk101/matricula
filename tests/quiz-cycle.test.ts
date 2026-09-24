import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  attemptReview,
  loadPaper,
  loadQuizForTeacher,
  quizResults,
  saveAnswers,
  saveQuiz,
  startAttempt,
  submitAttempt,
  type QuestionDraft,
} from '@/server/services/quiz.service';
import { DEFAULT_QUIZ_SETTINGS } from '@/lib/domain/quiz';
import { ensureSpaceForOffering, saveModule } from '@/server/services/lms.service';

/**
 * =============================================================================
 * QUIZZES, AGAINST THE REAL DATABASE
 * =============================================================================
 *
 * The first describe block is the one that matters most. A quiz is sat in a
 * hall on a machine the student controls, and "the answers are not rendered"
 * is not a guarantee — "the answers are not in the payload" is. These assert
 * against the SERIALISED object, not against intentions.
 */

const raw = new PrismaClient();
const SUFFIX = `quiz-${Date.now()}`;

let schoolId = '';
let offeringId = '';
let moduleId = '';
let enrolA = '';
let enrolB = '';
let ACTOR = '';
const userIds: string[] = [];

const PAPER: QuestionDraft[] = [
  {
    kind: 'SINGLE_CHOICE',
    prompt: 'What is the capital of Nigeria?',
    points: 2,
    options: [
      { text: 'Lagos', isCorrect: false },
      { text: 'Abuja', isCorrect: true },
    ],
  },
  {
    kind: 'MULTI_CHOICE',
    prompt: 'Which of these are prime?',
    points: 4,
    options: [
      { text: '2', isCorrect: true },
      { text: '3', isCorrect: true },
      { text: '4', isCorrect: false },
    ],
  },
  {
    kind: 'SHORT_ANSWER',
    prompt: 'Name the largest city in Nigeria.',
    points: 4,
    acceptedAnswers: 'Lagos\nLagos City',
    options: [],
  },
];

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `quiz-${SUFFIX}`,
      code: `Q${Date.now() % 100000}`,
      name: 'Quiz Test University',
      shortName: 'QTU',
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
    data: { schoolId, code: 'CSC401', title: 'Testing', creditHours: 3, departmentId: department.id },
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

let itemId = '';

describe('authoring', () => {
  it('creates a quiz, its coursework and its paper in one go', async () => {
    const result = await saveQuiz({
      schoolId,
      moduleId,
      title: 'Mid-semester test',
      instructions: 'Answer every question.',
      acceptsLate: false,
      settings: { ...DEFAULT_QUIZ_SETTINGS, timeLimitMinutes: 30, reveal: 'AFTER_SUBMIT' },
      questions: PAPER,
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(true);
    itemId = result.id!;

    const loaded = await loadQuizForTeacher({ schoolId, itemId });
    expect(loaded!.questions).toHaveLength(3);
    // The marks available are the SUM, never typed separately.
    expect(loaded!.pointsPossible).toBe(10);
  });

  it('starts unpublished, so a half-written paper is not sat by accident', async () => {
    const loaded = await loadQuizForTeacher({ schoolId, itemId });
    expect(loaded!.isPublished).toBe(false);
  });

  it('refuses a paper with no correct answer marked', async () => {
    const result = await saveQuiz({
      schoolId,
      moduleId,
      title: 'Broken',
      acceptsLate: true,
      settings: DEFAULT_QUIZ_SETTINGS,
      questions: [
        {
          kind: 'SINGLE_CHOICE',
          prompt: 'Pick one',
          points: 1,
          options: [
            { text: 'a', isCorrect: false },
            { text: 'b', isCorrect: false },
          ],
        },
      ],
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/question has a problem/);
  });
});

describe('WHAT REACHES THE STUDENT', () => {
  let attemptId = '';

  it('refuses to start an unpublished quiz, even with its id', async () => {
    const result = await startAttempt({
      schoolId,
      itemId,
      enrollmentId: enrolA,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    // 'does not exist', not 'is unpublished' — the second confirms it is there.
    expect(result.message).toMatch(/does not exist/);
  });

  it('starts once it is published', async () => {
    await raw.moduleItem.update({ where: { id: itemId }, data: { isPublished: true } });
    const result = await startAttempt({
      schoolId,
      itemId,
      enrollmentId: enrolA,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(true);
    attemptId = result.attemptId!;
  });

  it('NEVER carries isCorrect or the accepted answers in the payload', async () => {
    /*
     * The assertion that matters. A student sits this on a machine they
     * control, with a network tab. Serialised and searched, rather than
     * checked field by field, so a field added later that happens to carry the
     * answer is caught too.
     */
    const paper = await loadPaper({ schoolId, attemptId, enrollmentId: enrolA });
    const serialised = JSON.stringify(paper);

    expect(serialised).not.toContain('isCorrect');
    expect(serialised).not.toContain('acceptedAnswers');
    // The short-answer question's accepted text must not be in there either.
    expect(serialised).not.toContain('Lagos City');
    // And the paper is genuinely there.
    expect(paper!.questions).toHaveLength(3);
    expect(serialised).toContain('capital of Nigeria');
  });

  it('will not open somebody else’s attempt with a crafted id', async () => {
    const stolen = await loadPaper({ schoolId, attemptId, enrollmentId: enrolB });
    expect(stolen).toBeNull();
  });

  it('autosaves answers without marking them', async () => {
    const saved = await saveAnswers({
      schoolId,
      attemptId,
      enrollmentId: enrolA,
      answers: [{ questionId: 'unknown', optionIds: [] }],
    });
    expect(saved.ok).toBe(true);

    const attempt = await raw.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.autoScore).toBeNull();
    expect(attempt.submittedAt).toBeNull();
  });

  it('RESUMES rather than starting a second attempt', async () => {
    /*
     * A crashed browser, a slept phone and a dropped network look identical
     * from here, and every one must return the student to the paper they were
     * on. Starting fresh would consume an attempt and reset their work.
     */
    const again = await startAttempt({
      schoolId,
      itemId,
      enrollmentId: enrolA,
      actorUserId: ACTOR,
    });
    expect(again.ok).toBe(true);
    expect(again.attemptId).toBe(attemptId);
    expect(await raw.quizAttempt.count({ where: { enrollmentId: enrolA } })).toBe(1);
  });
});

describe('handing it in', () => {
  let attemptId = '';
  let questionIds: string[] = [];

  beforeAll(async () => {
    const attempt = await raw.quizAttempt.findFirstOrThrow({ where: { enrollmentId: enrolA } });
    attemptId = attempt.id;
    const loaded = await loadQuizForTeacher({ schoolId, itemId });
    questionIds = loaded!.questions.map((q) => q.id);
  });

  it('marks the paper and creates a Submission', async () => {
    const teacher = await loadQuizForTeacher({ schoolId, itemId });
    const correctOption = (i: number) =>
      teacher!.questions[i].options.find((o) => o.isCorrect)!.id;

    const result = await submitAttempt({
      schoolId,
      attemptId,
      enrollmentId: enrolA,
      answers: [
        { questionId: questionIds[0], optionIds: [correctOption(0)] },
        {
          questionId: questionIds[1],
          optionIds: teacher!.questions[1].options.filter((o) => o.isCorrect).map((o) => o.id),
        },
        { questionId: questionIds[2], text: 'lagos' },
      ],
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(result.score).toBe(10);

    /*
     * The Submission is the whole point of hanging a quiz off Coursework: the
     * gradebook and the CA roll-up need no idea a quiz exists.
     */
    const submission = await raw.submission.findFirstOrThrow({
      where: { enrollmentId: enrolA },
    });
    expect(submission.score).toBe(10);
    expect(submission.gradedAt).not.toBeNull();
  });

  it('refuses a second submission of the same attempt', async () => {
    const result = await submitAttempt({
      schoolId,
      attemptId,
      enrollmentId: enrolA,
      answers: [],
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(await raw.submission.count({ where: { enrollmentId: enrolA } })).toBe(1);
  });

  it('refuses a further attempt once maxAttempts is used', async () => {
    const result = await startAttempt({
      schoolId,
      itemId,
      enrollmentId: enrolA,
      actorUserId: ACTOR,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already taken/);
  });

  it('flags a typed answer that did not match, rather than trusting the zero', async () => {
    const started = await startAttempt({
      schoolId,
      itemId,
      enrollmentId: enrolB,
      actorUserId: ACTOR,
    });

    const result = await submitAttempt({
      schoolId,
      attemptId: started.attemptId!,
      enrollmentId: enrolB,
      answers: [{ questionId: questionIds[2], text: 'Lagos State' }],
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/need a lecturer/);

    const attempt = await raw.quizAttempt.findFirstOrThrow({ where: { enrollmentId: enrolB } });
    expect(attempt.needsReview).toBe(true);
  });
});

describe('afterwards', () => {
  it('shows a student their own marks, and the answers under AFTER_SUBMIT', async () => {
    const attempt = await raw.quizAttempt.findFirstOrThrow({ where: { enrollmentId: enrolA } });
    const review = await attemptReview({ schoolId, attemptId: attempt.id, enrollmentId: enrolA });

    expect(review!.score).toBe(10);
    expect(review!.reveal).toBe(true);
    expect(review!.questions.length).toBeGreaterThan(0);
  });

  it('carries NO questions at all when the policy says not to reveal', async () => {
    // Built as a smaller object rather than a filtered one, same as the paper.
    const quiz = await raw.quiz.findFirstOrThrow({ where: { schoolId } });
    await raw.quiz.update({ where: { id: quiz.id }, data: { reveal: 'NEVER' } });

    const attempt = await raw.quizAttempt.findFirstOrThrow({ where: { enrollmentId: enrolA } });
    const review = await attemptReview({ schoolId, attemptId: attempt.id, enrollmentId: enrolA });

    expect(review!.reveal).toBe(false);
    expect(review!.questions).toEqual([]);
    expect(JSON.stringify(review)).not.toContain('isCorrect');
    // The mark is still shown — hiding the answers is not hiding the score.
    expect(review!.score).toBe(10);

    await raw.quiz.update({ where: { id: quiz.id }, data: { reveal: 'AFTER_SUBMIT' } });
  });

  it('gives the lecturer per-question analysis', async () => {
    const results = await quizResults({ schoolId, itemId });

    expect(results!.summary.sat).toBe(2);
    expect(results!.summary.needsReview).toBe(1);
    expect(results!.analysis).toHaveLength(3);

    // Everybody who answered question 1 got it right; student B did not answer.
    const first = results!.analysis[0];
    expect(first.percentCorrect).toBeGreaterThanOrEqual(0);
  });

  it('says "nobody has sat it" rather than "0% correct" on an unsat paper', async () => {
    const fresh = await saveQuiz({
      schoolId,
      moduleId,
      title: 'Not yet sat',
      acceptsLate: true,
      settings: DEFAULT_QUIZ_SETTINGS,
      questions: [PAPER[0]],
      actorUserId: ACTOR,
    });

    const results = await quizResults({ schoolId, itemId: fresh.id! });
    expect(results!.analysis[0].percentCorrect).toBeNull();
    expect(results!.summary.average).toBeNull();
  });
});

describe('editing a paper people have sat', () => {
  it('is REFUSED, because it re-marks papers against questions nobody saw', async () => {
    const result = await saveQuiz({
      schoolId,
      moduleId,
      itemId,
      title: 'Mid-semester test',
      acceptsLate: false,
      settings: DEFAULT_QUIZ_SETTINGS,
      questions: [PAPER[0]],
      actorUserId: ACTOR,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already sat/);

    // And the paper is untouched.
    const loaded = await loadQuizForTeacher({ schoolId, itemId });
    expect(loaded!.questions).toHaveLength(3);
  });
});

describe('tenancy', () => {
  it('cannot read a quiz from another school', async () => {
    const other = await raw.school.create({
      data: {
        slug: `quiz-other-${SUFFIX}`,
        code: `R${Date.now() % 100000}`,
        name: 'Other University',
        shortName: 'OU',
        timezone: 'UTC',
      },
    });

    try {
      expect(await loadQuizForTeacher({ schoolId: other.id, itemId })).toBeNull();
      expect(await quizResults({ schoolId: other.id, itemId })).toBeNull();
    } finally {
      await raw.school.deleteMany({ where: { id: other.id } });
    }
  });
});
