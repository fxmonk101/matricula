'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireTenantContext } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import type { ModerationAction } from '@/lib/domain/forum';
import type { ReportReason } from '@/lib/domain/enums';
import {
  createPost,
  createThread,
  getForum,
  moderateThread,
  reportContent,
  toggleReaction,
} from '@/server/services/forum.service';

export interface ForumFormState {
  ok?: boolean;
  message?: string;
}

/**
 * Every action below re-derives the forum from the SESSION's school and
 * re-checks the audience. The page already filtered the list, but a form post
 * is a separate request carrying an id the caller chose — so the id is
 * validated here rather than trusted because the UI would not normally offer
 * it.
 */
async function requireReadableForum(slug: string) {
  const ctx = await requireTenantContext();
  const forum = await getForum(ctx.schoolId, slug, ctx.role);
  // Null covers both "no such forum" and "not for your audience", and the
  // caller cannot tell which — a staff forum must not announce its existence.
  if (!forum) redirect('/forums');
  return { ctx, forum };
}

export async function createThreadAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const slug = String(formData.get('forumSlug') ?? '');
  const { ctx, forum } = await requireReadableForum(slug);
  assertCan(ctx.role, 'forum:post');

  const result = await createThread({
    schoolId: ctx.schoolId,
    forumId: forum.id,
    categoryId: String(formData.get('categoryId') ?? '') || null,
    authorMembershipId: ctx.membershipId,
    authorRole: ctx.role,
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    actorUserId: ctx.session.sub,
  });

  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath('/forums');
  revalidatePath(`/forums/${slug}`);
  redirect(`/forums/${slug}/${result.threadId}`);
}

export async function replyAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const slug = String(formData.get('forumSlug') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  const { ctx } = await requireReadableForum(slug);
  assertCan(ctx.role, 'forum:post');

  const result = await createPost({
    schoolId: ctx.schoolId,
    threadId,
    authorMembershipId: ctx.membershipId,
    authorRole: ctx.role,
    body: String(formData.get('body') ?? ''),
    actorUserId: ctx.session.sub,
  });

  revalidatePath(`/forums/${slug}/${threadId}`);
  return result;
}

export async function reportAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const slug = String(formData.get('forumSlug') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  const { ctx } = await requireReadableForum(slug);

  const result = await reportContent({
    schoolId: ctx.schoolId,
    threadId,
    postId: String(formData.get('postId') ?? '') || null,
    reporterMembershipId: ctx.membershipId,
    reason: String(formData.get('reason') ?? 'OTHER') as ReportReason,
    detail: String(formData.get('detail') ?? '') || null,
    actorUserId: ctx.session.sub,
  });

  revalidatePath(`/forums/${slug}/${threadId}`);
  return result;
}

export async function moderateAction(
  _prev: ForumFormState,
  formData: FormData,
): Promise<ForumFormState> {
  const slug = String(formData.get('forumSlug') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  const { ctx } = await requireReadableForum(slug);
  assertCan(ctx.role, 'forum:moderate');

  const result = await moderateThread({
    schoolId: ctx.schoolId,
    threadId,
    action: String(formData.get('action') ?? '') as ModerationAction,
    moderatorMembershipId: ctx.membershipId,
    moderatorRole: ctx.role,
    actorUserId: ctx.session.sub,
  });

  revalidatePath(`/forums/${slug}`);
  revalidatePath(`/forums/${slug}/${threadId}`);
  return result;
}

export async function reactAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('forumSlug') ?? '');
  const threadId = String(formData.get('threadId') ?? '');
  const { ctx } = await requireReadableForum(slug);

  await toggleReaction({
    schoolId: ctx.schoolId,
    postId: String(formData.get('postId') ?? ''),
    membershipId: ctx.membershipId,
  });

  revalidatePath(`/forums/${slug}/${threadId}`);
}

