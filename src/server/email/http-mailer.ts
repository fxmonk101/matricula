import type { EmailMessage, Mailer, SendResult } from './index';

/**
 * =============================================================================
 * SENDING MAIL OVER HTTP
 * =============================================================================
 *
 * Two real providers, both free at the volume a school actually sends, and
 * neither needing a dependency. This codebase avoids dependencies it can write
 * in a page, and an SMTP client is a large one; a transactional provider's REST
 * API is a POST with a JSON body.
 *
 * WHY NOT SMTP. Every domain purchase comes with a mailbox and it is tempting
 * to send through it. A mailbox is built for correspondence, not for automated
 * mail: no per-message delivery reporting, no bounce handling, aggressive rate
 * limits, and a reputation that collapses the first time a school sends four
 * hundred password resets in a morning. A transactional service exists for this
 * and is free at the volumes involved. SMTP can still be added behind the same
 * interface later if a school insists on their own relay.
 *
 * The shape below mirrors the Graph driver: an injectable transport, a timeout,
 * one retry for the failures worth retrying, and credentials that never reach a
 * message anybody can read.
 */

const TIMEOUT_MS = 10_000;

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

let transport: Transport = (url, init) => fetch(url, init);

/** Test seam. Pass null to restore the real one. */
export function __setMailTransport(next: Transport | null): void {
  transport = next ?? ((url, init) => fetch(url, init));
}

async function post(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await transport(url, { ...init, signal: controller.signal });
  } catch (error) {
    // A timeout and a DNS failure are the same thing to the caller: no answer.
    console.error('[email] request failed', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry a throttle or a server fault once, and nothing else.
 *
 * A 401 or a 422 will fail identically however many times it is sent. Retrying
 * it doubles the delay before somebody sees the error that would let them fix
 * the configuration.
 */
function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5_000);
  return 1_000;
}

/**
 * The sender address.
 *
 * Read here rather than baked into each driver, because getting it wrong is the
 * single commonest reason transactional mail silently fails: the domain has to
 * be verified with the provider, and an unverified sender is rejected or filed
 * as spam. Named in `.env.example` with that warning attached.
 */
function sender(): { email: string; name: string } {
  const raw = process.env.MAIL_FROM ?? '';
  const match = raw.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) return { name: match[1] || 'School portal', email: match[2] };
  return { name: 'School portal', email: raw.trim() };
}

interface Preset {
  name: string;
  url: string;
  headers: (key: string) => Record<string, string>;
  body: (message: EmailMessage, from: { email: string; name: string }) => unknown;
  /** Pull the provider's own message id out, for the audit trail. */
  idOf: (json: unknown) => string | undefined;
}

const PRESETS: Record<string, Preset> = {
  /*
   * Resend. Simplest of the lot, 3,000 messages a month free. Wants the sender
   * on a domain verified in their dashboard.
   */
  resend: {
    name: 'resend',
    url: 'https://api.resend.com/emails',
    headers: (key) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' }),
    body: (message, from) => ({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: [message.to],
      subject: message.subject,
      text: message.body,
    }),
    idOf: (json) => (json as { id?: string })?.id,
  },

  /*
   * Brevo. 300 messages a DAY free, which is the more generous ceiling for a
   * school sending a term's worth of notifications in a week.
   */
  brevo: {
    name: 'brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    headers: (key) => ({ 'api-key': key, 'content-type': 'application/json', accept: 'application/json' }),
    body: (message, from) => ({
      sender: { email: from.email, name: from.name },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.body,
    }),
    idOf: (json) => (json as { messageId?: string })?.messageId,
  },
};

export function httpMailerFor(driver: string): Mailer | null {
  const preset = PRESETS[driver.toLowerCase()];
  if (!preset) return null;

  return {
    name: preset.name,

    async send(message: EmailMessage): Promise<SendResult> {
      const key = process.env.MAIL_API_KEY;
      const from = sender();

      if (!key || !from.email) {
        // Loud, and specific about which of the two is missing — "email failed"
        // sends somebody reading logs in the wrong direction.
        const missing = !key ? 'MAIL_API_KEY' : 'MAIL_FROM';
        console.error(`[email] ${preset.name} is selected but ${missing} is not set.`);
        return { ok: false, via: preset.name, error: `${missing} is not set` };
      }

      const init: RequestInit = {
        method: 'POST',
        headers: preset.headers(key),
        body: JSON.stringify(preset.body(message, from)),
      };

      let response = await post(preset.url, init);

      if (response && shouldRetry(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response!)));
        response = await post(preset.url, init);
      }

      if (!response) {
        return { ok: false, via: preset.name, error: 'no response' };
      }

      if (!response.ok) {
        /*
         * The body is read for the log because a provider's rejection is
         * genuinely useful — "domain not verified", "recipient suppressed" —
         * but it is never returned to the caller, which surfaces messages to
         * users and must not echo a provider's internals back at them.
         */
        const detail = await response.text().catch(() => '');
        console.error(
          `[email] ${preset.name} refused the message (${response.status}): ${detail.slice(0, 300)}`,
        );
        return { ok: false, via: preset.name, error: `rejected with ${response.status}` };
      }

      const json = await response.json().catch(() => ({}));
      const id = preset.idOf(json);

      return { ok: true, via: id ? `${preset.name}:${id}` : preset.name };
    },
  };
}

/** Which drivers this build knows, for the error message when one is mistyped. */
export function httpDriverNames(): string[] {
  return Object.keys(PRESETS);
}
