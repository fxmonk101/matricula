import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EmailMessage, Mailer, SendResult } from './index';

/**
 * The development mailer.
 *
 * Writes each message to `.mail/` and logs the path. That directory is
 * gitignored — a confirmation link is a bearer token for somebody's account,
 * and a folder of them committed to a repository would be exactly as bad as it
 * sounds.
 *
 * It deliberately does NOT pretend to be a provider. `via` says "console", the
 * result carries the local path, and `mailIsDeliverable()` returns false — so
 * every caller can tell the user the truth rather than "check your inbox".
 */

const MAIL_DIR = '.mail';

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

export const consoleMailer: Mailer = {
  name: 'console',

  async send(message: EmailMessage): Promise<SendResult> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(MAIL_DIR, `${stamp}-${slug(message.to)}.txt`);

    const rendered = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toISOString()}`,
      '',
      message.body,
      '',
    ].join('\n');

    try {
      await mkdir(MAIL_DIR, { recursive: true });
      await writeFile(file, rendered, 'utf8');
    } catch (error) {
      // Not fatal. The log below is the real delivery in development, and a
      // read-only filesystem must not break the flow that called us.
      console.error('[email] could not write the message to disk', error);
      console.info(`\n--- EMAIL (not written to disk) ---\n${rendered}\n---\n`);
      return { ok: true, via: 'console', error: 'not written to disk' };
    }

    console.info(
      `\n[email] ${message.subject}\n        to ${message.to}\n        written to ${file}\n`,
    );

    return { ok: true, via: 'console', localPath: file };
  },
};
