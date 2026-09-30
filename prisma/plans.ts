import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The plans a school can be sold.
 *
 * Shared by the demo seed and the production bootstrap: provisioning a school
 * REQUIRES a plan, so a platform set up without these could not create its
 * first school.
 *
 * Prices in MINOR units, as everywhere else in the system. The ceilings are the
 * interesting part: `null` is unlimited and `0` sells nothing, and the two must
 * stay distinguishable — `checkSeat` treats them as opposites and a test pins
 * that they are not confused.
 */
export const DEFAULT_PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'A single primary or secondary school finding its feet.',
    priceMinor: 45_000_00,
    maxStudents: 300,
    maxStaff: 30,
    trialDays: 30,
    position: 0,
    features: { library: true, forums: true, timetable: true, admissions: false },
  },
  {
    code: 'STANDARD',
    name: 'Standard',
    description: 'A full school with admissions, finance and reporting.',
    priceMinor: 120_000_00,
    maxStudents: 1_500,
    maxStaff: 150,
    trialDays: 30,
    position: 1,
    features: { library: true, forums: true, timetable: true, admissions: true },
  },
  {
    code: 'INSTITUTION',
    name: 'Institution',
    description: 'A university or multi-campus group. No seat ceiling.',
    priceMinor: 480_000_00,
    maxStudents: null,
    maxStaff: null,
    trialDays: 14,
    position: 2,
    features: { library: true, forums: true, timetable: true, admissions: true },
  },
];

/** Create the default plans, returning plan id by code. */
export async function createDefaultPlans(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};
  for (const spec of DEFAULT_PLANS) {
    const plan = await db.plan.create({
      data: {
        code: spec.code,
        name: spec.name,
        description: spec.description,
        priceMinor: spec.priceMinor,
        currencyCode: 'NGN',
        billingPeriod: 'ANNUAL',
        maxStudents: spec.maxStudents,
        maxStaff: spec.maxStaff,
        featuresJson: JSON.stringify(spec.features),
        trialDays: spec.trialDays,
        position: spec.position,
      },
    });
    created[spec.code] = plan.id;
  }
  return created;
}
