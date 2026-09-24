import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUIZ_SETTINGS,
  SUBMIT_GRACE_SECONDS,
  attemptExpiresAt,
  markQuestion,
  markQuiz,
  mayAcceptSubmission,
  mayRevealAnswers,
  mayStartAttempt,
  normaliseAnswer,
  orderFor,
  secondsRemaining,
  seededShuffle,
  totalPoints,
  validateQuestion,
  validateQuiz,
  type QuizQuestion,
} from '@/lib/domain/quiz';

/*
 * Quizzes, and computer-based testing.
 *
 * The marking rules are where this earns or loses trust: a cohort sits a paper
 * in a hall, the score appears the moment it ends, and nobody re-checks it by
 * hand. Every judgement below is one somebody could be failed by.
 */

function choice(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    kind: 'SINGLE_CHOICE',
    prompt: 'What is the capital of Nigeria?',
    points: 2,
    options: [
      { id: 'a', text: 'Lagos', isCorrect: false },
      { id: 'b', text: 'Abuja', isCorrect: true },
      { id: 'c', text: 'Kano', isCorrect: false },
    ],
    acceptedAnswers: [],
    ...overrides,
  };
}

function multi(): QuizQuestion {
  return {
    id: 'm1',
    kind: 'MULTI_CHOICE',
    prompt: 'Which of these are prime?',
    points: 4,
    options: [
      { id: 'p2', text: '2', isCorrect: true },
      { id: 'p3', text: '3', isCorrect: true },
      { id: 'p4', text: '4', isCorrect: false },
      { id: 'p9', text: '9', isCorrect: false },
    ],
    acceptedAnswers: [],
  };
}

function typed(): QuizQuestion {
  return {
    id: 't1',
    kind: 'SHORT_ANSWER',
    prompt: 'Name the largest city in Nigeria.',
    points: 3,
    options: [],
    acceptedAnswers: ['Lagos', 'Lagos City'],
  };
}

describe('marking a single-answer question', () => {
  it('awards the marks for the right option', () => {
    const mark = markQuestion(choice(), { questionId: 'q1', optionIds: ['b'] });
    expect(mark.earned).toBe(2);
    expect(mark.correct).toBe(true);
  });

  it('awards nothing for the wrong one', () => {
    expect(markQuestion(choice(), { questionId: 'q1', optionIds: ['a'] }).earned).toBe(0);
  });

  it('awards nothing for no answer at all', () => {
    expect(markQuestion(choice(), undefined).earned).toBe(0);
  });

  it('refuses to reward ticking two boxes on a one-answer question', () => {
    // Including the correct one. The question asked for one answer.
    const mark = markQuestion(choice(), { questionId: 'q1', optionIds: ['a', 'b'] });
    expect(mark.earned).toBe(0);
  });
});

describe('marking a several-answers question', () => {
  it('gives full marks for exactly the right set', () => {
    const mark = markQuestion(multi(), { questionId: 'm1', optionIds: ['p2', 'p3'] });
    expect(mark.earned).toBe(4);
    expect(mark.correct).toBe(true);
  });

  it('gives PARTIAL credit for a partly right answer', () => {
    /*
     * All-or-nothing would give a student who found one of the two correct
     * answers exactly what it gives one who found none.
     */
    const mark = markQuestion(multi(), { questionId: 'm1', optionIds: ['p2'] });
    expect(mark.earned).toBe(2);
    expect(mark.correct).toBe(false);
  });

  it('PENALISES a wrong tick, so ticking everything scores nothing', () => {
    /*
     * The failure mode of naive proportional credit: with no penalty, a student
     * who ticks every box gets full marks and the question is worthless.
     */
    const mark = markQuestion(multi(), {
      questionId: 'm1',
      optionIds: ['p2', 'p3', 'p4', 'p9'],
    });
    expect(mark.earned).toBe(0);
  });

  it('never goes negative, however wrong the answer', () => {
    const mark = markQuestion(multi(), { questionId: 'm1', optionIds: ['p4', 'p9'] });
    expect(mark.earned).toBe(0);
    expect(mark.earned).toBeGreaterThanOrEqual(0);
  });

  it('nets one right against one wrong', () => {
    // 1 correct (+2) and 1 incorrect (-2) on a 4-mark question.
    const mark = markQuestion(multi(), { questionId: 'm1', optionIds: ['p2', 'p4'] });
    expect(mark.earned).toBe(0);
  });
});

describe('marking a typed answer', () => {
  it('ignores case and stray spacing', () => {
    expect(normaliseAnswer('  LAGOS  ')).toBe('lagos');
    expect(markQuestion(typed(), { questionId: 't1', text: '  lagos ' }).earned).toBe(3);
  });

  it('accepts any of the answers the lecturer listed', () => {
    expect(markQuestion(typed(), { questionId: 't1', text: 'Lagos City' }).correct).toBe(true);
  });

  it('FLAGS an unmatched answer for a human rather than trusting the zero', () => {
    /*
     * "Lagos State" where "Lagos" was accepted is a mark a person should
     * decide. Quietly scoring it zero is how an auto-marked paper costs
     * somebody a grade nobody ever looks at again.
     */
    const mark = markQuestion(typed(), { questionId: 't1', text: 'Lagos State' });
    expect(mark.earned).toBe(0);
    expect(mark.needsReview).toBe(true);
  });

  it('does not flag a blank answer — that is not a judgement call', () => {
    const mark = markQuestion(typed(), { questionId: 't1', text: '   ' });
    expect(mark.earned).toBe(0);
    expect(mark.needsReview).toBe(false);
  });
});

describe('marking a whole paper', () => {
  const paper = [choice(), multi(), typed()];

  it('totals the marks and the percentage', () => {
    expect(totalPoints(paper)).toBe(9);

    const mark = markQuiz(paper, [
      { questionId: 'q1', optionIds: ['b'] },
      { questionId: 'm1', optionIds: ['p2', 'p3'] },
      { questionId: 't1', text: 'Lagos' },
    ]);

    expect(mark.earned).toBe(9);
    expect(mark.percentage).toBe(100);
    expect(mark.needsReview).toBe(false);
  });

  it('marks an empty paper as zero rather than failing', () => {
    const mark = markQuiz(paper, []);
    expect(mark.earned).toBe(0);
    expect(mark.percentage).toBe(0);
  });

  it('raises the review flag when ANY question needs a person', () => {
    const mark = markQuiz(paper, [
      { questionId: 'q1', optionIds: ['b'] },
      { questionId: 'm1', optionIds: ['p2', 'p3'] },
      { questionId: 't1', text: 'Lagos State' },
    ]);
    expect(mark.needsReview).toBe(true);
  });

  it('does not accumulate floating-point dust', () => {
    // Three questions worth a third of a mark each must not total 0.9999…
    const thirds: QuizQuestion[] = [1, 2, 3].map((n) => ({
      ...choice({ id: `x${n}`, points: 0.1 }),
    }));
    const mark = markQuiz(thirds, thirds.map((q) => ({ questionId: q.id, optionIds: ['b'] })));
    expect(mark.earned).toBe(0.3);
  });
});

describe('the clock', () => {
  const started = new Date('2026-09-23T09:00:00Z');

  it('expires a timed attempt at start plus the limit', () => {
    expect(attemptExpiresAt(started, 45)).toEqual(new Date('2026-09-23T09:45:00Z'));
  });

  it('never expires an untimed one', () => {
    expect(attemptExpiresAt(started, null)).toBeNull();
    expect(secondsRemaining(started, null, new Date())).toBeNull();
  });

  it('counts down, and does not go negative', () => {
    expect(secondsRemaining(started, 45, new Date('2026-09-23T09:44:00Z'))).toBe(60);
    expect(secondsRemaining(started, 45, new Date('2026-09-23T10:30:00Z'))).toBe(0);
  });

  it('accepts a submission a few seconds late', () => {
    /*
     * The submission pressed at the last second travels over a mobile network
     * and arrives a moment later. Refusing it fails exactly the student who
     * used every second they were given.
     */
    const state = { startedAt: started, submittedAt: null, order: [] };
    const justLate = new Date(started.getTime() + 45 * 60_000 + (SUBMIT_GRACE_SECONDS - 5) * 1000);
    expect(mayAcceptSubmission(state, 45, justLate).ok).toBe(true);
  });

  it('refuses one that is properly late', () => {
    const state = { startedAt: started, submittedAt: null, order: [] };
    const tooLate = new Date(started.getTime() + 50 * 60_000);
    const verdict = mayAcceptSubmission(state, 45, tooLate);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/run out/);
  });

  it('refuses a second submission of the same attempt', () => {
    const state = { startedAt: started, submittedAt: started, order: [] };
    expect(mayAcceptSubmission(state, null, new Date()).ok).toBe(false);
  });
});

describe('starting an attempt', () => {
  const now = new Date('2026-09-23T09:00:00Z');

  it('allows the first attempt', () => {
    expect(
      mayStartAttempt({ attemptsSoFar: 0, maxAttempts: 1, dueAt: null, acceptsLate: true, now }).ok,
    ).toBe(true);
  });

  it('refuses once the attempts are used up', () => {
    const verdict = mayStartAttempt({
      attemptsSoFar: 1,
      maxAttempts: 1,
      dueAt: null,
      acceptsLate: true,
      now,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/already taken/);
  });

  it('allows a late start where the coursework accepts late work', () => {
    // Consistent with every other piece of coursework: late is marked late,
    // not refused.
    const dueAt = new Date('2026-09-22T09:00:00Z');
    expect(
      mayStartAttempt({ attemptsSoFar: 0, maxAttempts: 1, dueAt, acceptsLate: true, now }).ok,
    ).toBe(true);
    expect(
      mayStartAttempt({ attemptsSoFar: 0, maxAttempts: 1, dueAt, acceptsLate: false, now }).ok,
    ).toBe(false);
  });
});

describe('showing the answers', () => {
  const dueAt = new Date('2026-09-25T00:00:00Z');
  const before = new Date('2026-09-23T00:00:00Z');
  const after = new Date('2026-09-26T00:00:00Z');

  it('never, when the lecturer said never', () => {
    expect(mayRevealAnswers('NEVER', { submitted: true, dueAt, now: after })).toBe(false);
  });

  it('not before the student has handed in, whatever the policy', () => {
    expect(mayRevealAnswers('AFTER_SUBMIT', { submitted: false, dueAt, now: after })).toBe(false);
  });

  it('holds them back until the closing date under AFTER_DUE', () => {
    /*
     * The leak this prevents: on a quiz the class sits over a week, revealing
     * on submission lets the first student to finish hand the answers to
     * everybody who has not started.
     */
    expect(mayRevealAnswers('AFTER_DUE', { submitted: true, dueAt, now: before })).toBe(false);
    expect(mayRevealAnswers('AFTER_DUE', { submitted: true, dueAt, now: after })).toBe(true);
  });

  it('never reveals under AFTER_DUE when there is no closing date', () => {
    // A date that never arrives must not mean "immediately".
    expect(mayRevealAnswers('AFTER_DUE', { submitted: true, dueAt: null, now: after })).toBe(false);
  });
});

describe('validation', () => {
  it('accepts a well-formed question', () => {
    expect(validateQuestion(choice())).toEqual([]);
    expect(validateQuestion(multi())).toEqual([]);
    expect(validateQuestion(typed())).toEqual([]);
  });

  it('refuses a choice question with no correct option', () => {
    const broken = choice({ options: choice().options.map((o) => ({ ...o, isCorrect: false })) });
    expect(validateQuestion(broken).join(' ')).toMatch(/None of the options/);
  });

  it('refuses TWO correct options on a one-answer question', () => {
    /*
     * Not a harder question — a broken one. Whichever the student picks they
     * are both right and wrong, and the mark depends on row order.
     */
    const broken = choice({
      options: [
        { id: 'a', text: 'Lagos', isCorrect: true },
        { id: 'b', text: 'Abuja', isCorrect: true },
      ],
    });
    expect(validateQuestion(broken).join(' ')).toMatch(/only have one correct option/);
  });

  it('refuses a typed question with nothing to match against', () => {
    const broken: QuizQuestion = { ...typed(), acceptedAnswers: [] };
    expect(validateQuestion(broken).join(' ')).toMatch(/cannot be marked/);
  });

  it('refuses a question worth nothing', () => {
    expect(validateQuestion(choice({ points: 0 })).join(' ')).toMatch(/more than nothing/);
  });

  it('refuses an empty quiz', () => {
    expect(validateQuiz([], DEFAULT_QUIZ_SETTINGS).join(' ')).toMatch(/at least one question/);
  });

  it('counts broken questions once rather than complaining thirty times', () => {
    const broken = Array.from({ length: 5 }, (_, i) => choice({ id: `b${i}`, prompt: '' }));
    const problems = validateQuiz(broken, DEFAULT_QUIZ_SETTINGS);
    expect(problems.filter((p) => /question/.test(p))).toHaveLength(1);
    expect(problems.join(' ')).toMatch(/5 questions have a problem/);
  });

  it('refuses an absurd time limit', () => {
    expect(
      validateQuiz([choice()], { ...DEFAULT_QUIZ_SETTINGS, timeLimitMinutes: 10_000 }).join(' '),
    ).toMatch(/longer than any examination/);
  });
});

describe('shuffling', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('is deterministic for a seed, so a refresh does not reshuffle', () => {
    expect(seededShuffle(ids, 'attempt-1')).toEqual(seededShuffle(ids, 'attempt-1'));
  });

  it('differs between students', () => {
    expect(seededShuffle(ids, 'attempt-1')).not.toEqual(seededShuffle(ids, 'attempt-2'));
  });

  it('keeps every item exactly once', () => {
    // A shuffle that loses a question loses a mark nobody can get back.
    expect([...seededShuffle(ids, 'x')].sort()).toEqual([...ids].sort());
  });

  it('leaves the order alone when shuffling is off', () => {
    const questions = [choice({ id: 'q1' }), choice({ id: 'q2' }), choice({ id: 'q3' })];
    expect(orderFor(questions, DEFAULT_QUIZ_SETTINGS, 'seed')).toEqual(['q1', 'q2', 'q3']);
  });

  it('shuffles when asked, without losing anything', () => {
    const questions = Array.from({ length: 10 }, (_, i) => choice({ id: `q${i}` }));
    const order = orderFor(questions, { ...DEFAULT_QUIZ_SETTINGS, shuffleQuestions: true }, 'seed');
    expect([...order].sort()).toEqual(questions.map((q) => q.id).sort());
  });
});
