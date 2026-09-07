import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { dbFor, isTenantModel, tenantModelNames, assertSameTenant, TenantError } from '@/lib/tenant';

/**
 * =============================================================================
 * CROSS-TENANT ISOLATION
 * =============================================================================
 *
 * A cross-tenant leak in a school platform is catastrophic and silent: nobody
 * notices that one school can read another's students until someone does. So
 * this suite does not test a happy path — it tries to break out of a tenant
 * and asserts that it cannot.
 *
 * It runs against the real development database and cleans up after itself.
 * These are integration tests by necessity: the behaviour under test is
 * Prisma's, not ours, and mocking Prisma would test the mock.
 *
 * The four Prisma behaviours the design depends on are pinned here so a client
 * upgrade that removes one fails loudly rather than quietly opening a hole.
 */

const raw = new PrismaClient();

let schoolA = '';
let schoolB = '';
let facultyA = '';
let facultyB = '';
const SUFFIX = `test-${Date.now()}`;

beforeAll(async () => {
  const a = await raw.school.create({
    data: { slug: `a-${SUFFIX}`, code: `A${Date.now() % 100000}`, name: 'Tenant A', shortName: 'A' },
  });
  const b = await raw.school.create({
    data: { slug: `b-${SUFFIX}`, code: `B${Date.now() % 100000}`, name: 'Tenant B', shortName: 'B' },
  });
  schoolA = a.id;
  schoolB = b.id;

  facultyA = (await raw.faculty.create({ data: { schoolId: schoolA, code: 'SCI', name: 'Sciences A' } })).id;
  facultyB = (await raw.faculty.create({ data: { schoolId: schoolB, code: 'SCI', name: 'Sciences B' } })).id;
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: { in: [schoolA, schoolB] } } });
  await raw.$disconnect();
});

describe('tenant model registry', () => {
  it('is derived from the schema, not hand-listed', () => {
    const models = tenantModelNames();
    // A hand-written list goes stale the day someone adds a model; deriving it
    // from the DMMF means a new tenant model is scoped the moment it exists.
    expect(models).toContain('Student');
    expect(models).toContain('Invoice');
    expect(models).toContain('Enrollment');
    expect(models.length).toBeGreaterThan(20);
  });

  it('excludes models with no tenant column', () => {
    // AuditLog is here because its schoolId is nullable — a platform operator
    // provisioning a school writes an entry belonging to no school.
    for (const m of ['School', 'User', 'PlatformAdmin', 'AuditLog']) {
      expect(isTenantModel(m)).toBe(false);
    }
  });

  it('scopes the tenant-owned side of the platform tables', () => {
    // Membership, SchoolConfig, OrgUnit and IdentityProvider each carry a
    // required schoolId, so a scoped client must not see another school's org
    // chart or grading policy. Sign-in reads memberships across schools
    // through the unscoped client on purpose.
    for (const m of ['Membership', 'SchoolConfig', 'OrgUnit', 'IdentityProvider']) {
      expect(isTenantModel(m)).toBe(true);
    }
  });
});

describe('reads cannot cross the tenant boundary', () => {
  it('findMany returns only this tenant’s rows', async () => {
    const rows = await dbFor(schoolA).faculty.findMany();
    expect(rows.map((r) => r.id)).toEqual([facultyA]);
    expect(rows.every((r) => r.schoolId === schoolA)).toBe(true);
  });

  it('findUnique on another tenant’s id returns null', async () => {
    // The row exists and the id is correct — it is the tenant predicate that
    // hides it. This is the single most important assertion in the file.
    expect(await dbFor(schoolA).faculty.findUnique({ where: { id: facultyB } })).toBeNull();
    expect(await dbFor(schoolB).faculty.findUnique({ where: { id: facultyA } })).toBeNull();
  });

  it('findFirst on another tenant’s id returns null', async () => {
    expect(await dbFor(schoolA).faculty.findFirst({ where: { id: facultyB } })).toBeNull();
  });

  it('count and groupBy see only this tenant', async () => {
    expect(await dbFor(schoolA).faculty.count()).toBe(1);
    const grouped = await dbFor(schoolA).faculty.groupBy({ by: ['schoolId'], _count: { _all: true } });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].schoolId).toBe(schoolA);
  });

  it('an unscoped client still sees both — proving the scoping is what hides them', async () => {
    const both = await raw.faculty.findMany({ where: { id: { in: [facultyA, facultyB] } } });
    expect(both).toHaveLength(2);
  });
});

describe('writes cannot cross the tenant boundary', () => {
  it('create stamps the acting tenant', async () => {
    // Cast because the generated types require schoolId, while the whole
    // point here is that the extension supplies it when the caller omits it.
    const create = dbFor(schoolA).faculty.create as unknown as (
      args: unknown,
    ) => Promise<{ id: string; schoolId: string }>;
    const created = await create({ data: { code: `ENG-${SUFFIX}`, name: 'Engineering A' } });
    expect(created.schoolId).toBe(schoolA);
    await raw.faculty.delete({ where: { id: created.id } });
  });

  it('update of another tenant’s row throws and changes nothing', async () => {
    // Fail-closed: Prisma cannot find a row matching (id, schoolId), so it
    // raises rather than silently updating zero rows.
    await expect(
      dbFor(schoolA).faculty.update({ where: { id: facultyB }, data: { name: 'HACKED' } }),
    ).rejects.toThrow();

    const untouched = await raw.faculty.findUnique({ where: { id: facultyB } });
    expect(untouched?.name).toBe('Sciences B');
  });

  it('delete of another tenant’s row throws and deletes nothing', async () => {
    await expect(
      dbFor(schoolA).faculty.delete({ where: { id: facultyB } }),
    ).rejects.toThrow();
    expect(await raw.faculty.findUnique({ where: { id: facultyB } })).not.toBeNull();
  });

  it('updateMany cannot reach another tenant', async () => {
    const result = await dbFor(schoolA).faculty.updateMany({
      where: { id: facultyB },
      data: { name: 'HACKED' },
    });
    expect(result.count).toBe(0);
    const untouched = await raw.faculty.findUnique({ where: { id: facultyB } });
    expect(untouched?.name).toBe('Sciences B');
  });

  it('deleteMany cannot reach another tenant', async () => {
    const result = await dbFor(schoolA).faculty.deleteMany({ where: { id: facultyB } });
    expect(result.count).toBe(0);
    expect(await raw.faculty.findUnique({ where: { id: facultyB } })).not.toBeNull();
  });
});

describe('scoping survives an interactive transaction', () => {
  it('the callback client is still tenant-scoped', async () => {
    // Every service body runs inside `db.$transaction(async (tx) => …)`. If the
    // extension did not propagate into `tx`, tenant scoping would be lost in
    // exactly the code that matters most, and every other test here would be
    // reassuring but irrelevant.
    const seen = await dbFor(schoolA).$transaction(async (tx) => {
      const all = await tx.faculty.findMany();
      const other = await tx.faculty.findUnique({ where: { id: facultyB } });
      return { count: all.length, other };
    });
    expect(seen.count).toBe(1);
    expect(seen.other).toBeNull();
  });
});

describe('platform-owned models are not scoped', () => {
  it('School itself is reachable through a scoped client', async () => {
    // School carries no schoolId, so the extension must leave it alone —
    // otherwise a tenant could never load its own school row.
    const school = await dbFor(schoolA).school.findUnique({ where: { id: schoolA } });
    expect(school?.id).toBe(schoolA);
  });
});

describe('assertSameTenant', () => {
  it('accepts a row from this tenant', () => {
    expect(() => assertSameTenant({ schoolId: schoolA }, schoolA)).not.toThrow();
  });

  it('rejects a row from another tenant', () => {
    expect(() => assertSameTenant({ schoolId: schoolB }, schoolA, 'Course')).toThrow(TenantError);
  });

  it('rejects a missing row', () => {
    expect(() => assertSameTenant(null, schoolA)).toThrow(TenantError);
  });
});

describe('dbFor', () => {
  it('refuses to build an unscoped client', () => {
    expect(() => dbFor('')).toThrow(TenantError);
  });

  it('returns the same client for the same school', () => {
    expect(dbFor(schoolA)).toBe(dbFor(schoolA));
    expect(dbFor(schoolA)).not.toBe(dbFor(schoolB));
  });
});
