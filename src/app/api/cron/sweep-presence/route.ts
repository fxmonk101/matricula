import { NextResponse, type NextRequest } from 'next/server';

import { cronAuthorised } from '@/lib/cron';
import { platformDb } from '@/lib/tenant';
import { sweepForgottenSessions } from '@/server/services/presence.service';

/**
 * =============================================================================
 * CLOSING SESSIONS SOMEBODY FORGOT TO CLOSE
 * =============================================================================
 *
 * `sweepForgottenSessions` was written, tested and called by NOTHING. A member
 * of staff who signed in and went home without signing out stayed signed in for
 * ever: their hours grew without limit, they could not start a new session the
 * next morning because the old one held the unique key, and every attendance
 * report that read those rows was wrong.
 *
 * This route is the trigger. It runs across EVERY school in one pass, because
 * the sweep is a property of the platform rather than of any tenant and a cron
 * that had to be registered per school would be forgotten for the school
 * provisioned next month.
 *
 * AUTHORISATION IS A SHARED SECRET, not a session. There is no user here —
 * the caller is a scheduler — so the usual guards have nothing to check. The
 * secret is compared in constant time and the route refuses outright when none
 * is configured, rather than defaulting to open: an unprotected endpoint that
 * closes everybody's sessions is a denial-of-service with a friendly URL.
 */

export const dynamic = 'force-dynamic';
// Prisma and bcrypt cannot run on the edge runtime.
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[cron] CRON_SECRET is not set. Refusing to run the sweep.');
  }
  if (!cronAuthorised(request.headers.get('authorization'), expected)) {
    // 404, not 401. An endpoint that says "wrong password" tells somebody
    // probing that there is a password worth finding.
    return new NextResponse('Not found', { status: 404 });
  }

  const started = Date.now();
  const schools = await platformDb.school.findMany({
    // A suspended or archived school has nobody signing in to sweep.
    where: { status: { in: ['ACTIVE', 'TRIAL'] } },
    select: { id: true, slug: true },
  });

  let closed = 0;
  const failures: string[] = [];

  for (const school of schools) {
    try {
      const result = await sweepForgottenSessions(school.id);
      closed += result.closed;
    } catch (error) {
      /*
       * One school's failure must not stop the others. A sweep that abandons
       * the remaining forty schools because the third had a bad row is worse
       * than no sweep, because it looks like it ran.
       */
      console.error('[cron] sweep failed for', school.slug, error);
      failures.push(school.slug);
    }
  }

  const body = {
    ok: failures.length === 0,
    schools: schools.length,
    closed,
    failures,
    ms: Date.now() - started,
  };

  console.log('[cron] presence sweep', JSON.stringify(body));

  // 200 even with failures, and the body says which. A non-2xx makes a
  // scheduler retry the whole pass, re-sweeping the schools that succeeded.
  return NextResponse.json(body);
}
