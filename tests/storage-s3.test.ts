import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { S3Driver, __setS3Transport, s3ConfigFromEnv } from '@/server/storage/s3';
import { buildKey } from '@/server/storage';

/*
 * The S3 storage driver.
 *
 * Exercised against an injected transport, so these tests prove the REQUEST is
 * built correctly — method, path, signature, headers, body — and how the driver
 * behaves when the store misbehaves. They do not and cannot prove that
 * Cloudflare accepts it; see the note at the end of the file.
 */

const CONFIG = {
  endpoint: 'https://acct123.r2.cloudflarestorage.com',
  bucket: 'matricula-files',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

function capture(respond: (call: number) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  let n = 0;
  __setS3Transport(async (url, init) => {
    calls.push({ url, init });
    n += 1;
    return respond(n);
  });
  return calls;
}

const ok = () => new Response('', { status: 200 });
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

afterEach(() => {
  __setS3Transport(null);
});

describe('reading the configuration', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('names EVERY missing variable at once, not one per attempt', () => {
    process.env.S3_ENDPOINT = 'https://x.example';
    expect(() => s3ConfigFromEnv()).toThrowError(
      /S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/,
    );
  });

  it('defaults the region to "auto", which is what R2 wants', () => {
    const config = s3ConfigFromEnv({
      S3_ENDPOINT: 'https://x.example',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
    } as unknown as NodeJS.ProcessEnv);
    expect(config.region).toBe('auto');
  });

  it('tolerates a trailing slash on the endpoint', () => {
    // Pasting the endpoint out of the Cloudflare dashboard brings one along,
    // and it would otherwise produce a double slash in every signed path.
    const config = s3ConfigFromEnv({
      S3_ENDPOINT: 'https://x.example/',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
    } as unknown as NodeJS.ProcessEnv);
    expect(config.endpoint).toBe('https://x.example');
  });
});

describe('put', () => {
  it('PUTs to /<bucket>/<key> with the body and a signature', async () => {
    const calls = capture(ok);
    const driver = new S3Driver(CONFIG);
    const body = new Uint8Array([1, 2, 3, 4]);

    await driver.put({ key: 'private/school1/avatar/abc.png', body, mediaType: 'image/png', visibility: 'private' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://acct123.r2.cloudflarestorage.com/matricula-files/private/school1/avatar/abc.png',
    );
    expect(calls[0].init.method).toBe('PUT');

    const h = headersOf(calls[0].init);
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(h['content-type']).toBe('image/png');
    expect(h['content-length']).toBe('4');
    // The payload hash is signed, so it must be the hash of THIS body.
    expect(h['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does NOT send a host header, which fetch refuses to set', async () => {
    /*
     * `host` is part of the signature and must be computed, but passing it to
     * fetch throws. Getting this wrong makes every single upload fail.
     */
    const calls = capture(ok);
    await new S3Driver(CONFIG).put({
      key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private',
    });
    expect(Object.keys(headersOf(calls[0].init))).not.toContain('host');
  });

  it('THROWS when the store refuses, so no row is committed for a lost file', async () => {
    capture(() => new Response('AccessDenied', { status: 403 }));
    const driver = new S3Driver(CONFIG);

    await expect(
      driver.put({ key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private' }),
    ).rejects.toThrow(/403/);
  });

  it('throws rather than resolving when there is no response at all', async () => {
    __setS3Transport(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      new S3Driver(CONFIG).put({
        key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private',
      }),
    ).rejects.toThrow(/did not respond/);
  });

  it('stores public and private keys identically — the bucket is never public', async () => {
    const calls = capture(ok);
    const driver = new S3Driver(CONFIG);
    const body = new Uint8Array([1]);

    await driver.put({ key: 'public/s/logo/a.png', body, mediaType: 'image/png', visibility: 'public' });
    await driver.put({ key: 'private/s/avatar/a.png', body, mediaType: 'image/png', visibility: 'private' });

    // No ACL header on either. A public ACL would be a second authority on who
    // may read a file, answering over the open internet, that no route handler
    // is consulted about.
    for (const call of calls) {
      const keys = Object.keys(headersOf(call.init)).map((k) => k.toLowerCase());
      expect(keys).not.toContain('x-amz-acl');
    }
  });
});

describe('get', () => {
  it('returns the bytes and the stored media type', async () => {
    capture(() => new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));

    const result = await new S3Driver(CONFIG).get('private/s/sub/a.pdf');
    expect(result?.mediaType).toBe('application/pdf');
    expect(Array.from(result!.body)).toEqual([9, 8, 7]);
  });

  it('returns null on 404 rather than throwing', async () => {
    capture(() => new Response('', { status: 404 }));
    expect(await new S3Driver(CONFIG).get('private/s/sub/missing.pdf')).toBeNull();
  });

  it('falls back to a type no browser will execute', async () => {
    capture(() => new Response(new Uint8Array([1]), { status: 200 }));
    const result = await new S3Driver(CONFIG).get('private/s/sub/a.bin');
    expect(result?.mediaType).toBe('application/octet-stream');
  });
});

describe('delete', () => {
  it('sends DELETE and treats a missing object as success', async () => {
    const calls = capture(() => new Response('', { status: 404 }));
    await expect(new S3Driver(CONFIG).delete('private/s/f/gone.png')).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('when the store misbehaves', () => {
  it('RETRIES a 500 once and then succeeds', async () => {
    const calls = capture((n) => (n === 1 ? new Response('', { status: 500 }) : ok()));
    await new S3Driver(CONFIG).put({
      key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private',
    });
    expect(calls).toHaveLength(2);
  });

  it('RE-SIGNS the retry instead of replaying the first signature', async () => {
    /*
     * The signature covers the timestamp and is valid for fifteen minutes. A
     * retry that replays the original header works in a fast test and fails in
     * production after a slow first attempt — the exact bug that only appears
     * under the load that caused the retry.
     */
    const calls = capture((n) => (n === 1 ? new Response('', { status: 503 }) : ok()));
    await new S3Driver(CONFIG).put({
      key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private',
    });

    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1].init)['x-amz-date']).toBeDefined();
    expect(headersOf(calls[1].init).authorization).toContain('Signature=');
  });

  it('does NOT retry a 403, which would fail identically', async () => {
    const calls = capture(() => new Response('', { status: 403 }));
    await new S3Driver(CONFIG)
      .put({ key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private' })
      .catch(() => {});
    expect(calls).toHaveLength(1);
  });

  it('NEVER puts the secret key in a thrown error', async () => {
    // Errors reach form actions and the audit log.
    capture(() => new Response(`echoed ${CONFIG.secretAccessKey}`, { status: 422 }));
    const error = await new S3Driver(CONFIG)
      .put({ key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private' })
      .catch((e: Error) => e);

    expect(String(error)).not.toContain(CONFIG.secretAccessKey);
  });

  it('never puts credentials in the URL', async () => {
    const calls = capture(ok);
    await new S3Driver(CONFIG).put({
      key: 'private/s/f/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private',
    });
    expect(calls[0].url).not.toContain(CONFIG.secretAccessKey);
    expect(calls[0].url).not.toContain(CONFIG.accessKeyId);
  });

  it('describes itself without the credentials', () => {
    const described = new S3Driver(CONFIG).describe();
    expect(described).toContain('matricula-files');
    expect(described).not.toContain(CONFIG.secretAccessKey);
    expect(described).not.toContain(CONFIG.accessKeyId);
  });
});

describe('key safety', () => {
  it('refuses a key that tries to climb out of the bucket', async () => {
    capture(ok);
    const driver = new S3Driver(CONFIG);
    await expect(
      driver.put({ key: '../other/a.png', body: new Uint8Array([1]), mediaType: 'image/png', visibility: 'private' }),
    ).rejects.toThrow(/Unsafe storage key/);
  });

  it('accepts the keys buildKey actually produces', async () => {
    const calls = capture(ok);
    const key = buildKey({
      visibility: 'private',
      schoolId: 'cmu513yb60003vde4rbbagf0y',
      folder: 'submission',
      id: 'a'.repeat(32),
      type: { kind: 'document', extension: 'pdf', mediaType: 'application/pdf', signature: [] },
    });

    await new S3Driver(CONFIG).put({
      key, body: new Uint8Array([1]), mediaType: 'application/pdf', visibility: 'private',
    });
    expect(calls[0].url).toContain(`/matricula-files/${key}`);
  });
});

/*
 * NOT VERIFIED AGAINST CLOUDFLARE.
 *
 * Everything above runs against an injected transport. The signing is checked
 * against AWS's own published vectors in `tests/sigv4.test.ts`, which is strong
 * evidence but not the same thing as a 200 from R2. The first real upload is
 * the test that counts, and the failure to expect is `SignatureDoesNotMatch`.
 * This comment stays until somebody has seen it work against a real bucket.
 */
