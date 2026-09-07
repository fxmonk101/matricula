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
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
