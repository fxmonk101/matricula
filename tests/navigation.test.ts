import { describe, expect, it } from 'vitest';

import { NAV_SECTIONS, PLATFORM_SECTION, visibleSections } from '@/lib/domain/navigation';
import { roleSatisfies, ROUTE_GUARDS, guardForPath } from '@/lib/auth/rbac';
import { ROLES, type AcademicModel, type Role } from '@/lib/domain/enums';

/**
 * These call `visibleSections` — the same function the shell renders from —
 * rather than re-implementing its filter. A test that re-derived the rule would
 * have gone on passing while the shell used `roles.includes(session.role)` and
 * showed an OWNER an empty sidebar, which is exactly the defect that prompted
 * this file.
 */
function hrefsFor(
  role: Role,
  academicModel: AcademicModel = 'HIGHER_ED',
  isPlatformAdmin = false,
): string[] {
  return visibleSections({ role, academicModel, isPlatformAdmin, satisfies: roleSatisfies })
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
          if (guard.platformOnly) continue; // admitted by the claim, not the role
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
      isPlatformAdmin: false,
      satisfies: roleSatisfies,
    })) {
      expect(section.items.length, section.heading).toBeGreaterThan(0);
    }
  });
});

describe('the platform section', () => {
  it('is hidden from every role without the platform claim', () => {
    for (const role of ROLES) {
      expect(hrefsFor(role as Role, 'HIGHER_ED', false)).not.toContain('/admin/platform');
    }
  });

  it('appears for a platform admin, whatever role they hold at their school', () => {
    for (const role of ROLES) {
      expect(
        hrefsFor(role as Role, 'HIGHER_ED', true),
        `platform admin holding ${role}`,
      ).toContain('/admin/platform');
    }
  });

  it('is never declared in the role matrix', () => {
    // If it were, holding a role would be enough to see the vendor console.
    for (const item of allItems) {
      expect(guardForPath(item.href)?.platformOnly ?? false, item.href).toBe(false);
    }
    for (const item of PLATFORM_SECTION.items) {
      expect(guardForPath(item.href)?.platformOnly ?? false, item.href).toBe(true);
      expect(item.roles).toHaveLength(0);
    }
  });

  it('names only roles that exist', () => {
    for (const item of allItems) {
      for (const role of item.roles) {
        expect(ROLES.includes(role), `${item.href} names unknown role ${role}`).toBe(true);
      }
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
