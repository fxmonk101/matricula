import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ROLES,
  MIN_PASSWORD_LENGTH,
  canActOn,
  canAssignRole,
  isValidEmail,
  normaliseEmail,
  passwordProblems,
  passwordStrength,
  seatKindFor,
  validatePerson,
  wouldLeaveSchoolOwnerless,
} from '@/lib/domain/people';
import { ROLES, type Role } from '@/lib/domain/enums';

const OWNER = { role: 'OWNER' as Role, membershipId: 'm-owner' };
const ADMIN = { role: 'ADMIN' as Role, membershipId: 'm-admin' };
const ownerRow = { membershipId: 'm-owner', role: 'OWNER' as Role };
const adminRow = { membershipId: 'm-admin', role: 'ADMIN' as Role };
const teacherRow = { membershipId: 'm-teacher', role: 'INSTRUCTOR' as Role };

describe('who may act on whom', () => {
  it('stops an ADMIN touching the OWNER, in every way', () => {
    /*
     * The single most consequential rule in this file. Without it, any
     * administrator could suspend the owner, reset their password and take the
     * school — and the owner is the one account with no higher authority inside
     * the school to appeal to.
     */
    for (const action of ['edit', 'role', 'suspend', 'password', 'delete'] as const) {
      const verdict = canActOn(ADMIN, ownerRow, action);
      expect(verdict.allowed, action).toBe(false);
      expect(verdict.reason, action).toMatch(/owner/i);
    }
  });

  it('lets an OWNER act on an ADMIN', () => {
    for (const action of ['edit', 'role', 'suspend', 'password', 'delete'] as const) {
      expect(canActOn(OWNER, adminRow, action).allowed, action).toBe(true);
    }
  });

  it('lets an ADMIN act on ordinary staff', () => {
    // An administrator who cannot enrol a teacher is not an administrator.
    for (const action of ['edit', 'role', 'suspend', 'password', 'delete'] as const) {
      expect(canActOn(ADMIN, teacherRow, action).allowed, action).toBe(true);
    }
  });

  it('stops anybody suspending or removing themselves', () => {
    // An owner who suspends themselves has created a school nobody can
    // administer, and the only repair is a database console.
    expect(canActOn(OWNER, ownerRow, 'suspend').allowed).toBe(false);
    expect(canActOn(OWNER, ownerRow, 'delete').allowed).toBe(false);
    expect(canActOn(ADMIN, adminRow, 'suspend').allowed).toBe(false);
  });

  it('stops anybody changing their own role', () => {
    expect(canActOn(ADMIN, adminRow, 'role').allowed).toBe(false);
    expect(canActOn(OWNER, ownerRow, 'role').allowed).toBe(false);
  });

  it('still lets somebody edit their own details and password', () => {
    // Self-service is not a privilege escalation.
    expect(canActOn(ADMIN, adminRow, 'edit').allowed).toBe(true);
    expect(canActOn(OWNER, ownerRow, 'password').allowed).toBe(true);
  });

  it('lets a second OWNER act on the first', () => {
    const other = { role: 'OWNER' as Role, membershipId: 'm-owner-2' };
    expect(canActOn(other, ownerRow, 'suspend').allowed).toBe(true);
  });
});

describe('assigning roles', () => {
  it('refuses OWNER to everybody, including an OWNER', () => {
    // Ownership is transferred deliberately, not picked from a dropdown next
    // to "Librarian". No actor makes this allowed.
    for (const role of ROLES) {
      expect(canAssignRole(role as Role, 'OWNER').allowed, role).toBe(false);
    }
  });

  it('refuses APPLICANT, which is something a person becomes', () => {
    expect(canAssignRole('OWNER', 'APPLICANT').allowed).toBe(false);
  });

  it('allows every other role', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(canAssignRole('ADMIN', role).allowed, role).toBe(true);
    }
  });

  it('offers neither OWNER nor APPLICANT in the assignable list', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('OWNER');
    expect(ASSIGNABLE_ROLES).not.toContain('APPLICANT');
    expect(ASSIGNABLE_ROLES.length).toBe(ROLES.length - 2);
  });
});

describe('the last owner', () => {
  it('cannot be demoted, suspended or removed', () => {
    for (const action of ['role', 'suspend', 'delete'] as const) {
      expect(
        wouldLeaveSchoolOwnerless({ targetRole: 'OWNER', action, activeOwnerCount: 1 }),
        action,
      ).toBe(true);
    }
  });

  it('may be, once there is a second', () => {
    expect(
      wouldLeaveSchoolOwnerless({ targetRole: 'OWNER', action: 'suspend', activeOwnerCount: 2 }),
    ).toBe(false);
  });

  it('does not constrain anybody who is not an owner', () => {
    expect(
      wouldLeaveSchoolOwnerless({ targetRole: 'ADMIN', action: 'delete', activeOwnerCount: 1 }),
    ).toBe(false);
  });
});

describe('seats', () => {
  it('counts a student as a student seat', () => {
    expect(seatKindFor('STUDENT')).toBe('student');
  });

  it('does not charge for guardians or applicants', () => {
    // Billing for parent accounts would make schools ration them, which defeats
    // the point of having a guardian portal at all.
    expect(seatKindFor('GUARDIAN')).toBeNull();
    expect(seatKindFor('APPLICANT')).toBeNull();
  });

  it('counts every other role as staff', () => {
    for (const role of ROLES) {
      if (role === 'STUDENT' || role === 'GUARDIAN' || role === 'APPLICANT') continue;
      expect(seatKindFor(role as Role), role).toBe('staff');
    }
  });
});

describe('validating a person', () => {
  const good = {
    email: 'a.teacher@school.test',
    firstName: 'Ada',
    lastName: 'Okonkwo',
    role: 'INSTRUCTOR' as Role,
  };

  it('accepts a well-formed person', () => {
    expect(validatePerson(good)).toEqual([]);
  });

  it('reports EVERY problem, not just the first', () => {
    // One-at-a-time validation turns a form with four mistakes into four round
    // trips, and the person filling it in is entering two hundred pupils.
    const problems = validatePerson({ email: 'nope', firstName: '', lastName: '', role: 'INSTRUCTOR' });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('normalises the email address', () => {
    expect(normaliseEmail('  Ada.Okonkwo@School.TEST ')).toBe('ada.okonkwo@school.test');
    expect(isValidEmail('  Ada@School.TEST ')).toBe(true);
  });

  it('refuses obviously malformed addresses', () => {
    for (const bad of ['no-at-sign', 'two@@at.test', 'trailing@dot', '@nolocal.test', 'spa ce@x.test']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});

describe('password policy', () => {
  it('requires length rather than composition', () => {
    // Composition rules reliably produce `Password1!` and nothing better.
    expect(passwordProblems('short')).toContain(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    expect(passwordProblems('correct horse battery staple')).toEqual([]);
    // …and that passphrase has no digit, no capital and no symbol.
  });

  it('refuses the passwords everybody tries first', () => {
    for (const bad of ['password123', 'Password123', '12345678', 'qwertyuiop']) {
      expect(passwordProblems(bad).length, bad).toBeGreaterThan(0);
    }
  });

  it('refuses a password containing the person’s own name or address', () => {
    const person = { email: 'ada.okonkwo@school.test', firstName: 'Ada', lastName: 'Okonkwo' };
    expect(passwordProblems('okonkwo-is-here', person).join(' ')).toMatch(/your own name/);
    expect(passwordProblems('ada.okonkwo-rules', person).join(' ')).toMatch(/your own name/);
  });

  it('does not reject on a short name fragment', () => {
    // "Ada" is three characters; requiring a password not to contain any
    // three-letter run of a person's name would refuse half of English.
    const person = { email: 'a@school.test', firstName: 'Ada', lastName: 'Li' };
    expect(passwordProblems('a-perfectly-fine-passphrase', person)).toEqual([]);
  });

  it('caps the length so a megabyte is not hashed', () => {
    expect(passwordProblems('x'.repeat(500)).join(' ')).toMatch(/too long/);
  });

  it('scores strength without deciding acceptance', () => {
    // The meter encourages; `passwordProblems` decides. A meter that refuses is
    // a composition rule with a colour.
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('password123')).toBe(0);
    expect(passwordStrength('abcdefghij')).toBeGreaterThan(0);
    expect(passwordStrength('correct horse battery staple')).toBeGreaterThan(
      passwordStrength('abcdefghij'),
    );
  });

  it('never scores above 4 or below 0', () => {
    for (const value of ['', 'a', 'x'.repeat(400), 'Tr0ub4dor&3xxxxxxxxxxxxxxx']) {
      const score = passwordStrength(value);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
    }
  });
});
