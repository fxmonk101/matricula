'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { allocateSection, getTeachingWorkload } from '@/server/services/teaching.service';
import { proposeAssignee } from '@/lib/domain/tasks';

export interface AllocateFormState {
  ok?: boolean;
  message?: string;
}

/**
 * Allocate a section to an instructor.
 *
 * Guarded twice: `task:assign` says this role may hand out work at all, and the
 * tenant-scoped client means the section and the instructor must both belong to
 * the signed-in school for the lookup to resolve at all.
 */
export async function allocateSectionAction(
  _prev: AllocateFormState,
  formData: FormData,
): Promise<AllocateFormState> {
  const { schoolId, session, role, membershipId } = await requireTenantRole(
    'ADMIN',
    'INSTRUCTOR',
    'REGISTRAR',
  );
  assertCan(role, 'task:assign');

  const offeringId = String(formData.get('offeringId') ?? '');
  const instructorId = String(formData.get('instructorId') ?? '');
  if (!offeringId || !instructorId) {
    return { ok: false, message: 'Choose both a section and an instructor.' };
  }

  const result = await allocateSection({
    schoolId,
    offeringId,
    instructorId,
    assignerMembershipId: membershipId,
    actorUserId: session.sub,
  });

  revalidatePath('/team');
  revalidatePath('/tasks');
  revalidatePath('/offerings');
  return result;
}

/**
 * Who should take a section of this size?
 *
 * Returns a SUGGESTION. Teaching allocation involves specialism, research
 * leave and departmental politics that no scheduler can see, so the answer is
 * offered next to the picker rather than pre-selected in it.
 */
export async function suggestAssigneeAction(
  termId: string,
  creditHours: number,
): Promise<{ instructorId: string; name: string; utilisation: number } | null> {
  const { schoolId } = await requireTenantRole('ADMIN', 'INSTRUCTOR', 'REGISTRAR');
  const workload = await getTeachingWorkload(schoolId, termId);
  const pick = proposeAssignee(workload, creditHours);
  if (!pick) return null;

  const row = workload.find((w) => w.memberId === pick.memberId);
  if (!row) return null;
  return { instructorId: row.instructorId, name: pick.name, utilisation: pick.utilisation };
}
