import { dbFor } from '@/lib/tenant';
import { loadSchoolConfig } from '@/server/school-config';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * FEE STRUCTURES
 * =============================================================================
 *
 * What a student is charged, per term, and to whom it applies.
 *
 * A structure is scoped by (term, programme?, level?). Both narrowing fields
 * are nullable, and null means "all" — so a school can publish one schedule for
 * the whole institution, then override it for the medical school, then override
 * that again for its first years. `resolveFeeStructure` in the finance domain
 * picks the most specific match; this service only has to make the set of
 * structures coherent.
 *
 * MONEY IS ENTERED IN MAJOR UNITS AND STORED IN MINOR ONES. A bursar types
 * 450,000 and the database holds 45000000 kobo. The conversion happens once,
 * here, against the school's own currency — the exponent is 2 for naira and
 * cedis and 0 for a zero-decimal currency, and getting it from the wrong place
 * inflates every fee in the institution by a hundred.
 */

export interface FeeResult {
  ok: boolean;
  message: string;
  id?: string;
}

export interface FeeItemDraft {
  code: string;
  description: string;
  /** MAJOR units, as typed. Converted here. */
  amount: number;
  perCreditHour: boolean;
  isMandatory: boolean;
}

/** The charges a university actually raises, offered so codes stay consistent. */
export const FEE_CODES = [
  'TUITION',
  'ACCEPTANCE',
  'REGISTRATION',
  'LAB',
  'LIBRARY',
  'ACCOMMODATION',
  'MEDICAL',
  'SPORTS',
  'EXAMINATION',
  'ID_CARD',
  'CAUTION',
  'DEVELOPMENT',
  'OTHER',
] as const;

export function validateFeeItem(item: FeeItemDraft): string[] {
  const problems: string[] = [];
  if (!item.code.trim()) problems.push('Every fee line needs a code.');
  if (!item.description.trim()) problems.push('Every fee line needs a description.');
  if (!Number.isFinite(item.amount) || item.amount < 0) {
    problems.push('Every fee line needs an amount of zero or more.');
  }
  // A ten-million-unit line is a slipped decimal point, not a fee.
  if (item.amount > 100_000_000) problems.push('That amount is implausibly large.');
  return problems;
}

export async function saveFeeStructure(params: {
  schoolId: string;
  structureId?: string | null;
  name: string;
  termId: string;
  /** Null means every programme. */
  programId?: string | null;
  /** Null means every level. */
  level?: number | null;
  items: FeeItemDraft[];
  actorUserId: string;
}): Promise<FeeResult> {
  const db = dbFor(params.schoolId);

  if (params.name.trim().length < 2) {
    return { ok: false, message: 'Give the fee schedule a name.' };
  }
  if (params.items.length === 0) {
    // A structure with no lines resolves to a zero invoice, which looks like a
    // student who owes nothing rather than like a schedule nobody filled in.
    return { ok: false, message: 'Add at least one fee line.' };
  }

  const itemProblems = params.items.flatMap(validateFeeItem);
  if (itemProblems.length > 0) {
    return { ok: false, message: [...new Set(itemProblems)].join(' ') };
  }

  // Both parents re-read through the TENANT client: `connect: { id }` is not
  // validated against the tenant, so a crafted id would otherwise attach this
  // schedule to another university's term or programme.
  const term = await db.term.findUnique({ where: { id: params.termId } });
  if (!term) return { ok: false, message: 'Choose a term from this school.' };

  if (params.programId) {
    const programme = await db.program.findUnique({ where: { id: params.programId } });
    if (!programme) return { ok: false, message: 'Choose a programme from this school.' };
  }

  // The exponent comes from the SCHOOL's currency, never a constant. A
  // zero-decimal currency multiplied by 100 inflates every fee a hundredfold.
  const { finance } = await loadSchoolConfig(params.schoolId);
  const perMajor = 10 ** finance.currency.exponent;
  const toMinor = (amount: number) => Math.round(amount * perMajor);

  try {
    const structure = await db.$transaction(async (tx) => {
      const saved = params.structureId
        ? await tx.feeStructure.update({
            where: { id: params.structureId },
            data: {
              name: params.name.trim(),
              termId: term.id,
              programId: params.programId ?? null,
              level: params.level ?? null,
            },
          })
        : await tx.feeStructure.create({
            data: {
              schoolId: params.schoolId,
              name: params.name.trim(),
              termId: term.id,
              programId: params.programId ?? null,
              level: params.level ?? null,
            },
          });

      /*
       * Lines are REPLACED wholesale rather than diffed.
       *
       * Diffing would need a stable identity per line that the form does not
       * have, and the failure mode of getting it wrong — a line silently
       * duplicated or dropped — is a wrong invoice. Replacing is unambiguous,
       * and an invoice already raised copied its amounts at the time, so no
       * existing bill changes underneath a student.
       */
      await tx.feeItem.deleteMany({ where: { feeStructureId: saved.id } });
      await tx.feeItem.createMany({
        data: params.items.map((item) => ({
          schoolId: params.schoolId,
          feeStructureId: saved.id,
          code: item.code.trim().toUpperCase(),
          description: item.description.trim(),
          amountMinor: toMinor(item.amount),
          perCreditHour: item.perCreditHour,
          isMandatory: item.isMandatory,
        })),
      });

      return saved;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: params.structureId ? 'fees.structure.update' : 'fees.structure.create',
      entityType: 'FeeStructure',
      entityId: structure.id,
      summary: `Fee schedule "${params.name.trim()}" for ${term.code} with ${params.items.length} line${params.items.length === 1 ? '' : 's'}.`,
    });

    return {
      ok: true,
      message: `${params.name.trim()} saved.`,
      id: structure.id,
    };
  } catch (error) {
    console.error('[fees] save failed', error);
    return { ok: false, message: 'Could not save that fee schedule.' };
  }
}

export async function setFeeStructureActive(params: {
  schoolId: string;
  structureId: string;
  isActive: boolean;
  actorUserId: string;
}): Promise<FeeResult> {
  const db = dbFor(params.schoolId);
  const structure = await db.feeStructure.findUnique({ where: { id: params.structureId } });
  if (!structure) return { ok: false, message: 'That fee schedule is not part of this school.' };

  await db.feeStructure.update({
    where: { id: structure.id },
    data: { isActive: params.isActive },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.isActive ? 'fees.structure.restore' : 'fees.structure.archive',
    entityType: 'FeeStructure',
    entityId: structure.id,
    summary: `Fee schedule "${structure.name}" ${params.isActive ? 'reinstated' : 'withdrawn'}.`,
  });

  return {
    ok: true,
    message: params.isActive
      ? `${structure.name} is in use again.`
      : `${structure.name} withdrawn. Invoices already raised from it are unchanged.`,
  };
}

export async function deleteFeeStructure(params: {
  schoolId: string;
  structureId: string;
  actorUserId: string;
}): Promise<FeeResult> {
  const db = dbFor(params.schoolId);
  const structure = await db.feeStructure.findUnique({ where: { id: params.structureId } });
  if (!structure) return { ok: false, message: 'That fee schedule is not part of this school.' };

  await db.feeStructure.delete({ where: { id: structure.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'fees.structure.delete',
    entityType: 'FeeStructure',
    entityId: structure.id,
    summary: `Fee schedule "${structure.name}" deleted.`,
  });
  return { ok: true, message: `${structure.name} deleted.` };
}

/** Every schedule, with its lines and what it applies to. */
export async function listFeeStructures(schoolId: string) {
  const db = dbFor(schoolId);
  return db.feeStructure.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    include: {
      items: { orderBy: { code: 'asc' } },
      term: { select: { id: true, code: true, name: true, isCurrent: true } },
      program: { select: { id: true, code: true, name: true } },
    },
  });
}
