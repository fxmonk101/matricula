import 'server-only';

import { dbFor } from '@/lib/tenant';
import {
  allocatePayment,
  assessTermFees,
  buildAgeingReport,
  deriveInvoiceStatus,
  invoiceNotice,
  recommendFinancialHold,
  resolveFeeStructure,
  summariseAccount,
  type DiscountSpec,
} from '@/lib/domain/finance';
import { makeMoney, type Minor } from '@/lib/domain/money';
import { holdPlacedNotice, holdReleasedNotice } from '@/lib/domain/enrollment';
import { formatDate } from '@/lib/utils';
import { loadSchoolConfig } from '@/server/school-config';
import { nextInvoiceNumber, nextReceiptNumber } from './sequence.service';
import { recordAudit } from './audit.service';
import { notifyStudents } from './notification.service';

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
  schoolId: string;
  schoolCode: string;
  studentId: string;
  termId: string;
  actorId: string;
  discounts?: DiscountSpec[];
  dueDate?: Date;
}): Promise<{ ok: boolean; message: string; invoiceId?: string }> {
  const db = dbFor(params.schoolId);
  // Amounts quoted back to the user must be in THIS school's currency —
  // a Ghanaian bursar should never be shown a Naira sign.
  const { format: formatMoney } = makeMoney(
    (await loadSchoolConfig(params.schoolId)).finance.currency,
  );

  /*
   * What to tell the student, decided inside the transaction and SENT after
   * it commits. Sending from inside would announce a bill that a later
   * failure rolls back — and on SQLite the notification's own write would
   * wait on this transaction's lock.
   */
  let notice: { studentId: string; title: string; body: string; invoiceId: string } | null = null;

  const result = await db.$transaction(async (tx) => {
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
        data: assessment.lines.map((l) => ({ schoolId: params.schoolId, invoiceId: existing.id, ...l })),
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

      const reassessed = invoiceNotice(
        {
          invoiceNo: existing.invoiceNo,
          termName: term.name,
          total: formatMoney(assessment.totalMinor),
          balance: formatMoney(assessment.totalMinor - existing.paidMinor),
          dueOn: formatDate(dueDate),
          settled: assessment.totalMinor - existing.paidMinor === 0,
          previousTotal:
            existing.totalMinor === assessment.totalMinor ? null : formatMoney(existing.totalMinor),
        },
        'REASSESSED',
      );
      if (reassessed) notice = { studentId: student.id, invoiceId: existing.id, ...reassessed };

      void recordAudit({
        schoolId: params.schoolId,
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

    const invoiceNo = await nextInvoiceNumber(tx, params.schoolCode);
    const invoice = await tx.invoice.create({
      data: {
        schoolId: params.schoolId,
        invoiceNo,
        studentId: params.studentId,
        termId: params.termId,
        subtotalMinor: assessment.subtotalMinor,
        discountMinor: assessment.discountMinor,
        totalMinor: assessment.totalMinor,
        paidMinor: 0,
        dueDate,
        status: 'ISSUED',
        // Nested writes are not scoped by the tenant extension — stamp explicitly.
        lines: { create: assessment.lines.map((l) => ({ ...l, schoolId: params.schoolId })) },
      },
    });

    const issued = invoiceNotice(
      {
        invoiceNo,
        termName: term.name,
        total: formatMoney(assessment.totalMinor),
        balance: formatMoney(assessment.totalMinor),
        dueOn: formatDate(dueDate),
        settled: assessment.totalMinor === 0,
      },
      'ISSUED',
    );
    // A bill a full scholarship brought to zero is not a demand for money.
    if (issued && assessment.totalMinor > 0) {
      notice = { studentId: student.id, invoiceId: invoice.id, ...issued };
    }

    void recordAudit({
      schoolId: params.schoolId,
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

  if (result.ok && notice) await tellStudent(params.schoolId, notice);
  return result;
}

async function tellStudent(
  schoolId: string,
  notice: { studentId: string; title: string; body: string; invoiceId: string },
): Promise<void> {
  void notifyStudents(schoolId, [notice.studentId], {
    kind: 'INVOICE_ISSUED',
    title: notice.title,
    body: notice.body,
    href: '/me/finance',
    subjectType: 'Invoice',
    subjectId: notice.invoiceId,
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
  schoolId: string;
  schoolCode: string;
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

  const db = dbFor(params.schoolId);
  const config = await loadSchoolConfig(params.schoolId);
  const { format: formatMoney } = makeMoney(config.finance.currency);

  // Set inside the transaction, announced after it commits.
  let releasedFinancialHold = false;

  try {
    const outcome = await db.$transaction(async (tx) => {
      if (params.externalRef) {
        // externalRef is unique PER SCHOOL now, so this is a scoped findFirst
        // rather than a findUnique on a globally unique column.
        const seen = await tx.payment.findFirst({ where: { externalRef: params.externalRef } });
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

      const receiptNo = await nextReceiptNumber(tx, params.schoolCode);
      const payment = await tx.payment.create({
        data: {
          schoolId: params.schoolId,
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
          allocations: { create: allocations.map((a) => ({ ...a, schoolId: params.schoolId })) },
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
        const released = await tx.hold.updateMany({
          where: { studentId: params.studentId, kind: 'FINANCIAL', releasedAt: null },
          data: { releasedAt: now, releasedBy: params.actorId },
        });
        releasedFinancialHold = released.count > 0;
      }

      void recordAudit({
        schoolId: params.schoolId,
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

    /*
     * The automatic release is the one a student most needs to hear about:
     * nobody told them it was coming, and paying the bill was the thing they
     * were told would let them register.
     */
    if (releasedFinancialHold) await announceHoldReleased(params.schoolId, params.studentId, 'FINANCIAL');
    return outcome;
  } catch (error) {
    console.error('[finance] payment failed', error);
    return { ok: false, message: 'The payment could not be recorded. No money has been applied.' };
  }
}

/**
 * Tell a student a hold now stands between them and registration.
 *
 * Called by whoever placed it, after the write. Never throws: the hold is the
 * point and is already in force.
 */
export async function announceHoldPlaced(
  schoolId: string,
  hold: { id: string; studentId: string; kind: string; reason: string },
): Promise<void> {
  try {
    await notifyStudents(schoolId, [hold.studentId], {
      kind: 'HOLD_PLACED',
      ...holdPlacedNotice(hold.kind, hold.reason),
      href: '/me/registration',
      subjectType: 'Hold',
      subjectId: hold.id,
    });
  } catch (error) {
    console.error('[finance] hold notice failed', error);
  }
}

/**
 * Tell a student a hold has been lifted — and, truthfully, whether anything
 * else still blocks them. Reads the remaining holds AFTER the release commits,
 * so the release itself is never counted as still in force.
 */
export async function announceHoldReleased(
  schoolId: string,
  studentId: string,
  kind: string,
): Promise<void> {
  try {
    const remaining = await dbFor(schoolId).hold.findMany({
      where: { studentId, releasedAt: null, blocksRegistration: true },
      select: { kind: true },
    });
    const message = holdReleasedNotice(kind, remaining.map((h) => h.kind));
    await notifyStudents(schoolId, [studentId], {
      kind: 'HOLD_RELEASED',
      ...message,
      href: '/me/registration',
      subjectType: 'Student',
      subjectId: studentId,
    });
  } catch (error) {
    console.error('[finance] hold release notice failed', error);
  }
}

/** Everything the student-facing finance page needs, in one round trip. */
export async function getStudentAccount(schoolId: string, studentId: string) {
  const db = dbFor(schoolId);
  const { finance } = await loadSchoolConfig(schoolId);
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
    holdRecommendation: recommendFinancialHold(invoices, now, finance.holdPolicy),
  };
}

/** Institution-wide receivables position for the bursary dashboard. */
export async function getReceivablesPosition(schoolId: string) {
  const db = dbFor(schoolId);
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
export async function reconcileInvoices(schoolId: string): Promise<{ repaired: string[] }> {
  const db = dbFor(schoolId);
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
export async function markOverdueInvoices(schoolId: string): Promise<{ updated: number }> {
  const db = dbFor(schoolId);
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
