import 'server-only';

import { platformDb } from '@/lib/tenant';

export interface AuditInput {
  /**
   * The school the action belongs to. NULL is legitimate and meaningful: a
   * platform operator provisioning a school, or acting across tenants, produces
   * an entry that belongs to no single school.
   */
  schoolId?: string | null;
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
 * Writes through the UNSCOPED client on purpose. The audit log is
 * platform-owned with a nullable `schoolId`, so a platform admin acting across
 * tenants still records a correct row — a tenant-scoped client would stamp the
 * wrong school on it, or refuse the null.
 *
 * Deliberately non-throwing. An audit write must never be the reason a
 * legitimate registration or payment fails — the operation is the point, the
 * log is the record of it. Failures surface on the server console so they are
 * visible in monitoring without becoming user-facing errors.
 *
 * The trade-off is explicit: we accept the possibility of a missing log line
 * over the certainty of a failed business transaction. Where a regulator
 * requires guaranteed capture, this call moves INSIDE the caller's transaction
 * and this catch is removed.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await platformDb.auditLog.create({
      data: {
        schoolId: input.schoolId ?? null,
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

/** Audit entries for one school, newest first. */
export async function listAudit(schoolId: string, limit = 100) {
  return platformDb.auditLog.findMany({
    where: { schoolId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

/** Cross-tenant view, for platform operators only. Callers must gate on `pa`. */
export async function listPlatformAudit(limit = 200) {
  return platformDb.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}
