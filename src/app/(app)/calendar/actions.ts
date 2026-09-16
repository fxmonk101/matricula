'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { deleteTerm, saveTerm, setCurrentTerm } from '@/server/services/term.service';
import {
  deleteFeeStructure,
  saveFeeStructure,
  setFeeStructureActive,
  type FeeItemDraft,
} from '@/server/services/fees.service';

export interface CalendarFormState {
  ok?: boolean;
  message?: string;
  warnings?: string[];
}

function optional(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? '').trim();
  return raw === '' ? null : raw;
}

function refresh() {
  revalidatePath('/calendar');
  // The setup checklist counts terms, so it would otherwise keep reporting the
  // step as outstanding after it had been done.
  revalidatePath('/setup');
  revalidatePath('/finance');
  revalidatePath('/offerings');
}

// -----------------------------------------------------------------------------
// Terms — the registry's calendar
// -----------------------------------------------------------------------------

export async function saveTermAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'term:write');

  const result = await saveTerm({
    schoolId,
    termId: optional(formData.get('termId')),
    makeCurrent: formData.get('makeCurrent') === 'true',
    draft: {
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      academicYear: String(formData.get('academicYear') ?? ''),
      season: String(formData.get('season') ?? ''),
      startDate: String(formData.get('startDate') ?? ''),
      endDate: String(formData.get('endDate') ?? ''),
      registrationOpensAt: String(formData.get('registrationOpensAt') ?? ''),
      registrationClosesAt: String(formData.get('registrationClosesAt') ?? ''),
      addDropDeadline: String(formData.get('addDropDeadline') ?? ''),
      withdrawalDeadline: String(formData.get('withdrawalDeadline') ?? ''),
    },
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message, warnings: result.warnings };
}

export async function setCurrentTermAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'term:write');

  const result = await setCurrentTerm({
    schoolId,
    termId: String(formData.get('termId') ?? ''),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function deleteTermAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'term:write');

  const result = await deleteTerm({
    schoolId,
    termId: String(formData.get('termId') ?? ''),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

// -----------------------------------------------------------------------------
// Fee schedules — the bursary's
// -----------------------------------------------------------------------------

/**
 * Fee lines arrive as parallel arrays, which is how a browser serialises a
 * repeated fieldset. Zipped back here rather than in the service, so the
 * service takes a shape that makes sense to call from a script or a test.
 */
function readItems(formData: FormData): FeeItemDraft[] {
  const codes = formData.getAll('itemCode').map(String);
  const descriptions = formData.getAll('itemDescription').map(String);
  const amounts = formData.getAll('itemAmount').map(String);
  const perCredit = formData.getAll('itemPerCredit').map(String);
  const mandatory = formData.getAll('itemMandatory').map(String);

  return codes
    .map((code, i) => ({
      code,
      description: descriptions[i] ?? '',
      amount: Number(amounts[i] ?? 0),
      // Checkboxes only appear in the payload when ticked, so a per-row flag is
      // carried as an explicit "true"/"false" hidden field instead.
      perCreditHour: perCredit[i] === 'true',
      isMandatory: mandatory[i] !== 'false',
    }))
    // A blank row is a row the bursar added and did not fill in, not an error.
    .filter((item) => item.code.trim() || item.description.trim());
}

export async function saveFeeStructureAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'FINANCE');
  assertCan(role, 'fee:configure');

  const level = optional(formData.get('level'));

  const result = await saveFeeStructure({
    schoolId,
    structureId: optional(formData.get('structureId')),
    name: String(formData.get('name') ?? ''),
    termId: String(formData.get('termId') ?? ''),
    programId: optional(formData.get('programId')),
    level: level ? Number(level) : null,
    items: readItems(formData),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function setFeeStructureActiveAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'FINANCE');
  assertCan(role, 'fee:configure');

  const result = await setFeeStructureActive({
    schoolId,
    structureId: String(formData.get('structureId') ?? ''),
    isActive: formData.get('isActive') === 'true',
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}

export async function deleteFeeStructureAction(
  _prev: CalendarFormState,
  formData: FormData,
): Promise<CalendarFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'FINANCE');
  assertCan(role, 'fee:configure');

  const result = await deleteFeeStructure({
    schoolId,
    structureId: String(formData.get('structureId') ?? ''),
    actorUserId: session.sub,
  });

  refresh();
  return { ok: result.ok, message: result.message };
}
