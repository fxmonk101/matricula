import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantContext } from '@/server/tenant-context';
import { getResource, recordView, resolveViewer } from '@/server/services/library.service';
import { canManageLibrary, isValidResourceUrl, type ResourceKind } from '@/lib/domain/library';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Card, CardBody, CardHeader, DetailRow, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Resource' };

const KIND_LABEL: Record<ResourceKind, string> = {
  EBOOK: 'E-book',
  DOCUMENT: 'Document',
  LINK: 'Link',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DATASET: 'Dataset',
};

const OPEN_VERB: Record<ResourceKind, string> = {
  EBOOK: 'Read',
  DOCUMENT: 'Open',
  LINK: 'Visit',
  VIDEO: 'Watch',
  AUDIO: 'Listen',
  DATASET: 'Download',
};

export default async function ResourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { schoolId, role, session, membershipId } = await requireTenantContext();
  const { id } = await params;

  const viewer = await resolveViewer(schoolId, role, session.sub);

  // Returns null both for "no such resource" and "not for you" — the 404 is
  // the same either way, so a staff-only document does not confirm it exists.
  const resource = await getResource(schoolId, id, viewer);
  if (!resource) notFound();

  // De-duplicated per person within 30 minutes, so a refresh is not a read.
  await recordView({ schoolId, resourceId: id, membershipId });

  const kind = resource.kind as ResourceKind;
  // Re-validated at render, not merely at save. A record could predate the
  // check, or have been written by an import; the link is only ever put in
  // front of a reader if it is safe now.
  const safeUrl = isValidResourceUrl(resource.url);
  const external = !resource.url.startsWith('/');

  return (
    <>
      <PageHeader
        title={resource.title}
        description={resource.authors || undefined}
        actions={
          <Link href="/library" className="text-sm text-brand-700 hover:underline">
            ← Library
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{KIND_LABEL[kind]}</Badge>
                {resource.audience === 'STAFF' ? <Badge tone="danger">Staff only</Badge> : null}
                {resource.publishedAt === null ? <Badge tone="warning">Draft</Badge> : null}
              </div>

              {resource.description ? (
                <p className="text-sm leading-relaxed text-slate-700">{resource.description}</p>
              ) : (
                <p className="text-sm italic text-slate-400">No description was given.</p>
              )}

              {safeUrl ? (
                <a
                  href={resource.url}
                  {...(external
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-onAccent hover:bg-brand-700"
                >
                  {OPEN_VERB[kind]}
                  {external ? ' ↗' : ''}
                </a>
              ) : (
                <Alert tone="danger" title="This link cannot be opened">
                  The address on this record does not use a scheme the library permits. A
                  librarian needs to correct it.
                </Alert>
              )}
            </CardBody>
          </Card>

          {resource.tags ? (
            <Card>
              <CardHeader title="Subjects" />
              <CardBody>
                <div className="flex flex-wrap gap-1.5">
                  {resource.tags.split(',').map((t) => (
                    <Link
                      key={t}
                      href={`/library?tag=${encodeURIComponent(t)}`}
                      className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                    >
                      {t}
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <dl>
              <DetailRow label="Format">{KIND_LABEL[kind]}</DetailRow>
              {resource.publisher ? (
                <DetailRow label="Publisher">{resource.publisher}</DetailRow>
              ) : null}
              {resource.isbn ? <DetailRow label="ISBN">{resource.isbn}</DetailRow> : null}
              {resource.pageCount ? (
                <DetailRow label="Pages">{resource.pageCount}</DetailRow>
              ) : null}
              {resource.durationMin ? (
                <DetailRow label="Duration">
                  {Math.floor(resource.durationMin / 60)}h {resource.durationMin % 60}m
                </DetailRow>
              ) : null}
              <DetailRow label="Language">{resource.language.toUpperCase()}</DetailRow>
              <DetailRow label="Reads">{resource.viewCount}</DetailRow>
              {resource.publishedAt ? (
                <DetailRow label="Added">{formatDate(resource.publishedAt)}</DetailRow>
              ) : null}
              {resource.addedBy ? (
                <DetailRow label="Added by">
                  {resource.addedBy.user.firstName} {resource.addedBy.user.lastName}
                </DetailRow>
              ) : null}
            </dl>

            {canManageLibrary(role) ? (
              <Link
                href={`/library/manage?edit=${resource.id}`}
                className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline"
              >
                Edit this record →
              </Link>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
