import 'server-only';

import { CsvError, parseCsv, CSV_LIMITS } from '@/lib/domain/csv';
import { ASSIGNABLE_ROLES, canAssignRole } from '@/lib/domain/people';
import { ROLES, type Role } from '@/lib/domain/enums';
import {
  buildPlan,
  type ImportKind,
  type ImportPlan,
  type PlannedRow,
} from '@/lib/domain/import';
import { dbFor, platformDb } from '@/lib/tenant';
import { recordAudit } from '@/server/services/audit.service';
import { provisionMembership } from '@/server/services/people.service';
import { registerStudent } from '@/server/services/registration.service';

/**
 * =============================================================================
 * IMPORTING A REGISTRY'S SPREADSHEET
 * =============================================================================
 *
 * TWO CALLS, AND THE SEPARATION IS THE WHOLE DESIGN. `planImport` reads the
 * file and says what would happen; `runImport` does it. Nothing is written by
 * the first, and the second re-reads and re-plans from scratch rather than
 * trusting a plan posted back from a browser.
 *
 * Why re-plan instead of accepting the reviewed plan: the plan a user approved
 * is a claim about the world made minutes ago, and the world has a registrar in
 * it who may have created one of those people by hand in the meantime. It is
 * also, more plainly, user input — a posted plan could name any programme id at
 * any school. Re-planning costs one pass over a file somebody is already
 * waiting on, and removes the entire class of problem.
 *
 * NOTHING IS UPDATED, EVER. A row matching somebody already at the school is
 * SKIPPED, not merged. An importer that overwrites is an importer that can
 * silently rename four hundred people because a column was misaligned, and the
 * registry would have no way back.
 */

export interface ImportResult {
  ok: boolean;
  message: string;
  created: number;
  skipped: number;
  failed: number;
  /** Line numbers with what went wrong, for the ones that did not go in. */
  failures: { line: number; name: string; problem: string }[];
  /**
   * One-time passwords for the accounts just created, in file order.
   *
   * Returned because they cannot be recovered afterwards — the hash is all
   * that is stored — and a registry importing two thousand students has to get
   * them to two thousand people somehow. The caller is responsible for showing
   * them once and not logging them.
   */
  credentials: { line: number; name: string; identifier: string; password: string }[];
}

/** Everything `buildPlan` needs to judge a row, read once for the whole file. */
async function gatherContext(schoolId: string, kind: ImportKind, actorRole: Role) {
  const db = dbFor(schoolId);

  const [programmes, orgUnits, members, students] = await Promise.all([
    kind === 'STUDENT'
      ? db.program.findMany({ select: { id: true, code: true, durationTerms: true, isActive: true } })
      : Promise.resolve([]),
    kind === 'STAFF' ? db.orgUnit.findMany({ select: { id: true, code: true } }) : Promise.resolve([]),
    /*
     * Existing members of THIS school only. A person who belongs to another
     * school is not a duplicate here — `provisionMembership` will add a second
     * membership to their existing account, which is correct and is how a
     * visiting lecturer works.
     */
    db.membership.findMany({
      select: { user: { select: { email: true, username: true } } },
    }),
    kind === 'STUDENT'
      ? db.student.findMany({ select: { matricNumber: true } })
      : Promise.resolve([]),
  ]);

  const assignable = new Set<Role>(
    ROLES.filter(
      (role) =>
        ASSIGNABLE_ROLES.includes(role) && canAssignRole(actorRole, role).allowed,
    ),
  );

  return {
    kind,
    programmes: new Map(
      programmes.map((p) => [
        p.code.toUpperCase(),
        { id: p.id, durationTerms: p.durationTerms, isActive: p.isActive },
      ]),
    ),
    orgUnits: new Map(orgUnits.map((u) => [u.code.toUpperCase(), u.id])),
    existingEmails: new Set(
      members.map((m) => m.user.email).filter((e): e is string => Boolean(e)),
    ),
    existingUsernames: new Set(
      members
        .map((m) => m.user.username?.toLowerCase())
        .filter((u): u is string => Boolean(u)),
    ),
    existingMatricNumbers: new Set(
      students
        .map((s) => s.matricNumber?.toUpperCase())
        .filter((m): m is string => Boolean(m)),
    ),
    assignableRoles: assignable,
  };
}

export interface PlanOutcome {
  ok: boolean;
  message?: string;
  plan?: ImportPlan;
}

/** Read the file and work out what would happen. Writes nothing. */
export async function planImport(params: {
  schoolId: string;
  kind: ImportKind;
  text: string;
  actorRole: Role;
  now?: Date;
}): Promise<PlanOutcome> {
  if (params.text.length > CSV_LIMITS.maxBytes) {
    return { ok: false, message: 'That file is too large to import in one go.' };
  }

  let table;
  try {
    table = parseCsv(params.text);
  } catch (error) {
    // A parse failure is the user's file, not a fault — say what is wrong.
    if (error instanceof CsvError) return { ok: false, message: error.message };
    console.error('[import] parse failed', error);
    return { ok: false, message: 'That file could not be read as a spreadsheet.' };
  }

  const context = await gatherContext(params.schoolId, params.kind, params.actorRole);
  const plan = buildPlan(table, { ...context, now: params.now });

  return { ok: true, plan };
}

/**
 * Do it.
 *
 * ROW AT A TIME, NOT ONE TRANSACTION. Two thousand accounts inside a single
 * transaction is a lock held for minutes and an all-or-nothing outcome, so one
 * malformed row at position 1,900 would discard 1,899 good ones. Each row
 * stands or falls alone and the result says exactly which fell.
 *
 * That makes a partial import possible, which is why the result reports created
 * AND failed counts rather than a boolean, and why re-running the same file is
 * safe: everybody already in is skipped.
 */
export async function runImport(params: {
  schoolId: string;
  schoolCode: string;
  kind: ImportKind;
  text: string;
  actorRole: Role;
  actorMembershipId: string;
  actorUserId: string;
  now?: Date;
}): Promise<ImportResult> {
  const empty = { created: 0, skipped: 0, failed: 0, failures: [], credentials: [] };

  const planned = await planImport({
    schoolId: params.schoolId,
    kind: params.kind,
    text: params.text,
    actorRole: params.actorRole,
    now: params.now,
  });

  if (!planned.ok || !planned.plan) {
    return { ok: false, message: planned.message ?? 'That file could not be read.', ...empty };
  }

  const plan = planned.plan;
  if (plan.missingColumns.length > 0) {
    return {
      ok: false,
      message: `That file is missing required columns: ${plan.missingColumns.join(', ')}.`,
      ...empty,
    };
  }

  const result: ImportResult = {
    ok: true,
    message: '',
    created: 0,
    skipped: plan.counts.skip,
    failed: 0,
    failures: [],
    credentials: [],
  };

  // Rejected while planning: recorded as failures without being attempted.
  for (const row of plan.rows) {
    if (row.outcome === 'REJECT') {
      result.failed += 1;
      result.failures.push({
        line: row.line,
        name: `${row.firstName} ${row.lastName}`.trim() || '(no name)',
        problem: row.problems.join(' '),
      });
    }
  }

  for (const row of plan.rows) {
    if (row.outcome !== 'CREATE') continue;

    const created =
      params.kind === 'STUDENT'
        ? await createStudent(row, params)
        : await createStaff(row, params);

    if (created.ok) {
      result.created += 1;
      if (created.password) {
        result.credentials.push({
          line: row.line,
          name: `${row.firstName} ${row.lastName}`,
          identifier: created.identifier ?? row.email ?? '',
          password: created.password,
        });
      }
    } else {
      result.failed += 1;
      result.failures.push({
        line: row.line,
        name: `${row.firstName} ${row.lastName}`,
        problem: created.message,
      });
    }
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'people.import',
    entityType: 'School',
    entityId: params.schoolId,
    summary:
      `${params.kind === 'STUDENT' ? 'Student' : 'Staff'} import: ` +
      `${result.created} created, ${result.skipped} already here, ${result.failed} rejected.`,
  });

  result.message =
    result.created === 0
      ? 'Nothing was imported.'
      : `${result.created} ${result.created === 1 ? 'account' : 'accounts'} created.` +
        (result.skipped > 0 ? ` ${result.skipped} were already here.` : '') +
        (result.failed > 0 ? ` ${result.failed} could not be imported.` : '');

  return result;
}

async function createStudent(
  row: PlannedRow,
  params: { schoolId: string; schoolCode: string; actorUserId: string; now?: Date },
): Promise<{ ok: boolean; message: string; password?: string; identifier?: string }> {
  const outcome = await registerStudent({
    schoolId: params.schoolId,
    schoolCode: params.schoolCode,
    draft: {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      username: row.username,
      phone: row.phone,
      programmeId: row.programmeId!,
      level: row.level!,
      matricNumber: row.matricNumber,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
    },
    actorUserId: params.actorUserId,
    now: params.now,
  });

  return {
    ok: outcome.ok,
    message: outcome.message,
    password: outcome.temporaryPassword,
    identifier: outcome.matricNumber ?? row.email ?? undefined,
  };
}

async function createStaff(
  row: PlannedRow,
  params: { schoolId: string; actorRole: Role; actorMembershipId: string; actorUserId: string },
): Promise<{ ok: boolean; message: string; password?: string; identifier?: string }> {
  const outcome = await provisionMembership({
    schoolId: params.schoolId,
    email: row.email,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    role: row.role!,
    title: row.title,
    orgUnitId: row.orgUnitId,
    actor: { role: params.actorRole, membershipId: params.actorMembershipId },
    actorUserId: params.actorUserId,
  });

  return {
    ok: outcome.ok,
    message: outcome.message,
    password: outcome.temporaryPassword,
    identifier: row.email ?? row.username ?? undefined,
  };
}

/** The school's own code, for matriculation-number generation. */
export async function schoolCodeOf(schoolId: string): Promise<string> {
  const school = await platformDb.school.findUnique({
    where: { id: schoolId },
    select: { code: true },
  });
  return school?.code ?? 'SCH';
}
