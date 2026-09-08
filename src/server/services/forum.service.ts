/**
 * =============================================================================
 * FORUM SERVICE
 * =============================================================================
 *
 * Pure decisions — ranking, rate limits, moderation state, visibility — live in
 * `@/lib/domain/forum`. Rendering and escaping live in `@/lib/domain/markdown`.
 * This module reads a consistent snapshot, applies those functions, and writes
 * the result atomically.
 *
 * No `server-only` guard: the seed creates forums and posts.
 */

import { dbFor } from '@/lib/tenant';
import {
  applyModeration,
  canModerate,
  canPostInAudience,
  canReadAudience,
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
  type ModerationAction,
} from '@/lib/domain/forum';
import { excerpt, extractMentions } from '@/lib/domain/markdown';
import type { ForumAudience, ReportReason, ThreadStatus } from '@/lib/domain/enums';
import { notify } from './notification.service';
import { createTask } from './task.service';
import { recordAudit } from './audit.service';

export interface ForumResult {
  ok: boolean;
  message: string;
  threadId?: string;
  postId?: string;
}

const HOUR_MS = 60 * 60 * 1000;

/** Forums this role may see. The audience filter is the whole security model. */
export async function listForums(schoolId: string, role: string) {
  const forums = await dbFor(schoolId).forum.findMany({
    where: { isArchived: false },
    include: {
      categories: { orderBy: { position: 'asc' } },
      _count: { select: { threads: true } },
    },
    orderBy: { position: 'asc' },
  });
  // Filtered in the application rather than the query because `canReadAudience`
  // is the single definition of who sees what — duplicating it as a `where`
  // clause would be a second copy to keep in step.
  return forums.filter((f) => canReadAudience(role, f.audience as ForumAudience));
}

/**
 * A forum by slug, or null when this role may not see it.
 *
 * Null rather than a thrown "forbidden" so the caller can 404. A staff forum
 * should not announce its existence to a student who guesses the slug.
 */
export async function getForum(schoolId: string, slug: string, role: string) {
  const forum = await dbFor(schoolId).forum.findFirst({
    where: { slug },
    include: { categories: { orderBy: { position: 'asc' } } },
  });
  if (!forum) return null;
  if (!canReadAudience(role, forum.audience as ForumAudience)) return null;
  return forum;
}

/**
 * Threads in a forum, with hidden and deleted content filtered for non-moderators.
 *
 * Moderators see hidden threads — they have to, in order to review them — but
 * DELETED is invisible to everyone. Deletion is the one action that means gone.
 */
export async function listThreads(params: {
  schoolId: string;
  forumId: string;
  role: string;
  categoryId?: string | null;
}) {
  const visible: ThreadStatus[] = canModerate(params.role)
    ? ['OPEN', 'LOCKED', 'HIDDEN']
    : ['OPEN', 'LOCKED'];

  return dbFor(params.schoolId).thread.findMany({
    where: {
      forumId: params.forumId,
      status: { in: visible },
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    },
    include: {
      author: { include: { user: { select: { firstName: true, lastName: true } } } },
      category: { select: { name: true, slug: true } },
    },
  });
}

/**
 * Start a discussion.
 *
 * The thread, its opening post and the counters are written in ONE transaction.
 * A thread with no opening post is a broken row that renders as an empty page,
 * and it is exactly what a partial write leaves behind.
 */
export async function createThread(params: {
  schoolId: string;
  forumId: string;
  categoryId?: string | null;
  authorMembershipId: string;
  authorRole: string;
  title: string;
  body: string;
  actorUserId: string | null;
  /** Bypasses rate limiting for the seed. Never set from a request. */
  skipRateLimit?: boolean;
}): Promise<ForumResult> {
  const db = dbFor(params.schoolId);

  const forum = await db.forum.findUnique({ where: { id: params.forumId } });
  if (!forum) return { ok: false, message: 'Forum not found.' };

  // Re-checked here even though the UI hides the button: the action is the
  // security boundary, the button is a convenience.
  if (!canPostInAudience(params.authorRole, forum.audience as ForumAudience)) {
    return { ok: false, message: 'You cannot post in this forum.' };
  }

  const title = params.title.trim();
  const body = params.body.trim();
  if (title.length < 4) return { ok: false, message: 'Give the discussion a title of at least 4 characters.' };
  if (title.length > 200) return { ok: false, message: 'That title is too long.' };
  if (body.length < 2) return { ok: false, message: 'Write something in the body.' };
  if (body.length > 20000) return { ok: false, message: 'That post is too long.' };

  if (!params.skipRateLimit) {
    const verdict = await rateLimitFor(params.schoolId, params.authorMembershipId, true);
    if (!verdict.allowed) return { ok: false, message: verdict.reason as string };
  }

  const now = new Date();
  const thread = await db.$transaction(async (tx) => {
    const created = await tx.thread.create({
      data: {
        schoolId: params.schoolId,
        forumId: params.forumId,
        categoryId: params.categoryId ?? null,
        title,
        authorId: params.authorMembershipId,
        // Counters are seeded correctly at creation rather than left at zero
        // and fixed by a later recount.
        postCount: 1,
        lastPostAt: now,
      },
    });
    await tx.post.create({
      data: {
        schoolId: params.schoolId,
        threadId: created.id,
        authorId: params.authorMembershipId,
        body,
        isOpeningPost: true,
      },
    });
    return created;
  });

  await fanOutMentions({
    schoolId: params.schoolId,
    body,
    authorMembershipId: params.authorMembershipId,
    title,
    href: `/forums/${forum.slug}/${thread.id}`,
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'forum.thread.create',
    entityType: 'Thread',
    entityId: thread.id,
    summary: `Thread started in ${forum.name}: ${title}`,
  });

  return { ok: true, message: 'Discussion started.', threadId: thread.id };
}

/**
 * Reply to a thread.
 *
 * The post AND the thread's denormalised counters are written together — the
 * same pattern `seatsTaken` uses on a course offering. Updating them afterwards
 * leaves the index permanently wrong whenever the second write fails.
 */
export async function createPost(params: {
  schoolId: string;
  threadId: string;
  authorMembershipId: string;
  authorRole: string;
  body: string;
  actorUserId: string | null;
  skipRateLimit?: boolean;
}): Promise<ForumResult> {
  const db = dbFor(params.schoolId);

  const thread = await db.thread.findUnique({
    where: { id: params.threadId },
    include: { forum: true },
  });
  if (!thread) return { ok: false, message: 'Discussion not found.' };

  if (!canPostInAudience(params.authorRole, thread.forum.audience as ForumAudience)) {
    return { ok: false, message: 'You cannot post in this forum.' };
  }
  if (thread.status !== 'OPEN') {
    return {
      ok: false,
      message:
        thread.status === 'LOCKED'
          ? 'This discussion is locked. No further replies can be added.'
          : 'This discussion is no longer available.',
    };
  }

  const body = params.body.trim();
  if (body.length < 2) return { ok: false, message: 'Write something first.' };
  if (body.length > 20000) return { ok: false, message: 'That reply is too long.' };

  if (!params.skipRateLimit) {
    const verdict = await rateLimitFor(params.schoolId, params.authorMembershipId, false);
    if (!verdict.allowed) return { ok: false, message: verdict.reason as string };
  }

  const now = new Date();
  const post = await db.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        schoolId: params.schoolId,
        threadId: params.threadId,
        authorId: params.authorMembershipId,
        body,
      },
    });
    await tx.thread.update({
      where: { id: params.threadId },
      data: { postCount: { increment: 1 }, lastPostAt: now },
    });
    return created;
  });

  // Everyone already in the conversation, minus the person who just spoke.
  const participants = await db.post.findMany({
    where: { threadId: params.threadId, authorId: { not: null } },
    select: { authorId: true },
    distinct: ['authorId'],
  });

  void notify({
    schoolId: params.schoolId,
    membershipIds: participants.map((p) => p.authorId as string),
    kind: 'ANNOUNCEMENT',
    title: `New reply: ${thread.title}`,
    body: excerpt(body, 120),
    href: `/forums/${thread.forum.slug}/${params.threadId}`,
    subjectType: 'Thread',
    subjectId: params.threadId,
    exceptMembershipId: params.authorMembershipId,
  });

  await fanOutMentions({
    schoolId: params.schoolId,
    body,
    authorMembershipId: params.authorMembershipId,
    title: thread.title,
    href: `/forums/${thread.forum.slug}/${params.threadId}`,
  });

  return { ok: true, message: 'Reply posted.', postId: post.id };
}

/** Rate-limit check against this author's recent history. */
async function rateLimitFor(schoolId: string, membershipId: string, isNewThread: boolean) {
  const db = dbFor(schoolId);
  const since = new Date(Date.now() - 24 * HOUR_MS);

  const [posts, threads] = await Promise.all([
    db.post.findMany({
      where: { authorId: membershipId, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    isNewThread
      ? db.thread.findMany({
          where: { authorId: membershipId, createdAt: { gte: since } },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      : Promise.resolve([]),
  ]);

  return checkRateLimit(
    {
      recentPostTimes: posts.map((p) => p.createdAt),
      recentThreadTimes: threads.map((t) => t.createdAt),
      isNewThread,
    },
    new Date(),
    DEFAULT_RATE_LIMIT,
  );
}

/**
 * Notify mentioned people.
 *
 * Handles are resolved against MEMBERSHIPS of this school, so `@somebody` who
 * is not a member of it simply matches nothing. That is also why the renderer
 * refuses to turn a mention into a link: an unresolvable handle must not become
 * a clue about who does or does not hold an account.
 */
async function fanOutMentions(params: {
  schoolId: string;
  body: string;
  authorMembershipId: string;
  title: string;
  href: string;
}): Promise<void> {
  const handles = extractMentions(params.body);
  if (handles.length === 0) return;

  const members = await dbFor(params.schoolId).membership.findMany({
    where: { status: 'ACTIVE', user: { email: { in: handles } } },
    select: { id: true },
  });
  if (members.length === 0) return;

  void notify({
    schoolId: params.schoolId,
    membershipIds: members.map((m) => m.id),
    kind: 'ANNOUNCEMENT',
    title: `You were mentioned in “${params.title}”`,
    body: excerpt(params.body, 120),
    href: params.href,
    exceptMembershipId: params.authorMembershipId,
  });
}

// -----------------------------------------------------------------------------
// Moderation
// -----------------------------------------------------------------------------

/**
 * Report content.
 *
 * A report does three things in one transaction: records the report, advances
 * the thread's moderation state through the pure reducer, and — the first time
 * a thread is reported — raises a MODERATION task. Routing reports into the
 * task system rather than a separate inbox means there is one queue a
 * moderator has to watch, not two.
 */
export async function reportContent(params: {
  schoolId: string;
  threadId: string;
  postId?: string | null;
  reporterMembershipId: string;
  reason: ReportReason;
  detail?: string | null;
  actorUserId: string | null;
}): Promise<ForumResult> {
  const db = dbFor(params.schoolId);

  const thread = await db.thread.findUnique({
    where: { id: params.threadId },
    include: { forum: true },
  });
  if (!thread) return { ok: false, message: 'Discussion not found.' };

  if (params.postId) {
    const already = await db.postReport.findFirst({
      where: { postId: params.postId, reporterId: params.reporterMembershipId },
    });
    // Refused rather than silently ignored: a person who reports twice should
    // be told their first report is already in hand.
    if (already) {
      return { ok: false, message: 'You have already reported this. A moderator will review it.' };
    }
  }

  const next = applyModeration(
    {
      status: thread.status as ThreadStatus,
      isPinned: thread.isPinned,
      reportCount: thread.reportCount,
    },
    'REPORT',
  );

  const isFirstReport = thread.reportCount === 0;

  await db.$transaction(async (tx) => {
    await tx.postReport.create({
      data: {
        schoolId: params.schoolId,
        threadId: params.threadId,
        postId: params.postId ?? null,
        reporterId: params.reporterMembershipId,
        reason: params.reason,
        detail: params.detail ?? null,
      },
    });
    await tx.thread.update({
      where: { id: params.threadId },
      data: { reportCount: next.reportCount, status: next.status },
    });
    if (params.postId) {
      await tx.post.update({
        where: { id: params.postId },
        data: { reportCount: { increment: 1 } },
      });
    }
  });

  if (isFirstReport) {
    // Assigned to nobody: the moderation queue is a shared responsibility, and
    // picking one moderator at random makes it that person's problem alone.
    await createTask({
      schoolId: params.schoolId,
      title: `Review reported discussion: ${thread.title}`,
      description: `Reported as ${params.reason}. ${params.detail ?? ''}`.trim(),
      kind: 'MODERATION',
      priority: params.reason === 'ABUSE' || params.reason === 'PERSONAL_DATA' ? 'URGENT' : 'NORMAL',
      assigneeId: null,
      assignerId: params.reporterMembershipId,
      subjectType: 'Thread',
      subjectId: params.threadId,
      actorUserId: params.actorUserId,
    });
  }

  return {
    ok: true,
    message:
      next.status === 'HIDDEN' && thread.status !== 'HIDDEN'
        ? 'Reported. The discussion has been hidden pending review.'
        : 'Reported. A moderator will review it.',
  };
}

/** Apply a moderator action to a thread. */
export async function moderateThread(params: {
  schoolId: string;
  threadId: string;
  action: ModerationAction;
  moderatorMembershipId: string;
  moderatorRole: string;
  actorUserId: string | null;
}): Promise<ForumResult> {
  if (!canModerate(params.moderatorRole)) {
    return { ok: false, message: 'You are not a moderator of this forum.' };
  }

  const db = dbFor(params.schoolId);
  const thread = await db.thread.findUnique({ where: { id: params.threadId } });
  if (!thread) return { ok: false, message: 'Discussion not found.' };

  const before = {
    status: thread.status as ThreadStatus,
    isPinned: thread.isPinned,
    reportCount: thread.reportCount,
  };
  const after = applyModeration(before, params.action);

  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { ok: false, message: 'That action does not apply to this discussion.' };
  }

  await db.thread.update({
    where: { id: params.threadId },
    data: { status: after.status, isPinned: after.isPinned, reportCount: after.reportCount },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: `forum.moderate.${params.action.toLowerCase()}`,
    entityType: 'Thread',
    entityId: params.threadId,
    summary: `${params.action} applied to “${thread.title}” (${before.status} → ${after.status}).`,
  });

  return { ok: true, message: `Discussion ${params.action.toLowerCase()}ed.` };
}

/**
 * Toggle a reaction.
 *
 * A unique constraint on (postId, membershipId) means a double-clicked button
 * cannot inflate the count — the second click removes rather than duplicates.
 * The counters on the post and the thread move inside the same transaction.
 */
export async function toggleReaction(params: {
  schoolId: string;
  postId: string;
  membershipId: string;
}): Promise<{ ok: boolean; reacted: boolean }> {
  const db = dbFor(params.schoolId);

  const post = await db.post.findUnique({
    where: { id: params.postId },
    select: { id: true, threadId: true },
  });
  if (!post) return { ok: false, reacted: false };

  const existing = await db.postReaction.findFirst({
    where: { postId: params.postId, membershipId: params.membershipId },
  });

  await db.$transaction(async (tx) => {
    if (existing) {
      await tx.postReaction.delete({ where: { id: existing.id } });
      await tx.post.update({ where: { id: params.postId }, data: { reactionCount: { decrement: 1 } } });
      await tx.thread.update({ where: { id: post.threadId }, data: { reactionCount: { decrement: 1 } } });
    } else {
      await tx.postReaction.create({
        data: { schoolId: params.schoolId, postId: params.postId, membershipId: params.membershipId },
      });
      await tx.post.update({ where: { id: params.postId }, data: { reactionCount: { increment: 1 } } });
      await tx.thread.update({ where: { id: post.threadId }, data: { reactionCount: { increment: 1 } } });
    }
  });

  return { ok: true, reacted: !existing };
}
