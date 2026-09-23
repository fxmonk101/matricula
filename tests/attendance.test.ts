import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ATTENDANCE_POLICY,
  blankRegister,
  classesNeededToClear,
  eligibilityFor,
  formatRate,
  sessionAcceptsRegister,
  tally,
  validateRegister,
  type ClassAttendanceStatus,
} from '@/lib/domain/attendance';

/*
 * Attendance.
 *
 * The consequence of getting this wrong is not a wrong number on a page — it is
 * a student told they may not sit an examination they have paid for and
 * prepared for. So the tests below are mostly about the four judgements the
 * module makes, and each one is written as the situation it protects rather
 * than as the branch it covers.
 */

const s = (...statuses: ClassAttendanceStatus[]) => statuses;

describe('what counts as having been there', () => {
  it('counts LATE as attended', () => {
    // Otherwise a student with a bad commute who missed nothing all term is
    // barred from the examination.
    const t = tally(s('LATE', 'LATE', 'LATE', 'LATE'));
    expect(t.attended).toBe(4);
    expect(t.missed).toBe(0);
    expect(t.percentage).toBe(100);
  });

  it('takes EXCUSED out of the calculation entirely', () => {
    // Three weeks in hospital, four classes attended out of the four they
    // could have attended. That is 100%, not 40%.
    const t = tally(s('PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'EXCUSED', 'EXCUSED', 'EXCUSED'));
    expect(t.counted).toBe(4);
    expect(t.excused).toBe(3);
    expect(t.percentage).toBe(100);
  });

  it('does not let an excuse inflate a rate above what was attended', () => {
    const t = tally(s('PRESENT', 'ABSENT', 'EXCUSED'));
    expect(t.percentage).toBe(50);
  });

  it('counts ABSENT against the student', () => {
    const t = tally(s('PRESENT', 'PRESENT', 'PRESENT', 'ABSENT'));
    expect(t.percentage).toBe(75);
  });
});

describe('when no register has been taken', () => {
  it('reports null rather than 0%', () => {
    /*
     * The bug this prevents: every student in a new installation sitting at
     * the bottom of an eligibility report on their first day, because nobody
     * has taken a register yet, and somebody acting on it.
     */
    expect(tally([]).percentage).toBeNull();
    expect(tally(s('EXCUSED', 'EXCUSED')).percentage).toBeNull();
  });

  it('says so in words rather than showing a number', () => {
    expect(formatRate(tally([]))).toBe('No register taken');
  });

  it('returns UNKNOWN, which is NOT the same answer as ELIGIBLE', () => {
    expect(eligibilityFor(tally([]))).toBe('UNKNOWN');
    expect(eligibilityFor(tally([]))).not.toBe('ELIGIBLE');
  });
});

describe('eligibility to sit the examination', () => {
  const enforced = { examEligibilityThreshold: 75, warningThreshold: 80, enforced: true };

  it('is ELIGIBLE comfortably above the bar', () => {
    expect(eligibilityFor(tally(s('PRESENT', 'PRESENT', 'PRESENT', 'PRESENT')), enforced)).toBe(
      'ELIGIBLE',
    );
  });

  it('warns between the bar and the warning line', () => {
    // 3 of 4 = 75%: over the bar, under the 80% warning line.
    expect(eligibilityFor(tally(s('PRESENT', 'PRESENT', 'PRESENT', 'ABSENT')), enforced)).toBe(
      'AT_RISK',
    );
  });

  it('BARS below the bar once a school has turned the rule on', () => {
    // 2 of 4 = 50%.
    expect(
      eligibilityFor(tally(s('PRESENT', 'PRESENT', 'ABSENT', 'ABSENT')), enforced),
    ).toBe('BARRED');
  });

  it('NEVER bars while the rule is off, which is the default', () => {
    /*
     * The safety property. A school that has just installed the system, or is
     * still deciding its policy, cannot accidentally bar a cohort — the worst
     * outcome available here and one that would be discovered too late.
     */
    expect(DEFAULT_ATTENDANCE_POLICY.enforced).toBe(false);

    const terrible = tally(s('ABSENT', 'ABSENT', 'ABSENT', 'ABSENT', 'PRESENT'));
    expect(eligibilityFor(terrible)).not.toBe('BARRED');
  });

  it('says BELOW rather than AT_RISK for somebody nowhere near the bar', () => {
    /*
     * These were one verdict, and the product lied because of it: a student
     * on 0% was shown the at-risk copy and told they were "close to" the 75%
     * they needed. False reassurance is the one thing that stops somebody
     * acting while there is still term left to act in.
     *
     * BELOW and BARRED are the same SHORTFALL; only the consequence differs.
     * AT_RISK means genuinely near the line.
     */
    const policy = { examEligibilityThreshold: 75, warningThreshold: 80, enforced: false };

    const nowhereNear = tally(s('ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'));
    expect(nowhereNear.percentage).toBe(0);
    expect(eligibilityFor(nowhereNear, policy)).toBe('BELOW');

    // 3 of 4 = 75%: over the bar, under the warning line. Genuinely close.
    const genuinelyClose = tally(s('PRESENT', 'PRESENT', 'PRESENT', 'ABSENT'));
    expect(eligibilityFor(genuinelyClose, policy)).toBe('AT_RISK');
  });

  it('turns BELOW into BARRED when a school enforces, and nothing else changes', () => {
    const off = { examEligibilityThreshold: 75, warningThreshold: 80, enforced: false };
    const on = { ...off, enforced: true };

    const short = tally(s('ABSENT', 'ABSENT', 'ABSENT', 'PRESENT'));
    expect(eligibilityFor(short, off)).toBe('BELOW');
    expect(eligibilityFor(short, on)).toBe('BARRED');

    // Enforcement must not move anybody who was already clear.
    const fine = tally(s('PRESENT', 'PRESENT', 'PRESENT', 'PRESENT'));
    expect(eligibilityFor(fine, off)).toBe(eligibilityFor(fine, on));
  });

  it('treats exactly the threshold as clearing it, not failing it', () => {
    // 75.0% against a 75% rule must sit. "At least" is what the rule says.
    const exact = tally(s('PRESENT', 'PRESENT', 'PRESENT', 'ABSENT'));
    expect(exact.percentage).toBe(75);
    expect(eligibilityFor(exact, enforced)).not.toBe('BARRED');
  });
});

describe('how many more classes are needed', () => {
  const policy = { examEligibilityThreshold: 75, warningThreshold: 80, enforced: true };

  it('is zero for a student already above the bar', () => {
    expect(classesNeededToClear(tally(s('PRESENT', 'PRESENT', 'PRESENT', 'PRESENT')), policy)).toBe(0);
  });

  it('computes the run a student below the bar must put together', () => {
    // 2 of 4 = 50%. (0.75*4 - 2) / 0.25 = 4.
    const t = tally(s('PRESENT', 'PRESENT', 'ABSENT', 'ABSENT'));
    const needed = classesNeededToClear(t, policy);
    expect(needed).toBe(4);

    // And the answer must actually be true: attending that many clears it.
    const after = tally([...s('PRESENT', 'PRESENT', 'ABSENT', 'ABSENT'), ...Array(needed!).fill('PRESENT' as const)]);
    expect(after.percentage).toBeGreaterThanOrEqual(75);
  });

  it('never returns a number that would still leave them short', () => {
    // Property check across a range of awkward tallies, because an off-by-one
    // here is a student told "two more" who is then refused anyway.
    for (let attended = 0; attended <= 20; attended += 1) {
      for (let missed = 0; missed <= 20; missed += 1) {
        if (attended + missed === 0) continue;
        const t = tally([
          ...Array(attended).fill('PRESENT' as const),
          ...Array(missed).fill('ABSENT' as const),
        ]);
        const needed = classesNeededToClear(t, policy);
        if (needed === null || needed === 0) continue;

        const after = tally([
          ...Array(attended + needed).fill('PRESENT' as const),
          ...Array(missed).fill('ABSENT' as const),
        ]);
        expect(after.percentage).toBeGreaterThanOrEqual(policy.examEligibilityThreshold);

        // And it must be the SMALLEST such number.
        if (needed > 1) {
          const oneFewer = tally([
            ...Array(attended + needed - 1).fill('PRESENT' as const),
            ...Array(missed).fill('ABSENT' as const),
          ]);
          expect(oneFewer.percentage).toBeLessThan(policy.examEligibilityThreshold);
        }
      }
    }
  });

  it('returns null when there is no register to reason from', () => {
    expect(classesNeededToClear(tally([]), policy)).toBeNull();
  });
});

describe('taking the register', () => {
  const roster = ['e1', 'e2', 'e3'];

  it('starts everybody PRESENT', () => {
    /*
     * The opposite default turns a register the lecturer opened and never
     * submitted into a cohort of absences nobody intended.
     */
    expect(blankRegister(roster)).toEqual([
      { enrollmentId: 'e1', status: 'PRESENT' },
      { enrollmentId: 'e2', status: 'PRESENT' },
      { enrollmentId: 'e3', status: 'PRESENT' },
    ]);
  });

  it('accepts a well-formed register', () => {
    expect(
      validateRegister(
        [
          { enrollmentId: 'e1', status: 'PRESENT' },
          { enrollmentId: 'e2', status: 'ABSENT' },
        ],
        roster,
      ),
    ).toEqual([]);
  });

  it('REJECTS somebody who is not on the course rather than dropping them', () => {
    // Silently ignoring the row would report success for a save that did not
    // happen the way the lecturer was shown.
    const problems = validateRegister(
      [{ enrollmentId: 'someone-else', status: 'PRESENT' }],
      roster,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not on this course/);
  });

  it('rejects the same student marked twice', () => {
    const problems = validateRegister(
      [
        { enrollmentId: 'e1', status: 'PRESENT' },
        { enrollmentId: 'e1', status: 'ABSENT' },
      ],
      roster,
    );
    expect(problems[0]).toMatch(/twice/);
  });

  it('rejects a status that is not one of the four', () => {
    const problems = validateRegister(
      [{ enrollmentId: 'e1', status: 'TRUANT' as ClassAttendanceStatus }],
      roster,
    );
    expect(problems[0]).toMatch(/not an attendance status/);
  });

  it('says each thing once, however many rows are wrong', () => {
    const problems = validateRegister(
      [
        { enrollmentId: 'x', status: 'PRESENT' },
        { enrollmentId: 'y', status: 'PRESENT' },
        { enrollmentId: 'z', status: 'PRESENT' },
      ],
      roster,
    );
    expect(problems).toHaveLength(1);
  });
});

describe('which sessions carry a register', () => {
  it('takes one for a delivered class', () => {
    expect(sessionAcceptsRegister('DELIVERED')).toBe(true);
  });

  it('refuses one for a CANCELLED class', () => {
    /*
     * Nobody was absent from a lecture that did not happen. Letting a
     * cancellation carry absences is how a student is barred for a class the
     * lecturer called off.
     */
    expect(sessionAcceptsRegister('CANCELLED')).toBe(false);
    expect(sessionAcceptsRegister('MOVED')).toBe(false);
  });
});
