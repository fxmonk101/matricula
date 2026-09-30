import { describe, expect, it } from 'vitest';

import {
  bootstrapRefusal,
  demoSeedRefusal,
  operatorCredentialProblems,
  type DatabaseFacts,
} from '@/lib/domain/seed-guard';

/*
 * The demo seed empties every table and creates accounts whose password is in
 * the README. These rules are all that stands between it and a live platform.
 */

const LOCAL_DEMO: DatabaseFacts = {
  schoolSlugs: ['golden-eagles', 'meridian', 'gis'],
  operatorEmails: ['operator@platform.local'],
  databaseUrl: 'file:./dev.db',
  nodeEnv: 'development',
  demoRequested: false,
};

describe('the demo seed', () => {
  it('runs on a local demo database, and on an empty one', () => {
    expect(demoSeedRefusal(LOCAL_DEMO)).toBeNull();
    expect(demoSeedRefusal({ ...LOCAL_DEMO, schoolSlugs: [], operatorEmails: [] })).toBeNull();
    expect(
      demoSeedRefusal({ ...LOCAL_DEMO, databaseUrl: 'postgresql://u:p@localhost:5432/db' }),
    ).toBeNull();
  });

  it('refuses a database holding a real school — with no way round it', () => {
    const real = { ...LOCAL_DEMO, schoolSlugs: ['golden-eagles', 'unilag'] };
    expect(demoSeedRefusal(real)).toMatch(/unilag/);
    // Asking for a demo does not make wiping a real school acceptable.
    expect(demoSeedRefusal({ ...real, demoRequested: true })).toMatch(/real schools/);
  });

  it('refuses a live platform even before its first school', () => {
    // The bootstrap has run, so the operator is real, but no school exists yet.
    const bootstrapped = { ...LOCAL_DEMO, schoolSlugs: [], operatorEmails: ['ops@vendor.com'] };
    expect(demoSeedRefusal(bootstrapped)).toMatch(/real platform operator/);
    expect(demoSeedRefusal({ ...bootstrapped, demoRequested: true })).toMatch(/real platform operator/);
  });

  it('refuses in production', () => {
    expect(demoSeedRefusal({ ...LOCAL_DEMO, nodeEnv: 'production' })).toMatch(/production/);
  });

  it('refuses a fresh remote database unless a demo site was asked for', () => {
    const remote = {
      ...LOCAL_DEMO,
      schoolSlugs: [],
      operatorEmails: [],
      databaseUrl: 'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb',
    };
    expect(demoSeedRefusal(remote)).toMatch(/db:bootstrap/);
    expect(demoSeedRefusal({ ...remote, demoRequested: true })).toBeNull();
  });

  it('treats an unreadable connection string as remote', () => {
    expect(demoSeedRefusal({ ...LOCAL_DEMO, databaseUrl: 'not a url' })).not.toBeNull();
  });
});

describe('the production bootstrap', () => {
  it('runs only on an empty database', () => {
    expect(bootstrapRefusal({ userCount: 0, schoolCount: 0, operatorCount: 0 })).toBeNull();
    expect(bootstrapRefusal({ userCount: 1, schoolCount: 0, operatorCount: 0 })).toMatch(/not empty/);
    expect(bootstrapRefusal({ userCount: 0, schoolCount: 1, operatorCount: 0 })).toMatch(/not empty/);
  });

  it('will not mint a second operator', () => {
    expect(bootstrapRefusal({ userCount: 1, schoolCount: 0, operatorCount: 1 })).toMatch(/already exists/);
  });
});

describe("the operator's credentials", () => {
  const GOOD = 'correct-horse-battery-staple-42';

  it('accepts a long password and a real address', () => {
    expect(operatorCredentialProblems('ops@vendor.com', GOOD)).toEqual([]);
  });

  it('refuses the demo account and the demo password', () => {
    expect(operatorCredentialProblems('operator@platform.local', GOOD).join(' ')).toMatch(/demo operator/);
    expect(operatorCredentialProblems('ops@vendor.com', 'Password123!').join(' ')).toMatch(/demo password/);
  });

  it('asks more of the key to every school than of a staff password', () => {
    expect(operatorCredentialProblems('ops@vendor.com', 'fifteen-chars!!').join(' ')).toMatch(/16 characters/);
  });

  it('refuses a malformed address and a password built from it', () => {
    expect(operatorCredentialProblems('not-an-email', GOOD).join(' ')).toMatch(/real email/);
    expect(operatorCredentialProblems('adebayo@vendor.com', 'adebayo-is-the-operator').join(' ')).toMatch(
      /own name or email/,
    );
  });
});
