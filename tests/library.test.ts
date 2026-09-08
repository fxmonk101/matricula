import { describe, expect, it } from 'vitest';

import {
  canAccessResource,
  canManageLibrary,
  isValidResourceUrl,
  normaliseTags,
  scoreResource,
  searchResources,
  shouldCountView,
  summariseUsage,
  tagFacets,
  topResources,
  type ResourceTargeting,
  type ResourceViewer,
  type SearchableResource,
  type UsageRecord,
} from '@/lib/domain/library';

const NOW = new Date('2026-03-15T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function targeting(over: Partial<ResourceTargeting> = {}): ResourceTargeting {
  return { audience: 'ALL', programIds: [], yearGroupIds: [], levels: [], ...over };
}

function viewer(over: Partial<ResourceViewer> = {}): ResourceViewer {
  return { role: 'STUDENT', programId: 'prog-cs', yearGroupId: null, level: 200, ...over };
}

// -----------------------------------------------------------------------------
describe('resource visibility', () => {
  it('shows an untargeted resource to any student', () => {
    // An empty dimension means "no restriction", not "matches nothing" — a
    // librarian who uploads a reading list must not find it invisible.
    expect(canAccessResource(viewer(), targeting())).toBe(true);
  });

  it('keeps staff-only material away from students', () => {
    expect(canAccessResource(viewer(), targeting({ audience: 'STAFF' }))).toBe(false);
    expect(
      canAccessResource(viewer({ role: 'INSTRUCTOR' }), targeting({ audience: 'STAFF' })),
    ).toBe(true);
  });

  it('lets staff past programme, year and level gates', () => {
    // A lecturer must see the reading list they set for a programme they do
    // not personally belong to.
    const restricted = targeting({ programIds: ['other'], levels: [400], yearGroupIds: ['y9'] });
    expect(canAccessResource(viewer({ role: 'INSTRUCTOR', programId: null, level: null }), restricted)).toBe(true);
  });

  it('does NOT let staff past the audience gate upward', () => {
    // The audience gate is the confidentiality boundary; the others are about
    // relevance. Only the first is absolute.
    expect(canAccessResource(viewer({ role: 'LIBRARIAN' }), targeting({ audience: 'STAFF' }))).toBe(true);
    expect(canAccessResource(viewer({ role: 'STUDENT' }), targeting({ audience: 'STAFF' }))).toBe(false);
  });

  it('restricts by programme', () => {
    const t = targeting({ programIds: ['prog-cs'] });
    expect(canAccessResource(viewer({ programId: 'prog-cs' }), t)).toBe(true);
    expect(canAccessResource(viewer({ programId: 'prog-law' }), t)).toBe(false);
  });

  it('treats an unknown programme as failing a programme restriction', () => {
    // "Unknown" must not satisfy a restriction, or an incompletely set-up
    // student record quietly widens access.
    expect(canAccessResource(viewer({ programId: null }), targeting({ programIds: ['prog-cs'] }))).toBe(false);
  });

  it('restricts by level', () => {
    const t = targeting({ levels: [300, 400] });
    expect(canAccessResource(viewer({ level: 400 }), t)).toBe(true);
    expect(canAccessResource(viewer({ level: 100 }), t)).toBe(false);
  });

  it('restricts by year group for K-12', () => {
    const t = targeting({ yearGroupIds: ['y7'] });
    expect(canAccessResource(viewer({ yearGroupId: 'y7' }), t)).toBe(true);
    expect(canAccessResource(viewer({ yearGroupId: 'y8' }), t)).toBe(false);
  });

  it('requires every restricted dimension to pass', () => {
    const t = targeting({ programIds: ['prog-cs'], levels: [400] });
    expect(canAccessResource(viewer({ programId: 'prog-cs', level: 400 }), t)).toBe(true);
    // Right programme, wrong level.
    expect(canAccessResource(viewer({ programId: 'prog-cs', level: 100 }), t)).toBe(false);
  });

  it('shows nothing to guardians or applicants', () => {
    // Their access to a child's material runs through the guardian portal.
    for (const role of ['GUARDIAN', 'APPLICANT'] as const) {
      expect(canAccessResource(viewer({ role }), targeting())).toBe(false);
    }
  });

  it('grants management to librarians and administrators only', () => {
    expect(canManageLibrary('LIBRARIAN')).toBe(true);
    expect(canManageLibrary('ADMIN')).toBe(true);
    expect(canManageLibrary('INSTRUCTOR')).toBe(false);
    expect(canManageLibrary('STUDENT')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('resource URLs', () => {
  it('accepts ordinary links', () => {
    expect(isValidResourceUrl('https://doi.org/10.1000/xyz')).toBe(true);
    expect(isValidResourceUrl('/uploads/reading-list.pdf')).toBe(true);
  });

  it('refuses script-bearing schemes, exactly as the forum renderer does', () => {
    // A catalogue record is a stored, user-supplied URL rendered as a link in
    // someone else's browser — the identical vector to a forum post.
    expect(isValidResourceUrl('javascript:alert(1)')).toBe(false);
    expect(isValidResourceUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidResourceUrl('//evil.example/x')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('tag normalisation', () => {
  it('case-folds, trims and de-duplicates', () => {
    // Otherwise "Algebra", "algebra" and " algebra " are three facets.
    expect(normaliseTags(' Algebra , algebra,ALGEBRA ')).toEqual(['algebra']);
  });

  it('accepts a comma string or an array', () => {
    expect(normaliseTags('a, b')).toEqual(['a', 'b']);
    expect(normaliseTags(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('collapses internal whitespace', () => {
    expect(normaliseTags(['linear    algebra'])).toEqual(['linear algebra']);
  });

  it('drops empties and over-long tags', () => {
    expect(normaliseTags([' ', '', 'x'.repeat(60), 'ok'])).toEqual(['ok']);
  });

  it('caps the count', () => {
    expect(normaliseTags(Array.from({ length: 40 }, (_, i) => `t${i}`), 5)).toHaveLength(5);
  });
});

// -----------------------------------------------------------------------------
function res(over: Partial<SearchableResource> = {}): SearchableResource {
  return {
    id: 'r1',
    title: 'Linear Algebra Done Right',
    authors: 'Sheldon Axler',
    description: 'Vector spaces and linear maps.',
    tags: ['algebra', 'mathematics'],
    kind: 'EBOOK',
    viewCount: 0,
    publishedAt: daysAgo(10),
    ...over,
  };
}

describe('search relevance', () => {
  it('ranks an exact title match above a partial one', () => {
    const exact = res({ id: 'a', title: 'algebra' });
    const partial = res({ id: 'b', title: 'Introduction to algebra methods' });
    expect(scoreResource(exact, 'algebra')).toBeGreaterThan(scoreResource(partial, 'algebra'));
  });

  it('ranks a title prefix above a mid-title match', () => {
    const prefix = res({ id: 'a', title: 'Algebra for engineers' });
    const middle = res({ id: 'b', title: 'Notes on algebra for engineers' });
    expect(scoreResource(prefix, 'algebra')).toBeGreaterThan(scoreResource(middle, 'algebra'));
  });

  it('ranks a title match above an author match', () => {
    const byTitle = res({ id: 'a', title: 'Axler methods', authors: 'Someone Else' });
    const byAuthor = res({ id: 'b', title: 'Unrelated', authors: 'Axler' });
    expect(scoreResource(byTitle, 'axler')).toBeGreaterThan(scoreResource(byAuthor, 'axler'));
  });

  it('scores an exact tag above a partial tag', () => {
    const exact = res({ id: 'a', title: 'X', authors: '', description: null, tags: ['algebra'] });
    const partial = res({ id: 'b', title: 'X', authors: '', description: null, tags: ['algebraic geometry'] });
    expect(scoreResource(exact, 'algebra')).toBeGreaterThan(scoreResource(partial, 'algebra'));
  });

  it('returns zero when nothing matches, so popularity cannot float it in', () => {
    const popular = res({ title: 'Poetry', authors: 'X', description: null, tags: [], viewCount: 9999 });
    expect(scoreResource(popular, 'thermodynamics')).toBe(0);
  });

  it('uses popularity only to break ties, never to dominate', () => {
    // The failure this prevents: the most-viewed book being the top answer to
    // every query regardless of what was asked.
    const popularWeak = res({ id: 'a', title: 'Notes mentioning algebra briefly', viewCount: 100000 });
    const unpopularStrong = res({ id: 'b', title: 'algebra', viewCount: 0 });
    expect(scoreResource(unpopularStrong, 'algebra')).toBeGreaterThan(
      scoreResource(popularWeak, 'algebra'),
    );
  });

  it('does break a genuine tie on popularity', () => {
    const a = res({ id: 'a', title: 'algebra', viewCount: 50 });
    const b = res({ id: 'b', title: 'algebra', viewCount: 0 });
    expect(scoreResource(a, 'algebra')).toBeGreaterThan(scoreResource(b, 'algebra'));
  });

  it('is case-insensitive', () => {
    expect(scoreResource(res(), 'LINEAR ALGEBRA DONE RIGHT')).toBeGreaterThan(0);
  });

  it('excludes non-matching resources from results', () => {
    const list = [res({ id: 'a', title: 'Algebra' }), res({ id: 'b', title: 'Poetry', tags: [], description: null, authors: '' })];
    expect(searchResources(list, 'algebra').map((r) => r.id)).toEqual(['a']);
  });

  it('falls back to newest-first when the query is empty', () => {
    const list = [
      res({ id: 'old', publishedAt: daysAgo(100) }),
      res({ id: 'new', publishedAt: daysAgo(1) }),
    ];
    expect(searchResources(list, '   ').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('is a total order — the same query returns the same order regardless of input order', () => {
    const list = [
      res({ id: 'c', title: 'algebra' }),
      res({ id: 'a', title: 'algebra' }),
      res({ id: 'b', title: 'algebra' }),
    ];
    const forward = searchResources(list, 'algebra').map((r) => r.id);
    const backward = searchResources([...list].reverse(), 'algebra').map((r) => r.id);
    expect(forward).toEqual(['a', 'b', 'c']);
    expect(backward).toEqual(forward);
  });

  it('does not mutate the input', () => {
    const list = [res({ id: 'a' }), res({ id: 'b' })];
    const copy = [...list];
    searchResources(list, 'algebra');
    expect(list).toEqual(copy);
  });
});

describe('tag facets', () => {
  it('counts tags over the current result set, commonest first', () => {
    const list = [
      res({ id: 'a', tags: ['algebra', 'maths'] }),
      res({ id: 'b', tags: ['algebra'] }),
      res({ id: 'c', tags: ['poetry'] }),
    ];
    expect(tagFacets(list)).toEqual([
      { tag: 'algebra', count: 2 },
      { tag: 'maths', count: 1 },
      { tag: 'poetry', count: 1 },
    ]);
  });

  it('orders equal counts alphabetically so the sidebar does not reshuffle', () => {
    const list = [res({ id: 'a', tags: ['zebra'] }), res({ id: 'b', tags: ['apple'] })];
    expect(tagFacets(list).map((f) => f.tag)).toEqual(['apple', 'zebra']);
  });

  it('handles an empty set', () => {
    expect(tagFacets([])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
describe('view de-duplication', () => {
  it('counts a first view', () => {
    expect(shouldCountView(null, NOW)).toBe(true);
  });

  it('does not count a refresh', () => {
    // Counting every page load makes usage figures worthless for a renewal
    // decision.
    expect(shouldCountView(minsAgo(2), NOW)).toBe(false);
  });

  it('counts a genuine return visit after the window', () => {
    expect(shouldCountView(minsAgo(45), NOW)).toBe(true);
  });

  it('treats the window boundary as a new visit', () => {
    expect(shouldCountView(minsAgo(30), NOW)).toBe(true);
  });

  it('does not let clock skew permanently suppress counting', () => {
    expect(shouldCountView(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
  });

  it('respects a custom window', () => {
    expect(shouldCountView(minsAgo(10), NOW, 5)).toBe(true);
    expect(shouldCountView(minsAgo(2), NOW, 5)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('usage analytics', () => {
  const views: UsageRecord[] = [
    { resourceId: 'r1', membershipId: 'm1', viewedAt: daysAgo(1) },
    { resourceId: 'r1', membershipId: 'm2', viewedAt: daysAgo(2) },
    { resourceId: 'r1', membershipId: 'm1', viewedAt: daysAgo(20) },
    { resourceId: 'r2', membershipId: 'm3', viewedAt: daysAgo(40) },
  ];

  it('reports unique readers alongside total views, never instead', () => {
    // 400 views by 3 people is a very different library from 400 by 300.
    const s = summariseUsage(views, 5, NOW);
    expect(s.totalViews).toBe(4);
    expect(s.uniqueReaders).toBe(3);
  });

  it('windows recent activity', () => {
    const s = summariseUsage(views, 5, NOW);
    expect(s.viewsLast7Days).toBe(2);
    expect(s.viewsLast30Days).toBe(3);
  });

  it('reports never-viewed resources, which no view ranking can show', () => {
    // These are the entries worth questioning at renewal.
    expect(summariseUsage(views, 5, NOW).unviewedInRange).toBe(3);
  });

  it('never reports a negative unviewed count', () => {
    expect(summariseUsage(views, 1, NOW).unviewedInRange).toBe(0);
  });

  it('counts unviewed relative to the records passed in, not to all time', () => {
    // The distinction the field is named for. A caller that windows `views` to
    // 90 days gets "not opened in 90 days", which is NOT "never opened" — and a
    // dashboard putting one figure beside a list built from the other would
    // mislead somebody making a renewal decision. `libraryAnalytics` therefore
    // computes its headline figure from the all-time counter instead.
    const windowed = views.filter((v) => NOW.getTime() - v.viewedAt.getTime() < 7 * 86_400_000);
    expect(summariseUsage(windowed, 5, NOW).unviewedInRange).toBe(4);
    expect(summariseUsage(views, 5, NOW).unviewedInRange).toBe(3);
  });

  it('handles no views at all', () => {
    const s = summariseUsage([], 4, NOW);
    expect(s).toMatchObject({ totalViews: 0, uniqueReaders: 0, unviewedInRange: 4 });
  });

  it('ranks top resources by distinct readers before raw views', () => {
    // One obsessive reader should not outrank genuine breadth of use.
    const skewed: UsageRecord[] = [
      ...Array.from({ length: 10 }, () => ({ resourceId: 'obsessed', membershipId: 'm1', viewedAt: daysAgo(1) })),
      { resourceId: 'broad', membershipId: 'a', viewedAt: daysAgo(1) },
      { resourceId: 'broad', membershipId: 'b', viewedAt: daysAgo(1) },
      { resourceId: 'broad', membershipId: 'c', viewedAt: daysAgo(1) },
    ];
    expect(topResources(skewed)[0].resourceId).toBe('broad');
  });

  it('is deterministic on a full tie', () => {
    const tied: UsageRecord[] = [
      { resourceId: 'b', membershipId: 'm1', viewedAt: NOW },
      { resourceId: 'a', membershipId: 'm1', viewedAt: NOW },
    ];
    expect(topResources(tied).map((r) => r.resourceId)).toEqual(['a', 'b']);
  });

  it('respects the limit', () => {
    const many: UsageRecord[] = Array.from({ length: 30 }, (_, i) => ({
      resourceId: `r${i}`, membershipId: `m${i}`, viewedAt: NOW,
    }));
    expect(topResources(many, 5)).toHaveLength(5);
  });
});
