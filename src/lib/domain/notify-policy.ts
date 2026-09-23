import type { NotificationKind } from './enums';

/**
 * =============================================================================
 * WHICH NOTIFICATIONS LEAVE THE BUILDING
 * =============================================================================
 *
 * Everything reaches the bell. Only some things are worth an email, and getting
 * that wrong in either direction costs the product something real:
 *
 *   TOO MANY. A student who receives eleven emails because somebody commented
 *   on a task filters the sender, and then misses the one that said their
 *   examination results were posted. Over-notifying does not merely annoy —
 *   it destroys the channel you need for the message that matters.
 *
 *   TOO FEW. A fee demand or a decision on an application is something people
 *   are waiting for and will not see by chance, because they do not sit in the
 *   portal all day.
 *
 * So each kind is listed here with the reason for its answer, and the default
 * for a new kind is DEFERRED rather than "email it": adding a kind should not
 * silently start sending mail to four hundred people.
 */

export type DeliveryChannel = 'BELL_ONLY' | 'BELL_AND_EMAIL';

const POLICY: Record<NotificationKind, DeliveryChannel> = {
  /*
   * Tasks are workplace flow. Somebody who is assigned four tasks in a morning
   * is working, not being notified, and their inbox is not where they track
   * them — /tasks is.
   */
  TASK_ASSIGNED: 'BELL_ONLY',
  TASK_DUE_SOON: 'BELL_ONLY',
  TASK_COMMENTED: 'BELL_ONLY',
  TASK_COMPLETED: 'BELL_ONLY',

  /*
   * These two are the exception among tasks: an overdue or escalated item has
   * already failed to be noticed in the bell, which is precisely why it is
   * overdue. Sending it somewhere else is the whole point of the escalation.
   */
  TASK_OVERDUE: 'BELL_AND_EMAIL',
  TASK_ESCALATED: 'BELL_AND_EMAIL',

  /* Waited for, consequential, and not discovered by chance. */
  GRADES_POSTED: 'BELL_AND_EMAIL',
  APPLICATION_DECIDED: 'BELL_AND_EMAIL',
  INVOICE_ISSUED: 'BELL_AND_EMAIL',

  /* Deliberate, addressed and rare — somebody chose to send it. */
  ANNOUNCEMENT: 'BELL_AND_EMAIL',

  /*
   * A class with a time on it, which is useless discovered afterwards. This is
   * the one where the bell alone genuinely fails: the notification is about
   * something that happens at 09:00 tomorrow.
   */
  MEETING_SCHEDULED: 'BELL_AND_EMAIL',
};

export function channelFor(kind: NotificationKind): DeliveryChannel {
  // A kind that is not listed gets the bell only. The safe direction: a missing
  // email is a nuisance, four hundred unwanted ones are a burned channel.
  return POLICY[kind] ?? 'BELL_ONLY';
}

export function emails(kind: NotificationKind): boolean {
  return channelFor(kind) === 'BELL_AND_EMAIL';
}

/**
 * The plain-text body of a notification email.
 *
 * Kept here, pure, so the wording is testable and so it cannot accidentally
 * carry anything the notification row does not already carry. `href` is made
 * absolute by the caller, which is the only part that needs to know the
 * deployment's own address.
 */
export function renderNotificationEmail(input: {
  schoolName: string;
  recipientName: string;
  title: string;
  body?: string | null;
  url?: string | null;
}): { subject: string; body: string } {
  const lines = [
    `Hello ${input.recipientName.trim() || 'there'},`,
    '',
    input.title,
  ];

  if (input.body?.trim()) lines.push('', input.body.trim());
  if (input.url) lines.push('', input.url);

  lines.push(
    '',
    '—',
    input.schoolName,
    '',
    // Said plainly, because the commonest question about an automated message
    // is whether replying to it does anything.
    'This message was sent automatically. Replies to it are not read.',
  );

  return {
    // The school's name in the subject, because somebody may hold accounts at
    // more than one and the subject is all they see in a list.
    subject: `${input.title} — ${input.schoolName}`,
    body: lines.join('\n'),
  };
}
