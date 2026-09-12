import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { dbFor, platformDb } from '@/lib/tenant';
import { hashPassword } from '@/lib/auth/password';
import { formatTemporaryPassword } from '@/lib/domain/provisioning';
import { buildMatricNumber } from '@/lib/domain/admissions';
import { nextMatricSequence } from './sequence.service';
import {
  disambiguateUsername,
  normaliseEmail,
  normaliseUsername,
  suggestUsername,
  usernameFromMatric,
  validateIdentifiers,
} from '@/lib/domain/identifier';
import {
  normaliseMatric,
  validateRegistration,
  type RegistrationDraft,
} from '@/lib/domain/registration';
import { assertSeatAvailable } from './platform.service';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * STUDENT REGISTRATION
 * =============================================================================
 *
 * The Bursary's desk: admitting a person as a student of this institution.
 *
 * Distinct from `convertApplicantToStudent`, which turns an ACCEPTED
 * APPLICATION into a student and is untouched. This is the path for everybody
 * without one — direct entry, transfers, returning deferrals, and the several
 * thousand students a university already has on the day it starts using the
 * system.
 */

export interface RegistrationResult {
  ok: boolean;
  message: string;
  studentId?: string;
  userId?: string;
  matricNumber?: string;
  /** Shown ONCE. Absent when the person already had an account. */
  temporaryPassword?: string;
}

/**
 * Register a student.
 *
 * ONE TRANSACTION, and the reason is the matriculation number. The sequence is
 * derived by counting existing rows, so two registrations running concurrently
 * can read the same count and mint the same number. Inside a transaction the
 * UNIQUE constraint on (schoolId, matricNumber) turns that race into a
 * retryable error rather than two students sharing an identity — and a student
 * created without their number, or a number issued to no student, is a state
 * nobody can repair from the UI.
 */
export async function registerStudent(params: {
  schoolId: string;
  schoolCode: string;
  draft: RegistrationDraft;
  actorUserId: string;
  now?: Date;
}): Promise<RegistrationResult> {
  const { draft } = params;
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const email = draft.email ? normaliseEmail(draft.email) : null;
  let username = draft.username ? normaliseUsername(draft.username) : null;

  // The programme is re-read through the TENANT-scoped client before anything
  // references it: `connect: { id }` is not validated against the tenant, so a
  // crafted id would otherwise enrol this student on another university's
  // programme.
  const programme = draft.programmeId
    ? await db.program.findUnique({
        where: { id: draft.programmeId },
        include: { department: true },
      })
    : null;

  if (draft.programmeId && !programme) {
    return { ok: false, message: 'Choose a programme from this school.' };
  }
  if (programme && !programme.isActive) {
    return {
      ok: false,
      message: `${programme.name} is closed to new intake. Reopen it first, or choose another.`,
    };
  }

  /*
   * A username is DERIVED when neither identifier was supplied — which is the
   * common case for an intake. Derived from the matriculation number when one
   * was typed in, because that is the string a student will type from memory
   * long after they have forgotten anything else; otherwise from their name.
   */
  if (!username && !email) {
    const basis = draft.matricNumber?.trim()
      ? usernameFromMatric(draft.matricNumber)
      : suggestUsername(draft.firstName, draft.lastName);
    if (basis) {
      const taken = new Set(
        (
          await platformDb.user.findMany({
            where: { username: { startsWith: basis } },
            select: { username: true },
          })
        )
          .map((u) => u.username)
          .filter((u): u is string => u !== null),
      );
      username = disambiguateUsername(basis, taken);
    }
  }

  const problems = validateRegistration(
    { ...draft, email, username },
    programme,
    validateIdentifiers({ email, username }),
    now,
  );
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // Seats are counted before anything is written, so the refusal names the
  // plan's limit instead of surfacing a constraint violation.
  const seat = await assertSeatAvailable(params.schoolId, 'student');
  if (!seat.allowed) return { ok: false, message: seat.message! };

  const existingUser = email
    ? await platformDb.user.findUnique({ where: { email } })
    : username
      ? await platformDb.user.findUnique({ where: { username } })
      : null;

  if (existingUser) {
    const alreadyStudent = await db.student.findFirst({
      where: { userId: existingUser.id },
    });
    if (alreadyStudent) {
      return {
        ok: false,
        message: `${existingUser.firstName} ${existingUser.lastName} is already a student here (${alreadyStudent.matricNumber}).`,
      };
    }
  }

  const temporaryPassword = formatTemporaryPassword(randomBytes(32));

  try {
    const result = await platformDb.$transaction(async (tx) => {
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            username,
            passwordHash: await hashPassword(temporaryPassword),
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            phone: draft.phone?.trim() || null,
            mustChangePassword: true,
          },
        }));

      /*
       * The matriculation number.
       *
       * A supplied one is honoured EXACTLY as typed. A university migrating
       * its records has numbers printed on certificates already issued, and
       * replacing one of those with a freshly generated number is the most
       * destructive thing this software could do to a student's record.
       */
      const matricNumber = draft.matricNumber?.trim()
        ? normaliseMatric(draft.matricNumber)
        : buildMatricNumber(
            params.schoolCode,
            programme!.department.code,
            now.getFullYear(),
            await nextMatricSequence(tx, programme!.department.code, now.getFullYear()),
          );

      // Role lives on the MEMBERSHIP, never on the user: this person may hold
      // a different role at another institution and must keep it.
      const membership = await tx.membership.findFirst({
        where: { userId: user.id, schoolId: params.schoolId },
      });
      if (membership) {
        await tx.membership.update({
          where: { id: membership.id },
          data: { role: 'STUDENT', status: 'ACTIVE' },
        });
      } else {
        await tx.membership.create({
          data: {
            userId: user.id,
            schoolId: params.schoolId,
            role: 'STUDENT',
            isPrimary: !existingUser,
            status: 'ACTIVE',
          },
        });
      }

      const student = await tx.student.create({
        data: {
          schoolId: params.schoolId,
          userId: user.id,
          matricNumber,
          programId: programme!.id,
          level: draft.level,
          dateOfBirth: draft.dateOfBirth ? new Date(draft.dateOfBirth) : null,
          gender: draft.gender?.trim() || null,
          nationality: draft.nationality?.trim() || null,
          address: draft.address?.trim() || null,
          status: 'ACTIVE',
        },
      });

      return { student, user, matricNumber };
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'student.register',
      entityType: 'Student',
      entityId: result.student.id,
      summary: `${result.user.firstName} ${result.user.lastName} registered as ${result.matricNumber} on ${programme!.code}, level ${draft.level}.`,
    });

    return {
      ok: true,
      message: `Registered. Matriculation number ${result.matricNumber} issued.`,
      studentId: result.student.id,
      userId: result.user.id,
      matricNumber: result.matricNumber,
      // An existing account keeps the password it already has; showing a new
      // one would be a credential they could not sign in with.
      temporaryPassword: existingUser ? undefined : temporaryPassword,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '');
      if (target.includes('matricNumber')) {
        return {
          ok: false,
          message: 'That matriculation number is already in use. Try again, or enter a different one.',
        };
      }
      if (target.includes('username')) {
        return { ok: false, message: 'That username is already taken.' };
      }
      if (target.includes('email')) {
        return { ok: false, message: 'That email address is already in use.' };
      }
    }
    console.error('[registration] failed', error);
    return { ok: false, message: 'Could not register that student. Nothing was created.' };
  }
}

/**
 * The programmes a bursar can register onto, with the levels each allows.
 *
 * Closed programmes are excluded rather than shown and refused: a dropdown
 * that offers something the next screen rejects is a worse experience than one
 * that never offered it.
 */
export async function registrationOptions(schoolId: string) {
  const db = dbFor(schoolId);
  const programmes = await db.program.findMany({
    where: { isActive: true },
    include: { department: { select: { code: true, name: true } } },
    orderBy: { code: 'asc' },
  });

  return programmes.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    departmentCode: p.department.code,
    durationTerms: p.durationTerms,
  }));
}
