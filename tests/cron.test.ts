import { describe, expect, it } from 'vitest';

import { cronAuthorised, runForEachSchool, secretMatches, type CronJob } from '@/lib/cron';

/*
 * The scheduled routes have no user, so these two functions ARE their security
 * and their reliability. The first decides who may expire every applicant's
 * offer in one request; the second decides whether one bad school can stop
 * forty others being billed.
 */

describe('the cron secret', () => {
  const SECRET = 'k3y-that-is-long-enough';

  it('admits the scheduler', () => {
    expect(cronAuthorised(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('refuses everything when no secret is configured', () => {
    // Defaulting to open would make the route a public button.
    expect(cronAuthorised('Bearer ', undefined)).toBe(false);
    expect(cronAuthorised('Bearer ', '')).toBe(false);
    expect(cronAuthorised(null, undefined)).toBe(false);
  });

  it('refuses a missing, empty or malformed header', () => {
    expect(cronAuthorised(null, SECRET)).toBe(false);
    expect(cronAuthorised('', SECRET)).toBe(false);
    expect(cronAuthorised('Bearer ', SECRET)).toBe(false);
    expect(cronAuthorised(SECRET, SECRET)).toBe(false);
    expect(cronAuthorised(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it('refuses a near miss', () => {
    expect(cronAuthorised(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAuthorised(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(cronAuthorised(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
  });

  it('compares strings exactly', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abc', 'abd')).toBe(false);
    expect(secretMatches('abc', 'abcd')).toBe(false);
    expect(secretMatches('', '')).toBe(true);
  });
});

describe('running a job across every school', () => {
  const schools = [
    { id: 's1', slug: 'alpha' },
    { id: 's2', slug: 'beta' },
    { id: 's3', slug: 'gamma' },
  ];

  it('totals each job across schools', async () => {
    const jobs: CronJob[] = [
      { name: 'a', run: async () => 2 },
      { name: 'b', run: async (id) => (id === 's2' ? 5 : 0) },
    ];
    const pass = await runForEachSchool(schools, jobs);
    expect(pass.totals).toEqual({ a: 6, b: 5 });
    expect(pass.failures).toEqual([]);
  });

  it('does not let one school stop the others', async () => {
    const seen: string[] = [];
    const jobs: CronJob[] = [
      {
        name: 'a',
        run: async (id) => {
          seen.push(id);
          if (id === 's1') throw new Error('bad row');
          return 1;
        },
      },
    ];
    const errors: string[] = [];
    const pass = await runForEachSchool(schools, jobs, (school, job) => errors.push(`${school.slug}/${job.name}`));
    expect(seen).toEqual(['s1', 's2', 's3']);
    expect(pass.totals.a).toBe(2);
    expect(pass.failures).toEqual([{ school: 'alpha', job: 'a' }]);
    expect(errors).toEqual(['alpha/a']);
  });

  it('does not let one job stop the rest of that school', async () => {
    // A broken seat reconciliation must not leave the school's offers unexpired.
    const jobs: CronJob[] = [
      { name: 'broken', run: async () => { throw new Error('x'); } },
      { name: 'after', run: async () => 1 },
    ];
    const pass = await runForEachSchool([schools[0]], jobs);
    expect(pass.totals).toEqual({ broken: 0, after: 1 });
    expect(pass.failures).toEqual([{ school: 'alpha', job: 'broken' }]);
  });

  it('runs jobs in the order given, within each school', async () => {
    // Re-deriving what was paid must precede deciding what is overdue.
    const order: string[] = [];
    const jobs: CronJob[] = ['first', 'second'].map((name) => ({
      name,
      run: async (id) => {
        order.push(`${id}:${name}`);
        return 0;
      },
    }));
    await runForEachSchool(schools.slice(0, 2), jobs);
    expect(order).toEqual(['s1:first', 's1:second', 's2:first', 's2:second']);
  });

  it('reports drift separately, and only when there was some', async () => {
    const jobs: CronJob[] = [
      { name: 'reconcile', drift: true, run: async (id) => (id === 's3' ? 4 : 0) },
      { name: 'routine', run: async () => 9 },
    ];
    const pass = await runForEachSchool(schools, jobs);
    expect(pass.drift).toEqual([{ school: 'gamma', job: 'reconcile', count: 4 }]);
    expect(pass.totals).toEqual({ reconcile: 4, routine: 27 });
  });

  it('reports zeroes, not missing keys, for a quiet night', async () => {
    const pass = await runForEachSchool([], [{ name: 'a', run: async () => 1 }]);
    expect(pass.totals).toEqual({ a: 0 });
  });
});
