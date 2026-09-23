'use server';

import { revalidatePath } from 'next/cache';

import { assertCan } from '@/lib/auth/rbac';
import type { ImportKind, ImportPlan } from '@/lib/domain/import';
import { requireTenantRole } from '@/server/tenant-context';
import {
  planImport,
  runImport,
  schoolCodeOf,
  type ImportResult,
} from '@/server/services/import.service';

/**
 * Previewing and running an import.
 *
 * THE FILE IS POSTED TWICE, deliberately. The preview does not stash it
 * anywhere; the browser keeps it and sends it again to confirm, and the server
 * re-reads and re-plans from scratch.
 *
 * That costs one extra pass over a file somebody is already waiting on, and it
 * buys two things worth more than the pass. A plan posted back from a browser
 * is user input — it could name any programme id at any school — so trusting it
 * would mean re-validating it anyway. And the world moves between the two
 * clicks: a registrar may have created one of those people by hand while the
 * preview was on screen, and only a fresh plan notices.
 */

export interface ImportFormState {
  ok?: boolean;
  message?: string;
  plan?: ImportPlan;
  result?: ImportResult;
}

const IMPORT_ROLES = ['OWNER', 'ADMIN', 'REGISTRAR'] as const;

function kindOf(formData: FormData): ImportKind {
  return formData.get('kind') === 'STAFF' ? 'STAFF' : 'STUDENT';
}

function textOf(formData: FormData): string {
  return String(formData.get('text') ?? '');
}

export async function previewImportAction(
  _previous: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireTenantRole(...IMPORT_ROLES);
  assertCan(ctx.role, 'user:create');

  const text = textOf(formData);
  if (!text.trim()) return { ok: false, message: 'Choose a file first.' };

  const outcome = await planImport({
    schoolId: ctx.schoolId,
    kind: kindOf(formData),
    text,
    actorRole: ctx.role,
  });

  if (!outcome.ok || !outcome.plan) {
    return { ok: false, message: outcome.message ?? 'That file could not be read.' };
  }

  return { ok: true, plan: outcome.plan };
}

export async function runImportAction(
  _previous: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireTenantRole(...IMPORT_ROLES);
  assertCan(ctx.role, 'user:create');

  const text = textOf(formData);
  if (!text.trim()) return { ok: false, message: 'Choose a file first.' };

  const result = await runImport({
    schoolId: ctx.schoolId,
    schoolCode: await schoolCodeOf(ctx.schoolId),
    kind: kindOf(formData),
    text,
    actorRole: ctx.role,
    actorMembershipId: ctx.membershipId,
    actorUserId: ctx.session.sub,
  });

  if (result.created > 0) {
    revalidatePath('/people');
    revalidatePath('/students');
  }

  return { ok: result.ok, message: result.message, result };
}
