import type { StorageDriver, Visibility } from './index';
import { sha256Hex, signRequest, type Credentials } from './sigv4';

/**
 * =============================================================================
 * S3-COMPATIBLE OBJECT STORAGE
 * =============================================================================
 *
 * The production storage driver. Written against Cloudflare R2, which speaks
 * the S3 API; it works unchanged against AWS S3, Backblaze B2 or MinIO by
 * changing `S3_ENDPOINT` and `S3_REGION`.
 *
 * WHY R2 AND NOT S3, for whoever revisits this: R2 charges nothing for egress.
 * This platform's users are on West African mobile data pulling lecture PDFs
 * and scanned handouts, so egress is the dominant cost and on S3 it would be
 * the whole bill.
 *
 * THIS DRIVER IGNORES `visibility`, AND THAT IS DELIBERATE
 * --------------------------------------------------------
 * The interface carries a public/private distinction and this driver stores
 * both identically, in a bucket with no public access at all. The distinction
 * is not lost — it is in the key, and `visibilityOf()` reads it back — but it
 * is enforced ABOVE this layer, by the route handlers that decide who may read
 * a key. Setting a public ACL here would create a second, contradictory
 * authority on who can read a file: one that answers over the open internet,
 * that no route handler is consulted about, and that no audit log records.
 * A school logo served through the app costs a little cache efficiency. A
 * student's submission served straight from a public bucket is a breach.
 *
 * So: the bucket stays private, every read goes through the app, and a
 * misconfiguration of this driver cannot expose anything.
 *
 * SHAPE. The same as the Graph and mail drivers: an injectable transport, an
 * explicit timeout, one retry for the failures worth retrying, and failures
 * that return rather than throw where the caller can act on them.
 */

const TIMEOUT_MS = 30_000;

/** Longer than the mailer's 10s: this moves a 20 MB file, not a paragraph. */

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

let transport: Transport = (url, init) => fetch(url, init);

/** Test seam, mirroring `__setMailTransport` and `__setGraphTransport`. */
export function __setS3Transport(next: Transport | null): void {
  transport = next ?? ((url, init) => fetch(url, init));
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Read the configuration, refusing a partial one.
 *
 * Every variable is required and the error names the missing ones together
 * rather than one per attempt. A driver that starts with three of five
 * variables set fails on the first upload instead of at boot, which is the
 * difference between a deploy that never goes live and a deploy that loses
 * somebody's coursework.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const missing: string[] = [];
  const read = (name: string): string => {
    const value = env[name];
    if (!value) missing.push(name);
    return value ?? '';
  };

  const config: S3Config = {
    endpoint: read('S3_ENDPOINT').replace(/\/+$/, ''),
    bucket: read('S3_BUCKET'),
    // R2 ignores the region; the signing algorithm still requires a value.
    region: env.S3_REGION || 'auto',
    accessKeyId: read('S3_ACCESS_KEY_ID'),
    secretAccessKey: read('S3_SECRET_ACCESS_KEY'),
  };

  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER is "s3" but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Refusing to start with storage that cannot work.',
    );
  }

  return config;
}

function shouldRetry(status: number): boolean {
  // Identical reasoning to the mailer: a 403 will fail the same way twice, and
  // retrying it only delays the error that would let somebody fix the keys.
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * What went wrong, in terms of what to do about it.
 *
 * S3's error codes are precise and its HTTP statuses are not — a 403 covers a
 * wrong key, an unsigned clock and a bucket policy. Naming them here means the
 * person reading the log is pointed at the thing to change.
 */
function explain(status: number, bucket: string): string {
  if (status === 403) {
    return (
      'refused the request (403). Usually S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, ' +
      'a token without Object Read & Write, or a server clock more than 15 minutes out.'
    );
  }
  if (status === 404) return `has no bucket named "${bucket}", or the object is gone (404).`;
  if (status === 301 || status === 307) return 'redirected: S3_ENDPOINT or S3_REGION is wrong.';
  return `returned ${status}.`;
}

export class S3Driver implements StorageDriver {
  private readonly config: S3Config;
  private readonly credentials: Credentials;
  private readonly host: string;

  constructor(config: S3Config) {
    this.config = config;
    this.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: 's3',
    };
    this.host = new URL(config.endpoint).host;
  }

  /**
   * Path-style addressing: `/<bucket>/<key>`.
   *
   * Not virtual-host style (`<bucket>.<endpoint>/<key>`). R2 supports both, but
   * path style is what works against MinIO and a local test double as well, and
   * a bucket name with a dot in it breaks TLS certificate matching under
   * virtual-host style in a way that is tedious to diagnose.
   */
  private pathFor(key: string): string {
    if (key.startsWith('/') || key.includes('..')) {
      // buildKey already makes this unreachable. It is here for the same reason
      // the local driver checks for traversal: the guard must not depend on the
      // caller that happens to exist today.
      throw new Error('Unsafe storage key.');
    }
    return `/${this.config.bucket}/${key}`;
  }

  private async send(params: {
    method: string;
    key: string;
    body?: Uint8Array;
    mediaType?: string;
  }): Promise<Response | null> {
    const path = this.pathFor(params.key);
    const payloadHash = sha256Hex(params.body ?? '');

    const headers: Record<string, string> = { host: this.host };
    if (params.mediaType) headers['content-type'] = params.mediaType;
    if (params.body) headers['content-length'] = String(params.body.byteLength);

    const signed = signRequest({
      method: params.method,
      path,
      headers,
      payloadHash,
      credentials: this.credentials,
      now: new Date(),
    });

    /*
     * `host` is removed before dispatch: it is signed, but fetch sets it from
     * the URL and rejects an attempt to set it by hand.
     */
    const { host: _host, ...wire } = signed;

    const url = `${this.config.endpoint}${path}`;
    const init: RequestInit = {
      method: params.method,
      headers: wire,
      body: params.body ? Buffer.from(params.body) : undefined,
    };

    let response = await this.attempt(url, init);
    if (response && shouldRetry(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Re-signed, because the timestamp is part of the signature and a retry
      // after a slow first attempt can otherwise fall outside the 15-minute window.
      const resigned = signRequest({
        method: params.method,
        path,
        headers,
        payloadHash,
        credentials: this.credentials,
        now: new Date(),
      });
      const { host: _h, ...retryHeaders } = resigned;
      response = await this.attempt(url, { ...init, headers: retryHeaders });
    }

    return response;
  }

  private async attempt(url: string, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      console.error('[storage] request failed', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async put(params: {
    key: string;
    body: Uint8Array;
    mediaType: string;
    visibility: Visibility;
  }): Promise<void> {
    const response = await this.send({
      method: 'PUT',
      key: params.key,
      body: params.body,
      mediaType: params.mediaType,
    });

    /*
     * `put` throws where `get` and `delete` return null, and the asymmetry is
     * intentional. A failed read can be a 404 and the caller has something
     * sensible to do about it. A failed WRITE that returned quietly would let
     * the caller commit a database row pointing at an object that does not
     * exist — an avatar or a submission that is recorded as received and is
     * not there. Better to fail the action.
     */
    if (!response) {
      throw new Error('Storage did not respond. The file was not saved.');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[storage] PUT ${params.key}: ${detail.slice(0, 300)}`);
      throw new Error(`Storage ${explain(response.status, this.config.bucket)}`);
    }
  }

  async get(key: string): Promise<{ body: Uint8Array; mediaType: string } | null> {
    const response = await this.send({ method: 'GET', key });
    if (!response) return null;

    if (!response.ok) {
      // A 404 is ordinary — the caller renders "not found". Anything else is
      // worth a log, because it means storage is misconfigured rather than empty.
      if (response.status !== 404) {
        console.error(`[storage] GET ${key}: ${explain(response.status, this.config.bucket)}`);
      }
      return null;
    }

    const buffer = await response.arrayBuffer();
    return {
      body: new Uint8Array(buffer),
      /*
       * The stored content-type is trusted only as far as the local driver
       * trusts the extension: it was set by `put` from a SNIFFED type, never
       * from anything a user supplied. The fallback is a type no browser will
       * execute.
       */
      mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.send({ method: 'DELETE', key });

    // Deleting something already gone is success, exactly as on local disk.
    if (response && !response.ok && response.status !== 404) {
      console.error(`[storage] DELETE ${key}: ${explain(response.status, this.config.bucket)}`);
    }
  }

  /** For diagnostics. Names the bucket and endpoint, never the credentials. */
  describe(): string {
    return `s3 ${this.config.endpoint}/${this.config.bucket} (${this.config.region})`;
  }
}
