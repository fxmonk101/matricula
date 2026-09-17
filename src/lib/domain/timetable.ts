import { intervalsOverlap } from './enrollment';

/**
 * =============================================================================
 * THE TIMETABLE
 * =============================================================================
 *
 * Clash detection across the three resources a scheduled class consumes: the
 * LECTURER, the ROOM, and the CLASS GROUP.
 *
 * `detectTimetableConflicts` in `./enrollment` answers a different question —
 * "can this ONE student take these sections together" — and is untouched. This
 * asks "does the institution's timetable contradict itself", which is the same
 * overlap arithmetic over a different grouping key, and it returns the REASON
 * so the screen can explain a refusal rather than merely refuse.
 *
 * The overlap primitive is reused rather than rewritten. It is half-open, so a
 * class ending at 10:00 and one starting at 10:00 correctly do not clash —
 * which is the single most common arrangement in any real timetable.
 */

export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type DayOfWeek = (typeof DAYS)[number];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const DAY_SHORT: Record<DayOfWeek, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function isDayOfWeek(value: number): value is DayOfWeek {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

// -----------------------------------------------------------------------------
// The grid
// -----------------------------------------------------------------------------

/** The window a grid renders. Outside it, nothing is timetabled anywhere. */
export const GRID_START_MINUTE = 7 * 60;
export const GRID_END_MINUTE = 20 * 60;

export interface ScheduledSlot {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  room: string | null;
  offeringId: string;
  offeringLabel: string;
  /** Membership id of whoever teaches it, where one is assigned. */
  teacherId: string | null;
  teacherName: string | null;
}

export type ClashKind = 'TEACHER' | 'ROOM' | 'GROUP';

export interface Clash {
  kind: ClashKind;
  /** The thing that is double-booked: a person's name, a room, a section. */
  subject: string;
  dayOfWeek: number;
  a: ScheduledSlot;
  b: ScheduledSlot;
  overlapMinutes: number;
  /** A sentence a dean can act on. */
  message: string;
}

function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Every way the given slots contradict each other.
 *
 * Grouped by (day, resource) so the comparison is quadratic only within a
 * bucket — a full institutional timetable is thousands of slots, and comparing
 * every pair against every other would be seconds of work to answer a question
 * asked on every page load.
 *
 * A room of `null` is NOT a clash. Plenty of teaching has no room recorded —
 * a field trip, an online seminar, a slot the registry has not allocated yet —
 * and treating "unknown" as "the same place" would report a clash between two
 * classes that are nowhere near each other.
 */
export function detectClashes(slots: readonly ScheduledSlot[]): Clash[] {
  const clashes: Clash[] = [];

  const buckets = new Map<string, ScheduledSlot[]>();
  const push = (key: string, slot: ScheduledSlot) => {
    const list = buckets.get(key);
    if (list) list.push(slot);
    else buckets.set(key, [slot]);
  };

  for (const slot of slots) {
    if (slot.teacherId) push(`TEACHER|${slot.dayOfWeek}|${slot.teacherId}`, slot);
    if (slot.room && slot.room.trim()) {
      // Normalised, because "LT-1", "LT1" and "lt 1" are one room to the
      // caretaker. Comparing the raw strings produces false NEGATIVES, which
      // is worse than no detector at all — the timetable is then believed.
      push(`ROOM|${slot.dayOfWeek}|${normaliseRoom(slot.room)}`, slot);
    }
    push(`GROUP|${slot.dayOfWeek}|${slot.offeringId}`, slot);
  }

  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const [kind, day] = key.split('|') as [ClashKind, string];

    const sorted = [...bucket].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        // Sorted by start, so once b begins after a ends nothing later can
        // overlap a either.
        if (b.startMinute >= a.endMinute) break;
        if (!intervalsOverlap(a.startMinute, a.endMinute, b.startMinute, b.endMinute)) continue;

        const overlap =
          Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute);

        const subject =
          kind === 'TEACHER'
            ? (a.teacherName ?? 'A lecturer')
            : kind === 'ROOM'
              ? (a.room ?? 'A room')
              : a.offeringLabel;

        const what =
          kind === 'TEACHER'
            ? `${subject} is timetabled twice`
            : kind === 'ROOM'
              ? `${subject} is double-booked`
              : `${subject} meets twice`;

        clashes.push({
          kind,
          subject,
          dayOfWeek: Number(day),
          a,
          b,
          overlapMinutes: overlap,
          message: `${what} on ${DAY_LABELS[Number(day) as DayOfWeek]}: ${a.offeringLabel} at ${minuteLabel(a.startMinute)}–${minuteLabel(a.endMinute)} overlaps ${b.offeringLabel} at ${minuteLabel(b.startMinute)}–${minuteLabel(b.endMinute)} by ${overlap} minutes.`,
        });
      }
    }
  }

  return clashes;
}

/**
 * A room name reduced to what actually identifies it.
 *
 * "LT-1", "LT1" and "lt 1" are one room to the caretaker and three to a naive
 * string comparison, so a clash detector over raw strings silently misses real
 * double-bookings. Until rooms are a table, this is what makes the comparison
 * mean anything.
 */
export function normaliseRoom(room: string): string {
  return room.trim().toUpperCase().replace(/[\s._-]+/g, '');
}

/** Would adding this slot clash with what is already there? */
export function wouldClash(
  candidate: ScheduledSlot,
  existing: readonly ScheduledSlot[],
): Clash[] {
  return detectClashes([...existing.filter((s) => s.id !== candidate.id), candidate]).filter(
    (c) => c.a.id === candidate.id || c.b.id === candidate.id,
  );
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export interface SlotDraft {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  room?: string | null;
}

export function validateSlot(draft: SlotDraft): string[] {
  const problems: string[] = [];

  if (!isDayOfWeek(draft.dayOfWeek)) problems.push('Choose a day.');

  if (!Number.isInteger(draft.startMinute) || draft.startMinute < 0 || draft.startMinute > 1439) {
    problems.push('Enter a valid start time.');
  }
  if (!Number.isInteger(draft.endMinute) || draft.endMinute < 1 || draft.endMinute > 1440) {
    problems.push('Enter a valid end time.');
  }
  if (
    Number.isInteger(draft.startMinute) &&
    Number.isInteger(draft.endMinute) &&
    draft.endMinute <= draft.startMinute
  ) {
    problems.push('The class must end after it starts.');
  }

  const length = draft.endMinute - draft.startMinute;
  if (length > 0 && length < 15) problems.push('A class shorter than fifteen minutes is a typo.');
  if (length > 8 * 60) problems.push('That is longer than eight hours.');

  if (draft.room && draft.room.length > 40) problems.push('That room name is too long.');

  return problems;
}

// -----------------------------------------------------------------------------
// Laying the grid out
// -----------------------------------------------------------------------------

export interface PositionedSlot extends ScheduledSlot {
  /** Percent from the top of the day column. */
  top: number;
  /** Percent of the column's height. */
  height: number;
  /** Horizontal share, for slots that overlap and must sit side by side. */
  column: number;
  columns: number;
}

/**
 * Place the slots of one day, side by side where they overlap.
 *
 * Overlapping slots are laid out rather than stacked on top of each other,
 * because a clash the eye cannot see is a clash nobody fixes — and the whole
 * reason a dean opens this page is to find them.
 */
export function layOutDay(slots: readonly ScheduledSlot[]): PositionedSlot[] {
  const span = GRID_END_MINUTE - GRID_START_MINUTE;
  const sorted = [...slots].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );

  // Greedy column assignment: a slot takes the first column whose last
  // occupant has already finished.
  const columnEnds: number[] = [];
  const assigned = sorted.map((slot) => {
    let column = columnEnds.findIndex((end) => end <= slot.startMinute);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(slot.endMinute);
    } else {
      columnEnds[column] = slot.endMinute;
    }
    return { slot, column };
  });

  const columns = Math.max(1, columnEnds.length);

  return assigned.map(({ slot, column }) => ({
    ...slot,
    top: ((slot.startMinute - GRID_START_MINUTE) / span) * 100,
    height: ((slot.endMinute - slot.startMinute) / span) * 100,
    column,
    columns,
  }));
}
