import { ROLE_LABELS, type Role } from './enums';

/**
 * =============================================================================
 * THE ACADEMIC REPORTING LINE
 * =============================================================================
 *
 * A university is a chain of accountability, and the app is only useful if it
 * models the real one:
 *
 *     Student  →  Lecturer  →  Head of Department  →  Dean  →  Registrar
 *
 * This module owns that ladder. It is pure, so the rule can be tested without a
 * database, and it is stated ONCE so that the org chart, the "my team" page,
 * task escalation and the people console cannot each acquire their own slightly
 * different idea of who answers to whom.
 *
 * WHY A LADDER RATHER THAN FREE-FORM `managerId`
 * ----------------------------------------------
 * `Membership.managerId` can point anywhere, and without a rule it eventually
 * does: a lecturer reporting to a librarian, a dean reporting to a student, or
 * — the one that actually breaks things — a cycle, which turns every upward
 * walk of the chart into an infinite loop. Validating against this ladder makes
 * those unrepresentable rather than merely unlikely.
 */

/**
 * The academic chain, lowest first. Each entry names who that role answers to.
 *
 * Roles NOT in this ladder are administrative rather than academic — the
 * bursary, admissions, the library — and report to the school's administration
 * rather than up the faculty line. They are handled by `ADMIN_REPORTS_TO`
 * below rather than being forced into a hierarchy they do not belong to.
 */
export const ACADEMIC_LADDER: readonly Role[] = [
  'STUDENT',
  'INSTRUCTOR',
  'HOD',
  'DEAN',
  'REGISTRAR',
] as const;

/**
 * Where the non-academic roles sit.
 *
 * The Bursar, Admissions and the Librarian run their own offices and answer to
 * the school's administration, not to a Dean. Pretending otherwise would put a
 * bursar under a faculty that has no authority over the fee ledger.
 */
const ADMIN_REPORTS_TO: Partial<Record<Role, Role>> = {
  FINANCE: 'ADMIN',
  ADMISSIONS: 'REGISTRAR',
  LIBRARIAN: 'ADMIN',
  STAFF: 'ADMIN',
  ADMIN: 'OWNER',
  REGISTRAR: 'OWNER',
};

/**
 * The role this role answers to, or null at the top.
 *
 * A GUARDIAN and an APPLICANT report to nobody: neither is a member of staff,
 * and giving a parent a place in the staff hierarchy would be a category error.
 */
export function reportsTo(role: Role): Role | null {
  const index = ACADEMIC_LADDER.indexOf(role);
  if (index >= 0 && index < ACADEMIC_LADDER.length - 1) {
    return ACADEMIC_LADDER[index + 1];
  }
  return ADMIN_REPORTS_TO[role] ?? null;
}

/**
 * Roles that may legitimately be somebody's manager.
 *
 * Deliberately more permissive than "exactly the next rung". A department with
 * no head has its lecturers reporting straight to the Dean, and a small faculty
 * may have the Registrar hold a deanship — both are real arrangements, and a
 * rule that refused them would be a rule schools work around by lying to the
 * system. Everything ABOVE the natural manager is allowed; nothing below or
 * sideways is.
 */
export function validManagerRoles(subordinate: Role): Role[] {
  const direct = reportsTo(subordinate);
  if (!direct) return [];

  const index = ACADEMIC_LADDER.indexOf(direct);
  const academic = index >= 0 ? ACADEMIC_LADDER.slice(index) : [];

  // OWNER and ADMIN can manage anybody: they are the school, not a rung on it.
  const universal: Role[] = ['OWNER', 'ADMIN'];
  const extra = index >= 0 ? ['REGISTRAR' as Role] : [direct];

  return Array.from(new Set([...academic, ...extra, ...universal])).filter(
    (r) => r !== subordinate || r === 'REGISTRAR',
  );
}

export interface ReportingVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * May `manager` be the line manager of `subordinate`?
 *
 * Refuses politely and specifically, because "invalid manager" tells a
 * registrar nothing about what to do instead.
 */
export function canReportTo(subordinate: Role, manager: Role): ReportingVerdict {
  if (subordinate === 'GUARDIAN' || subordinate === 'APPLICANT') {
    return {
      allowed: false,
      reason: `A ${ROLE_LABELS[subordinate].toLowerCase()} is not a member of staff and has no line manager.`,
    };
  }

  const allowed = validManagerRoles(subordinate);
  if (allowed.length === 0) {
    return {
      allowed: false,
      reason: `${ROLE_LABELS[subordinate]} is at the top of the reporting line.`,
    };
  }

  if (!allowed.includes(manager)) {
    const natural = reportsTo(subordinate);
    return {
      allowed: false,
      reason: natural
        ? `A ${ROLE_LABELS[subordinate].toLowerCase()} reports to a ${ROLE_LABELS[natural].toLowerCase()}, not to a ${ROLE_LABELS[manager].toLowerCase()}.`
        : `A ${ROLE_LABELS[manager].toLowerCase()} cannot manage a ${ROLE_LABELS[subordinate].toLowerCase()}.`,
    };
  }

  return { allowed: true };
}

/**
 * Walk a reporting chain upwards, refusing to loop forever.
 *
 * `managerId` is a self-referential foreign key, so a cycle is expressible in
 * the database no matter how carefully the UI validates — one bad edit, one
 * data import, one restored backup. Every upward walk in the app goes through
 * this function so that a cycle produces a truncated chain and a flag rather
 * than a hung request.
 */
export function walkUp<T extends { id: string; managerId: string | null }>(
  startId: string,
  byId: ReadonlyMap<string, T>,
  maxDepth = 12,
): { chain: T[]; cycle: boolean } {
  const chain: T[] = [];
  const seen = new Set<string>();
  let currentId: string | null = startId;

  while (currentId && chain.length < maxDepth) {
    if (seen.has(currentId)) return { chain, cycle: true };
    seen.add(currentId);

    const node: T | undefined = byId.get(currentId);
    if (!node) break;
    chain.push(node);
    currentId = node.managerId;
  }

  // Hitting the depth cap with a manager still to follow is itself suspicious:
  // twelve rungs is more than any real institution has.
  return { chain, cycle: Boolean(currentId) && chain.length >= maxDepth };
}

/**
 * Would setting `managerId` on `subordinateId` create a cycle?
 *
 * Checked BEFORE the write, because afterwards the org chart is already broken
 * and the only way to find the loop is the walk that now hangs.
 */
export function wouldCreateCycle<T extends { id: string; managerId: string | null }>(
  subordinateId: string,
  proposedManagerId: string,
  byId: ReadonlyMap<string, T>,
): boolean {
  if (subordinateId === proposedManagerId) return true;
  const { chain } = walkUp(proposedManagerId, byId);
  return chain.some((node) => node.id === subordinateId);
}

/**
 * Roles that head an organisational unit, for the appointment dropdowns.
 * A faculty is headed by a Dean, a department by a HOD.
 */
export const UNIT_HEAD_ROLE: Partial<Record<string, Role>> = {
  FACULTY: 'DEAN',
  DEPARTMENT: 'HOD',
};
