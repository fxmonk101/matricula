import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { __setMailer, type EmailMessage } from '@/server/email';
import {
  cancelPendingChange,
  confirmAccountChange,
  loadProfile,
  pendingChangeFor,
  requestPasswordChange,
  saveProfile,
} from '@/server/services/profile.service';

/**
 * =============================================================================
 * CHANGING YOUR OWN PASSWORD, CONFIRMED BY EMAIL
 * =============================================================================
 *
 * The parts worth testing against a real database are the ones where getting it
 * wrong is silent and severe: a password that applies BEFORE it is confirmed, a
 * token that still works after it has been used, and a link that survives past
 * its expiry. None of those show up in a unit test of the validator.
 */

const raw = new PrismaClient();
const SUFFIX = `profile-${Date.now()}`;

let withEmail = '';
let withoutEmail = '';

const ORIGINAL = 'the-original-password';
const NEXT = 'a-completely-new-password';

/** Captures what the mailer was asked to send, and hands back the link. */
const sent: EmailMessage[] = [];
function lastLink(): string {
  const body = sent[sent.length - 1]?.body ?? '';
  return body.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';
}

beforeAll(async () => {
  __setMailer({
    name: 'test',
    async send(message) {
      sent.push(message);
      return { ok: true, via: 'test' };
    },
  });

  const hash = await hashPassword(ORIGINAL);

  withEmail = (
    await raw.user.create({
      data: {
        email: `has-mail-${SUFFIX}@example.test`,
        username: `has.mail.${Date.now()}`,
        firstName: 'Adaeze',
        lastName: 'Okafor',
        passwordHash: hash,
      },
    })
  ).id;

  withoutEmail = (
    await raw.user.create({
      data: {
        // No email at all, which is an ordinary account in this system.
        username: `no.mail.${Date.now()}`,
        firstName: 'Obinna',
        lastName: 'Eze',
        passwordHash: hash,
      },
    })
  ).id;
});

afterAll(async () => {
  __setMailer(null);
  await raw.user.deleteMany({ where: { id: { in: [withEmail, withoutEmail] } } });
  await raw.$disconnect();
});

describe('an account WITH an email address', () => {
  it('refuses a change when the current password is wrong', async () => {
    const result = await requestPasswordChange({
      userId: withEmail,
      origin: 'http://localhost:3000',
      draft: {
        currentPassword: 'not-the-password',
        newPassword: NEXT,
        confirmPassword: NEXT,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not your current password/);
    expect(await raw.accountChangeRequest.count({ where: { userId: withEmail } })).toBe(0);
  });

  it('parks the change and emails a link, WITHOUT applying it', async () => {
    const result = await requestPasswordChange({
      userId: withEmail,
      origin: 'http://localhost:3000',
      draft: { currentPassword: ORIGINAL, newPassword: NEXT, confirmPassword: NEXT },
    });
    expect(result.ok).toBe(true);
    expect(result.pending).toBe(true);
    expect(sent).toHaveLength(1);

    // THE POINT OF THE WHOLE FLOW: the old password still works.
    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(ORIGINAL, user.passwordHash)).toBe(true);
    expect(await verifyPassword(NEXT, user.passwordHash)).toBe(false);
  });

  it('never stores the new password in the clear while it waits', async () => {
    const request = await raw.accountChangeRequest.findFirstOrThrow({
      where: { userId: withEmail },
    });
    expect(request.payload).not.toContain(NEXT);
    expect(request.payload.startsWith('$2')).toBe(true);
  });

  it('stores the token only as a hash, so the row is not the key', async () => {
    const token = lastLink();
    expect(token.length).toBeGreaterThan(20);
    const request = await raw.accountChangeRequest.findFirstOrThrow({
      where: { userId: withEmail },
    });
    expect(request.tokenHash).not.toBe(token);
    expect(request.tokenHash).toHaveLength(64);
  });

  it('refuses a token that was never issued, without saying why', async () => {
    const result = await confirmAccountChange({ token: 'not-a-real-token' });
    expect(result.ok).toBe(false);
    // Expired, used and never-existed read identically on purpose: anything
    // else is a free oracle over the token space.
    expect(result.message).toMatch(/not valid/);
  });

  it('applies the change when the link is opened', async () => {
    const result = await confirmAccountChange({ token: lastLink() });
    expect(result.ok).toBe(true);

    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(NEXT, user.passwordHash)).toBe(true);
    expect(await verifyPassword(ORIGINAL, user.passwordHash)).toBe(false);
  });

  it('REFUSES THE SAME LINK A SECOND TIME', async () => {
    // A confirmation link that keeps working is a permanent key to the account
    // sitting in somebody's inbox.
    const result = await confirmAccountChange({ token: lastLink() });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not valid/);
  });

  it('refuses a link that has expired', async () => {
    await requestPasswordChange({
      userId: withEmail,
      origin: 'http://localhost:3000',
      draft: {
        currentPassword: NEXT,
        newPassword: 'yet-another-password',
        confirmPassword: 'yet-another-password',
      },
    });

    const token = lastLink();
    const twoHoursOn = new Date(Date.now() + 2 * 60 * 60_000);
    const result = await confirmAccountChange({ token, now: twoHoursOn });
    expect(result.ok).toBe(false);

    // And the expired attempt must not have changed anything.
    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(NEXT, user.passwordHash)).toBe(true);
  });

  it('keeps only one live request, so links do not accumulate', async () => {
    for (let i = 0; i < 3; i += 1) {
      await requestPasswordChange({
        userId: withEmail,
        origin: 'http://localhost:3000',
        draft: {
          currentPassword: NEXT,
          newPassword: `rotating-password-${i}`,
          confirmPassword: `rotating-password-${i}`,
        },
      });
    }
    const live = await raw.accountChangeRequest.count({
      where: { userId: withEmail, consumedAt: null },
    });
    expect(live).toBe(1);
  });

  it('can be cancelled, leaving the current password alone', async () => {
    expect(await pendingChangeFor(withEmail)).not.toBeNull();

    const cancelled = await cancelPendingChange(withEmail);
    expect(cancelled.ok).toBe(true);
    expect(await pendingChangeFor(withEmail)).toBeNull();

    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(NEXT, user.passwordHash)).toBe(true);
  });
});

describe('an account with NO email address', () => {
  it('changes the password immediately, and says so', async () => {
    /*
     * Requiring email confirmation unconditionally would lock every account
     * without an address out of ever changing its password — and in this system
     * that is most student accounts.
     */
    const before = sent.length;
    const result = await requestPasswordChange({
      userId: withoutEmail,
      origin: 'http://localhost:3000',
      draft: { currentPassword: ORIGINAL, newPassword: NEXT, confirmPassword: NEXT },
    });

    expect(result.ok).toBe(true);
    expect(result.pending).toBeUndefined();
    expect(result.message).toMatch(/no email address/);
    // Nothing was sent, because there was nowhere to send it.
    expect(sent.length).toBe(before);

    const user = await raw.user.findUniqueOrThrow({ where: { id: withoutEmail } });
    expect(await verifyPassword(NEXT, user.passwordHash)).toBe(true);
  });

  it('still refuses a wrong current password', async () => {
    const result = await requestPasswordChange({
      userId: withoutEmail,
      origin: 'http://localhost:3000',
      draft: { currentPassword: 'wrong', newPassword: 'another-one', confirmPassword: 'another-one' },
    });
    expect(result.ok).toBe(false);
  });
});

describe('editing details', () => {
  it('will not clear the username of an account that has no email', async () => {
    // It is the only way that person can sign in, so clearing it would lock
    // them out permanently at the moment they pressed Save.
    const result = await saveProfile({
      userId: withoutEmail,
      draft: { firstName: 'Obinna', lastName: 'Eze', username: '', phone: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/only way you can sign in/);

    const profile = await loadProfile(withoutEmail);
    expect(profile?.username).toBeTruthy();
  });

  it('allows clearing it when an email address remains', async () => {
    const result = await saveProfile({
      userId: withEmail,
      draft: { firstName: 'Adaeze', lastName: 'Okafor', username: '', phone: '' },
    });
    expect(result.ok).toBe(true);
    expect((await loadProfile(withEmail))?.username).toBeNull();
  });

  it('refuses a username somebody else already holds', async () => {
    const taken = (await loadProfile(withoutEmail))!.username!;
    const result = await saveProfile({
      userId: withEmail,
      draft: { firstName: 'Adaeze', lastName: 'Okafor', username: taken, phone: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already taken/);
  });

  it('saves an ordinary edit', async () => {
    const result = await saveProfile({
      userId: withEmail,
      draft: {
        firstName: 'Adaeze',
        lastName: 'Okafor-Nwosu',
        username: `a.okafor.${Date.now()}`,
        phone: '+234 803 111 2222',
      },
    });
    expect(result.ok).toBe(true);

    const profile = await loadProfile(withEmail);
    expect(profile?.lastName).toBe('Okafor-Nwosu');
    expect(profile?.phone).toBe('+234 803 111 2222');
  });
});
