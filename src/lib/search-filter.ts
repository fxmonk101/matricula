/**
 * =============================================================================
 * CASE-INSENSITIVE SEARCH, ON EITHER DATABASE
 * =============================================================================
 *
 * `contains` behaves differently on the two engines this app runs on:
 *
 *   SQLite      already case-INSENSITIVE for ASCII. Passing `mode` is a type
 *               error, because the SQLite connector does not generate it.
 *   PostgreSQL  case-SENSITIVE. Without `mode: 'insensitive'`, typing "ada"
 *               stops matching "Ada" — and the page returns nothing, which
 *               reads as "no such student" rather than as a bug.
 *
 * So the literal that is correct on one is wrong on the other, and the failure
 * on Postgres is silent. Every search predicate in the app goes through here
 * instead, and the right shape is emitted for whichever engine is configured.
 *
 * The provider is read from `DATABASE_URL` rather than from a separate flag,
 * because a flag is a second thing to remember when the datasource changes —
 * and it would be remembered on the day of the switch and forgotten on the day
 * of the rollback.
 */

function isPostgres(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

/**
 * A case-insensitive `contains` filter.
 *
 * The return type is narrowed to `{ contains: string }` deliberately. `mode` is
 * absent from SQLite's generated filter types, so a faithful type would fail to
 * compile on one of the two engines the app supports. The cast is confined to
 * this one function rather than scattered across twenty call sites.
 */
export function containsInsensitive(value: string): { contains: string } {
  return (
    isPostgres() ? { contains: value, mode: 'insensitive' } : { contains: value }
  ) as { contains: string };
}

/** Shorthand, because it appears four times in a row in most `OR` blocks. */
export const like = containsInsensitive;
