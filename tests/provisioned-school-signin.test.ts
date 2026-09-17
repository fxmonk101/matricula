import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  schoolAcceptsPublicTraffic,
  schoolAcceptsSignIn,
  schoolAllowsSignIn,
  ROLES,
  type Role,
} from '@/lib/domain/enums';

/**
 * =============================================================================
 * GETTING INTO A SCHOOL THAT WAS JUST CREATED
 * =============================================================================
 *
 * A newly provisioned school sits in PROVISIONING until its owner finishes the
 * setup. `schoolAllowsSignIn` has always said the owner may sign in and nobody
 * else may — and it was thoroughly tested. It was also, at the two places that
 * decide whether somebody actually gets in, NOT CONSULTED:
 *
 *   · the tenant login PAGE rendered only for `schoolAcceptsPublicTraffic`,
 *     which excludes PROVISIONING, so it returned 404. The owner could not
 *     reach the form for the school they had been handed a link to.
 *
 *   · the login ACTION filtered on `status !== 'SUSPENDED'` — the deny-list the
 *     allow-list was written to replace — so it would have admitted ANY role
 *     into a half-built school.
 *
 * Two opposite errors, both from the same cause: the rule was right and the
 * entry points did not ask it. So these tests check the rule AND check that the
 * call sites call it, because the first kind of test passed the whole time this
 * was broken.
 */

const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/**
 * The same file with comments stripped.
 *
 * A source assertion has to read CODE, not prose. The fix for the bug below
 * carries a comment quoting the old test verbatim, so a plain substring search
 * matches the explanation of the fix and reports the fix as the bug.
 */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the rule itself', () => {
  it('lets the owner of a provisioning school in', () => {
    expect(schoolAllowsSignIn('PROVISIONING', 'OWNER')).toBe(true);
  });

  it('keeps everybody else out until the school is live', () => {
    // They would arrive at an institution with no terms, no grading scheme and
    // no timetable, and reasonably conclude the product is broken.
    for (const role of ROLES.filter((r) => r !== 'OWNER')) {
      expect(schoolAllowsSignIn('PROVISIONING', role as Role), role).toBe(false);
    }
  });

  it('renders the sign-in form for a provisioning school', () => {
    // Rendering the form is not authorisation — it is the difference between
    // "you cannot sign in yet" and "this school does not exist".
    expect(schoolAcceptsSignIn('PROVISIONING')).toBe(true);
    expect(schoolAcceptsSignIn('ACTIVE')).toBe(true);
    expect(schoolAcceptsSignIn('TRIAL')).toBe(true);
  });

  it('still refuses a suspended or unknown school entirely', () => {
    for (const status of ['SUSPENDED', 'CLOSED', 'WHATEVER', '']) {
      expect(schoolAcceptsSignIn(status), status).toBe(false);
      for (const role of ROLES) {
        expect(schoolAllowsSignIn(status, role as Role), `${status}/${role}`).toBe(false);
      }
    }
  });

  it('does NOT open the public application form while provisioning', () => {
    /*
     * The distinction that makes the two functions worth having. A school being
     * set up must let its owner in and must not be taking applications from the
     * public — collapsing them either locks the owner out or advertises a
     * school that cannot yet enrol anybody.
     */
    expect(schoolAcceptsPublicTraffic('PROVISIONING')).toBe(false);
    expect(schoolAcceptsSignIn('PROVISIONING')).toBe(true);
  });
});

describe('the places that decide whether somebody gets in', () => {
  /*
   * Source assertions, deliberately. Every behavioural test above passed while
   * the bug was live, because the bug was that these call sites never reached
   * the rule.
   */

  it('the tenant login page gates on the sign-in rule, not the public one', () => {
    const page = readCode('app/s/[slug]/login/page.tsx');
    expect(page).toContain('schoolAcceptsSignIn');
    // The public rule here is what produced the 404.
    expect(page).not.toContain('schoolAcceptsPublicTraffic');
  });

  it('the login action uses the allow-list rather than a SUSPENDED deny-list', () => {
    const action = readCode('app/(auth)/actions.ts');
    expect(action).toContain('schoolAllowsSignIn');
    expect(action).not.toContain("status !== 'SUSPENDED'");
  });

  it('the public application form still uses the PUBLIC rule', () => {
    // This one was never wrong, and must not be "fixed" along with the others.
    expect(read('app/s/[slug]/apply/page.tsx')).toContain('schoolAcceptsPublicTraffic');
    expect(read('app/apply/actions.ts')).toContain('schoolAcceptsPublicTraffic');
  });

  it('the authenticated request path checks the role too', () => {
    expect(read('server/tenant-context.ts')).toContain('schoolAllowsSignIn');
  });
});
