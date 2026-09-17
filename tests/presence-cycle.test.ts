import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  endBreak,
  presenceIdentity,
  signIn,
  signOut,
  startBreak,
  sweepForgottenSessions,
  timesheet,
} from '@/server/services/presence.service';

/**
 * =============================================================================
 * A WHOLE DAY ON THE REGISTER
 * =============================================================================
 *
 * Sign in, take lunch, come back, sign out — against the real database, because
 * the parts most likely to be wrong are the ones the pure tests cannot reach:
 * the two unique keys that enforce "one open session" and "one open break", the
 * transaction that closes a break with its session, and the materialised totals
 * that a payroll run will read back.
 *
 * Integration by necessity, in the same style as `tenant.test.ts`: the
 * behaviour under test is partly Prisma's, and mocking Prisma would test the
 * mock. It builds its own school and deletes it afterwards.
 */

const raw = new PrismaClient();
const SUFFIX = `presence-${Date.now()}`;

let schoolId = '';
let membershipId = '';
let userId = '';

const MATRIC = 'GEU/CSC/2024/777';
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 2026-09-16, in whole hours, so the arithmetic in the assertions is readable. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 16, hour, minute, 0, 0));

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `p-${SUFFIX}`,
      code: `P${Date.now() % 100000}`,
      name: 'Presence Test University',
      shortName: 'PTU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;

  const user = await raw.user.create({
    data: {
      email: `lecturer-${SUFFIX}@example.test`,
      firstName: 'Adaeze',
      lastName: 'Okafor',
      username: `a.okafor.${Date.now()}`,
      // Never used: this fixture drives the service directly and never signs in
      // through the login form, so there is no password to be right or wrong.
      passwordHash: 'fixture-account-that-never-authenticates',
    },
  });
  userId = user.id;

  const membership = await raw.membership.create({
    data: { userId: user.id, schoolId, role: 'STUDENT', status: 'ACTIVE' },
  });
  membershipId = membership.id;

  const faculty = await raw.faculty.create({
    data: { schoolId, code: 'SCI', name: 'Sciences' },
  });
  const department = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'CSC', name: 'Computer Science' },
  });
  const program = await raw.program.create({
    data: {
      schoolId,
      departmentId: department.id,
      code: 'BSC-CSC',
      name: 'BSc Computer Science',
      degreeType: 'BSC',
      durationTerms: 8,
    },
  });
  await raw.student.create({
    data: {
      schoolId,
      userId: user.id,
      matricNumber: MATRIC,
      programId: program.id,
      level: 100,
    },
  });
});

afterAll(async () => {
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({ where: { id: userId } });
  await raw.$disconnect();
});

describe('who the register thinks this person is', () => {
  it('finds the matriculation number and the department', async () => {
    const identity = await presenceIdentity(schoolId, membershipId);
    expect(identity.identifier).toBe(MATRIC);
    expect(identity.identifierLabel).toBe('Matriculation number');
    expect(identity.unit).toBe('Computer Science');
  });
});

describe('a whole day', () => {
  it('refuses a sign-in whose number does not match the account', async () => {
    const result = await signIn({
      schoolId,
      membershipId,
      now: at(8),
      identifierGiven: 'GEU/CSC/2024/000',
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/does not match/);

    // And it must not have written a row it then refused.
    expect(await raw.presenceSession.count({ where: { membershipId } })).toBe(0);
  });

  it('signs in with a declared arrival, and records that it was declared', async () => {
    const result = await signIn({
      schoolId,
      membershipId,
      // Arrived at 07:50, reached the terminal at 08:10.
      now: at(8, 10),
      declaredAt: at(7, 50),
      identifierGiven: 'geu-csc-2024-777', // punctuation the registry does not use
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);

    const row = await raw.presenceSession.findFirstOrThrow({ where: { membershipId } });
    expect(row.startedAt).toEqual(at(7, 50));
    expect(row.startDeclared).toBe(true);
    expect(row.identifierGiven).toBe('geu-csc-2024-777');
    expect(row.unitGiven).toBe('Computer Science');
    expect(row.signature).toBe(SIGNATURE);
    expect(row.localDate).toBe('2026-09-16');
  });

  it('REFUSES a second sign-in at the database, not merely in the code', async () => {
    // The unique index on openKey is the real enforcement. If this ever starts
    // passing, two open sessions can exist and every total is wrong.
    const result = await signIn({
      schoolId,
      membershipId,
      now: at(9),
      identifierGiven: MATRIC,
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already signed in/);
    expect(await raw.presenceSession.count({ where: { membershipId } })).toBe(1);
  });

  it('takes a lunch break', async () => {
    const result = await startBreak({
      schoolId,
      membershipId,
      kind: 'LUNCH',
      now: at(12),
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);

    const row = await raw.presenceBreak.findFirstOrThrow({ where: { schoolId } });
    expect(row.kind).toBe('LUNCH');
    // Unpaid, copied onto the row rather than read through policy later.
    expect(row.paid).toBe(false);
    expect(row.endedAt).toBeNull();
  });

  it('REFUSES a second open break at the database', async () => {
    const result = await startBreak({
      schoolId,
      membershipId,
      kind: 'SHORT',
      now: at(12, 10),
      actorUserId: userId,
    });
    expect(result.ok).toBe(false);
    expect(await raw.presenceBreak.count({ where: { schoolId } })).toBe(1);
  });

  it('comes back from lunch', async () => {
    const result = await endBreak({ schoolId, membershipId, now: at(12, 45), actorUserId: userId });
    expect(result.ok).toBe(true);
    expect(result.minutes).toBe(45);

    const row = await raw.presenceBreak.findFirstOrThrow({ where: { schoolId } });
    expect(row.minutes).toBe(45);
    // Releasing the key is what allows the next break.
    expect(row.openKey).toBeNull();
  });

  it('takes a short paid break in the afternoon', async () => {
    const started = await startBreak({
      schoolId,
      membershipId,
      kind: 'SHORT',
      now: at(15),
      actorUserId: userId,
    });
    expect(started.ok).toBe(true);

    const ended = await endBreak({ schoolId, membershipId, now: at(15, 15), actorUserId: userId });
    expect(ended.ok).toBe(true);

    const row = await raw.presenceBreak.findFirstOrThrow({ where: { schoolId, kind: 'SHORT' } });
    expect(row.paid).toBe(true);
    expect(row.minutes).toBe(15);
  });

  it('signs out, deducting only the unpaid break', async () => {
    const result = await signOut({
      schoolId,
      membershipId,
      now: at(16, 50),
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);

    const row = await raw.presenceSession.findFirstOrThrow({ where: { membershipId } });
    // 07:50 to 16:50 is nine hours on site.
    expect(row.durationMinutes).toBe(540);
    // Lunch deducted, the short break not.
    expect(row.breakMinutes).toBe(45);
    expect(row.netMinutes).toBe(495);
    expect(row.status).toBe('CLOSED');
    expect(row.endSignature).toBe(SIGNATURE);
    expect(row.openKey).toBeNull();
  });

  it('totals the day the way a payroll run would read it', async () => {
    const { totals } = await timesheet({
      schoolId,
      membershipId,
      from: '2026-09-16',
      to: '2026-09-16',
    });
    expect(totals.days).toBe(1);
    expect(totals.minutes).toBe(540);
    expect(totals.breakMinutes).toBe(45);
    expect(totals.netMinutes).toBe(495);
    expect(totals.openSessions).toBe(0);
  });

  it('lets the person sign in again once the first session is closed', async () => {
    const result = await signIn({
      schoolId,
      membershipId,
      now: at(18),
      identifierGiven: MATRIC,
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);
    expect(await raw.presenceSession.count({ where: { membershipId } })).toBe(2);
  });
});

describe('the breaks nobody closed', () => {
  it('closes a running break WITH the session rather than refusing the sign-out', async () => {
    /*
     * Somebody goes to lunch and then leaves for the day without tapping "end
     * break". Refusing their sign-out would strand them signed in until the
     * nightly sweep invented a departure time for them.
     */
    await startBreak({
      schoolId,
      membershipId,
      kind: 'LUNCH',
      now: at(19),
      actorUserId: userId,
    });

    const result = await signOut({
      schoolId,
      membershipId,
      now: at(19, 30),
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(result.ok).toBe(true);

    const session = await raw.presenceSession.findFirstOrThrow({
      where: { membershipId },
      orderBy: { startedAt: 'desc' },
      include: { breaks: true },
    });
    const abandoned = session.breaks.find((b) => b.kind === 'LUNCH')!;
    expect(abandoned.endedAt).toEqual(at(19, 30));
    expect(abandoned.minutes).toBe(30);
    // The key has to be released, or this person can never take another break.
    expect(abandoned.openKey).toBeNull();
    // 18:00 to 19:30 is 90 minutes, 30 of it at an unpaid lunch.
    expect(session.durationMinutes).toBe(90);
    expect(session.netMinutes).toBe(60);
  });

  it('caps a forgotten session and closes the break inside it', async () => {
    await signIn({
      schoolId,
      membershipId,
      now: at(20),
      identifierGiven: MATRIC,
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    await startBreak({
      schoolId,
      membershipId,
      kind: 'LUNCH',
      now: at(21),
      actorUserId: userId,
    });

    // Two days later, with nobody having signed out.
    const { closed } = await sweepForgottenSessions(
      schoolId,
      new Date(Date.UTC(2026, 8, 18, 6, 0, 0)),
    );
    expect(closed).toBe(1);

    const session = await raw.presenceSession.findFirstOrThrow({
      where: { membershipId },
      orderBy: { startedAt: 'desc' },
      include: { breaks: true },
    });
    // Capped at sixteen hours from the start, not dated at the sweep.
    expect(session.status).toBe('AUTO_CLOSED');
    expect(session.durationMinutes).toBe(16 * 60);
    expect(session.breaks.every((b) => b.openKey === null)).toBe(true);
    expect(session.breaks.every((b) => b.endedAt !== null)).toBe(true);

    // And the person can sign in again afterwards, which is the point of
    // releasing both keys.
    const again = await signIn({
      schoolId,
      membershipId,
      now: new Date(Date.UTC(2026, 8, 18, 7, 0, 0)),
      identifierGiven: MATRIC,
      unitGiven: 'Computer Science',
      signature: SIGNATURE,
      requireSignature: true,
      actorUserId: userId,
    });
    expect(again.ok).toBe(true);
  });
});
