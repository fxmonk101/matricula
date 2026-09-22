import { NextResponse, type NextRequest } from 'next/server';

import { getTenantContext } from '@/server/tenant-context';
import { mayReadSubmission } from '@/server/services/coursework.service';
import { dbFor } from '@/lib/tenant';
import { storage } from '@/server/storage';
import { mayRenderInline, safeDisplayName } from '@/lib/domain/upload';

/**
 * Serve a student's submitted file.
 *
 * MOUNTED AT /submissions/<id>/file, NOT UNDER /files.
 *
 * `/files/[...key]` is a catch-all, and Next resolves it in preference to a
 * sibling route beneath the same prefix — so the first version of this, at
 * `/files/submission/<id>`, never executed at all. Every request fell through
 * to the catch-all, which saw a key beginning "submission/" rather than
 * "private/" and returned 404. It looked exactly like a working deny rule.
 *
 * Only a live probe caught it: the tests exercise `mayReadSubmission`, which
 * was correct the whole time, and never exercised the routing.
 *
 * WHY THIS ROUTE EXISTS AT ALL, when `/files/[...key]` already serves private
 * objects: that route authorises by SESSION AND TENANT, which is exactly right
 * for a school logo or an avatar and nowhere near enough for a piece of
 * assessed work. Under it, any signed-in member of the school — every other
 * student on the course included — could read any submission whose key they
 * learned, and keys travel: in a screenshot, a support ticket, a proxy log.
 *
 * So this route addresses the file by the SUBMISSION rather than by the key,
 * resolves the row, and asks who is allowed to read that particular piece of
 * work. The key never appears in a URL at all.
 *
 * Three people may read it: its author, the lecturer of record for the section,
 * and the office that can already override any grade in the institution.
 * Everyone else gets 404 — never 403, because "this exists but is not yours"
 * tells an outsider that a given student submitted to a given assignment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await params;

  const ctx = await getTenantContext();
  if (!ctx) return new NextResponse('Not found', { status: 404 });

  const allowed = await mayReadSubmission({
    schoolId: ctx.schoolId,
    submissionId,
    userId: ctx.session.sub,
    role: ctx.role,
  });
  if (!allowed) return new NextResponse('Not found', { status: 404 });

  // Read through the tenant client, so a submission id from another school is
  // already invisible before authorisation is even considered.
  const submission = await dbFor(ctx.schoolId).submission.findUnique({
    where: { id: submissionId },
    select: { fileKey: true, fileName: true },
  });
  if (!submission?.fileKey) return new NextResponse('Not found', { status: 404 });

  const object = await (await storage()).get(submission.fileKey);
  if (!object) return new NextResponse('Not found', { status: 404 });

  /*
   * A submitted file is served as an ATTACHMENT unless it is one of the few
   * formats that cannot carry a surprise.
   *
   * This is what makes accepting Word documents defensible. They arrive as ZIP
   * containers whose bytes are indistinguishable from a .zip or a .jar, and
   * unlike an image they cannot be re-encoded clean — so they are never handed
   * to the browser as something to render, only as something to save.
   */
  const inline = mayRenderInline(object.mediaType);

  // The student's own filename, stripped of path segments and control
  // characters, and quoted — so a name with a comma or a quote in it cannot
  // break out of the header.
  const display = safeDisplayName(submission.fileName ?? 'submission');
  const quoted = display.replace(/["\\]/g, '_');

  return new NextResponse(Buffer.from(object.body), {
    headers: {
      'Content-Type': object.mediaType,
      'Content-Length': String(object.body.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${quoted}"`,
      'X-Content-Type-Options': 'nosniff',
      // Assessed work must never sit in a shared cache where the next request
      // could be served somebody else's.
      'Cache-Control': 'private, no-store',
    },
  });
}
