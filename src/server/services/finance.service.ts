import 'server-only';

import { db } from '@/lib/db';
import {
  allocatePayment,
  assessTermFees,
  buildAgeingReport,
  deriveInvoiceStatus,
  recommendFinancialHold,
  resolveFeeStructure,
  summariseAccount,
  type DiscountSpec,
} from '@/lib/domain/finance';
import { formatMoney, type Minor } from '@/lib/domain/money';
import { nextInvoiceNumber, nextReceiptNumber } from './sequence.service';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * BURSARY SERVICE
 * =============================================================================
 *
 * Invariant defended by every function here:
 *
 *     invoice.paidMinor === Σ PaymentAllocation.amountMinor for that invoice
 *
 * `paidMinor` is a cache of the allocation sum. Every write that touches it
 * happens in the same transaction as the allocation rows it summarises, and
 * `reconcileInvoices` re-derives it from scratch to detect drift.
 */

/**
 * Assess and issue a student's invoice for a term.
 *
 * Idempotent by construction: the UNIQUE constraint on (studentId, termId)
 * means a double-submit updates the existing draft rather than raising a second
 * bill. Students being billed twice for one term is the single most common —
 * and most damaging — bug in university finance systems.
 */
export async function issueTermInvoice(params: {
  studentId: string;
  termId: string;
  actorId: string;
  discounts?: DiscountSpec[];
  dueDate?: Date;
}): Promise<{ ok: boolean; message: string; invoiceId?: string }> {
  return db.$transaction(async (tx) => {
    const student = await tx.student.findUnique({
      where: { id: params.studentId },
      include: { program: true, user: true },
    });
    if (!student) return { ok: false, message: 'Student not found.' };

    const term = await tx.term.findUnique({ where: { id: params.termId } });
    if (!term) return { ok: false, message: 'Term not found.' };

    // Credit hours drive per-credit fee lines, so they must reflect the
    // student's ACTUAL registration at the moment of assessment.
    const registrations = await tx.enrollment.findMany({
      where: { studentId: params.studentId, status: 'REGISTERED', offering: { termId: params.termId } },
      include: { offering: { include: { course: { select: { creditHours: true } } } } },
    });
    const creditHours = registrations.reduce(
      (sum, r) => sum + r.offering.course.creditHours,
      0,
    );

    const structures = await tx.feeStructure.findMany({
      where: { termId: params.termId },
      include: { items: true },
    });

    const resolved = resolveFeeStructure(
      structures.map((s) => ({
        id: s.id,
        name: s.name,
        termId: s.termId,
        programId: s.programId,
        level: s.level,
        isActive: s.isActive,
      })),
      { termId: params.termId, programId: student.programId, level: student.level },
    );

    if (!resolved) {
      return {
        ok: false,
        message: `No active fee structure covers ${student.program.code} level ${student.level} in ${term.name}.`,
      };
    }

    const structure = structures.find((s) => s.id === resolved.id)!;
    const assessment = assessTermFees(structure.items, creditHours, params.discounts ?? []);

    const existing = await tx.invoice.findUnique({
      where: { studentId_termId: { studentId: params.studentId, termId: params.termId } },
    });

    const dueDate = params.dueDate ?? defaultDueDate(term.startDate);

    if (existing) {
      if (existing.paidMinor > assessment.totalMinor) {
        return {
          ok: false,
          message:
            'Reassessment would put the invoice below what has already been paid. Raise a credit note instead.',
        };
      }

      await tx.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
      await tx.invoiceLine.createMany({
        data: assessment.lines.map((l) => ({ invoiceId: existing.id, ...l })),
      });

      const status = deriveInvoiceStatus(
        {
          totalMinor: assessment.totalMinor,
          paidMinor: existing.paidMinor,
          dueDate,
          voidedAt: existing.voidedAt,
        },
        new Date(),
      );

      await tx.invoice.update({
        where: { id: existing.id },
        data: {
          subtotalMinor: assessment.subtotalMinor,
          discountMinor: assessment.discountMinor,
          totalMinor: assessment.totalMinor,
          dueDate,
          status,
        },
      });

      void recordAudit({
        actorId: params.actorId,
        action: 'invoice.reassess',
        entityType: 'Invoice',
        entityId: existing.id,
        summary: `Reassessed ${existing.invoiceNo} to ${formatMoney(assessment.totalMinor)}.`,
      });

      return {
        ok: true,
        message: `Invoice ${existing.invoiceNo} reassessed to ${formatMoney(assessment.totalMinor)}.`,
        invoiceId: existing.id,
      };
    }

    const invoiceNo = await nextInvoiceNumber(tx);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNo,
        studentId: params.studentId,
        termId: params.termId,
        subtotalMinor: assessment.subtotalMinor,
        discountMinor: assessment.discountMinor,
        totalMinor: assessment.totalMinor,
        paidMinor: 0,
        dueDate,
        status: 'ISSUED',
        lines: { create: assessment.lines },
      },
    });

    void recordAudit({
      actorId: params.actorId,
      action: 'invoice.issue',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Issued ${invoiceNo} to ${student.matricNumber} for ${formatMoney(assessment.totalMinor)}.`,
    });

    return {
      ok: true,
      message: `Invoice ${invoiceNo} issued for ${formatMoney(assessment.totalMinor)}.`,
      invoiceId: invoice.id,
    };
  });
}

/** Fees fall due four weeks after the term begins. */
function defaultDueDate(termStart: Date): Date {
  const due = new Date(termStart.getTime());
  due.setDate(due.getDate() + 28);
  return due;
}

/**
 * Record a payment and allocate it across open invoices, oldest due first.
 *
 * `externalRef` carries a UNIQUE constraint, which makes this endpoint safe to
 * expose to a payment-provider webhook: a retried callback hits the constraint
 * and is reported as already-processed rather than crediting the student twice.
 */
export async function recordPayment(params: {
  studentId: string;
  amountMinor: Minor;
  method: string;
  externalRef?: string | null;
  note?: string | null;
  actorId: string;
  receivedAt?: Date;
}): Promise<{ ok: boolean; message: string; receiptNo?: string }> {
  if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) {
    return { ok: false, message: 'Payment amount must be a positive whole number of kobo.' };
  }

  try {
    return await db.$transaction(async (tx) => {
      if (params.externalRef) {
        const seen = await tx.payment.findUnique({ where: { externalRef: params.externalRef } });
        if (seen) {
          return {
            ok: true,
            message: `Payment ${seen.receiptNo} was already recorded for this reference.`,
            receiptNo: seen.receiptNo,
          };
        }
      }

      const openInvoices = await tx.invoice.findMany({
        where: {
          studentId: params.studentId,
          voidedAt: null,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        select: {
          id: true,
          invoiceNo: true,
          dueDate: true,
          issuedAt: true,
          totalMinor: true,
          paidMinor: true,
          voidedAt: true,
        },
      });

      const { allocations, unappliedMinor } = allocatePayment(
        params.amountMinor,
        openInvoices.map((i) => ({
          invoiceId: i.id,
          invoiceNo: i.invoiceNo,
          dueDate: i.dueDate,
          issuedAt: i.issuedAt,
          totalMinor: i.totalMinor,
          paidMinor: i.paidMinor,
        })),
      );

      const receiptNo = await nextReceiptNumber(tx);
      const payment = await tx.payment.create({
        data: {
          receiptNo,
          studentId: params.studentId,
          amountMinor: params.amountMinor,
          method: params.method,
          status: 'CONFIRMED',
          externalRef: params.externalRef ?? null,
          note: params.note ?? null,
          unappliedMinor,
          receivedAt: params.receivedAt ?? new Date(),
          recordedBy: params.actorId,
          allocations: { create: allocations },
        },
      });

      // Update each touched invoice's cached paid total and derived status.
      const now = new Date();
      for (const alloc of allocations) {
        const invoice = openInvoices.find((i) => i.id === alloc.invoiceId)!;
        const paidMinor = invoice.paidMinor + alloc.amountMinor;
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: {
            paidMinor,
            status: deriveInvoiceStatus(
              { totalMinor: invoice.totalMinor, paidMinor, dueDate: invoice.dueDate, voidedAt: null },
              now,
            ),
          },
        });
      }

      // A settled account releases its financial hold automatically. Releasing
      // is safe to automate; placing one is not, and is left to an officer.
      const remaining = await tx.invoice.findMany({
        where: { studentId: params.studentId, voidedAt: null },
        select: { totalMinor: true, paidMinor: true, dueDate: true, voidedAt: true },
      });
      const summary = summariseAccount(remaining, 0, now);

      if (summary.outstandingMinor === 0) {
        await tx.hold.updateMany({
          where: { studentId: params.studentId, kind: 'FINANCIAL', releasedAt: null },
          data: { releasedAt: now, releasedBy: params.actorId },
        });
      }

      void recordAudit({
        actorId: params.actorId,
        action: 'payment.record',
        entityType: 'Payment',
        entityId: payment.id,
        summary: `${receiptNo}: ${formatMoney(params.amountMinor)} via ${params.method}, allocated across ${allocations.length} invoice(s).`,
        metadata: { allocations, unappliedMinor },
      });

      const creditNote =
        unappliedMinor > 0
          ? ` ${formatMoney(unappliedMinor)} held as credit against future invoices.`
          : '';

      return {
        ok: true,
        message: `Receipt ${receiptNo} recorded for ${formatMoney(params.amountMinor)}.${creditNote}`,
        receiptNo,
      };
    });
  } catch (error) {
    console.error('[finance] payment failed', error);
    return { ok: false, message: 'The payment could not be recorded. No money has been applied.' };
  }
}

/** Everything the student-facing finance page needs, in one round trip. */
export async function getStudentAccount(studentId: string) {
  const now = new Date();

  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      where: { studentId },
      include: { lines: true, term: true },
      orderBy: { issuedAt: 'desc' },
    }),
    db.payment.findMany({
      where: { studentId },
      include: { allocations: { include: { invoice: { select: { invoiceNo: true } } } } },
      orderBy: { receivedAt: 'desc' },
    }),
  ]);

  const unappliedCredit = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.unappliedMinor, 0);

  return {
    invoices,
    payments,
    summary: summariseAccount(invoices, unappliedCredit, now),
    holdRecommendation: recommendFinancialHold(invoices, now),
  };
}

/** Institution-wide receivables position for the bursary dashboard. */
export async function getReceivablesPosition() {
  const now = new Date();
  const invoices = await db.invoice.findMany({
    select: { totalMinor: true, paidMinor: true, dueDate: true, voidedAt: true },
  });

  const billed = invoices.reduce((s, i) => (i.voidedAt ? s : s + i.totalMinor), 0);
  const collected = invoices.reduce((s, i) => (i.voidedAt ? s : s + i.paidMinor), 0);

  return {
    ageing: buildAgeingReport(invoices, now),
    billedMinor: billed,
    collectedMinor: collected,
    outstandingMinor: billed - collected,
    collectionRate: billed === 0 ? 0 : (collected / billed) * 100,
    invoiceCount: invoices.length,
  };
}

/**
 * Re-derive every invoice's `paidMinor` from its allocation rows and report any
 * that had drifted. Run this on a schedule; a non-empty result is a bug, not a
 * routine correction, and should page someone.
 */
export async function reconcileInvoices(): Promise<{ repaired: string[] }> {
  const invoices = await db.invoice.findMany({
    include: { allocations: { select: { amountMinor: true } } },
  });

  const repaired: string[] = [];
  const now = new Date();

  for (const invoice of invoices) {
    const actual = invoice.allocations.reduce((s, a) => s + a.amountMinor, 0);
    if (actual === invoice.paidMinor) continue;

    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor: actual,
        status: deriveInvoiceStatus(
          {
            totalMinor: invoice.totalMinor,
            paidMinor: actual,
            dueDate: invoice.dueDate,
            voidedAt: invoice.voidedAt,
          },
          now,
        ),
      },
    });
    repaired.push(invoice.invoiceNo);
  }

  return { repaired };
}

/**
 * Refresh ISSUED/PARTIALLY_PAID invoices that have passed their due date.
 * Status is derived, so this only materialises the passage of time; nothing
 * here can change an amount.
 */
export async function markOverdueInvoices(): Promise<{ updated: number }> {
  const now = new Date();
  const result = await db.invoice.updateMany({
    where: {
      voidedAt: null,
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      dueDate: { lt: now },
    },
    data: { status: 'OVERDUE' },
  });
  return { updated: result.count };
}
