'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import {
  approveResults,
  returnResults,
} from '@/server/services/result-workflow.service';

/**
 * Approving, or sending back.
 *
 * NO ROLE CHECK HERE beyond reaching the page. The service checks the actor
 * against the stage the sheet is ACTUALLY at, read at the moment of the write
 * — not against whatever the page was showing when the button was drawn. Two
 * approvers clicking at once would otherwise both succeed and the sheet would
 * skip a stage with nobody's name on it.
 */

export interface ApprovalFormState {
  ok?: boolean;
  message?: string;
}

const OFFICE_ROLES = ['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'] as const;

function refresh(offeringId: string) {
  revalidatePath('/results');
  revalidatePath(`/teaching/${offeringId}`);
  revalidatePath('/me');
}

export async function approveAction(
  _previous: ApprovalFormState,
  formData: FormData,
): Promise<ApprovalFormState> {
  const ctx = await requireTenantRole(...OFFICE_ROLES);
  const offeringId = String(formData.get('offeringId') ?? '');

  const result = await approveResults({
    schoolId: ctx.schoolId,
    offeringId,
    policy: ctx.config.resultWorkflow,
    note: String(formData.get('note') ?? '') || null,
    actor: {
      role: ctx.role,
      membershipId: ctx.membershipId,
      userId: ctx.session.sub,
      instructorProfileId: ctx.session.pid,
    },
  });

  if (result.ok) refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function returnAction(
  _previous: ApprovalFormState,
  formData: FormData,
): Promise<ApprovalFormState> {
  const ctx = await requireTenantRole(...OFFICE_ROLES);
  const offeringId = String(formData.get('offeringId') ?? '');

  const result = await returnResults({
    schoolId: ctx.schoolId,
    offeringId,
    reason: String(formData.get('reason') ?? ''),
    actor: {
      role: ctx.role,
      membershipId: ctx.membershipId,
      userId: ctx.session.sub,
      instructorProfileId: ctx.session.pid,
    },
  });

  if (result.ok) refresh(offeringId);
  return { ok: result.ok, message: result.message };
}
