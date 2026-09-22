import { NextResponse, type NextRequest } from 'next/server';

import { getTenantContext } from '@/server/tenant-context';
import { mayReadMaterial } from '@/server/services/lms.service';
import { dbFor } from '@/lib/tenant';
import { storage } from '@/server/storage';
import { mayRenderInline, safeDisplayName } from '@/lib/domain/upload';

/**
 * Serve a file a lecturer attached to a module.
 *
 * The sibling of `/submissions/<id>/file`, and mounted outside `/files` for the
 * same reason: `/files/[...key]` is a catch-all and Next resolves it in
 * preference to anything beneath the same prefix.
 *
 * Course material is not public. A past paper, an unreleased reading list or a
 * set of solutions is exactly the sort of thing that must not sit at a
 * guessable URL — so this addresses the file by its ITEM, resolves the row, and
 * asks whether this person is on the course. `/files/[...key]` would have
 * authorised it by tenancy alone, which is every member of the school.
 *
 * Refusals are 404 rather than 403, as everywhere else here: "this exists but
 * is not yours" still tells an outsider what a course contains.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;

  const ctx = await getTenantContext();
  if (!ctx) return new NextResponse('Not found', { status: 404 });

  const allowed = await mayReadMaterial({
    schoolId: ctx.schoolId,
    itemId,
    userId: ctx.session.sub,
    role: ctx.role,
    studentProfileId: ctx.session.pid,
    instructorProfileId: ctx.session.pid,
  });
  if (!allowed) return new NextResponse('Not found', { status: 404 });

  const item = await dbFor(ctx.schoolId).moduleItem.findUnique({
    where: { id: itemId },
    select: { fileKey: true, fileName: true },
  });
  if (!item?.fileKey) return new NextResponse('Not found', { status: 404 });

  const object = await (await storage()).get(item.fileKey);
  if (!object) return new NextResponse('Not found', { status: 404 });

  // Attachment unless it is one of the few formats that cannot carry a
  // surprise — the same rule the submission route applies.
  const inline = mayRenderInline(object.mediaType);
  const display = safeDisplayName(item.fileName ?? 'material');
  // Quotes and backslashes would break out of the header's quoted string.
  const quoted = display.replace(/["\\]/g, '_');

  return new NextResponse(Buffer.from(object.body), {
    headers: {
      'Content-Type': object.mediaType,
      'Content-Length': String(object.body.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${quoted}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
