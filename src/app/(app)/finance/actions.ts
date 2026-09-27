'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantRole } from '@/server/tenant-context';
import {
  announceHoldPlaced,
  announceHoldReleased,
  issueTermInvoice,
  recordPayment,
} from '@/server/services/finance.service';
import { toMinor } from '@/lib/domain/money';
import { recordAudit } from '@/server/services/audit.service';

export interface FinanceState {
  ok?: boolean;
  message?: string;
}

const paymentSchema = z.object({
  studentId: z.string().min(1, 'Choose a student.'),
  // Captured in MAJOR units because that is what a cashier types, then
  // converted once, here at the boundary. Everything downstream is minor units.
  amount: z.coerce.number().positive('Amount must be greater than zero.').max(1_000_000_000),
  method: z.enum(['CARD', 'BANK_TRANSFER', 'CASH', 'CHEQUE', 'SCHOLARSHIP', 'WAIVER']),
  externalRef: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function recordPaymentAction(
  _prev: FinanceState,
  formData: FormData,
): Promise<FinanceState> {
  const { db, school, schoolId, session } = await requireTenantRole('ADMIN', 'FINANCE');

  const parsed = paymentSchema.safeParse({
    studentId: formData.get('studentId'),
    amount: formData.get('amount'),
    method: formData.get('method'),
    externalRef: formData.get('externalRef') ?? undefined,
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid payment details.' };
  }

  const result = await recordPayment({
    schoolId,
    schoolCode: school.code,
    studentId: parsed.data.studentId,
    amountMinor: toMinor(parsed.data.amount),
    method: parsed.data.method,
    externalRef: parsed.data.externalRef || null,
    note: parsed.data.note || null,
    actorId: session.sub,
  });

  revalidatePath('/finance');
  revalidatePath(`/students/${parsed.data.studentId}`);

  return result;
}

const invoiceSchema = z.object({
  studentId: z.string().min(1, 'Choose a student.'),
  termId: z.string().min(1, 'Choose a term.'),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
});

export async function issueInvoiceAction(
  _prev: FinanceState,
  formData: FormData,
): Promise<FinanceState> {
  const { db, school, schoolId, session } = await requireTenantRole('ADMIN', 'FINANCE');

  const parsed = invoiceSchema.safeParse({
    studentId: formData.get('studentId'),
    termId: formData.get('termId'),
    discountPercent: formData.get('discountPercent') || 0,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid invoice details.' };
  }

  const discountPercent = parsed.data.discountPercent ?? 0;

  const result = await issueTermInvoice({
    schoolId,
    schoolCode: school.code,
    studentId: parsed.data.studentId,
    termId: parsed.data.termId,
    actorId: session.sub,
    discounts:
      discountPercent > 0
        ? [{ code: 'AWARD', description: 'Institutional award', percent: discountPercent }]
        : [],
  });

  revalidatePath('/finance');
  revalidatePath(`/students/${parsed.data.studentId}`);

  return result;
}

const holdSchema = z.object({
  studentId: z.string().min(1),
  kind: z.enum(['FINANCIAL', 'ACADEMIC', 'DISCIPLINARY', 'DOCUMENTATION', 'HEALTH']),
  reason: z.string().trim().min(3, 'Give a reason.').max(300),
});

/**
 * Place a hold. Never automated — a hold blocks a student from registering, so
 * it is always attributable to a named officer with a stated reason.
 */
export async function placeHoldAction(
  _prev: FinanceState,
  formData: FormData,
): Promise<FinanceState> {
  const { db, schoolId, session } = await requireTenantRole('ADMIN', 'FINANCE', 'REGISTRAR');

  const parsed = holdSchema.safeParse({
    studentId: formData.get('studentId'),
    kind: formData.get('kind'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid hold.' };
  }

  const existing = await db.hold.findFirst({
    where: { studentId: parsed.data.studentId, kind: parsed.data.kind, releasedAt: null },
  });
  if (existing) {
    return { ok: false, message: `An active ${parsed.data.kind} hold already exists.` };
  }

  const hold = await db.hold.create({
    data: {
      schoolId,
      studentId: parsed.data.studentId,
      kind: parsed.data.kind,
      reason: parsed.data.reason,
      blocksRegistration: true,
      placedBy: session.sub,
    },
  });

  void recordAudit({
    schoolId,
    actorId: session.sub,
    action: 'hold.place',
    entityType: 'Hold',
    entityId: hold.id,
    summary: `${parsed.data.kind} hold placed: ${parsed.data.reason}`,
  });

  await announceHoldPlaced(schoolId, hold);

  revalidatePath('/finance');
  revalidatePath(`/students/${parsed.data.studentId}`);

  return { ok: true, message: 'Hold placed. The student cannot register until it is released.' };
}

export async function releaseHoldAction(
  _prev: FinanceState,
  formData: FormData,
): Promise<FinanceState> {
  const { db, schoolId, session } = await requireTenantRole('ADMIN', 'FINANCE', 'REGISTRAR');
  const holdId = String(formData.get('holdId') ?? '');
  if (!holdId) return { ok: false, message: 'No hold specified.' };

  const hold = await db.hold.findUnique({ where: { id: holdId } });
  if (!hold) return { ok: false, message: 'Hold not found.' };
  if (hold.releasedAt) return { ok: false, message: 'That hold is already released.' };

  await db.hold.update({
    where: { id: holdId },
    data: { releasedAt: new Date(), releasedBy: session.sub },
  });

  void recordAudit({
    schoolId,
    actorId: session.sub,
    action: 'hold.release',
    entityType: 'Hold',
    entityId: holdId,
    summary: `${hold.kind} hold released.`,
  });

  await announceHoldReleased(schoolId, hold.studentId, hold.kind);

  revalidatePath('/finance');
  revalidatePath(`/students/${hold.studentId}`);

  return { ok: true, message: 'Hold released.' };
}
