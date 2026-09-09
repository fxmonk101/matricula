import { describe, expect, it } from 'vitest';

import {
  FORCED_PASSWORD_PATH,
  PASSWORD_ESCAPE_PATHS,
  requiresPasswordChange,
} from '@/lib/auth/password-gate';
import { ROLE_HOME, ROLES, type Role } from '@/lib/domain/enums';
import { ROUTE_GUARDS } from '@/lib/auth/rbac';

const forced = { mcp: true };
const settled = { mcp: false };

/**
 * This file exists because the failure mode is an infinite redirect: signed in,
 * sent to a page, sent straight back, with no way out but clearing cookies by
 * hand. That has happened in this codebase once already and reached the user as
 * a screenshot of ERR_TOO_MANY_REDIRECTS.
 */
describe('the forced password-change gate', () => {
  it('does not redirect the change page to itself', () => {
    // The loop, in one assertion.
    expect(requiresPasswordChange(FORCED_PASSWORD_PATH, forced)).toBe(false);
  });

  it('always leaves a way out', () => {
    // Somebody on the wrong machine, or who did not write the password down,
    // must be able to sign out. A gate with no exit is a trap.
    expect(requiresPasswordChange('/session/end', forced)).toBe(false);
  });

  it('does not bounce between itself and /forbidden', () => {
    // A user who is both in forced-change state and lacks the role for a route
    // would otherwise ping-pong between two redirects.
    expect(requiresPasswordChange('/forbidden', forced)).toBe(false);
  });

  it('redirects every other authenticated path', () => {
    for (const path of ['/dashboard', '/people', '/students', '/me', '/library', '/setup']) {
      expect(requiresPasswordChange(path, forced), path).toBe(true);
    }
  });

  it('covers paths that have no route guard at all', () => {
    // The whole point of checking before the guard lookup: a gate that only
    // covered guarded routes would need an exception added for every new page.
    expect(ROUTE_GUARDS.some((g) => g.prefix === '/some/future/page')).toBe(false);
    expect(requiresPasswordChange('/some/future/page', forced)).toBe(true);
  });

  it('redirects every role’s landing page', () => {
    // Sign-in sends a user to ROLE_HOME. If any of those were exempt, that role
    // would slip past the gate entirely.
    for (const role of ROLES) {
      expect(requiresPasswordChange(ROLE_HOME[role as Role], forced), role).toBe(true);
    }
  });

  it('leaves a settled account alone', () => {
    for (const path of ['/dashboard', '/people', FORCED_PASSWORD_PATH]) {
      expect(requiresPasswordChange(path, settled), path).toBe(false);
    }
  });

  it('leaves a signed-out request alone', () => {
    // No session means the login redirect handles it; this gate must not
    // pre-empt that and send an anonymous visitor to a page needing a session.
    expect(requiresPasswordChange('/dashboard', null)).toBe(false);
    expect(requiresPasswordChange('/dashboard', undefined)).toBe(false);
    expect(requiresPasswordChange('/dashboard', {})).toBe(false);
  });

  it('names the change page among the paths it lets through', () => {
    expect(PASSWORD_ESCAPE_PATHS).toContain(FORCED_PASSWORD_PATH);
  });

  it('lets no escape path collide with a guarded prefix that would refuse it', () => {
    // /account/password must not sit under a guard naming roles, or a student
    // in forced-change state would be sent to /forbidden and stick there.
    for (const path of PASSWORD_ESCAPE_PATHS) {
      const guard = ROUTE_GUARDS.find((g) => path === g.prefix || path.startsWith(`${g.prefix}/`));
      expect(guard, `${path} is guarded by ${guard?.prefix}`).toBeUndefined();
    }
  });
});
