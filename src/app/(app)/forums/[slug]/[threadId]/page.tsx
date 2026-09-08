import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '@/server/tenant-context';
import { getForum } from '@/server/services/forum.service';
import { acceptsReplies, canModerate, canPostInAudience } from '@/lib/domain/forum';
import type { ForumAudience, ThreadStatus } from '@/lib/domain/enums';
import { initials } from '@/lib/utils';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { PostBody, ThreadStatusBadge, relativeTime } from '@/components/forum-bits';
import { ReplyForm } from './reply-form';
import { ModerationBar } from './moderation-bar';
import { PostActions } from './post-actions';

export const metadata: Metadata = { title: 'Discussion' };

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ slug: string; threadId: string }>;
}) {
  const { db, schoolId, role, membershipId } = await requireTenantContext();
  const { slug, threadId } = await params;

  const forum = await getForum(schoolId, slug, role);
  if (!forum) notFound();

  const thread = await db.thread.findUnique({
    where: { id: threadId },
    include: {
      author: { include: { user: true } },
      category: true,
      posts: {
        include: {
          author: { include: { user: true } },
          reactions: { select: { membershipId: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  // The thread must belong to the forum in the URL, or a staff thread could be
  // read through a student forum's slug.
  if (!thread || thread.forumId !== forum.id) notFound();

  const moderator = canModerate(role);
  // DELETED is invisible to everyone, moderators included. HIDDEN is visible
  // only to moderators, who have to see it in order to review it.
  if (thread.status === 'DELETED') notFound();
  if (thread.status === 'HIDDEN' && !moderator) notFound();

  const mayReply =
    canPostInAudience(role, forum.audience as ForumAudience) &&
    acceptsReplies(thread.status as ThreadStatus);

  const visiblePosts = thread.posts.filter((p) => p.deletedAt === null || moderator);

  return (
    <>
      <PageHeader
        title={thread.title}
        description={`${forum.name}${thread.category ? ` · ${thread.category.name}` : ''} · started ${relativeTime(thread.createdAt)}`}
        actions={
          <Link href={`/forums/${slug}`} className="text-sm text-brand-700 hover:underline">
            ← {forum.name}
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {thread.isPinned ? <Badge tone="gold">Pinned</Badge> : null}
        <ThreadStatusBadge status={thread.status as ThreadStatus} />
        {thread.reportCount > 0 && moderator ? (
          <Badge tone="danger">
            {thread.reportCount} report{thread.reportCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      {thread.status === 'HIDDEN' ? (
        <div className="mb-4">
          <Alert tone="warning" title="Hidden pending review">
            This discussion crossed the report threshold and was hidden automatically. It is
            visible to you as a moderator. Automatic hiding is never automatic deletion — the
            decision is still yours.
          </Alert>
        </div>
      ) : null}

      {thread.status === 'LOCKED' ? (
        <div className="mb-4">
          <Alert tone="info">
            This discussion is locked. It stays readable, but no further replies can be added.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-3 lg:col-span-3">
          {visiblePosts.map((post) => {
            const reacted = post.reactions.some((r) => r.membershipId === membershipId);
            const isOwn = post.authorId === membershipId;

            return (
              <Card key={post.id} className={post.isOpeningPost ? 'ring-1 ring-brand-100' : undefined}>
                <div className="flex items-start gap-3 px-5 py-4">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-semibold text-onAccent"
                    aria-hidden
                  >
                    {post.author
                      ? initials(post.author.user.firstName, post.author.user.lastName)
                      : '—'}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-medium text-slate-900">
                        {post.author
                          ? `${post.author.user.firstName} ${post.author.user.lastName}`
                          : 'Former member'}
                      </span>
                      {post.author?.title ? (
                        <span className="text-[11px] text-slate-500">{post.author.title}</span>
                      ) : null}
                      <span className="text-[11px] text-slate-400">
                        {relativeTime(post.createdAt)}
                        {post.editedAt ? ' · edited' : ''}
                      </span>
                      {post.isOpeningPost ? (
                        <Badge tone="brand" className="ml-auto">
                          Opening post
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-2">
                      {post.deletedAt ? (
                        <p className="text-sm italic text-slate-400">
                          This post was removed by a moderator.
                          {moderator ? ' (Visible to you only.)' : ''}
                        </p>
                      ) : (
                        <PostBody body={post.body} />
                      )}
                    </div>

                    {post.deletedAt === null ? (
                      <PostActions
                        forumSlug={slug}
                        threadId={threadId}
                        postId={post.id}
                        reactionCount={post.reactionCount}
                        reacted={reacted}
                        canReport={!isOwn}
                      />
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}

          {mayReply ? (
            <ReplyForm forumSlug={slug} threadId={threadId} />
          ) : (
            <Card>
              <CardBody>
                <p className="text-xs text-slate-500">
                  {thread.status === 'OPEN'
                    ? 'You can read this discussion but not reply to it.'
                    : 'This discussion is closed to replies.'}
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Discussion" />
            <CardBody>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Posts</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{thread.postCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Reactions</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{thread.reactionCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Started by</dt>
                  <dd className="font-medium text-slate-900">
                    {thread.author
                      ? `${thread.author.user.firstName} ${thread.author.user.lastName}`
                      : 'Former member'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Last activity</dt>
                  <dd className="font-medium text-slate-900">
                    {relativeTime(thread.lastPostAt ?? thread.createdAt)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {moderator ? (
            <ModerationBar
              forumSlug={slug}
              threadId={threadId}
              status={thread.status as ThreadStatus}
              isPinned={thread.isPinned}
              reportCount={thread.reportCount}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
