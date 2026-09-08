import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantContext } from '@/server/tenant-context';
import { listForums } from '@/server/services/forum.service';
import { sortThreads } from '@/lib/domain/forum';
import type { ForumAudience } from '@/lib/domain/enums';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { AUDIENCE_LABEL, AUDIENCE_TONE, relativeTime } from '@/components/forum-bits';

export const metadata: Metadata = { title: 'Forums' };

export default async function ForumsPage() {
  const { db, schoolId, role, school } = await requireTenantContext();

  // The audience filter is applied in the service, so a staff forum is not
  // merely hidden from a student's page — it never reaches their process.
  const forums = await listForums(schoolId, role);

  const latest = await db.thread.findMany({
    where: {
      forumId: { in: forums.map((f) => f.id) },
      status: { in: ['OPEN', 'LOCKED'] },
    },
    include: {
      author: { include: { user: { select: { firstName: true, lastName: true } } } },
      forum: { select: { slug: true, name: true } },
    },
  });

  const now = new Date();
  const recent = sortThreads(latest, 'new', now).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Forums"
        description={`Discussion across ${school.shortName}.`}
      />

      {forums.length === 0 ? (
        <Card>
          <EmptyState
            title="No forums are open to you"
            description="Forums are created by an administrator."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {forums.map((forum) => {
              const threadsHere = latest.filter((t) => t.forumId === forum.id);
              const newest = sortThreads(threadsHere, 'new', now)[0];

              return (
                <Card key={forum.id}>
                  <CardHeader
                    title={
                      <Link href={`/forums/${forum.slug}`} className="hover:text-brand-700">
                        {forum.name}
                      </Link>
                    }
                    description={forum.description ?? undefined}
                    actions={
                      <Badge tone={AUDIENCE_TONE[forum.audience as ForumAudience]}>
                        {AUDIENCE_LABEL[forum.audience as ForumAudience]}
                      </Badge>
                    }
                  />
                  <div className="divide-y divide-slate-100">
                    {forum.categories.length === 0 ? (
                      <p className="px-5 py-3 text-xs text-slate-500">No categories.</p>
                    ) : (
                      forum.categories.map((c) => (
                        <Link
                          key={c.id}
                          href={`/forums/${forum.slug}?category=${c.slug}`}
                          className="flex items-baseline justify-between gap-4 px-5 py-2.5 hover:bg-slate-50"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-900">{c.name}</p>
                            {c.description ? (
                              <p className="text-[11px] text-slate-500">{c.description}</p>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                            {threadsHere.filter((t) => t.categoryId === c.id).length} discussions
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                  <div className="border-t border-slate-200 px-5 py-2.5 text-[11px] text-slate-500">
                    {newest ? (
                      <>
                        Latest:{' '}
                        <Link
                          href={`/forums/${forum.slug}/${newest.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {newest.title}
                        </Link>{' '}
                        · {relativeTime(newest.lastPostAt ?? newest.createdAt)}
                      </>
                    ) : (
                      'No discussions yet.'
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader title="Recent activity" description="Across every forum you can see." />
            {recent.length === 0 ? (
              <EmptyState title="Nothing yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((t) => (
                  <li key={t.id} className="px-5 py-3">
                    <Link
                      href={`/forums/${t.forum.slug}/${t.id}`}
                      className="text-xs font-medium text-slate-900 hover:text-brand-700"
                    >
                      {t.title}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {t.forum.name} ·{' '}
                      {t.author ? `${t.author.user.firstName} ${t.author.user.lastName}` : 'Removed'}{' '}
                      · {relativeTime(t.lastPostAt ?? t.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
