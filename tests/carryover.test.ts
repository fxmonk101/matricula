import { describe, expect, it } from 'vitest';

import {
  HEAVY_CARRYOVER_COUNT,
  carryovers,
  describe as describeLoad,
  hasPassed,
  outstanding,
  spilloverRisk,
  summarise,
  type AttemptRecord,
  type RequirementRecord,
} from '@/lib/domain/carryover';

/*
 * What a student still owes.
 *
 * The most-asked question in this market, and one where being wrong is loud:
 * telling somebody they are carrying a course they passed two years ago, or
 * that they failed one they withdrew from, destroys a registry's confidence in
 * the whole system faster than any missing feature.
 */

const PASS = 0.5;

function attempt(over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    courseId: 'c1',
    courseCode: 'CSC101',
    courseTitle: 'Intro to Computing',
    creditHours: 3,
    gradePoint: 4,
    letterGrade: 'A',
    termSequence: 1,
    termName: 'First Semester 2024/2025',
    ...over,
  };
}

describe('has this course been passed', () => {
  it('counts ANY passing attempt, not only the latest', () => {
    /*
     * A student who passed at the second attempt and sat it a third time for a
     * better grade has still passed. Reading only the most recent result would
     * put it back on their carryover list.
     */
    const history = [
      attempt({ termSequence: 1, gradePoint: 0, letterGrade: 'F' }),
      attempt({ termSequence: 2, gradePoint: 2, letterGrade: 'C' }),
      attempt({ termSequence: 3, gradePoint: 0, letterGrade: 'F' }),
    ];
    expect(hasPassed(history, PASS)).toBe(true);
  });

  it('is false when every attempt failed', () => {
    expect(
      hasPassed([attempt({ gradePoint: 0 }), attempt({ gradePoint: 0.2 })], PASS),
    ).toBe(false);
  });
});

describe('carryovers', () => {
  it('lists a course sat and failed', () => {
    const list = carryovers([attempt({ gradePoint: 0, letterGrade: 'F' })], PASS);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('FAILED');
    expect(list[0].lastGrade).toBe('F');
  });

  it('drops it once it has been passed on a retake', () => {
    const list = carryovers(
      [
        attempt({ termSequence: 1, gradePoint: 0, letterGrade: 'F' }),
        attempt({ termSequence: 3, gradePoint: 3, letterGrade: 'B' }),
      ],
      PASS,
    );
    expect(list).toHaveLength(0);
  });

  it('does NOT treat a withdrawal as a failure', () => {
    /*
     * A null grade point is a withdrawal, an incomplete, or work in progress.
     * Telling a student they are carrying a course they withdrew from is both
     * wrong and alarming.
     */
    expect(carryovers([attempt({ gradePoint: null, letterGrade: 'W' })], PASS)).toHaveLength(0);
  });

  it('counts the attempts and reports the most recent grade', () => {
    const list = carryovers(
      [
        attempt({ termSequence: 1, gradePoint: 0, letterGrade: 'F', termName: 'First 2023/2024' }),
        attempt({ termSequence: 4, gradePoint: 0.3, letterGrade: 'E', termName: 'First 2024/2025' }),
      ],
      PASS,
    );
    expect(list[0].attempts).toBe(2);
    expect(list[0].lastGrade).toBe('E');
    expect(list[0].lastTermName).toBe('First 2024/2025');
  });

  it('treats each course separately', () => {
    const list = carryovers(
      [
        attempt({ courseId: 'a', courseCode: 'CSC101', gradePoint: 0 }),
        attempt({ courseId: 'b', courseCode: 'MTH101', gradePoint: 4 }),
        attempt({ courseId: 'c', courseCode: 'PHY101', gradePoint: 0.1 }),
      ],
      PASS,
    );
    expect(list.map((c) => c.courseCode)).toEqual(['CSC101', 'PHY101']);
  });
});

describe('outstanding', () => {
  const requirements: RequirementRecord[] = [
    { courseId: 'a', courseCode: 'CSC101', courseTitle: 'Intro', creditHours: 3, kind: 'CORE', level: 100 },
    { courseId: 'b', courseCode: 'CSC201', courseTitle: 'Data', creditHours: 3, kind: 'CORE', level: 200 },
    { courseId: 'c', courseCode: 'CSC301', courseTitle: 'Algo', creditHours: 3, kind: 'CORE', level: 300 },
    { courseId: 'e1', courseCode: 'CSC350', courseTitle: 'Games', creditHours: 2, kind: 'ELECTIVE', level: 300 },
  ];

  it('separates a debt from a plan', () => {
    /*
     * A carryover is something to act on now; an untaken third-year course is
     * not. A list that mixes them by course code buries the three that matter
     * among the thirty that do not.
     */
    const list = outstanding({
      attempts: [attempt({ courseId: 'a', courseCode: 'CSC101', gradePoint: 0, letterGrade: 'F' })],
      requirements,
      passingGradePoint: PASS,
    });

    expect(list[0].courseCode).toBe('CSC101');
    expect(list[0].reason).toBe('FAILED');
    expect(list.slice(1).every((c) => c.reason === 'NOT_TAKEN')).toBe(true);
  });

  it('gives a carryover the programme’s own level and kind', () => {
    const list = outstanding({
      attempts: [attempt({ courseId: 'b', courseCode: 'CSC201', gradePoint: 0 })],
      requirements,
      passingGradePoint: PASS,
    });
    const carried = list.find((c) => c.courseCode === 'CSC201')!;
    expect(carried.level).toBe(200);
    expect(carried.kind).toBe('CORE');
  });

  it('EXCLUDES electives, which are a credit count and not a list', () => {
    /*
     * A programme lists twenty electives of which a student takes four.
     * Listing the sixteen they did not choose as "outstanding" is nonsense.
     */
    const list = outstanding({ attempts: [], requirements, passingGradePoint: PASS });
    expect(list.map((c) => c.courseCode)).not.toContain('CSC350');

    const withElectives = outstanding({
      attempts: [],
      requirements,
      passingGradePoint: PASS,
      includeElectives: true,
    });
    expect(withElectives.map((c) => c.courseCode)).toContain('CSC350');
  });

  it('drops a requirement once it is passed', () => {
    const list = outstanding({
      attempts: [attempt({ courseId: 'a', courseCode: 'CSC101', gradePoint: 4 })],
      requirements,
      passingGradePoint: PASS,
    });
    expect(list.map((c) => c.courseCode)).not.toContain('CSC101');
  });

  it('does not list a course currently being taken as a debt', () => {
    // In progress carries a null grade point. It is neither passed nor failed.
    const list = outstanding({
      attempts: [attempt({ courseId: 'b', courseCode: 'CSC201', gradePoint: null, letterGrade: null })],
      requirements,
      passingGradePoint: PASS,
    });
    expect(list.map((c) => c.courseCode)).not.toContain('CSC201');
  });

  it('orders the untaken ones by level, so next year comes before final year', () => {
    const list = outstanding({ attempts: [], requirements, passingGradePoint: PASS });
    const levels = list.filter((c) => c.reason === 'NOT_TAKEN').map((c) => c.level);
    expect(levels).toEqual([...levels].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe('the summary', () => {
  it('counts carryovers and credits separately from everything outstanding', () => {
    const list = outstanding({
      attempts: [
        attempt({ courseId: 'a', courseCode: 'CSC101', gradePoint: 0, creditHours: 3 }),
        attempt({ courseId: 'b', courseCode: 'CSC201', gradePoint: 0, creditHours: 4 }),
      ],
      requirements: [
        { courseId: 'a', courseCode: 'CSC101', courseTitle: 'x', creditHours: 3, kind: 'CORE', level: 100 },
        { courseId: 'b', courseCode: 'CSC201', courseTitle: 'y', creditHours: 4, kind: 'CORE', level: 200 },
        { courseId: 'c', courseCode: 'CSC301', courseTitle: 'z', creditHours: 3, kind: 'CORE', level: 300 },
      ],
      passingGradePoint: PASS,
    });

    const summary = summarise(list);
    expect(summary.carryoverCount).toBe(2);
    expect(summary.carryoverCredits).toBe(7);
    expect(summary.outstandingCount).toBe(3);
    expect(summary.outstandingCredits).toBe(10);
  });

  it('flags a heavy load without blocking anybody', () => {
    // A warning, never a bar. Who may register is the registry's decision.
    const light = summarise([
      { reason: 'FAILED', creditHours: 3 } as never,
      { reason: 'FAILED', creditHours: 3 } as never,
    ]);
    expect(light.heavy).toBe(false);

    const heavy = summarise(
      Array.from({ length: HEAVY_CARRYOVER_COUNT }, () => ({ reason: 'FAILED', creditHours: 3 }) as never),
    );
    expect(heavy.heavy).toBe(true);
  });

  it('says it in words a student can read', () => {
    expect(describeLoad(summarise([]))).toMatch(/passed everything/);
    expect(
      describeLoad(summarise([{ reason: 'FAILED', creditHours: 3 } as never])),
    ).toMatch(/1 carryover \(3 credits\)/);
    expect(
      describeLoad(summarise([{ reason: 'NOT_TAKEN', creditHours: 3 } as never])),
    ).toMatch(/1 required course is still to be taken/);
  });
});

describe('spillover', () => {
  it('sees the extra session coming', () => {
    // 30 credits left, 18 a term, 1 term to go: two terms needed.
    const risk = spilloverRisk({ outstandingCredits: 30, termsRemaining: 1, maxCreditsPerTerm: 18 });
    expect(risk.termsNeeded).toBe(2);
    expect(risk.atRisk).toBe(true);
  });

  it('is calm when the work fits', () => {
    expect(
      spilloverRisk({ outstandingCredits: 12, termsRemaining: 2, maxCreditsPerTerm: 18 }).atRisk,
    ).toBe(false);
  });

  it('does not divide by zero when a school has no credit ceiling', () => {
    expect(
      spilloverRisk({ outstandingCredits: 30, termsRemaining: 0, maxCreditsPerTerm: 0 }),
    ).toEqual({ atRisk: false, termsNeeded: 0 });
  });
});
