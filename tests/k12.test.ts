import { describe, expect, it } from 'vitest';

import {
  DEFAULT_K12_CONFIG,
  K12Error,
  assembleReportCard,
  buildReportReference,
  classAverage,
  decidePromotion,
  gradeSubjectMark,
  ordinal,
  rankByScore,
  summariseAttendance,
  summariseTerm,
  type GradedSubject,
} from '@/lib/domain/k12';
import { DEFAULT_GRADING_CONFIG, gradingPreset } from '@/lib/domain/config';

const GRADING = DEFAULT_GRADING_CONFIG;

const mark = (subjectCode: string, ca: number | null, exam: number | null) => ({
  studentId: 's1',
  subjectCode,
  subjectName: subjectCode,
  caScore: ca,
  examScore: exam,
});

describe('competition ranking', () => {
  it('assigns 1, 2, 3 when nobody ties', () => {
    const ranked = rankByScore([
      { id: 'a', score: 90 },
      { id: 'b', score: 80 },
      { id: 'c', score: 70 },
    ]);
    expect(ranked.map((r) => [r.id, r.position])).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect(ranked.every((r) => !r.isTied)).toBe(true);
  });

  it('gives tied pupils the SAME position and skips the next — 1, 2, 2, 4', () => {
    // Ordinal ranking would tell one of two pupils with identical marks that
    // they came behind the other. On a document sent home, that is
    // indefensible.
    const ranked = rankByScore([
      { id: 'a', score: 90 },
      { id: 'b', score: 82 },
      { id: 'c', score: 82 },
      { id: 'd', score: 70 },
    ]);
    expect(ranked.map((r) => r.position)).toEqual([1, 2, 2, 4]);
    expect(ranked.find((r) => r.id === 'b')?.isTied).toBe(true);
    expect(ranked.find((r) => r.id === 'd')?.isTied).toBe(false);
  });

  it('handles a three-way tie at the top', () => {
    const ranked = rankByScore([
      { id: 'a', score: 88 },
      { id: 'b', score: 88 },
      { id: 'c', score: 88 },
      { id: 'd', score: 60 },
    ]);
    expect(ranked.map((r) => r.position)).toEqual([1, 1, 1, 4]);
  });

  it('never reports a position beyond the class size', () => {
    const ranked = rankByScore(
      Array.from({ length: 28 }, (_, i) => ({ id: `s${i}`, score: 100 - i })),
    );
    expect(Math.max(...ranked.map((r) => r.position))).toBe(28);
  });

  it('is deterministic for identical scores', () => {
    const entries = [
      { id: 'b', score: 70 },
      { id: 'a', score: 70 },
    ];
    expect(rankByScore(entries).map((r) => r.id)).toEqual(
      rankByScore([...entries].reverse()).map((r) => r.id),
    );
  });

  it('returns nothing for an empty class', () => {
    expect(rankByScore([])).toEqual([]);
  });
});

describe('ordinal', () => {
  it('handles the ordinary cases', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
  });

  it('handles 11, 12 and 13 — the exceptions that catch naive implementations', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(111)).toBe('111th');
    expect(ordinal(112)).toBe('112th');
  });
});

describe('subject marks', () => {
  it('grades through the school’s own scale', () => {
    const graded = gradeSubjectMark(mark('ENG', 34, 50), GRADING);
    expect(graded.totalScore).toBe(84);
    expect(graded.band?.letter).toBe('A');
  });

  it('gives the same mark a different point value on a different scale', () => {
    expect(gradeSubjectMark(mark('ENG', 34, 50), gradingPreset(4)).band?.point).toBe(4);
    expect(gradeSubjectMark(mark('ENG', 34, 50), gradingPreset(5)).band?.point).toBe(5);
  });

  it('leaves an unassessed subject ungraded rather than scoring it zero', () => {
    // A blank is "not yet marked", not a fail for a paper never sat.
    expect(gradeSubjectMark(mark('ENG', null, 50), GRADING).band).toBeNull();
    expect(gradeSubjectMark(mark('ENG', 34, null), GRADING).totalScore).toBeNull();
  });

  it('rejects a mark above the school’s assessment cap', () => {
    expect(() => gradeSubjectMark(mark('ENG', 45, 50), GRADING)).toThrow(K12Error);
    expect(() => gradeSubjectMark(mark('ENG', 34, 70), GRADING)).toThrow(/Examination/);
  });
});

describe('termly aggregation', () => {
  const graded = (scores: (number | null)[]): GradedSubject[] =>
    scores.map((s, i) =>
      gradeSubjectMark(mark(`S${i}`, s === null ? null : s * 0.4, s === null ? null : s * 0.6), GRADING),
    );

  it('averages as a PLAIN mean — a K-12 subject carries no credit weighting', () => {
    const summary = summariseTerm(graded([80, 60]), GRADING);
    expect(summary.totalMarks).toBe(140);
    expect(summary.average).toBe(70);
    expect(summary.maxMarks).toBe(200);
  });

  it('excludes unassessed subjects from BOTH the total and the divisor', () => {
    // Same reason a withdrawal leaves a GPA alone: an unmarked subject cannot
    // pull an average down.
    const withBlank = summariseTerm(graded([80, 60, null]), GRADING);
    const withoutBlank = summariseTerm(graded([80, 60]), GRADING);
    expect(withBlank.average).toBe(withoutBlank.average);
    expect(withBlank.subjectsAssessed).toBe(2);
  });

  it('derives the overall grade from the average through the same scale', () => {
    // The headline grade and the subject grades cannot disagree about what a
    // mark means, because both go through scoreToGrade.
    const summary = summariseTerm(graded([74, 74]), GRADING);
    expect(summary.average).toBe(74);
    expect(summary.overallBand?.letter).toBe('A');
  });

  it('returns a safe zero for a pupil with no marks at all', () => {
    const summary = summariseTerm(graded([null, null]), GRADING);
    expect(summary.average).toBe(0);
    expect(summary.subjectsAssessed).toBe(0);
    expect(summary.overallBand).toBeNull();
  });

  it('identifies the best and weakest subject', () => {
    const summary = summariseTerm(graded([90, 50, 70]), GRADING);
    expect(summary.bestSubject).toBe('S0');
    expect(summary.weakestSubject).toBe('S1');
  });

  it('computes a class average over a subject', () => {
    expect(classAverage([80, 70, 60])).toBe(70);
    expect(classAverage([])).toBe(0);
  });
});

describe('attendance', () => {
  it('counts LATE as present for the rate', () => {
    // Lateness is a punctuality matter reported separately; folding it into
    // absence would conflate two concerns on the promotion decision.
    const s = summariseAttendance({ present: 56, absent: 4, late: 2, excused: 0 });
    expect(s.totalSessions).toBe(62);
    expect(s.ratePercent).toBe(93.5);
  });

  it('removes EXCUSED absence from the denominator entirely', () => {
    // An authorised medical absence must not push a pupil below the attendance
    // threshold for promotion.
    const withExcused = summariseAttendance({ present: 50, absent: 0, late: 0, excused: 12 });
    expect(withExcused.totalSessions).toBe(50);
    expect(withExcused.rate).toBe(1);
  });

  it('treats a pupil with no records as present, not absent', () => {
    // No data means the register was not taken — the school's omission, not
    // the child's.
    expect(summariseAttendance({ present: 0, absent: 0, late: 0, excused: 0 }).rate).toBe(1);
  });
});

describe('promotion decision', () => {
  const base = {
    average: 70,
    attendanceRate: 0.95,
    failedCompulsory: [] as string[],
    isTerminalYear: false,
  };

  it('promotes a pupil who meets every threshold', () => {
    const r = decidePromotion(base);
    expect(r.decision).toBe('PROMOTED');
    expect(r.requiresReview).toBe(false);
  });

  it('graduates a pupil in the final year', () => {
    expect(decidePromotion({ ...base, isTerminalYear: true }).decision).toBe('GRADUATED');
  });

  it('repeats a pupil below the repeat floor', () => {
    const r = decidePromotion({ ...base, average: 35 });
    expect(r.decision).toBe('REPEAT');
    expect(r.reason).toMatch(/below the 40.0 threshold/);
  });

  it('repeats a pupil between the floor and the promotion mark', () => {
    expect(decidePromotion({ ...base, average: 45 }).decision).toBe('REPEAT');
  });

  it('ALWAYS flags a repeat for human review', () => {
    // Holding a child back a year must never be the silent output of a
    // floating-point comparison.
    for (const average of [10, 35, 45, 49.9]) {
      const r = decidePromotion({ ...base, average });
      expect(r.decision).toBe('REPEAT');
      expect(r.requiresReview).toBe(true);
    }
  });

  it('refers a pupil who failed a compulsory subject, whatever their average', () => {
    const r = decidePromotion({ ...base, average: 88, failedCompulsory: ['MTH'] });
    expect(r.decision).toBe('REVIEW');
    expect(r.reason).toMatch(/MTH/);
  });

  it('refers a pupil below the attendance threshold', () => {
    const r = decidePromotion({ ...base, attendanceRate: 0.6 });
    expect(r.decision).toBe('REVIEW');
    expect(r.reason).toMatch(/60.0%/);
  });

  it('applies the worst qualifying condition, not the first that passes', () => {
    // A very low average outranks a compulsory failure: both are true, and the
    // pupil must not receive the more favourable of the two outcomes.
    const r = decidePromotion({ ...base, average: 20, failedCompulsory: ['MTH'] });
    expect(r.decision).toBe('REPEAT');
  });

  it('honours a school’s own thresholds', () => {
    const strict = { ...DEFAULT_K12_CONFIG, promotionMinAverage: 75 };
    expect(decidePromotion(base).decision).toBe('PROMOTED');
    expect(decidePromotion(base, strict).decision).toBe('REPEAT');
  });
});

describe('report card assembly', () => {
  const graded = [
    gradeSubjectMark(mark('ENG', 34, 50), GRADING), // 84
    gradeSubjectMark(mark('MTH', 32, 47), GRADING), // 79
    gradeSubjectMark(mark('SCI', 29, 42), GRADING), // 71
  ];

  const input = {
    graded,
    perSubject: new Map([
      ['ENG', { classAverage: 64.1, position: 3 }],
      ['MTH', { classAverage: 58.7, position: 2 }],
      ['SCI', { classAverage: 61.2, position: 6 }],
    ]),
    attendance: summariseAttendance({ present: 58, absent: 4, late: 2, excused: 0 }),
    positionInClass: 4,
    classSize: 28,
    classAverage: 62.1,
    isTerminalYear: false,
  };

  it('states a total that equals the sum of its own rows', () => {
    // The single most embarrassing failure a report card can have.
    const card = assembleReportCard(input, GRADING);
    const rowSum = card.lines.reduce((s, l) => s + (l.totalScore ?? 0), 0);
    expect(card.summary.totalMarks).toBe(rowSum);
    expect(card.summary.totalMarks).toBe(234);
  });

  it('states an average consistent with that total', () => {
    const card = assembleReportCard(input, GRADING);
    expect(card.summary.average).toBe(78);
    expect(card.summary.average).toBeCloseTo(card.summary.totalMarks / card.lines.length, 5);
  });

  it('states an overall grade consistent with the average', () => {
    const card = assembleReportCard(input, GRADING);
    // 78 is an A on the default scale; the card must not say otherwise.
    expect(card.summary.overallBand?.letter).toBe('A');
  });

  it('renders the position as an ordinal', () => {
    expect(assembleReportCard(input, GRADING).positionLabel).toBe('4th');
  });

  it('carries the per-subject class averages onto the lines', () => {
    const card = assembleReportCard(input, GRADING);
    expect(card.lines.find((l) => l.subjectCode === 'ENG')?.classAverage).toBe(64.1);
    expect(card.lines.find((l) => l.subjectCode === 'MTH')?.positionInClass).toBe(2);
  });

  it('reaches a promotion decision from the marks and attendance', () => {
    expect(assembleReportCard(input, GRADING).promotion.decision).toBe('PROMOTED');
  });

  it('refers a pupil who failed a compulsory subject', () => {
    const config = { ...DEFAULT_K12_CONFIG, compulsorySubjectCodes: ['MTH'] };
    const failing = {
      ...input,
      graded: [graded[0], gradeSubjectMark(mark('MTH', 10, 20), GRADING), graded[2]],
    };
    expect(assembleReportCard(failing, GRADING, config).promotion.decision).toBe('REVIEW');
  });
});

describe('report reference', () => {
  it('is school-prefixed and zero-padded', () => {
    expect(buildReportReference('gis', 2025, 418)).toBe('RPT-GIS-2025-000418');
  });
});
