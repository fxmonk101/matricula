import { NextResponse, type NextRequest } from 'next/server';

import { cronAuthorised, runForEachSchool, type CronJob } from '@/lib/cron';
import { platformDb } from '@/lib/tenant';
import { expireStaleOffers } from '@/server/services/admissions.service';
import { reconcileSeatCounts } from '@/server/services/enrollment.service';
import { markOverdueInvoices, reconcileInvoices } from '@/server/services/finance.service';
import { announceRegistrationOpening } from '@/server/services/term.service';

/**
 * =============================================================================
 * THE JOBS THE PRD SAID WOULD RUN ON A SCHEDULE, AND NOTHING RAN
 * =============================================================================
 *
 * Four functions were written, tested and called by NOTHING — the same defect
 * the presence sweep had:
 *
 *   · An invoice past its due date still said ISSUED, so the finance office's
 *     list of debtors and a student's own statement both understated what was
 *     overdue.
 *   · An offer past its deadline still said OFFERED on the admissions list.
 *     Nobody could ACCEPT it — `isOfferLive` checks the clock at the moment of
 *     acceptance, deliberately, so a job that has not run yet cannot let a
 *     stale offer through — but an officer counting places still held would
 *     count it.
 *   · The two reconciliations, which exist to notice when a stored total has
 *     drifted from the rows it summarises, never looked.
 *
 * None of this places a financial hold. Placing one is a deliberate act by a
 * named officer (FR-6.14), and a scheduler is not one.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Order matters for the first two. Re-deriving what an invoice has been paid
 * can move it to PAID; marking it overdue first would briefly write OVERDUE
 * onto an invoice that is settled.
 */
const JOBS: CronJob[] = [
  {
    name: 'invoicesReconciled',
    drift: true,
    run: async (schoolId) => {
      const { repaired } = await reconcileInvoices(schoolId);
      if (repaired.length > 0) {
        // Named, so whoever reads the log can find the invoices.
        console.error('[cron] invoice paid totals had drifted', schoolId, repaired);
      }
      return repaired.length;
    },
  },
  {
    name: 'invoicesOverdue',
    run: async (schoolId) => (await markOverdueInvoices(schoolId)).updated,
  },
  {
    name: 'seatCountsReconciled',
    drift: true,
    run: async (schoolId) => (await reconcileSeatCounts(schoolId)).repaired,
  },
  {
    name: 'offersExpired',
    run: async (schoolId) => (await expireStaleOffers(schoolId)).expired,
  },
  {
    // Counts students told, not terms: the number worth seeing in the log.
    name: 'studentsToldRegistrationOpens',
    run: (schoolId) => announceRegistrationOpening(schoolId),
  },
];

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[cron] CRON_SECRET is not set. Refusing to run the nightly jobs.');
  }
  if (!cronAuthorised(request.headers.get('authorization'), expected)) {
    // 404, not 401: probing should not learn there is a secret worth finding.
    return new NextResponse('Not found', { status: 404 });
  }

  const started = Date.now();
  const schools = await platformDb.school.findMany({
    // A suspended or archived school is not billing or admitting anybody.
    where: { status: { in: ['ACTIVE', 'TRIAL'] } },
    select: { id: true, slug: true },
  });

  const pass = await runForEachSchool(schools, JOBS, (school, job, error) => {
    console.error('[cron] nightly job failed', school.slug, job.name, error);
  });

  const body = {
    ok: pass.failures.length === 0,
    schools: schools.length,
    ...pass.totals,
    failures: pass.failures,
    drift: pass.drift,
    ms: Date.now() - started,
  };

  console.log('[cron] nightly', JSON.stringify(body));

  // 200 even with failures, and the body says which. A non-2xx makes a
  // scheduler retry the whole pass, re-running the schools that succeeded.
  return NextResponse.json(body);
}
