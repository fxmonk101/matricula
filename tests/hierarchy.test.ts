import { describe, expect, it } from 'vitest';

import {
  ACADEMIC_LADDER,
  canReportTo,
  reportsTo,
  validManagerRoles,
  walkUp,
  wouldCreateCycle,
} from '@/lib/domain/hierarchy';
import { ROLES, type Role } from '@/lib/domain/enums';
import { can } from '@/lib/auth/rbac';

describe('the academic reporting line', () => {
  it('runs student → lecturer → HOD → dean → registrar', () => {
    expect(reportsTo('STUDENT')).toBe('INSTRUCTOR');
    expect(reportsTo('INSTRUCTOR')).toBe('HOD');
    expect(reportsTo('HOD')).toBe('DEAN');
    expect(reportsTo('DEAN')).toBe('REGISTRAR');
  });

  it('puts the registrar under the school rather than under a faculty', () => {
    expect(reportsTo('REGISTRAR')).toBe('OWNER');
  });

  it('does not force the bursary into the faculty line', () => {
    // A bursar under a dean would put the fee ledger inside a faculty that has
    // no authority over it.
    expect(reportsTo('FINANCE')).toBe('ADMIN');
    expect(reportsTo('LIBRARIAN')).toBe('ADMIN');
  });

  it('gives a guardian and an applicant no place in the staff hierarchy', () => {
    expect(reportsTo('GUARDIAN')).toBeNull();
    expect(reportsTo('APPLICANT')).toBeNull();
    expect(canReportTo('GUARDIAN', 'DEAN').allowed).toBe(false);
    expect(canReportTo('APPLICANT', 'REGISTRAR').allowed).toBe(false);
  });

  it('terminates for every role rather than looping', () => {
    // A cycle in this table would hang every upward walk in the app.
    for (const role of ROLES) {
      let current: Role | null = role as Role;
      const seen = new Set<Role>();
      let steps = 0;
      while (current && steps < 20) {
        expect(seen.has(current), `cycle through ${role} at ${current}`).toBe(false);
        seen.add(current);
        current = reportsTo(current);
        steps += 1;
      }
      expect(steps, `${role} did not terminate`).toBeLessThan(20);
    }
  });
});

describe('who may manage whom', () => {
  it('accepts the natural manager', () => {
    expect(canReportTo('INSTRUCTOR', 'HOD').allowed).toBe(true);
    expect(canReportTo('HOD', 'DEAN').allowed).toBe(true);
    expect(canReportTo('DEAN', 'REGISTRAR').allowed).toBe(true);
  });

  it('accepts skipping a rung upwards', () => {
    // A department with no head has its lecturers reporting straight to the
    // dean. Refusing that is a rule schools work around by lying to the system.
    expect(canReportTo('INSTRUCTOR', 'DEAN').allowed).toBe(true);
    expect(canReportTo('INSTRUCTOR', 'REGISTRAR').allowed).toBe(true);
  });

  it('refuses reporting downwards or sideways', () => {
    expect(canReportTo('DEAN', 'INSTRUCTOR').allowed).toBe(false);
    expect(canReportTo('HOD', 'STUDENT').allowed).toBe(false);
    expect(canReportTo('INSTRUCTOR', 'LIBRARIAN').allowed).toBe(false);
  });

  it('explains the refusal in terms a registrar can act on', () => {
    const verdict = canReportTo('DEAN', 'INSTRUCTOR');
    expect(verdict.allowed).toBe(false);
    // "Invalid manager" tells nobody what to do instead.
    expect(verdict.reason).toMatch(/dean/i);
    expect(verdict.reason).toMatch(/registrar|lecturer/i);
  });

  it('lets the owner and the administrator manage anybody', () => {
    for (const role of ['INSTRUCTOR', 'HOD', 'DEAN', 'FINANCE', 'LIBRARIAN'] as Role[]) {
      expect(canReportTo(role, 'OWNER').allowed, role).toBe(true);
      expect(canReportTo(role, 'ADMIN').allowed, role).toBe(true);
    }
  });

  it('offers only upward options in the manager list', () => {
    const options = validManagerRoles('INSTRUCTOR');
    expect(options).toContain('HOD');
    expect(options).toContain('DEAN');
    expect(options).not.toContain('STUDENT');
    expect(options).not.toContain('INSTRUCTOR');
  });
});

describe('walking the chart', () => {
  const chart = new Map(
    [
      { id: 'student', managerId: 'lecturer' },
      { id: 'lecturer', managerId: 'hod' },
      { id: 'hod', managerId: 'dean' },
      { id: 'dean', managerId: 'registrar' },
      { id: 'registrar', managerId: null },
    ].map((n) => [n.id, n]),
  );

  it('walks from anywhere to the top', () => {
    const { chain, cycle } = walkUp('student', chart);
    expect(cycle).toBe(false);
    expect(chain.map((n) => n.id)).toEqual(['student', 'lecturer', 'hod', 'dean', 'registrar']);
  });

  it('reports a cycle instead of hanging', () => {
    // `managerId` is a self-referential foreign key, so a cycle is expressible
    // no matter how carefully the UI validates — one bad import is enough.
    const looped = new Map(
      [
        { id: 'a', managerId: 'b' },
        { id: 'b', managerId: 'c' },
        { id: 'c', managerId: 'a' },
      ].map((n) => [n.id, n]),
    );
    const { cycle, chain } = walkUp('a', looped);
    expect(cycle).toBe(true);
    expect(chain.length).toBeLessThanOrEqual(3);
  });

  it('stops at a missing node rather than throwing', () => {
    const broken = new Map([['a', { id: 'a', managerId: 'gone' }]]);
    const { chain, cycle } = walkUp('a', broken);
    expect(cycle).toBe(false);
    expect(chain.map((n) => n.id)).toEqual(['a']);
  });

  it('caps an implausibly deep chain', () => {
    const deep = new Map(
      Array.from({ length: 30 }, (_, i) => ({
        id: `n${i}`,
        managerId: i < 29 ? `n${i + 1}` : null,
      })).map((n) => [n.id, n]),
    );
    const { chain, cycle } = walkUp('n0', deep);
    expect(chain.length).toBe(12);
    expect(cycle).toBe(true);
  });
});

describe('preventing a cycle before it is written', () => {
  const chart = new Map(
    [
      { id: 'lecturer', managerId: 'hod' },
      { id: 'hod', managerId: 'dean' },
      { id: 'dean', managerId: null },
    ].map((n) => [n.id, n]),
  );

  it('refuses somebody as their own manager', () => {
    expect(wouldCreateCycle('hod', 'hod', chart)).toBe(true);
  });

  it('refuses a manager who already reports to the subordinate', () => {
    // Making the dean report to the lecturer closes the loop.
    expect(wouldCreateCycle('dean', 'lecturer', chart)).toBe(true);
  });

  it('allows an ordinary re-assignment', () => {
    expect(wouldCreateCycle('lecturer', 'dean', chart)).toBe(false);
  });
});

describe('the university role model', () => {
  it('gives the Registrar the academic structure', () => {
    for (const p of ['faculty:write', 'department:write', 'program:write', 'course:write'] as const) {
      expect(can('REGISTRAR', p), p).toBe(true);
    }
  });

  it('lets the Registrar appoint staff and open forums', () => {
    expect(can('REGISTRAR', 'user:create')).toBe(true);
    expect(can('REGISTRAR', 'instructor:write')).toBe(true);
    expect(can('REGISTRAR', 'forum:create')).toBe(true);
  });

  it('gives the Bursar student registration, and nobody else outside the registry', () => {
    expect(can('FINANCE', 'student:register')).toBe(true);
    // Deliberately NOT the registrar: separating admission from fee clearance
    // means no single office can both admit a student and clear their fees.
    expect(can('REGISTRAR', 'student:register')).toBe(false);
    const holders = ROLES.filter((r) => can(r as Role, 'student:register'));
    expect([...holders].sort()).toEqual(['ADMIN', 'FINANCE', 'OWNER']);
  });

  it('gives the Dean the timetable', () => {
    expect(can('DEAN', 'timetable:write')).toBe(true);
    expect(can('DEAN', 'offering:assign')).toBe(true);
    // A lecturer may read the timetable but not rewrite it.
    expect(can('INSTRUCTOR', 'timetable:write')).toBe(false);
  });

  it('keeps the Dean out of the fee ledger', () => {
    for (const p of ['invoice:write', 'payment:record', 'fee:configure'] as const) {
      expect(can('DEAN', p), p).toBe(false);
    }
  });

  it('lets a HOD lecture as well as run a department', () => {
    // A head of department who cannot enter marks would have to hold a second
    // account to teach, which is how shadow accounts get created.
    expect(can('HOD', 'grade:submit')).toBe(true);
    expect(can('HOD', 'offering:assign')).toBe(true);
  });

  it('lets every enrolled member of the university use the forums', () => {
    // "Each registered student or administrator can partake in the forum."
    const partakers: Role[] = [
      'OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD',
      'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT',
    ];
    for (const role of partakers) {
      expect(can(role, 'forum:read'), role).toBe(true);
      expect(can(role, 'forum:post'), role).toBe(true);
    }
  });

  it('does not put an applicant or a guardian in the university’s forums', () => {
    expect(can('APPLICANT', 'forum:post')).toBe(false);
    expect(can('GUARDIAN', 'forum:post')).toBe(false);
  });
});
