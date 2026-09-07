import { describe, expect, it } from 'vitest';

import {
  checkPrerequisites,
  classifyDrop,
  detectTimetableConflicts,
  evaluateEligibility,
  intervalsOverlap,
  promoteFromWaitlist,
  REGISTRATION_POLICY,
  type EligibilityInput,
} from '@/lib/domain/enrollment';

const MIN = (h: number, m = 0) => h * 60 + m;

describe('interval overlap', () => {
  it('treats intervals as half-open so back-to-back classes do not clash', () => {
    // 09:00–10:00 and 10:00–11:00 must be registrable together, or no student
    // could ever build a normal timetable.
    expect(intervalsOverlap(MIN(9), MIN(10), MIN(10), MIN(11))).toBe(false);
  });

  it('detects a genuine overlap', () => {
    expect(intervalsOverlap(MIN(9), MIN(11), MIN(10), MIN(12))).toBe(true);
  });

  it('detects full containment in both directions', () => {
    expect(intervalsOverlap(MIN(9), MIN(12), MIN(10), MIN(11))).toBe(true);
    expect(intervalsOverlap(MIN(10), MIN(11), MIN(9), MIN(12))).toBe(true);
  });
});

describe('timetable conflict detection', () => {
  const existing = [
    {
      offeringLabel: 'CSC301-A',
      meetings: [{ dayOfWeek: 2, startMinute: MIN(9), endMinute: MIN(11) }],
    },
  ];

  it('reports a same-day overlap with the minutes lost', () => {
    const conflicts = detectTimetableConflicts(existing, {
      offeringLabel: 'CSC303-A',
      meetings: [{ dayOfWeek: 2, startMinute: MIN(10), endMinute: MIN(12) }],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].day).toBe('Tuesday');
    expect(conflicts[0].overlapMinutes).toBe(60);
  });

  it('ignores the same times on a different weekday', () => {
    const conflicts = detectTimetableConflicts(existing, {
      offeringLabel: 'CSC303-A',
      meetings: [{ dayOfWeek: 4, startMinute: MIN(10), endMinute: MIN(12) }],
    });
    expect(conflicts).toEqual([]);
  });

  it('finds every conflicting slot, not just the first', () => {
    const conflicts = detectTimetableConflicts(
      [
        { offeringLabel: 'A', meetings: [{ dayOfWeek: 1, startMinute: MIN(9), endMinute: MIN(11) }] },
        { offeringLabel: 'B', meetings: [{ dayOfWeek: 1, startMinute: MIN(10), endMinute: MIN(12) }] },
      ],
      {
        offeringLabel: 'C',
        meetings: [{ dayOfWeek: 1, startMinute: MIN(10, 30), endMinute: MIN(11, 30) }],
      },
    );
    expect(conflicts).toHaveLength(2);
  });
});

describe('prerequisite satisfaction', () => {
  const rules = [
    {
      prerequisiteCourseId: 'CSC201',
      prerequisiteCourseCode: 'CSC201',
      minGradePoint: 2,
      isConcurrent: false,
    },
  ];

  it('accepts a prerequisite passed at or above the minimum grade point', () => {
    const result = checkPrerequisites(rules, [{ courseId: 'CSC201', gradePoint: 2 }]);
    expect(result.satisfied).toBe(true);
  });

  it('rejects a prerequisite passed below the minimum grade point', () => {
    const result = checkPrerequisites(rules, [{ courseId: 'CSC201', gradePoint: 1 }]);
    expect(result.satisfied).toBe(false);
    expect(result.unmet[0]).toMatch(/grade point 1.0 < required 2.0/);
  });

  it('reports a prerequisite never taken', () => {
    const result = checkPrerequisites(rules, []);
    expect(result.unmet[0]).toMatch(/not taken/);
  });

  it('uses the BEST attempt, so a successful retake unlocks the course', () => {
    const result = checkPrerequisites(rules, [
      { courseId: 'CSC201', gradePoint: 0 },
      { courseId: 'CSC201', gradePoint: 3 },
    ]);
    expect(result.satisfied).toBe(true);
  });

  it('accepts a concurrent prerequisite taken in the same term', () => {
    const concurrentRules = [{ ...rules[0], isConcurrent: true }];
    expect(checkPrerequisites(concurrentRules, [], ['CSC201']).satisfied).toBe(true);
    // ...but only when it IS concurrently registered.
    expect(checkPrerequisites(concurrentRules, [], []).satisfied).toBe(false);
  });

  it('ignores an ungraded attempt', () => {
    const result = checkPrerequisites(rules, [{ courseId: 'CSC201', gradePoint: null }]);
    expect(result.satisfied).toBe(false);
  });
});

describe('enrollment eligibility', () => {
  const now = new Date('2025-09-01T09:00:00Z');

  function input(over: Partial<EligibilityInput> = {}): EligibilityInput {
    return {
      now,
      term: {
        registrationOpensAt: new Date('2025-08-01'),
        registrationClosesAt: new Date('2025-09-30'),
      },
      student: {
        status: 'ACTIVE',
        academicStanding: 'GOOD',
        cgpa: 3,
        registeredCreditsThisTerm: 6,
      },
      offering: {
        label: 'CSC301-A',
        status: 'OPEN',
        capacity: 30,
        seatsTaken: 10,
        waitlistCapacity: 5,
        currentWaitlistLength: 0,
        creditHours: 3,
        meetings: [{ dayOfWeek: 1, startMinute: MIN(9), endMinute: MIN(11) }],
      },
      blockingHolds: [],
      outstandingBalanceMinor: 0,
      prerequisiteRules: [],
      completedCourses: [],
      concurrentlyRegisteredCourseIds: [],
      existingRegistrations: [],
      alreadyEnrolled: false,
      hasOverloadApproval: false,
      ...over,
    };
  }

  it('registers an eligible student into an open section', () => {
    const result = evaluateEligibility(input());
    expect(result.outcome).toBe('REGISTERED');
    expect(result.reasons).toEqual([]);
  });

  it('waitlists when the section is full but the queue is not', () => {
    const result = evaluateEligibility(
      input({ offering: { ...input().offering, seatsTaken: 30, currentWaitlistLength: 2 } }),
    );
    expect(result.outcome).toBe('WAITLISTED');
    expect(result.waitlistPosition).toBe(3);
  });

  it('rejects when both the section and its waitlist are full', () => {
    const result = evaluateEligibility(
      input({ offering: { ...input().offering, seatsTaken: 30, currentWaitlistLength: 5 } }),
    );
    expect(result.outcome).toBe('REJECTED');
  });

  it('rejects a duplicate registration immediately', () => {
    const result = evaluateEligibility(input({ alreadyEnrolled: true }));
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons).toHaveLength(1);
  });

  it('rejects outside the registration window', () => {
    const early = evaluateEligibility(input({ now: new Date('2025-07-01') }));
    const late = evaluateEligibility(input({ now: new Date('2025-10-15') }));
    expect(early.outcome).toBe('REJECTED');
    expect(late.outcome).toBe('REJECTED');
  });

  it('rejects when a blocking hold is present', () => {
    const result = evaluateEligibility(
      input({ blockingHolds: [{ kind: 'FINANCIAL', reason: 'Unpaid tuition' }] }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons[0]).toMatch(/Unpaid tuition/);
  });

  it('rejects an outstanding balance', () => {
    const result = evaluateEligibility(input({ outstandingBalanceMinor: 50_000 }));
    expect(result.outcome).toBe('REJECTED');
  });

  it('rejects a student under academic dismissal', () => {
    const result = evaluateEligibility(
      input({ student: { ...input().student, academicStanding: 'DISMISSED' } }),
    );
    expect(result.outcome).toBe('REJECTED');
  });

  it('rejects a timetable clash', () => {
    const result = evaluateEligibility(
      input({
        existingRegistrations: [
          {
            offeringLabel: 'MTH102-A',
            meetings: [{ dayOfWeek: 1, startMinute: MIN(10), endMinute: MIN(12) }],
          },
        ],
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons[0]).toMatch(/Timetable clash/);
  });

  it('rejects a registration that would exceed the credit ceiling', () => {
    const result = evaluateEligibility(
      input({
        student: {
          ...input().student,
          registeredCreditsThisTerm: REGISTRATION_POLICY.maxCreditsPerTerm,
        },
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons[0]).toMatch(/maximum/);
  });

  it('allows an approved overload past the normal ceiling', () => {
    const result = evaluateEligibility(
      input({
        student: {
          ...input().student,
          registeredCreditsThisTerm: REGISTRATION_POLICY.maxCreditsPerTerm,
        },
        hasOverloadApproval: true,
      }),
    );
    expect(result.outcome).toBe('REGISTERED');
  });

  it('reports every failing rule at once rather than the first', () => {
    // A student should be told everything that is wrong, not made to fix one
    // problem at a time and resubmit.
    const result = evaluateEligibility(
      input({
        outstandingBalanceMinor: 10_000,
        blockingHolds: [{ kind: 'ACADEMIC', reason: 'Missing transcript' }],
        prerequisiteRules: [
          {
            prerequisiteCourseId: 'CSC201',
            prerequisiteCourseCode: 'CSC201',
            minGradePoint: 2,
            isConcurrent: false,
          },
        ],
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('does not consume a waitlist place for a student who is ineligible anyway', () => {
    const result = evaluateEligibility(
      input({
        offering: { ...input().offering, seatsTaken: 30 },
        blockingHolds: [{ kind: 'FINANCIAL', reason: 'Unpaid' }],
      }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.waitlistPosition).toBeNull();
  });
});

describe('waitlist promotion', () => {
  const queue = [
    { enrollmentId: 'a', studentId: 's1', waitlistPosition: 1 },
    { enrollmentId: 'b', studentId: 's2', waitlistPosition: 2 },
    { enrollmentId: 'c', studentId: 's3', waitlistPosition: 3 },
  ];

  it('promotes the head of the queue', () => {
    const { promote } = promoteFromWaitlist(queue, 1);
    expect(promote.map((p) => p.enrollmentId)).toEqual(['a']);
  });

  it('compacts the remaining queue so positions stay dense', () => {
    // The student is shown "you are number 2". A hole in the queue would make
    // that number a lie.
    const { renumbered } = promoteFromWaitlist(queue, 1);
    expect(renumbered).toEqual([
      { enrollmentId: 'b', waitlistPosition: 1 },
      { enrollmentId: 'c', waitlistPosition: 2 },
    ]);
  });

  it('promotes several at once when a batch of seats frees up', () => {
    const { promote, renumbered } = promoteFromWaitlist(queue, 2);
    expect(promote.map((p) => p.enrollmentId)).toEqual(['a', 'b']);
    expect(renumbered).toEqual([{ enrollmentId: 'c', waitlistPosition: 1 }]);
  });

  it('handles an out-of-order queue by sorting on position', () => {
    const shuffled = [queue[2], queue[0], queue[1]];
    const { promote } = promoteFromWaitlist(shuffled, 1);
    expect(promote[0].enrollmentId).toBe('a');
  });

  it('does nothing when no seats free up or the queue is empty', () => {
    expect(promoteFromWaitlist(queue, 0).promote).toEqual([]);
    expect(promoteFromWaitlist([], 3).promote).toEqual([]);
  });
});

describe('drop versus withdraw', () => {
  const deadlines = {
    addDropDeadline: new Date('2025-09-15'),
    withdrawalDeadline: new Date('2025-11-01'),
  };

  it('drops cleanly on or before the add/drop deadline', () => {
    const result = classifyDrop(new Date('2025-09-10'), deadlines);
    expect(result.kind).toBe('DROPPED');
    if (result.kind === 'DROPPED') {
      expect(result.transcriptNotation).toBeNull();
      expect(result.refundEligible).toBe(true);
    }
  });

  it('treats the deadline itself as still droppable', () => {
    expect(classifyDrop(new Date('2025-09-15'), deadlines).kind).toBe('DROPPED');
  });

  it('withdraws with a "W" between the two deadlines', () => {
    const result = classifyDrop(new Date('2025-10-01'), deadlines);
    expect(result.kind).toBe('WITHDRAWN');
    if (result.kind === 'WITHDRAWN') {
      expect(result.transcriptNotation).toBe('W');
      expect(result.refundEligible).toBe(false);
    }
  });

  it('denies any exit after the withdrawal deadline', () => {
    expect(classifyDrop(new Date('2025-11-15'), deadlines).kind).toBe('DENIED');
  });
});
