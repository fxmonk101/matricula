/**
 * =============================================================================
 * FILE STORAGE
 * =============================================================================
 *
 * A driver interface with a local-disk implementation for development. The
 * production driver is S3-compatible and slots in behind the same three
 * methods; nothing above this file knows which is in use.
 *
 * TWO VISIBILITY CLASSES, AND THE DISTINCTION IS LOAD-BEARING
 * ----------------------------------------------------------
 *   public   — school logos. These render on the SIGNED-OUT login and apply
 *              pages, so they must be fetchable with no session at all.
 *   private  — application documents, pupil photos. These are only ever served
 *              through a route handler that re-checks the session AND the
 *              tenant, because a URL is not an authorisation.
 *
 * Nothing is written into `public/`. Next.js serves that directory verbatim
 * with no middleware and no session check, so a file placed there is world-
 * readable to anyone who can guess the name — which for a student's medical
 * note or a passport scan is a data breach, not a convenience.
 *
 * Keys are namespaced by school. That is not access control on its own — the
 * route handler is — but it means a listing or a backup of one school's files
 * is a directory, and a mistake in one tenant cannot silently overwrite
 * another's object.
 */

import { randomBytes } from 'node:crypto';

import type { FileTypeSpec } from '@/lib/domain/upload';
import { storedFileName } from '@/lib/domain/upload';

export type Visibility = 'public' | 'private';

export interface StoredObject {
  /** Opaque storage key, e.g. `public/<schoolId>/logo/<id>.png`. */
  key: string;
  mediaType: string;
  bytes: number;
}

export interface StorageDriver {
  put(params: {
    key: string;
    body: Uint8Array;
    mediaType: string;
    visibility: Visibility;
  }): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; mediaType: string } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Build a storage key.
 *
 * Every component is constrained: the school id and the object id are checked
 * against a strict pattern, and the extension comes from the SNIFFED type
 * rather than the uploaded filename. There is therefore no path in this key
 * that a user chose, which is what makes traversal impossible rather than
 * merely unlikely.
 */
export function buildKey(params: {
  visibility: Visibility;
  schoolId: string;
  folder: string;
  id: string;
  type: FileTypeSpec;
}): string {
  const { visibility, schoolId, folder, id, type } = params;
  for (const [label, value] of [
    ['school id', schoolId],
    ['folder', folder],
  ] as const) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error(`Unsafe ${label} in storage key: ${value}`);
    }
  }
  return `${visibility}/${schoolId}/${folder}/${storedFileName(id, type)}`;
}

/** The visibility a key declares, read back from the key itself. */
export function visibilityOf(key: string): Visibility | null {
  if (key.startsWith('public/')) return 'public';
  if (key.startsWith('private/')) return 'private';
  return null;
}

/** The school a key belongs to — used by the route handler to check tenancy. */
export function schoolIdOf(key: string): string | null {
  const parts = key.split('/');
  return parts.length >= 3 ? parts[1] : null;
}

export function newObjectId(): string {
  return randomBytes(16).toString('hex');
}

let driver: StorageDriver | null = null;

/**
 * The active driver.
 *
 * Chosen by environment rather than by import so that the S3 client is never
 * pulled into a development bundle, and so a misconfigured production
 * environment fails loudly at first use rather than silently writing to a disk
 * that will not survive a redeploy.
 */
export async function storage(): Promise<StorageDriver> {
  if (driver) return driver;

  const kind = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();

  if (kind === 'local') {
    /*
     * Refused in production rather than merely discouraged. On a serverless or
     * container host the local disk is either read-only or discarded on the
     * next deploy, so this driver does not fail — it accepts every upload and
     * loses it, which is the worst possible way to be wrong about a student's
     * submission. Better to refuse to start.
     */
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'STORAGE_DRIVER is "local" in production. Uploads would be accepted and then lost ' +
          'on the next deploy. Set STORAGE_DRIVER="s3" and the S3_* variables.',
      );
    }
    const { LocalDiskDriver } = await import('./local-disk');
    driver = new LocalDiskDriver(process.env.STORAGE_ROOT ?? '.storage');
    return driver;
  }

  if (kind === 's3' || kind === 'r2') {
    const { S3Driver, s3ConfigFromEnv } = await import('./s3');
    driver = new S3Driver(s3ConfigFromEnv());
    return driver;
  }

  throw new Error(
    `STORAGE_DRIVER="${kind}" is not a driver this build knows. Use "local" or "s3".`,
  );
}

/** Replace the driver — tests only. */
export function __setStorageDriver(next: StorageDriver | null): void {
  driver = next;
}
