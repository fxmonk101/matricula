/**
 * =============================================================================
 * WHAT EVERY SCHEDULED ROUTE SHARES
 * =============================================================================
 *
 * Two things, both of which were first written inside the presence sweep and
 * would otherwise be copied into every cron route after it:
 *
 *   · AUTHORISATION BY SHARED SECRET. There is no user — the caller is a
 *     scheduler — so the usual guards have nothing to check. The secret is
 *     compared in constant time and a missing secret REFUSES rather than
 *     defaulting to open.
 *
 *   · RUNNING A JOB ACROSS EVERY SCHOOL without letting one school, or one
 *     job, stop the rest. A pass that abandons the remaining forty schools
 *     because the third had a bad row is worse than no pass, because it looks
 *     like it ran.
 *
 * Pure: no database and no Next.js, so both halves are tested directly.
 */

/**
 * Compare without leaking the answer through timing.
 *
 * Length is compared first and separately — that much is observable whatever
 * we do, since a wrong-length string cannot be compared byte for byte — and
 * the rest accumulates differences rather than returning early.
 */
export function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < given.length; i += 1) {
    difference |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Whether an `Authorization` header carries the cron secret.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. A query parameter
 * is deliberately NOT accepted: it would end up in access logs. An unset or
 * empty secret refuses everything — an unprotected endpoint that expires every
 * applicant's offer is a denial-of-service with a friendly URL.
 */
export function cronAuthorised(authorization: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return given.length > 0 && secretMatches(given, expected);
}

export interface CronSchool {
  id: string;
  slug: string;
}

export interface CronJob {
  name: string;
  /** Returns how many rows it changed. */
  run: (schoolId: string) => Promise<number>;
  /**
   * A reconciliation: any non-zero count means a stored figure had drifted
   * from the rows it summarises. It has been repaired, but it is a BUG
   * somewhere upstream, not routine work, so it is reported separately
   * instead of being added quietly to a total.
   */
  drift?: boolean;
}

export interface CronPass {
  totals: Record<string, number>;
  failures: { school: string; job: string }[];
  drift: { school: string; job: string; count: number }[];
}

/**
 * Run every job for every school, in order.
 *
 * Jobs within a school are independent: a failed seat reconciliation does not
 * stop that school's offers expiring. The order is still the caller's to
 * choose, because some are not commutative — re-deriving what an invoice has
 * been paid must come before deciding whether it is overdue.
 */
export async function runForEachSchool(
  schools: readonly CronSchool[],
  jobs: readonly CronJob[],
  onError: (school: CronSchool, job: CronJob, error: unknown) => void = () => {},
): Promise<CronPass> {
  const pass: CronPass = {
    totals: Object.fromEntries(jobs.map((job) => [job.name, 0])),
    failures: [],
    drift: [],
  };

  for (const school of schools) {
    for (const job of jobs) {
      try {
        const count = await job.run(school.id);
        pass.totals[job.name] += count;
        if (job.drift && count > 0) {
          pass.drift.push({ school: school.slug, job: job.name, count });
        }
      } catch (error) {
        onError(school, job, error);
        pass.failures.push({ school: school.slug, job: job.name });
      }
    }
  }

  return pass;
}
