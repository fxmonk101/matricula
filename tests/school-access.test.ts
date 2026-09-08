import { describe, expect, it } from 'vitest';

import {
  ROLES,
  ROLE_HOME,
  ROLE_LABELS,
  SCHOOL_STATUSES,
  schoolAcceptsPublicTraffic,
  schoolAllowsSignIn,
  type Role,
} from '@/lib/domain/enums';
import { can, roleSatisfies, ROLE_PERMISSIONS } from '@/lib/auth/rbac';

describe('public traffic gate', () => {
  it('admits only a live school', () => {
    expect(schoolAcceptsPublicTraffic('ACTIVE')).toBe(true);
    expect(schoolAcceptsPublicTraffic('TRIAL')).toBe(true);
  });

  it('turns away a suspended school', () => {
    expect(schoolAcceptsPublicTraffic('SUSPENDED')).toBe(false);
  });

  it('turns away a school still being provisioned', () => {
    // The bug this closes: every check used to read `=== 'SUSPENDED'`, so a
    // half-built school with no grading scheme and no terms was reachable by
    // anyone who knew its slug.
    expect(schoolAcceptsPublicTraffic('PROVISIONING')).toBe(false);
  });

  it('denies a status it does not recognise', () => {
    // A gate that admits what it does not understand is not a gate. This also
    // means a status added later is closed until somebody opens it deliberately.
    expect(schoolAcceptsPublicTraffic('ARCHIVED')).toBe(false);
    expect(schoolAcceptsPublicTraffic('')).toBe(false);
  });
});

describe('sign-in gate', () => {
  it('admits everyone to a live school', () => {
    for (const role of ROLES) {
      expect(schoolAllowsSignIn('ACTIVE', role as Role), role).toBe(true);
      expect(schoolAllowsSignIn('TRIAL', role as Role), role).toBe(true);
    }
  });

  it('admits nobody to a suspended school, not even the owner', () => {
    for (const role of ROLES) {
      expect(schoolAllowsSignIn('SUSPENDED', role as Role), role).toBe(false);
    }
  });

  it('lets the OWNER into a school still being provisioned', () => {
    // They have to get in to finish the setup they were just handed.
    expect(schoolAllowsSignIn('PROVISIONING', 'OWNER')).toBe(true);
  });

  it('keeps everyone else out of a school still being provisioned', () => {
    // Staff and pupils arriving at a school with no grading scheme, no terms
    // and no timetable would reasonably conclude the product is broken.
    for (const role of ROLES.filter((r) => r !== 'OWNER')) {
      expect(schoolAllowsSignIn('PROVISIONING', role as Role), role).toBe(false);
    }
  });

  it('denies an unrecognised status for every role', () => {
    for (const role of ROLES) {
      expect(schoolAllowsSignIn('WHATEVER', role as Role), role).toBe(false);
    }
  });
});

describe('the OWNER role', () => {
  it('is declared everywhere a role must be declared', () => {
    // ROLES, ROLE_LABELS, ROLE_HOME and ROLE_PERMISSIONS are four tables in
    // three files that must agree; forgetting one is a runtime failure.
    expect(ROLES).toContain('OWNER');
    expect(ROLE_LABELS.OWNER).toBeTruthy();
    expect(ROLE_HOME.OWNER).toBeTruthy();
    expect(ROLE_PERMISSIONS.OWNER).toBeDefined();
  });

  it('holds every permission an ADMIN holds', () => {
    // The matrix is built by copying ADMIN's, so this pins that it stays a
    // superset rather than drifting into a different set of grants.
    for (const permission of ROLE_PERMISSIONS.ADMIN) {
      expect(can('OWNER', permission), `OWNER is missing ${permission}`).toBe(true);
    }
  });

  it('holds the owner-only grants that ADMIN does not', () => {
    for (const permission of [
      'user:create',
      'user:role:set',
      'user:suspend',
      'user:password:reset',
      'school:delete',
      'subscription:read',
    ] as const) {
      expect(can('OWNER', permission), `OWNER should hold ${permission}`).toBe(true);
      expect(can('ADMIN', permission), `ADMIN should not hold ${permission}`).toBe(false);
    }
  });

  it('is the only role that can set another user’s role', () => {
    // This is what stops an ADMIN demoting the owner and taking the school.
    const holders = ROLES.filter((r) => can(r as Role, 'user:role:set'));
    expect(holders).toEqual(['OWNER']);
  });
});

describe('role hierarchy', () => {
  it('lets OWNER satisfy an ADMIN requirement', () => {
    // Thirty-six requireTenantRole('ADMIN', …) calls depend on this, and so
    // does every one written in future.
    expect(roleSatisfies('OWNER', ['ADMIN'])).toBe(true);
    expect(roleSatisfies('OWNER', ['ADMIN', 'REGISTRAR'])).toBe(true);
  });

  it('does not let ADMIN satisfy an OWNER requirement', () => {
    expect(roleSatisfies('ADMIN', ['OWNER'])).toBe(false);
  });

  it('matches an exact role', () => {
    expect(roleSatisfies('REGISTRAR', ['REGISTRAR'])).toBe(true);
    expect(roleSatisfies('OWNER', ['OWNER'])).toBe(true);
  });

  it('treats every other role as a peer, not a rank', () => {
    // A REGISTRAR is not a lesser ADMIN; it is a different job. Only the
    // OWNER→ADMIN edge exists.
    expect(roleSatisfies('REGISTRAR', ['ADMIN'])).toBe(false);
    expect(roleSatisfies('INSTRUCTOR', ['REGISTRAR'])).toBe(false);
    expect(roleSatisfies('STUDENT', ['GUARDIAN'])).toBe(false);
  });

  it('refuses an empty requirement', () => {
    // An empty list is how the platform-only guard is expressed; it must admit
    // nobody by role.
    for (const role of ROLES) {
      expect(roleSatisfies(role as Role, []), role).toBe(false);
    }
  });
});

describe('status vocabulary', () => {
  it('every declared status has a defined answer from both gates', () => {
    for (const status of SCHOOL_STATUSES) {
      expect(typeof schoolAcceptsPublicTraffic(status)).toBe('boolean');
      expect(typeof schoolAllowsSignIn(status, 'ADMIN')).toBe('boolean');
    }
  });
});
