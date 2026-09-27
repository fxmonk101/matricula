import { describe, expect, it } from 'vitest';

import { NOTIFICATION_KINDS } from '@/lib/domain/enums';
import { channelFor, emails, renderNotificationEmail } from '@/lib/domain/notify-policy';

/*
 * Which notifications leave the building.
 *
 * Both directions cost something real. Eleven emails because somebody
 * commented on a task gets the sender filtered, and then the one saying
 * results are posted is never seen — over-notifying destroys the channel you
 * need for the message that matters. Under-notifying means a fee demand nobody
 * sees because they do not sit in the portal all day.
 */

describe('the policy', () => {
  it('has an answer for every kind that exists', () => {
    // A kind added without a decision would otherwise inherit one silently.
    for (const kind of NOTIFICATION_KINDS) {
      expect(['BELL_ONLY', 'BELL_AND_EMAIL']).toContain(channelFor(kind));
    }
  });

  it('defaults an UNKNOWN kind to the bell alone', () => {
    /*
     * The safe direction, and the one that matters when somebody adds a kind
     * and forgets this file: a missing email is a nuisance, four hundred
     * unwanted ones are a burned channel.
     */
    expect(channelFor('SOMETHING_NEW' as never)).toBe('BELL_ONLY');
  });

  it('does not email ordinary task traffic', () => {
    expect(emails('TASK_ASSIGNED')).toBe(false);
    expect(emails('TASK_COMMENTED')).toBe(false);
    expect(emails('TASK_DUE_SOON')).toBe(false);
  });

  it('DOES email the things somebody is waiting for', () => {
    expect(emails('GRADES_POSTED')).toBe(true);
    expect(emails('APPLICATION_DECIDED')).toBe(true);
    expect(emails('INVOICE_ISSUED')).toBe(true);
  });

  it('emails an overdue task, which by definition was missed in the bell', () => {
    expect(emails('TASK_OVERDUE')).toBe(true);
    expect(emails('TASK_ESCALATED')).toBe(true);
  });

  it('emails a scheduled class, which is useless discovered afterwards', () => {
    expect(emails('MEETING_SCHEDULED')).toBe(true);
  });

  it('emails whatever changes whether a student can register', () => {
    expect(emails('HOLD_PLACED')).toBe(true);
    expect(emails('HOLD_RELEASED')).toBe(true);
    expect(emails('REGISTRATION_OPEN')).toBe(true);
  });
});

describe('the message', () => {
  const base = {
    schoolName: 'Golden Eagles University',
    recipientName: 'Ada',
    title: 'Your results for CSC301 have been posted',
  };

  it('names the school in the subject', () => {
    // Somebody may hold accounts at more than one school, and the subject is
    // all they see in a list.
    const message = renderNotificationEmail(base);
    expect(message.subject).toContain('Golden Eagles University');
    expect(message.subject).toContain('CSC301');
  });

  it('greets by name and carries the title', () => {
    const message = renderNotificationEmail(base);
    expect(message.body).toContain('Hello Ada,');
    expect(message.body).toContain(base.title);
  });

  it('copes with a missing name rather than greeting an empty string', () => {
    expect(renderNotificationEmail({ ...base, recipientName: '  ' }).body).toContain('Hello there,');
  });

  it('includes a link only when there is one', () => {
    expect(renderNotificationEmail(base).body).not.toContain('http');
    expect(
      renderNotificationEmail({ ...base, url: 'https://x.test/me' }).body,
    ).toContain('https://x.test/me');
  });

  it('says replies are not read', () => {
    // The commonest question about an automated message, answered in it.
    expect(renderNotificationEmail(base).body).toMatch(/[Rr]eplies .* not read/);
  });

  it('is plain text with no markup', () => {
    const message = renderNotificationEmail({ ...base, body: 'Some detail.' });
    expect(message.body).not.toMatch(/<[a-z]/i);
  });
});
