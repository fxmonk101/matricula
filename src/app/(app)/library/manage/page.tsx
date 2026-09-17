import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { libraryAnalytics } from '@/server/services/library.service';
import { formatDate } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { ResourceEditor } from './resource-editor';

export const metadata: Metadata = { title: 'Manage library' };

export default async function ManageLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { db, schoolId, school } = await requireRoute('/library/manage');
  const { edit } = await searchParams;

  const [analytics, resources, programs] = await Promise.all([
    libraryAnalytics(schoolId),
    db.libraryResource.findMany({
      orderBy: [{ isArchived: 'asc' }, { viewCount: 'desc' }],
      include: { addedBy: { include: { user: { select: { firstName: true, lastName: true } } } } },
    }),
    db.program.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
  ]);

  const editing = edit ? (resources.find((r) => r.id === edit) ?? null) : null;
  const live = resources.filter((r) => !r.isArchived && r.publishedAt !== null);
  const maxViews = Math.max(1, ...live.map((r) => r.viewCount));

  return (
    <>
      <PageHeader
        title="Manage the library"
        description={`${school.shortName} — ${live.length} live ${live.length === 1 ? 'resource' : 'resources'}.`}
        actions={
          <Link href="/library" className="text-sm text-brand-700 hover:underline">
            ← Back to the catalogue
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total reads"
          value={analytics.totalViews}
          sublabel="Last 90 days"
        />
        <StatTile
          label="Distinct readers"
          value={analytics.uniqueReaders}
          tone="brand"
          sublabel="The number that answers “is this used?”"
        />
        <StatTile
          label="Last 7 days"
          value={analytics.viewsLast7Days}
          sublabel={`${analytics.viewsLast30Days} in the last 30`}
        />
        <StatTile
          label="Never opened"
          value={analytics.neverViewed}
          tone={analytics.neverViewed > 0 ? 'warning' : 'success'}
          sublabel="Worth questioning at renewal"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ResourceEditor
            programs={programs}
            editing={
              editing
                ? {
                    id: editing.id,
                    title: editing.title,
                    authors: editing.authors,
                    description: editing.description,
                    kind: editing.kind,
                    url: editing.url,
                    publisher: editing.publisher,
                    isbn: editing.isbn,
                    language: editing.language,
                    pageCount: editing.pageCount,
                    durationMin: editing.durationMin,
                    tags: editing.tags,
                    audience: editing.audience,
                    programIdsJson: editing.programIdsJson,
                    levelsJson: editing.levelsJson,
                    isPublished: editing.publishedAt !== null,
                  }
                : null
            }
          />

          <Card>
            <CardHeader
              title="Catalogue"
              description="Ordered by readership. Archiving removes a resource from the catalogue but keeps its usage history."
            />
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th>Format</Th>
                  <Th>Audience</Th>
                  <Th className="w-28">Reads</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resources.map((r) => (
                  <tr key={r.id} className={r.isArchived ? 'opacity-50' : undefined}>
                    <Td>
                      <Link
                        href={`/library/${r.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-brand-700"
                      >
                        {r.title}
                      </Link>
                      <div className="text-[11px] text-slate-500">
                        {r.authors || '—'}
                        {r.publishedAt === null ? ' · draft' : ''}
                        {r.isArchived ? ' · archived' : ''}
                      </div>
                    </Td>
                    <Td className="text-xs">{r.kind}</Td>
                    <Td>
                      {r.audience === 'STAFF' ? (
                        <Badge tone="danger">Staff</Badge>
                      ) : (
                        <Badge tone="neutral">All</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right text-xs tabular-nums">{r.viewCount}</span>
                        <div className="w-14">
                          <Meter
                            value={(r.viewCount / maxViews) * 100}
                            tone={r.viewCount === 0 ? 'warning' : 'brand'}
                          />
                        </div>
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/library/manage?edit=${r.id}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        Edit
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Most read"
              description="Ranked by distinct readers, not raw opens — one obsessive reader is not breadth of use."
            />
            {analytics.top.length === 0 ? (
              <EmptyState title="No reads yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {analytics.top.map((t) => (
                  <li key={t.resourceId} className="flex items-baseline gap-3 px-5 py-2.5">
                    <Link
                      href={`/library/${t.resourceId}`}
                      className="min-w-0 flex-1 truncate text-xs text-slate-800 hover:text-brand-700"
                    >
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {t.readers} {t.readers === 1 ? 'reader' : 'readers'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Never opened"
              description="Invisible in any ranking by views — which is exactly why they are listed separately."
            />
            {analytics.unread.length === 0 ? (
              <div className="px-5 py-4">
                <Alert tone="success">Every resource in the catalogue has been opened.</Alert>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {analytics.unread.map((r) => (
                  <li key={r.id} className="px-5 py-2.5">
                    <Link
                      href={`/library/${r.id}`}
                      className="text-xs text-slate-800 hover:text-brand-700"
                    >
                      {r.title}
                    </Link>
                    <p className="text-[11px] text-slate-400">
                      {r.kind} · added {formatDate(r.publishedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
