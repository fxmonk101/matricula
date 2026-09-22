import { NextResponse, type NextRequest } from 'next/server';

import { getTenantContext } from '@/server/tenant-context';
import { enrolmentFor } from '@/server/services/lms.service';
import { dbFor } from '@/lib/tenant';
import { recordAudit } from '@/server/services/audit.service';
import { linkRejectionReason } from '@/lib/domain/lms';

/**
 * Join a virtual class.
 *
 * A REDIRECT RATHER THAN A DIRECT LINK, so that joining is a thing the system
 * observes. The brief asks for the click to be tracked, and a bare anchor to
 * the provider cannot be: the browser goes straight to Microsoft and this
 * application never learns anybody attended.
 *
 * It also means the join URL is never in the page. A student who is not
 * enrolled cannot copy a link out of somebody's screenshot, because the page
 * only ever carries an id.
 *
 * Three checks before the redirect, and none is redundant: a session, an
 * enrolment on THIS course, and a published item. The last matters because a
 * lecturer who withdraws a class expects that to stop people joining it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const itemId = request.nextUrl.searchParams.get('item') ?? '';

  const ctx = await getTenantContext();
  if (!ctx || !ctx.session.pid) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const enrolment = await enrolmentFor({
    schoolId: ctx.schoolId,
    offeringId,
    studentProfileId: ctx.session.pid,
  });
  if (!enrolment) return new NextResponse('Not found', { status: 404 });

  const item = await dbFor(ctx.schoolId).moduleItem.findUnique({
    where: { id: itemId },
    include: {
      virtualClass: true,
      module: { include: { space: { select: { offeringId: true } } } },
    },
  });

  // The class must be published, in a published module, on THIS course.
  if (
    !item?.virtualClass ||
    !item.isPublished ||
    !item.module.isPublished ||
    item.module.space.offeringId !== offeringId
  ) {
    return new NextResponse('Not found', { status: 404 });
  }

  /*
   * The stored URL is re-checked on the way out. It was validated when saved,
   * but this is the moment a browser is sent somewhere — and a redirect is
   * exactly the wrong place to discover that a row holds `javascript:`.
   */
  if (linkRejectionReason(item.virtualClass.joinUrl)) {
    return new NextResponse('Not found', { status: 404 });
  }

  void recordAudit({
    schoolId: ctx.schoolId,
    actorId: ctx.session.sub,
    action: 'lms.class.join',
    entityType: 'VirtualClass',
    entityId: item.virtualClass.id,
    summary: `Joined "${item.title}".`,
  });

  // 302, not 308: this is a one-off decision about one student at one moment,
  // and a permanent redirect would be cached and skip every check above.
  return NextResponse.redirect(item.virtualClass.joinUrl, 302);
}
