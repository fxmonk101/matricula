/**
 * Notification fan-out.
 *
 * No `server-only` guard — same reasoning as the audit service: the seed and
 * scheduled jobs (escalation sweeps) create notifications, and the guard throws
 * outside a React Server Component graph.
 */

import { dbFor } from '@/lib/tenant';
import type { NotificationKind } from '@/lib/domain/enums';

export interface NotifyInput {
  schoolId: string;
  /** Recipients, as MEMBERSHIP ids. Duplicates are collapsed. */
  membershipIds: readonly string[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  /**
   * Never notify this membership — normally the actor. Someone who just did
   * a thing does not need to be told they did it.
   */
  exceptMembershipId?: string | null;
}

/**
 * Fan a notification out to a set of memberships.
 *
 * Deliberately non-throwing, like `recordAudit`. A failed notification must
 * never be the reason a grade submission or a task assignment fails: the
 * operation is the point, the notification is a courtesy about it. Failures go
 * to the server console so monitoring sees them without users being blocked.
 *
 * The trade-off is stated rather than assumed: we accept a possibly-missing
 * bell over a certainly-failed transaction. Where a notification is legally
 * required — a fee demand, say — the caller should write it inside its own
 * transaction rather than use this.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.membershipIds)].filter(
    (id) => id && id !== input.exceptMembershipId,
  );
  if (recipients.length === 0) return;

  try {
    await dbFor(input.schoolId).notification.createMany({
      data: recipients.map((membershipId) => ({
        schoolId: input.schoolId,
        membershipId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
      })),
    });
  } catch (error) {
    console.error('[notify] fan-out failed', input.kind, error);
  }
}

/** Unread count for the bell. */
export async function unreadCount(schoolId: string, membershipId: string): Promise<number> {
  return dbFor(schoolId).notification.count({
    where: { membershipId, readAt: null },
  });
}

export async function listNotifications(
  schoolId: string,
  membershipId: string,
  limit = 30,
) {
  return dbFor(schoolId).notification.findMany({
    where: { membershipId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Mark notifications read.
 *
 * Scoped by `membershipId` as well as by id, so a crafted request cannot mark
 * somebody else's bell read. The tenant client already scopes to the school;
 * this narrows it to the person.
 */
export async function markRead(
  schoolId: string,
  membershipId: string,
  notificationIds?: readonly string[],
): Promise<number> {
  const result = await dbFor(schoolId).notification.updateMany({
    where: {
      membershipId,
      readAt: null,
      ...(notificationIds ? { id: { in: [...notificationIds] } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
