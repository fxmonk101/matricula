/**
 * Local-disk storage driver, for development.
 *
 * Writes under `STORAGE_ROOT` (default `.storage/`), which is OUTSIDE `public/`
 * and therefore not served by Next.js directly — every read goes through the
 * route handler that checks the session. That is the whole reason not to take
 * the easy path of writing into `public/uploads`.
 *
 * Not suitable for production behind more than one instance: two servers do not
 * share a disk, and a container redeploy loses it. The S3 driver replaces this
 * one behind the same interface; nothing above the driver changes.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import type { StorageDriver, Visibility } from './index';

/** Extension → media type, for reads. The key's extension was set by us. */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export class LocalDiskDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(process.cwd(), root);
  }

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the root.
   *
   * `buildKey` already constrains every component, so this should be
   * unreachable — which is exactly why it is here. A traversal check that only
   * exists where you expect the attack is a check you removed when you
   * refactored the caller.
   */
  private pathFor(key: string): string {
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Storage key escapes the storage root.');
    }
    return target;
  }

  async put(params: {
    key: string;
    body: Uint8Array;
    mediaType: string;
    visibility: Visibility;
  }): Promise<void> {
    const path = this.pathFor(params.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, params.body);
  }

  async get(key: string): Promise<{ body: Uint8Array; mediaType: string } | null> {
    try {
      const path = this.pathFor(key);
      const body = await readFile(path);
      const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      return {
        body: new Uint8Array(body),
        // Falls back to a type the browser will never execute. An unknown
        // extension should download, not run.
        mediaType: MEDIA_TYPES[extension] ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key), { force: true });
    } catch {
      // Deleting something already gone is success, not an error.
    }
  }

  /** Absolute path of the root, for diagnostics. */
  describe(): string {
    return join(this.root);
  }
}
