/**
 * =============================================================================
 * TASK AND WORKLOAD ALGORITHMS
 * =============================================================================
 *
 * Pure. No Prisma, no clock, no I/O. Every function that needs the current time
 * takes it as an argument, which is what makes overdue and escalation logic
 * testable at all — a function that reads `new Date()` internally can only be
 * tested by waiting.
 *
 * The subject here is a university department: a dean assigns sections to
 * lecturers, watches whether the work lands, and answers for the result. The
 * hard parts are not the CRUD; they are:
 *
 *   - what "overdue" means when a task was completed late,
 *   - how to spread teaching load fairly when the loads are unequal to start,
 *   - and how to summarise a person's term without being unfair to them.
 */

import {
  TASK_CLOSED_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from './enums';

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskError';
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// -----------------------------------------------------------------------------
// Lateness
// -----------------------------------------------------------------------------

export interface TaskTiming {
  status: TaskStatus;
  dueAt: Date | null;
  completedAt: Date | null;
}

export interface Lateness {
  /** Open, past its due date, right now. */
  isOverdue: boolean;
  /** Closed, but closed after its due date. */
  wasLate: boolean;
  /**
   * Days past due. Positive when late, negative when there is time left, null
   * when the task has no due date at all.
   */
  daysLate: number | null;
  /** Days until due, for an open task with a future due date. */
  daysRemaining: number | null;
}

/**
 * ALGORITHM: LATENESS
 * -------------------
 * The distinction that matters is between **is overdue** and **was late**.
 *
 * A task completed two days after its deadline is not overdue — there is
 * nothing left to chase, and a dashboard that lists it under "overdue" sends
 * someone to ask about work that is already done. But it *was* late, and a
 * term-end report that quietly forgets that is flattering rather than useful.
 *
 * So lateness is measured against `completedAt` once the task closes, and
 * against `now` while it is open. A task with no due date is never either: an
 * open-ended request cannot be missed.
 *
 * CANCELLED tasks are neither. Withdrawn work is not a failure to deliver.
 */
export function assessLateness(task: TaskTiming, now: Date): Lateness {
  if (task.dueAt === null) {
    return { isOverdue: false, wasLate: false, daysLate: null, daysRemaining: null };
  }

  const closed = TASK_CLOSED_STATUSES.includes(task.status);

  if (closed) {
    // Cancelled work was never owed, whatever the date says.
    if (task.status === 'CANCELLED') {
      return { isOverdue: false, wasLate: false, daysLate: null, daysRemaining: null };
    }
    // A completed task with no recorded completion time is treated as on time
    // rather than late. Guessing "it must have been late" from missing data
    // would put a mark against someone on the strength of a null.
    const at = task.completedAt ?? task.dueAt;
    const late = daysBetween(task.dueAt, at);
    return {
      isOverdue: false,
      wasLate: at.getTime() > task.dueAt.getTime(),
      daysLate: late,
      daysRemaining: null,
    };
  }

  const late = daysBetween(task.dueAt, now);
  const overdue = now.getTime() > task.dueAt.getTime();
  return {
    isOverdue: overdue,
    wasLate: false,
    daysLate: late,
    daysRemaining: overdue ? null : daysBetween(now, task.dueAt),
  };
}

// -----------------------------------------------------------------------------
// Escalation
// -----------------------------------------------------------------------------

export interface EscalationPolicy {
  /** Days overdue, per priority, before the manager is notified. */
  graceDays: Record<TaskPriority, number>;
  /** Days before the due date at which a "due soon" reminder fires. */
  remindBeforeDays: number;
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  // Urgent work escalates the moment it slips; low-priority work gets a week.
  // The gradient is the point: escalating everything at the same threshold
  // trains a dean to ignore the notification entirely.
  graceDays: { URGENT: 0, HIGH: 1, NORMAL: 3, LOW: 7 },
  remindBeforeDays: 2,
};

export type EscalationAction = 'NONE' | 'REMIND' | 'ESCALATE';

/**
 * ALGORITHM: ESCALATION
 * ---------------------
 *   closed                        -> NONE
 *   no due date                   -> NONE
 *   overdue by >= grace(priority) -> ESCALATE   (tell the manager)
 *   due within remindBeforeDays   -> REMIND     (tell the assignee)
 *   otherwise                     -> NONE
 *
 * `alreadyEscalated` suppresses a repeat. A task that escalates once a day
 * until someone acts is a task everyone learns to filter out of their inbox,
 * and the signal is then worth less than silence.
 */
export function nextEscalation(
  task: TaskTiming & { priority: TaskPriority; alreadyEscalated: boolean },
  now: Date,
  policy: EscalationPolicy = DEFAULT_ESCALATION,
): EscalationAction {
  if (TASK_CLOSED_STATUSES.includes(task.status)) return 'NONE';
  if (task.dueAt === null) return 'NONE';

  const { isOverdue, daysLate } = assessLateness(task, now);

  if (isOverdue) {
    if (task.alreadyEscalated) return 'NONE';
    return (daysLate ?? 0) >= policy.graceDays[task.priority] ? 'ESCALATE' : 'NONE';
  }

  const remaining = daysBetween(now, task.dueAt);
  return remaining <= policy.remindBeforeDays ? 'REMIND' : 'NONE';
}

// -----------------------------------------------------------------------------
// Completion statistics
// -----------------------------------------------------------------------------

export interface TaskStat extends TaskTiming {
  priority: TaskPriority;
}

export interface CompletionStats {
  total: number;
  open: number;
  inProgress: number;
  blocked: number;
  submitted: number;
  completed: number;
  cancelled: number;
  overdue: number;
  /** Completed on or before the due date, as a fraction of completed-with-a-due-date. */
  onTimeRate: number | null;
  /** Completed as a fraction of everything that was actually owed. */
  completionRate: number | null;
}

/**
 * ALGORITHM: COMPLETION STATISTICS
 * --------------------------------
 * Two denominators, chosen carefully, because the obvious ones are unfair:
 *
 *   completionRate = completed / (total - cancelled)
 *
 * Cancelled tasks leave the denominator. Withdrawing a request and then
 * counting it against the person you withdrew it from is indefensible, and it
 * would let a manager depress a subordinate's numbers by raising and dropping
 * work.
 *
 *   onTimeRate = onTime / (completed tasks that HAD a due date)
 *
 * Tasks without a deadline cannot be late, so including them would inflate
 * every rate towards 100% in proportion to how vague the assigner was.
 *
 * Both return null rather than 0 when the denominator is empty. Zero is a
 * finding — "this person delivers nothing on time"; null is the absence of one.
 * Rendering an empty record as 0% is how a new lecturer ends up on a dean's
 * watch list in their first week.
 */
export function summariseTasks(tasks: readonly TaskStat[], now: Date): CompletionStats {
  const count = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;

  const completed = tasks.filter((t) => t.status === 'COMPLETED');
  const cancelled = count('CANCELLED');

  const withDeadline = completed.filter((t) => t.dueAt !== null);
  const onTime = withDeadline.filter((t) => !assessLateness(t, now).wasLate).length;

  const owed = tasks.length - cancelled;

  return {
    total: tasks.length,
    open: count('OPEN'),
    inProgress: count('IN_PROGRESS'),
    blocked: count('BLOCKED'),
    submitted: count('SUBMITTED'),
    completed: completed.length,
    cancelled,
    overdue: tasks.filter((t) => assessLateness(t, now).isOverdue).length,
    onTimeRate: withDeadline.length === 0 ? null : onTime / withDeadline.length,
    completionRate: owed === 0 ? null : completed.length / owed,
  };
}

/**
 * Mean days from creation to completion. Separate from `summariseTasks`
 * because it needs a creation timestamp the status view does not carry.
 */
export function averageTurnaroundDays(
  tasks: readonly { status: TaskStatus; createdAt: Date; completedAt: Date | null }[],
): number | null {
  const done = tasks.filter(
    (t): t is { status: TaskStatus; createdAt: Date; completedAt: Date } =>
      t.status === 'COMPLETED' && t.completedAt !== null,
  );
  if (done.length === 0) return null;
  const total = done.reduce(
    (sum, t) => sum + (t.completedAt.getTime() - t.createdAt.getTime()) / MS_PER_DAY,
    0,
  );
  return Math.round((total / done.length) * 10) / 10;
}

// -----------------------------------------------------------------------------
// Workload balance
// -----------------------------------------------------------------------------

export interface WorkloadEntry {
  /** Membership id of the person carrying the load. */
  memberId: string;
  name: string;
  /** Credit hours (or any comparable unit) already assigned. */
  assignedUnits: number;
  /** Sections already assigned. */
  assignedItems: number;
  /** The most this person may carry — a contractual or policy ceiling. */
  capacityUnits: number;
}

export interface WorkloadView extends WorkloadEntry {
  /** assignedUnits / capacityUnits, uncapped so an overload is visible as >1. */
  utilisation: number;
  headroomUnits: number;
  isOverloaded: boolean;
}

export function viewWorkload(entries: readonly WorkloadEntry[]): WorkloadView[] {
  return entries.map((e) => ({
    ...e,
    // Capacity of zero means "not available for teaching", not "infinitely
    // available". Utilisation is 1 so they are never proposed for more work.
    utilisation: e.capacityUnits === 0 ? 1 : e.assignedUnits / e.capacityUnits,
    headroomUnits: Math.max(0, e.capacityUnits - e.assignedUnits),
    isOverloaded: e.assignedUnits > e.capacityUnits,
  }));
}

/**
 * ALGORITHM: FAIR ASSIGNMENT (least-utilised-first)
 * -------------------------------------------------
 * Proposes who should take a section of `units` credit hours.
 *
 * Ranks by **utilisation**, not by raw load. Ranking by raw load hands the next
 * section to whoever teaches fewest hours, which is wrong whenever staff have
 * different contracts: a half-time lecturer at 6 of 9 hours is fuller than a
 * professor at 9 of 18, and picking the professor is the fair answer even
 * though they are teaching more.
 *
 * Ties break on fewer sections, then on name, so the result is deterministic —
 * an assignment suggestion that reshuffles between two identical page loads
 * is not something a dean will trust twice.
 *
 * Candidates with no headroom are excluded rather than sorted last: this is a
 * proposal, and proposing work that breaks a contractual ceiling is worse than
 * proposing nobody. An empty result means "everyone is full", which is a real
 * and actionable answer.
 *
 * This SUGGESTS. It never assigns. Teaching allocation involves specialism,
 * research leave, and politics that no scheduler can see, so the dean's
 * judgement stays in the loop by construction.
 */
export function proposeAssignee(
  entries: readonly WorkloadEntry[],
  units: number,
): WorkloadView | null {
  const eligible = viewWorkload(entries).filter((w) => w.headroomUnits >= units);
  if (eligible.length === 0) return null;

  return [...eligible].sort(
    (a, b) =>
      a.utilisation - b.utilisation ||
      a.assignedItems - b.assignedItems ||
      a.name.localeCompare(b.name),
  )[0];
}

/**
 * How lopsided a team's load is: the spread between the fullest and emptiest
 * member, in utilisation points. 0 is perfectly even.
 *
 * Reported alongside the mean because the mean alone hides the case that
 * actually matters — a department averaging 70% where one lecturer is at 130%
 * and another at 20% is not a department in balance.
 */
export function loadImbalance(entries: readonly WorkloadEntry[]): {
  mean: number;
  spread: number;
  fullest: WorkloadView | null;
  emptiest: WorkloadView | null;
} {
  const views = viewWorkload(entries);
  if (views.length === 0) return { mean: 0, spread: 0, fullest: null, emptiest: null };

  const sorted = [...views].sort((a, b) => a.utilisation - b.utilisation);
  const emptiest = sorted[0];
  const fullest = sorted[sorted.length - 1];
  const mean = views.reduce((s, v) => s + v.utilisation, 0) / views.length;

  return {
    mean,
    spread: fullest.utilisation - emptiest.utilisation,
    fullest,
    emptiest,
  };
}

// -----------------------------------------------------------------------------
// Visibility
// -----------------------------------------------------------------------------

export interface TaskVisibilityInput {
  viewerMembershipId: string;
  /** Memberships reporting to the viewer, transitively. */
  subordinateMembershipIds: ReadonlySet<string>;
  task: {
    assigneeMembershipId: string | null;
    assignerMembershipId: string | null;
    watcherMembershipIds: readonly string[];
  };
  /** Set for a registrar or administrator with a blanket grant. */
  hasBlanketGrant: boolean;
}

/**
 * Can this person see this task?
 *
 * "A manager can see a subordinate's tasks" is a statement about a
 * RELATIONSHIP, not about a role, which is why it does not live in
 * `rbac.ts`. The role matrix answers "may this person use the task system at
 * all"; this predicate answers "may they see THIS one". Every action guards
 * the route with the first and the record with the second.
 */
export function canViewTask(input: TaskVisibilityInput): boolean {
  if (input.hasBlanketGrant) return true;

  const { viewerMembershipId: me, task } = input;
  if (task.assigneeMembershipId === me) return true;
  if (task.assignerMembershipId === me) return true;
  if (task.watcherMembershipIds.includes(me)) return true;

  // Transitive: a dean sees a task assigned by a head of department to a
  // lecturer, without being named on it.
  if (task.assigneeMembershipId && input.subordinateMembershipIds.has(task.assigneeMembershipId)) {
    return true;
  }
  return false;
}

/**
 * Can this person CHANGE this task?
 *
 * Narrower than viewing on purpose. A dean who can see a lecturer's whole
 * queue should not be silently editing individual items in it — the visible
 * act of reassigning is what makes the hierarchy legible to the person being
 * managed. So editing is the assignee, the assigner, or a blanket grant.
 */
export function canEditTask(input: TaskVisibilityInput): boolean {
  if (input.hasBlanketGrant) return true;
  const { viewerMembershipId: me, task } = input;
  return task.assigneeMembershipId === me || task.assignerMembershipId === me;
}

/**
 * Only the person who asked for the work — or a blanket grant — may accept it.
 *
 * An assignee marking their own work COMPLETED would make the SUBMITTED state
 * decorative and the dean's dashboard a self-report.
 */
export function canAcceptTask(input: TaskVisibilityInput): boolean {
  if (input.hasBlanketGrant) return true;
  return input.task.assignerMembershipId === input.viewerMembershipId;
}

// -----------------------------------------------------------------------------
// Sorting
// -----------------------------------------------------------------------------

const PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * The order a task list should appear in: overdue first, then by priority,
 * then by how soon it is due, then by title for determinism.
 *
 * Deadline-before-priority would bury an urgent task due next week beneath a
 * low-priority one due tomorrow. Priority-before-overdue would let a LOW task
 * three weeks late sink out of sight. Overdue leads because it is the only
 * category where the cost of not looking has already started accruing.
 */
export function compareTasks(
  a: TaskStat & { title: string },
  b: TaskStat & { title: string },
  now: Date,
): number {
  const ao = assessLateness(a, now).isOverdue ? 0 : 1;
  const bo = assessLateness(b, now).isOverdue ? 0 : 1;
  if (ao !== bo) return ao - bo;

  const ap = PRIORITY_RANK[a.priority];
  const bp = PRIORITY_RANK[b.priority];
  if (ap !== bp) return ap - bp;

  // No deadline sorts after any deadline — it is the least urgent thing there.
  const ad = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bd = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;

  return a.title.localeCompare(b.title);
}
