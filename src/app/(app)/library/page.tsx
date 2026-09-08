import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantContext } from '@/server/tenant-context';
import { browseCatalogue, resolveViewer } from '@/server/services/library.service';
import { canManageLibrary, RESOURCE_KINDS, type ResourceKind } from '@/lib/domain/library';
import { paginate } from '@/lib/domain/forum';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  StatTile,
  type BadgeTone,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Library' };

const KIND_LABEL: Record<ResourceKind, string> = {
  EBOOK: 'E-book',
  DOCUMENT: 'Document',
  LINK: 'Link',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DATASET: 'Dataset',
};

const KIND_TONE: Record<ResourceKind, BadgeTone> = {
  EBOOK: 'brand',
  DOCUMENT: 'neutral',
  LINK: 'info',
  VIDEO: 'warning',
  AUDIO: 'warning',
  DATASET: 'success',
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; tag?: string; page?: string }>;
}) {
  const { schoolId, role, session, school } = await requireTenantContext();
  const { q, kind, tag, page: rawPage } = await searchParams;

  // Programme and level come from the CURRENT student record, not the session,
  // so a programme change takes effect on the next page load.
  const viewer = await resolveViewer(schoolId, role, session.sub);

  const kindFilter = RESOURCE_KINDS.includes(kind as ResourceKind)
    ? (kind as ResourceKind)
    : null;

  const { items, facets } = await browseCatalogue({
    schoolId,
    viewer,
    query: q,
    kind: kindFilter,
    tag: tag ?? null,
  });

  const page = paginate(items, Number(rawPage ?? '1'), 12);

  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, kind, tag, page: rawPage, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/library${p.size ? `?${p}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="Library"
        description={`Digital resources at ${school.shortName}.`}
        actions={
          canManageLibrary(role) ? (
            <Link
              href="/library/manage"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
            >
              Manage catalogue
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Available to you" value={items.length} sublabel="Matching your filters" />
        <StatTile
          label="Most read"
          value={items[0]?.viewCount ?? 0}
          tone="brand"
          sublabel={items[0] ? `“${items[0].title.slice(0, 28)}”` : 'Nothing yet'}
        />
        <StatTile label="Subjects" value={facets.length} sublabel="Tags in this catalogue" />
        <StatTile
          label="Formats"
          value={new Set(items.map((i) => i.kind)).size}
          sublabel="Books, documents, video, data"
        />
      </div>

      <form action="/library" className="mt-4 flex flex-wrap gap-2">
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by title, author or subject…"
          className="max-w-md"
          aria-label="Search the library"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
        >
          Search
        </button>
        {q || kind || tag ? (
          <Link
            href="/library"
            className="self-center text-xs font-medium text-brand-700 hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={link({ kind: undefined, page: undefined })}
          className={
            !kindFilter
              ? 'rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white'
              : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
          }
        >
          All formats
        </Link>
        {RESOURCE_KINDS.map((k) => (
          <Link
            key={k}
            href={link({ kind: k, page: undefined })}
            className={
              kindFilter === k
                ? 'rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
            }
          >
            {KIND_LABEL[k]}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardHeader
            title={q ? `Results for “${q}”` : tag ? `Subject: ${tag}` : 'Catalogue'}
            description={
              q
                ? 'Ranked by where the match falls — title first, then author, then subject tag.'
                : 'Most recently added first.'
            }
          />
          {page.items.length === 0 ? (
            <EmptyState
              title="Nothing matches"
              description={
                q
                  ? 'Try a broader term, or clear the format filter.'
                  : 'No resources are available to you yet.'
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {page.items.map((r) => (
                <li key={r.id} className="px-5 py-4 hover:bg-slate-50">
                  <div className="flex flex-wrap items-start gap-2">
                    <Link
                      href={`/library/${r.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-brand-700"
                    >
                      {r.title}
                    </Link>
                    <Badge tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>
                    {r.audience === 'STAFF' ? <Badge tone="danger">Staff only</Badge> : null}
                  </div>
                  {r.authors ? (
                    <p className="mt-0.5 text-xs text-slate-600">{r.authors}</p>
                  ) : null}
                  {r.description ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {r.description}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {r.tags.slice(0, 4).map((t) => (
                      <Link
                        key={t}
                        href={link({ tag: t, page: undefined })}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
                      >
                        {t}
                      </Link>
                    ))}
                    <span className="ml-auto text-[11px] tabular-nums text-slate-400">
                      {r.viewCount} {r.viewCount === 1 ? 'read' : 'reads'}
                      {r.pageCount ? ` · ${r.pageCount}pp` : ''}
                      {r.durationMin ? ` · ${Math.round(r.durationMin / 60)}h` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {page.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
              <span className="text-xs text-slate-500">
                Page {page.page} of {page.totalPages} · {page.totalItems} resources
              </span>
              <div className="flex gap-3">
                {page.hasPrevious ? (
                  <Link href={link({ page: String(page.page - 1) })} className="text-xs font-medium text-brand-700 hover:underline">
                    ← Previous
                  </Link>
                ) : null}
                {page.hasNext ? (
                  <Link href={link({ page: String(page.page + 1) })} className="text-xs font-medium text-brand-700 hover:underline">
                    Next →
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="h-fit">
          <CardHeader
            title="Subjects"
            description="Counted across everything you can see, so choosing one never strands you."
          />
          {facets.length === 0 ? (
            <EmptyState title="No tags yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {facets.map((f) => (
                <li key={f.tag}>
                  <Link
                    href={link({ tag: f.tag === tag ? undefined : f.tag, page: undefined })}
                    className={`flex items-center justify-between px-5 py-2 text-xs hover:bg-slate-50 ${
                      f.tag === tag ? 'font-semibold text-brand-700' : 'text-slate-700'
                    }`}
                  >
                    <span>{f.tag}</span>
                    <span className="tabular-nums text-slate-400">{f.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
