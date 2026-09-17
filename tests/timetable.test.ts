import { describe, expect, it } from 'vitest';

import {
  DAYS,
  detectClashes,
  isDayOfWeek,
  layOutDay,
  normaliseRoom,
  validateSlot,
  wouldClash,
  type ScheduledSlot,
} from '@/lib/domain/timetable';

function slot(over: Partial<ScheduledSlot> & { id: string }): ScheduledSlot {
  return {
    dayOfWeek: 1,
    startMinute: 8 * 60,
    endMinute: 10 * 60,
    room: null,
    offeringId: `o-${over.id}`,
    offeringLabel: `CSC10${over.id}`,
    teacherId: null,
    teacherName: null,
    ...over,
  };
}

describe('clash detection', () => {
  it('catches a lecturer timetabled twice at once', () => {
    const clashes = detectClashes([
      slot({ id: 'a', teacherId: 't1', teacherName: 'Dr Okafor' }),
      slot({ id: 'b', teacherId: 't1', teacherName: 'Dr Okafor', startMinute: 9 * 60 }),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].kind).toBe('TEACHER');
    expect(clashes[0].message).toMatch(/Dr Okafor is timetabled twice/);
  });

  it('catches a double-booked room', () => {
    const clashes = detectClashes([
      slot({ id: 'a', room: 'LT-1' }),
      slot({ id: 'b', room: 'LT-1', startMinute: 9 * 60 }),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].kind).toBe('ROOM');
  });

  it('matches rooms the way a caretaker does, not the way a string does', () => {
    /*
     * "LT-1", "LT1" and "lt 1" are one room to the person who unlocks it and
     * three to a naive comparison. A detector over raw strings produces false
     * NEGATIVES, which is worse than no detector — the timetable is believed.
     */
    expect(normaliseRoom('LT-1')).toBe(normaliseRoom('lt 1'));
    expect(normaliseRoom('LT-1')).toBe(normaliseRoom('LT1'));
    expect(normaliseRoom(' Lab_2 ')).toBe('LAB2');

    const clashes = detectClashes([
      slot({ id: 'a', room: 'LT-1' }),
      slot({ id: 'b', room: 'lt 1', startMinute: 9 * 60 }),
    ]);
    expect(clashes).toHaveLength(1);
  });

  it('does NOT treat two unknown rooms as the same place', () => {
    // A field trip and an online seminar are both "no room recorded". Calling
    // that a clash would report two classes nowhere near each other.
    const clashes = detectClashes([
      slot({ id: 'a', room: null }),
      slot({ id: 'b', room: null, startMinute: 9 * 60 }),
    ]);
    expect(clashes).toHaveLength(0);
  });

  it('is half-open, so back-to-back classes do not clash', () => {
    // The single most common arrangement in any real timetable.
    const clashes = detectClashes([
      slot({ id: 'a', room: 'LT-1', startMinute: 8 * 60, endMinute: 10 * 60 }),
      slot({ id: 'b', room: 'LT-1', startMinute: 10 * 60, endMinute: 12 * 60 }),
    ]);
    expect(clashes).toHaveLength(0);
  });

  it('does not clash across different days', () => {
    const clashes = detectClashes([
      slot({ id: 'a', teacherId: 't1', dayOfWeek: 1 }),
      slot({ id: 'b', teacherId: 't1', dayOfWeek: 2 }),
    ]);
    expect(clashes).toHaveLength(0);
  });

  it('catches a section meeting itself twice', () => {
    const clashes = detectClashes([
      slot({ id: 'a', offeringId: 'same' }),
      slot({ id: 'b', offeringId: 'same', startMinute: 9 * 60 }),
    ]);
    expect(clashes.some((c) => c.kind === 'GROUP')).toBe(true);
  });

  it('reports the overlap in minutes', () => {
    const clashes = detectClashes([
      slot({ id: 'a', teacherId: 't1', startMinute: 8 * 60, endMinute: 10 * 60 }),
      slot({ id: 'b', teacherId: 't1', startMinute: 9 * 60, endMinute: 11 * 60 }),
    ]);
    expect(clashes[0].overlapMinutes).toBe(60);
    expect(clashes[0].message).toMatch(/60 minutes/);
  });

  it('reports all three kinds when one slot breaks all of them', () => {
    const clashes = detectClashes([
      slot({ id: 'a', teacherId: 't1', room: 'LT-1', offeringId: 'same' }),
      slot({ id: 'b', teacherId: 't1', room: 'LT-1', offeringId: 'same', startMinute: 9 * 60 }),
    ]);
    expect(new Set(clashes.map((c) => c.kind))).toEqual(new Set(['TEACHER', 'ROOM', 'GROUP']));
  });

  it('finds nothing in an empty or single-slot timetable', () => {
    expect(detectClashes([])).toHaveLength(0);
    expect(detectClashes([slot({ id: 'a', teacherId: 't1', room: 'LT-1' })])).toHaveLength(0);
  });
});

describe('checking a candidate before saving it', () => {
  const existing = [
    slot({ id: 'a', teacherId: 't1', teacherName: 'Dr Okafor', room: 'LT-1' }),
    slot({ id: 'b', teacherId: 't2', room: 'LT-2', dayOfWeek: 3 }),
  ];

  it('reports only the clashes the candidate is part of', () => {
    const clashes = wouldClash(
      slot({ id: 'new', teacherId: 't1', startMinute: 9 * 60 }),
      existing,
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].kind).toBe('TEACHER');
  });

  it('does not report a slot clashing with its own earlier version', () => {
    // Editing a slot without moving it must not report it against itself.
    const clashes = wouldClash(
      slot({ id: 'a', teacherId: 't1', room: 'LT-1', startMinute: 8 * 60 }),
      existing,
    );
    expect(clashes).toHaveLength(0);
  });

  it('finds nothing for a free slot', () => {
    expect(wouldClash(slot({ id: 'new', dayOfWeek: 5, room: 'LT-9' }), existing)).toHaveLength(0);
  });
});

describe('validating a slot', () => {
  const good = { dayOfWeek: 1, startMinute: 8 * 60, endMinute: 10 * 60 };

  it('accepts a well-formed slot', () => {
    expect(validateSlot(good)).toEqual([]);
  });

  it('refuses a class that ends before it starts', () => {
    expect(validateSlot({ ...good, endMinute: 7 * 60 }).join(' ')).toMatch(/end after it starts/);
  });

  it('refuses a day that is not a day', () => {
    expect(validateSlot({ ...good, dayOfWeek: 0 }).join(' ')).toMatch(/Choose a day/);
    expect(validateSlot({ ...good, dayOfWeek: 8 }).join(' ')).toMatch(/Choose a day/);
    for (const d of DAYS) expect(isDayOfWeek(d)).toBe(true);
  });

  it('treats a sub-quarter-hour class as a typo', () => {
    expect(validateSlot({ ...good, endMinute: 8 * 60 + 5 }).join(' ')).toMatch(/typo/);
  });

  it('refuses an implausibly long class', () => {
    expect(validateSlot({ ...good, endMinute: 20 * 60 }).join(' ')).toMatch(/eight hours/);
  });
});

describe('laying out a day', () => {
  it('puts non-overlapping classes in one column', () => {
    const laid = layOutDay([
      slot({ id: 'a', startMinute: 8 * 60, endMinute: 10 * 60 }),
      slot({ id: 'b', startMinute: 10 * 60, endMinute: 12 * 60 }),
    ]);
    expect(laid.every((s) => s.columns === 1)).toBe(true);
  });

  it('puts overlapping classes SIDE BY SIDE', () => {
    // A clash the eye cannot see is a clash nobody fixes, and finding them is
    // the reason the page exists.
    const laid = layOutDay([
      slot({ id: 'a', startMinute: 8 * 60, endMinute: 10 * 60 }),
      slot({ id: 'b', startMinute: 9 * 60, endMinute: 11 * 60 }),
    ]);
    expect(laid[0].columns).toBe(2);
    expect(new Set(laid.map((s) => s.column))).toEqual(new Set([0, 1]));
  });

  it('positions a slot proportionally within the grid window', () => {
    const [laid] = layOutDay([slot({ id: 'a', startMinute: 7 * 60, endMinute: 8 * 60 })]);
    // The grid starts at 07:00, so a 07:00 class sits at the very top.
    expect(laid.top).toBe(0);
    expect(laid.height).toBeGreaterThan(0);
  });

  it('reuses a column once its occupant has finished', () => {
    const laid = layOutDay([
      slot({ id: 'a', startMinute: 8 * 60, endMinute: 9 * 60 }),
      slot({ id: 'b', startMinute: 8 * 60 + 30, endMinute: 10 * 60 }),
      slot({ id: 'c', startMinute: 10 * 60, endMinute: 11 * 60 }),
    ]);
    const c = laid.find((s) => s.id === 'c')!;
    expect(c.column).toBe(0);
  });

  it('handles an empty day', () => {
    expect(layOutDay([])).toEqual([]);
  });
});
