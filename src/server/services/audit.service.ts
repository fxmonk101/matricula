import 'server-only';

import { db } from '@/lib/db';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: unknown;
  ipAddress?: string | null;
}

/**
 * Append to the audit trail.
 *
 * Deliberately non-throwing. An audit write must never be the reason a
 * legitimate registration or payment fails — the operation is the point, the
 * log is the record of it. Failures are surfaced to the server console so they
 * are visible in monitoring without becoming user-facing errors.
 *
 * The trade-off is explicit: we accept the possibility of a missing log line
 * over the certainty of a failed business transaction. Where a regulator
 * requires guaranteed capture, this call moves INSIDE the caller's transaction
 * and this catch is removed.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record entry', input.action, error);
  }
}

export async function listAudit(limit = 100) {
  return db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, lastName: true, email: true, role: true } },
    },
  });
}
