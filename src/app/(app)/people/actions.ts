'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { isRole, type Role } from '@/lib/domain/enums';
import {
  changeRole,
  provisionMembership,
  resetPassword,
  setMembershipStatus,
  updatePerson,
} from '@/server/services/people.service';

/**
 * Every action re-checks the role AND the permission. The route guard keeps a
 * student off the page; it does nothing about a student POSTing to the action
 * directly, which is a plain HTTP request to a public endpoint.
 */

export interface PeopleFormState {
  ok?: boolean;
  message?: string;
  /** Shown once after creating an account or resetting a password. */
  temporaryPassword?: string;
  personName?: string;
}

/** ADMIN and OWNER both reach this page; only OWNER holds the user grants. */
const MANAGERS: Role[] = ['ADMIN', 'REGISTRAR'];

function optional(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? '').trim();
  return raw === '' ? null : raw;
}

export async function createPersonAction(
  _prev: PeopleFormState,
  formData: FormData,
): Promise<PeopleFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(...MANAGERS);
  assertCan(role, 'user:create');

  const newRole = String(formData.get('role') ?? '');
  if (!isRole(newRole)) return { ok: false, message: 'Choose a role.' };

  const result = await provisionMembership({
    schoolId,
    // Either may be blank; provisionMembership enforces that not both are.
    email: optional(formData.get('email')),
    username: optional(formData.get('username')),
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    phone: optional(formData.get('phone')),
    role: newRole,
    title: optional(formData.get('title')),
    orgUnitId: optional(formData.get('orgUnitId')),
    managerId: optional(formData.get('managerId')),
    actor: { role, membershipId },
    actorUserId: session.sub,
  });

  revalidatePath('/people');
  return {
    ok: result.ok,
    message: result.message,
    temporaryPassword: result.temporaryPassword,
    personName: `${String(formData.get('firstName') ?? '')} ${String(formData.get('lastName') ?? '')}`.trim(),
  };
}

export async function updatePersonAction(
  _prev: PeopleFormState,
  formData: FormData,
): Promise<PeopleFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(...MANAGERS);
  assertCan(role, 'user:manage');

  const result = await updatePerson({
    schoolId,
    membershipId: String(formData.get('membershipId') ?? ''),
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    phone: optional(formData.get('phone')),
    title: optional(formData.get('title')),
    orgUnitId: optional(formData.get('orgUnitId')),
    managerId: optional(formData.get('managerId')),
    actor: { role, membershipId },
    actorUserId: session.sub,
  });

  revalidatePath('/people');
  return { ok: result.ok, message: result.message };
}

export async function changeRoleAction(
  _prev: PeopleFormState,
  formData: FormData,
): Promise<PeopleFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(...MANAGERS);
  // Only OWNER holds this. An ADMIN reaching the page cannot change roles, and
  // that asymmetry is the whole reason OWNER exists.
  assertCan(role, 'user:role:set');

  const newRole = String(formData.get('newRole') ?? '');
  if (!isRole(newRole)) return { ok: false, message: 'Choose a role.' };

  const result = await changeRole({
    schoolId,
    membershipId: String(formData.get('membershipId') ?? ''),
    newRole,
    actor: { role, membershipId },
    actorUserId: session.sub,
  });

  revalidatePath('/people');
  return { ok: result.ok, message: result.message };
}

export async function setStatusAction(
  _prev: PeopleFormState,
  formData: FormData,
): Promise<PeopleFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(...MANAGERS);
  assertCan(role, 'user:suspend');

  const result = await setMembershipStatus({
    schoolId,
    membershipId: String(formData.get('membershipId') ?? ''),
    suspend: formData.get('suspend') === 'true',
    actor: { role, membershipId },
    actorUserId: session.sub,
  });

  revalidatePath('/people');
  return { ok: result.ok, message: result.message };
}

export async function resetPasswordAction(
  _prev: PeopleFormState,
  formData: FormData,
): Promise<PeopleFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(...MANAGERS);
  assertCan(role, 'user:password:reset');

  const result = await resetPassword({
    schoolId,
    membershipId: String(formData.get('membershipId') ?? ''),
    actor: { role, membershipId },
    actorUserId: session.sub,
  });

  revalidatePath('/people');
  return {
    ok: result.ok,
    message: result.message,
    temporaryPassword: result.temporaryPassword,
    personName: String(formData.get('personName') ?? ''),
  };
}
