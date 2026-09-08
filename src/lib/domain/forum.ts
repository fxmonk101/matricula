/**
 * =============================================================================
 * FORUM ALGORITHMS
 * =============================================================================
 *
 * Pure. Ranking, rate limiting, moderation state, pagination. Every function
 * that needs the current time takes it as an argument — a function that reads
 * `new Date()` internally can only be tested by waiting.
 *
 * Rendering and sanitisation live in `./markdown`, which is the security
 * boundary; this module is about what gets shown, in what order, to whom.
 */

import type { ForumAudience, ThreadStatus } from './enums';

export class ForumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForumError';
  }
}

const HOUR = 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Ranking
// -----------------------------------------------------------------------------

export type SortMode = 'hot' | 'new' | 'top';

export interface RankableThread {
  id: string;
  title: string;
  isPinned: boolean;
  createdAt: Date;
  lastPostAt: Date | null;
  postCount: number;
  reactionCount: number;
}

/**
 * ALGORITHM: HOT RANKING (gravity decay)
 * --------------------------------------
 *   score = (engagement) / (ageHours + 2) ^ 1.5
 *
 * where engagement = postCount + reactionCount.
 *
 * **Why decay at all.** Without it, "hot" is just "most replies ever", and the
 * front page of a school forum ossifies around whatever thread went viral in
 * first term. A student arriving in March should see March's conversation.
 *
 * **Why +2 in the denominator.** A thread minutes old would otherwise divide by
 * something near zero and rocket to the top on a single reply. The offset makes
 * the first couple of hours flat, so a thread has to earn its position rather
 * than win it by being newest.
 *
 * **Why exponent 1.5.** It is the middle of the useful range. At 1.0 old popular
 * threads linger for days; at 2.0+ anything over a day is effectively invisible,
 * which is wrong for a forum where a question may take a week to get its best
 * answer. 1.5 puts the half-life at roughly a day and a half.
 *
 * These are judgement calls, not physics, and they are written here so the next
 * person can change them knowingly rather than discovering them by surprise.
 */
export function hotScore(thread: RankableThread, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - thread.createdAt.getTime()) / HOUR);
  const engagement = thread.postCount + thread.reactionCount;
  return engagement / Math.pow(ageHours + 2, 1.5);
}

/**
 * Order threads for display.
 *
 * **Pinned threads always float**, in every sort mode, and are ordered among
 * themselves by the same rule as everything else. Pinning is how a school says
 * "read this" — an exam timetable, a safeguarding notice — and a sort order
 * that can bury it defeats the point of the feature.
 *
 * Every comparison ends in an id tie-break, so the order is TOTAL. A list that
 * reshuffles between two identical page loads makes pagination skip and repeat
 * items, which looks like data loss to the reader.
 */
export function sortThreads<T extends RankableThread>(
  threads: readonly T[],
  mode: SortMode,
  now: Date,
): T[] {
  const score = (t: RankableThread): number => {
    switch (mode) {
      case 'hot':
        return hotScore(t, now);
      case 'new':
        // Latest ACTIVITY, not creation: a question asked in September with an
        // answer today is live, and burying it under a dead thread posted an
        // hour ago would hide the conversation people are actually having.
        return (t.lastPostAt ?? t.createdAt).getTime();
      case 'top':
        return t.postCount + t.reactionCount;
    }
  };

  return [...threads].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

// -----------------------------------------------------------------------------
// Rate limiting
// -----------------------------------------------------------------------------

export interface RateLimitPolicy {
  /** Shortest gap between two posts by the same person. */
  minSecondsBetweenPosts: number;
  /** Ceiling on posts in a rolling hour. */
  maxPostsPerHour: number;
  /** Ceiling on new threads in a rolling day. */
  maxThreadsPerDay: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitPolicy = {
  minSecondsBetweenPosts: 20,
  maxPostsPerHour: 30,
  maxThreadsPerDay: 10,
};

export interface RateLimitVerdict {
  allowed: boolean;
  /** Present when refused — shown to the poster verbatim. */
  reason?: string;
  /** Seconds until they may try again. */
  retryAfterSeconds?: number;
}

/**
 * ALGORITHM: RATE LIMITING
 * ------------------------
 * Three limits, because they catch different failures:
 *
 *   - the **gap** catches a double-submitted form and an angry back-and-forth;
 *   - the **hourly cap** catches a script;
 *   - the **daily thread cap** catches someone spraying new threads, which is
 *     far more disruptive than replies because each one takes a slot on the
 *     front page.
 *
 * Refusals say WHEN, not just no. "Try again in 14 seconds" is actionable;
 * "rate limited" makes a person hammer the button.
 *
 * Timestamps come from the caller, newest first, already filtered to this
 * author. Keeping the query out of here is what makes the policy testable.
 */
export function checkRateLimit(
  params: {
    recentPostTimes: readonly Date[];
    recentThreadTimes: readonly Date[];
    isNewThread: boolean;
  },
  now: Date,
  policy: RateLimitPolicy = DEFAULT_RATE_LIMIT,
): RateLimitVerdict {
  const last = params.recentPostTimes[0];
  if (last) {
    const gap = (now.getTime() - last.getTime()) / 1000;
    if (gap < policy.minSecondsBetweenPosts) {
      const wait = Math.ceil(policy.minSecondsBetweenPosts - gap);
      return {
        allowed: false,
        reason: `You are posting very quickly. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
        retryAfterSeconds: wait,
      };
    }
  }

  const inLastHour = params.recentPostTimes.filter(
    (t) => now.getTime() - t.getTime() < HOUR,
  ).length;
  if (inLastHour >= policy.maxPostsPerHour) {
    return {
      allowed: false,
      reason: `You have reached the limit of ${policy.maxPostsPerHour} posts an hour. Please come back shortly.`,
      retryAfterSeconds: 600,
    };
  }

  if (params.isNewThread) {
    const inLastDay = params.recentThreadTimes.filter(
      (t) => now.getTime() - t.getTime() < 24 * HOUR,
    ).length;
    if (inLastDay >= policy.maxThreadsPerDay) {
      return {
        allowed: false,
        reason: `You have started ${policy.maxThreadsPerDay} discussions today, which is the daily limit. You can still reply to existing ones.`,
        retryAfterSeconds: 3600,
      };
    }
  }

  return { allowed: true };
}

// -----------------------------------------------------------------------------
// Moderation
// -----------------------------------------------------------------------------

export type ModerationAction =
  | 'REPORT'
  | 'DISMISS_REPORT'
  | 'HIDE'
  | 'RESTORE'
  | 'LOCK'
  | 'UNLOCK'
  | 'PIN'
  | 'UNPIN'
  | 'DELETE';

export interface ModerationState {
  status: ThreadStatus;
  isPinned: boolean;
  reportCount: number;
}

/**
 * ALGORITHM: MODERATION REDUCER
 * -----------------------------
 * A pure state transition, so the rules are one readable table rather than a
 * scatter of conditionals across route handlers.
 *
 * Two properties are deliberate:
 *
 * 1. **DELETED is terminal.** Nothing transitions out of it. Restoring deleted
 *    content would let a moderator undo another moderator's decision silently;
 *    if something needs to come back, it gets reposted, and the record shows it.
 * 2. **Hiding does not clear reports.** The report count is evidence about how
 *    the content was received, not a queue counter to be zeroed. A moderator
 *    reviewing a repeat offender needs the history.
 *
 * `AUTO_HIDE_REPORTS` is a threshold, not a verdict: content crossing it is
 * hidden pending review, never deleted. Automatic deletion on a report count is
 * how a coordinated group silences a person they disagree with.
 */
export const AUTO_HIDE_REPORTS = 5;

export function applyModeration(
  state: ModerationState,
  action: ModerationAction,
): ModerationState {
  if (state.status === 'DELETED') return state;

  switch (action) {
    case 'REPORT': {
      const reportCount = state.reportCount + 1;
      const shouldAutoHide = reportCount >= AUTO_HIDE_REPORTS && state.status === 'OPEN';
      return {
        ...state,
        reportCount,
        status: shouldAutoHide ? 'HIDDEN' : state.status,
      };
    }
    case 'DISMISS_REPORT':
      return { ...state, reportCount: Math.max(0, state.reportCount - 1) };
    case 'HIDE':
      return { ...state, status: 'HIDDEN' };
    case 'RESTORE':
      return { ...state, status: 'OPEN' };
    case 'LOCK':
      // Locking a hidden thread would be meaningless — nobody can see it to
      // reply. Only open threads lock.
      return state.status === 'OPEN' ? { ...state, status: 'LOCKED' } : state;
    case 'UNLOCK':
      return state.status === 'LOCKED' ? { ...state, status: 'OPEN' } : state;
    case 'PIN':
      return { ...state, isPinned: true };
    case 'UNPIN':
      return { ...state, isPinned: false };
    case 'DELETE':
      return { ...state, status: 'DELETED', isPinned: false };
  }
}

/** Can anyone reply to this thread right now? */
export function acceptsReplies(status: ThreadStatus): boolean {
  return status === 'OPEN';
}

// -----------------------------------------------------------------------------
// Visibility
// -----------------------------------------------------------------------------

/**
 * Which forums may this role read?
 *
 * The staff/student split is the point of the feature: staff discuss a pupil's
 * progress, a disciplinary matter, or a colleague's workload, and none of that
 * can leak into a student-visible space. So the check is on AUDIENCE, and the
 * default for an unrecognised role is "student", never "staff".
 *
 * Guardians deliberately see neither. A parent in the staff room is obviously
 * wrong; a parent in the student common room is subtler but no better.
 */
const STAFF_ROLES = new Set([
  'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF',
]);

export function canReadAudience(role: string, audience: ForumAudience): boolean {
  if (audience === 'STAFF') return STAFF_ROLES.has(role);
  if (audience === 'STUDENT') return STAFF_ROLES.has(role) || role === 'STUDENT';
  // ALL — everyone with a membership that reaches the forum at all.
  return STAFF_ROLES.has(role) || role === 'STUDENT';
}

/** Posting rights follow reading rights, except that staff-only stays staff-only. */
export function canPostInAudience(role: string, audience: ForumAudience): boolean {
  return canReadAudience(role, audience);
}

/** Moderator powers are role-based; authorship is not enough. */
export function canModerate(role: string): boolean {
  return role === 'ADMIN' || role === 'REGISTRAR';
}

/**
 * Can this person edit this post?
 *
 * Authors may edit their own words, but only for a window. After it, the
 * conversation has moved on and silently rewriting a post people have already
 * replied to misrepresents them. Moderators are not bound by the window, and
 * nobody edits a deleted post.
 */
export const EDIT_WINDOW_MINUTES = 30;

export function canEditPost(
  params: {
    viewerMembershipId: string;
    authorMembershipId: string;
    createdAt: Date;
    isDeleted: boolean;
    viewerRole: string;
  },
  now: Date,
): boolean {
  if (params.isDeleted) return false;
  if (canModerate(params.viewerRole)) return true;
  if (params.viewerMembershipId !== params.authorMembershipId) return false;
  const minutes = (now.getTime() - params.createdAt.getTime()) / 60000;
  return minutes <= EDIT_WINDOW_MINUTES;
}

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Clamp a requested page into range and slice.
 *
 * Clamps rather than throwing. A page number can go stale simply because
 * somebody deleted a thread between the reader loading the list and clicking
 * "next"; showing the last page is the useful response, and an error page is
 * not. Page numbers are 1-based because they appear in the URL, where 0-based
 * indexing confuses everyone who ever types one by hand.
 */
export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize = 20,
): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
  const start = (page - 1) * size;

  return {
    items: items.slice(start, start + size),
    page,
    pageSize: size,
    totalItems,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}
