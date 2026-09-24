import type { PrismaClient } from '@prisma/client';

/**
 * =============================================================================
 * THE TEACHING SEED — course content, a quiz, and a register
 * =============================================================================
 *
 * Everything a demonstration needs and the seed did not previously produce.
 * Before this, `npm run seed` made a school with students, staff, fees, tasks,
 * forums and a library — and NO COURSE CONTENT AT ALL. Every LMS screen, the
 * quiz screens and the attendance screens were empty on a fresh database, which
 * is the worst possible first impression of the half of the product a
 * university actually asks about.
 *
 * WHAT IT SEEDS, and why each piece is shaped the way it is:
 *
 *   · Modules with a page, a link and a virtual class, so a module list shows
 *     more than one kind of row.
 *   · A quiz that several students have SAT, with different marks and one
 *     typed answer that did not match — so the results screen has a spread and
 *     the "needs a look" count is not zero. A quiz nobody has taken shows an
 *     empty table and proves nothing.
 *   · Teaching logs across several weeks WITH REGISTERS, including one session
 *     deliberately left unmarked and one class cancelled. An attendance page
 *     where every session is perfectly marked hides the two states a lecturer
 *     most needs to see.
 *   · One student who is genuinely behind. A cohort where everybody is at 100%
 *     demonstrates nothing about a rule that exists to catch the person who
 *     is not.
 *
 * IDEMPOTENT. It looks for its own marker and does nothing on a second run, so
 * re-seeding does not stack four quizzes on one course.
 */

const MARKER = 'Continuous Assessment';

export interface TeachingSeedResult {
  skipped: boolean;
  modules: number;
  items: number;
  quizzes: number;
  attempts: number;
  sessions: number;
  marks: number;
}

const EMPTY: TeachingSeedResult = {
  skipped: true,
  modules: 0,
  items: 0,
  quizzes: 0,
  attempts: 0,
  sessions: 0,
  marks: 0,
};

export async function seedTeaching(
  db: PrismaClient,
  schoolId: string,
  today: Date,
): Promise<TeachingSeedResult> {
  /*
   * The section to furnish: the one with the most students on it, so the
   * register and the quiz results both have a cohort rather than a pair.
   */
  const candidates = await db.courseOffering.findMany({
    where: {
      schoolId,
      term: { isCurrent: true },
      instructorId: { not: null },
      enrollments: { some: { status: { in: ['REGISTERED', 'COMPLETED'] } } },
    },
    include: {
      course: true,
      instructor: true,
      enrollments: {
        where: { status: { in: ['REGISTERED', 'COMPLETED'] } },
        orderBy: { id: 'asc' },
      },
    },
  });

  /*
   * THE BIGGEST COHORT, not the first one found.
   *
   * The varied scripts below only produce a spread if there are people to
   * spread across. Picking `findFirst` landed on a section with ONE student,
   * who got the full-marks script — so the results page showed a single row at
   * 100%, no flagged answer and nobody behind on attendance. Every screen this
   * seed exists to populate was technically populated and demonstrated nothing.
   */
  const offering = candidates
    .slice()
    .sort((a, b) => b.enrollments.length - a.enrollments.length)[0];

  if (!offering || !offering.instructorId || offering.enrollments.length === 0) return EMPTY;

  const space = await db.courseSpace.upsert({
    where: { offeringId: offering.id },
    create: { schoolId, termId: offering.termId, offeringId: offering.id },
    update: {},
  });

  // Already done? Leave it alone rather than stacking a second set.
  const existing = await db.courseModule.findFirst({
    where: { spaceId: space.id, title: MARKER },
  });
  if (existing) return EMPTY;

  const membership = await db.membership.findFirst({
    where: { schoolId, userId: offering.instructor!.userId },
  });
  if (!membership) return EMPTY;

  const result: TeachingSeedResult = { ...EMPTY, skipped: false };

  // --- the content ----------------------------------------------------------
  const intro = await db.courseModule.create({
    data: {
      schoolId,
      spaceId: space.id,
      title: 'Getting started',
      description: 'Read this first.',
      position: 100,
      isPublished: true,
    },
  });
  result.modules += 1;

  await db.moduleItem.createMany({
    data: [
      {
        schoolId,
        moduleId: intro.id,
        kind: 'PAGE',
        title: 'How this course is assessed',
        position: 100,
        isPublished: true,
        bodyMarkdown:
          `**${offering.course.title}** is assessed by continuous assessment and a final examination.\n\n` +
          'Continuous assessment is made up of the quizzes and assignments in this course. ' +
          'You must attend at least 75% of classes to sit the examination.',
      },
      {
        schoolId,
        moduleId: intro.id,
        kind: 'LINK',
        title: 'Recommended reading list',
        position: 200,
        isPublished: true,
        externalUrl: 'https://example.edu/reading-list',
      },
    ],
  });
  result.items += 2;

  const assessment = await db.courseModule.create({
    data: {
      schoolId,
      spaceId: space.id,
      title: MARKER,
      description: 'Quizzes and assignments that count towards your CA mark.',
      position: 200,
      isPublished: true,
    },
  });
  result.modules += 1;

  // --- a quiz people have actually sat --------------------------------------
  const quizItem = await db.moduleItem.create({
    data: {
      schoolId,
      moduleId: assessment.id,
      kind: 'QUIZ',
      title: 'Quiz 1 — fundamentals',
      position: 100,
      isPublished: true,
    },
  });
  result.items += 1;

  const quizCoursework = await db.coursework.create({
    data: {
      schoolId,
      moduleItemId: quizItem.id,
      instructions: 'Twenty minutes. Answer every question.',
      pointsPossible: 10,
      dueAt: addDays(today, -3),
      acceptsLate: false,
      allowsText: false,
      allowsFile: false,
    },
  });

  const quiz = await db.quiz.create({
    data: {
      schoolId,
      courseworkId: quizCoursework.id,
      timeLimitMinutes: 20,
      maxAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: false,
      reveal: 'AFTER_DUE',
    },
  });
  result.quizzes += 1;

  const questions = await Promise.all(
    [
      {
        kind: 'SINGLE_CHOICE',
        prompt: 'Which of these is a valid identifier?',
        points: 2,
        options: [
          { text: 'total_marks', isCorrect: true },
          { text: '2ndPlace', isCorrect: false },
          { text: 'class name', isCorrect: false },
        ],
      },
      {
        kind: 'TRUE_FALSE',
        prompt: 'An algorithm must always terminate.',
        points: 2,
        options: [
          { text: 'True', isCorrect: true },
          { text: 'False', isCorrect: false },
        ],
      },
      {
        kind: 'MULTI_CHOICE',
        prompt: 'Which of these have constant-time lookup on average?',
        points: 3,
        options: [
          { text: 'Hash table', isCorrect: true },
          { text: 'Array, by index', isCorrect: true },
          { text: 'Linked list, by value', isCorrect: false },
        ],
      },
      {
        kind: 'SHORT_ANSWER',
        prompt: 'What does CPU stand for?',
        points: 3,
        acceptedAnswers: 'Central Processing Unit',
        options: [],
      },
    ].map(async (q, i) => {
      const created = await db.quizQuestion.create({
        data: {
          schoolId,
          quizId: quiz.id,
          position: (i + 1) * 100,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          acceptedAnswers: q.acceptedAnswers ?? null,
        },
      });
      if (q.options.length > 0) {
        await db.quizOption.createMany({
          data: q.options.map((o, j) => ({
            schoolId,
            questionId: created.id,
            position: (j + 1) * 100,
            text: o.text,
            isCorrect: o.isCorrect,
          })),
        });
      }
      return db.quizQuestion.findUniqueOrThrow({
        where: { id: created.id },
        include: { options: true },
      });
    }),
  );

  const correct = (index: number) =>
    questions[index].options.filter((o) => o.isCorrect).map((o) => o.id);

  /*
   * Deliberately varied. A screen where everybody scored 10/10 shows nothing
   * about a results page, and the "needs a look" count would be zero — hiding
   * the one behaviour that most needs demonstrating.
   */
  const scripts = [
    { label: 'full marks', answers: 'all' as const },
    { label: 'one wrong', answers: 'mostly' as const },
    { label: 'unmatched typed answer', answers: 'typo' as const },
    { label: 'struggled', answers: 'poor' as const },
  ];

  for (const [i, enrolment] of offering.enrollments.entries()) {
    const script = scripts[i % scripts.length];

    const answers =
      script.answers === 'all'
        ? [
            { questionId: questions[0].id, optionIds: correct(0) },
            { questionId: questions[1].id, optionIds: correct(1) },
            { questionId: questions[2].id, optionIds: correct(2) },
            { questionId: questions[3].id, text: 'Central Processing Unit' },
          ]
        : script.answers === 'mostly'
          ? [
              { questionId: questions[0].id, optionIds: correct(0) },
              { questionId: questions[1].id, optionIds: [questions[1].options[1].id] },
              { questionId: questions[2].id, optionIds: correct(2) },
              { questionId: questions[3].id, text: 'central processing unit' },
            ]
          : script.answers === 'typo'
            ? [
                { questionId: questions[0].id, optionIds: correct(0) },
                { questionId: questions[1].id, optionIds: correct(1) },
                { questionId: questions[2].id, optionIds: [questions[2].options[0].id] },
                // Right idea, not the accepted wording — flagged for a person.
                { questionId: questions[3].id, text: 'Central Processor' },
              ]
            : [
                { questionId: questions[0].id, optionIds: [questions[0].options[1].id] },
                { questionId: questions[1].id, optionIds: [questions[1].options[1].id] },
                { questionId: questions[2].id, optionIds: [questions[2].options[2].id] },
                { questionId: questions[3].id, text: 'dunno' },
              ];

    // Marked with the same rules the app uses, so the seeded numbers and a
    // re-mark would agree.
    const { markQuiz } = await import('../src/lib/domain/quiz');
    const marked = markQuiz(
      questions.map((q) => ({
        id: q.id,
        kind: q.kind as never,
        prompt: q.prompt,
        points: q.points,
        acceptedAnswers: (q.acceptedAnswers ?? '').split('\n').filter(Boolean),
        options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
      })),
      answers,
    );

    const submittedAt = addDays(today, -4);
    const submission = await db.submission.create({
      data: {
        schoolId,
        courseworkId: quizCoursework.id,
        enrollmentId: enrolment.id,
        attempt: 1,
        submittedAt,
        isLate: false,
        score: marked.earned,
        gradedAt: submittedAt,
      },
    });

    await db.quizAttempt.create({
      data: {
        schoolId,
        quizId: quiz.id,
        enrollmentId: enrolment.id,
        attempt: 1,
        startedAt: addMinutes(submittedAt, -14),
        submittedAt,
        orderJson: JSON.stringify(questions.map((q) => q.id)),
        answersJson: JSON.stringify(answers),
        autoScore: marked.earned,
        needsReview: marked.needsReview,
        submissionId: submission.id,
      },
    });
    result.attempts += 1;
  }

  // --- classes, and who was in them -----------------------------------------
  /*
   * Five weeks. One session left UNMARKED and one CANCELLED, because an
   * attendance page where every session is perfectly marked hides the two
   * states a lecturer most needs to be able to see.
   */
  const weeks = [
    { back: 28, status: 'DELIVERED', mark: true, topic: 'Introduction' },
    { back: 21, status: 'DELIVERED', mark: true, topic: 'Data types' },
    { back: 14, status: 'CANCELLED', mark: false, topic: 'Public holiday' },
    { back: 7, status: 'DELIVERED', mark: false, topic: 'Control flow' },
    { back: 2, status: 'DELIVERED', mark: true, topic: 'Functions' },
  ];

  for (const week of weeks) {
    const day = addDays(today, -week.back);
    const log = await db.teachingLog.create({
      data: {
        schoolId,
        membershipId: membership.id,
        offeringId: offering.id,
        localDate: isoDate(day),
        startMinute: 9 * 60,
        endMinute: 11 * 60,
        durationMinutes: 120,
        status: week.status,
        topic: week.topic,
      },
    });
    result.sessions += 1;
    if (!week.mark) continue;

    for (const [i, enrolment] of offering.enrollments.entries()) {
      /*
       * The last student on the roster is the one genuinely behind — a cohort
       * where everybody is at 100% demonstrates nothing about a rule whose
       * whole purpose is catching the person who is not.
       */
      const behind = i === offering.enrollments.length - 1;
      const status = behind
        ? 'ABSENT'
        : i === 0 && week.back === 21
          ? 'EXCUSED'
          : i === 1 && week.back === 2
            ? 'LATE'
            : 'PRESENT';

      await db.classAttendance.create({
        data: {
          schoolId,
          teachingLogId: log.id,
          enrollmentId: enrolment.id,
          status,
          note: status === 'EXCUSED' ? 'Medical certificate provided.' : null,
          markedById: membership.id,
        },
      });
      result.marks += 1;
    }
  }

  return result;
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
