import { describe, expect, it } from 'vitest';

import {
  SEASONS,
  academicYearFor,
  academicYearRejectionReason,
  buildTermCode,
  isInSession,
  isSeason,
  isValidAcademicYear,
  normaliseTermCode,
  overlappingTerms,
  registrationState,
  suggestCurrentTerm,
  termCodeRejectionReason,
  validateTerm,
  validateTermDates,
} from '@/lib/domain/term';

const DATES = {
  startDate: '2026-09-21',
  endDate: '2027-01-29',
  registrationOpensAt: '2026-09-01',
  registrationClosesAt: '2026-10-09',
  addDropDeadline: '2026-10-16',
  withdrawalDeadline: '2026-12-04',
};

describe('academic sessions', () => {
  it('accepts the form printed on a transcript', () => {
    expect(isValidAcademicYear('2026/2027')).toBe(true);
  });

  it('refuses non-consecutive years', () => {
    // "2025/2027" is a typo, and it would put every transcript line in a
    // session that does not exist.
    expect(isValidAcademicYear('2025/2027')).toBe(false);
    expect(academicYearRejectionReason('2025/2027')).toMatch(/must follow/);
  });

  it('names the rule broken', () => {
    expect(academicYearRejectionReason('')).toMatch(/Enter an academic year/);
    expect(academicYearRejectionReason('2026')).toMatch(/2025\/2026/);
    expect(academicYearRejectionReason('2026/2027')).toBeNull();
  });

  it('works out the session a date falls in', () => {
    // September onwards belongs to the session that starts that year.
    expect(academicYearFor(new Date('2026-09-21T00:00:00Z'))).toBe('2026/2027');
    expect(academicYearFor(new Date('2027-01-15T00:00:00Z'))).toBe('2026/2027');
    expect(academicYearFor(new Date('2026-06-01T00:00:00Z'))).toBe('2025/2026');
  });
});

describe('term codes', () => {
  it('leads with the year so codes sort chronologically as strings', () => {
    expect(buildTermCode('2026/2027', 'FALL')).toBe('2026-FALL');
    expect(buildTermCode('2026/2027', 'SPRING')).toBe('2026-SPRING');
    expect(['2025-FALL', '2026-FALL', '2027-FALL'].slice().sort()).toEqual([
      '2025-FALL',
      '2026-FALL',
      '2027-FALL',
    ]);
  });

  it('normalises spacing and case', () => {
    expect(normaliseTermCode('  2026 fall ')).toBe('2026-FALL');
  });

  it('names the rule broken', () => {
    expect(termCodeRejectionReason('')).toMatch(/Enter a term code/);
    expect(termCodeRejectionReason('AB')).toMatch(/three characters/);
    expect(termCodeRejectionReason('X'.repeat(40))).toMatch(/too long/);
    expect(termCodeRejectionReason('2026_FALL')).toMatch(/capital letters, digits and hyphens/);
    expect(termCodeRejectionReason('2026-FALL')).toBeNull();
  });

  it('knows the seasons', () => {
    expect(SEASONS).toHaveLength(3);
    expect(isSeason('FALL')).toBe(true);
    expect(isSeason('AUTUMN')).toBe(false);
  });
});

describe('the six dates, against each other', () => {
  it('accepts a coherent set', () => {
    expect(validateTermDates(DATES)).toEqual([]);
  });

  it('requires all six before comparing any', () => {
    // Comparing a missing date produces nonsense messages about ordering when
    // the real problem is that a field is empty.
    const problems = validateTermDates({ ...DATES, endDate: '' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Enter an end date/);
  });

  it('refuses a term that ends before it starts', () => {
    expect(
      validateTermDates({ ...DATES, endDate: '2026-09-01' }).join(' '),
    ).toMatch(/must end after it starts/);
  });

  it('refuses a registration window that closes before it opens', () => {
    // The failure that makes registration literally impossible.
    expect(
      validateTermDates({ ...DATES, registrationClosesAt: '2026-08-01' }).join(' '),
    ).toMatch(/close after it opens/);
  });

  it('refuses an add/drop deadline outside the term', () => {
    expect(
      validateTermDates({ ...DATES, addDropDeadline: '2026-09-01' }).join(' '),
    ).toMatch(/before the term starts/);
    expect(
      validateTermDates({ ...DATES, addDropDeadline: '2027-06-01' }).join(' '),
    ).toMatch(/after the term ends/);
  });

  it('requires withdrawal on or after add/drop', () => {
    // A student drops cleanly up to add/drop and withdraws with a mark after,
    // so withdrawal is necessarily the later of the two.
    expect(
      validateTermDates({ ...DATES, withdrawalDeadline: '2026-10-01' }).join(' '),
    ).toMatch(/on or after the add\/drop deadline/);
  });

  it('allows them to fall on the same day', () => {
    expect(
      validateTermDates({ ...DATES, withdrawalDeadline: DATES.addDropDeadline }),
    ).toEqual([]);
  });

  it('reports every problem at once', () => {
    const problems = validateTermDates({
      startDate: '2026-09-21',
      endDate: '2026-09-01',
      registrationOpensAt: '2026-10-01',
      registrationClosesAt: '2026-09-01',
      addDropDeadline: '2027-06-01',
      withdrawalDeadline: '2026-01-01',
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the whole draft', () => {
  const draft = {
    ...DATES,
    code: '2026-FALL',
    name: 'First Semester 2026/2027',
    academicYear: '2026/2027',
    season: 'FALL',
  };

  it('accepts a well-formed term', () => {
    expect(validateTerm(draft)).toEqual([]);
  });

  it('gathers code, name, session, season and date problems together', () => {
    const problems = validateTerm({
      ...draft,
      code: '',
      name: 'x',
      academicYear: 'nope',
      season: 'AUTUMN',
      endDate: '2026-01-01',
    });
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });
});

describe('overlap', () => {
  const existing = [
    {
      id: 't1',
      code: '2026-FALL',
      name: 'First',
      season: 'FALL',
      startDate: new Date('2026-09-21'),
      endDate: new Date('2027-01-29'),
    },
  ];

  it('detects a genuine overlap', () => {
    const clashes = overlappingTerms(
      { startDate: new Date('2026-11-01'), endDate: new Date('2027-03-01') },
      existing,
    );
    expect(clashes.map((t) => t.code)).toEqual(['2026-FALL']);
  });

  it('is half-open, so back-to-back terms do not clash', () => {
    // A term starting the day another ends is the normal arrangement.
    const clashes = overlappingTerms(
      { startDate: new Date('2027-01-29'), endDate: new Date('2027-06-01') },
      existing,
    );
    expect(clashes).toEqual([]);
  });

  it('ignores the term being edited', () => {
    // Editing a term without moving it must not report it clashing with itself.
    const clashes = overlappingTerms(
      { startDate: new Date('2026-09-21'), endDate: new Date('2027-01-29'), excludeId: 't1' },
      existing,
    );
    expect(clashes).toEqual([]);
  });
});

describe('where we are in the calendar', () => {
  const term = {
    startDate: new Date('2026-09-21'),
    endDate: new Date('2027-01-29'),
    registrationOpensAt: new Date('2026-09-01'),
    registrationClosesAt: new Date('2026-10-09'),
  };

  it('tracks the registration window, not the term', () => {
    // Registration opens weeks before a term begins and closes weeks after, so
    // "is the term running" is a different question from "can I register".
    expect(registrationState(term, new Date('2026-08-15'))).toBe('BEFORE');
    expect(registrationState(term, new Date('2026-09-05'))).toBe('OPEN');
    expect(registrationState(term, new Date('2026-09-25'))).toBe('OPEN');
    expect(registrationState(term, new Date('2026-11-01'))).toBe('CLOSED');
  });

  it('answers whether the term is in session separately', () => {
    expect(isInSession(term, new Date('2026-09-05'))).toBe(false);
    expect(isInSession(term, new Date('2026-11-01'))).toBe(true);
    expect(isInSession(term, new Date('2027-03-01'))).toBe(false);
  });
});

describe('suggesting the current term', () => {
  const terms = [
    { id: 'a', startDate: new Date('2026-01-10'), endDate: new Date('2026-06-01') },
    { id: 'b', startDate: new Date('2026-09-21'), endDate: new Date('2027-01-29') },
    { id: 'c', startDate: new Date('2027-02-10'), endDate: new Date('2027-06-20') },
  ];

  it('picks the one running now', () => {
    expect(suggestCurrentTerm(terms, new Date('2026-11-01'))?.id).toBe('b');
  });

  it('picks the next one when none is running', () => {
    expect(suggestCurrentTerm(terms, new Date('2026-07-01'))?.id).toBe('b');
  });

  it('returns nothing once every term is past', () => {
    expect(suggestCurrentTerm(terms, new Date('2030-01-01'))).toBeNull();
  });

  it('is a suggestion, never applied automatically', () => {
    // Which term is current stays an explicit decision by the registry: the
    // answer between two terms is institutional practice, not arithmetic, and
    // guessing would silently move where new marks and invoices land.
    expect(suggestCurrentTerm([], new Date())).toBeNull();
  });
});
