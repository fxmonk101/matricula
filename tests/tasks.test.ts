import { describe, expect, it } from 'vitest';

import {
  assessLateness,
  averageTurnaroundDays,
  canAcceptTask,
  canEditTask,
  canViewTask,
  compareTasks,
  daysBetween,
  loadImbalance,
  nextEscalation,
  proposeAssignee,
  summariseTasks,
  viewWorkload,
  type TaskStat,
  type WorkloadEntry,
} from '@/lib/domain/tasks';
import { assertTaskTransition, TASK_TRANSITIONS, type TaskStatus } from '@/lib/domain/enums';

const NOW = new Date('2026-03-15T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function task(over: Partial<TaskStat> = {}): TaskStat {
  return {
    status: 'OPEN',
    priority: 'NORMAL',
    dueAt: null,
    completedAt: null,
    ...over,
  };
}

// -----------------------------------------------------------------------------
describe('the task state machine', () => {
  it('is total — every status has an entry', () => {
    const statuses: TaskStatus[] = [
      'OPEN', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED', 'COMPLETED', 'CANCELLED',
    ];
    for (const s of statuses) expect(TASK_TRANSITIONS[s]).toBeDefined();
  });

  it('never names a status that does not exist', () => {
    const known = new Set(Object.keys(TASK_TRANSITIONS));
    for (const targets of Object.values(TASK_TRANSITIONS)) {
      for (const t of targets) expect(known.has(t)).toBe(true);
    }
  });

  it('separates submitting work from having it accepted', () => {
    // The assignee can reach SUBMITTED; only the transition out of it reaches
    // COMPLETED. If OPEN -> COMPLETED were legal the SUBMITTED state would be
    // decorative and a dean's dashboard would report intentions.
    expect(TASK_TRANSITIONS.OPEN).not.toContain('COMPLETED');
    expect(TASK_TRANSITIONS.SUBMITTED).toContain('COMPLETED');
  });

  it('lets accepted work be reopened but not cancelled work', () => {
    expect(TASK_TRANSITIONS.COMPLETED).toContain('IN_PROGRESS');
    expect(TASK_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it('rejects an illegal transition by name', () => {
    expect(() => assertTaskTransition('CANCELLED', 'OPEN')).toThrow(/CANCELLED -> OPEN/);
    expect(() => assertTaskTransition('OPEN', 'COMPLETED')).toThrow();
  });

  it('permits the ordinary happy path end to end', () => {
    expect(() => {
      assertTaskTransition('OPEN', 'IN_PROGRESS');
      assertTaskTransition('IN_PROGRESS', 'SUBMITTED');
      assertTaskTransition('SUBMITTED', 'COMPLETED');
    }).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
describe('lateness', () => {
  it('reports a task with no due date as neither overdue nor late', () => {
    const l = assessLateness(task(), NOW);
    expect(l.isOverdue).toBe(false);
    expect(l.wasLate).toBe(false);
    expect(l.daysLate).toBeNull();
  });

  it('reports an open task past its due date as overdue', () => {
    const l = assessLateness(task({ dueAt: day(-3) }), NOW);
    expect(l.isOverdue).toBe(true);
    expect(l.daysLate).toBe(3);
    expect(l.daysRemaining).toBeNull();
  });

  it('counts down for an open task that still has time', () => {
    const l = assessLateness(task({ dueAt: day(4) }), NOW);
    expect(l.isOverdue).toBe(false);
    expect(l.daysRemaining).toBe(4);
  });

  it('does not call a completed-but-late task overdue', () => {
    // The distinction the whole module turns on: there is nothing left to
    // chase, so it must not appear on an "overdue" list, but the lateness is
    // still a fact for the term report.
    const l = assessLateness(
      task({ status: 'COMPLETED', dueAt: day(-10), completedAt: day(-8) }),
      NOW,
    );
    expect(l.isOverdue).toBe(false);
    expect(l.wasLate).toBe(true);
    expect(l.daysLate).toBe(2);
  });

  it('treats work completed before the deadline as on time', () => {
    const l = assessLateness(
      task({ status: 'COMPLETED', dueAt: day(-2), completedAt: day(-5) }),
      NOW,
    );
    expect(l.wasLate).toBe(false);
  });

  it('does not infer lateness from a missing completion time', () => {
    // Marking someone late on the strength of a null is worse than missing it.
    const l = assessLateness(
      task({ status: 'COMPLETED', dueAt: day(-30), completedAt: null }),
      NOW,
    );
    expect(l.wasLate).toBe(false);
  });

  it('never calls cancelled work late', () => {
    const l = assessLateness(task({ status: 'CANCELLED', dueAt: day(-40) }), NOW);
    expect(l.isOverdue).toBe(false);
    expect(l.wasLate).toBe(false);
  });

  it('measures whole days', () => {
    expect(daysBetween(NOW, day(5))).toBe(5);
    expect(daysBetween(NOW, day(-5))).toBe(-5);
  });
});

// -----------------------------------------------------------------------------
describe('escalation', () => {
  const esc = (over: Parameters<typeof nextEscalation>[0]) => nextEscalation(over, NOW);

  it('does nothing for a closed task however late', () => {
    expect(
      esc({ ...task({ status: 'COMPLETED', dueAt: day(-30) }), priority: 'URGENT', alreadyEscalated: false }),
    ).toBe('NONE');
  });

  it('escalates urgent work the moment it slips', () => {
    expect(
      esc({ ...task({ dueAt: day(-1) }), priority: 'URGENT', alreadyEscalated: false }),
    ).toBe('ESCALATE');
  });

  it('gives low-priority work a week of grace', () => {
    expect(esc({ ...task({ dueAt: day(-3) }), priority: 'LOW', alreadyEscalated: false })).toBe('NONE');
    expect(esc({ ...task({ dueAt: day(-8) }), priority: 'LOW', alreadyEscalated: false })).toBe('ESCALATE');
  });

  it('escalates each task at most once', () => {
    // A task that escalates daily is one everyone learns to filter out, and the
    // signal becomes worth less than silence.
    expect(
      esc({ ...task({ dueAt: day(-30) }), priority: 'URGENT', alreadyEscalated: true }),
    ).toBe('NONE');
  });

  it('reminds the assignee shortly before the deadline', () => {
    expect(esc({ ...task({ dueAt: day(1) }), priority: 'NORMAL', alreadyEscalated: false })).toBe('REMIND');
    expect(esc({ ...task({ dueAt: day(9) }), priority: 'NORMAL', alreadyEscalated: false })).toBe('NONE');
  });

  it('stays silent on a task with no deadline', () => {
    expect(esc({ ...task(), priority: 'URGENT', alreadyEscalated: false })).toBe('NONE');
  });
});

// -----------------------------------------------------------------------------
describe('completion statistics', () => {
  it('excludes cancelled work from the completion denominator', () => {
    // Withdrawing a request and then counting it against the person you
    // withdrew it from is indefensible.
    const stats = summariseTasks(
      [
        task({ status: 'COMPLETED', completedAt: day(-1) }),
        task({ status: 'CANCELLED' }),
        task({ status: 'OPEN' }),
      ],
      NOW,
    );
    expect(stats.completionRate).toBeCloseTo(0.5, 5);
  });

  it('measures the on-time rate only over work that had a deadline', () => {
    const stats = summariseTasks(
      [
        task({ status: 'COMPLETED', dueAt: day(-5), completedAt: day(-6) }), // on time
        task({ status: 'COMPLETED', dueAt: day(-5), completedAt: day(-2) }), // late
        task({ status: 'COMPLETED', completedAt: day(-1) }),                 // no deadline
      ],
      NOW,
    );
    expect(stats.onTimeRate).toBeCloseTo(0.5, 5);
  });

  it('returns null, not zero, for an empty record', () => {
    // Zero is a finding — "delivers nothing on time". Null is the absence of
    // one. Rendering an empty record as 0% puts a new lecturer on a watch list
    // in their first week.
    const stats = summariseTasks([], NOW);
    expect(stats.completionRate).toBeNull();
    expect(stats.onTimeRate).toBeNull();
  });

  it('returns null for an on-time rate when nothing completed had a deadline', () => {
    const stats = summariseTasks([task({ status: 'OPEN', dueAt: day(3) })], NOW);
    expect(stats.onTimeRate).toBeNull();
    expect(stats.completionRate).toBe(0);
  });

  it('counts overdue work in the open queue only', () => {
    const stats = summariseTasks(
      [
        task({ dueAt: day(-2) }),
        task({ status: 'COMPLETED', dueAt: day(-9), completedAt: day(-1) }),
      ],
      NOW,
    );
    expect(stats.overdue).toBe(1);
  });

  it('averages turnaround over completed work only', () => {
    expect(
      averageTurnaroundDays([
        { status: 'COMPLETED', createdAt: day(-10), completedAt: day(-6) },
        { status: 'COMPLETED', createdAt: day(-10), completedAt: day(-4) },
        { status: 'OPEN', createdAt: day(-30), completedAt: null },
      ]),
    ).toBe(5);
  });

  it('returns null turnaround when nothing has completed', () => {
    expect(averageTurnaroundDays([{ status: 'OPEN', createdAt: day(-3), completedAt: null }])).toBeNull();
  });
});

// -----------------------------------------------------------------------------
describe('workload balance', () => {
  const team: WorkloadEntry[] = [
    { memberId: 'prof', name: 'Okafor', assignedUnits: 9, assignedItems: 3, capacityUnits: 18 },
    { memberId: 'part', name: 'Balogun', assignedUnits: 6, assignedItems: 2, capacityUnits: 9 },
  ];

  it('ranks by utilisation, not by raw load', () => {
    // Okafor teaches MORE hours but is half full; Balogun is two thirds full on
    // a smaller contract. The fair next assignment is Okafor's.
    const pick = proposeAssignee(team, 3);
    expect(pick?.memberId).toBe('prof');
  });

  it('excludes anyone without the headroom rather than sorting them last', () => {
    // Proposing work that breaks a contractual ceiling is worse than proposing
    // nobody.
    expect(proposeAssignee(team, 12)?.memberId).toBeUndefined();
    expect(proposeAssignee(team, 12)).toBeNull();
  });

  it('treats zero capacity as unavailable, not infinitely available', () => {
    const withLeave: WorkloadEntry[] = [
      ...team,
      { memberId: 'leave', name: 'Aduba', assignedUnits: 0, assignedItems: 0, capacityUnits: 0 },
    ];
    expect(viewWorkload(withLeave).find((w) => w.memberId === 'leave')?.utilisation).toBe(1);
    expect(proposeAssignee(withLeave, 3)?.memberId).toBe('prof');
  });

  it('is deterministic when two people are identically loaded', () => {
    const tied: WorkloadEntry[] = [
      { memberId: 'b', name: 'Zulu', assignedUnits: 6, assignedItems: 2, capacityUnits: 12 },
      { memberId: 'a', name: 'Alpha', assignedUnits: 6, assignedItems: 2, capacityUnits: 12 },
    ];
    expect(proposeAssignee(tied, 3)?.memberId).toBe('a');
    expect(proposeAssignee([...tied].reverse(), 3)?.memberId).toBe('a');
  });

  it('breaks a utilisation tie on fewer sections first', () => {
    const tied: WorkloadEntry[] = [
      { memberId: 'many', name: 'Alpha', assignedUnits: 6, assignedItems: 4, capacityUnits: 12 },
      { memberId: 'few', name: 'Zulu', assignedUnits: 6, assignedItems: 1, capacityUnits: 12 },
    ];
    expect(proposeAssignee(tied, 3)?.memberId).toBe('few');
  });

  it('shows an overload as utilisation above 1 rather than clamping it', () => {
    const over = viewWorkload([
      { memberId: 'x', name: 'X', assignedUnits: 24, assignedItems: 8, capacityUnits: 18 },
    ])[0];
    expect(over.utilisation).toBeGreaterThan(1);
    expect(over.isOverloaded).toBe(true);
    expect(over.headroomUnits).toBe(0);
  });

  it('reports spread as well as mean, because the mean hides the problem', () => {
    const lopsided: WorkloadEntry[] = [
      { memberId: 'a', name: 'A', assignedUnits: 13, assignedItems: 5, capacityUnits: 10 },
      { memberId: 'b', name: 'B', assignedUnits: 2, assignedItems: 1, capacityUnits: 10 },
    ];
    const imb = loadImbalance(lopsided);
    expect(imb.mean).toBeCloseTo(0.75, 5);
    expect(imb.spread).toBeCloseTo(1.1, 5);
    expect(imb.fullest?.memberId).toBe('a');
    expect(imb.emptiest?.memberId).toBe('b');
  });

  it('handles an empty team without dividing by zero', () => {
    expect(loadImbalance([])).toEqual({ mean: 0, spread: 0, fullest: null, emptiest: null });
  });
});

// -----------------------------------------------------------------------------
describe('task visibility', () => {
  const base = {
    viewerMembershipId: 'dean',
    subordinateMembershipIds: new Set(['hod', 'lecturer']),
    hasBlanketGrant: false,
  };

  it('lets a manager see a task assigned to someone below them transitively', () => {
    expect(
      canViewTask({
        ...base,
        task: { assigneeMembershipId: 'lecturer', assignerMembershipId: 'hod', watcherMembershipIds: [] },
      }),
    ).toBe(true);
  });

  it('hides a task belonging to someone outside the reporting line', () => {
    expect(
      canViewTask({
        ...base,
        task: { assigneeMembershipId: 'stranger', assignerMembershipId: 'other', watcherMembershipIds: [] },
      }),
    ).toBe(false);
  });

  it('lets a watcher see a task they neither own nor raised', () => {
    expect(
      canViewTask({
        ...base,
        task: { assigneeMembershipId: 'stranger', assignerMembershipId: 'other', watcherMembershipIds: ['dean'] },
      }),
    ).toBe(true);
  });

  it('does not let a manager edit a subordinate task they can see', () => {
    // Seeing the queue is management; silently editing items in it is not.
    const input = {
      ...base,
      task: { assigneeMembershipId: 'lecturer', assignerMembershipId: 'hod', watcherMembershipIds: [] },
    };
    expect(canViewTask(input)).toBe(true);
    expect(canEditTask(input)).toBe(false);
  });

  it('lets the assignee and the assigner edit', () => {
    expect(
      canEditTask({
        ...base,
        viewerMembershipId: 'lecturer',
        task: { assigneeMembershipId: 'lecturer', assignerMembershipId: 'hod', watcherMembershipIds: [] },
      }),
    ).toBe(true);
  });

  it('lets only the assigner accept submitted work', () => {
    const t = { assigneeMembershipId: 'lecturer', assignerMembershipId: 'hod', watcherMembershipIds: [] };
    expect(canAcceptTask({ ...base, viewerMembershipId: 'hod', task: t })).toBe(true);
    // An assignee accepting their own work would make SUBMITTED decorative.
    expect(canAcceptTask({ ...base, viewerMembershipId: 'lecturer', task: t })).toBe(false);
  });

  it('honours a blanket grant everywhere', () => {
    const t = { assigneeMembershipId: 'x', assignerMembershipId: 'y', watcherMembershipIds: [] };
    const grant = { ...base, hasBlanketGrant: true, task: t };
    expect(canViewTask(grant)).toBe(true);
    expect(canEditTask(grant)).toBe(true);
    expect(canAcceptTask(grant)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
describe('task ordering', () => {
  const t = (over: Partial<TaskStat> & { title: string }) => ({ ...task(), ...over });

  it('floats overdue work above everything, whatever its priority', () => {
    const overdueLow = t({ title: 'late', priority: 'LOW', dueAt: day(-20) });
    const urgentSoon = t({ title: 'urgent', priority: 'URGENT', dueAt: day(2) });
    expect(compareTasks(overdueLow, urgentSoon, NOW)).toBeLessThan(0);
  });

  it('orders by priority before deadline among tasks that are not overdue', () => {
    const urgentLater = t({ title: 'a', priority: 'URGENT', dueAt: day(9) });
    const normalSooner = t({ title: 'b', priority: 'NORMAL', dueAt: day(1) });
    expect(compareTasks(urgentLater, normalSooner, NOW)).toBeLessThan(0);
  });

  it('puts a task with no deadline last within its priority', () => {
    const dated = t({ title: 'a', priority: 'NORMAL', dueAt: day(30) });
    const undated = t({ title: 'b', priority: 'NORMAL' });
    expect(compareTasks(dated, undated, NOW)).toBeLessThan(0);
  });

  it('is a total order — sorting twice gives the same list', () => {
    const list = [
      t({ title: 'c', priority: 'NORMAL', dueAt: day(3) }),
      t({ title: 'a', priority: 'NORMAL', dueAt: day(3) }),
      t({ title: 'b', priority: 'NORMAL', dueAt: day(3) }),
    ];
    const once = [...list].sort((x, y) => compareTasks(x, y, NOW)).map((x) => x.title);
    const twice = [...list].reverse().sort((x, y) => compareTasks(x, y, NOW)).map((x) => x.title);
    expect(once).toEqual(['a', 'b', 'c']);
    expect(twice).toEqual(once);
  });
});
