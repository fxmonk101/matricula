/**
 * Forum presentation pieces. Server-renderable; no state.
 */

import { renderMarkdown } from '@/lib/domain/markdown';
import type { ForumAudience, ThreadStatus } from '@/lib/domain/enums';
import { Badge, type BadgeTone } from '@/components/ui';

export const AUDIENCE_TONE: Record<ForumAudience, BadgeTone> = {
  STAFF: 'brand',
  STUDENT: 'info',
  ALL: 'neutral',
};

export const AUDIENCE_LABEL: Record<ForumAudience, string> = {
  STAFF: 'Staff only',
  STUDENT: 'Students & staff',
  ALL: 'Everyone',
};

export const STATUS_TONE: Record<ThreadStatus, BadgeTone> = {
  OPEN: 'success',
  LOCKED: 'warning',
  HIDDEN: 'danger',
  DELETED: 'neutral',
};

/**
 * Render a post body.
 *
 * `dangerouslySetInnerHTML` here is deliberate and is the ONLY place in the
 * application that uses it. The name is a warning about the input, not the
 * API: what goes in has been through `renderMarkdown`, which escapes every
 * `& < > " '` in the source before it introduces a single tag of its own. The
 * HTML being injected is therefore HTML this codebase wrote, not HTML a user
 * supplied.
 *
 * The alternative — building a React element tree from a parsed AST — is safer
 * in the sense that it cannot emit raw HTML at all, and is the right move if
 * this ever grows beyond a small block grammar. It is recorded here as the
 * upgrade path rather than left as an unexamined choice.
 */
export function PostBody({ body }: { body: string }) {
  return (
    <div
      className="post-body text-sm leading-relaxed text-slate-700"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
    />
  );
}

export function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  // OPEN is the default state and carries no information; a badge on every row
  // is a badge nobody reads.
  if (status === 'OPEN') return null;
  const label =
    status === 'LOCKED' ? 'Locked' : status === 'HIDDEN' ? 'Hidden pending review' : 'Removed';
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}

export function relativeTime(date: Date | string): string {
  const then = new Date(date).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
