import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  activateSchool,
  assertSeatAvailable,
  countSeats,
  loadEntitlement,
  provisionSchool,
  raiseSubscriptionInvoice,
  recordSubscriptionPayment,
  setPlatformAdmin,
  setSubscriptionStatus,
} from '@/server/services/platform.service';
import { verifyPassword } from '@/lib/auth/password';
import { schoolAllowsSignIn } from '@/lib/domain/enums';

/**
 * =============================================================================
 * PROVISIONING AND BILLING
 * =============================================================================
 *
 * Integration tests against the real development database, in the same style
 * and for the same reason as `tenant.test.ts`: the behaviour under test is a
 * multi-statement transaction, and a mocked Prisma would only test the mock.
 *
 * The thing most worth pinning here is ATOMICITY. A school that exists with no
 * configuration throws on every page it has; a school with no owner is one that
 * only a database console can repair. Neither failure is visible until somebody
 * tries to use the school, which is days after the operator moved on.
 */

const raw = new PrismaClient();

const STAMP = Date.now();
const OWNER_EMAIL = `owner-${STAMP}@platformtest.example`;
const createdSchools: string[] = [];
let planId = '';
let unlimitedPlanId = '';

beforeAll(async () => {
  const plan = await raw.plan.create({
    data: {
      code: `TEST${STAMP % 100000}`,
      name: 'Test plan',
      priceMinor: 100_00,
      currencyCode: 'NGN',
      maxStudents: 2,
      maxStaff: 2,
      trialDays: 14,
      featuresJson: JSON.stringify({ library: true }),
    },
  });
  planId = plan.id;

  const unlimited = await raw.plan.create({
    data: {
      code: `UNL${STAMP % 100000}`,
      name: 'Unlimited test plan',
      priceMinor: 500_00,
      maxStudents: null,
      maxStaff: null,
      trialDays: 0,
    },
  });
  unlimitedPlanId = unlimited.id;
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: { in: createdSchools } } });
  await raw.user.deleteMany({ where: { email: { contains: '@platformtest.example' } } });
  await raw.plan.deleteMany({ where: { id: { in: [planId, unlimitedPlanId] } } });
  await raw.$disconnect();
});

async function provision(overrides: Partial<Parameters<typeof provisionSchool>[0]> = {}) {
  const result = await provisionSchool({
    name: `Test School ${STAMP}`,
    academicModel: 'K12',
    timezone: 'Africa/Accra',
    currencyCode: 'GHS',
    gradingPresetKey: 'PERCENTAGE',
    planId,
    owner: { email: OWNER_EMAIL, firstName: 'Ada', lastName: 'Test' },
    actorUserId: null,
    ...overrides,
  });
  if (result.schoolId) createdSchools.push(result.schoolId);
  return result;
}

describe('provisioning a school', () => {
  it('creates the school, its config, its subscription and its owner together', async () => {
    const result = await provision();
    expect(result.ok, result.message).toBe(true);

    const school = await raw.school.findUnique({
      where: { id: result.schoolId! },
      include: { config: true, subscription: true, memberships: true },
    });
    // All four, or the school is unusable in a way nobody notices for days.
    expect(school!.config).not.toBeNull();
    expect(school!.subscription).not.toBeNull();
    expect(school!.memberships).toHaveLength(1);
    expect(school!.memberships[0].role).toBe('OWNER');
  });

  it('opens the school in setup, not open to everybody', async () => {
    const result = await provision({ name: `Setup Gate ${STAMP}` });
    const school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('PROVISIONING');

    // The gate that makes PROVISIONING mean something. Before this package,
    // PROVISIONING was acted on nowhere and a half-built school was fully
    // signable-into by anyone who knew its slug.
    expect(schoolAllowsSignIn('PROVISIONING', 'OWNER')).toBe(true);
    for (const role of ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'GUARDIAN'] as const) {
      expect(schoolAllowsSignIn('PROVISIONING', role), role).toBe(false);
    }
  });

  it('issues a password that actually verifies against the stored hash', async () => {
    const result = await provision({
      name: `Password ${STAMP}`,
      owner: { email: `pw-${STAMP}@platformtest.example`, firstName: 'Pa', lastName: 'Test' },
    });
    expect(result.temporaryPassword).toBeTruthy();

    const user = await raw.user.findUnique({ where: { email: `pw-${STAMP}@platformtest.example` } });
    expect(await verifyPassword(result.temporaryPassword!, user!.passwordHash)).toBe(true);
    expect(user!.mustChangePassword).toBe(true);
  });

  it('derives and disambiguates the address and the document prefix', async () => {
    // Both are unique columns. A collision on `code` would make two schools'
    // invoice numbers indistinguishable to a human reading them.
    const first = await provision({ name: `Ridge Academy ${STAMP}` });
    const second = await provision({
      name: `Ridge Academy ${STAMP}`,
      owner: { email: `dup-${STAMP}@platformtest.example`, firstName: 'Du', lastName: 'Test' },
    });
    expect(second.ok, second.message).toBe(true);
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug!.endsWith('-2')).toBe(true);

    const [a, b] = await Promise.all([
      raw.school.findUnique({ where: { id: first.schoolId! } }),
      raw.school.findUnique({ where: { id: second.schoolId! } }),
    ]);
    expect(a!.code).not.toBe(b!.code);
  });

  it('gives an existing person a membership rather than a second account', async () => {
    const before = await raw.user.count({ where: { email: OWNER_EMAIL } });
    const result = await provision({ name: `Second School ${STAMP}` });
    expect(result.ok).toBe(true);

    // Identity is global; authorisation is per-school. A second User row would
    // give the same human two passwords and two histories.
    expect(await raw.user.count({ where: { email: OWNER_EMAIL } })).toBe(before);
    // And no password is shown, because they keep the one they already have —
    // displaying a freshly generated one would be a lie they cannot sign in with.
    expect(result.temporaryPassword).toBeUndefined();
  });

  it('applies the chosen grading preset rather than a grade-point number', async () => {
    // Two presets share a 4.0 ceiling and differ in their bands, so selecting
    // by number would silently discard one of them.
    const us = await provision({
      name: `US Scale ${STAMP}`,
      academicModel: 'HIGHER_ED',
      gradingPresetKey: 'US_4',
      owner: { email: `us-${STAMP}@platformtest.example`, firstName: 'Us', lastName: 'Test' },
    });
    const school = await raw.school.findUnique({
      where: { id: us.schoolId! },
      include: { config: true },
    });
    const grading = JSON.parse(school!.config!.gradingJson);
    expect(grading.maxGradePoint).toBe(4);
    expect(grading.scale.map((b: { letter: string }) => b.letter)).toContain('A-');
  });

  it('gives a K-12 school its K-12 policy and a university none', async () => {
    const k12 = await provision({
      name: `K12 Policy ${STAMP}`,
      academicModel: 'K12',
      owner: { email: `k12-${STAMP}@platformtest.example`, firstName: 'Ka', lastName: 'Test' },
    });
    const uni = await provision({
      name: `Uni Policy ${STAMP}`,
      academicModel: 'HIGHER_ED',
      owner: { email: `uni-${STAMP}@platformtest.example`, firstName: 'Un', lastName: 'Test' },
    });
    const [a, b] = await Promise.all([
      raw.schoolConfig.findUnique({ where: { schoolId: k12.schoolId! } }),
      raw.schoolConfig.findUnique({ where: { schoolId: uni.schoolId! } }),
    ]);
    expect(a!.k12Json).not.toBeNull();
    expect(b!.k12Json).toBeNull();
  });

  it('resolves the currency server-side, symbol and exponent together', async () => {
    const result = await provision({
      name: `Currency ${STAMP}`,
      currencyCode: 'GHS',
      owner: { email: `cur-${STAMP}@platformtest.example`, firstName: 'Cu', lastName: 'Test' },
    });
    const config = await raw.schoolConfig.findUnique({ where: { schoolId: result.schoolId! } });
    const currency = JSON.parse(config!.financeJson).currency;
    expect(currency).toEqual({ code: 'GHS', symbol: '₵', exponent: 2 });
  });

  it('refuses a bad plan, a bad email and a bad grading key without creating anything', async () => {
    const before = await raw.school.count();
    for (const bad of [
      { planId: 'does-not-exist' },
      { owner: { email: 'not-an-email', firstName: 'A', lastName: 'B' } },
      { gradingPresetKey: 'NO_SUCH_PRESET' },
      { name: 'X' },
    ]) {
      const result = await provision(bad as Parameters<typeof provision>[0]);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
    }
    expect(await raw.school.count()).toBe(before);
  });
});

describe('opening a school', () => {
  it('opens a trialing school to TRIAL, not to ACTIVE', async () => {
    // The two must agree, or the list shows a school as active while its
    // subscription says trial and nobody can tell which is true.
    const result = await provision({
      name: `Open Trial ${STAMP}`,
      owner: { email: `open-${STAMP}@platformtest.example`, firstName: 'Op', lastName: 'Test' },
    });
    await activateSchool({ schoolId: result.schoolId!, actorUserId: null });
    const school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('TRIAL');
    expect(schoolAllowsSignIn(school!.status, 'STUDENT')).toBe(true);
  });

  it('opens a school on a no-trial plan straight to ACTIVE', async () => {
    const result = await provision({
      name: `Open Active ${STAMP}`,
      planId: unlimitedPlanId,
      owner: { email: `act-${STAMP}@platformtest.example`, firstName: 'Ac', lastName: 'Test' },
    });
    await activateSchool({ schoolId: result.schoolId!, actorUserId: null });
    const school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('ACTIVE');
  });
});

describe('seats', () => {
  it('counts the owner as staff and nobody as a student', async () => {
    const result = await provision({
      name: `Seats ${STAMP}`,
      owner: { email: `seat-${STAMP}@platformtest.example`, firstName: 'Se', lastName: 'Test' },
    });
    expect(await countSeats(result.schoolId!)).toEqual({ students: 0, staff: 1 });
  });

  it('does not count applicants or guardians as seats', async () => {
    // A school is not billed for people applying to it, nor for parents
    // reading a report card.
    const result = await provision({
      name: `Not Seats ${STAMP}`,
      owner: { email: `ns-${STAMP}@platformtest.example`, firstName: 'Ns', lastName: 'Test' },
    });
    const user = await raw.user.create({
      data: {
        email: `applicant-${STAMP}@platformtest.example`,
        passwordHash: 'x',
        firstName: 'Ap',
        lastName: 'Test',
      },
    });
    await raw.membership.create({
      data: { userId: user.id, schoolId: result.schoolId!, role: 'APPLICANT', status: 'ACTIVE' },
    });
    expect(await countSeats(result.schoolId!)).toEqual({ students: 0, staff: 1 });
  });

  it('refuses a seat at the limit and says which limit', async () => {
    const result = await provision({
      name: `Limit ${STAMP}`,
      owner: { email: `lim-${STAMP}@platformtest.example`, firstName: 'Li', lastName: 'Test' },
    });
    // The plan sells 2 staff; the owner holds one, so one more is allowed.
    expect((await assertSeatAvailable(result.schoolId!, 'staff')).allowed).toBe(true);

    const user = await raw.user.create({
      data: {
        email: `staff2-${STAMP}@platformtest.example`,
        passwordHash: 'x',
        firstName: 'St',
        lastName: 'Test',
      },
    });
    await raw.membership.create({
      data: { userId: user.id, schoolId: result.schoolId!, role: 'REGISTRAR', status: 'ACTIVE' },
    });

    const verdict = await assertSeatAvailable(result.schoolId!, 'staff');
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toMatch(/2 staff places/);
  });

  it('lets a per-school override beat the plan', async () => {
    const result = await provision({
      name: `Override ${STAMP}`,
      owner: { email: `ovr-${STAMP}@platformtest.example`, firstName: 'Ov', lastName: 'Test' },
    });
    await raw.subscription.update({
      where: { schoolId: result.schoolId! },
      data: { seatOverrideStaff: 50 },
    });
    const entitlement = await loadEntitlement(result.schoolId!);
    expect(entitlement!.limits.maxStaff).toBe(50);
    // …and does not raise the ceiling for everybody else.
    expect((await raw.plan.findUnique({ where: { id: planId } }))!.maxStaff).toBe(2);
  });

  it('allows a school with no subscription rather than blocking it', async () => {
    // The seeded demo schools predate billing. Refusing to let an existing
    // customer add a pupil because a row is missing is the platform's fault
    // charged to the school.
    const orphan = await raw.school.create({
      data: {
        slug: `orphan-${STAMP}`,
        code: `OR${STAMP % 10000}`,
        name: 'No Subscription',
        shortName: 'None',
      },
    });
    createdSchools.push(orphan.id);
    expect(await loadEntitlement(orphan.id)).toBeNull();
    expect((await assertSeatAvailable(orphan.id, 'student')).allowed).toBe(true);
  });
});

describe('subscription status', () => {
  it('suspends the school on cancellation and reinstates it on reactivation', async () => {
    const result = await provision({
      name: `Cancel ${STAMP}`,
      owner: { email: `can-${STAMP}@platformtest.example`, firstName: 'Ca', lastName: 'Test' },
    });

    await setSubscriptionStatus({
      schoolId: result.schoolId!,
      status: 'CANCELLED',
      actorUserId: null,
    });
    let school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('SUSPENDED');
    expect(schoolAllowsSignIn(school!.status, 'OWNER')).toBe(false);

    await setSubscriptionStatus({ schoolId: result.schoolId!, status: 'ACTIVE', actorUserId: null });
    school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('ACTIVE');
  });

  it('does NOT lock a school out for being past due', async () => {
    // Locking a school out of its own records over an unpaid invoice is how a
    // vendor loses a customer it had already won.
    const result = await provision({
      name: `Past Due ${STAMP}`,
      owner: { email: `due-${STAMP}@platformtest.example`, firstName: 'Du', lastName: 'Test' },
    });
    await setSubscriptionStatus({
      schoolId: result.schoolId!,
      status: 'PAST_DUE',
      actorUserId: null,
    });
    const school = await raw.school.findUnique({ where: { id: result.schoolId! } });
    expect(school!.status).toBe('ACTIVE');
    expect(schoolAllowsSignIn(school!.status, 'STUDENT')).toBe(true);
  });
});

describe('subscription invoices', () => {
  let schoolId = '';

  beforeAll(async () => {
    const result = await provision({
      name: `Billing ${STAMP}`,
      owner: { email: `bill-${STAMP}@platformtest.example`, firstName: 'Bi', lastName: 'Test' },
    });
    schoolId = result.schoolId!;
  });

  it('numbers an invoice with the school code and the period year', async () => {
    const result = await raiseSubscriptionInvoice({
      schoolId,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2027-01-01'),
      actorUserId: null,
    });
    expect(result.ok, result.message).toBe(true);
    const invoice = await raw.subscriptionInvoice.findUnique({ where: { id: result.invoiceId! } });
    expect(invoice!.reference).toMatch(/^SUB-[A-Z0-9]+-2026-000001$/);
  });

  it('copies the price onto the line rather than referencing the plan', async () => {
    // An invoice is a historical document. If the plan's price changes next
    // year, last year's invoice must still say what was actually charged.
    const result = await raiseSubscriptionInvoice({
      schoolId,
      periodStart: new Date('2027-01-01'),
      periodEnd: new Date('2028-01-01'),
      actorUserId: null,
    });
    const lines = await raw.subscriptionInvoiceLine.findMany({
      where: { invoiceId: result.invoiceId! },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].amountMinor).toBe(100_00);

    await raw.plan.update({ where: { id: planId }, data: { priceMinor: 999_00 } });
    const after = await raw.subscriptionInvoiceLine.findMany({
      where: { invoiceId: result.invoiceId! },
    });
    expect(after[0].amountMinor).toBe(100_00);
    await raw.plan.update({ where: { id: planId }, data: { priceMinor: 100_00 } });
  });

  it('ends the trial when the first invoice is raised', async () => {
    const subscription = await raw.subscription.findUnique({ where: { schoolId } });
    expect(subscription!.status).toBe('ACTIVE');
    const school = await raw.school.findUnique({ where: { id: schoolId } });
    expect(school!.status).toBe('ACTIVE');
  });

  it('refuses a period that ends before it starts', async () => {
    const result = await raiseSubscriptionInvoice({
      schoolId,
      periodStart: new Date('2028-06-01'),
      periodEnd: new Date('2028-01-01'),
      actorUserId: null,
    });
    expect(result.ok).toBe(false);
  });

  it('keeps a part payment a part payment', async () => {
    const raised = await raiseSubscriptionInvoice({
      schoolId,
      periodStart: new Date('2029-01-01'),
      periodEnd: new Date('2030-01-01'),
      actorUserId: null,
    });

    // Neither rounded up to PAID nor discarded as nothing.
    const part = await recordSubscriptionPayment({
      invoiceId: raised.invoiceId!,
      amountMajor: 40,
      method: 'BANK_TRANSFER',
      actorUserId: null,
    });
    expect(part.ok).toBe(true);
    let invoice = await raw.subscriptionInvoice.findUnique({ where: { id: raised.invoiceId! } });
    expect(invoice!.status).toBe('PARTIALLY_PAID');
    expect(invoice!.paidMinor).toBe(40_00);
    expect(invoice!.paidAt).toBeNull();

    const rest = await recordSubscriptionPayment({
      invoiceId: raised.invoiceId!,
      amountMajor: 60,
      method: 'BANK_TRANSFER',
      actorUserId: null,
    });
    expect(rest.ok).toBe(true);
    invoice = await raw.subscriptionInvoice.findUnique({ where: { id: raised.invoiceId! } });
    expect(invoice!.status).toBe('PAID');
    expect(invoice!.paidMinor).toBe(100_00);
    expect(invoice!.paidAt).not.toBeNull();
  });

  it('refuses a zero or negative payment', async () => {
    const invoice = await raw.subscriptionInvoice.findFirst({ where: { schoolId } });
    for (const amount of [0, -5]) {
      const result = await recordSubscriptionPayment({
        invoiceId: invoice!.id,
        amountMajor: amount,
        method: 'CASH',
        actorUserId: null,
      });
      expect(result.ok, String(amount)).toBe(false);
    }
  });
});

describe('platform operators', () => {
  it('refuses to revoke the last operator', async () => {
    // There would be no way back in short of a database console.
    const operators = await raw.platformAdmin.findMany();
    if (operators.length !== 1) {
      // The seeded database has exactly one; if that changes, this test's
      // premise is gone and saying so beats asserting something else.
      expect(operators.length).toBeGreaterThan(0);
      return;
    }
    const result = await setPlatformAdmin({
      userId: operators[0].userId,
      grant: false,
      actorUserId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/only platform operator/i);
    expect(await raw.platformAdmin.count()).toBe(1);
  });

  it('grants and revokes once there is more than one', async () => {
    const user = await raw.user.create({
      data: {
        email: `op-${STAMP}@platformtest.example`,
        passwordHash: 'x',
        firstName: 'Op',
        lastName: 'Test',
      },
    });

    const granted = await setPlatformAdmin({ userId: user.id, grant: true, actorUserId: null });
    expect(granted.ok).toBe(true);
    expect(await raw.platformAdmin.findUnique({ where: { userId: user.id } })).not.toBeNull();

    const revoked = await setPlatformAdmin({ userId: user.id, grant: false, actorUserId: null });
    expect(revoked.ok).toBe(true);
    expect(await raw.platformAdmin.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it('refuses an account that does not exist', async () => {
    const result = await setPlatformAdmin({
      userId: 'no-such-user',
      grant: true,
      actorUserId: null,
    });
    expect(result.ok).toBe(false);
  });
});
