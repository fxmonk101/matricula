import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  amzDates,
  canonicalQuery,
  canonicalRequest,
  sha256Hex,
  signRequest,
  signingKey,
  stringToSign,
  uriEncode,
} from '@/server/storage/sigv4';

/*
 * AWS Signature Version 4.
 *
 * Checked against AWS's OWN published values, not against what I expect my
 * code to do. A signing implementation tested only against itself passes
 * comfortably and then fails against the real service with
 * `SignatureDoesNotMatch` and no indication of which of the four steps was
 * wrong — so each step is pinned separately.
 */

const EXAMPLE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
};

describe('step 3 — the signing key', () => {
  it('matches the derivation published in the AWS documentation', () => {
    /*
     * From "Examples of how to derive a signing key for Signature Version 4".
     * This one is worth pinning on its own: it uses a different date, region
     * and service from the request vectors below, so if it passes and they
     * fail, the HMAC chain is right and the canonical request is wrong.
     */
    const key = signingKey({
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      dateStamp: '20120215',
      region: 'us-east-1',
      service: 'iam',
    });

    expect(key.toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });
});

describe('step 1 — the canonical request', () => {
  it('builds the "get-vanilla" case from the AWS test suite', () => {
    const { canonical, signedHeaders } = canonicalRequest({
      method: 'GET',
      path: '/',
      query: '',
      headers: {
        host: 'example.amazonaws.com',
        'x-amz-date': '20150830T123600Z',
      },
      payloadHash: sha256Hex(''),
    });

    expect(signedHeaders).toBe('host;x-amz-date');
    expect(canonical).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n'),
    );
  });

  it('sorts headers by name and collapses runs of whitespace in values', () => {
    const { canonical, signedHeaders } = canonicalRequest({
      method: 'PUT',
      path: '/a',
      query: '',
      headers: { 'Z-Header': '  spaced    out  ', 'a-header': 'first', host: 'h' },
      payloadHash: 'HASH',
    });

    expect(signedHeaders).toBe('a-header;host;z-header');
    expect(canonical).toContain('z-header:spaced out\n');
  });
});

describe('step 2 — the string to sign', () => {
  it('has four lines: algorithm, timestamp, scope, hash', () => {
    const s = stringToSign({
      amzDate: '20150830T123600Z',
      scope: '20150830/us-east-1/service/aws4_request',
      canonical: 'anything',
    });

    const lines = s.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('AWS4-HMAC-SHA256');
    expect(lines[1]).toBe('20150830T123600Z');
    expect(lines[2]).toBe('20150830/us-east-1/service/aws4_request');
    expect(lines[3]).toBe(sha256Hex('anything'));
  });
});

describe('step 4 — the finished signature', () => {
  it('reproduces the published "get-vanilla" signature exactly', () => {
    /*
     * The end-to-end vector, and the one that matters most: all four steps
     * chained, checked against the signature AWS publishes for this case.
     *
     * It is assembled from the primitives rather than through `signRequest`
     * because `signRequest` always adds `x-amz-content-sha256` — S3 requires
     * that header, and the published vector predates it, so the two cannot
     * agree on the signed-header list. Testing the chain directly is what
     * makes the vector usable at all.
     */
    const { canonical } = canonicalRequest({
      method: 'GET',
      path: '/',
      query: '',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadHash: sha256Hex(''),
    });

    const scope = '20150830/us-east-1/service/aws4_request';
    const key = signingKey({
      secretAccessKey: EXAMPLE.secretAccessKey,
      dateStamp: '20150830',
      region: 'us-east-1',
      service: 'service',
    });

    const signature = createHmac('sha256', key)
      .update(stringToSign({ amzDate: '20150830T123600Z', scope, canonical }), 'utf8')
      .digest('hex');

    expect(signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('assembles a well-formed Authorization header', () => {
    const headers = signRequest({
      method: 'GET',
      path: '/',
      headers: { host: 'example.amazonaws.com' },
      payloadHash: sha256Hex(''),
      credentials: EXAMPLE,
      now: new Date('2015-08-30T12:36:00Z'),
    });

    expect(headers.authorization).toContain(
      'Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request',
    );
    // S3 requires the payload hash header, so it must appear in the signed set.
    expect(headers.authorization).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
    );
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
  });

  it('changes the signature when any signed input changes', () => {
    const base = {
      method: 'GET' as string,
      path: '/bucket/key.png',
      headers: { host: 'account.r2.cloudflarestorage.com' },
      payloadHash: sha256Hex(''),
      credentials: EXAMPLE,
      now: new Date('2015-08-30T12:36:00Z'),
    };
    const sigOf = (o: Partial<typeof base>) =>
      signRequest({ ...base, ...o }).authorization.split('Signature=')[1];

    const original = sigOf({});
    expect(sigOf({ method: 'PUT' })).not.toBe(original);
    expect(sigOf({ path: '/bucket/other.png' })).not.toBe(original);
    expect(sigOf({ payloadHash: sha256Hex('x') })).not.toBe(original);
    expect(sigOf({ now: new Date('2015-08-31T12:36:00Z') })).not.toBe(original);
    expect(sigOf({ headers: { host: 'elsewhere.example' } })).not.toBe(original);
  });
});

describe('percent-encoding', () => {
  it('encodes the characters encodeURIComponent leaves alone', () => {
    /*
     * The actual bug this prevents: `encodeURIComponent` passes !'()* through
     * untouched, AWS requires them encoded, and the mismatch is a single
     * character in a 200-character canonical request.
     */
    expect(uriEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(encodeURIComponent("!'()*")).toBe("!'()*"); // the trap, stated
  });

  it('leaves unreserved characters alone', () => {
    expect(uriEncode('AZaz09-_.~')).toBe('AZaz09-_.~');
  });

  it('encodes a slash only when asked', () => {
    expect(uriEncode('a/b')).toBe('a%2Fb');
    expect(uriEncode('a/b', false)).toBe('a/b');
  });

  it('encodes space as %20, never as +', () => {
    expect(uriEncode('a b')).toBe('a%20b');
  });

  it('encodes non-ASCII byte-wise over UTF-8', () => {
    expect(uriEncode('é')).toBe('%C3%A9');
  });
});

describe('the canonical query string', () => {
  it('sorts by key', () => {
    expect(canonicalQuery({ b: '2', a: '1', c: '3' })).toBe('a=1&b=2&c=3');
  });

  it('encodes keys and values', () => {
    expect(canonicalQuery({ 'a key': 'a value' })).toBe('a%20key=a%20value');
  });
});

describe('timestamps', () => {
  it('produces both forms the algorithm needs', () => {
    const { amzDate, dateStamp } = amzDates(new Date('2026-09-22T15:15:30.123Z'));
    expect(amzDate).toBe('20260922T151530Z');
    expect(dateStamp).toBe('20260922');
  });
});
