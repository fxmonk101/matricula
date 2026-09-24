/**
 * =============================================================================
 * QUIZZES, AND COMPUTER-BASED TESTING
 * =============================================================================
 *
 * A quiz here is a piece of COURSEWORK that marks itself.
 *
 * That is the load-bearing decision and it is worth stating plainly. A quiz
 * could have been its own thing with its own scores and its own roll-up, and
 * then there would be two answers to "what is this student's continuous
 * assessment" and a lecturer would eventually find them disagreeing. Instead a
 * quiz hangs off a `Coursework` row, an attempt produces a `Submission` with a
 * score in it, and every piece of machinery that already exists — the
 * gradebook, the CA weighting, due dates, late handling, the student's course
 * page — works on it without being told a quiz is different.
 *
 * WHY THIS MATTERS IN THIS MARKET. Computer-based testing is close to an
 * expectation for Nigerian universities: a cohort sits an examination in a hall
 * of terminals, marked the moment it ends. That imposes requirements a casual
 * quiz feature does not have, and they are what most of this file is about —
 * the clock is the server's, the question order is fixed per attempt, and a
 * browser that dies mid-paper must not cost a student their answers.
 */

export const QUESTION_KINDS = [
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'TRUE_FALSE',
  'SHORT_ANSWER',
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  SINGLE_CHOICE: 'One answer',
  MULTI_CHOICE: 'Several answers',
  TRUE_FALSE: 'True or false',
  SHORT_ANSWER: 'Typed answer',
};

export function isQuestionKind(value: unknown): value is QuestionKind {
  return (QUESTION_KINDS as readonly unknown[]).includes(value);
}

/** When a student may see which answers were right. */
export const REVEAL_POLICIES = ['NEVER', 'AFTER_SUBMIT', 'AFTER_DUE'] as const;
export type RevealPolicy = (typeof REVEAL_POLICIES)[number];

export const REVEAL_LABELS: Record<RevealPolicy, string> = {
  NEVER: 'Never show the answers',
  AFTER_SUBMIT: 'As soon as they submit',
  AFTER_DUE: 'After the closing date',
};

/**
 * AFTER_DUE exists because AFTER_SUBMIT leaks a paper.
 *
 * On a quiz the whole class sits over a week, revealing answers on submission
 * means the first student to finish can hand the answers to everybody who has
 * not started. For a timed examination sat simultaneously that does not apply,
 * which is why the choice is the lecturer's rather than a constant.
 */
export function mayRevealAnswers(
  policy: RevealPolicy,
  params: { submitted: boolean; dueAt: Date | null; now: Date },
): boolean {
  if (policy === 'NEVER') return false;
  if (!params.submitted) return false;
  if (policy === 'AFTER_SUBMIT') return true;
  // AFTER_DUE with no closing date can never arrive, so it never reveals.
  return params.dueAt !== null && params.now >= params.dueAt;
}

// -----------------------------------------------------------------------------
// The shape of a paper
// -----------------------------------------------------------------------------

export interface QuizOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  options: QuizOption[];
  /**
   * SHORT_ANSWER only: what counts as right, one per line.
   *
   * Compared after normalisation, so "Lagos", " lagos " and "LAGOS" are the
   * same answer. A question with none is not auto-markable and says so.
   */
  acceptedAnswers: string[];
}

export interface QuizSettings {
  /** Null means untimed. */
  timeLimitMinutes: number | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  reveal: RevealPolicy;
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  timeLimitMinutes: null,
  maxAttempts: 1,
  shuffleQuestions: false,
  shuffleOptions: false,
  reveal: 'AFTER_DUE',
};

/** Marks available, which is what `Coursework.pointsPossible` must equal. */
export function totalPoints(questions: readonly QuizQuestion[]): number {
  return round2(questions.reduce((sum, q) => sum + q.points, 0));
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export const QUIZ_LIMITS = {
  maxQuestions: 200,
  maxOptions: 10,
  maxPromptLength: 4000,
  maxPointsPerQuestion: 1000,
  maxTimeLimitMinutes: 8 * 60,
  maxAttempts: 20,
} as const;

/**
 * What is wrong with this question.
 *
 * Every one of these produces a paper that cannot be marked, and the time to
 * find that out is while it is being written — not while forty students are
 * sitting it.
 */
export function validateQuestion(question: QuizQuestion): string[] {
  const problems: string[] = [];

  if (!question.prompt.trim()) problems.push('The question has no text.');
  if (question.prompt.length > QUIZ_LIMITS.maxPromptLength) {
    problems.push('That question is too long.');
  }

  if (!(question.points > 0)) problems.push('A question must be worth more than nothing.');
  if (question.points > QUIZ_LIMITS.maxPointsPerQuestion) {
    problems.push('That is an implausible number of marks for one question.');
  }

  if (question.kind === 'SHORT_ANSWER') {
    if (question.acceptedAnswers.length === 0) {
      problems.push('A typed answer needs at least one accepted answer, or it cannot be marked.');
    }
    return problems;
  }

  const options = question.options;
  if (options.length < 2) problems.push('A choice question needs at least two options.');
  if (options.length > QUIZ_LIMITS.maxOptions) problems.push('That is too many options.');
  if (options.some((o) => !o.text.trim())) problems.push('One of the options is blank.');

  const correct = options.filter((o) => o.isCorrect).length;
  if (correct === 0) problems.push('None of the options is marked correct.');

  /*
   * A SINGLE_CHOICE question with two correct answers is not a harder question,
   * it is a broken one: whichever the student picks they are both right and
   * wrong, and the mark depends on which row happened to be checked first.
   */
  if (question.kind !== 'MULTI_CHOICE' && correct > 1) {
    problems.push('This kind of question can only have one correct option.');
  }

  if (question.kind === 'TRUE_FALSE' && options.length !== 2) {
    problems.push('A true-or-false question has exactly two options.');
  }

  return problems;
}

export function validateQuiz(
  questions: readonly QuizQuestion[],
  settings: QuizSettings,
): string[] {
  const problems: string[] = [];

  if (questions.length === 0) problems.push('A quiz needs at least one question.');
  if (questions.length > QUIZ_LIMITS.maxQuestions) problems.push('That is too many questions.');

  if (settings.timeLimitMinutes !== null) {
    if (settings.timeLimitMinutes <= 0) problems.push('A time limit must be more than nothing.');
    else if (settings.timeLimitMinutes > QUIZ_LIMITS.maxTimeLimitMinutes) {
      problems.push('That time limit is longer than any examination.');
    }
  }

  if (settings.maxAttempts < 1) problems.push('A quiz must allow at least one attempt.');
  if (settings.maxAttempts > QUIZ_LIMITS.maxAttempts) problems.push('That is too many attempts.');

  // Reported once with the count rather than once per question, so a paper with
  // thirty blank prompts produces one complaint and not thirty.
  const broken = questions.filter((q) => validateQuestion(q).length > 0).length;
  if (broken > 0) {
    problems.push(`${broken} ${broken === 1 ? 'question has' : 'questions have'} a problem.`);
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Sitting it
// -----------------------------------------------------------------------------

export interface AttemptState {
  startedAt: Date;
  submittedAt: Date | null;
  /** Question ids in the order THIS student sees them. */
  order: string[];
}

/**
 * When this attempt stops being accepted.
 *
 * THE CLOCK IS THE SERVER'S. The countdown a student sees is a convenience
 * drawn from this, and a browser whose clock is wrong — or whose owner has
 * changed it — does not get more time. Untimed quizzes have no deadline of
 * their own; the coursework's due date still applies.
 */
export function attemptExpiresAt(
  startedAt: Date,
  timeLimitMinutes: number | null,
): Date | null {
  if (timeLimitMinutes === null) return null;
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

export function secondsRemaining(
  startedAt: Date,
  timeLimitMinutes: number | null,
  now: Date,
): number | null {
  const expires = attemptExpiresAt(startedAt, timeLimitMinutes);
  if (!expires) return null;
  return Math.max(0, Math.round((expires.getTime() - now.getTime()) / 1000));
}

/**
 * A small allowance past the deadline.
 *
 * The submission a student presses at the last second travels over a mobile
 * network and arrives a moment later. Refusing it because the clock had turned
 * over would fail exactly the student who used every second of the time they
 * were given, which is not who the rule is for.
 */
export const SUBMIT_GRACE_SECONDS = 30;

export function mayAcceptSubmission(
  state: AttemptState,
  timeLimitMinutes: number | null,
  now: Date,
): { ok: boolean; reason?: string } {
  if (state.submittedAt) {
    return { ok: false, reason: 'That attempt has already been handed in.' };
  }

  const expires = attemptExpiresAt(state.startedAt, timeLimitMinutes);
  if (expires && now.getTime() > expires.getTime() + SUBMIT_GRACE_SECONDS * 1000) {
    return { ok: false, reason: 'The time for that attempt has run out.' };
  }

  return { ok: true };
}

export function mayStartAttempt(params: {
  attemptsSoFar: number;
  maxAttempts: number;
  dueAt: Date | null;
  acceptsLate: boolean;
  now: Date;
}): { ok: boolean; reason?: string } {
  if (params.attemptsSoFar >= params.maxAttempts) {
    return {
      ok: false,
      reason:
        params.maxAttempts === 1
          ? 'You have already taken this quiz.'
          : `You have used all ${params.maxAttempts} attempts.`,
    };
  }

  if (params.dueAt && params.now > params.dueAt && !params.acceptsLate) {
    return { ok: false, reason: 'This quiz has closed.' };
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// Marking
// -----------------------------------------------------------------------------

/** An answer as the student gave it: option ids, or typed text. */
export interface GivenAnswer {
  questionId: string;
  optionIds?: string[];
  text?: string;
}

export interface QuestionMark {
  questionId: string;
  points: number;
  earned: number;
  correct: boolean;
  /** True when a human has to look: an unmatched typed answer. */
  needsReview: boolean;
}

export interface QuizMark {
  perQuestion: QuestionMark[];
  earned: number;
  possible: number;
  /** Percentage, or null when the paper is worth nothing. */
  percentage: number | null;
  /** Any question a human must look at before the score is final. */
  needsReview: boolean;
}

/**
 * Normalise a typed answer before comparing it.
 *
 * Case, outer space and runs of inner space are not part of the answer. What
 * is NOT done here is anything cleverer — no stemming, no fuzzy distance —
 * because a mark awarded by approximate string matching is a mark the student
 * cannot be shown the reason for.
 */
export function normaliseAnswer(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mark one question.
 *
 * MULTI_CHOICE is the only interesting case and the rule is stated here rather
 * than buried: every correct option ticked earns its share, every incorrect one
 * ticked loses a share, and the result is floored at zero.
 *
 * The obvious alternatives are both wrong. All-or-nothing gives a student who
 * found three of four correct answers exactly what it gives one who found none.
 * Naive proportional credit — correct ticked over correct available, with no
 * penalty — means ticking EVERY box scores full marks, which makes the question
 * worthless.
 */
export function markQuestion(question: QuizQuestion, given: GivenAnswer | undefined): QuestionMark {
  const base = { questionId: question.id, points: question.points };

  if (!given) {
    return { ...base, earned: 0, correct: false, needsReview: false };
  }

  if (question.kind === 'SHORT_ANSWER') {
    const typed = normaliseAnswer(given.text ?? '');
    if (!typed) return { ...base, earned: 0, correct: false, needsReview: false };

    const accepted = question.acceptedAnswers.map(normaliseAnswer).filter(Boolean);
    const hit = accepted.includes(typed);

    return {
      ...base,
      earned: hit ? question.points : 0,
      correct: hit,
      /*
       * An unmatched typed answer is flagged rather than trusted. "Lagos State"
       * where "Lagos" was accepted is a mark a person should decide, and
       * quietly scoring it zero is how an auto-marked paper loses somebody a
       * grade nobody ever looks at again.
       */
      needsReview: !hit,
    };
  }

  const correctIds = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));
  const chosen = new Set(given.optionIds ?? []);

  if (question.kind === 'MULTI_CHOICE') {
    if (correctIds.size === 0) {
      return { ...base, earned: 0, correct: false, needsReview: true };
    }

    let right = 0;
    let wrong = 0;
    for (const id of chosen) {
      if (correctIds.has(id)) right += 1;
      else wrong += 1;
    }

    const share = question.points / correctIds.size;
    const earned = Math.max(0, round2(right * share - wrong * share));
    return {
      ...base,
      earned,
      correct: right === correctIds.size && wrong === 0,
      needsReview: false,
    };
  }

  // SINGLE_CHOICE and TRUE_FALSE: one tick, right or not.
  const only = [...chosen][0];
  const hit = chosen.size === 1 && only !== undefined && correctIds.has(only);
  return { ...base, earned: hit ? question.points : 0, correct: hit, needsReview: false };
}

export function markQuiz(
  questions: readonly QuizQuestion[],
  answers: readonly GivenAnswer[],
): QuizMark {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const perQuestion = questions.map((q) => markQuestion(q, byQuestion.get(q.id)));

  const earned = round2(perQuestion.reduce((sum, m) => sum + m.earned, 0));
  const possible = totalPoints(questions);

  return {
    perQuestion,
    earned,
    possible,
    percentage: possible > 0 ? round2((earned / possible) * 100) : null,
    needsReview: perQuestion.some((m) => m.needsReview),
  };
}

// -----------------------------------------------------------------------------
// Shuffling
// -----------------------------------------------------------------------------

/**
 * A deterministic shuffle, seeded per attempt.
 *
 * Deterministic on purpose. The order is stored with the attempt, but a seeded
 * shuffle means the same attempt reproduces the same paper even if the stored
 * order is ever lost — and, more usefully, it makes the shuffle testable, which
 * `Math.random` is not.
 *
 * This is NOT a security measure. Shuffling raises the cost of reading a
 * neighbour's screen in a hall; it does nothing against somebody who has the
 * paper in advance, and pretending otherwise would be the mistake.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hashSeed(seed);

  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** The question order for one attempt, honouring the quiz's settings. */
export function orderFor(
  questions: readonly QuizQuestion[],
  settings: QuizSettings,
  seed: string,
): string[] {
  const ids = questions.map((q) => q.id);
  return settings.shuffleQuestions ? seededShuffle(ids, seed) : ids;
}

function round2(value: number): number {
  // Marks are money-adjacent: 0.30000000000000004 in a gradebook is a support
  // ticket. Rounded at every boundary rather than only on display.
  return Math.round(value * 100) / 100;
}
