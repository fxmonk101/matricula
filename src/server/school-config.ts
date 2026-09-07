import { platformDb } from '@/lib/tenant';
import {
  defaultConfigBundle,
  parseSchoolConfig,
  type SchoolConfigBundle,
} from '@/lib/domain/config';

/**
 * =============================================================================
 * SCHOOL CONFIGURATION LOADER
 * =============================================================================
 *
 * Loads and caches the parsed configuration bundle for a school.
 *
 * No `server-only` guard, deliberately: the seed and any maintenance job that
 * recomputes GPAs after a policy change must be able to load a school's real
 * grading scale. A guard here would force those scripts to duplicate the
 * parsing, and duplicated grading policy is exactly the failure this whole
 * phase exists to prevent.
 *
 * CACHING
 * -------
 * A process-local memo keyed by schoolId. The config is read on nearly every
 * request — every grade, every fee, every standing calculation — and it changes
 * only when an administrator saves the settings page. `invalidateConfig` is
 * called from that save, so a stale bundle can never outlive the write that
 * replaced it.
 *
 * The cache is per-process, so a multi-instance deployment can serve a stale
 * bundle on other instances until they next miss. That is acceptable for policy
 * that changes a few times a year and is corrected within one request; a
 * deployment that needs stricter freshness should drop the memo or move it
 * behind a shared cache with an explicit TTL.
 */

const cache = new Map<string, SchoolConfigBundle>();

export async function loadSchoolConfig(schoolId: string): Promise<SchoolConfigBundle> {
  const cached = cache.get(schoolId);
  if (cached) return cached;

  const [school, row] = await Promise.all([
    platformDb.school.findUnique({
      where: { id: schoolId },
      select: { name: true, shortName: true, brandColor: true, logoUrl: true },
    }),
    platformDb.schoolConfig.findUnique({ where: { schoolId } }),
  ]);

  const branding = {
    name: school?.name ?? 'School',
    short: school?.shortName ?? 'School',
    brandColor: school?.brandColor ?? '#1b5df5',
    logoUrl: school?.logoUrl ?? null,
  };

  // A school with no config row yet gets the defaults rather than an error —
  // a freshly provisioned school must be usable before anyone has visited the
  // settings page.
  const bundle = row ? parseSchoolConfig(row, branding) : defaultConfigBundle(branding);

  cache.set(schoolId, bundle);
  return bundle;
}

/** Drop the memo for one school. Called from every config save. */
export function invalidateConfig(schoolId: string): void {
  cache.delete(schoolId);
}

/** Drop everything. For tests and scripts. */
export function invalidateAllConfig(): void {
  cache.clear();
}
