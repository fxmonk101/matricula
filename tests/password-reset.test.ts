import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { __setMailer, type EmailMessage } from '@/server/email';
import {
  checkResetToken,
  completePasswordReset,
  requestPasswordReset,
} from '@/server/services/profile.service';

/**
 * =============================================================================
 * RESETTING A PASSWORD YOU CANNOT REMEMBER
 * =============================================================================
 *
 * A reset flow is reached by an unauthenticated stranger, so most of what
 * matters here is what it REFUSES to reveal and what it refuses to break:
 *
 *   · it must not say whether an account exists — otherwise it is a free
 *     membership oracle for the whole institution;
 *   · it must not touch the current password until a link is actually opened,
 *     or anybody can lock anybody else out by typing their address;
 *   · a link must die after one use and after an hour.
 */

const raw = new PrismaClient();
const SUFFIX = `reset-${Date.now()}`;

let withEmail = '';
let noEmail = '';
const ORIGINAL = 'the-original-password';
const CHOSEN = 'a-brand-new-chosen-password';

const sent: EmailMessage[] = [];
const lastToken = () =>
  sent[sent.length - 1]?.body.match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';

beforeAll(async () => {
  __setMailer({
    name: 'test',
    async send(message) {
      sent.push(message);
      return { ok: true, via: 'test' };
    },
  });

  const passwordHash = await hashPassword(ORIGINAL);

  withEmail = (
    await raw.user.create({
      data: {
        email: `has-mail-${SUFFIX}@example.test`,
        username: `has.mail.${SUFFIX}`,
        firstName: 'Adaeze',
        lastName: 'Okafor',
        passwordHash,
      },
    })
  ).id;

  noEmail = (
    await raw.user.create({
      data: {
        username: `no.mail.${SUFFIX}`,
        firstName: 'Obinna',
        lastName: 'Eze',
        passwordHash,
      },
    })
  ).id;
});

afterAll(async () => {
  __setMailer(null);
  await raw.user.deleteMany({ where: { id: { in: [withEmail, noEmail] } } });
  await raw.$disconnect();
});

describe('asking for a link', () => {
  it('gives the SAME answer for an account that does not exist', async () => {
    const before = sent.length;
    const result = await requestPasswordReset({
      identifier: `nobody-${SUFFIX}@example.test`,
      origin: 'http://localhost:3000',
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/If that account exists/);
    expect(sent.length).toBe(before);
  });

  it('gives the same answer for an account with NO email on file', async () => {
    const before = sent.length;
    const result = await requestPasswordReset({
      identifier: `no.mail.${SUFFIX}`,
      origin: 'http://localhost:3000',
    });
    expect(result.message).toMatch(/If that account exists/);
    // Nothing to send to, and nothing said about it.
    expect(sent.length).toBe(before);
  });

  it('sends a link for a real account, with the same wording', async () => {
    const result = await requestPasswordReset({
      identifier: `has-mail-${SUFFIX}@example.test`,
      origin: 'http://localhost:3000',
    });
    expect(result.message).toMatch(/If that account exists/);
    expect(sent).toHaveLength(1);
    expect(lastToken().length).toBeGreaterThan(20);
  });

  it('works by username as well as by email', async () => {
    // The person who cannot remember their password may not remember which of
    // the two they signed up with either.
    await raw.accountChangeRequest.deleteMany({ where: { userId: withEmail } });
    const before = sent.length;
    await requestPasswordReset({
      identifier: `has.mail.${SUFFIX}`,
      origin: 'http://localhost:3000',
    });
    expect(sent.length).toBe(before + 1);
  });

  it('does NOT touch the current password', async () => {
    // Otherwise anyone could lock anyone out by typing their address.
    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(ORIGINAL, user.passwordHash)).toBe(true);
  });

  it('does not send a second email while one is still live', async () => {
    /*
     * A stranger hammering the form would otherwise deliver a stream of mail to
     * somebody who never asked for the first one.
     */
    const before = sent.length;
    for (let i = 0; i < 4; i += 1) {
      await requestPasswordReset({
        identifier: `has-mail-${SUFFIX}@example.test`,
        origin: 'http://localhost:3000',
      });
    }
    expect(sent.length).toBe(before);
  });
});

describe('using the link', () => {
  it('reports a live token as usable, and names the person', async () => {
    const check = await checkResetToken({ token: lastToken() });
    expect(check.ok).toBe(true);
    expect(check.firstName).toBe('Adaeze');
  });

  it('refuses a token nobody issued', async () => {
    expect((await checkResetToken({ token: 'not-a-real-token' })).ok).toBe(false);
    const result = await completePasswordReset({
      token: 'not-a-real-token',
      newPassword: CHOSEN,
      confirmPassword: CHOSEN,
    });
    expect(result.ok).toBe(false);
  });

  it('enforces the password rules without asking for the old one', async () => {
    const short = await completePasswordReset({
      token: lastToken(),
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(short.ok).toBe(false);
    expect(short.message).toMatch(/at least/);

    const mismatched = await completePasswordReset({
      token: lastToken(),
      newPassword: CHOSEN,
      confirmPassword: `${CHOSEN}x`,
    });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.message).toMatch(/do not match/);
  });

  it('a refused attempt does not burn the token', async () => {
    // Somebody who mistypes the confirmation must not have to start again.
    expect((await checkResetToken({ token: lastToken() })).ok).toBe(true);
  });

  it('sets the new password', async () => {
    const result = await completePasswordReset({
      token: lastToken(),
      newPassword: CHOSEN,
      confirmPassword: CHOSEN,
    });
    expect(result.ok).toBe(true);

    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(CHOSEN, user.passwordHash)).toBe(true);
    expect(await verifyPassword(ORIGINAL, user.passwordHash)).toBe(false);
  });

  it('does not then force another change at sign-in', async () => {
    // They just chose this password themselves; asking again is pointless.
    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(user.mustChangePassword).toBe(false);
  });

  it('REFUSES THE SAME LINK A SECOND TIME', async () => {
    const result = await completePasswordReset({
      token: lastToken(),
      newPassword: 'another-password-entirely',
      confirmPassword: 'another-password-entirely',
    });
    expect(result.ok).toBe(false);

    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(CHOSEN, user.passwordHash)).toBe(true);
  });

  it('refuses a link that has expired', async () => {
    await raw.accountChangeRequest.deleteMany({ where: { userId: withEmail } });
    await requestPasswordReset({
      identifier: `has-mail-${SUFFIX}@example.test`,
      origin: 'http://localhost:3000',
    });

    const twoHoursOn = new Date(Date.now() + 2 * 60 * 60_000);
    expect((await checkResetToken({ token: lastToken(), now: twoHoursOn })).ok).toBe(false);

    const result = await completePasswordReset({
      token: lastToken(),
      newPassword: 'yet-another-password',
      confirmPassword: 'yet-another-password',
      now: twoHoursOn,
    });
    expect(result.ok).toBe(false);

    const user = await raw.user.findUniqueOrThrow({ where: { id: withEmail } });
    expect(await verifyPassword(CHOSEN, user.passwordHash)).toBe(true);
  });
});
