'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantRole } from '@/server/tenant-context';
import { assertCan } from '@/lib/auth/rbac';
import { RESOURCE_KINDS, type ResourceKind } from '@/lib/domain/library';
import { archiveResource, saveResource } from '@/server/services/library.service';

export interface LibraryFormState {
  ok?: boolean;
  message?: string;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function saveResourceAction(
  _prev: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const { schoolId, role, session, membershipId } = await requireTenantRole(
    'LIBRARIAN',
    'ADMIN',
    'REGISTRAR',
  );
  assertCan(role, 'library:manage');

  const kind = String(formData.get('kind') ?? 'DOCUMENT');
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) {
    return { ok: false, message: 'Choose a valid format.' };
  }

  // Levels arrive as a comma list; anything unparseable is dropped rather than
  // becoming NaN, which would silently target nobody.
  const levels = String(formData.get('levels') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const result = await saveResource({
    schoolId,
    resourceId: String(formData.get('resourceId') ?? '') || null,
    title: String(formData.get('title') ?? ''),
    authors: String(formData.get('authors') ?? ''),
    description: String(formData.get('description') ?? ''),
    kind: kind as ResourceKind,
    url: String(formData.get('url') ?? ''),
    publisher: String(formData.get('publisher') ?? ''),
    isbn: String(formData.get('isbn') ?? ''),
    language: String(formData.get('language') ?? 'en'),
    pageCount: numberOrNull(formData.get('pageCount')),
    durationMin: numberOrNull(formData.get('durationMin')),
    tags: String(formData.get('tags') ?? ''),
    audience: (String(formData.get('audience') ?? 'ALL') as 'ALL' | 'STAFF' | 'STUDENT'),
    programIds: formData.getAll('programIds').map(String).filter(Boolean),
    yearGroupIds: [],
    levels,
    publish: formData.get('publish') === 'true',
    actorMembershipId: membershipId,
    actorUserId: session.sub,
  });

  revalidatePath('/library');
  revalidatePath('/library/manage');
  return result;
}

export async function archiveResourceAction(
  _prev: LibraryFormState,
  formData: FormData,
): Promise<LibraryFormState> {
  const { schoolId, role, session } = await requireTenantRole('LIBRARIAN', 'ADMIN', 'REGISTRAR');
  assertCan(role, 'library:manage');

  const result = await archiveResource({
    schoolId,
    resourceId: String(formData.get('resourceId') ?? ''),
    actorUserId: session.sub,
  });

  revalidatePath('/library');
  revalidatePath('/library/manage');
  return result;
}
