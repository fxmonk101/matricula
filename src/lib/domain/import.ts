import { cell, mapColumns, type ColumnMap, type ColumnSpec, type CsvTable } from './csv';
import { ROLES, type Role } from './enums';
import { normaliseEmail } from './people';
import { validateDateOfBirth, validateLevelForProgramme } from './registration';

/**
 * =============================================================================
 * TURNING A SPREADSHEET INTO A PLAN
 * =============================================================================
 *
 * The registry sends one file with two thousand students in it. This module
 * works out what WOULD happen, row by row, and hands back a plan. It writes
 * nothing and reads no database — the service passes in what it already knows
 * (which programme codes exist, which people are already here) and gets back a
 * decision per row.
 *
 * WHY A PLAN RATHER THAN JUST IMPORTING. Two thousand accounts created from a
 * file with the wrong column order is not a mistake you fix by editing a row.
 * Every account carries a one-time password somebody has to redistribute, and
 * undoing it means deleting people who may already have signed in. So nothing
 * is written until somebody has seen the count, the sample, and the problems.
 *
 * EVERY PROBLEM CARRIES A LINE NUMBER, and the line number counts the header —
 * it is the line the spreadsheet shows, so "line 47" means the row somebody can
 * actually go and look at. An importer that says "a level is invalid" and not
 * which row is worse than one that refuses the file.
 */

export type ImportKind = 'STUDENT' | 'STAFF';

/** What we do with a row once it is understood. */
export type RowOutcome =
  /** A new person will be created. */
  | 'CREATE'
  /** Already at this school. Skipped, not updated — see the note below. */
  | 'SKIP_EXISTING'
  /** Something is wrong with the row; nothing will be written for it. */
  | 'REJECT';

export interface PlannedRow {
  /** 1-based line in the file, counting the header. What the user sees. */
  line: number;
  outcome: RowOutcome;
  /** Present on CREATE and SKIP_EXISTING. */
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  /** STUDENT rows. */
  matricNumber?: string | null;
  programmeCode?: string | null;
  programmeId?: string | null;
  level?: number;
  dateOfBirth?: string | null;
  gender?: string | null;
  /** STAFF rows. */
  role?: Role;
  title?: string | null;
  departmentCode?: string | null;
  orgUnitId?: string | null;
  /** Why it was rejected, or why it is being skipped. */
  problems: string[];
}

export interface ImportPlan {
  kind: ImportKind;
  /** Columns in the file that nothing reads. Worth showing, never guessed at. */
  unmatchedColumns: string[];
  /** Required columns absent from the file. A plan with any of these is dead. */
  missingColumns: string[];
  rows: PlannedRow[];
  counts: { create: number; skip: number; reject: number; total: number };
}

// -----------------------------------------------------------------------------
// The columns, and every spelling a registry might use for them
// -----------------------------------------------------------------------------

const NAME_COLUMNS: ColumnSpec[] = [
  { key: 'firstName', aliases: ['First Name', 'Firstname', 'Given Name', 'Other Names'], required: true },
  { key: 'lastName', aliases: ['Last Name', 'Surname', 'Family Name'], required: true },
  { key: 'email', aliases: ['Email', 'Email Address', 'E-mail'] },
  { key: 'username', aliases: ['Username', 'User Name', 'Login'] },
  { key: 'phone', aliases: ['Phone', 'Phone Number', 'Mobile', 'Telephone', 'GSM'] },
];

export const STUDENT_COLUMNS: ColumnSpec[] = [
  ...NAME_COLUMNS,
  {
    key: 'matricNumber',
    aliases: ['Matric Number', 'Matric No', 'Matriculation Number', 'Registration Number', 'Reg No'],
  },
  { key: 'programmeCode', aliases: ['Programme', 'Program', 'Programme Code', 'Course of Study'], required: true },
  { key: 'level', aliases: ['Level', 'Year', 'Class'], required: true },
  { key: 'dateOfBirth', aliases: ['Date of Birth', 'DOB', 'Birth Date'] },
  { key: 'gender', aliases: ['Gender', 'Sex'] },
];

export const STAFF_COLUMNS: ColumnSpec[] = [
  ...NAME_COLUMNS,
  { key: 'role', aliases: ['Role', 'Position', 'Designation'], required: true },
  { key: 'title', aliases: ['Title', 'Rank', 'Job Title'] },
  { key: 'departmentCode', aliases: ['Department', 'Department Code', 'Unit', 'Faculty'] },
];

export function columnsFor(kind: ImportKind): ColumnSpec[] {
  return kind === 'STUDENT' ? STUDENT_COLUMNS : STAFF_COLUMNS;
}

/** Column keys in the order a downloadable template should present them. */
export function templateHeaders(kind: ImportKind): string[] {
  return columnsFor(kind).map((spec) => spec.aliases[0]);
}

// -----------------------------------------------------------------------------
// Reading the awkward cells
// -----------------------------------------------------------------------------

/**
 * A level, from whatever the registry wrote in the column.
 *
 * "100", "100 Level", "Year 1" and "1" all mean the same thing to the person
 * who typed them. Returning null for the rest is deliberate: guessing that
 * "Final" means 400 would be inventing data.
 */
export function parseLevel(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const hundreds = text.match(/(\d{3,4})\s*(?:level|l)?$/);
  if (hundreds) {
    const value = Number(hundreds[1]);
    if (value % 100 === 0 && value >= 100 && value <= 900) return value;
  }

  // "Year 2", "yr 2", "2" — a small number means a year, not a level.
  const year = text.match(/^(?:year|yr|y)?\s*([1-9])$/);
  if (year) return Number(year[1]) * 100;

  return null;
}

/**
 * A role, from what somebody typed in a spreadsheet.
 *
 * Accepts the words universities use as well as our own constants, because
 * "Lecturer" is what a registry writes and INSTRUCTOR is what we store.
 */
const ROLE_WORDS: Record<string, Role> = {
  lecturer: 'INSTRUCTOR',
  instructor: 'INSTRUCTOR',
  teacher: 'INSTRUCTOR',
  professor: 'INSTRUCTOR',
  registrar: 'REGISTRAR',
  dean: 'DEAN',
  hod: 'HOD',
  headofdepartment: 'HOD',
  bursar: 'FINANCE',
  finance: 'FINANCE',
  accountant: 'FINANCE',
  admissions: 'ADMISSIONS',
  librarian: 'LIBRARIAN',
  staff: 'STAFF',
  admin: 'ADMIN',
  administrator: 'ADMIN',
};

export function parseRole(raw: string): Role | null {
  const text = raw.trim();
  if (!text) return null;

  const upper = text.toUpperCase().replace(/[\s_-]+/g, '');
  if ((ROLES as readonly string[]).includes(upper)) return upper as Role;

  return ROLE_WORDS[text.toLowerCase().replace(/[\s_.-]+/g, '')] ?? null;
}

/**
 * A date of birth, from the three formats a Nigerian spreadsheet contains.
 *
 * DD/MM/YYYY is the local convention and MM/DD/YYYY is what Excel writes when
 * its locale is American. They are INDISTINGUISHABLE for the first twelve days
 * of a month, so an ambiguous slash date is REFUSED rather than guessed: a
 * birthday silently moved from the third of July to the seventh of March is
 * exactly the sort of error nobody finds.
 */
export function parseDateOfBirth(raw: string): { value: string | null; problem: string | null } {
  const text = raw.trim();
  if (!text) return { value: null, problem: null };

  // ISO, which is unambiguous and what we store.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { value: text, problem: null };

  const slash = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = slash[3];

    if (a > 12 && b <= 12) {
      // Unambiguous: the first number cannot be a month.
      return { value: `${year}-${pad(b)}-${pad(a)}`, problem: null };
    }
    if (b > 12 && a <= 12) {
      return { value: `${year}-${pad(a)}-${pad(b)}`, problem: null };
    }
    return {
      value: null,
      problem: `"${text}" could be day/month or month/day. Write dates as YYYY-MM-DD.`,
    };
  }

  return { value: null, problem: `"${text}" is not a date this importer understands. Use YYYY-MM-DD.` };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseGender(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith('m')) return 'MALE';
  if (text.startsWith('f')) return 'FEMALE';
  return 'OTHER';
}

// -----------------------------------------------------------------------------
// The plan
// -----------------------------------------------------------------------------

export interface PlanContext {
  kind: ImportKind;
  /** Programme code (upper-cased) -> { id, durationTerms }. STUDENT only. */
  programmes: Map<string, { id: string; durationTerms: number; isActive: boolean }>;
  /** Org unit code (upper-cased) -> id. STAFF only, optional column. */
  orgUnits: Map<string, string>;
  /** Emails and usernames already belonging to a member of THIS school. */
  existingEmails: Set<string>;
  existingUsernames: Set<string>;
  /** Matriculation numbers already used at this school. */
  existingMatricNumbers: Set<string>;
  /** Roles this actor is permitted to hand out. */
  assignableRoles: ReadonlySet<Role>;
  now?: Date;
}

export function buildPlan(table: CsvTable, context: PlanContext): ImportPlan {
  const specs = columnsFor(context.kind);
  const map = mapColumns(table.headers, specs);

  const rows: PlannedRow[] = [];

  /*
   * Duplicates WITHIN the file, which is its own failure and a common one: the
   * same student pasted twice, or a matriculation number reused. Caught here
   * because the database cannot — the first row would be written successfully
   * and the second would collide with it halfway through the import.
   */
  const seenEmails = new Set<string>();
  const seenUsernames = new Set<string>();
  const seenMatric = new Set<string>();

  table.rows.forEach((row, i) => {
    // +2: one for the header, one because humans count from 1.
    const line = i + 2;
    const planned =
      context.kind === 'STUDENT'
        ? planStudent(row, map, line, context, { seenEmails, seenUsernames, seenMatric })
        : planStaff(row, map, line, context, { seenEmails, seenUsernames });
    rows.push(planned);
  });

  return {
    kind: context.kind,
    unmatchedColumns: map.unmatched,
    missingColumns: map.missing,
    rows,
    counts: {
      create: rows.filter((r) => r.outcome === 'CREATE').length,
      skip: rows.filter((r) => r.outcome === 'SKIP_EXISTING').length,
      reject: rows.filter((r) => r.outcome === 'REJECT').length,
      total: rows.length,
    },
  };
}

interface Seen {
  seenEmails: Set<string>;
  seenUsernames: Set<string>;
  seenMatric?: Set<string>;
}

/** The parts every row has, whoever it is. */
function planCommon(
  row: readonly string[],
  map: ColumnMap,
  context: PlanContext,
  seen: Seen,
): { firstName: string; lastName: string; email: string | null; username: string | null; phone: string | null; problems: string[]; duplicate: boolean } {
  const problems: string[] = [];

  const firstName = cell(row, map, 'firstName');
  const lastName = cell(row, map, 'lastName');
  if (!firstName) problems.push('No first name.');
  if (!lastName) problems.push('No last name.');

  const rawEmail = cell(row, map, 'email');
  const email = rawEmail ? normaliseEmail(rawEmail) : null;
  if (rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email!)) {
    problems.push(`"${rawEmail}" is not a valid email address.`);
  }

  const username = cell(row, map, 'username') || null;
  const phone = cell(row, map, 'phone') || null;

  let duplicate = false;

  if (email) {
    if (seen.seenEmails.has(email)) {
      problems.push(`${email} appears more than once in this file.`);
    } else if (context.existingEmails.has(email)) {
      duplicate = true;
    }
    seen.seenEmails.add(email);
  }

  if (username) {
    const key = username.toLowerCase();
    if (seen.seenUsernames.has(key)) {
      problems.push(`The username ${username} appears more than once in this file.`);
    } else if (context.existingUsernames.has(key)) {
      duplicate = true;
    }
    seen.seenUsernames.add(key);
  }

  return { firstName, lastName, email, username, phone, problems, duplicate };
}

function planStudent(
  row: readonly string[],
  map: ColumnMap,
  line: number,
  context: PlanContext,
  seen: Seen,
): PlannedRow {
  const base = planCommon(row, map, context, seen);
  const problems = [...base.problems];

  const programmeCode = cell(row, map, 'programmeCode').toUpperCase();
  const programme = programmeCode ? context.programmes.get(programmeCode) : undefined;
  if (!programmeCode) problems.push('No programme.');
  else if (!programme) problems.push(`No programme with the code "${programmeCode}" at this school.`);
  else if (!programme.isActive) problems.push(`${programmeCode} is closed to new intake.`);

  const rawLevel = cell(row, map, 'level');
  const level = parseLevel(rawLevel);
  if (!rawLevel) problems.push('No level.');
  else if (level === null) problems.push(`"${rawLevel}" is not a level this importer understands.`);
  else if (programme) {
    const reason = validateLevelForProgramme(level, programme.durationTerms);
    if (reason) problems.push(reason);
  }

  const matricNumber = cell(row, map, 'matricNumber') || null;
  if (matricNumber) {
    const key = matricNumber.toUpperCase();
    if (seen.seenMatric!.has(key)) {
      problems.push(`The matriculation number ${matricNumber} appears more than once in this file.`);
    } else if (context.existingMatricNumbers.has(key)) {
      problems.push(`The matriculation number ${matricNumber} is already in use at this school.`);
    }
    seen.seenMatric!.add(key);
  }

  const dob = parseDateOfBirth(cell(row, map, 'dateOfBirth'));
  if (dob.problem) problems.push(dob.problem);
  else if (dob.value) {
    const reason = validateDateOfBirth(dob.value, context.now);
    if (reason) problems.push(reason);
  }

  return {
    line,
    outcome: problems.length > 0 ? 'REJECT' : base.duplicate ? 'SKIP_EXISTING' : 'CREATE',
    firstName: base.firstName,
    lastName: base.lastName,
    email: base.email,
    username: base.username,
    phone: base.phone,
    matricNumber,
    programmeCode: programmeCode || null,
    programmeId: programme?.id ?? null,
    level: level ?? undefined,
    dateOfBirth: dob.value,
    gender: parseGender(cell(row, map, 'gender')),
    problems: problems.length > 0 ? problems : base.duplicate ? ['Already a member of this school.'] : [],
  };
}

function planStaff(
  row: readonly string[],
  map: ColumnMap,
  line: number,
  context: PlanContext,
  seen: Seen,
): PlannedRow {
  const base = planCommon(row, map, context, seen);
  const problems = [...base.problems];

  const rawRole = cell(row, map, 'role');
  const role = parseRole(rawRole);
  if (!rawRole) problems.push('No role.');
  else if (!role) problems.push(`"${rawRole}" is not a role this system has.`);
  else if (role === 'STUDENT' || role === 'APPLICANT' || role === 'GUARDIAN') {
    problems.push(`${role} accounts are not created through the staff importer.`);
  } else if (!context.assignableRoles.has(role)) {
    // Checked here so the whole file can be judged before anything is written,
    // rather than failing on row 300 of 400.
    problems.push(`You may not hand out the ${role} role.`);
  }

  const departmentCode = cell(row, map, 'departmentCode').toUpperCase() || null;
  const orgUnitId = departmentCode ? (context.orgUnits.get(departmentCode) ?? null) : null;
  if (departmentCode && !orgUnitId) {
    problems.push(`No department or faculty with the code "${departmentCode}".`);
  }

  return {
    line,
    outcome: problems.length > 0 ? 'REJECT' : base.duplicate ? 'SKIP_EXISTING' : 'CREATE',
    firstName: base.firstName,
    lastName: base.lastName,
    email: base.email,
    username: base.username,
    phone: base.phone,
    role: role ?? undefined,
    title: cell(row, map, 'title') || null,
    departmentCode,
    orgUnitId,
    problems: problems.length > 0 ? problems : base.duplicate ? ['Already a member of this school.'] : [],
  };
}

/**
 * Is this plan safe to run?
 *
 * A plan with a missing required column is dead whatever its rows say. A plan
 * with SOME bad rows is not — the good ones are imported and the bad ones are
 * listed, because a registry with three bad rows in two thousand should not
 * have to fix the file before importing the other 1,997.
 */
export function planIsRunnable(plan: ImportPlan): boolean {
  return plan.missingColumns.length === 0 && plan.counts.create > 0;
}
