/**
 * =============================================================================
 * DIGITAL RESOURCE LIBRARY
 * =============================================================================
 *
 * Pure: targeting, search relevance, view de-duplication, usage summaries.
 * No Prisma, no clock — anything time-dependent takes `now` as an argument.
 *
 * Scoped to DIGITAL resources by an explicit product decision: no copies, no
 * loans, no due dates, no reservations, no fines. That removes the entire
 * circulation model, which is most of what makes a library system large. What
 * is left is the part a school actually uses day to day — finding the right
 * material, and knowing whether anyone read it.
 */

import { isSafeUrl } from './markdown';
import type { Role } from './enums';

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

// -----------------------------------------------------------------------------
// Targeting
// -----------------------------------------------------------------------------

export type ResourceAudience = 'ALL' | 'STAFF' | 'STUDENT';

/**
 * Who a resource is for.
 *
 * Targeting is ADDITIVE and each dimension is optional. An empty list on a
 * dimension means "no restriction on this dimension", NOT "matches nothing" —
 * which is the reading that makes an unconfigured resource visible to the
 * school rather than invisible to everyone.
 *
 * That default is deliberate and is the safe one HERE, though it would not be
 * elsewhere: this is a school's own library, the audience gate above it has
 * already separated staff from students, and a librarian who uploads a reading
 * list and finds nobody can see it will conclude the software is broken. The
 * confidential case is served by `audience: 'STAFF'`, which is a deliberate
 * act rather than an omission.
 */
export interface ResourceTargeting {
  audience: ResourceAudience;
  /** Programme ids. Empty: every programme. */
  programIds: readonly string[];
  /** Year-group ids, for K-12. Empty: every year group. */
  yearGroupIds: readonly string[];
  /** Levels (100, 200 …), for higher education. Empty: every level. */
  levels: readonly number[];
}

export interface ResourceViewer {
  role: Role;
  /** Null for staff, or a student with no programme yet. */
  programId: string | null;
  yearGroupId: string | null;
  level: number | null;
}

const STAFF_ROLES = new Set<Role>([
  'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF',
]);

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.has(role);
}

/**
 * ALGORITHM: RESOURCE VISIBILITY
 * ------------------------------
 *   audience gate  -> STAFF resources are staff-only, always
 *   programme gate -> pass if unrestricted, or the viewer's programme is listed
 *   year gate      -> pass if unrestricted, or the viewer's year group is listed
 *   level gate     -> pass if unrestricted, or the viewer's level is listed
 *
 * Staff bypass the programme, year and level gates but NOT the audience gate.
 * A lecturer must be able to see the reading list they set for a programme they
 * do not personally belong to; that is the whole point of the targeting being
 * about students. The audience gate is different in kind — it is the
 * confidentiality boundary, and nothing bypasses it upward.
 *
 * A student with a null programme fails a programme-restricted resource. That
 * is intentional: "unknown" must not satisfy a restriction, or an incompletely
 * set-up record would quietly widen access.
 */
export function canAccessResource(
  viewer: ResourceViewer,
  targeting: ResourceTargeting,
): boolean {
  const staff = isStaffRole(viewer.role);

  if (targeting.audience === 'STAFF' && !staff) return false;
  // A guardian or applicant is neither staff nor a student of the school in the
  // sense this library means, so they see nothing. Their access to a child's
  // material runs through the guardian portal, not here.
  if (!staff && viewer.role !== 'STUDENT') return false;

  if (staff) return true;

  if (targeting.programIds.length > 0) {
    if (viewer.programId === null) return false;
    if (!targeting.programIds.includes(viewer.programId)) return false;
  }
  if (targeting.yearGroupIds.length > 0) {
    if (viewer.yearGroupId === null) return false;
    if (!targeting.yearGroupIds.includes(viewer.yearGroupId)) return false;
  }
  if (targeting.levels.length > 0) {
    if (viewer.level === null) return false;
    if (!targeting.levels.includes(viewer.level)) return false;
  }
  return true;
}

/** Only librarians and administrators may add or edit resources. */
export function canManageLibrary(role: Role): boolean {
  return role === 'LIBRARIAN' || role === 'ADMIN' || role === 'REGISTRAR';
}

// -----------------------------------------------------------------------------
// Resource kinds and links
// -----------------------------------------------------------------------------

export const RESOURCE_KINDS = ['EBOOK', 'DOCUMENT', 'LINK', 'VIDEO', 'AUDIO', 'DATASET'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Validate a resource URL.
 *
 * Reuses the SAME scheme allowlist the forum renderer uses. A library entry is
 * every bit as much a stored, user-supplied URL rendered as a link in someone
 * else's browser as a forum post is — a `javascript:` URL in a catalogue record
 * is the identical vector, and having two different notions of "safe link" in
 * one codebase is how one of them ends up weaker.
 */
export function isValidResourceUrl(url: string): boolean {
  return isSafeUrl(url);
}

// -----------------------------------------------------------------------------
// Tags
// -----------------------------------------------------------------------------

/**
 * Normalise a free-text tag list.
 *
 * Case-folded, trimmed, de-duplicated, capped. Without normalisation
 * "Algebra", "algebra" and " algebra " are three different facets in the
 * filter sidebar, and the reader concludes the search is broken.
 */
export function normaliseTags(raw: string | readonly string[], limit = 12): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tag = String(part).trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag.length === 0 || tag.length > 40) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

export interface SearchableResource {
  id: string;
  title: string;
  authors: string;
  description: string | null;
  tags: readonly string[];
  kind: ResourceKind;
  viewCount: number;
  publishedAt: Date | null;
}

export interface ScoredResource<T> {
  resource: T;
  score: number;
}

/**
 * ALGORITHM: SEARCH RELEVANCE
 * ---------------------------
 * A weighted field match, deliberately simple and entirely in-process.
 *
 *   exact title match          100
 *   title starts with query     60
 *   title contains query        40
 *   author contains query       25
 *   exact tag match             20
 *   tag contains query          10
 *   description contains query   5
 *   + log-scaled popularity      up to ~5
 *
 * **Why not full-text search in the database.** A school library is hundreds to
 * low thousands of records, not millions. A single indexed scan plus scoring in
 * memory is faster than the round trips a ranked SQL query would need, and it
 * is PORTABLE — SQLite's FTS5 and Postgres's tsvector have different syntax,
 * different ranking, and different results, which would make the development
 * database quietly disagree with production. When the catalogue outgrows this,
 * the replacement is a search index, not a clever query.
 *
 * **Popularity is log-scaled and small.** It breaks ties between equally
 * relevant records without letting one heavily-viewed item dominate every
 * search — the failure where the most popular book is the top answer to every
 * question regardless of what was asked.
 *
 * Ties break on title then id, so the order is TOTAL and paging is stable.
 */
export function scoreResource(resource: SearchableResource, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;

  const title = resource.title.toLowerCase();
  const authors = resource.authors.toLowerCase();
  const description = (resource.description ?? '').toLowerCase();

  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 40;

  if (authors.includes(q)) score += 25;

  for (const tag of resource.tags) {
    if (tag === q) score += 20;
    else if (tag.includes(q)) score += 10;
  }

  if (description.includes(q)) score += 5;

  // Nothing matched: popularity must not float an irrelevant record into the
  // results. A zero here means "excluded", and the caller filters on it.
  if (score === 0) return 0;

  return score + Math.log10(resource.viewCount + 1);
}

export function searchResources<T extends SearchableResource>(
  resources: readonly T[],
  query: string,
): T[] {
  const q = query.trim();
  if (q === '') {
    // No query: newest first, which is the useful default for a catalogue
    // somebody is browsing rather than searching.
    return [...resources].sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  }

  return resources
    .map((resource) => ({ resource, score: scoreResource(resource, q) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.resource.title.localeCompare(b.resource.title) ||
        a.resource.id.localeCompare(b.resource.id),
    )
    .map((s) => s.resource);
}

/** Facet counts for the filter sidebar, computed over the CURRENT result set. */
export function tagFacets(
  resources: readonly SearchableResource[],
  limit = 20,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of resources) {
    for (const tag of r.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    // Commonest first, then alphabetical, so the sidebar does not reshuffle
    // between two identical searches.
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

// -----------------------------------------------------------------------------
// View tracking
// -----------------------------------------------------------------------------

/** A view by the same person within this window is the same visit. */
export const VIEW_DEDUPE_MINUTES = 30;

/**
 * ALGORITHM: VIEW DE-DUPLICATION
 * ------------------------------
 * Should this open be counted?
 *
 * Counting every page load makes the usage figures worthless: a reader who
 * refreshes, or opens a resource in three tabs, or navigates back to it twice
 * while writing an essay, registers as three or five or ten "reads". A head of
 * department deciding whether to renew a subscription would be reading noise.
 *
 * So a view by the same person inside the window is treated as the same visit.
 * The window is generous (30 minutes) because the risk is asymmetric:
 * over-counting produces a number that flatters the library and misleads a
 * purchasing decision, whereas under-counting a genuine second visit an hour
 * later costs almost nothing.
 *
 * This is per-person, not per-session or per-IP: a shared library terminal must
 * not collapse ten students into one reader.
 */
export function shouldCountView(
  lastViewedAt: Date | null,
  now: Date,
  windowMinutes = VIEW_DEDUPE_MINUTES,
): boolean {
  if (lastViewedAt === null) return true;
  const minutes = (now.getTime() - lastViewedAt.getTime()) / 60_000;
  // A clock skew that puts the last view in the future must not permanently
  // suppress counting.
  if (minutes < 0) return true;
  return minutes >= windowMinutes;
}

// -----------------------------------------------------------------------------
// Usage analytics
// -----------------------------------------------------------------------------

export interface UsageRecord {
  resourceId: string;
  membershipId: string;
  viewedAt: Date;
}

export interface UsageSummary {
  totalViews: number;
  /** Distinct people, which is the number that answers "is this used?" */
  uniqueReaders: number;
  viewsLast7Days: number;
  viewsLast30Days: number;
  /**
   * Resources with no view AMONG THE RECORDS PASSED IN.
   *
   * Named carefully, because the obvious reading is wrong: if the caller has
   * already windowed `views` to the last 90 days, this counts "not opened in
   * 90 days", NOT "never opened". Those diverge the moment the library is
   * older than the window, and a dashboard that puts one figure next to a list
   * built from the other is lying to somebody making a renewal decision.
   *
   * `libraryAnalytics` therefore does not use this for its headline figure; it
   * computes the all-time count from `viewCount`. This stays because it is the
   * right number for a windowed report.
   */
  unviewedInRange: number;
}

/**
 * Summarise usage.
 *
 * Reports unique readers ALONGSIDE total views, never instead of. They answer
 * different questions: 400 views by 3 people is a very different library from
 * 400 views by 300 people, and a dashboard showing only the total cannot tell
 * a head of department which one they have.
 *
 * `unviewedInRange` is reported because it is the actionable figure — the
 * entries nobody opened are the ones worth questioning, and they are
 * invisible in any view-weighted ranking. Read its doc comment before using
 * it: it is relative to the records passed in, not to all time.
 */
export function summariseUsage(
  views: readonly UsageRecord[],
  totalResources: number,
  now: Date,
): UsageSummary {
  const day = 24 * 60 * 60 * 1000;
  const viewedResources = new Set(views.map((v) => v.resourceId));

  return {
    totalViews: views.length,
    uniqueReaders: new Set(views.map((v) => v.membershipId)).size,
    viewsLast7Days: views.filter((v) => now.getTime() - v.viewedAt.getTime() < 7 * day).length,
    viewsLast30Days: views.filter((v) => now.getTime() - v.viewedAt.getTime() < 30 * day).length,
    unviewedInRange: Math.max(0, totalResources - viewedResources.size),
  };
}

/** The most-read resources, for a librarian's dashboard. */
export function topResources(
  views: readonly UsageRecord[],
  limit = 10,
): { resourceId: string; views: number; readers: number }[] {
  const byResource = new Map<string, { views: number; readers: Set<string> }>();
  for (const v of views) {
    const entry = byResource.get(v.resourceId) ?? { views: 0, readers: new Set<string>() };
    entry.views += 1;
    entry.readers.add(v.membershipId);
    byResource.set(v.resourceId, entry);
  }

  return [...byResource.entries()]
    .map(([resourceId, e]) => ({ resourceId, views: e.views, readers: e.readers.size }))
    .sort((a, b) => b.readers - a.readers || b.views - a.views || a.resourceId.localeCompare(b.resourceId))
    .slice(0, limit);
}
