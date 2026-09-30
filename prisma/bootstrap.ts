/**
 * =============================================================================
 * SET UP A REAL PLATFORM — ONCE, ON AN EMPTY DATABASE
 * =============================================================================
 *
 * The production counterpart of `seed.ts`. It creates the platform operator
 * account, with the email and password YOU choose, and the subscription plans a
 * school must be put on. No demo schools, no demo users, nothing printed in any
 * README. Schools are then created from the operator console at /operator.
 *
 *   read -s OPERATOR_PASSWORD && export OPERATOR_PASSWORD
 *   OPERATOR_EMAIL=you@yourcompany.com npm run db:bootstrap
 *
 * `read -s` keeps the password out of your shell history.
 *
 * It refuses to run on a database that already has anybody in it: see
 * `bootstrapRefusal` in src/lib/domain/seed-guard.ts.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { bootstrapRefusal, operatorCredentialProblems } from '../src/lib/domain/seed-guard';
import { createDefaultPlans, DEFAULT_PLANS } from './plans';

const db = new PrismaClient();

async function main(): Promise<number> {
  const email = (process.env.OPERATOR_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.OPERATOR_PASSWORD ?? '';

  if (!email || !password) {
    console.error('Set OPERATOR_EMAIL and OPERATOR_PASSWORD. See the comment at the top of prisma/bootstrap.ts.');
    return 1;
  }

  const problems = operatorCredentialProblems(email, password);
  if (problems.length > 0) {
    console.error('Not bootstrapping:');
    for (const problem of problems) console.error(`  · ${problem}`);
    return 1;
  }

  const refusal = bootstrapRefusal({
    userCount: await db.user.count(),
    schoolCount: await db.school.count(),
    operatorCount: await db.platformAdmin.count(),
  });
  if (refusal) {
    console.error(`Not bootstrapping: ${refusal}`);
    return 1;
  }

  // Same cost factor as the app (src/lib/auth/password.ts).
  const passwordHash = await bcrypt.hash(password, 12);

  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, firstName: 'Platform', lastName: 'Operator' },
    });
    await tx.platformAdmin.create({ data: { userId: user.id } });
    // A school cannot be provisioned without a plan to put it on.
    await createDefaultPlans(tx);
  });

  console.log('');
  console.log('  Platform ready.');
  console.log(`  Operator: ${email}`);
  console.log(`  Plans:    ${DEFAULT_PLANS.map((p) => p.name).join(', ')} — adjust prices in the plans table before selling`);
  console.log('  Sign in at /operator/login and create your first school.');
  console.log('');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
