import 'server-only';

import {
  DEFAULT_QUIZ_SETTINGS,
  markQuiz,
  mayAcceptSubmission,
  mayRevealAnswers,
  mayStartAttempt,
  orderFor,
  totalPoints,
  validateQuiz,
  type GivenAnswer,
  type QuestionKind,
  type QuizQuestion,
  type QuizSettings,
  type RevealPolicy,
} from '@/lib/domain/quiz';
import { validateItemDraft } from '@/lib/domain/lms';
import { dbFor } from '@/lib/tenant';
import { recordAudit } from '@/server/services/audit.service';

/**
 * =============================================================================
 * QUIZZES
 * =============================================================================
 *
 * TWO READ PATHS, AND THEY ARE NOT THE SAME FUNCTION WITH A FLAG.
 *
 * `loadQuizForTeacher` returns the paper with its answers. `loadQuizForStudent`
 * BUILDS A SMALLER OBJECT that has never held the answers at all — it does not
 * fetch them and strip them, it does not select them. The distinction matters
 * because "not rendered" and "not in the payload" are different guarantees, and
 * only the second survives somebody opening the network tab during an
 * examination.
 *
 * That is the single most important property in this file, and
 * `tests/quiz-cycle.test.ts` asserts it against the serialised payload rather
 * than against my intentions.
 */

export interface QuizResult {
  ok: boolean;
  message: string;
  id?: string;
  attemptId?: string;
  score?: number;
}

// -----------------------------------------------------------------------------
// Reading a stored paper
// -----------------------------------------------------------------------------

interface StoredQuestion {
  id: string;
  kind: string;
  prompt: string;
  points: number;
  acceptedAnswers: string | null;
  options: { id: string; text: string; isCorrect: boolean; position: number }[];
}

function toDomain(rows: readonly StoredQuestion[]): QuizQuestion[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as QuestionKind,
    prompt: row.prompt,
    points: row.points,
    acceptedAnswers: (row.acceptedAnswers ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    options: [...row.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
  }));
}

function settingsOf(quiz: {
  timeLimitMinutes: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  reveal: string;
}): QuizSettings {
  return {
    timeLimitMinutes: quiz.timeLimitMinutes,
    maxAttempts: quiz.maxAttempts,
    shuffleQuestions: quiz.shuffleQuestions,
    shuffleOptions: quiz.shuffleOptions,
    reveal: quiz.reveal as RevealPolicy,
  };
}

// -----------------------------------------------------------------------------
// Authoring
// -----------------------------------------------------------------------------

export interface QuestionDraft {
  id?: string | null;
  kind: QuestionKind;
  prompt: string;
  points: number;
  acceptedAnswers?: string | null;
  options: { id?: string | null; text: string; isCorrect: boolean }[];
}

/**
 * Create or replace a quiz, its paper and its coursework row, atomically.
 *
 * The whole paper is written at once rather than question by question. A quiz
 * is edited as a document — you do not publish half a paper — and a partial
 * save would leave a quiz whose `pointsPossible` no longer matches the sum of
 * its questions, which is a gradebook that quietly disagrees with itself.
 */
export async function saveQuiz(params: {
  schoolId: string;
  moduleId: string;
  /** The ModuleItem id, when editing. */
  itemId?: string | null;
  title: string;
  instructions?: string | null;
  dueAt?: Date | null;
  acceptsLate: boolean;
  settings: QuizSettings;
  questions: QuestionDraft[];
  actorUserId: string;
  now?: Date;
}): Promise<QuizResult> {
  const db = dbFor(params.schoolId);

  // Validated as a DOMAIN object, with ids filled in for the ones not yet
  // saved, so the same rules apply to a new paper and an edited one.
  const asDomain: QuizQuestion[] = params.questions.map((q, i) => ({
    id: q.id ?? `new-${i}`,
    kind: q.kind,
    prompt: q.prompt,
    points: q.points,
    acceptedAnswers: (q.acceptedAnswers ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    options: q.options.map((o, j) => ({
      id: o.id ?? `new-${i}-${j}`,
      text: o.text,
      isCorrect: o.isCorrect,
    })),
  }));

  const problems = [
    ...validateItemDraft({ kind: 'QUIZ', title: params.title }),
    ...validateQuiz(asDomain, params.settings),
  ];
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const module = await db.courseModule.findUnique({ where: { id: params.moduleId } });
  if (!module) return { ok: false, message: 'That module is not part of this school.' };

  /*
   * The marks available are the SUM of the questions, never typed separately.
   * Two numbers that must agree and can be edited apart eventually disagree,
   * and here that would rescale every mark already given.
   */
  const pointsPossible = totalPoints(asDomain);

  const courseworkData = {
    instructions: params.instructions?.trim() || null,
    pointsPossible,
    dueAt: params.dueAt ?? null,
    // A quiz is answered in the paper, not by typing prose or attaching a file.
    allowsText: false,
    allowsFile: false,
    acceptsLate: params.acceptsLate,
  };

  const quizData = {
    timeLimitMinutes: params.settings.timeLimitMinutes,
    maxAttempts: params.settings.maxAttempts,
    shuffleQuestions: params.settings.shuffleQuestions,
    shuffleOptions: params.settings.shuffleOptions,
    reveal: params.settings.reveal,
  };

  try {
    if (params.itemId) {
      const existing = await db.moduleItem.findFirst({
        where: { id: params.itemId, moduleId: module.id },
        include: {
          coursework: {
            include: {
              quiz: { select: { id: true } },
              _count: { select: { submissions: true } },
            },
          },
        },
      });
      if (!existing?.coursework?.quiz) {
        return { ok: false, message: 'That quiz no longer exists.' };
      }

      /*
       * THE PAPER IS FROZEN ONCE ANYBODY HAS SAT IT.
       *
       * Same reasoning as coursework's mark scheme, and more acute: editing a
       * question after attempts exist re-marks papers already sat, against
       * questions those students never saw. The deadline and the instructions
       * stay editable.
       */
      const sat = existing.coursework._count.submissions;
      if (sat > 0) {
        return {
          ok: false,
          message: `${sat} student${sat === 1 ? ' has' : 's have'} already sat this quiz, so the paper cannot be changed. Create a new quiz instead.`,
        };
      }

      const quizId = existing.coursework.quiz.id;

      await db.$transaction(async (tx) => {
        await tx.moduleItem.update({
          where: { id: existing.id },
          data: { title: params.title.trim() },
        });
        await tx.coursework.update({
          where: { id: existing.coursework!.id },
          data: courseworkData,
        });
        await tx.quiz.update({ where: { id: quizId }, data: quizData });

        // Replace the paper wholesale. Options cascade from their questions.
        await tx.quizQuestion.deleteMany({ where: { quizId } });
        await writeQuestions(tx, params.schoolId, quizId, params.questions);
      });

      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'lms.quiz.update',
        entityType: 'Quiz',
        entityId: quizId,
        summary: `Quiz "${params.title.trim()}" edited — ${params.questions.length} questions, ${pointsPossible} marks.`,
      });

      return { ok: true, message: 'Quiz saved.', id: existing.id };
    }

    const siblings = await db.moduleItem.findMany({
      where: { moduleId: module.id },
      select: { position: true },
    });
    const position = siblings.reduce((max, s) => Math.max(max, s.position), 0) + 100;

    const item = await db.$transaction(async (tx) => {
      const created = await tx.moduleItem.create({
        data: {
          schoolId: params.schoolId,
          moduleId: module.id,
          kind: 'QUIZ',
          title: params.title.trim(),
          position,
          isPublished: false,
        },
      });

      const coursework = await tx.coursework.create({
        data: { schoolId: params.schoolId, moduleItemId: created.id, ...courseworkData },
      });

      const quiz = await tx.quiz.create({
        data: { schoolId: params.schoolId, courseworkId: coursework.id, ...quizData },
      });

      await writeQuestions(tx, params.schoolId, quiz.id, params.questions);
      return created;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.quiz.create',
      entityType: 'ModuleItem',
      entityId: item.id,
      summary: `Quiz "${params.title.trim()}" created — ${params.questions.length} questions, ${pointsPossible} marks.`,
    });

    return { ok: true, message: 'Quiz created. Publish it when the paper is ready.', id: item.id };
  } catch (error) {
    console.error('[quiz] save failed', error);
    return { ok: false, message: 'Could not save that quiz.' };
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof dbFor>['$transaction']>[0]>[0];

async function writeQuestions(
  tx: Tx,
  schoolId: string,
  quizId: string,
  questions: readonly QuestionDraft[],
): Promise<void> {
  for (const [i, question] of questions.entries()) {
    const created = await tx.quizQuestion.create({
      data: {
        schoolId,
        quizId,
        // Sparse, so a later reorder rewrites one row rather than the paper.
        position: (i + 1) * 100,
        kind: question.kind,
        prompt: question.prompt.trim(),
        points: question.points,
        acceptedAnswers: question.acceptedAnswers?.trim() || null,
      },
    });

    if (question.kind === 'SHORT_ANSWER') continue;

    await tx.quizOption.createMany({
      data: question.options.map((option, j) => ({
        schoolId,
        questionId: created.id,
        position: (j + 1) * 100,
        text: option.text.trim(),
        isCorrect: option.isCorrect,
      })),
    });
  }
}

// -----------------------------------------------------------------------------
// The lecturer's view
// -----------------------------------------------------------------------------

export async function loadQuizForTeacher(params: { schoolId: string; itemId: string }) {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: {
      module: { select: { id: true, spaceId: true, space: { select: { offeringId: true } } } },
      coursework: {
        include: {
          quiz: { include: { questions: { include: { options: true } } } },
          _count: { select: { submissions: true } },
        },
      },
    },
  });

  if (!item?.coursework?.quiz) return null;

  const questions = toDomain(item.coursework.quiz.questions as StoredQuestion[]).sort(
    (a, b) => order(item.coursework!.quiz!.questions, a.id) - order(item.coursework!.quiz!.questions, b.id),
  );

  return {
    itemId: item.id,
    moduleId: item.module.id,
    offeringId: item.module.space.offeringId,
    title: item.title,
    isPublished: item.isPublished,
    instructions: item.coursework.instructions,
    dueAt: item.coursework.dueAt,
    acceptsLate: item.coursework.acceptsLate,
    pointsPossible: item.coursework.pointsPossible,
    settings: settingsOf(item.coursework.quiz),
    questions,
    attemptsSoFar: item.coursework._count.submissions,
  };
}

function order(rows: readonly { id: string; position: number }[], id: string): number {
  return rows.find((r) => r.id === id)?.position ?? 0;
}

// -----------------------------------------------------------------------------
// The student's view — a SMALLER object, never a filtered one
// -----------------------------------------------------------------------------

export interface StudentOption {
  id: string;
  text: string;
}

export interface StudentQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  options: StudentOption[];
}

export interface StudentPaper {
  attemptId: string;
  quizTitle: string;
  instructions: string | null;
  questions: StudentQuestion[];
  /** Server-authoritative. The countdown on screen is drawn from this. */
  secondsRemaining: number | null;
  timeLimitMinutes: number | null;
  answers: GivenAnswer[];
  submittedAt: Date | null;
}

/**
 * The paper as a student sits it.
 *
 * Note what is absent: `isCorrect`, `acceptedAnswers`, and any field derived
 * from them. `StudentOption` HAS NO `isCorrect` PROPERTY — the type makes the
 * leak impossible rather than merely unlikely, so a future edit that tried to
 * pass one through would not compile.
 */
export async function loadPaper(params: {
  schoolId: string;
  attemptId: string;
  enrollmentId: string;
  now?: Date;
}): Promise<StudentPaper | null> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const attempt = await db.quizAttempt.findFirst({
    // Scoped by enrolment as well as by id: a crafted attempt id must not open
    // somebody else's paper, complete with the answers they have given.
    where: { id: params.attemptId, enrollmentId: params.enrollmentId },
    include: {
      quiz: {
        include: {
          coursework: { include: { moduleItem: { select: { title: true } } } },
          questions: {
            select: {
              id: true,
              kind: true,
              prompt: true,
              points: true,
              position: true,
              options: { select: { id: true, text: true, position: true } },
            },
          },
        },
      },
    },
  });

  if (!attempt) return null;

  const stored: string[] = safeParse<string[]>(attempt.orderJson, []);
  const byId = new Map(attempt.quiz.questions.map((q) => [q.id, q]));

  const ordered = stored
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q));

  const questions: StudentQuestion[] = ordered.map((q) => ({
    id: q.id,
    kind: q.kind as QuestionKind,
    prompt: q.prompt,
    points: q.points,
    options: [...q.options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, text: o.text })),
  }));

  return {
    attemptId: attempt.id,
    quizTitle: attempt.quiz.coursework.moduleItem.title,
    instructions: attempt.quiz.coursework.instructions,
    questions,
    secondsRemaining: attempt.quiz.timeLimitMinutes
      ? Math.max(
          0,
          Math.round(
            (attempt.startedAt.getTime() +
              attempt.quiz.timeLimitMinutes * 60_000 -
              now.getTime()) /
              1000,
          ),
        )
      : null,
    timeLimitMinutes: attempt.quiz.timeLimitMinutes,
    answers: safeParse<GivenAnswer[]>(attempt.answersJson, []),
    submittedAt: attempt.submittedAt,
  };
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    // A corrupt column must not take a student's whole paper down with it.
    return fallback;
  }
}

// -----------------------------------------------------------------------------
// Sitting it
// -----------------------------------------------------------------------------

/**
 * Begin, or resume.
 *
 * RESUMING IS THE COMMON CASE and it is handled first. A browser that crashed,
 * a phone that slept, a network that dropped — all of these look identical from
 * here, and every one of them must return the student to the paper they were
 * on, with the answers they had given and the clock where it actually is. A
 * function that started a fresh attempt instead would consume one of their
 * attempts and reset their work.
 */
export async function startAttempt(params: {
  schoolId: string;
  itemId: string;
  enrollmentId: string;
  actorUserId: string;
  now?: Date;
}): Promise<QuizResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: {
      module: { select: { isPublished: true, unlockAt: true } },
      coursework: { include: { quiz: { include: { questions: { select: { id: true } } } } } },
    },
  });

  if (!item?.coursework?.quiz) return { ok: false, message: 'That quiz does not exist.' };

  /*
   * A student must not reach an unpublished or locked quiz by its id. The
   * module list already hides it; this is the gate that actually holds.
   */
  if (!item.isPublished || !item.module.isPublished) {
    return { ok: false, message: 'That quiz does not exist.' };
  }
  if (item.module.unlockAt && now < item.module.unlockAt) {
    return { ok: false, message: 'That quiz is not open yet.' };
  }

  const quiz = item.coursework.quiz;

  const existing = await db.quizAttempt.findMany({
    where: { quizId: quiz.id, enrollmentId: params.enrollmentId },
    orderBy: { attempt: 'desc' },
  });

  const open = existing.find((a) => a.submittedAt === null);
  if (open) {
    const verdict = mayAcceptSubmission(
      { startedAt: open.startedAt, submittedAt: null, order: [] },
      quiz.timeLimitMinutes,
      now,
    );
    if (verdict.ok) {
      return { ok: true, message: 'Resuming your attempt.', attemptId: open.id };
    }

    /*
     * An open attempt whose time ran out — the student closed the tab and did
     * not come back. It is submitted with whatever they had given, because
     * leaving it open for ever would consume their attempt and never produce a
     * mark for work they actually did.
     */
    await submitAttempt({
      schoolId: params.schoolId,
      attemptId: open.id,
      enrollmentId: params.enrollmentId,
      answers: safeParse<GivenAnswer[]>(open.answersJson, []),
      actorUserId: params.actorUserId,
      now,
      expired: true,
    });
    return { ok: false, message: 'Your previous attempt ran out of time and has been handed in.' };
  }

  const allowed = mayStartAttempt({
    attemptsSoFar: existing.length,
    maxAttempts: quiz.maxAttempts,
    dueAt: item.coursework.dueAt,
    acceptsLate: item.coursework.acceptsLate,
    now,
  });
  if (!allowed.ok) return { ok: false, message: allowed.reason! };

  const attemptNumber = existing.length + 1;
  const questions = toDomain(
    (await db.quizQuestion.findMany({
      where: { quizId: quiz.id },
      include: { options: true },
      orderBy: { position: 'asc' },
    })) as StoredQuestion[],
  );

  // Seeded on the enrolment and attempt, so the paper is stable for this
  // student and different from the person beside them.
  const seed = `${quiz.id}:${params.enrollmentId}:${attemptNumber}`;
  const order = orderFor(questions, settingsOf(quiz), seed);

  try {
    const created = await db.quizAttempt.create({
      data: {
        schoolId: params.schoolId,
        quizId: quiz.id,
        enrollmentId: params.enrollmentId,
        attempt: attemptNumber,
        startedAt: now,
        orderJson: JSON.stringify(order),
        answersJson: '[]',
      },
    });

    return { ok: true, message: 'Good luck.', attemptId: created.id };
  } catch (error) {
    console.error('[quiz] start failed', error);
    return { ok: false, message: 'Could not start that attempt.' };
  }
}

/**
 * Autosave.
 *
 * Called often and deliberately cheap: one row, one column. A student sitting
 * an examination on a phone in a hall with poor signal loses the tab, and what
 * makes that survivable is that their answers were already written down.
 *
 * It does NOT mark, and it does not refuse after the deadline — a save that
 * lands a second late still preserves work, and whether the SUBMISSION counts
 * is decided in one place, on submit.
 */
export async function saveAnswers(params: {
  schoolId: string;
  attemptId: string;
  enrollmentId: string;
  answers: readonly GivenAnswer[];
}): Promise<QuizResult> {
  const db = dbFor(params.schoolId);

  const attempt = await db.quizAttempt.findFirst({
    where: { id: params.attemptId, enrollmentId: params.enrollmentId, submittedAt: null },
    select: { id: true },
  });
  if (!attempt) return { ok: false, message: 'That attempt is not open.' };

  try {
    await db.quizAttempt.update({
      where: { id: attempt.id },
      data: { answersJson: JSON.stringify(params.answers) },
    });
    return { ok: true, message: 'Saved.' };
  } catch (error) {
    console.error('[quiz] autosave failed', error);
    return { ok: false, message: 'Could not save.' };
  }
}

/**
 * Hand it in, mark it, and record it as a Submission.
 *
 * The Submission is what makes a quiz a piece of coursework: from here on the
 * gradebook, the CA roll-up and the student's own page treat this exactly like
 * an essay that happens to already have a mark on it.
 */
export async function submitAttempt(params: {
  schoolId: string;
  attemptId: string;
  enrollmentId: string;
  answers: readonly GivenAnswer[];
  actorUserId: string;
  now?: Date;
  /** Set when the server is closing an abandoned attempt, not the student. */
  expired?: boolean;
}): Promise<QuizResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const attempt = await db.quizAttempt.findFirst({
    where: { id: params.attemptId, enrollmentId: params.enrollmentId },
    include: {
      quiz: {
        include: {
          coursework: { select: { id: true, dueAt: true } },
          questions: { include: { options: true }, orderBy: { position: 'asc' } },
        },
      },
    },
  });
  if (!attempt) return { ok: false, message: 'That attempt is not yours.' };

  const verdict = mayAcceptSubmission(
    { startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, order: [] },
    attempt.quiz.timeLimitMinutes,
    now,
  );

  // An expiry sweep submits what it has; a student cannot.
  if (!verdict.ok && !params.expired) return { ok: false, message: verdict.reason! };

  const questions = toDomain(attempt.quiz.questions as StoredQuestion[]);
  const marked = markQuiz(questions, params.answers);

  const dueAt = attempt.quiz.coursework.dueAt;
  const isLate = Boolean(dueAt && now > dueAt);

  try {
    await db.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          schoolId: params.schoolId,
          courseworkId: attempt.quiz.coursework.id,
          enrollmentId: params.enrollmentId,
          attempt: attempt.attempt,
          submittedAt: now,
          isLate,
          /*
           * The mark is set here, by the machine. A question needing review
           * leaves the score in place and raises the flag — a lecturer
           * adjusting it later overwrites this, and `autoScore` on the attempt
           * keeps what the machine said.
           */
          score: marked.earned,
          gradedAt: now,
        },
      });

      await tx.quizAttempt.update({
        where: { id: attempt.id },
        data: {
          submittedAt: now,
          answersJson: JSON.stringify(params.answers),
          autoScore: marked.earned,
          needsReview: marked.needsReview,
          submissionId: submission.id,
        },
      });
    });
  } catch (error) {
    console.error('[quiz] submit failed', error);
    return { ok: false, message: 'Could not hand that in.' };
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.expired ? 'lms.quiz.expired' : 'lms.quiz.submit',
    entityType: 'QuizAttempt',
    entityId: attempt.id,
    summary:
      `Attempt ${attempt.attempt} ${params.expired ? 'expired and was' : ''} handed in — ` +
      `${marked.earned}/${marked.possible}${marked.needsReview ? ', needs review' : ''}.`,
  });

  return {
    ok: true,
    message: marked.needsReview
      ? 'Handed in. Some answers need a lecturer to look at them, so your mark may change.'
      : 'Handed in.',
    score: marked.earned,
    attemptId: attempt.id,
  };
}

// -----------------------------------------------------------------------------
// Afterwards
// -----------------------------------------------------------------------------

/** What a student may see of their own attempt once it is over. */
export async function attemptReview(params: {
  schoolId: string;
  attemptId: string;
  enrollmentId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const attempt = await db.quizAttempt.findFirst({
    where: { id: params.attemptId, enrollmentId: params.enrollmentId },
    include: {
      quiz: {
        include: {
          coursework: {
            select: { dueAt: true, pointsPossible: true, moduleItem: { select: { title: true } } },
          },
          questions: { include: { options: true }, orderBy: { position: 'asc' } },
        },
      },
    },
  });
  if (!attempt || !attempt.submittedAt) return null;

  const reveal = mayRevealAnswers(attempt.quiz.reveal as RevealPolicy, {
    submitted: true,
    dueAt: attempt.quiz.coursework.dueAt,
    now,
  });

  const questions = toDomain(attempt.quiz.questions as StoredQuestion[]);
  const answers = safeParse<GivenAnswer[]>(attempt.answersJson, []);
  const marked = markQuiz(questions, answers);

  return {
    title: attempt.quiz.coursework.moduleItem.title,
    submittedAt: attempt.submittedAt,
    score: attempt.autoScore ?? 0,
    possible: attempt.quiz.coursework.pointsPossible,
    needsReview: attempt.needsReview,
    reveal,
    /*
     * When the policy says no, the review carries marks and NOTHING ELSE.
     * Built as a smaller object rather than a filtered one, for the same
     * reason the paper is.
     */
    questions: reveal
      ? questions.map((q, i) => ({
          id: q.id,
          prompt: q.prompt,
          points: q.points,
          earned: marked.perQuestion[i].earned,
          correct: marked.perQuestion[i].correct,
          options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
          given: answers.find((a) => a.questionId === q.id) ?? null,
        }))
      : [],
  };
}

/**
 * Every attempt on a quiz, with per-question analysis.
 *
 * The analysis is the thing a lecturer actually acts on: a question the whole
 * cohort got wrong is usually a badly worded question, not a cohort that did
 * not revise. Computed in memory from the stored answers, which for four
 * hundred students is one query.
 */
export async function quizResults(params: { schoolId: string; itemId: string }) {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: {
      coursework: {
        include: {
          quiz: {
            include: {
              questions: { include: { options: true }, orderBy: { position: 'asc' } },
              attempts: {
                where: { submittedAt: { not: null } },
                include: {
                  enrollment: {
                    include: {
                      student: {
                        select: {
                          matricNumber: true,
                          user: { select: { firstName: true, lastName: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!item?.coursework?.quiz) return null;

  const questions = toDomain(item.coursework.quiz.questions as StoredQuestion[]);
  const possible = totalPoints(questions);

  const attempts = item.coursework.quiz.attempts.map((a) => {
    const answers = safeParse<GivenAnswer[]>(a.answersJson, []);
    const marked = markQuiz(questions, answers);
    return {
      attemptId: a.id,
      enrollmentId: a.enrollmentId,
      name: `${a.enrollment.student.user.firstName} ${a.enrollment.student.user.lastName}`.trim(),
      matricNumber: a.enrollment.student.matricNumber,
      attempt: a.attempt,
      submittedAt: a.submittedAt!,
      score: a.autoScore ?? marked.earned,
      needsReview: a.needsReview,
      perQuestion: marked.perQuestion,
    };
  });

  const analysis = questions.map((question, i) => {
    const marks = attempts.map((a) => a.perQuestion[i]).filter(Boolean);
    const correct = marks.filter((m) => m.correct).length;
    return {
      questionId: question.id,
      prompt: question.prompt,
      points: question.points,
      answered: marks.length,
      correct,
      // Null rather than 0 when nobody has sat it: "0% got this right" and
      // "nobody has taken it" are different findings.
      percentCorrect: marks.length > 0 ? Math.round((correct / marks.length) * 100) : null,
    };
  });

  const scores = attempts.map((a) => a.score);

  return {
    itemId: item.id,
    title: item.title,
    possible,
    attempts: attempts.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()),
    analysis,
    summary: {
      sat: attempts.length,
      needsReview: attempts.filter((a) => a.needsReview).length,
      average:
        scores.length > 0
          ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100
          : null,
      highest: scores.length > 0 ? Math.max(...scores) : null,
      lowest: scores.length > 0 ? Math.min(...scores) : null,
    },
  };
}

export { DEFAULT_QUIZ_SETTINGS };
