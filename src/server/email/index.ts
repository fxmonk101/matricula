import { consoleMailer } from './console-mailer';

/**
 * =============================================================================
 * THE EMAIL CHANNEL
 * =============================================================================
 *
 * An interface with a development driver behind it, and no provider in the
 * critical path.
 *
 * WHY THERE IS NO SMTP DRIVER HERE YET. Every flow this platform runs is
 * designed to work without email: a new account gets a one-time password read
 * across a desk, and a forgotten password goes through the office, because that
 * is how schools in this market actually work and because an email dependency
 * in the sign-in path means a school with a misconfigured mail server cannot
 * let anybody in. Email is an ADDITION — a second factor for changing your own
 * password — not a foundation.
 *
 * So this module exists to be swapped. A deployment adds a driver, points
 * `MAIL_DRIVER` at it, and nothing else changes; until then the development
 * driver writes every message to disk and logs where it went, which is enough
 * to build and test the flows that use it.
 *
 * A caller MUST NOT assume delivery. `send` returns a result rather than
 * throwing on failure, because a password change that half-succeeded — applied
 * but with no mail sent — is worse than one that plainly did not happen.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Every message this platform sends is readable without HTML. */
  body: string;
}

export interface SendResult {
  ok: boolean;
  /** Where it went, for the audit trail: "console", "smtp", a provider id. */
  via: string;
  /** Set when the driver could not deliver. */
  error?: string;
  /**
   * Development only: the path the message was written to, so a developer can
   * find the confirmation link without a mail server. Never set in production.
   */
  localPath?: string;
}

export interface Mailer {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

let override: Mailer | null = null;

export async function mailer(): Promise<Mailer> {
  if (override) return override;

  const driver = (process.env.MAIL_DRIVER ?? 'console').toLowerCase();
  switch (driver) {
    case 'console':
      return consoleMailer;
    default:
      // An unrecognised driver is a misconfiguration, and falling back silently
      // to "console" in production would mean confirmation mails vanish while
      // the application reports success.
      console.error(
        `[email] MAIL_DRIVER="${driver}" is not a driver this build knows. Falling back to the development mailer; NO REAL MAIL WILL BE SENT.`,
      );
      return consoleMailer;
  }
}

/** Test seam, mirroring `__setStorageDriver`. */
export function __setMailer(next: Mailer | null): void {
  override = next;
}

/**
 * Is a real provider configured?
 *
 * The UI asks this so it can tell somebody the truth. Offering "we have emailed
 * you a link" when the link went to a log file is how a person ends up locked
 * out waiting for a message that was never sent.
 */
export function mailIsDeliverable(): boolean {
  const driver = (process.env.MAIL_DRIVER ?? 'console').toLowerCase();
  return driver !== 'console';
}
