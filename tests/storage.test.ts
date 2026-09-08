import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildKey, newObjectId, schoolIdOf, visibilityOf } from '@/server/storage';
import { LocalDiskDriver } from '@/server/storage/local-disk';
import { sniffType } from '@/lib/domain/upload';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_TYPE = sniffType(PNG)!;

describe('storage keys', () => {
  it('namespaces by visibility and school', () => {
    const key = buildKey({
      visibility: 'public',
      schoolId: 'sch_123',
      folder: 'logo',
      id: 'abc',
      type: PNG_TYPE,
    });
    expect(key).toBe('public/sch_123/logo/abc.png');
  });

  it('takes the extension from the SNIFFED type, never from a filename', () => {
    // There is no component of this key that a user chose, which is what makes
    // traversal impossible rather than merely unlikely.
    expect(
      buildKey({ visibility: 'private', schoolId: 's', folder: 'docs', id: 'x', type: PNG_TYPE }),
    ).toMatch(/\.png$/);
  });

  it('refuses a school id or folder that could escape the directory', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', 'a b', '']) {
      expect(
        () => buildKey({ visibility: 'public', schoolId: bad, folder: 'logo', id: 'a', type: PNG_TYPE }),
        `schoolId ${bad}`,
      ).toThrow();
      expect(
        () => buildKey({ visibility: 'public', schoolId: 's', folder: bad, id: 'a', type: PNG_TYPE }),
        `folder ${bad}`,
      ).toThrow();
    }
  });

  it('reads visibility back from the key, not from a caller’s claim', () => {
    // The route handler uses this to decide whether to check a session, so a
    // caller must not be able to ask for a private file "as public".
    expect(visibilityOf('public/s/logo/a.png')).toBe('public');
    expect(visibilityOf('private/s/docs/a.pdf')).toBe('private');
    expect(visibilityOf('elsewhere/s/a.png')).toBeNull();
    expect(visibilityOf('a.png')).toBeNull();
  });

  it('reads the owning school back from the key', () => {
    // This is what makes a leaked private link useless to another tenant.
    expect(schoolIdOf('private/sch_123/docs/a.pdf')).toBe('sch_123');
    expect(schoolIdOf('nope')).toBeNull();
  });

  it('mints ids that are unique and path-safe', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newObjectId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('local disk driver', () => {
  let root: string;
  let driver: LocalDiskDriver;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ge-storage-'));
    driver = new LocalDiskDriver(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips an object', async () => {
    const key = 'public/s1/logo/a.png';
    await driver.put({ key, body: PNG, mediaType: 'image/png', visibility: 'public' });
    const got = await driver.get(key);
    expect(got).not.toBeNull();
    expect(Array.from(got!.body)).toEqual(Array.from(PNG));
    expect(got!.mediaType).toBe('image/png');
  });

  it('returns null for a missing object rather than throwing', async () => {
    expect(await driver.get('public/s1/logo/nothing.png')).toBeNull();
  });

  it('serves an unknown extension as a non-executable download type', async () => {
    // An unrecognised file must never come back as something the browser will
    // render as a document in this origin.
    await driver.put({
      key: 'private/s1/docs/x.bin',
      body: PNG,
      mediaType: 'application/octet-stream',
      visibility: 'private',
    });
    expect((await driver.get('private/s1/docs/x.bin'))!.mediaType).toBe('application/octet-stream');
  });

  it('refuses a key that escapes the storage root', async () => {
    // buildKey already makes this unreachable, which is exactly why the check
    // is duplicated here — a guard that only exists where you expect the attack
    // is a guard you delete during a refactor.
    await expect(
      driver.put({
        key: '../../escaped.png',
        body: PNG,
        mediaType: 'image/png',
        visibility: 'public',
      }),
    ).rejects.toThrow(/escapes the storage root/);
  });

  it('treats deleting something already gone as success', async () => {
    await expect(driver.delete('public/s1/logo/never-existed.png')).resolves.toBeUndefined();
  });

  it('actually deletes', async () => {
    const key = 'public/s1/logo/temp.png';
    await driver.put({ key, body: PNG, mediaType: 'image/png', visibility: 'public' });
    expect(await driver.get(key)).not.toBeNull();
    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
  });
});
