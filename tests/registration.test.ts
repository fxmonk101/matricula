import { describe, expect, it } from 'vitest';

import {
  GENDERS,
  isValidMatric,
  levelsForProgramme,
  matricRejectionReason,
  normaliseMatric,
  validateDateOfBirth,
  validateLevelForProgramme,
  validateRegistration,
} from '@/lib/domain/registration';
import { buildMatricNumber } from '@/lib/domain/admissions';
import { can } from '@/lib/auth/rbac';
import { ROLES, type Role } from '@/lib/domain/enums';
import { guardForPath } from '@/lib/auth/rbac';

describe('matriculation numbers', () => {
  it('accepts the format the system issues', () => {
    expect(isValidMatric(buildMatricNumber('GEU', 'CSC', 2025, 417))).toBe(true);
    expect(isValidMatric('GEU/CSC/2025/0417')).toBe(true);
  });

  it('accepts the historical formats a migrating university already has', () => {
    /*
     * The decisive case. A university moving twenty years of records has
     * numbers in half a dozen shapes, and every one of them is printed on a
     * certificate that has already been issued. Refusing them would mean
     * either losing the number or inventing a new one — and inventing a new
     * matriculation number for an existing student is the most destructive
     * thing this software could do to a record.
     */
    for (const value of [
      'U2019/3041',
      'ENG-2021-0088',
      'SCI.2018.114',
      'PG 2022 0009',
      '20180114',
    ]) {
      expect(isValidMatric(value), value).toBe(true);
    }
  });

  it('normalises case and internal spacing', () => {
    expect(normaliseMatric('  geu/csc/2025/0417 ')).toBe('GEU/CSC/2025/0417');
    expect(normaliseMatric('PG  2022  0009')).toBe('PG 2022 0009');
  });

  it('refuses what cannot be quoted unambiguously', () => {
    expect(matricRejectionReason('')).toMatch(/Enter a matriculation number/);
    expect(matricRejectionReason('AB')).toMatch(/four characters/);
    expect(matricRejectionReason('X'.repeat(40))).toMatch(/too long/);
    expect(matricRejectionReason('/LEADING/1')).toMatch(/start with/);
    expect(matricRejectionReason('TRAILING/1/')).toMatch(/end with/);
    expect(matricRejectionReason('BAD#CHAR1')).toMatch(/slashes, hyphens/);
  });

  it('accepts a good one with no complaint', () => {
    expect(matricRejectionReason('GEU/CSC/2025/0417')).toBeNull();
  });
});

describe('levels follow the programme', () => {
  it('derives them from the duration', () => {
    // Eight terms at two per year is a four-year degree: 100 to 400.
    expect(levelsForProgramme(8)).toEqual([100, 200, 300, 400]);
    expect(levelsForProgramme(10)).toEqual([100, 200, 300, 400, 500]);
    expect(levelsForProgramme(4)).toEqual([100, 200]);
  });

  it('copes with an odd number of terms by rounding up', () => {
    // A five-term programme still has a third year, even a short one.
    expect(levelsForProgramme(5)).toEqual([100, 200, 300]);
  });

  it('never returns an empty list', () => {
    expect(levelsForProgramme(0)).toEqual([100]);
    expect(levelsForProgramme(1)).toEqual([100]);
  });

  it('supports a trimester school through the divisor', () => {
    // The parameter exists so the assumption is visible rather than buried.
    expect(levelsForProgramme(9, 3)).toEqual([100, 200, 300]);
  });

  it('refuses a level the programme does not run', () => {
    // Not a typo to absorb silently: it puts a student on a level with no
    // courses behind it, and the first anyone notices is an empty
    // registration screen weeks later.
    expect(validateLevelForProgramme(500, 8)).toMatch(/runs to level 400/);
    expect(validateLevelForProgramme(100, 8)).toBeNull();
    expect(validateLevelForProgramme(400, 8)).toBeNull();
  });
});

describe('dates of birth', () => {
  const now = new Date('2026-09-11T00:00:00Z');

  it('is optional', () => {
    expect(validateDateOfBirth('', now)).toBeNull();
    expect(validateDateOfBirth('   ', now)).toBeNull();
  });

  it('accepts a plausible one', () => {
    expect(validateDateOfBirth('2005-03-14', now)).toBeNull();
  });

  it('refuses the future', () => {
    expect(validateDateOfBirth('2030-01-01', now)).toMatch(/future/);
  });

  it('catches the year typed as the current one', () => {
    // The commonest slip, and it silently corrupts every age-based report.
    expect(validateDateOfBirth('2026-01-01', now)).toMatch(/under ten/);
  });

  it('refuses an implausibly distant one', () => {
    expect(validateDateOfBirth('1890-01-01', now)).toMatch(/hundred years/);
  });

  it('refuses a malformed date', () => {
    expect(validateDateOfBirth('not-a-date', now)).toMatch(/valid date/);
  });
});

describe('validating a registration', () => {
  const programme = { durationTerms: 8 };
  const good = {
    firstName: 'Chinwe',
    lastName: 'Nwankwo',
    username: 'c.nwankwo',
    programmeId: 'p1',
    level: 100,
  };

  it('accepts a well-formed registration', () => {
    expect(validateRegistration(good, programme, [])).toEqual([]);
  });

  it('carries identifier problems through rather than re-deriving them', () => {
    // The at-least-one rule belongs with the identifier rules; duplicating it
    // here is how the two drift out of step.
    const problems = validateRegistration(good, programme, ['no identifier']);
    expect(problems).toContain('no identifier');
  });

  it('reports every problem at once', () => {
    // Eleven fields. One-at-a-time validation is eleven round trips.
    const problems = validateRegistration(
      {
        firstName: '',
        lastName: '',
        programmeId: '',
        level: 900,
        matricNumber: 'X',
        dateOfBirth: '2030-01-01',
      },
      null,
      [],
    );
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it('requires a programme', () => {
    expect(validateRegistration({ ...good, programmeId: '' }, null, []).join(' ')).toMatch(
      /Choose a programme/,
    );
  });

  it('leaves an omitted matriculation number alone', () => {
    // Blank means "issue one", which is the common case.
    expect(validateRegistration({ ...good, matricNumber: '' }, programme, [])).toEqual([]);
    expect(validateRegistration({ ...good, matricNumber: null }, programme, [])).toEqual([]);
  });

  it('validates a supplied matriculation number', () => {
    expect(
      validateRegistration({ ...good, matricNumber: 'BAD#1' }, programme, []).join(' '),
    ).toMatch(/slashes, hyphens/);
  });

  it('offers a gender list that includes not answering', () => {
    expect(GENDERS).toContain('Prefer not to say');
  });
});

describe('who may register a student', () => {
  it('is the Bursary, plus the school administration', () => {
    const holders = ROLES.filter((r) => can(r as Role, 'student:register'));
    expect([...holders].sort()).toEqual(['ADMIN', 'FINANCE', 'OWNER']);
  });

  it('is deliberately NOT the registry', () => {
    // Separating admission from fee clearance means no single office can both
    // admit a student and clear their fees.
    expect(can('REGISTRAR', 'student:register')).toBe(false);
  });

  it('keeps teaching staff away from the registration route', () => {
    const guard = guardForPath('/students/register');
    expect(guard?.prefix).toBe('/students/register');
    for (const role of ['INSTRUCTOR', 'DEAN', 'HOD', 'ADMISSIONS', 'STUDENT'] as Role[]) {
      expect(guard?.roles.includes(role), role).toBe(false);
    }
  });

  it('resolves the longer prefix, so the list guard does not admit the form', () => {
    expect(guardForPath('/students')?.prefix).toBe('/students');
    expect(guardForPath('/students/register')?.prefix).toBe('/students/register');
  });
});
