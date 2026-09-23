import { createHash, createHmac } from 'node:crypto';

/**
 * =============================================================================
 * AWS SIGNATURE VERSION 4
 * =============================================================================
 *
 * Enough of it to talk to an S3-compatible object store, and no more.
 *
 * WHY THIS IS NOT `@aws-sdk/client-s3`. The driver above it makes three calls —
 * PUT an object, GET an object, DELETE an object — against one endpoint with
 * static credentials. The official client brings a credential-provider chain, a
 * region resolver, retry middleware, a streaming layer and a plugin system to
 * do that, and it lands as a couple of megabytes in a serverless bundle that is
 * cold-started per instance. This file is the part that is actually needed, and
 * it follows the same shape as the Graph and mail drivers already in this
 * codebase: no dependency, an injectable transport, a timeout, one retry.
 *
 * The cost of that choice is that signing is now MINE to get right, and a
 * signature that is wrong by one byte fails with `SignatureDoesNotMatch` and no
 * hint as to which byte. So the algorithm is written in the order the AWS
 * specification states it, each step is named after the term the specification
 * uses, and `tests/sigv4.test.ts` checks it against AWS's own published test
 * vectors rather than against my expectations of it.
 *
 * The sequence, for anyone reading this next to the spec:
 *
 *   1. CANONICAL REQUEST  — method, path, query, headers, payload hash
 *   2. STRING TO SIGN     — algorithm, timestamp, scope, hash of (1)
 *   3. SIGNING KEY        — HMAC chain: secret -> date -> region -> service
 *   4. SIGNATURE          — HMAC of (2) with (3)
 *
 * Every one of those is a separate exported function, because a bug in step 1
 * and a bug in step 3 look identical from the outside and cannot be told apart
 * without testing them apart.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 ignores the region but the protocol requires one; `auto` is correct. */
  region: string;
  service: string;
}

/**
 * Percent-encode per RFC 3986, which is NOT what `encodeURIComponent` does.
 *
 * `encodeURIComponent` leaves `!'()*` alone. AWS requires them encoded, and a
 * key containing an apostrophe would otherwise produce a canonical request that
 * disagrees with the server's by exactly one character.
 *
 * Encoding is byte-wise over UTF-8 rather than character-wise, so that
 * non-ASCII in a key — which `buildKey` forbids today, but which nothing here
 * should rely on — is encoded the way the specification says.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const char = String.fromCharCode(byte);
    const unreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      char === '-' ||
      char === '_' ||
      char === '.' ||
      char === '~';

    if (unreserved) out += char;
    else if (char === '/') out += encodeSlash ? '%2F' : '/';
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `20260922T151530Z` and `20260922`, the two forms every step needs. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Step 1 — the canonical request.
 *
 * Header values are trimmed and their names lowercased, and the list is sorted
 * by name. The server rebuilds this string from what it receives; any
 * disagreement at all produces a signature mismatch.
 */
export function canonicalRequest(params: {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  payloadHash: string;
}): { canonical: string; signedHeaders: string } {
  const entries = Object.entries(params.headers)
    .map(([name, value]) => [name.toLowerCase().trim(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = entries.map(([n, v]) => `${n}:${v}\n`).join('');
  const signedHeaders = entries.map(([n]) => n).join(';');

  const canonical = [
    params.method.toUpperCase(),
    // The slash separators stay literal; everything else in the path is encoded.
    uriEncode(params.path, false),
    params.query,
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  return { canonical, signedHeaders };
}

/** Sort and encode a query string the way the canonical request requires. */
export function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Step 2 — the string to sign. */
export function stringToSign(params: {
  amzDate: string;
  scope: string;
  canonical: string;
}): string {
  return [ALGORITHM, params.amzDate, params.scope, sha256Hex(params.canonical)].join('\n');
}

/**
 * Step 3 — the signing key.
 *
 * Four chained HMACs. The key is derived from the date, region and service, so
 * a leaked signature is useless for another day, another region or another
 * service — which is the entire point of the chain and the reason not to
 * shortcut it.
 */
export function signingKey(params: {
  secretAccessKey: string;
  dateStamp: string;
  region: string;
  service: string;
}): Buffer {
  const hmac = (key: Buffer | string, data: string) =>
    createHmac('sha256', key).update(data, 'utf8').digest();

  const kDate = hmac(`AWS4${params.secretAccessKey}`, params.dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  return hmac(kService, 'aws4_request');
}

/**
 * The whole thing: returns the headers to add to the request.
 *
 * `host` must be present in `headers` — it is signed, and a request whose Host
 * header does not match the one signed is rejected. It is passed in rather than
 * derived so this function stays pure and testable against fixed vectors.
 */
export function signRequest(params: {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  credentials: Credentials;
  now: Date;
}): Record<string, string> {
  const { credentials: cred } = params;
  const { amzDate, dateStamp } = amzDates(params.now);

  const headers: Record<string, string> = {
    ...params.headers,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': params.payloadHash,
  };

  const { canonical, signedHeaders } = canonicalRequest({
    method: params.method,
    path: params.path,
    query: canonicalQuery(params.query ?? {}),
    headers,
    payloadHash: params.payloadHash,
  });

  const scope = `${dateStamp}/${cred.region}/${cred.service}/aws4_request`;
  const signature = createHmac(
    'sha256',
    signingKey({
      secretAccessKey: cred.secretAccessKey,
      dateStamp,
      region: cred.region,
      service: cred.service,
    }),
  )
    .update(stringToSign({ amzDate, scope, canonical }), 'utf8')
    .digest('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${cred.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
