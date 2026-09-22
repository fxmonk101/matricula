import { describe, expect, it } from 'vitest';

import {
  computeCaScore,
  markPercentage,
  previewPost,
  summarisePost,
  validateMark,
  type GradebookItem,
  type PostPreviewRow,
} from '@/lib/domain/gradebook';

/*
 * The arithmetic that reaches a transcript.
 *
 * A caScore feeds the total, the letter grade, the GPA, academic standing and
 * eventually a graduation audit — so the tests that matter here are the ones
 * about what is EXCLUDED. Counting the wrong thing as zero depresses a real
 * degree classification, and does it silently.
 */

const CA_WEIGHT = 40;

function item(over: Partial<GradebookItem> = {}): GradebookItem {
  return {
    courseworkId: `cw-${Math.random()}`,
    title: 'Piece',
    pointsPossible: 100,
    score: null,
    submitted: false,
    ...over,
  };
}

describe('turning coursework into a CA score', () => {
  it('scales a straight percentage onto the school weight', () => {
    const result = computeCaScore({
      items: [item({ pointsPossible: 100, score: 75, submitted: true })],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    expect(result.percentage).toBe(75);
    expect(result.caScore).toBe(30); // 75% of 40
    expect(result.counted).toBe(1);
  });

  it('WEIGHTS BY MARKS AVAILABLE, not by item count', () => {
    /*
     * An essay out of 100 and a quiz out of 10 are not worth the same.
     * Averaging their percentages would say they were, letting a perfect quiz
     * cancel a failed essay.
     */
    const result = computeCaScore({
      items: [
        item({ pointsPossible: 100, score: 40, submitted: true }), // a poor essay
        item({ pointsPossible: 10, score: 10, submitted: true }), // a perfect quiz
      ],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    // 50 of 110, not the 70 a naive average of 40% and 100% would give.
    expect(result.earned).toBe(50);
    expect(result.possible).toBe(110);
    expect(result.percentage).toBeCloseTo(45.45, 1);
  });

  it('never hard-codes the weight', () => {
    // assessmentWeights.ca is a per-school setting; a school on a 30/70 split
    // must not have its CA computed against somebody else's 40.
    const items = [item({ pointsPossible: 100, score: 50, submitted: true })];
    expect(computeCaScore({ items, caWeight: 30, countMissingAsZero: false }).caScore).toBe(15);
    expect(computeCaScore({ items, caWeight: 50, countMissingAsZero: false }).caScore).toBe(25);
  });

  it('EXCLUDES work that has been handed in but not marked', () => {
    /*
     * The most important exclusion. A student whose essay the lecturer has not
     * reached has not scored nothing — they have no score, and counting it as
     * zero would depress a real CGPA on the strength of a marking backlog.
     */
    const result = computeCaScore({
      items: [
        item({ pointsPossible: 100, score: 80, submitted: true }),
        item({ pointsPossible: 100, score: null, submitted: true }), // awaiting a mark
      ],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    expect(result.counted).toBe(1);
    expect(result.excludedUnmarked).toBe(1);
    expect(result.percentage).toBe(80);
  });

  it('counts unmarked work as unmarked EVEN when missing work counts as zero', () => {
    // The two exclusions are different facts and the toggle governs only one.
    const result = computeCaScore({
      items: [
        item({ pointsPossible: 100, score: 80, submitted: true }),
        item({ pointsPossible: 100, score: null, submitted: true }),
      ],
      caWeight: CA_WEIGHT,
      countMissingAsZero: true,
    });
    expect(result.excludedUnmarked).toBe(1);
    expect(result.percentage).toBe(80);
  });

  it('excludes missing work by default, and counts it when told to', () => {
    const items = [
      item({ pointsPossible: 100, score: 80, submitted: true }),
      item({ pointsPossible: 100, score: null, submitted: false }), // never handed in
    ];

    const lenient = computeCaScore({ items, caWeight: CA_WEIGHT, countMissingAsZero: false });
    expect(lenient.percentage).toBe(80);
    expect(lenient.excludedMissing).toBe(1);

    const strict = computeCaScore({ items, caWeight: CA_WEIGHT, countMissingAsZero: true });
    expect(strict.percentage).toBe(40); // 80 of 200
    expect(strict.excludedMissing).toBe(0);
    expect(strict.counted).toBe(2);
  });

  it('returns null rather than zero when nothing counted', () => {
    // Null is "no CA yet"; zero is "scored nothing". Conflating them would post
    // a zero to every student in a course nobody has marked.
    const result = computeCaScore({
      items: [item({ score: null, submitted: true })],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    expect(result.percentage).toBeNull();
    expect(result.caScore).toBeNull();
  });

  it('handles a course with no coursework at all', () => {
    const result = computeCaScore({ items: [], caWeight: CA_WEIGHT, countMissingAsZero: true });
    expect(result.caScore).toBeNull();
    expect(result.counted).toBe(0);
  });

  it('ignores a piece worth zero marks rather than dividing by it', () => {
    const result = computeCaScore({
      items: [
        item({ pointsPossible: 0, score: 0, submitted: true }),
        item({ pointsPossible: 50, score: 25, submitted: true }),
      ],
      caWeight: CA_WEIGHT,
      countMissingAsZero: true,
    });
    expect(result.percentage).toBe(50);
    expect(result.counted).toBe(1);
  });

  it('CLAMPS a bonus mark to the school ceiling', () => {
    /*
     * A lecturer awarding 12 out of 10 has made a deliberate choice about that
     * piece. Letting it push CA past the weight would push the TOTAL past 100
     * and land in a grade band that does not exist.
     */
    const result = computeCaScore({
      items: [item({ pointsPossible: 10, score: 12, submitted: true })],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    expect(result.percentage).toBe(120);
    expect(result.caScore).toBe(CA_WEIGHT);
  });

  it('gives zero for genuinely zero work, not null', () => {
    const result = computeCaScore({
      items: [item({ pointsPossible: 100, score: 0, submitted: true })],
      caWeight: CA_WEIGHT,
      countMissingAsZero: false,
    });
    expect(result.caScore).toBe(0);
    expect(result.percentage).toBe(0);
  });
});

describe('what posting would do', () => {
  const computed = (caScore: number | null) => ({
    earned: 0,
    possible: 0,
    percentage: caScore,
    caScore,
    counted: 1,
    excludedUnmarked: 0,
    excludedMissing: 0,
  });

  it('sets a CA that was not there', () => {
    expect(previewPost({ computed: computed(30), existingCaScore: null })).toBe('WOULD_SET');
  });

  it('FLAGS an overwrite of a mark somebody typed', () => {
    /*
     * A caScore already on the enrolment was entered by a person on the
     * gradesheet — a viva mark, an agreed adjustment, a penalty. Replacing it
     * silently destroys a human judgement with no record it existed.
     */
    expect(previewPost({ computed: computed(30), existingCaScore: 35 })).toBe('WOULD_OVERWRITE');
  });

  it('does not call a rounding difference a change', () => {
    expect(previewPost({ computed: computed(30), existingCaScore: 30 })).toBe('UNCHANGED');
    expect(previewPost({ computed: computed(30.001), existingCaScore: 30 })).toBe('UNCHANGED');
  });

  it('has nothing to post when nothing was marked', () => {
    expect(previewPost({ computed: computed(null), existingCaScore: null })).toBe('NOTHING_TO_POST');
    // And an existing mark is NOT disturbed by an empty computation.
    expect(previewPost({ computed: computed(null), existingCaScore: 22 })).toBe('NOTHING_TO_POST');
  });

  it('summarises a whole class', () => {
    const row = (outcome: PostPreviewRow['outcome'], over = {}): PostPreviewRow => ({
      enrollmentId: 'e',
      studentName: 'A Student',
      matricNumber: 'M1',
      computed: { ...computed(30), ...over },
      existingCaScore: null,
      outcome,
    });

    const summary = summarisePost([
      row('WOULD_SET'),
      row('WOULD_SET'),
      row('WOULD_OVERWRITE'),
      row('UNCHANGED'),
      row('NOTHING_TO_POST', { excludedUnmarked: 2 }),
      row('WOULD_SET', { excludedMissing: 1 }),
    ]);

    expect(summary.toSet).toBe(3);
    expect(summary.toOverwrite).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.nothingToPost).toBe(1);
    expect(summary.withUnmarkedWork).toBe(1);
    expect(summary.withMissingWork).toBe(1);
  });
});

describe('marking one piece of work', () => {
  it('accepts an ordinary mark', () => {
    expect(validateMark({ score: 42, pointsPossible: 50 })).toEqual([]);
    expect(validateMark({ score: 0, pointsPossible: 50 })).toEqual([]);
    expect(validateMark({ score: 50, pointsPossible: 50 })).toEqual([]);
  });

  it('refuses a negative mark', () => {
    expect(validateMark({ score: -1, pointsPossible: 50 }).join(' ')).toMatch(/negative/);
  });

  it('ALLOWS a modest bonus mark', () => {
    // Awarding above the maximum for exceptional work is a real thing lecturers
    // do, and refusing it would make them record something untrue instead.
    expect(validateMark({ score: 55, pointsPossible: 50 })).toEqual([]);
  });

  it('questions a mark far above the maximum', () => {
    expect(validateMark({ score: 500, pointsPossible: 50 }).join(' ')).toMatch(/far above/);
  });

  it('refuses a mark that is not a number', () => {
    expect(validateMark({ score: Number.NaN, pointsPossible: 50 }).join(' ')).toMatch(/Enter a mark/);
  });
});

describe('displaying a mark', () => {
  it('reports it as a percentage', () => {
    expect(markPercentage(42, 50)).toBe(84);
  });

  it('says nothing when there is nothing to divide by', () => {
    expect(markPercentage(10, 0)).toBeNull();
    expect(markPercentage(Number.NaN, 50)).toBeNull();
  });
});
