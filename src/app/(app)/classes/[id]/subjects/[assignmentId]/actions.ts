'use server';

import { revalidatePath } from 'next/cache';

import { assertCan } from '@/lib/auth/rbac';
import { requireTenantRole } from '@/server/tenant-context';
import {
  deleteItem,
  deleteModule,
  saveItem,
  saveModule,
  setItemPublished,
  setModulePublished,
} from '@/server/services/lms.service';
import {
  ensureSpaceForSubject,
  mayAuthorSubject,
} from '@/server/services/k12-lms.service';

/**
 * Course content for a secondary school.
 *
 * SEPARATE ACTIONS FROM THE UNIVERSITY ONES, and deliberately so. The gate is
 * different — `mayAuthorSubject` asks whether this teacher has THIS subject
 * with THIS form class, which `mayAuthorOffering` cannot answer — and a single
 * action taking either kind of id would have to branch on which, in the one
 * place where getting the branch wrong means a teacher editing somebody else's
 * class.
 *
 * The SERVICES underneath are shared: `saveModule` and `saveItem` take a space
 * and a module, and neither knows or cares which kind of teaching the space
 * belongs to. Only the authorisation differs, which is exactly the part that
 * should not be shared.
 */

export interface SubjectContentState {
  ok?: boolean;
  message?: string;
  id?: string;
}

const TEACH_ROLES = ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'] as const;

async function authorise(subjectAssignmentId: string) {
  const ctx = await requireTenantRole(...TEACH_ROLES);
  assertCan(ctx.role, 'lms:author');

  const allowed = await mayAuthorSubject({
    schoolId: ctx.schoolId,
    subjectAssignmentId,
    instructorProfileId: ctx.session.pid,
    role: ctx.role,
  });

  return { ctx, allowed };
}

const NOT_YOURS = {
  ok: false,
  message: 'That is not your class. Only its teacher or the school office can change it.',
} as const;

function refresh(classId: string, assignmentId: string) {
  revalidatePath(`/classes/${classId}/subjects/${assignmentId}`);
  revalidatePath('/me/subjects');
}

export async function saveSubjectModuleAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;

  // The container is created on first use rather than at provisioning: most
  // subjects never get content, and an empty space per subject per term is a
  // row nobody reads.
  const space = await ensureSpaceForSubject({
    schoolId: ctx.schoolId,
    subjectAssignmentId: assignmentId,
  });
  if (!space.ok) return { ok: false, message: space.message };

  const result = await saveModule({
    schoolId: ctx.schoolId,
    spaceId: space.spaceId!,
    moduleId: String(formData.get('moduleId') ?? '') || null,
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message, id: result.id };
}

/**
 * Add a page, a file link, a web link or a virtual class.
 *
 * COURSEWORK and QUIZ are deliberately unreachable from here. They write a
 * `Submission`, which keys on `Enrollment` — a university registration a pupil
 * does not have. Offering them would produce an item a pupil could open and
 * never hand anything in to.
 */
const K12_KINDS = ['PAGE', 'LINK', 'FILE', 'MEETING'] as const;

export async function saveSubjectItemAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;

  const kind = String(formData.get('kind') ?? '');
  if (!(K12_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      message: 'Assignments and quizzes are not available for a form class yet.',
    };
  }

  const result = await saveItem({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    itemId: String(formData.get('itemId') ?? '') || null,
    kind: kind as 'PAGE' | 'LINK' | 'FILE' | 'MEETING',
    title: String(formData.get('title') ?? ''),
    bodyMarkdown: String(formData.get('bodyMarkdown') ?? '') || null,
    externalUrl: String(formData.get('externalUrl') ?? '') || null,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message, id: result.id };
}

export async function setSubjectModulePublishedAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;
  assertCan(ctx.role, 'lms:publish');

  const result = await setModulePublished({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    isPublished: formData.get('publish') === 'true',
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message };
}

export async function setSubjectItemPublishedAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;
  assertCan(ctx.role, 'lms:publish');

  const result = await setItemPublished({
    schoolId: ctx.schoolId,
    itemId: String(formData.get('itemId') ?? ''),
    isPublished: formData.get('publish') === 'true',
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message };
}

export async function deleteSubjectItemAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;

  const result = await deleteItem({
    schoolId: ctx.schoolId,
    itemId: String(formData.get('itemId') ?? ''),
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message };
}

export async function deleteSubjectModuleAction(
  _previous: SubjectContentState,
  formData: FormData,
): Promise<SubjectContentState> {
  const assignmentId = String(formData.get('assignmentId') ?? '');
  const classId = String(formData.get('classId') ?? '');
  const { ctx, allowed } = await authorise(assignmentId);
  if (!allowed) return NOT_YOURS;

  const result = await deleteModule({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    actorUserId: ctx.session.sub,
  });

  if (result.ok) refresh(classId, assignmentId);
  return { ok: result.ok, message: result.message };
}
