import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __setMailer, mailIsDeliverable, mailer } from '@/server/email';
import { __setMailTransport, httpDriverNames, httpMailerFor } from '@/server/email/http-mailer';

/*
 * Sending mail.
 *
 * Password reset depends on this, so the tests that matter are the honest ones:
 * that an unconfigured deployment ADMITS it cannot send, that a misspelled
 * driver is loud rather than silently falling back, and that an API key never
 * reaches anything a user or an audit log can read.
 */

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.MAIL_DRIVER;
  delete process.env.MAIL_API_KEY;
  delete process.env.MAIL_FROM;
  __setMailer(null);
});

afterEach(() => {
  process.env = { ...ENV };
  __setMailer(null);
  __setMailTransport(null);
});

const message = {
  to: 'student@example.test',
  subject: 'Reset your password',
  body: 'Open this link within 60 minutes: https://example.test/reset?token=abc',
};

describe('choosing a driver', () => {
  it('defaults to the development mailer, which does not pretend', async () => {
    const chosen = await mailer();
    expect(chosen.name).toBe('console');
    expect(mailIsDeliverable()).toBe(false);
  });

  it('knows the HTTP providers it ships with', () => {
    expect(httpDriverNames()).toContain('resend');
    expect(httpDriverNames()).toContain('brevo');
  });

  it('falls back LOUDLY on a misspelled driver', async () => {
    /*
     * The failure this guards against is silent: a typo in an environment
     * variable, and every reset link goes to a log file while the application
     * reports success.
     */
    process.env.MAIL_DRIVER = 'resnd';
    const chosen = await mailer();
    expect(chosen.name).toBe('console');
    expect(mailIsDeliverable()).toBe(false);
  });

  it('does NOT call itself deliverable without credentials', async () => {
    // The worst of both worlds would be promising "we have emailed you" and
    // failing in a log nobody reads.
    process.env.MAIL_DRIVER = 'resend';
    expect(mailIsDeliverable()).toBe(false);

    process.env.MAIL_API_KEY = 'key';
    expect(mailIsDeliverable()).toBe(false);

    process.env.MAIL_FROM = 'portal@school.edu';
    expect(mailIsDeliverable()).toBe(true);
  });

  it('resolves a configured provider', async () => {
    process.env.MAIL_DRIVER = 'brevo';
    process.env.MAIL_API_KEY = 'key';
    process.env.MAIL_FROM = 'portal@school.edu';
    expect((await mailer()).name).toBe('brevo');
  });
});

describe('sending', () => {
  beforeEach(() => {
    process.env.MAIL_API_KEY = 'super-secret-key';
    process.env.MAIL_FROM = 'Golden Eagles <portal@geu.edu>';
  });

  function capture() {
    const calls: { url: string; init: RequestInit }[] = [];
    __setMailTransport(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'msg-1', messageId: 'msg-1' }), { status: 200 });
    });
    return calls;
  }

  it('posts the message to Resend in its own shape', async () => {
    const calls = capture();
    const result = await httpMailerFor('resend')!.send(message);

    expect(result.ok).toBe(true);
    expect(calls[0].url).toContain('api.resend.com');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.to).toEqual(['student@example.test']);
    expect(body.text).toContain('https://example.test/reset');
    // The display name is kept, so mail does not arrive from a bare address.
    expect(body.from).toBe('Golden Eagles <portal@geu.edu>');
  });

  it('posts to Brevo in ITS shape, which is different', async () => {
    const calls = capture();
    await httpMailerFor('brevo')!.send(message);

    expect(calls[0].url).toContain('api.brevo.com');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sender).toEqual({ email: 'portal@geu.edu', name: 'Golden Eagles' });
    expect(body.to).toEqual([{ email: 'student@example.test' }]);
    expect(body.textContent).toContain('https://example.test/reset');
  });

  it('parses a bare address with no display name', async () => {
    process.env.MAIL_FROM = 'portal@geu.edu';
    const calls = capture();
    await httpMailerFor('brevo')!.send(message);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sender.email).toBe('portal@geu.edu');
  });

  it('records the provider message id, for the audit trail', async () => {
    capture();
    const result = await httpMailerFor('resend')!.send(message);
    expect(result.via).toBe('resend:msg-1');
  });

  it('REFUSES rather than sending when the key is missing', async () => {
    delete process.env.MAIL_API_KEY;
    const result = await httpMailerFor('resend')!.send(message);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/MAIL_API_KEY/);
  });

  it('says which variable is missing, not just that it failed', async () => {
    delete process.env.MAIL_FROM;
    const result = await httpMailerFor('resend')!.send(message);
    expect(result.error).toMatch(/MAIL_FROM/);
  });
});

describe('when the provider misbehaves', () => {
  beforeEach(() => {
    process.env.MAIL_API_KEY = 'super-secret-key';
    process.env.MAIL_FROM = 'portal@geu.edu';
  });

  it('RETRIES a 429 once and then succeeds', async () => {
    let attempts = 0;
    __setMailTransport(async () => {
      attempts += 1;
      if (attempts === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    });

    const result = await httpMailerFor('resend')!.send(message);
    expect(attempts).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('does NOT retry a 401, which would fail identically', async () => {
    let attempts = 0;
    __setMailTransport(async () => {
      attempts += 1;
      return new Response('{"message":"invalid api key"}', { status: 401 });
    });

    const result = await httpMailerFor('resend')!.send(message);
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('returns a failure rather than throwing when the network dies', async () => {
    // A throw here would reach a form action and become a 500 page, on the one
    // flow somebody uses because they are already locked out.
    __setMailTransport(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await httpMailerFor('resend')!.send(message);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no response/);
  });

  it('NEVER puts the API key in the returned result', async () => {
    /*
     * `via` and `error` are surfaced to users and written to the audit log. A
     * provider's rejection body can echo the key back, so the body is logged
     * for a developer and never returned.
     */
    __setMailTransport(async () => new Response('{"key":"super-secret-key"}', { status: 422 }));

    const result = await httpMailerFor('resend')!.send(message);
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });

  it('sends the key as a header, never in the body or the URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    __setMailTransport(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    });

    await httpMailerFor('brevo')!.send(message);
    expect(calls[0].url).not.toContain('super-secret-key');
    expect(String(calls[0].init.body)).not.toContain('super-secret-key');
    expect(JSON.stringify(calls[0].init.headers)).toContain('super-secret-key');
  });
});
