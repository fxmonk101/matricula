import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { planImport, runImport } from '@/server/services/import.service';
import { verifyPassword } from '@/lib/auth/password';

/**
 * =============================================================================
 * IMPORTING AGAINST THE REAL DATABASE
 * =============================================================================
 *
 * The domain tests prove the PLAN is right. These prove what is actually in the
 * database afterwards — which is where the expensive failures live:
 *
 *   · a re-run that creates everybody a second time
 *   · a bad row at position 3 that discards the two good ones before it
 *   · a row importing somebody into another school
 *   · passwords reported for accounts that were never made
 */

const raw = new PrismaClient();
const SUFFIX = `imp-${Date.now()}`;

let schoolId = '';
let schoolCode = '';
let actorUserId = '';
let actorMembershipId = '';
const createdUserIds: string[] = [];

beforeAll(async () => {
  const school = await raw.school.create({
    data: {
      slug: `imp-${SUFFIX}`,
      code: `I${Date.now() % 100000}`,
      name: 'Import Test University',
      shortName: 'ITU',
      timezone: 'UTC',
    },
  });
  schoolId = school.id;
  schoolCode = school.code;

  const faculty = await raw.faculty.create({ data: { schoolId, code: 'SCI', name: 'Sciences' } });
  const department = await raw.department.create({
    data: { schoolId, facultyId: faculty.id, code: 'CSC', name: 'Computer Science' },
  });
  await raw.program.create({
    data: {
      schoolId,
      departmentId: department.id,
      code: 'BSC-CSC',
      name: 'BSc Computer Science',
      degreeType: 'BSC',
      durationTerms: 8,
    },
  });
  await raw.orgUnit.create({ data: { schoolId, code: 'CSC-U', name: 'Computer Science Unit', kind: 'DEPARTMENT' } });

  const owner = await raw.user.create({
    data: {
      email: `owner-${SUFFIX}@example.test`,
      firstName: 'Owner',
      lastName: 'Test',
      passwordHash: 'fixture-account-that-never-authenticates',
    },
  });
  actorUserId = owner.id;
  createdUserIds.push(owner.id);
  actorMembershipId = (
    await raw.membership.create({
      data: { schoolId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    })
  ).id;
});

afterAll(async () => {
  const members = await raw.membership.findMany({ where: { schoolId }, select: { userId: true } });
  await raw.school.deleteMany({ where: { id: schoolId } });
  await raw.user.deleteMany({
    where: { id: { in: [...new Set([...members.map((m) => m.userId), ...createdUserIds])] } },
  });
  await raw.$disconnect();
});

const actor = () => ({
  schoolId,
  schoolCode,
  actorRole: 'OWNER' as const,
  actorMembershipId,
  actorUserId,
});

const STUDENT_HEADER = 'First Name,Surname,Email,Matric No,Programme,Level\n';

describe('planning writes nothing', () => {
  it('reads the file and leaves the database alone', async () => {
    const before = await raw.membership.count({ where: { schoolId } });

    const planned = await planImport({
      schoolId,
      kind: 'STUDENT',
      text: STUDENT_HEADER + `Ada,Okafor,ada-${SUFFIX}@x.test,,BSC-CSC,100\n`,
      actorRole: 'OWNER',
    });

    expect(planned.ok).toBe(true);
    expect(planned.plan!.counts.create).toBe(1);
    expect(await raw.membership.count({ where: { schoolId } })).toBe(before);
  });

  it('reports an unreadable file as a problem with the file, not a crash', async () => {
    const planned = await planImport({ schoolId, kind: 'STUDENT', text: '', actorRole: 'OWNER' });
    expect(planned.ok).toBe(false);
    expect(planned.message).toMatch(/no rows/i);
  });
});

describe('running a student import', () => {
  it('creates the accounts and hands back a password for each', async () => {
    const result = await runImport({
      ...actor(),
      kind: 'STUDENT',
      text:
        STUDENT_HEADER +
        `Ada,Okafor,ada-${SUFFIX}@x.test,,BSC-CSC,100\n` +
        `Chidi,Eze,chidi-${SUFFIX}@x.test,,BSC-CSC,200\n`,
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);

    // A password for every account made, and none for any that was not.
    expect(result.credentials).toHaveLength(2);
    expect(result.credentials.every((c) => c.password.length > 0)).toBe(true);

    const students = await raw.student.count({ where: { schoolId } });
    expect(students).toBe(2);
  });

  it('is SAFE TO RE-RUN — the same file adds nobody', async () => {
    /*
     * The failure this prevents is the ordinary one: somebody is not sure the
     * import worked, so they do it again. Creating everybody twice, each with
     * a fresh one-time password, is not recoverable by hand.
     */
    const before = await raw.student.count({ where: { schoolId } });

    const result = await runImport({
      ...actor(),
      kind: 'STUDENT',
      text:
        STUDENT_HEADER +
        `Ada,Okafor,ada-${SUFFIX}@x.test,,BSC-CSC,100\n` +
        `Chidi,Eze,chidi-${SUFFIX}@x.test,,BSC-CSC,200\n`,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);
    expect(await raw.student.count({ where: { schoolId } })).toBe(before);
  });

  it('imports the good rows and reports the bad ones by LINE', async () => {
    /*
     * A registry with a few bad rows in two thousand must not have to fix the
     * file before importing the rest.
     */
    const result = await runImport({
      ...actor(),
      kind: 'STUDENT',
      text:
        STUDENT_HEADER +
        `Ngozi,Bello,ngozi-${SUFFIX}@x.test,,BSC-CSC,100\n` +
        `,Missing,nobody-${SUFFIX}@x.test,,BSC-CSC,100\n` +
        `Emeka,Obi,emeka-${SUFFIX}@x.test,,NOPE,100\n` +
        `Amina,Sule,amina-${SUFFIX}@x.test,,BSC-CSC,200\n`,
    });

    expect(result.created).toBe(2);
    expect(result.failed).toBe(2);

    // Line 3 is the nameless row, line 4 the bad programme — counting the header.
    expect(result.failures.map((f) => f.line).sort()).toEqual([3, 4]);
    expect(result.failures.find((f) => f.line === 4)!.problem).toMatch(/NOPE/);
  });

  it('never updates an existing person', async () => {
    // Same email, different name. The name in the database must not change.
    const before = await raw.user.findFirstOrThrow({
      where: { email: `ada-${SUFFIX}@x.test` },
    });

    await runImport({
      ...actor(),
      kind: 'STUDENT',
      text: STUDENT_HEADER + `CHANGED,NAME,ada-${SUFFIX}@x.test,,BSC-CSC,400\n`,
    });

    const after = await raw.user.findFirstOrThrow({ where: { email: `ada-${SUFFIX}@x.test` } });
    expect(after.firstName).toBe(before.firstName);
    expect(after.lastName).toBe(before.lastName);
  });
});

describe('running a staff import', () => {
  it('creates staff with their role and department', async () => {
    const result = await runImport({
      ...actor(),
      kind: 'STAFF',
      text:
        'First Name,Surname,Email,Role,Department\n' +
        `Obi,Nwosu,obi-${SUFFIX}@x.test,Lecturer,CSC-U\n` +
        `Grace,Umeh,grace-${SUFFIX}@x.test,Bursar,\n`,
    });

    expect(result.created).toBe(2);

    const lecturer = await raw.membership.findFirstOrThrow({
      where: { schoolId, user: { email: `obi-${SUFFIX}@x.test` } },
      include: { orgUnit: true },
    });
    expect(lecturer.role).toBe('INSTRUCTOR');
    expect(lecturer.orgUnit?.code).toBe('CSC-U');

    const bursar = await raw.membership.findFirstOrThrow({
      where: { schoolId, user: { email: `grace-${SUFFIX}@x.test` } },
    });
    expect(bursar.role).toBe('FINANCE');
  });

  it('refuses the whole row when the role cannot be handed out', async () => {
    const result = await runImport({
      ...actor(),
      kind: 'STAFF',
      // OWNER is never assignable, by anybody.
      text: 'First Name,Surname,Email,Role\n' + `Rogue,Owner,rogue-${SUFFIX}@x.test,OWNER\n`,
    });

    expect(result.created).toBe(0);
    expect(result.failed).toBe(1);
    expect(
      await raw.membership.count({ where: { schoolId, user: { email: `rogue-${SUFFIX}@x.test` } } }),
    ).toBe(0);
  });
});

describe('tenancy', () => {
  it('cannot import into a school using a programme code from elsewhere', async () => {
    const other = await raw.school.create({
      data: {
        slug: `imp-other-${SUFFIX}`,
        code: `J${Date.now() % 100000}`,
        name: 'Other University',
        shortName: 'OU',
        timezone: 'UTC',
      },
    });

    try {
      // BSC-CSC exists at the FIRST school. From the other school's context it
      // must not resolve — the programme list is read through the tenant client.
      const planned = await planImport({
        schoolId: other.id,
        kind: 'STUDENT',
        text: STUDENT_HEADER + `Ada,Okafor,x-${SUFFIX}@x.test,,BSC-CSC,100\n`,
        actorRole: 'OWNER',
      });

      expect(planned.plan!.counts.create).toBe(0);
      expect(planned.plan!.rows[0].problems.join(' ')).toMatch(/No programme with the code/);
    } finally {
      await raw.school.deleteMany({ where: { id: other.id } });
    }
  });
});

describe('the password the import hands out', () => {
  it('ACTUALLY SIGNS IN — otherwise the whole feature is decorative', async () => {
    /*
     * The chain nobody checks until a registry has distributed two thousand
     * slips of paper. The importer returns a password, the account stores only
     * a hash of it, and if those two ever disagree the failure surfaces as
     * hundreds of students who "cannot log in" with no way to tell which half
     * is wrong.
     */
    const result = await runImport({
      ...actor(),
      kind: 'STUDENT',
      text: STUDENT_HEADER + `Signin,Probe,signin-${SUFFIX}@x.test,,BSC-CSC,100\n`,
    });

    expect(result.created).toBe(1);
    const credential = result.credentials[0];
    expect(credential.password.length).toBeGreaterThan(8);

    const user = await raw.user.findFirstOrThrow({
      where: { email: `signin-${SUFFIX}@x.test` },
    });

    expect(await verifyPassword(credential.password, user.passwordHash)).toBe(true);

    // A wrong password must NOT verify, or the assertion above proves nothing.
    expect(await verifyPassword(`${credential.password}x`, user.passwordHash)).toBe(false);

    /*
     * And they are made to change it. A one-time password that stays valid
     * forever is a shared secret written on a slip of paper in a hall.
     */
    expect(user.mustChangePassword).toBe(true);
  });

  it('gives them an identifier they can type from memory', async () => {
    // The matriculation number, not a cuid: it is the string a student still
    // knows in third year, long after they have forgotten anything else.
    const result = await runImport({
      ...actor(),
      kind: 'STUDENT',
      text: STUDENT_HEADER + `Identifier,Probe,ident-${SUFFIX}@x.test,,BSC-CSC,100\n`,
    });

    expect(result.credentials[0].identifier).toBeTruthy();
    const student = await raw.student.findFirstOrThrow({
      where: { user: { email: `ident-${SUFFIX}@x.test` } },
    });
    expect(result.credentials[0].identifier).toBe(student.matricNumber);
  });
});
