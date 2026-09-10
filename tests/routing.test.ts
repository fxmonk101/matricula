import { describe, expect, it } from 'vitest';

import { ROLE_HOME, ROLES, type Role } from '@/lib/domain/enums';
import { guardForPath, ROUTE_GUARDS } from '@/lib/auth/rbac';

/**
 * These tests exist because of a real, user-visible failure: a stale session
 * cookie produced ERR_TOO_MANY_REDIRECTS with no way out except clearing
 * cookies by hand. The loop was possible because two tables that must agree
 * live in different files and nothing checked that they did.
 */
describe('sign-in landing pages', () => {
  it('sends every role somewhere that role is allowed to be', () => {
    // Without this, signing in bounces the user straight to /forbidden — which
    // is precisely what LIBRARIAN, STAFF and GUARDIAN did while all three
    // pointed at /dashboard.
    for (const role of ROLES) {
      const home = ROLE_HOME[role as Role];
      const guard = guardForPath(home);
      if (!guard) continue; // unguarded pages are reachable by everyone
      expect(
        guard.roles.includes(role as Role),
        `${role} lands on ${home}, which ${role} is not permitted to open`,
      ).toBe(true);
    }
  });

  it('never sends a role into the vendor console', () => {
    // The console is a separate portal with its own cookie. A school role
    // landing there would hit its sign-in page and be unable to proceed.
    for (const role of ROLES) {
      expect(ROLE_HOME[role as Role].startsWith('/operator')).toBe(false);
    }
  });

  it('defines a home for every role', () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role as Role], `${role} has no landing page`).toBeTruthy();
      expect(ROLE_HOME[role as Role].startsWith('/')).toBe(true);
    }
  });
});

describe('route guards', () => {
  it('resolves the longest matching prefix, so a specific rule beats a broad one', () => {
    // /admin/platform must not be answered by the broader /admin rule.
    expect(guardForPath('/admin/audit')?.prefix).toBe('/admin');
    expect(guardForPath('/library/manage')?.prefix).toBe('/library/manage');
  });

  it('matches a path segment, not a string prefix', () => {
    // '/teamwork' must not be captured by the '/team' guard.
    expect(guardForPath('/team')?.prefix).toBe('/team');
    expect(guardForPath('/team/anything')?.prefix).toBe('/team');
    expect(guardForPath('/teamwork')).toBeNull();
  });

  it('leaves unguarded paths unguarded', () => {
    expect(guardForPath('/login')).toBeNull();
    expect(guardForPath('/session/end')).toBeNull();
  });

  it('names only roles that exist', () => {
    for (const guard of ROUTE_GUARDS) {
      for (const role of guard.roles) {
        expect(ROLES.includes(role), `${guard.prefix} names unknown role ${role}`).toBe(true);
      }
    }
  });

  it('guards no path inside the vendor console', () => {
    // /operator is handled by its own middleware branch before this table is
    // consulted. A guard here would be dead code that looks load-bearing.
    for (const guard of ROUTE_GUARDS) {
      expect(guard.prefix.startsWith('/operator'), guard.prefix).toBe(false);
    }
  });
});
