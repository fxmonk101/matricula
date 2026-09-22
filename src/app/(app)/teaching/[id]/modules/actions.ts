'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import {
  deleteItem,
  deleteModule,
  ensureSpaceForOffering,
  mayAuthorOffering,
  moveItem,
  moveModule,
  saveItem,
  saveModule,
  setItemPublished,
  setModulePublished,
} from '@/server/services/lms.service';

/**
 * Authoring a course's content.
 *
 * TWO GATES ON EVERY ACTION, and they answer different questions. The role gate
 * asks "may this kind of person author courses at all"; `mayAuthorOffering`
 * asks "is this YOUR course" — which is a fact about a record and cannot be
 * settled by a role. A lecturer who may edit their own module must not be able
 * to edit a colleague's by changing the id in the form.
 */

export interface LmsFormState {
  ok?: boolean;
  message?: string;
}

const AUTHOR_ROLES = ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'] as const;

async function authorise(offeringId: string) {
  const ctx = await requireTenantRole(...AUTHOR_ROLES);
  assertCan(ctx.role, 'lms:author');

  const allowed = await mayAuthorOffering({
    schoolId: ctx.schoolId,
    offeringId,
    instructorProfileId: ctx.session.pid,
    role: ctx.role,
  });

  return { ctx, allowed };
}

const NOT_YOURS = {
  ok: false,
  message: 'That is not your course. Only its lecturer or the faculty office can change it.',
} as const;

function refresh(offeringId: string) {
  revalidatePath(`/teaching/${offeringId}/modules`);
  revalidatePath('/me/courses');
}

/** A `datetime-local` value carries no zone; it means what the typist meant. */
function instantOf(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const at = new Date(trimmed);
  return Number.isNaN(at.getTime()) ? null : at;
}

// -----------------------------------------------------------------------------
// Modules
// -----------------------------------------------------------------------------

export async function saveModuleAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const space = await ensureSpaceForOffering({ schoolId: ctx.schoolId, offeringId });
  if (!space.ok || !space.spaceId) {
    return { ok: false, message: space.message ?? 'Could not open that course.' };
  }

  const result = await saveModule({
    schoolId: ctx.schoolId,
    spaceId: space.spaceId,
    moduleId: String(formData.get('moduleId') ?? '') || null,
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    unlockAt: instantOf(String(formData.get('unlockAt') ?? '')),
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function setModulePublishedAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;
  assertCan(ctx.role, 'lms:publish');

  const result = await setModulePublished({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    isPublished: formData.get('isPublished') === 'true',
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function deleteModuleAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await deleteModule({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function moveModuleAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await moveModule({
    schoolId: ctx.schoolId,
    spaceId: String(formData.get('spaceId') ?? ''),
    moduleId: String(formData.get('moduleId') ?? ''),
    toIndex: Number(formData.get('toIndex') ?? 0),
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

export async function saveItemAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await saveItem({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    itemId: String(formData.get('itemId') ?? '') || null,
    kind: String(formData.get('kind') ?? ''),
    title: String(formData.get('title') ?? ''),
    bodyMarkdown: String(formData.get('bodyMarkdown') ?? '') || null,
    externalUrl: String(formData.get('externalUrl') ?? '') || null,
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function setItemPublishedAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;
  assertCan(ctx.role, 'lms:publish');

  const result = await setItemPublished({
    schoolId: ctx.schoolId,
    itemId: String(formData.get('itemId') ?? ''),
    isPublished: formData.get('isPublished') === 'true',
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function deleteItemAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await deleteItem({
    schoolId: ctx.schoolId,
    itemId: String(formData.get('itemId') ?? ''),
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}

export async function moveItemAction(
  _prev: LmsFormState,
  formData: FormData,
): Promise<LmsFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const result = await moveItem({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    itemId: String(formData.get('itemId') ?? ''),
    toIndex: Number(formData.get('toIndex') ?? 0),
    actorUserId: ctx.session.sub,
  });

  refresh(offeringId);
  return { ok: result.ok, message: result.message };
}
