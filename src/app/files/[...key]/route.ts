import { NextResponse, type NextRequest } from 'next/server';

import { getTenantContext } from '@/server/tenant-context';
import { schoolIdOf, storage, visibilityOf } from '@/server/storage';

/**
 * Serve a stored file.
 *
 * THIS ROUTE IS THE AUTHORISATION, NOT THE URL.
 *
 * Storage keys are unguessable, but "unguessable" is not a permission — a link
 * gets forwarded, pasted into a ticket, or logged by a proxy, and from then on
 * anybody holding it would have the file. So every private read re-checks the
 * session and, critically, that the file belongs to the school the caller is
 * signed in to. A key names its school, so a leaked link from one tenant is
 * refused for a member of another.
 *
 * Public objects — school logos — skip the session check by design: they render
 * on the signed-out login and apply pages, where there is no session to check.
 * The visibility is read from the key itself rather than passed in, so a caller
 * cannot ask for a private file "as public".
 *
 * Every response is `nosniff` with an explicit type, and anything unrecognised
 * is served as a download rather than rendered. A stored file must never be
 * able to execute as a document in this origin.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join('/');

  const visibility = visibilityOf(key);
  if (!visibility) return new NextResponse('Not found', { status: 404 });

  if (visibility === 'private') {
    const ctx = await getTenantContext();
    // 404 rather than 401/403 throughout: a caller with no business here should
    // not learn that the file exists. Same reasoning as the guardian routes.
    if (!ctx) return new NextResponse('Not found', { status: 404 });
    if (schoolIdOf(key) !== ctx.schoolId) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  const object = await (await storage()).get(key);
  if (!object) return new NextResponse('Not found', { status: 404 });

  const inlineTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  const disposition = inlineTypes.includes(object.mediaType) ? 'inline' : 'attachment';

  return new NextResponse(Buffer.from(object.body), {
    headers: {
      'Content-Type': object.mediaType,
      'Content-Length': String(object.body.byteLength),
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      // A logo is stable and public; a private file must not sit in a shared
      // cache where the next request could be served someone else's.
      'Cache-Control':
        visibility === 'public'
          ? 'public, max-age=3600, stale-while-revalidate=86400'
          : 'private, no-store',
    },
  });
}
