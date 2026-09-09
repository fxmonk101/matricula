import { randomBytes } from 'node:crypto';

import { dbFor, platformDb } from '@/lib/tenant';
import { hashPassword } from '@/lib/auth/password';
import { formatTemporaryPassword } from '@/lib/domain/provisioning';
import {
  canActOn,
  canAssignRole,
  normaliseEmail,
  passwordProblems,
  seatKindFor,
  validatePerson,
  wouldLeaveSchoolOwnerless,
  type ActorContext,
} from '@/lib/domain/people';
import type { Role } from '@/lib/domain/enums';
import { assertSeatAvailable } from './platform.service';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * PEOPLE AND ACCOUNTS
 * =============================================================================
 *
 * Creating, editing and suspending the people at ONE school.
 *
 * The identity model is the thing to keep hold of: a `User` is a human and is
 * global to the platform; a `Membership` is that human's authorisation AT ONE
 * SCHOOL. A teacher who moves schools, a parent with children at two, an
 * administrator who also lectures — all of them are one User with several
 * Memberships. Creating a second User for the same human is what makes a
 * platform's identity model unrecoverable, so every path here is find-or-create
 * on the email address.
 *
 * This generalises the pattern proved by `createApplicantAccount`, which stays
 * where it is: the public application form has different rules (it must not
 * leak whether an address exists) and a different caller.
 */

export interface PeopleResult {
  ok: boolean;
  message: string;
  membershipId?: string;
  userId?: string;
  /** Shown ONCE. Absent when the person already had an account. */
  temporaryPassword?: string;
}

/**
 * Create a person at this school, or give an existing person a membership.
 *
 * Returns a one-time password only when a NEW account was created. Somebody who
 * already has an account keeps the password they already use — showing a freshly
 * generated one would be a lie they could not sign in with, and would also be a
 * way for one school's administrator to learn that an address exists at another.
 */
export async function provisionMembership(params: {
  schoolId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: Role;
  title?: string | null;
  orgUnitId?: string | null;
  managerId?: string | null;
  actor: ActorContext;
  actorUserId: string;
}): Promise<PeopleResult> {
  const email = normaliseEmail(params.email);
  const problems = validatePerson({
    email,
    firstName: params.firstName,
    lastName: params.lastName,
    phone: params.phone,
    role: params.role,
    title: params.title,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const assignable = canAssignRole(params.actor.role, params.role);
  if (!assignable.allowed) return { ok: false, message: assignable.reason! };

  const db = dbFor(params.schoolId);

  // Already here? Say so plainly. Unlike the public application form, this is
  // an authenticated administrator looking at their own school's register —
  // there is nothing to leak.
  const existing = await db.membership.findFirst({
    where: { user: { email } },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (existing) {
    return {
      ok: false,
      message: `${existing.user.firstName} ${existing.user.lastName} is already a member of this school.`,
    };
  }

  // THE SEAT CHECK. Refused here rather than at the database, so the message
  // names the limit and the plan instead of surfacing a constraint violation.
  const kind = seatKindFor(params.role);
  if (kind) {
    const seat = await assertSeatAvailable(params.schoolId, kind);
    if (!seat.allowed) return { ok: false, message: seat.message! };
  }

  const existingUser = await platformDb.user.findUnique({ where: { email } });
  const temporaryPassword = formatTemporaryPassword(randomBytes(32));

  try {
    const membership = await platformDb.$transaction(async (tx) => {
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            passwordHash: await hashPassword(temporaryPassword),
            firstName: params.firstName.trim(),
            lastName: params.lastName.trim(),
            phone: params.phone?.trim() || null,
            mustChangePassword: true,
          },
        }));

      return tx.membership.create({
        data: {
          userId: user.id,
          schoolId: params.schoolId,
          role: params.role,
          title: params.title?.trim() || null,
          orgUnitId: params.orgUnitId ?? null,
          managerId: params.managerId ?? null,
          // Their FIRST membership is their home school. A person who already
          // belongs somewhere keeps landing where they already landed.
          isPrimary: !existingUser,
          status: 'ACTIVE',
        },
      });
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'people.create',
      entityType: 'Membership',
      entityId: membership.id,
      summary: `${params.firstName} ${params.lastName} (${email}) added as ${params.role}.`,
    });

    return {
      ok: true,
      message: existingUser
        ? `${params.firstName} ${params.lastName} already had an account and has been added to this school. They sign in with their existing password.`
        : `${params.firstName} ${params.lastName} added. Give them their one-time password — it cannot be shown again.`,
      membershipId: membership.id,
      userId: membership.userId,
      temporaryPassword: existingUser ? undefined : temporaryPassword,
    };
  } catch (error) {
    console.error('[people] provisioning failed', error);
    return { ok: false, message: 'Could not create that account. Nothing was changed.' };
  }
}

/** Edit the parts of a person that belong to THIS school, plus their name. */
export async function updatePerson(params: {
  schoolId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  title?: string | null;
  orgUnitId?: string | null;
  managerId?: string | null;
  actor: ActorContext;
  actorUserId: string;
}): Promise<PeopleResult> {
  const db = dbFor(params.schoolId);
  const target = await db.membership.findUnique({
    where: { id: params.membershipId },
    include: { user: true },
  });
  if (!target) return { ok: false, message: 'That person is not a member of this school.' };

  const verdict = canActOn(
    params.actor,
    { membershipId: target.id, role: target.role as Role },
    'edit',
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  const problems = validatePerson({
    email: target.user.email,
    firstName: params.firstName,
    lastName: params.lastName,
    phone: params.phone,
    role: target.role as Role,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // A manager must be a membership of THIS school. `connect: { id }` is not
  // validated against the tenant, so a crafted id would otherwise put a
  // reporting line across a school boundary.
  if (params.managerId) {
    const manager = await db.membership.findUnique({ where: { id: params.managerId } });
    if (!manager) return { ok: false, message: 'That manager is not a member of this school.' };
    if (manager.id === target.id) {
      return { ok: false, message: 'Somebody cannot report to themselves.' };
    }
  }
  if (params.orgUnitId) {
    const unit = await db.orgUnit.findUnique({ where: { id: params.orgUnitId } });
    if (!unit) return { ok: false, message: 'That department is not part of this school.' };
  }

  await platformDb.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.userId },
      data: {
        firstName: params.firstName.trim(),
        lastName: params.lastName.trim(),
        phone: params.phone?.trim() || null,
      },
    });
    await tx.membership.update({
      where: { id: target.id },
      data: {
        title: params.title?.trim() || null,
        orgUnitId: params.orgUnitId ?? null,
        managerId: params.managerId ?? null,
      },
    });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'people.update',
    entityType: 'Membership',
    entityId: target.id,
    summary: `Updated ${params.firstName} ${params.lastName} (${target.user.email}).`,
  });

  return { ok: true, message: 'Saved.', membershipId: target.id };
}

/** Change somebody's role at this school. */
export async function changeRole(params: {
  schoolId: string;
  membershipId: string;
  newRole: Role;
  actor: ActorContext;
  actorUserId: string;
}): Promise<PeopleResult> {
  const db = dbFor(params.schoolId);
  const target = await db.membership.findUnique({
    where: { id: params.membershipId },
    include: { user: true },
  });
  if (!target) return { ok: false, message: 'That person is not a member of this school.' };
  if (target.role === params.newRole) return { ok: true, message: 'No change.' };

  const verdict = canActOn(
    params.actor,
    { membershipId: target.id, role: target.role as Role },
    'role',
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  const assignable = canAssignRole(params.actor.role, params.newRole);
  if (!assignable.allowed) return { ok: false, message: assignable.reason! };

  const activeOwnerCount = await db.membership.count({
    where: { role: 'OWNER', status: 'ACTIVE' },
  });
  if (
    wouldLeaveSchoolOwnerless({
      targetRole: target.role as Role,
      action: 'role',
      activeOwnerCount,
    })
  ) {
    return {
      ok: false,
      message: 'This is the school’s only owner. Appoint another owner first.',
    };
  }

  // Moving INTO a seated role needs a seat; moving out of one frees it. A
  // sideways move between two staff roles changes nothing, and charging for it
  // would be wrong.
  const wasKind = seatKindFor(target.role as Role);
  const nowKind = seatKindFor(params.newRole);
  if (nowKind && nowKind !== wasKind) {
    const seat = await assertSeatAvailable(params.schoolId, nowKind);
    if (!seat.allowed) return { ok: false, message: seat.message! };
  }

  await db.membership.update({
    where: { id: target.id },
    data: { role: params.newRole },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'people.role',
    entityType: 'Membership',
    entityId: target.id,
    summary: `${target.user.firstName} ${target.user.lastName}: ${target.role} → ${params.newRole}.`,
  });

  return { ok: true, message: `Role changed to ${params.newRole}.`, membershipId: target.id };
}

/**
 * Suspend or reinstate somebody at this school.
 *
 * Suspension is per-SCHOOL, not per-person: a teacher suspended here keeps
 * their account and any membership they hold elsewhere. Deactivating the User
 * would reach across tenants, which no school administrator should be able to
 * do.
 */
export async function setMembershipStatus(params: {
  schoolId: string;
  membershipId: string;
  suspend: boolean;
  actor: ActorContext;
  actorUserId: string;
}): Promise<PeopleResult> {
  const db = dbFor(params.schoolId);
  const target = await db.membership.findUnique({
    where: { id: params.membershipId },
    include: { user: true },
  });
  if (!target) return { ok: false, message: 'That person is not a member of this school.' };

  const verdict = canActOn(
    params.actor,
    { membershipId: target.id, role: target.role as Role },
    'suspend',
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  if (params.suspend) {
    const activeOwnerCount = await db.membership.count({
      where: { role: 'OWNER', status: 'ACTIVE' },
    });
    if (
      wouldLeaveSchoolOwnerless({
        targetRole: target.role as Role,
        action: 'suspend',
        activeOwnerCount,
      })
    ) {
      return {
        ok: false,
        message: 'This is the school’s only owner. Appoint another owner first.',
      };
    }
  } else {
    // Reinstating consumes a seat again, so it can be refused for the same
    // reason creating one can.
    const kind = seatKindFor(target.role as Role);
    if (kind) {
      const seat = await assertSeatAvailable(params.schoolId, kind);
      if (!seat.allowed) return { ok: false, message: seat.message! };
    }
  }

  await db.membership.update({
    where: { id: target.id },
    data: { status: params.suspend ? 'SUSPENDED' : 'ACTIVE' },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.suspend ? 'people.suspend' : 'people.reinstate',
    entityType: 'Membership',
    entityId: target.id,
    summary: `${target.user.firstName} ${target.user.lastName} (${target.user.email}) ${params.suspend ? 'suspended' : 'reinstated'}.`,
  });

  return {
    ok: true,
    message: params.suspend
      ? `${target.user.firstName} can no longer sign in to this school.`
      : `${target.user.firstName} can sign in again.`,
    membershipId: target.id,
  };
}

/**
 * Issue a new one-time password.
 *
 * Reset goes through the office, which is how schools actually work: there is
 * no email dependency in the critical path, and a pupil who has forgotten their
 * password asks a member of staff rather than waiting on a mail server.
 *
 * The password is REPLACED, not revealed — nobody, including the administrator
 * doing the reset, can read the old one.
 */
export async function resetPassword(params: {
  schoolId: string;
  membershipId: string;
  actor: ActorContext;
  actorUserId: string;
}): Promise<PeopleResult> {
  const db = dbFor(params.schoolId);
  const target = await db.membership.findUnique({
    where: { id: params.membershipId },
    include: { user: true },
  });
  if (!target) return { ok: false, message: 'That person is not a member of this school.' };

  const verdict = canActOn(
    params.actor,
    { membershipId: target.id, role: target.role as Role },
    'password',
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  const temporaryPassword = formatTemporaryPassword(randomBytes(32));
  await platformDb.user.update({
    where: { id: target.userId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'people.password.reset',
    entityType: 'User',
    entityId: target.userId,
    // The password itself is never written to the audit log. What happened, by
    // whom, to whom — not the secret.
    summary: `Password reset for ${target.user.firstName} ${target.user.lastName} (${target.user.email}).`,
  });

  return {
    ok: true,
    message: `New one-time password for ${target.user.firstName}. It cannot be shown again.`,
    temporaryPassword,
    membershipId: target.id,
  };
}

/**
 * A person setting their OWN password.
 *
 * The only path that clears `mustChangePassword`, and it takes the current
 * password even when the account is in forced-change state: somebody who walks
 * up to an unlocked laptop must not be able to take the account over, and the
 * temporary password is exactly what the legitimate user has just typed.
 */
export async function changeOwnPassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  schoolId: string;
}): Promise<{ ok: boolean; message: string }> {
  const { verifyPassword } = await import('@/lib/auth/password');

  const user = await platformDb.user.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, message: 'Account not found.' };

  if (!(await verifyPassword(params.currentPassword, user.passwordHash))) {
    return { ok: false, message: 'That is not your current password.' };
  }

  const problems = passwordProblems(params.newPassword, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  if (await verifyPassword(params.newPassword, user.passwordHash)) {
    return { ok: false, message: 'Choose a password you have not just been using.' };
  }

  await platformDb.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(params.newPassword),
      mustChangePassword: false,
    },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: user.id,
    action: 'account.password.change',
    entityType: 'User',
    entityId: user.id,
    summary: `${user.firstName} ${user.lastName} set their own password.`,
  });

  return { ok: true, message: 'Password changed.' };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export interface PersonRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  title: string | null;
  status: string;
  isPrimary: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  orgUnit: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  /** Memberships this person holds at OTHER schools. A count, never a list. */
  otherSchools: number;
}

export async function listPeople(
  schoolId: string,
  filter: { role?: Role; query?: string; includeSuspended?: boolean } = {},
): Promise<PersonRow[]> {
  const db = dbFor(schoolId);
  const query = filter.query?.trim();

  const memberships = await db.membership.findMany({
    where: {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.includeSuspended ? {} : { status: { not: 'SUSPENDED' } }),
      ...(query
        ? {
            OR: [
              { user: { firstName: { contains: query } } },
              { user: { lastName: { contains: query } } },
              { user: { email: { contains: query } } },
              { title: { contains: query } },
            ],
          }
        : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          lastLoginAt: true,
          mustChangePassword: true,
          _count: { select: { memberships: true } },
        },
      },
      orgUnit: { select: { id: true, name: true } },
      manager: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }],
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: `${m.user.firstName} ${m.user.lastName}`,
    email: m.user.email,
    phone: m.user.phone,
    role: m.role as Role,
    title: m.title,
    status: m.status,
    isPrimary: m.isPrimary,
    mustChangePassword: m.user.mustChangePassword,
    lastLoginAt: m.user.lastLoginAt,
    orgUnit: m.orgUnit ? { id: m.orgUnit.id, name: m.orgUnit.name } : null,
    manager: m.manager
      ? {
          id: m.manager.id,
          name: `${m.manager.user.firstName} ${m.manager.user.lastName}`,
        }
      : null,
    // A COUNT, not a list. That someone belongs elsewhere is useful context for
    // an administrator; WHERE they belong is not this school's business.
    otherSchools: Math.max(0, m.user._count.memberships - 1),
  }));
}

export async function peopleSummary(schoolId: string) {
  const db = dbFor(schoolId);
  const [byRole, suspended, neverSignedIn, pendingPassword] = await Promise.all([
    db.membership.groupBy({ by: ['role'], _count: true, where: { status: 'ACTIVE' } }),
    db.membership.count({ where: { status: 'SUSPENDED' } }),
    db.membership.count({ where: { status: 'ACTIVE', user: { lastLoginAt: null } } }),
    db.membership.count({ where: { status: 'ACTIVE', user: { mustChangePassword: true } } }),
  ]);

  return {
    byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count])) as Record<string, number>,
    total: byRole.reduce((sum, r) => sum + r._count, 0),
    suspended,
    // The two numbers an administrator actually acts on: accounts handed out
    // and never used, and accounts still on a password somebody read aloud.
    neverSignedIn,
    pendingPassword,
  };
}
