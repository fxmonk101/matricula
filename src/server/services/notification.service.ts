/**
 * Notification fan-out.
 *
 * No `server-only` guard — same reasoning as the audit service: the seed and
 * scheduled jobs (escalation sweeps) create notifications, and the guard throws
 * outside a React Server Component graph.
 */

import { dbFor, platformDb } from '@/lib/tenant';
import type { NotificationKind } from '@/lib/domain/enums';
import { emails, renderNotificationEmail } from '@/lib/domain/notify-policy';
import { mailIsDeliverable, mailer } from '@/server/email';

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
    // The bell is the record. If it failed there is nothing to email about.
    return;
  }

  /*
   * Email, for the kinds worth it, and NOT AWAITED.
   *
   * A grade posting that notifies four hundred students must not spend four
   * hundred HTTP round trips inside the request that posted the grades. The
   * bell row is already committed and is the durable record; the email is a
   * courtesy about it, exactly as the bell is a courtesy about the action.
   *
   * `void` rather than `await`, and the helper swallows its own failures, so
   * this can never become the reason a grade submission fails.
   */
  if (emails(input.kind) && mailIsDeliverable()) {
    void emailRecipients(input, recipients);
  }
}

/**
 * Notify students, given STUDENT ids — which is what finance, registration and
 * holds all have in hand. Resolves each to the membership that carries the
 * bell, through the user, and only an ACTIVE student membership: a withdrawn
 * account is not told about next term's registration.
 */
export async function notifyStudents(
  schoolId: string,
  studentIds: readonly string[],
  input: Omit<NotifyInput, 'schoolId' | 'membershipIds'>,
): Promise<number> {
  if (studentIds.length === 0) return 0;
  const memberships = await dbFor(schoolId).membership.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      user: { students: { some: { id: { in: [...studentIds] } } } },
    },
    select: { id: true },
  });
  await notify({ ...input, schoolId, membershipIds: memberships.map((m) => m.id) });
  return memberships.length;
}

/** How many messages are in flight at once. */
const EMAIL_CONCURRENCY = 5;

/**
 * Send one notification to everybody who should get it by email.
 *
 * Addresses are read here rather than passed in, because the caller has
 * membership ids and no business assembling a recipient list. Anybody without
 * an email address is skipped silently: a username-only account is normal in
 * this market and is not an error.
 */
async function emailRecipients(input: NotifyInput, recipients: string[]): Promise<void> {
  try {
    const [people, school] = await Promise.all([
      dbFor(input.schoolId).membership.findMany({
        where: { id: { in: recipients }, status: 'ACTIVE' },
        select: { user: { select: { email: true, firstName: true } } },
      }),
      platformDb.school.findUnique({
        where: { id: input.schoolId },
        select: { name: true },
      }),
    ]);

    const targets = people
      .map((m) => m.user)
      .filter((u): u is { email: string; firstName: string } => Boolean(u.email));
    if (targets.length === 0) return;

    const transport = await mailer();
    const base = process.env.APP_URL?.replace(/\/+$/, '') ?? null;
    const url = base && input.href ? `${base}${input.href}` : null;

    /*
     * A small fixed window rather than Promise.all over the lot. Four hundred
     * simultaneous requests is how a provider decides you are abusive, and
     * the 429 that follows loses the messages for everybody.
     */
    for (let i = 0; i < targets.length; i += EMAIL_CONCURRENCY) {
      const slice = targets.slice(i, i + EMAIL_CONCURRENCY);
      await Promise.all(
        slice.map(async (person) => {
          const message = renderNotificationEmail({
            schoolName: school?.name ?? 'Your school',
            recipientName: person.firstName,
            title: input.title,
            body: input.body,
            url,
          });
          const sent = await transport.send({
            to: person.email,
            subject: message.subject,
            body: message.body,
          });
          if (!sent.ok) {
            console.error('[notify] email failed', input.kind, sent.error);
          }
        }),
      );
    }
  } catch (error) {
    console.error('[notify] email fan-out failed', input.kind, error);
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
