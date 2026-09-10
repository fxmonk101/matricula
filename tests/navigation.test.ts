import { describe, expect, it } from 'vitest';

import { NAV_SECTIONS, visibleSections } from '@/lib/domain/navigation';
import { roleSatisfies, ROUTE_GUARDS, guardForPath } from '@/lib/auth/rbac';
import { ROLES, type AcademicModel, type Role } from '@/lib/domain/enums';

/**
 * These call `visibleSections` — the same function the shell renders from —
 * rather than re-implementing its filter. A test that re-derived the rule would
 * have gone on passing while the shell used `roles.includes(session.role)` and
 * showed an OWNER an empty sidebar, which is exactly the defect that prompted
 * this file.
 */
function hrefsFor(role: Role, academicModel: AcademicModel = 'HIGHER_ED'): string[] {
  return visibleSections({ role, academicModel, satisfies: roleSatisfies })
    .flatMap((s) => s.items)
    .map((i) => i.href);
}

const allItems = NAV_SECTIONS.flatMap((s) => s.items);

describe('sidebar navigation', () => {
  it('shows an OWNER at least everything an ADMIN sees', () => {
    const admin = hrefsFor('ADMIN');
    const owner = new Set(hrefsFor('OWNER'));
    expect(admin.length).toBeGreaterThan(0);
    for (const href of admin) {
      expect(owner.has(href), `OWNER cannot see ${href}, which ADMIN can`).toBe(true);
    }
  });

  it('links only to paths the role is actually permitted to open', () => {
    // A link that lands on /forbidden is worse than no link: the user believes
    // the feature exists and that they have been wrongly refused.
    for (const role of ROLES) {
      for (const model of ['HIGHER_ED', 'K12'] as AcademicModel[]) {
        for (const href of hrefsFor(role as Role, model)) {
          const guard = guardForPath(href);
          if (!guard) continue;
          expect(
            roleSatisfies(role as Role, guard.roles),
            `${role} is offered ${href}, which ${role} cannot open`,
          ).toBe(true);
        }
      }
    }
  });

  it('gives every role somewhere to go', () => {
    // An empty sidebar reads as a broken account rather than a limited one.
    for (const role of ROLES) {
      const higherEd = hrefsFor(role as Role, 'HIGHER_ED');
      const k12 = hrefsFor(role as Role, 'K12');
      expect(higherEd.length, `${role} sees nothing at a university`).toBeGreaterThan(0);
      expect(k12.length, `${role} sees nothing at a K-12 school`).toBeGreaterThan(0);
    }
  });

  it('speaks the right vocabulary for the academic model', () => {
    // A K-12 school seeing "Sections", or a university seeing "Classes", is the
    // fastest way to make a product feel built for somebody else.
    expect(hrefsFor('ADMIN', 'HIGHER_ED')).toContain('/offerings');
    expect(hrefsFor('ADMIN', 'HIGHER_ED')).not.toContain('/classes');
    expect(hrefsFor('ADMIN', 'K12')).toContain('/classes');
    expect(hrefsFor('ADMIN', 'K12')).not.toContain('/offerings');
  });

  it('drops empty sections rather than rendering a bare heading', () => {
    for (const section of visibleSections({
      role: 'APPLICANT',
      academicModel: 'HIGHER_ED',
      satisfies: roleSatisfies,
    })) {
      expect(section.items.length, section.heading).toBeGreaterThan(0);
    }
  });
});

describe('the vendor console is not in the school sidebar', () => {
  /*
   * The console moved to its own portal at /operator, behind its own cookie and
   * its own sign-in page. A school's sidebar therefore contains nothing about
   * the vendor at all — somebody signed in to a university is a member of that
   * university and nothing else, whatever they may also be elsewhere.
   */
  it('offers no route into the operator console, for any role', () => {
    for (const role of ROLES) {
      for (const model of ['HIGHER_ED', 'K12'] as AcademicModel[]) {
        const hrefs = hrefsFor(role as Role, model);
        for (const href of hrefs) {
          expect(href.startsWith('/operator'), `${role} is offered ${href}`).toBe(false);
        }
        expect(hrefs).not.toContain('/admin/platform');
      }
    }
  });

  it('leaves the console outside the school route guards entirely', () => {
    // Not listed with an empty role array and a flag — absent. A table cannot
    // wrongly admit a route it does not contain.
    expect(guardForPath('/operator')).toBeNull();
    expect(guardForPath('/operator/operators')).toBeNull();
  });

  it('names only roles that exist', () => {
    for (const item of allItems) {
      for (const role of item.roles) {
        expect(ROLES.includes(role), `${item.href} names unknown role ${role}`).toBe(true);
      }
    }
  });

  it('gives every sidebar item a real role list', () => {
    // The empty-role escape hatch existed only for the platform section. With
    // that gone, an item naming no roles would be invisible to everybody.
    for (const item of allItems) {
      expect(item.roles.length, `${item.href} names no roles`).toBeGreaterThan(0);
    }
  });
});

describe('OWNER inherits ADMIN', () => {
  it('passes every route guard that admits an ADMIN', () => {
    for (const guard of ROUTE_GUARDS.filter((g) => g.roles.includes('ADMIN'))) {
      expect(roleSatisfies('OWNER', guard.roles), guard.prefix).toBe(true);
    }
  });

  it('does not make an ADMIN into an OWNER', () => {
    // The inheritance is one-way. An owner-only route must stay owner-only.
    expect(roleSatisfies('ADMIN', ['OWNER'])).toBe(false);
  });

  it('does not admit an OWNER to a guard that names neither role', () => {
    expect(roleSatisfies('OWNER', ['STUDENT'])).toBe(false);
    expect(roleSatisfies('OWNER', [])).toBe(false);
  });
});
