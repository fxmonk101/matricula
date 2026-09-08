import { describe, expect, it } from 'vitest';

import {
  acceptsReplies,
  applyModeration,
  AUTO_HIDE_REPORTS,
  canEditPost,
  canModerate,
  canPostInAudience,
  canReadAudience,
  checkRateLimit,
  hotScore,
  paginate,
  sortThreads,
  type ModerationState,
  type RankableThread,
} from '@/lib/domain/forum';

const NOW = new Date('2026-03-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

function thread(over: Partial<RankableThread> = {}): RankableThread {
  return {
    id: 'a',
    title: 'A thread',
    isPinned: false,
    createdAt: hoursAgo(1),
    lastPostAt: null,
    postCount: 0,
    reactionCount: 0,
    ...over,
  };
}

// -----------------------------------------------------------------------------
describe('hot ranking', () => {
  it('ranks a busier thread above a quieter one of the same age', () => {
    const busy = thread({ id: 'busy', postCount: 20 });
    const quiet = thread({ id: 'quiet', postCount: 2 });
    expect(hotScore(busy, NOW)).toBeGreaterThan(hotScore(quiet, NOW));
  });

  it('decays with age, so the front page does not ossify', () => {
    // Without decay "hot" is just "most replies ever", and a thread that went
    // viral in first term owns the page until the year ends.
    const old = thread({ id: 'old', postCount: 40, createdAt: hoursAgo(200) });
    const fresh = thread({ id: 'fresh', postCount: 10, createdAt: hoursAgo(3) });
    expect(hotScore(fresh, NOW)).toBeGreaterThan(hotScore(old, NOW));
  });

  it('does not let a minutes-old thread rocket to the top on one reply', () => {
    // This is what the +2 offset in the denominator is for.
    const newborn = thread({ id: 'new', postCount: 1, createdAt: NOW });
    const established = thread({ id: 'est', postCount: 12, createdAt: hoursAgo(4) });
    expect(hotScore(established, NOW)).toBeGreaterThan(hotScore(newborn, NOW));
  });

  it('counts reactions as engagement alongside replies', () => {
    const reacted = thread({ id: 'r', postCount: 1, reactionCount: 15 });
    const plain = thread({ id: 'p', postCount: 1, reactionCount: 0 });
    expect(hotScore(reacted, NOW)).toBeGreaterThan(hotScore(plain, NOW));
  });

  it('scores an empty thread at zero rather than dividing by zero', () => {
    expect(hotScore(thread({ createdAt: NOW }), NOW)).toBe(0);
  });

  it('treats a future timestamp as age zero rather than going negative', () => {
    const future = thread({ postCount: 5, createdAt: new Date(NOW.getTime() + 3600_000) });
    expect(hotScore(future, NOW)).toBeGreaterThan(0);
  });
});

describe('thread ordering', () => {
  it('floats pinned threads in every mode', () => {
    // Pinning is how a school says "read this" — a sort that can bury an exam
    // timetable defeats the feature.
    const list = [
      thread({ id: 'busy', postCount: 100, createdAt: hoursAgo(1) }),
      thread({ id: 'pinned', isPinned: true, postCount: 0, createdAt: hoursAgo(500) }),
    ];
    for (const mode of ['hot', 'new', 'top'] as const) {
      expect(sortThreads(list, mode, NOW)[0].id).toBe('pinned');
    }
  });

  it('sorts "new" by latest activity, not creation', () => {
    // A question asked in September with an answer today is live.
    const answered = thread({ id: 'answered', createdAt: hoursAgo(500), lastPostAt: hoursAgo(1) });
    const dead = thread({ id: 'dead', createdAt: hoursAgo(2), lastPostAt: null });
    expect(sortThreads([dead, answered], 'new', NOW)[0].id).toBe('answered');
  });

  it('sorts "top" by raw engagement, ignoring age', () => {
    const old = thread({ id: 'old', postCount: 90, createdAt: hoursAgo(900) });
    const recent = thread({ id: 'recent', postCount: 5, createdAt: hoursAgo(1) });
    expect(sortThreads([recent, old], 'top', NOW)[0].id).toBe('old');
  });

  it('is a total order — the same input sorts the same way regardless of arrival', () => {
    // Without this, pagination skips and repeats items, which reads as data loss.
    const list = [
      thread({ id: 'c', postCount: 5, createdAt: hoursAgo(2) }),
      thread({ id: 'a', postCount: 5, createdAt: hoursAgo(2) }),
      thread({ id: 'b', postCount: 5, createdAt: hoursAgo(2) }),
    ];
    const forward = sortThreads(list, 'hot', NOW).map((t) => t.id);
    const backward = sortThreads([...list].reverse(), 'hot', NOW).map((t) => t.id);
    expect(forward).toEqual(['a', 'b', 'c']);
    expect(backward).toEqual(forward);
  });

  it('does not mutate the input array', () => {
    const list = [thread({ id: 'a' }), thread({ id: 'b', postCount: 9 })];
    const copy = [...list];
    sortThreads(list, 'top', NOW);
    expect(list).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(sortThreads([], 'hot', NOW)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
describe('rate limiting', () => {
  const clean = { recentPostTimes: [], recentThreadTimes: [], isNewThread: false };

  it('allows an ordinary post', () => {
    expect(checkRateLimit(clean, NOW).allowed).toBe(true);
  });

  it('refuses a post that follows too closely', () => {
    const v = checkRateLimit({ ...clean, recentPostTimes: [secondsAgo(5)] }, NOW);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(15);
  });

  it('says when to try again, not merely no', () => {
    // "Rate limited" makes a person hammer the button.
    const v = checkRateLimit({ ...clean, recentPostTimes: [secondsAgo(5)] }, NOW);
    expect(v.reason).toMatch(/15 seconds/);
  });

  it('allows a post once the gap has elapsed', () => {
    expect(checkRateLimit({ ...clean, recentPostTimes: [secondsAgo(25)] }, NOW).allowed).toBe(true);
  });

  it('enforces an hourly ceiling', () => {
    const times = Array.from({ length: 30 }, (_, i) => secondsAgo(60 + i * 60));
    const v = checkRateLimit({ ...clean, recentPostTimes: times }, NOW);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/30 posts an hour/);
  });

  it('ignores posts that have aged out of the hour window', () => {
    const times = Array.from({ length: 40 }, (_, i) => hoursAgo(2 + i));
    expect(checkRateLimit({ ...clean, recentPostTimes: times }, NOW).allowed).toBe(true);
  });

  it('caps new threads per day but still allows replies', () => {
    const threads = Array.from({ length: 10 }, (_, i) => hoursAgo(i + 1));
    const asThread = checkRateLimit(
      { recentPostTimes: [], recentThreadTimes: threads, isNewThread: true },
      NOW,
    );
    expect(asThread.allowed).toBe(false);
    expect(asThread.reason).toMatch(/still reply/);

    const asReply = checkRateLimit(
      { recentPostTimes: [], recentThreadTimes: threads, isNewThread: false },
      NOW,
    );
    expect(asReply.allowed).toBe(true);
  });

  it('respects an overridden policy', () => {
    const v = checkRateLimit(
      { ...clean, recentPostTimes: [secondsAgo(1)] },
      NOW,
      { minSecondsBetweenPosts: 0, maxPostsPerHour: 100, maxThreadsPerDay: 100 },
    );
    expect(v.allowed).toBe(true);
  });
});

// -----------------------------------------------------------------------------
describe('moderation', () => {
  const open: ModerationState = { status: 'OPEN', isPinned: false, reportCount: 0 };

  it('accumulates reports without hiding below the threshold', () => {
    let s = open;
    for (let i = 0; i < AUTO_HIDE_REPORTS - 1; i += 1) s = applyModeration(s, 'REPORT');
    expect(s.reportCount).toBe(AUTO_HIDE_REPORTS - 1);
    expect(s.status).toBe('OPEN');
  });

  it('auto-hides at the threshold — hidden, never deleted', () => {
    // Automatic deletion on a report count is how a coordinated group silences
    // someone they disagree with.
    let s = open;
    for (let i = 0; i < AUTO_HIDE_REPORTS; i += 1) s = applyModeration(s, 'REPORT');
    expect(s.status).toBe('HIDDEN');
  });

  it('keeps the report count when hiding', () => {
    // The count is evidence about how content was received, not a queue counter.
    const s = applyModeration({ ...open, reportCount: 3 }, 'HIDE');
    expect(s.reportCount).toBe(3);
  });

  it('treats DELETED as terminal', () => {
    const deleted = applyModeration(open, 'DELETE');
    for (const action of ['RESTORE', 'UNLOCK', 'PIN', 'REPORT'] as const) {
      expect(applyModeration(deleted, action)).toEqual(deleted);
    }
  });

  it('unpins on delete, so nothing deleted can hold a pinned slot', () => {
    expect(applyModeration({ ...open, isPinned: true }, 'DELETE').isPinned).toBe(false);
  });

  it('only locks an open thread', () => {
    expect(applyModeration(open, 'LOCK').status).toBe('LOCKED');
    // Locking a hidden thread is meaningless — nobody can see it to reply.
    const hidden: ModerationState = { ...open, status: 'HIDDEN' };
    expect(applyModeration(hidden, 'LOCK').status).toBe('HIDDEN');
  });

  it('restores hidden content to open', () => {
    expect(applyModeration({ ...open, status: 'HIDDEN' }, 'RESTORE').status).toBe('OPEN');
  });

  it('never takes the report count below zero', () => {
    expect(applyModeration(open, 'DISMISS_REPORT').reportCount).toBe(0);
  });

  it('allows replies only to open threads', () => {
    expect(acceptsReplies('OPEN')).toBe(true);
    for (const s of ['LOCKED', 'HIDDEN', 'DELETED'] as const) {
      expect(acceptsReplies(s)).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
describe('audience visibility', () => {
  it('keeps students out of the staff room', () => {
    expect(canReadAudience('STUDENT', 'STAFF')).toBe(false);
    expect(canPostInAudience('STUDENT', 'STAFF')).toBe(false);
  });

  it('lets staff read the student forum', () => {
    // Staff need to be able to moderate and answer.
    expect(canReadAudience('INSTRUCTOR', 'STUDENT')).toBe(true);
  });

  it('admits every staff role to the staff forum', () => {
    for (const role of ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF']) {
      expect(canReadAudience(role, 'STAFF')).toBe(true);
    }
  });

  it('excludes guardians and applicants from both forums', () => {
    for (const role of ['GUARDIAN', 'APPLICANT']) {
      expect(canReadAudience(role, 'STAFF')).toBe(false);
      expect(canReadAudience(role, 'STUDENT')).toBe(false);
      expect(canReadAudience(role, 'ALL')).toBe(false);
    }
  });

  it('defaults an unknown role to no access, never to staff', () => {
    expect(canReadAudience('SOMETHING_NEW', 'STAFF')).toBe(false);
    expect(canReadAudience('SOMETHING_NEW', 'STUDENT')).toBe(false);
  });

  it('grants moderator powers by role only', () => {
    expect(canModerate('ADMIN')).toBe(true);
    expect(canModerate('REGISTRAR')).toBe(true);
    expect(canModerate('INSTRUCTOR')).toBe(false);
    expect(canModerate('STUDENT')).toBe(false);
  });
});

describe('post editing', () => {
  const base = {
    viewerMembershipId: 'me',
    authorMembershipId: 'me',
    createdAt: new Date(NOW.getTime() - 5 * 60_000),
    isDeleted: false,
    viewerRole: 'STUDENT',
  };

  it('lets an author edit inside the window', () => {
    expect(canEditPost(base, NOW)).toBe(true);
  });

  it('closes the window after 30 minutes', () => {
    // Silently rewriting a post people have already replied to misrepresents
    // them.
    expect(canEditPost({ ...base, createdAt: new Date(NOW.getTime() - 45 * 60_000) }, NOW)).toBe(false);
  });

  it('never lets one person edit another’s post', () => {
    expect(canEditPost({ ...base, authorMembershipId: 'someone-else' }, NOW)).toBe(false);
  });

  it('exempts moderators from the window', () => {
    expect(
      canEditPost(
        { ...base, viewerRole: 'ADMIN', authorMembershipId: 'x', createdAt: hoursAgo(100) },
        NOW,
      ),
    ).toBe(true);
  });

  it('never edits a deleted post, moderator or not', () => {
    expect(canEditPost({ ...base, isDeleted: true, viewerRole: 'ADMIN' }, NOW)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
describe('pagination', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  it('slices the requested page', () => {
    const p = paginate(items, 2, 20);
    expect(p.items).toEqual(items.slice(20, 40));
    expect(p.page).toBe(2);
    expect(p.totalPages).toBe(3);
  });

  it('clamps a page beyond the end rather than erroring', () => {
    // A page number goes stale simply because somebody deleted a thread.
    const p = paginate(items, 99, 20);
    expect(p.page).toBe(3);
    expect(p.items).toHaveLength(5);
  });

  it('clamps a page below one', () => {
    expect(paginate(items, 0, 20).page).toBe(1);
    expect(paginate(items, -5, 20).page).toBe(1);
  });

  it('reports navigation flags', () => {
    expect(paginate(items, 1, 20)).toMatchObject({ hasPrevious: false, hasNext: true });
    expect(paginate(items, 3, 20)).toMatchObject({ hasPrevious: true, hasNext: false });
  });

  it('handles an empty collection without dividing by zero', () => {
    const p = paginate([], 1, 20);
    expect(p).toMatchObject({ items: [], page: 1, totalPages: 1, hasNext: false, hasPrevious: false });
  });

  it('refuses a page size below one', () => {
    expect(paginate(items, 1, 0).pageSize).toBe(1);
  });

  it('tolerates a non-integer page', () => {
    expect(paginate(items, 2.7, 20).page).toBe(2);
    expect(paginate(items, Number.NaN, 20).page).toBe(1);
  });
});
