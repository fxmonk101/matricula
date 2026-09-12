'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { registerStudent } from '@/server/services/registration.service';

/**
 * Student registration is the BURSARY's action.
 *
 * `student:register` is held by FINANCE, OWNER and ADMIN — and deliberately not
 * by the registry, so that no single office can both admit a student and clear
 * their fees. The permission is re-checked here because the route guard
 * protects the page and not the action, which is an ordinary HTTP endpoint.
 */

export interface RegistrationFormState {
  ok?: boolean;
  message?: string;
  matricNumber?: string;
  temporaryPassword?: string;
  studentName?: string;
}

function optional(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? '').trim();
  return raw === '' ? null : raw;
}

export async function registerStudentAction(
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const { schoolId, role, session, school } = await requireTenantRole(
    'ADMIN',
    'FINANCE',
    'REGISTRAR',
  );
  assertCan(role, 'student:register');

  const level = Number(formData.get('level') ?? 100);

  const result = await registerStudent({
    schoolId,
    schoolCode: school.code,
    draft: {
      firstName: String(formData.get('firstName') ?? ''),
      lastName: String(formData.get('lastName') ?? ''),
      email: optional(formData.get('email')),
      username: optional(formData.get('username')),
      phone: optional(formData.get('phone')),
      programmeId: String(formData.get('programmeId') ?? ''),
      level: Number.isFinite(level) ? level : 100,
      matricNumber: optional(formData.get('matricNumber')),
      dateOfBirth: optional(formData.get('dateOfBirth')),
      gender: optional(formData.get('gender')),
      nationality: optional(formData.get('nationality')),
      address: optional(formData.get('address')),
    },
    actorUserId: session.sub,
  });

  revalidatePath('/students');
  revalidatePath('/setup');

  return {
    ok: result.ok,
    message: result.message,
    matricNumber: result.matricNumber,
    temporaryPassword: result.temporaryPassword,
    studentName: `${String(formData.get('firstName') ?? '')} ${String(formData.get('lastName') ?? '')}`.trim(),
  };
}
