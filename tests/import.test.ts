import { describe, expect, it } from 'vitest';

import { parseCsv } from '@/lib/domain/csv';
import {
  buildPlan,
  parseDateOfBirth,
  parseGender,
  parseLevel,
  parseRole,
  planIsRunnable,
  templateHeaders,
  type PlanContext,
} from '@/lib/domain/import';
import type { Role } from '@/lib/domain/enums';

/*
 * Turning a registry's spreadsheet into a plan.
 *
 * The thing being protected here is two thousand accounts created wrongly. You
 * do not fix that by editing a row: every one carries a one-time password
 * somebody has to hand out, and undoing it means deleting people who may
 * already have signed in. So the plan must be right BEFORE anything is written,
 * and every complaint must name the line somebody can go and look at.
 */

const PROGRAMMES = new Map([
  ['BSC-CSC', { id: 'prog-csc', durationTerms: 8, isActive: true }],
  ['BSC-EEE', { id: 'prog-eee', durationTerms: 10, isActive: true }],
  ['BSC-OLD', { id: 'prog-old', durationTerms: 8, isActive: false }],
]);

const ASSIGNABLE = new Set<Role>(['INSTRUCTOR', 'HOD', 'DEAN', 'FINANCE', 'LIBRARIAN', 'STAFF']);

function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    kind: 'STUDENT',
    programmes: PROGRAMMES,
    orgUnits: new Map([['CSC', 'unit-csc'], ['SCI', 'unit-sci']]),
    existingEmails: new Set(),
    existingUsernames: new Set(),
    existingMatricNumbers: new Set(),
    assignableRoles: ASSIGNABLE,
    now: new Date('2026-09-23T12:00:00Z'),
    ...overrides,
  };
}

describe('reading a level from whatever was typed', () => {
  it('accepts the forms a registry writes', () => {
    expect(parseLevel('100')).toBe(100);
    expect(parseLevel('100 Level')).toBe(100);
    expect(parseLevel('400level')).toBe(400);
    expect(parseLevel('Year 2')).toBe(200);
    expect(parseLevel('yr 3')).toBe(300);
    expect(parseLevel('1')).toBe(100);
  });

  it('refuses rather than guesses', () => {
    // "Final" plainly means something, and inventing 400 for it would be
    // making data up.
    expect(parseLevel('Final')).toBeNull();
    expect(parseLevel('150')).toBeNull();
    expect(parseLevel('')).toBeNull();
  });
});

describe('reading a role from whatever was typed', () => {
  it('accepts the words a university uses, not only our constants', () => {
    expect(parseRole('Lecturer')).toBe('INSTRUCTOR');
    expect(parseRole('Head of Department')).toBe('HOD');
    expect(parseRole('Bursar')).toBe('FINANCE');
    expect(parseRole('INSTRUCTOR')).toBe('INSTRUCTOR');
    expect(parseRole('dean')).toBe('DEAN');
  });

  it('returns null for something it does not know', () => {
    expect(parseRole('Vice Chancellor')).toBeNull();
  });
});

describe('dates of birth', () => {
  it('takes ISO as written', () => {
    expect(parseDateOfBirth('2004-07-03')).toEqual({ value: '2004-07-03', problem: null });
  });

  it('reads an UNAMBIGUOUS slash date', () => {
    // 25 cannot be a month, so this is day/month/year.
    expect(parseDateOfBirth('25/12/2004').value).toBe('2004-12-25');
    // 13 cannot be a month either way round.
    expect(parseDateOfBirth('12/13/2004').value).toBe('2004-12-13');
  });

  it('REFUSES an ambiguous slash date instead of guessing', () => {
    /*
     * The bug this exists to prevent. 03/07/2004 is the third of July to a
     * Nigerian registrar and the seventh of March to Excel in an American
     * locale. Picking one silently moves a birthday by four months in a way
     * nobody will ever notice.
     */
    const result = parseDateOfBirth('03/07/2004');
    expect(result.value).toBeNull();
    expect(result.problem).toMatch(/day\/month or month\/day/);
  });

  it('is blank for a blank cell rather than a problem', () => {
    expect(parseDateOfBirth('')).toEqual({ value: null, problem: null });
  });
});

describe('gender', () => {
  it('reads the usual spellings', () => {
    expect(parseGender('M')).toBe('MALE');
    expect(parseGender('female')).toBe('FEMALE');
    expect(parseGender('')).toBeNull();
  });
});

describe('planning a student import', () => {
  const header = 'First Name,Surname,Email,Matric No,Programme,Level\n';

  it('plans a clean file', () => {
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,GEU/CSC/2026/001,BSC-CSC,100\n' +
        'Chidi,Eze,chidi@x.test,GEU/CSC/2026/002,BSC-CSC,200\n',
    );
    const plan = buildPlan(table, context());

    expect(plan.counts).toEqual({ create: 2, skip: 0, reject: 0, total: 2 });
    expect(plan.missingColumns).toEqual([]);
    expect(plan.rows[0].programmeId).toBe('prog-csc');
    expect(plan.rows[0].level).toBe(100);
    expect(planIsRunnable(plan)).toBe(true);
  });

  it('numbers problems by the line the SPREADSHEET shows', () => {
    /*
     * Counting the header. "Line 3" has to be the row somebody can open the
     * file and look at, or the number is worse than useless.
     */
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,,BSC-CSC,100\n' +
        'Chidi,Eze,chidi@x.test,,NOPE,200\n',
    );
    const plan = buildPlan(table, context());

    expect(plan.rows[0].line).toBe(2);
    expect(plan.rows[1].line).toBe(3);
    expect(plan.rows[1].outcome).toBe('REJECT');
    expect(plan.rows[1].problems[0]).toMatch(/NOPE/);
  });

  it('rejects a level the programme does not have', () => {
    // BSC-CSC runs 8 terms = 4 years, so 500 does not exist on it.
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,,BSC-CSC,500\n');
    const plan = buildPlan(table, context());
    expect(plan.rows[0].outcome).toBe('REJECT');
    expect(plan.rows[0].problems.join(' ')).toMatch(/500|level/i);
  });

  it('refuses a programme closed to intake', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,,BSC-OLD,100\n');
    const plan = buildPlan(table, context());
    expect(plan.rows[0].problems.join(' ')).toMatch(/closed to new intake/);
  });

  it('catches a duplicate WITHIN the file', () => {
    /*
     * The database cannot catch this one usefully: the first row is written
     * successfully and the second collides halfway through, leaving an import
     * that is part-done with no clean way back.
     */
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,,BSC-CSC,100\n' +
        'Ada,Okafor,ada@x.test,,BSC-CSC,100\n',
    );
    const plan = buildPlan(table, context());

    expect(plan.rows[0].outcome).toBe('CREATE');
    expect(plan.rows[1].outcome).toBe('REJECT');
    expect(plan.rows[1].problems[0]).toMatch(/more than once in this file/);
  });

  it('catches a duplicate matriculation number within the file', () => {
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,GEU/1,BSC-CSC,100\n' +
        'Chidi,Eze,chidi@x.test,GEU/1,BSC-CSC,100\n',
    );
    const plan = buildPlan(table, context());
    expect(plan.rows[1].problems[0]).toMatch(/matriculation number .* more than once/i);
  });

  it('SKIPS somebody already at the school rather than failing the file', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,,BSC-CSC,100\n');
    const plan = buildPlan(table, context({ existingEmails: new Set(['ada@x.test']) }));

    expect(plan.rows[0].outcome).toBe('SKIP_EXISTING');
    expect(plan.counts).toEqual({ create: 0, skip: 1, reject: 0, total: 1 });
  });

  it('rejects a matriculation number already used at the school', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,GEU/1,BSC-CSC,100\n');
    const plan = buildPlan(
      table,
      context({ existingMatricNumbers: new Set(['GEU/1']) }),
    );
    expect(plan.rows[0].problems[0]).toMatch(/already in use/);
  });

  it('names missing required columns and refuses to run', () => {
    const table = parseCsv('First Name,Surname\nAda,Okafor\n');
    const plan = buildPlan(table, context());
    expect(plan.missingColumns).toContain('programmeCode');
    expect(plan.missingColumns).toContain('level');
    expect(planIsRunnable(plan)).toBe(false);
  });

  it('reports columns nothing reads', () => {
    const table = parseCsv(
      'First Name,Surname,Programme,Level,Guardian Phone\nAda,Okafor,BSC-CSC,100,08030000000\n',
    );
    const plan = buildPlan(table, context());
    expect(plan.unmatchedColumns).toEqual(['Guardian Phone']);
  });

  it('lets good rows through alongside bad ones', () => {
    /*
     * A registry with three bad rows in two thousand should not have to fix
     * the file before importing the other 1,997.
     */
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,,BSC-CSC,100\n' +
        ',Eze,chidi@x.test,,BSC-CSC,200\n' +
        'Ngozi,Bello,ngozi@x.test,,BSC-EEE,300\n',
    );
    const plan = buildPlan(table, context());

    expect(plan.counts.create).toBe(2);
    expect(plan.counts.reject).toBe(1);
    expect(planIsRunnable(plan)).toBe(true);
  });
});

describe('planning a staff import', () => {
  const staff = context({ kind: 'STAFF' });
  const header = 'First Name,Surname,Email,Role,Department\n';

  it('maps the words a registry writes to our roles', () => {
    const table = parseCsv(
      header +
        'Ada,Okafor,ada@x.test,Lecturer,CSC\n' +
        'Obi,Nwosu,obi@x.test,Head of Department,CSC\n',
    );
    const plan = buildPlan(table, staff);

    expect(plan.rows[0].role).toBe('INSTRUCTOR');
    expect(plan.rows[0].orgUnitId).toBe('unit-csc');
    expect(plan.rows[1].role).toBe('HOD');
    expect(plan.counts.create).toBe(2);
  });

  it('REFUSES a role this actor may not hand out', () => {
    /*
     * Checked while planning so the whole file is judged before anything is
     * written, rather than failing on row 300 of 400 with 299 accounts made.
     */
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,Registrar,CSC\n');
    const plan = buildPlan(table, staff);
    expect(plan.rows[0].outcome).toBe('REJECT');
    expect(plan.rows[0].problems[0]).toMatch(/may not hand out/);
  });

  it('refuses to create students through the staff importer', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,Student,CSC\n');
    const plan = buildPlan(table, staff);
    expect(plan.rows[0].problems[0]).toMatch(/not created through the staff importer/);
  });

  it('rejects a department code that does not exist', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,Lecturer,NOPE\n');
    const plan = buildPlan(table, staff);
    expect(plan.rows[0].problems[0]).toMatch(/No department or faculty/);
  });

  it('allows a member of staff with no department', () => {
    const table = parseCsv(header + 'Ada,Okafor,ada@x.test,Librarian,\n');
    const plan = buildPlan(table, staff);
    expect(plan.rows[0].outcome).toBe('CREATE');
    expect(plan.rows[0].orgUnitId).toBeNull();
  });
});

describe('the downloadable template', () => {
  it('leads with our own spelling of each column', () => {
    expect(templateHeaders('STUDENT')).toContain('First Name');
    expect(templateHeaders('STUDENT')).toContain('Programme');
    expect(templateHeaders('STAFF')).toContain('Role');
  });

  it('produces headers this importer can read back', () => {
    // The round trip: a template we hand out must import cleanly.
    const table = parseCsv(
      `${templateHeaders('STUDENT').join(',')}\nAda,Okafor,ada@x.test,,,,BSC-CSC,100,,\n`,
    );
    const plan = buildPlan(table, context());
    expect(plan.missingColumns).toEqual([]);
  });
});
