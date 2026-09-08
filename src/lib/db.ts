import { PrismaClient } from '@prisma/client';

/**
 * A single PrismaClient per process.
 *
 * Next.js dev mode hot-reloads modules on every edit; without this global cache
 * each reload would construct a new client and open a new connection pool,
 * exhausting the database's connection limit within a few minutes of editing.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    /**
     * Interactive-transaction limits, raised from the 2s/5s defaults.
     *
     * Several services deliberately fire background writes without awaiting
     * them — `recordAudit` and `notify` are courtesies about an operation and
     * must never be able to fail the operation itself. In a request that is
     * fine: one user, a handful of writes.
     *
     * In a BATCH — the seed, or an end-of-term job — those un-awaited writes
     * pile up while the next transaction is opening. SQLite serialises writes
     * at the file level, so the backlog holds the write lock and a transaction
     * that would take milliseconds sits waiting, then dies on the 5s default.
     * That is exactly how the seed failed: `createTask` in a loop of 30, each
     * trailing an unawaited notification, until one transaction expired
     * mid-flight and left a task with no CREATED event.
     *
     * Postgres does not have this problem — row-level locking and MVCC mean
     * concurrent writers do not queue behind one another — so these limits cost
     * production nothing and buy the development database enough room to
     * absorb a burst. They are a ceiling, not a target: a transaction that
     * genuinely needs 15 seconds is a transaction doing too much.
     */
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
