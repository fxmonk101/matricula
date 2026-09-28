import { after } from 'next/server';

/**
 * Hold the request open until `work` finishes — on a serverless host.
 *
 * The audit log and notifications are written with `void recordAudit(...)` and
 * `void notify(...)` on purpose, so posting grades does not wait on four
 * hundred inserts and emails. On a long-running server that is fine: the
 * promise simply finishes after the response. On Vercel it is NOT — once the
 * response is sent the function can be frozen, and whatever was still in
 * flight never happens. Nothing errors. The audit row, the bell or the email is
 * just missing, which is the worst way for a record to fail.
 *
 * `after()` tells the platform to keep the function alive until the promise
 * settles, without making the user wait. It is registered inside the writers
 * themselves, so every existing `void` call is covered without touching one.
 *
 * Outside a request — the seed, the tests, a script — `after` throws, and
 * there is no platform to freeze anything, so the promise is left to run.
 */
export function keepAlive<T>(work: Promise<T>): Promise<T> {
  try {
    after(work);
  } catch {
    // Not in a request scope; nothing to keep alive.
  }
  return work;
}
