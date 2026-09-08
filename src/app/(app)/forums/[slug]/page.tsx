import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '@/server/tenant-context';
import { getForum, listThreads } from '@/server/services/forum.service';
import { canModerate, canPostInAudience, paginate, sortThreads, type SortMode } from '@/lib/domain/forum';
import type { ForumAudience, ThreadStatus } from '@/lib/domain/enums';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import {
  AUDIENCE_LABEL,
  AUDIENCE_TONE,
  ThreadStatusBadge,
  relativeTime,
} from '@/components/forum-bits';
import { NewThreadButton } from './new-thread';

export const metadata: Metadata = { title: 'Forum' };

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'hot', label: 'Active' },
  { key: 'new', label: 'Latest' },
  { key: 'top', label: 'Top' },
];

export default async function ForumPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; category?: string; page?: string }>;
}) {
  const { schoolId, role } = await requireTenantContext();
  const { slug } = await params;
  const { sort: rawSort, category: categorySlug, page: rawPage } = await searchParams;

  // Null covers "no such forum" AND "not for your audience" — the 404 is the
  // same either way, so a staff forum never confirms its own existence.
  const forum = await getForum(schoolId, slug, role);
  if (!forum) notFound();

  const sort: SortMode = rawSort === 'new' || rawSort === 'top' ? rawSort : 'hot';
  const category = categorySlug
    ? (forum.categories.find((c) => c.slug === categorySlug) ?? null)
    : null;

  const threads = await listThreads({
    schoolId,
    forumId: forum.id,
    role,
    categoryId: category?.id ?? null,
  });

  const sorted = sortThreads(threads, sort, new Date());
  const page = paginate(sorted, Number(rawPage ?? '1'), 20);
  const mayPost = canPostInAudience(role, forum.audience as ForumAudience);

  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { sort, category: categorySlug, page: rawPage, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/forums/${slug}${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title={forum.name}
        description={forum.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={AUDIENCE_TONE[forum.audience as ForumAudience]}>
              {AUDIENCE_LABEL[forum.audience as ForumAudience]}
            </Badge>
            {mayPost ? (
              <NewThreadButton forumSlug={slug} categories={forum.categories} />
            ) : null}
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={query({ sort: s.key, page: undefined })}
            className={
              s.key === sort
                ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-onAccent'
                : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
            }
          >
            {s.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />

        <Link
          href={query({ category: undefined, page: undefined })}
          className={
            !category
              ? 'rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-onInk'
              : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
          }
        >
          All
        </Link>
        {forum.categories.map((c) => (
          <Link
            key={c.id}
            href={query({ category: c.slug, page: undefined })}
            className={
              category?.id === c.id
                ? 'rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-onInk'
                : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
            }
          >
            {c.name}
          </Link>
        ))}

        <Link href="/forums" className="ml-auto text-xs text-brand-700 hover:underline">
          ← All forums
        </Link>
      </div>

      <Card>
        <CardHeader
          title={category ? category.name : 'All discussions'}
          description={
            sort === 'hot'
              ? 'Ranked by engagement decayed against age, so the page reflects the conversation happening now.'
              : sort === 'new'
                ? 'Most recent activity first — a question answered today ranks above a thread posted today with no replies.'
                : 'Most engagement of all time.'
          }
          actions={
            canModerate(role) ? (
              <span className="text-[11px] text-slate-500">
                You moderate this forum — hidden discussions are visible to you.
              </span>
            ) : null
          }
        />

        {page.items.length === 0 ? (
          <EmptyState
            title="No discussions yet"
            description={mayPost ? 'Start the first one.' : 'Nothing has been posted here.'}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {page.items.map((t) => (
              <li key={t.id} className="flex gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.isPinned ? <Badge tone="gold">Pinned</Badge> : null}
                    <Link
                      href={`/forums/${slug}/${t.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-brand-700"
                    >
                      {t.title}
                    </Link>
                    <ThreadStatusBadge status={t.status as ThreadStatus} />
                    {t.reportCount > 0 && canModerate(role) ? (
                      <Badge tone="danger">
                        {t.reportCount} report{t.reportCount === 1 ? '' : 's'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {t.author
                      ? `${t.author.user.firstName} ${t.author.user.lastName}`
                      : 'Former member'}
                    {t.category ? ` · ${t.category.name}` : ''} ·{' '}
                    {relativeTime(t.lastPostAt ?? t.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums text-slate-900">{t.postCount}</p>
                  <p className="text-[11px] text-slate-400">
                    {t.postCount === 1 ? 'post' : 'posts'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {page.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <span className="text-xs text-slate-500">
              Page {page.page} of {page.totalPages} · {page.totalItems} discussions
            </span>
            <div className="flex gap-2">
              {page.hasPrevious ? (
                <Link
                  href={query({ page: String(page.page - 1) })}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  ← Previous
                </Link>
              ) : null}
              {page.hasNext ? (
                <Link
                  href={query({ page: String(page.page + 1) })}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Next →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
