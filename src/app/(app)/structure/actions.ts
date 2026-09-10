'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import {
  deleteDepartment,
  deleteFaculty,
  saveCourse,
  saveDepartment,
  saveProgramme,
  setCourseActive,
  setProgrammeActive,
} from '@/server/services/structure.service';
import { saveFaculty } from '@/server/services/structure.service';

/**
 * The Registrar's office.
 *
 * Every action re-checks the permission. The route guard keeps a student off
 * the page; it does nothing about one POSTing to the action directly, which is
 * an ordinary HTTP request to a public endpoint.
 */

export interface StructureFormState {
  ok?: boolean;
  message?: string;
}

function num(value: FormDataEntryValue | null, fallback = NaN): number {
  const raw = String(value ?? '').trim();
  if (raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function optional(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? '').trim();
  return raw === '' ? null : raw;
}

function refresh() {
  revalidatePath('/structure');
  // The setup checklist reads these counts, so it would otherwise keep
  // reporting a step as outstanding after it had been done.
  revalidatePath('/setup');
  revalidatePath('/courses');
}

export async function saveFacultyAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'faculty:write');

  const result = await saveFaculty({
    schoolId,
    facultyId: optional(formData.get('facultyId')),
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function deleteFacultyAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'faculty:write');

  const result = await deleteFaculty({
    schoolId,
    facultyId: String(formData.get('facultyId') ?? ''),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function saveDepartmentAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  // A DEAN may create departments too — within their faculty, which is what
  // `department:write` grants them.
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR', 'DEAN');
  assertCan(role, 'department:write');

  const result = await saveDepartment({
    schoolId,
    departmentId: optional(formData.get('departmentId')),
    facultyId: String(formData.get('facultyId') ?? ''),
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function deleteDepartmentAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'department:write');

  const result = await deleteDepartment({
    schoolId,
    departmentId: String(formData.get('departmentId') ?? ''),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function saveProgrammeAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'program:write');

  const result = await saveProgramme({
    schoolId,
    programmeId: optional(formData.get('programmeId')),
    departmentId: String(formData.get('departmentId') ?? ''),
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    degreeType: String(formData.get('degreeType') ?? ''),
    creditsRequired: num(formData.get('creditsRequired')),
    durationTerms: num(formData.get('durationTerms')),
    minCgpa: num(formData.get('minCgpa')),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function setProgrammeActiveAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR');
  assertCan(role, 'program:write');

  const result = await setProgrammeActive({
    schoolId,
    programmeId: String(formData.get('programmeId') ?? ''),
    isActive: formData.get('isActive') === 'true',
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function saveCourseAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  // Heads of department and deans write courses for their own area, which is
  // how a curriculum actually gets built — the registry ratifies rather than
  // types every syllabus itself.
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR', 'DEAN', 'HOD');
  assertCan(role, 'course:write');

  const result = await saveCourse({
    schoolId,
    courseId: optional(formData.get('courseId')),
    departmentId: String(formData.get('departmentId') ?? ''),
    code: String(formData.get('code') ?? ''),
    title: String(formData.get('title') ?? ''),
    description: optional(formData.get('description')),
    creditHours: num(formData.get('creditHours')),
    level: num(formData.get('level')),
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}

export async function setCourseActiveAction(
  _prev: StructureFormState,
  formData: FormData,
): Promise<StructureFormState> {
  const { schoolId, role, session } = await requireTenantRole('ADMIN', 'REGISTRAR', 'DEAN', 'HOD');
  assertCan(role, 'course:write');

  const result = await setCourseActive({
    schoolId,
    courseId: String(formData.get('courseId') ?? ''),
    isActive: formData.get('isActive') === 'true',
    actorUserId: session.sub,
  });
  refresh();
  return { ok: result.ok, message: result.message };
}
