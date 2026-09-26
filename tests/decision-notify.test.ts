import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { __setMailer } from '@/server/email';
import { runCohortAllocation } from '@/server/services/admissions.service';
import { issueTermInvoice } from '@/server/services/finance.service';

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
  if (studentId) {
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

  it('does not tell anybody again when a re-run changes nothing for them', async () => {
    // A run's capacity is the seats still to fill. With none, Bayo stays on
    // the waiting list; Ada and Chuka have left the pool.
    await runCohortAllocation({
      schoolId, programId, termId, policy: { ...POLICY, capacity: 0 }, actorId, dryRun: false,
    });
    await settle();
    expect(await bellFor('ada', 'APPLICATION_DECIDED')).toHaveLength(1);
    expect(await bellFor('bayo', 'APPLICATION_DECIDED')).toHaveLength(1);
    expect(await bellFor('chuka', 'APPLICATION_DECIDED')).toHaveLength(1);
  });

  it('tells a waitlisted applicant when they are moved up to an offer', async () => {
    await runCohortAllocation({
      schoolId, programId, termId, policy: { ...POLICY, capacity: 1 }, actorId, dryRun: false,
    });
    await settle();
    const bayo = await bellFor('bayo', 'APPLICATION_DECIDED');
    expect(bayo).toHaveLength(2);
    expect(bayo[1].title).toContain('offered a place');
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

