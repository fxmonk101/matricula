import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { __setMailer } from '@/server/email';
import { runCohortAllocation } from '@/server/services/admissions.service';
import {
  announceHoldPlaced,
  announceHoldReleased,
  issueTermInvoice,
  recordPayment,
} from '@/server/services/finance.service';
import { announceRegistrationOpening } from '@/server/services/term.service';

/**
 * =============================================================================
 * THE NOTIFICATIONS THE POLICY PROMISED, AGAINST A REAL DATABASE
 * =============================================================================
 *
 * The wording is tested in `decision-notices.test.ts`. This file checks the
 * parts that matter more: that the messages go to the RIGHT people, only after
 * the decision is committed, and only when something actually changed. A
 * re-run that re-notifies everybody is how a school's applicants learn to
 * ignore the one message that matters.
 *
 * Everything lives in its own throwaway programme so the demo school's seeded
 * applications are never touched.
 */

const raw = new PrismaClient();
const SUFFIX = `notify-${Date.now()}`;

let schoolId = '';
let schoolCode = '';
let termId = '';
let programId = '';
let actorId = '';
const userIds: string[] = [];
const membershipOf = new Map<string, string>();
let studentId = '';
let futureTermId = '';

async function person(name: string, role: string): Promise<string> {
  const user = await raw.user.create({
    data: {
      username: `${name}.${SUFFIX}`,
      firstName: name,
      lastName: 'Test',
      passwordHash: 'not-a-real-hash',
    },
  });
  const membership = await raw.membership.create({
    data: { userId: user.id, schoolId, role, status: 'ACTIVE' },
  });
  userIds.push(user.id);
  membershipOf.set(name, membership.id);
  return user.id;
}

async function applicantWith(name: string, score: number): Promise<void> {
  const userId = await person(name, 'APPLICANT');
  const applicant = await raw.applicant.create({ data: { schoolId, userId } });
  await raw.application.create({
    data: {
      schoolId,
      referenceNo: `APP-${SUFFIX}-${name}`,
      applicantId: applicant.id,
      programId,
      termId,
      // Reviewed already: a review is what moves SUBMITTED on, and a cohort run
      // cannot offer a place straight from SUBMITTED.
      status: 'UNDER_REVIEW',
      submittedAt: new Date(),
      priorGpaScore: score,
      entranceExamScore: score,
      essayScore: score,
      interviewScore: score,
      extracurricularScore: score,
    },
  });
}

async function bellFor(name: string, kind: string) {
  return raw.notification.findMany({
    where: { membershipId: membershipOf.get(name)!, kind },
    orderBy: { createdAt: 'asc' },
  });
}

/** `notify` is fire-and-forget, so its row lands a moment after the call. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

beforeAll(async () => {
  // Keep any configured email provider out of a test run.
  __setMailer({ name: 'test', send: async () => ({ ok: true, via: 'test' }) });

  const school = await raw.school.findUniqueOrThrow({ where: { slug: 'golden-eagles' } });
  schoolId = school.id;
  schoolCode = school.code;
  termId = (await raw.term.findFirstOrThrow({ where: { schoolId }, orderBy: { startDate: 'desc' } })).id;
  const department = await raw.department.findFirstOrThrow({ where: { schoolId } });
  programId = (
    await raw.program.create({
      data: {
        schoolId,
        code: SUFFIX.toUpperCase(),
        name: 'Notification Studies',
        degreeType: 'BSC',
        departmentId: department.id,
      },
    })
  ).id;
  actorId = (await raw.membership.findFirstOrThrow({ where: { schoolId, role: { in: ['OWNER', 'ADMIN', 'BURSAR', 'REGISTRAR'] } } })).userId;

  await applicantWith('ada', 90);
  await applicantWith('bayo', 70);
  await applicantWith('chuka', 20);
}, 30_000);

afterAll(async () => {
  __setMailer(null);
  const memberships = [...membershipOf.values()];
  await raw.notification.deleteMany({ where: { membershipId: { in: memberships } } });
  if (futureTermId) {
    await raw.notification.deleteMany({ where: { subjectType: 'Term', subjectId: futureTermId } });
    await raw.term.delete({ where: { id: futureTermId } });
  }
  if (studentId) {
    await raw.hold.deleteMany({ where: { studentId } });
    const payments = await raw.payment.findMany({ where: { studentId }, select: { id: true } });
    await raw.paymentAllocation.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await raw.payment.deleteMany({ where: { studentId } });
    const invoices = await raw.invoice.findMany({ where: { studentId }, select: { id: true } });
    await raw.invoiceLine.deleteMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
    await raw.invoice.deleteMany({ where: { studentId } });
    await raw.student.deleteMany({ where: { id: studentId } });
  }
  await raw.feeItem.deleteMany({ where: { feeStructure: { programId } } });
  await raw.feeStructure.deleteMany({ where: { programId } });
  await raw.application.deleteMany({ where: { programId } });
  await raw.applicant.deleteMany({ where: { userId: { in: userIds } } });
  await raw.membership.deleteMany({ where: { id: { in: memberships } } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.program.deleteMany({ where: { id: programId } });
  await raw.$disconnect();
}, 30_000);

const POLICY = {
  capacity: 1,
  waitlistCapacity: 1,
  minimumComposite: 50,
  minimumCoverage: 0,
  requiredReviews: 0,
};

describe('an admissions decision', () => {
  it('tells nobody anything on a dry run', async () => {
    await runCohortAllocation({ schoolId, programId, termId, policy: POLICY, actorId, dryRun: true });
    await settle();
    for (const name of ['ada', 'bayo', 'chuka']) {
      expect(await bellFor(name, 'APPLICATION_DECIDED')).toHaveLength(0);
    }
  });

  it('tells each applicant their own outcome once it is committed', async () => {
    const summary = await runCohortAllocation({
      schoolId, programId, termId, policy: POLICY, actorId, dryRun: false,
    });
    expect(summary).toMatchObject({ offered: 1, waitlisted: 1, rejected: 1 });
    await settle();

    const [ada] = await bellFor('ada', 'APPLICATION_DECIDED');
    const [bayo] = await bellFor('bayo', 'APPLICATION_DECIDED');
    const [chuka] = await bellFor('chuka', 'APPLICATION_DECIDED');

    expect(ada.title).toContain('offered a place on Notification Studies');
    expect(ada.body).toMatch(/before \d{2} \w{3} \d{4}/);
    expect(ada.href).toBe('/portal');
    expect(bayo.title).toContain('waiting list');
    expect(chuka.body).toMatch(/unable to offer you a place/);
  });

  it('does not offer the same place twice when re-run with the intake size', async () => {
    /*
     * The committee types the intake's size — 1 — again. Ada's live offer
     * holds that place, so there is nothing left to fill and Bayo stays on
     * the waiting list. This run used to offer Bayo the place as well.
     */
    const summary = await runCohortAllocation({
      schoolId, programId, termId, policy: POLICY, actorId, dryRun: false,
    });
    expect(summary).toMatchObject({ placesHeld: 1, placesLeft: 0, offered: 0, waitlisted: 1 });
    await settle();
    expect(await bellFor('ada', 'APPLICATION_DECIDED')).toHaveLength(1);
    expect(await bellFor('bayo', 'APPLICATION_DECIDED')).toHaveLength(1);
    expect(await bellFor('chuka', 'APPLICATION_DECIDED')).toHaveLength(1);
  });

  it('tells a waitlisted applicant when the intake grows and they move up', async () => {
    const summary = await runCohortAllocation({
      schoolId, programId, termId, policy: { ...POLICY, capacity: 2 }, actorId, dryRun: false,
    });
    expect(summary).toMatchObject({ placesHeld: 1, placesLeft: 1, offered: 1 });
    await settle();
    const bayo = await bellFor('bayo', 'APPLICATION_DECIDED');
    expect(bayo).toHaveLength(2);
    expect(bayo[1].title).toContain('offered a place');
  });

  it('frees the place of an offer that has lapsed, before the nightly job has noticed', async () => {
    // Both offers lapse yesterday; neither has been swept to EXPIRED.
    await raw.application.updateMany({
      where: { programId, status: 'OFFERED' },
      data: { offerExpiresAt: new Date(Date.now() - 86_400_000) },
    });
    const preview = await runCohortAllocation({
      schoolId, programId, termId, policy: { ...POLICY, capacity: 2 }, actorId, dryRun: true,
    });
    expect(preview).toMatchObject({ placesHeld: 0, placesLeft: 2 });
  });

  it('offers a place to a new application when no review is required, instead of wasting it', async () => {
    // A fresh SUBMITTED application may not jump straight to OFFERED; it now
    // walks through UNDER_REVIEW. It used to take a ranking place and then be
    // refused, so the place went to nobody while the summary claimed an offer.
    const userId = await person('dayo', 'APPLICANT');
    const applicant = await raw.applicant.create({ data: { schoolId, userId } });
    await raw.application.create({
      data: {
        schoolId, referenceNo: `APP-${SUFFIX}-dayo`, applicantId: applicant.id, programId, termId,
        status: 'SUBMITTED', submittedAt: new Date(),
        priorGpaScore: 95, entranceExamScore: 95, essayScore: 95, interviewScore: 95, extracurricularScore: 95,
      },
    });

    const summary = await runCohortAllocation({
      schoolId, programId, termId, policy: { ...POLICY, capacity: 3 }, actorId, dryRun: false,
    });
    expect(summary.offered).toBe(1);
    const dayo = await raw.application.findFirstOrThrow({ where: { referenceNo: `APP-${SUFFIX}-dayo` } });
    expect(dayo.status).toBe('OFFERED');
  });
});

describe('a fee invoice', () => {
  beforeAll(async () => {
    const userId = await person('dele', 'STUDENT');
    studentId = (
      await raw.student.create({
        data: { schoolId, userId, matricNumber: `MAT-${SUFFIX}`, programId, level: 100 },
      })
    ).id;
    await raw.feeStructure.create({
      data: {
        schoolId,
        name: `Fees ${SUFFIX}`,
        termId,
        programId,
        level: 100,
        items: {
          create: [{ schoolId, code: 'TUITION', description: 'Tuition', amountMinor: 250_000_00 }],
        },
      },
    });
  }, 30_000);

  it('tells the student what they owe and by when', async () => {
    const result = await issueTermInvoice({ schoolId, schoolCode, studentId, termId, actorId });
    expect(result.ok).toBe(true);
    await settle();

    const [bell] = await bellFor('dele', 'INVOICE_ISSUED');
    expect(bell.title).toMatch(/250,000/);
    expect(bell.body).toMatch(/due by \d{2} \w{3} \d{4}/);
    expect(bell.href).toBe('/me/finance');
  });

  it('stays silent when a reassessment leaves the bill where it was', async () => {
    const result = await issueTermInvoice({ schoolId, schoolCode, studentId, termId, actorId });
    expect(result.ok).toBe(true);
    await settle();
    expect(await bellFor('dele', 'INVOICE_ISSUED')).toHaveLength(1);
  });

  it('says so when a reassessment moves the bill', async () => {
    const result = await issueTermInvoice({
      schoolId, schoolCode, studentId, termId, actorId,
      discounts: [{ code: 'SCHOLARSHIP', description: 'Scholarship', percent: 10 }],
    });
    expect(result.ok).toBe(true);
    await settle();
    const bells = await bellFor('dele', 'INVOICE_ISSUED');
    expect(bells).toHaveLength(2);
    expect(bells[1].title).toMatch(/changed/);
    expect(bells[1].body).toMatch(/from .*250,000.* to .*225,000/);
  });

  it('tells nobody else', async () => {
    for (const name of ['ada', 'bayo', 'chuka']) {
      expect(await bellFor(name, 'INVOICE_ISSUED')).toHaveLength(0);
    }
  });
});


describe('a hold', () => {
  it('tells the student it is there, and where to go', async () => {
    for (const [kind, reason] of [['FINANCIAL', 'Fees unpaid'], ['ACADEMIC', 'Probation review']] as const) {
      const hold = await raw.hold.create({ data: { schoolId, studentId, kind, reason, placedBy: actorId } });
      await announceHoldPlaced(schoolId, hold);
    }
    await settle();
    const bells = await bellFor('dele', 'HOLD_PLACED');
    expect(bells).toHaveLength(2);
    expect(bells[0].body).toContain('Fees unpaid');
    expect(bells[1].body).not.toContain('Probation review');
    expect(bells[0].href).toBe('/me/registration');
  });

  it('is lifted by paying, and the student is told the truth about what remains', async () => {
    const invoice = await raw.invoice.findFirstOrThrow({ where: { studentId } });
    const paid = await recordPayment({
      schoolId, schoolCode, studentId, actorId,
      amountMinor: invoice.totalMinor - invoice.paidMinor,
      method: 'BANK_TRANSFER',
    });
    expect(paid.ok).toBe(true);
    await settle();

    const [bell] = await bellFor('dele', 'HOLD_RELEASED');
    expect(bell.body).toMatch(/settled/);
    // The academic hold still stands, so "you can register" would be a lie.
    expect(bell.body).toMatch(/still cannot register/);
  });

  it('says the way is clear once the last one goes', async () => {
    await raw.hold.updateMany({
      where: { studentId, kind: 'ACADEMIC', releasedAt: null },
      data: { releasedAt: new Date(), releasedBy: actorId },
    });
    await announceHoldReleased(schoolId, studentId, 'ACADEMIC');
    await settle();
    const bells = await bellFor('dele', 'HOLD_RELEASED');
    expect(bells).toHaveLength(2);
    expect(bells[1].body).toBe('Nothing is now stopping you registering.');
  });
});

describe('registration opening', () => {
  // Far in the future, so no seeded term falls inside the window under test.
  const NOW = new Date('2099-03-01T12:00:00Z');

  beforeAll(async () => {
    const hour = 3_600_000;
    futureTermId = (
      await raw.term.create({
        data: {
          schoolId,
          code: `T-${SUFFIX}`,
          name: 'Test Semester 2099',
          academicYear: '2098/2099',
          season: 'SECOND',
          startDate: new Date(NOW.getTime() + 20 * 24 * hour),
          endDate: new Date(NOW.getTime() + 120 * 24 * hour),
          registrationOpensAt: new Date(NOW.getTime() + 10 * hour),
          registrationClosesAt: new Date(NOW.getTime() + 14 * 24 * hour),
          addDropDeadline: new Date(NOW.getTime() + 30 * 24 * hour),
          withdrawalDeadline: new Date(NOW.getTime() + 60 * 24 * hour),
        },
      })
    ).id;
  });

  it("is announced the evening before, in the school's own time", async () => {
    const told = await announceRegistrationOpening(schoolId, NOW);
    expect(told).toBeGreaterThan(0);
    await settle();
    const [bell] = await bellFor('dele', 'REGISTRATION_OPEN');
    // Opens 22:00 UTC, which is 23:00 in Lagos.
    expect(bell.title).toMatch(/^Registration for Test Semester 2099 opens .*23:00$/);
  });

  it('is announced once, however many nights it runs', async () => {
    expect(await announceRegistrationOpening(schoolId, new Date(NOW.getTime() + 24 * 3_600_000))).toBe(0);
    await settle();
    expect(await bellFor('dele', 'REGISTRATION_OPEN')).toHaveLength(1);
  });

  it('does not tell a student who has left', async () => {
    const leaver = await person('efe', 'STUDENT');
    const leaverStudent = await raw.student.create({
      data: { schoolId, userId: leaver, matricNumber: `MAT-${SUFFIX}-efe`, programId, status: 'GRADUATED' },
    });
    await raw.notification.deleteMany({ where: { subjectType: 'Term', subjectId: futureTermId } });
    await announceRegistrationOpening(schoolId, NOW);
    await settle();
    expect(await bellFor('efe', 'REGISTRATION_OPEN')).toHaveLength(0);
    expect(await bellFor('dele', 'REGISTRATION_OPEN')).toHaveLength(1);
    await raw.student.delete({ where: { id: leaverStudent.id } });
  });
});
