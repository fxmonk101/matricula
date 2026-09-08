/**
 * =============================================================================
 * LIBRARY SERVICE
 * =============================================================================
 *
 * Pure decisions — targeting, search relevance, view de-duplication, usage
 * summaries — live in `@/lib/domain/library`. This module reads a consistent
 * snapshot, applies them, and writes results atomically.
 *
 * No `server-only` guard: the seed populates the catalogue.
 */

import { dbFor } from '@/lib/tenant';
import {
  canAccessResource,
  isValidResourceUrl,
  normaliseTags,
  searchResources,
  shouldCountView,
  summariseUsage,
  tagFacets,
  topResources,
  type ResourceKind,
  type ResourceTargeting,
  type ResourceViewer,
  type UsageSummary,
} from '@/lib/domain/library';
import type { Role } from '@/lib/domain/enums';
import { recordAudit } from './audit.service';

export interface LibraryResult {
  ok: boolean;
  message: string;
  resourceId?: string;
}

/**
 * JSON columns are parsed defensively.
 *
 * A corrupt targeting array must not take the whole catalogue page down, and
 * the safe fallback is the RESTRICTIVE reading — an unparseable programme list
 * becomes "no restriction" only because an empty array already means that
 * everywhere else, and inventing a different meaning here would be worse.
 */
function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function targetingOf(row: {
  audience: string;
  programIdsJson: string;
  yearGroupIdsJson: string;
  levelsJson: string;
}): ResourceTargeting {
  return {
    audience: row.audience as ResourceTargeting['audience'],
    programIds: parseJsonArray<string>(row.programIdsJson),
    yearGroupIds: parseJsonArray<string>(row.yearGroupIdsJson),
    levels: parseJsonArray<number>(row.levelsJson),
  };
}

export interface CatalogueItem {
  id: string;
  title: string;
  authors: string;
  description: string | null;
  kind: ResourceKind;
  url: string;
  tags: string[];
  publisher: string | null;
  language: string;
  pageCount: number | null;
  durationMin: number | null;
  viewCount: number;
  publishedAt: Date | null;
  audience: string;
}

/**
 * Resolve who the viewer is, for targeting purposes.
 *
 * Reads the student record so programme and level are the CURRENT ones rather
 * than whatever was true when the session was minted. A student who changes
 * programme should see the new programme's material on their next page load,
 * not after their next sign-in.
 */
export async function resolveViewer(
  schoolId: string,
  role: Role,
  userId: string,
): Promise<ResourceViewer> {
  const db = dbFor(schoolId);
  const student = await db.student.findFirst({
    where: { userId },
    select: { programId: true, level: true },
  });

  const enrolment = student
    ? await db.classEnrolment.findFirst({
        where: { student: { userId } },
        orderBy: { term: { startDate: 'desc' } },
        select: { formClass: { select: { yearGroupId: true } } },
      })
    : null;

  return {
    role,
    programId: student?.programId ?? null,
    level: student?.level ?? null,
    yearGroupId: enrolment?.formClass.yearGroupId ?? null,
  };
}

/**
 * The catalogue this viewer may see, searched and ranked.
 *
 * Targeting is applied in the APPLICATION, not as a `where` clause, because
 * `canAccessResource` is the single definition of who sees what. Expressing the
 * same rule again in SQL would be a second copy to keep in step, and the two
 * would eventually disagree — which in this direction means showing somebody
 * material they should not have.
 *
 * That is affordable precisely because the catalogue is small. It would not be
 * at a million rows, and the note is here so the trade-off is revisited rather
 * than inherited.
 */
export async function browseCatalogue(params: {
  schoolId: string;
  viewer: ResourceViewer;
  query?: string;
  kind?: ResourceKind | null;
  tag?: string | null;
}): Promise<{ items: CatalogueItem[]; facets: { tag: string; count: number }[]; total: number }> {
  const rows = await dbFor(params.schoolId).libraryResource.findMany({
    where: {
      isArchived: false,
      // A draft is not in the catalogue. Only a published resource is.
      publishedAt: { not: null },
      ...(params.kind ? { kind: params.kind } : {}),
    },
  });

  const visible = rows
    .filter((r) => canAccessResource(params.viewer, targetingOf(r)))
    .map((r) => ({
      id: r.id,
      title: r.title,
      authors: r.authors,
      description: r.description,
      kind: r.kind as ResourceKind,
      url: r.url,
      tags: r.tags === '' ? [] : r.tags.split(','),
      publisher: r.publisher,
      language: r.language,
      pageCount: r.pageCount,
      durationMin: r.durationMin,
      viewCount: r.viewCount,
      publishedAt: r.publishedAt,
      audience: r.audience,
    }));

  const tagged = params.tag ? visible.filter((r) => r.tags.includes(params.tag as string)) : visible;
  const items = searchResources(tagged, params.query ?? '');

  return {
    items,
    // Facets are computed BEFORE the tag filter is applied, so selecting a tag
    // does not collapse the sidebar to that single option and strand the
    // reader with no way back.
    facets: tagFacets(visible),
    total: items.length,
  };
}

/** One resource, or null when this viewer may not see it. */
export async function getResource(
  schoolId: string,
  resourceId: string,
  viewer: ResourceViewer,
) {
  const row = await dbFor(schoolId).libraryResource.findUnique({
    where: { id: resourceId },
    include: { addedBy: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });
  if (!row || row.isArchived) return null;
  // A draft is visible to the librarian who is preparing it, not to readers.
  if (row.publishedAt === null && !isLibrarian(viewer.role)) return null;
  if (!canAccessResource(viewer, targetingOf(row))) return null;
  return row;
}

function isLibrarian(role: Role): boolean {
  return role === 'LIBRARIAN' || role === 'ADMIN' || role === 'REGISTRAR';
}

/**
 * Record that somebody opened a resource.
 *
 * De-duplicated per PERSON within a 30-minute window, so a refresh or three
 * open tabs is one read. The view row and the denormalised counter move in the
 * same transaction — the counter exists so a catalogue page is one query, and
 * it is only trustworthy if it can never drift from the rows.
 *
 * Non-throwing: failing to record a view must never stop somebody reading.
 */
export async function recordView(params: {
  schoolId: string;
  resourceId: string;
  membershipId: string;
}): Promise<{ counted: boolean }> {
  const db = dbFor(params.schoolId);
  const now = new Date();

  try {
    const last = await db.resourceView.findFirst({
      where: { resourceId: params.resourceId, membershipId: params.membershipId },
      orderBy: { viewedAt: 'desc' },
      select: { viewedAt: true },
    });

    if (!shouldCountView(last?.viewedAt ?? null, now)) return { counted: false };

    await db.$transaction(async (tx) => {
      await tx.resourceView.create({
        data: {
          schoolId: params.schoolId,
          resourceId: params.resourceId,
          membershipId: params.membershipId,
          viewedAt: now,
        },
      });
      await tx.libraryResource.update({
        where: { id: params.resourceId },
        data: { viewCount: { increment: 1 } },
      });
    });

    return { counted: true };
  } catch (error) {
    console.error('[library] failed to record view', params.resourceId, error);
    return { counted: false };
  }
}

// -----------------------------------------------------------------------------
// Curation
// -----------------------------------------------------------------------------

export interface SaveResourceInput {
  schoolId: string;
  resourceId?: string | null;
  title: string;
  authors: string;
  description?: string | null;
  kind: ResourceKind;
  url: string;
  publisher?: string | null;
  isbn?: string | null;
  language?: string;
  pageCount?: number | null;
  durationMin?: number | null;
  tags: string;
  audience: ResourceTargeting['audience'];
  programIds: readonly string[];
  yearGroupIds: readonly string[];
  levels: readonly number[];
  publish: boolean;
  actorMembershipId: string;
  actorUserId: string | null;
}

/**
 * Create or update a catalogue entry.
 *
 * The URL is validated against the same scheme allowlist the forum renderer
 * uses. A librarian is a trusted role, but "trusted" is about intent, not about
 * being incapable of pasting a hostile link somebody sent them — and the record
 * is rendered as a link in every reader's browser.
 */
export async function saveResource(input: SaveResourceInput): Promise<LibraryResult> {
  const db = dbFor(input.schoolId);

  const title = input.title.trim();
  if (title.length < 2) return { ok: false, message: 'Give the resource a title.' };
  if (title.length > 300) return { ok: false, message: 'That title is too long.' };

  const url = input.url.trim();
  if (!isValidResourceUrl(url)) {
    return {
      ok: false,
      message:
        'That link is not usable. Use an http:// or https:// address, or a path within this site.',
    };
  }

  const data = {
    schoolId: input.schoolId,
    title,
    authors: input.authors.trim(),
    description: input.description?.trim() || null,
    kind: input.kind,
    url,
    publisher: input.publisher?.trim() || null,
    isbn: input.isbn?.trim() || null,
    language: input.language?.trim() || 'en',
    pageCount: input.pageCount ?? null,
    durationMin: input.durationMin ?? null,
    tags: normaliseTags(input.tags).join(','),
    audience: input.audience,
    programIdsJson: JSON.stringify([...input.programIds]),
    yearGroupIdsJson: JSON.stringify([...input.yearGroupIds]),
    levelsJson: JSON.stringify([...input.levels]),
  };

  let resourceId: string;
  if (input.resourceId) {
    const existing = await db.libraryResource.findUnique({ where: { id: input.resourceId } });
    if (!existing) return { ok: false, message: 'Resource not found.' };
    await db.libraryResource.update({
      where: { id: input.resourceId },
      data: {
        ...data,
        // Publishing is a one-way step here: an already-published resource
        // keeps its original publication date, so "new this week" stays
        // truthful across later edits.
        publishedAt: existing.publishedAt ?? (input.publish ? new Date() : null),
      },
    });
    resourceId = input.resourceId;
  } else {
    const created = await db.libraryResource.create({
      data: {
        ...data,
        addedById: input.actorMembershipId,
        publishedAt: input.publish ? new Date() : null,
      },
    });
    resourceId = created.id;
  }

  void recordAudit({
    schoolId: input.schoolId,
    actorId: input.actorUserId,
    action: input.resourceId ? 'library.resource.update' : 'library.resource.create',
    entityType: 'LibraryResource',
    entityId: resourceId,
    summary: `${input.resourceId ? 'Updated' : 'Added'} “${title}” (${input.kind}).`,
  });

  return { ok: true, message: input.resourceId ? 'Resource updated.' : 'Resource added.', resourceId };
}

/**
 * Archive rather than delete.
 *
 * The usage history is what a renewal decision rests on, and a hard delete
 * cascades it away. Archiving removes the entry from the catalogue while
 * leaving the record that it was once held and how much it was used.
 */
export async function archiveResource(params: {
  schoolId: string;
  resourceId: string;
  actorUserId: string | null;
}): Promise<LibraryResult> {
  const db = dbFor(params.schoolId);
  const row = await db.libraryResource.findUnique({ where: { id: params.resourceId } });
  if (!row) return { ok: false, message: 'Resource not found.' };

  await db.libraryResource.update({
    where: { id: params.resourceId },
    data: { isArchived: true },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'library.resource.archive',
    entityType: 'LibraryResource',
    entityId: params.resourceId,
    summary: `Archived “${row.title}”. Usage history retained.`,
  });

  return { ok: true, message: 'Archived. Its usage history is kept.' };
}

// -----------------------------------------------------------------------------
// Analytics
// -----------------------------------------------------------------------------

export interface LibraryAnalytics extends UsageSummary {
  /**
   * Never opened AT ALL, computed from the all-time counter rather than from
   * the windowed view records. This is what the dashboard shows, and it is the
   * same definition the "Never opened" list beside it uses — so the tile and
   * the list cannot drift apart as the catalogue outlives the window.
   */
  neverViewed: number;
  top: { resourceId: string; title: string; views: number; readers: number }[];
  unread: { id: string; title: string; kind: string; publishedAt: Date | null }[];
}

export async function libraryAnalytics(
  schoolId: string,
  days = 90,
): Promise<LibraryAnalytics> {
  const db = dbFor(schoolId);
  const since = new Date(Date.now() - days * 86_400_000);

  const [views, resources] = await Promise.all([
    db.resourceView.findMany({
      where: { viewedAt: { gte: since } },
      select: { resourceId: true, membershipId: true, viewedAt: true },
    }),
    db.libraryResource.findMany({
      where: { isArchived: false, publishedAt: { not: null } },
      select: { id: true, title: true, kind: true, publishedAt: true, viewCount: true },
    }),
  ]);

  const usage = views.map((v) => ({
    resourceId: v.resourceId,
    membershipId: v.membershipId ?? 'departed',
    viewedAt: v.viewedAt,
  }));

  const summary = summariseUsage(usage, resources.length, new Date());
  const neverViewed = resources.filter((r) => r.viewCount === 0).length;
  const byId = new Map(resources.map((r) => [r.id, r]));

  return {
    ...summary,
    neverViewed,
    top: topResources(usage, 10).map((t) => ({
      ...t,
      title: byId.get(t.resourceId)?.title ?? 'Removed resource',
    })),
    // Never opened AT ALL — not merely quiet in the window. These are the
    // entries worth questioning at renewal, and no view-weighted ranking shows
    // them.
    unread: resources
      .filter((r) => r.viewCount === 0)
      .map((r) => ({ id: r.id, title: r.title, kind: r.kind, publishedAt: r.publishedAt }))
      .slice(0, 20),
  };
}
