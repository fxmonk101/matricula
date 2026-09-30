/**
 * =============================================================================
 * WHAT MAY TOUCH A DATABASE THAT MIGHT HOLD REAL SCHOOLS
 * =============================================================================
 *
 * Two scripts write a database from outside the app, and each is dangerous in
 * the wrong one:
 *
 *   · The DEMO SEED starts by emptying every table, then creates three demo
 *     schools and an operator account whose password is printed in the README.
 *     Run against production it hands a stranger the platform console; run a
 *     second time it erases every real school without asking.
 *
 *   · The PRODUCTION BOOTSTRAP creates the first operator account. Run against
 *     a database that already has one it would mint a second set of keys.
 *
 * Both decisions are made here, from facts the scripts read, so they are
 * tested rather than trusted.
 */

import { passwordProblems } from './people';

/** Every school the demo seed creates. Anything else is somebody's real data. */
export const DEMO_SCHOOL_SLUGS: ReadonlySet<string> = new Set(['golden-eagles', 'meridian', 'gis']);

/** The demo operator. Any other operator account was made on purpose. */
export const DEMO_OPERATOR_EMAIL = 'operator@platform.local';

/** Printed in the README, so never acceptable as a real password. */
export const DEMO_PASSWORD = 'Password123!';

export interface DatabaseFacts {
  schoolSlugs: readonly string[];
  operatorEmails: readonly (string | null)[];
  databaseUrl: string;
  nodeEnv: string | undefined;
  /** `SEED_DEMO=yes`, set by somebody deliberately building a demo site. */
  demoRequested: boolean;
}

function isLocalDatabase(url: string): boolean {
  if (url.startsWith('file:')) return true;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * Why the demo seed must not run here, or null when it may.
 *
 * Real data is refused with NO override. There is no flag that makes wiping a
 * real school acceptable; somebody who truly means it can drop the database by
 * hand, which is a deliberate act and not a typo in a shell.
 *
 * A remote database with no real data is refused unless demo data was asked
 * for, because a fresh production database looks exactly like that — and the
 * demo seed is precisely what must not land in it.
 */
export function demoSeedRefusal(facts: DatabaseFacts): string | null {
  const realSchools = facts.schoolSlugs.filter((slug) => !DEMO_SCHOOL_SLUGS.has(slug));
  if (realSchools.length > 0) {
    return `This database holds real schools (${realSchools.join(', ')}). The demo seed empties every table first, so it will not run here.`;
  }

  const realOperators = facts.operatorEmails.filter((email) => email !== DEMO_OPERATOR_EMAIL);
  if (realOperators.length > 0) {
    return 'This database has a real platform operator account, so it is a live platform. The demo seed will not run here.';
  }

  if (facts.nodeEnv === 'production') {
    return 'NODE_ENV is production. The demo seed creates accounts whose password is published in the README.';
  }

  if (!isLocalDatabase(facts.databaseUrl) && !facts.demoRequested) {
    return 'This is not a local database. If you really are building a demo site, set SEED_DEMO=yes. For a real platform, run `npm run db:bootstrap` instead.';
  }

  return null;
}

export interface BootstrapFacts {
  userCount: number;
  schoolCount: number;
  operatorCount: number;
}

/**
 * Why the production bootstrap must not run here, or null when it may.
 *
 * It only ever runs on an EMPTY database. After that, operators are added from
 * the console by an operator, where the act is audited; a script that could
 * be re-run to mint another account is a back door with a README.
 */
export function bootstrapRefusal(facts: BootstrapFacts): string | null {
  if (facts.operatorCount > 0) {
    return 'A platform operator already exists. Sign in as them; this script only sets up an empty platform.';
  }
  if (facts.schoolCount > 0 || facts.userCount > 0) {
    return `This database is not empty (${facts.schoolCount} schools, ${facts.userCount} users). Bootstrap only runs on a fresh database.`;
  }
  return null;
}

/** What is wrong with the operator's chosen credentials, if anything. */
export function operatorCredentialProblems(email: string, password: string): string[] {
  const problems: string[] = [];
  const address = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    problems.push('OPERATOR_EMAIL must be a real email address.');
  }
  if (address === DEMO_OPERATOR_EMAIL) {
    problems.push(`${DEMO_OPERATOR_EMAIL} is the demo operator. Use an address you control.`);
  }
  if (password === DEMO_PASSWORD) {
    problems.push('That is the demo password, and it is published in the README.');
  }
  // The key to every school on the platform: longer than a staff password.
  if (password.trim().length < 16) {
    problems.push('The operator password must be at least 16 characters.');
  }
  problems.push(...passwordProblems(password, { email: address }).filter((p) => !p.startsWith('Use at least')));

  return problems;
}
