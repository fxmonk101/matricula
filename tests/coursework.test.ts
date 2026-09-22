import { describe, expect, it } from 'vitest';

import {
  STATE_LABELS,
  dueIn,
  isLate,
  parseRubric,
  rubricTotal,
  rubricWarning,
  submissionState,
  validateCourseworkDraft,
  validateSubmission,
} from '@/lib/domain/coursework';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const YESTERDAY = new Date('2026-09-21T12:00:00.000Z');
const TOMORROW = new Date('2026-09-23T12:00:00.000Z');

const good = {
  title: 'Problem set 1',
  pointsPossible: 100,
  dueAt: TOMORROW,
  allowsText: true,
  allowsFile: true,
  acceptsLate: true,
};

describe('setting work', () => {
  it('accepts an ordinary assignment', () => {
    expect(validateCourseworkDraft(good, NOW)).toEqual([]);
  });

  it('requires a title and a positive mark', () => {
    expect(validateCourseworkDraft({ ...good, title: '  ' }, NOW).join(' ')).toMatch(/title/);
    expect(validateCourseworkDraft({ ...good, pointsPossible: 0 }, NOW).join(' ')).toMatch(
      /more than zero/,
    );
    expect(validateCourseworkDraft({ ...good, pointsPossible: -5 }, NOW).join(' ')).toMatch(
      /more than zero/,
    );
  });

  it('catches a slipped decimal in the marks', () => {
    expect(validateCourseworkDraft({ ...good, pointsPossible: 10_000 }, NOW).join(' ')).toMatch(
      /implausible/,
    );
  });

  it('REFUSES an assignment nobody could hand anything in to', () => {
    /*
     * Allowing neither text nor a file leaves a student staring at a submission
     * page with no way to submit, concluding the system is broken rather than
     * that it was set up wrong.
     */
    const problems = validateCourseworkDraft(
      { ...good, allowsText: false, allowsFile: false },
      NOW,
    );
    expect(problems.join(' ')).toMatch(/nobody can hand anything in/);
  });

  it('allows a due date in the recent past, and questions one a year back', () => {
    // Setting work that was due yesterday is a normal catch-up; a date a year
    // ago is a mistyped year.
    expect(validateCourseworkDraft({ ...good, dueAt: YESTERDAY }, NOW)).toEqual([]);
    expect(
      validateCourseworkDraft({ ...good, dueAt: new Date('2024-09-22T12:00:00Z') }, NOW).join(' '),
    ).toMatch(/Check the year/);
  });

  it('allows no deadline at all', () => {
    expect(validateCourseworkDraft({ ...good, dueAt: null }, NOW)).toEqual([]);
  });
});

describe('handing in', () => {
  const rules = { allowsText: true, allowsFile: true, acceptsLate: true, dueAt: TOMORROW };

  it('accepts a typed answer', () => {
    expect(validateSubmission({ textBody: 'My answer.', hasFile: false }, rules, NOW)).toEqual([]);
  });

  it('accepts a file', () => {
    expect(validateSubmission({ textBody: null, hasFile: true }, rules, NOW)).toEqual([]);
  });

  it('refuses an empty hand-in', () => {
    expect(validateSubmission({ textBody: '   ', hasFile: false }, rules, NOW).join(' ')).toMatch(
      /Type an answer or attach/,
    );
  });

  it('refuses a file where only text is allowed, and the reverse', () => {
    expect(
      validateSubmission({ textBody: null, hasFile: true }, { ...rules, allowsFile: false }, NOW).join(' '),
    ).toMatch(/takes a typed answer/);
    expect(
      validateSubmission({ textBody: 'x', hasFile: false }, { ...rules, allowsText: false }, NOW).join(' '),
    ).toMatch(/takes a file/);
  });

  it('accepts late work when the assignment says it may', () => {
    const late = { ...rules, dueAt: YESTERDAY, acceptsLate: true };
    expect(validateSubmission({ textBody: 'Sorry.', hasFile: false }, late, NOW)).toEqual([]);
  });

  it('REFUSES late work on a closed assignment', () => {
    /*
     * Refused on the SERVER rather than by hiding the button: a form already
     * open in a tab when the deadline passed would otherwise still post.
     */
    const closed = { ...rules, dueAt: YESTERDAY, acceptsLate: false };
    expect(validateSubmission({ textBody: 'Late.', hasFile: false }, closed, NOW).join(' ')).toMatch(
      /deadline .* has passed/,
    );
  });

  it('refuses an answer longer than the field can hold', () => {
    expect(
      validateSubmission({ textBody: 'x'.repeat(200_000), hasFile: false }, rules, NOW).join(' '),
    ).toMatch(/too long/);
  });
});

describe('lateness', () => {
  it('is measured against the deadline', () => {
    expect(isLate(YESTERDAY, NOW)).toBe(true);
    expect(isLate(TOMORROW, NOW)).toBe(false);
  });

  it('is never late when there is no deadline', () => {
    expect(isLate(null, NOW)).toBe(false);
    expect(isLate(undefined, NOW)).toBe(false);
  });
});

describe('where a student stands', () => {
  const rules = { allowsText: true, allowsFile: true, acceptsLate: true, dueAt: TOMORROW };
  const submission = { submittedAt: NOW, isLate: false, score: null, gradedAt: null };

  it('is NOT_SUBMITTED with nothing handed in', () => {
    expect(submissionState(null, rules, NOW)).toBe('NOT_SUBMITTED');
  });

  it('is CLOSED when nothing was handed in and it can no longer be', () => {
    expect(submissionState(null, { ...rules, dueAt: YESTERDAY, acceptsLate: false }, NOW)).toBe(
      'CLOSED',
    );
  });

  it('is still NOT_SUBMITTED past a deadline that accepts late work', () => {
    expect(submissionState(null, { ...rules, dueAt: YESTERDAY }, NOW)).toBe('NOT_SUBMITTED');
  });

  it('distinguishes an on-time hand-in from a late one', () => {
    expect(submissionState(submission, rules, NOW)).toBe('SUBMITTED');
    expect(submissionState({ ...submission, isLate: true }, rules, NOW)).toBe('SUBMITTED_LATE');
  });

  it('lets GRADED win over lateness', () => {
    /*
     * Once work has been marked, its lateness is something the mark already
     * accounts for. Continuing to shout about it buries the result the student
     * actually came to read.
     */
    const marked = { ...submission, isLate: true, score: 62, gradedAt: NOW };
    expect(submissionState(marked, rules, NOW)).toBe('GRADED');
  });

  it('has a label for every state', () => {
    for (const state of Object.keys(STATE_LABELS)) {
      expect(STATE_LABELS[state as keyof typeof STATE_LABELS]).toBeTruthy();
    }
  });
});

describe('how long is left', () => {
  it('counts down in the units a person would use', () => {
    expect(dueIn(new Date('2026-09-22T12:30:00Z'), NOW)).toBe('due in 30 minutes');
    expect(dueIn(new Date('2026-09-22T18:00:00Z'), NOW)).toBe('due in 6 hours');
    expect(dueIn(new Date('2026-09-27T12:00:00Z'), NOW)).toBe('due in 5 days');
  });

  it('says overdue rather than a negative', () => {
    // Exactly an hour reads as an hour, not as sixty minutes.
    expect(dueIn(new Date('2026-09-22T11:00:00Z'), NOW)).toBe('1 hour overdue');
    expect(dueIn(new Date('2026-09-22T11:30:00Z'), NOW)).toBe('30 minutes overdue');
  });

  it('says nothing when there is no deadline', () => {
    expect(dueIn(null, NOW)).toBeNull();
  });

  it('gets the singular right', () => {
    expect(dueIn(new Date('2026-09-22T12:01:00Z'), NOW)).toBe('due in 1 minute');
  });
});

describe('rubrics', () => {
  it('parses what the form writes', () => {
    const rows = parseRubric(
      JSON.stringify([
        { criterion: 'Correctness', points: 60 },
        { criterion: 'Clarity', points: 40 },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rubricTotal(rows)).toBe(100);
  });

  it('NEVER throws on malformed JSON', () => {
    /*
     * A broken rubric must not take down the page showing the assignment it
     * belongs to. The work and the mark matter more than the breakdown.
     */
    expect(parseRubric('not json at all')).toEqual([]);
    expect(parseRubric('{"not":"an array"}')).toEqual([]);
    expect(parseRubric('[1, 2, 3]')).toEqual([]);
    expect(parseRubric(null)).toEqual([]);
    expect(parseRubric('')).toEqual([]);
  });

  it('drops rows it cannot make sense of rather than the whole rubric', () => {
    const rows = parseRubric(
      JSON.stringify([
        { criterion: 'Good row', points: 10 },
        { criterion: '', points: 5 },
        { nonsense: true },
        { criterion: 'Missing points' },
      ]),
    );
    expect(rows.map((r) => r.criterion)).toEqual(['Good row', 'Missing points']);
    expect(rows[1].points).toBe(0);
  });

  it('WARNS when a rubric does not add up, rather than refusing it', () => {
    // Plenty of real rubrics deliberately do not sum, so this is a remark and
    // not a rule.
    expect(rubricWarning([{ criterion: 'A', points: 50 }], 100)).toMatch(/adds up to 50/);
    expect(rubricWarning([{ criterion: 'A', points: 100 }], 100)).toBeNull();
    expect(rubricWarning([], 100)).toBeNull();
  });
});
