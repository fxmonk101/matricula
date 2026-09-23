import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { ROUTE_GUARDS, roleSatisfies } from '@/lib/auth/rbac';
import { NAV_SECTIONS } from '@/lib/domain/navigation';

/*
 * CAN EVERY LECTURER REACH THEIR OWN TEACHING PAGES?
 *
 * This is a tripwire, not a unit test. The bug it was written for was not a
 * wrong function — every function involved was right. It was three layers
 * disagreeing about one list:
 *
 *   · every page under /teaching admitted DEAN and REGISTRAR
 *   · `mayAuthorOffering` trusted DEAN and REGISTRAR
 *   · ROUTE_GUARDS admitted neither
 *
 * The guard runs first, so it won silently. A dean who was the instructor of
 * record for five sections had no nav item and got /forbidden from the URL —
 * their own gradesheet, course content and register unreachable, with nothing
 * in any log to say why.
 *
 * Checking the guard against a hand-written list of roles would just be a
 * fourth copy of the same list. So this checks it against the DATABASE: every
 * person who is actually an instructor of record must be able to open
 * /teaching.
 */

const raw = new PrismaClient();

afterAll(async () => {
  await raw.$disconnect();
});

function guardFor(path: string): readonly string[] | null {
  // Longest prefix wins, as the real resolver does.
  let best: { prefix: string; roles: readonly string[] } | null = null;
  for (const guard of ROUTE_GUARDS) {
    if (path === guard.prefix || path.startsWith(`${guard.prefix}/`)) {
      if (!best || guard.prefix.length > best.prefix.length) best = guard;
    }
  }
  return best?.roles ?? null;
}

describe('the /teaching guard', () => {
  it('admits every role that can hold a section in the seeded data', async () => {
    const roles = guardFor('/teaching');
    expect(roles).not.toBeNull();

    const offerings = await raw.courseOffering.findMany({
      where: { instructorId: { not: null } },
      include: { instructor: true, course: true },
    });

    // No seeded sections is not a pass — it would make this test vacuous.
    expect(offerings.length).toBeGreaterThan(0);

    const lockedOut: string[] = [];
    for (const offering of offerings) {
      const membership = await raw.membership.findFirst({
        where: {
          schoolId: offering.schoolId,
          userId: offering.instructor!.userId,
          status: 'ACTIVE',
        },
        select: { role: true },
      });
      if (!membership) continue;
      if (!roleSatisfies(membership.role as never, roles as never)) {
        lockedOut.push(`${offering.course.code} -> ${membership.role}`);
      }
    }

    expect(
      lockedOut,
      `These lecturers of record cannot open /teaching at all:\n  ${lockedOut.join('\n  ')}`,
    ).toEqual([]);
  });

  it('covers the sub-routes by prefix, so a new one is not left unguarded', () => {
    // /teaching/[id]/attendance and friends must resolve to the same guard
    // rather than falling through to a laxer one.
    for (const sub of ['/teaching/abc', '/teaching/abc/modules', '/teaching/abc/attendance', '/teaching/abc/attendance/def']) {
      expect(guardFor(sub)).toEqual(guardFor('/teaching'));
    }
  });

  it('offers the nav item to every role the guard admits that actually teaches', () => {
    /*
     * The nav and the guard need not be identical — REGISTRAR may administer
     * these pages without teaching, and an empty list in their sidebar would
     * read as a fault. But nobody who teaches should have to know the URL.
     */
    const item = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === '/teaching');
    expect(item).toBeDefined();
    for (const role of ['INSTRUCTOR', 'HOD', 'DEAN']) {
      expect(item!.roles).toContain(role);
    }
  });
});
