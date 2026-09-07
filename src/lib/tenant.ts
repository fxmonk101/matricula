import { Prisma, PrismaClient } from '@prisma/client';

import { db } from './db';

/**
 * =============================================================================
 * TENANT ISOLATION
 * =============================================================================
 *
 * Every tenant-owned row carries a non-null `schoolId`. This module is the one
 * place that knows how to keep a request inside its own school.
 *
 * HOW IT WORKS
 * ------------
 * `dbFor(schoolId)` returns a Prisma client extended with a query hook that,
 * for every tenant-owned model, injects the tenant predicate:
 *
 *   reads / updates / deletes  ->  args.where.schoolId  = schoolId
 *   creates                    ->  args.data.schoolId   = schoolId
 *
 * All four behaviours below were verified empirically against Prisma 6.19
 * rather than assumed, because the whole design rests on them:
 *
 *   1. `extendedWhereUnique` is on, so `findUnique({ where: { id, schoolId } })`
 *      is legal. Prisma has allowed a non-unique field beside a unique one
 *      since v5, which is what lets this extension scope `findUnique` at all.
 *   2. A cross-tenant `findUnique` returns NULL rather than the row.
 *   3. A cross-tenant `update` / `delete` THROWS (P2025, record not found)
 *      rather than mutating another school's data. Fail-closed.
 *   4. The extension survives into interactive `$transaction(async (tx) => …)`,
 *      which every service body runs inside. Without this, scoping would be
 *      silently lost in exactly the code that matters most.
 *
 * `tests/tenant.test.ts` pins all four so a Prisma upgrade cannot quietly
 * remove one.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is defence in depth, not the security boundary — the same stance the
 * codebase takes on middleware. Two gaps are real and deliberate:
 *
 *   · NESTED WRITES are not walked. `invoice.create({ data: { lines: { create:
 *     [...] } } })` scopes the invoice but not the lines. Services therefore
 *     set `schoolId` explicitly on nested rows; `NOT NULL` turns any omission
 *     into a loud failure instead of an unscoped row.
 *   · `connect: { id }` cannot be validated to belong to the tenant. Services
 *     resolve the target through `dbFor()` first.
 *
 * In production on Postgres, ROW-LEVEL SECURITY is the actual guarantee:
 *
 *   ALTER TABLE students ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY tenant_isolation ON students
 *     USING (school_id = current_setting('app.current_school', true));
 *
 * with the GUC set per transaction. That closes both gaps at the storage layer.
 * SQLite has no RLS, so development relies on this extension alone — which is
 * why the cross-tenant test matrix exists.
 */

// -----------------------------------------------------------------------------
// Which models are tenant-owned
// -----------------------------------------------------------------------------

/**
 * Models carrying a non-null `schoolId`.
 *
 * Derived from the Prisma DMMF rather than hand-listed: a hand-written list is
 * exactly the kind of thing that goes stale the day someone adds a model, and
 * a model missing from it would silently lose all tenant scoping.
 */
const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'schoolId' && f.isRequired && !f.relationName))
    .map((m) => m.name),
);

/**
 * Models with NO tenant column, and therefore never scoped.
 *
 * Note what is absent: `Membership`, `SchoolConfig`, `OrgUnit` and
 * `IdentityProvider` all carry a required `schoolId` and ARE tenant-scoped —
 * a scoped client must not be able to read another school's org chart or
 * grading policy. The one place they are read across tenants is sign-in, which
 * has to find a person's memberships before any school is chosen; that path
 * deliberately uses `platformDb`.
 *
 * `AuditLog` sits here because its `schoolId` is nullable: a platform operator
 * provisioning a school writes an entry belonging to no school.
 */
export const PLATFORM_MODELS = ['School', 'User', 'PlatformAdmin', 'AuditLog'] as const;

export function isTenantModel(model: string | undefined): boolean {
  return !!model && TENANT_MODELS.has(model);
}

/** Exposed for the test matrix, which iterates every tenant model. */
export function tenantModelNames(): string[] {
  return [...TENANT_MODELS].sort();
}

// -----------------------------------------------------------------------------
// The scoping extension
// -----------------------------------------------------------------------------

/** Operations whose `where` clause selects the rows acted upon. */
const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations that create rows and therefore need `schoolId` stamped on. */
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type AnyArgs = Record<string, unknown>;

function stampData(data: unknown, schoolId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => stampData(row, schoolId));
  if (data && typeof data === 'object') {
    const row = data as AnyArgs;
    // An explicit schoolId is honoured, not overwritten: the seed and the
    // platform-provisioning path legitimately set it themselves.
    return 'schoolId' in row ? row : { ...row, schoolId };
  }
  return data;
}

export function tenantExtension(schoolId: string) {
  return Prisma.defineExtension({
    name: `tenant-scope:${schoolId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) return query(args);

          const next = { ...(args as AnyArgs) };

          if (WHERE_OPS.has(operation)) {
            const where = (next.where ?? {}) as AnyArgs;
            // Never override an explicit schoolId — a platform report may be
            // deliberately asking about one school through a scoped client.
            if (!('schoolId' in where)) {
              next.where = { ...where, schoolId };
            }
          }

          if (CREATE_OPS.has(operation) && 'data' in next) {
            next.data = stampData(next.data, schoolId);
          }

          if (operation === 'upsert') {
            const where = (next.where ?? {}) as AnyArgs;
            if (!('schoolId' in where)) next.where = { ...where, schoolId };
            if ('create' in next) next.create = stampData(next.create, schoolId);
          }

          return query(next);
        },
      },
    },
  });
}

// -----------------------------------------------------------------------------
// Client cache
// -----------------------------------------------------------------------------

export type TenantClient = ReturnType<typeof buildClient>;

function buildClient(schoolId: string) {
  return db.$extends(tenantExtension(schoolId));
}

/**
 * Extended clients are cached per school.
 *
 * `$extends` is not free — rebuilding a client on every call would allocate a
 * new proxy per query on a busy page. The cache is process-local and unbounded,
 * which is fine: the key space is the number of schools, not the number of
 * requests.
 */
const clients = new Map<string, TenantClient>();

/**
 * The tenant-scoped database client. Every request-path query should go
 * through this rather than the bare `db` export.
 *
 * Safe to call outside a request — the seed and maintenance scripts use it.
 */
export function dbFor(schoolId: string): TenantClient {
  if (!schoolId) {
    throw new TenantError('dbFor() requires a schoolId. Refusing to return an unscoped client.');
  }
  let client = clients.get(schoolId);
  if (!client) {
    client = buildClient(schoolId);
    clients.set(schoolId, client);
  }
  return client;
}

/** The unscoped client, for platform-owned models only. Named to be greppable. */
export const platformDb: PrismaClient = db;

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantError';
  }
}

/**
 * Guard for a row loaded through an unscoped path. Prefer `dbFor()`; this is
 * for the seams where that is not possible, such as resolving a `connect`
 * target before a nested write.
 */
export function assertSameTenant(
  row: { schoolId?: string | null } | null | undefined,
  schoolId: string,
  what = 'record',
): void {
  if (!row) throw new TenantError(`${what} not found.`);
  if (row.schoolId !== schoolId) {
    throw new TenantError(`${what} belongs to another school.`);
  }
}
