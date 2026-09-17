/**
 * =============================================================================
 * FEE ASSESSMENT, PAYMENT ALLOCATION & RECEIVABLES ENGINE
 * =============================================================================
 *
 * Pure domain logic. All amounts are integer minor units (see ./money).
 *
 * The invariant this module exists to protect:
 *
 *     For every invoice:  totalMinor = subtotalMinor − discountMinor
 *                         paidMinor  = Σ allocations(invoice)
 *                         balance    = totalMinor − paidMinor ≥ 0
 *
 * Every function below either preserves that invariant or refuses to act.
 */

import { assertMinor, sumMinor, type Minor } from './money';
import type { InvoiceStatus } from './enums';
import { DEFAULT_FINANCE_CONFIG, type FinanceConfig } from './config';

export type { FinanceConfig };

export class FinanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceError';
  }
}

// -----------------------------------------------------------------------------
// Fee structure resolution
// -----------------------------------------------------------------------------

export interface FeeStructureCandidate {
  id: string;
  name: string;
  termId: string;
  programId: string | null;
  level: number | null;
  isActive: boolean;
}

/**
 * ALGORITHM: MOST-SPECIFIC FEE STRUCTURE RESOLUTION
 * ------------------------------------------------
 * Fee structures form an overlapping hierarchy: an institution-wide default, a
 * per-program override, a per-level override, and a per-program-per-level
 * override. Exactly one must win, deterministically.
 *
 * Specificity is scored as a bitmask, so ties are impossible:
 *
 *     programId matches  -> +2
 *     level     matches  -> +1
 *
 *   score 3 : program AND level specified      (most specific)
 *   score 2 : program only
 *   score 1 : level only
 *   score 0 : institution-wide default
 *
 * A candidate whose programId is set but does NOT match is not applicable at
 * all and is discarded — it is not a weaker match, it is the wrong price list.
 *
 * Complexity: O(n) over candidates for the term.
 */
export function resolveFeeStructure(
  candidates: readonly FeeStructureCandidate[],
  context: { termId: string; programId: string; level: number },
): FeeStructureCandidate | null {
  let best: FeeStructureCandidate | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    if (!c.isActive) continue;
    if (c.termId !== context.termId) continue;
    if (c.programId !== null && c.programId !== context.programId) continue;
    if (c.level !== null && c.level !== context.level) continue;

    const score = (c.programId !== null ? 2 : 0) + (c.level !== null ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

// -----------------------------------------------------------------------------
// Invoice assessment
// -----------------------------------------------------------------------------

export interface FeeItemSpec {
  code: string;
  description: string;
  amountMinor: Minor;
  perCreditHour: boolean;
  isMandatory: boolean;
}

export interface DiscountSpec {
  code: string;
  description: string;
  /** Either a flat amount or a percentage of the assessed subtotal, not both. */
  flatMinor?: Minor;
  percent?: number;
}

export interface AssessedLine {
  code: string;
  description: string;
  quantity: number;
  unitAmountMinor: Minor;
  amountMinor: Minor;
}

export interface AssessmentResult {
  lines: AssessedLine[];
  subtotalMinor: Minor;
  discountMinor: Minor;
  totalMinor: Minor;
}

/**
 * ALGORITHM: TERM FEE ASSESSMENT
 * ------------------------------
 *   1. Expand each fee item into a line:
 *        perCreditHour -> quantity = registeredCreditHours
 *        otherwise     -> quantity = 1
 *      amount = quantity · unitAmount   (integer multiply, no rounding needed)
 *
 *   2. subtotal = Σ line amounts
 *
 *   3. Apply discounts against the subtotal. Percentage discounts are computed
 *      against the ORIGINAL subtotal, never sequentially — stacking two 10%
 *      discounts must yield 20%, not 19%. Sequential application is a common
 *      and hard-to-spot bug that quietly overcharges.
 *
 *   4. Clamp the total discount to the subtotal. A discount can zero a bill;
 *      it can never make the institution owe the student money. Credit balances
 *      arise from overpayment, and are modelled there — not here.
 *
 * Complexity: O(items + discounts).
 */
export function assessTermFees(
  items: readonly FeeItemSpec[],
  registeredCreditHours: number,
  discounts: readonly DiscountSpec[] = [],
): AssessmentResult {
  if (registeredCreditHours < 0) {
    throw new FinanceError('Registered credit hours cannot be negative.');
  }

  const lines: AssessedLine[] = items
    .filter((item) => item.isMandatory || item.amountMinor > 0)
    .map((item) => {
      assertMinor(item.amountMinor, `fee item ${item.code}`);
      const quantity = item.perCreditHour ? registeredCreditHours : 1;
      return {
        code: item.code,
        description: item.perCreditHour
          ? `${item.description} (${quantity} credit hours)`
          : item.description,
        quantity,
        unitAmountMinor: item.amountMinor,
        amountMinor: item.amountMinor * quantity,
      };
    })
    .filter((line) => line.amountMinor !== 0 || line.quantity > 0);

  const subtotalMinor = sumMinor(lines.map((l) => l.amountMinor));

  let discountMinor = 0;
  for (const d of discounts) {
    if (d.flatMinor !== undefined && d.percent !== undefined) {
      throw new FinanceError(`Discount ${d.code} specifies both a flat amount and a percentage.`);
    }
    if (d.flatMinor !== undefined) {
      discountMinor += assertMinor(d.flatMinor, `discount ${d.code}`);
    } else if (d.percent !== undefined) {
      if (d.percent < 0 || d.percent > 100) {
        throw new FinanceError(`Discount ${d.code} percentage must be within [0, 100].`);
      }
      // Against the original subtotal — deliberately not compounding.
      discountMinor += Math.round((subtotalMinor * d.percent) / 100 + Number.EPSILON);
    }
  }

  discountMinor = Math.min(discountMinor, subtotalMinor);

  return {
    lines,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
  };
}

// -----------------------------------------------------------------------------
// Payment allocation
// -----------------------------------------------------------------------------

export interface OpenInvoice {
  invoiceId: string;
  invoiceNo: string;
  dueDate: Date;
  totalMinor: Minor;
  paidMinor: Minor;
  issuedAt: Date;
}

export interface Allocation {
  invoiceId: string;
  amountMinor: Minor;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Amount that could not be applied — becomes a student credit balance. */
  unappliedMinor: Minor;
}

/**
 * ALGORITHM: OLDEST-DUE-FIRST PAYMENT ALLOCATION
 * ----------------------------------------------
 * A payment arrives without saying which invoice it settles. Allocation must be
 * deterministic, explainable to the payer, and must minimise interest/penalty
 * exposure for the student.
 *
 *   1. Order open invoices by dueDate ASC, then issuedAt ASC, then invoiceNo ASC.
 *      The three-key order is a strict total order, so the same payment against
 *      the same ledger always allocates identically. (Two invoices sharing a due
 *      date is routine — per-term tuition and a per-term hostel fee — so the
 *      tie-breakers are not theoretical.)
 *
 *   2. Walk the ordered list, applying min(remaining, invoiceBalance) to each.
 *
 *   3. Any residue becomes `unappliedMinor`: a credit on the student's account,
 *      automatically consumed by the next invoice raised. Money is never
 *      silently discarded, and never over-applied to an invoice.
 *
 * Oldest-due-first is chosen over largest-first or newest-first because it is
 * the only ordering that reliably clears the invoice most likely to trigger a
 * registration hold or a late penalty.
 *
 * Complexity: O(n log n) for the sort, O(n) for the walk.
 */
export function allocatePayment(
  paymentAmountMinor: Minor,
  openInvoices: readonly OpenInvoice[],
): AllocationResult {
  assertMinor(paymentAmountMinor, 'payment amount');
  if (paymentAmountMinor <= 0) {
    throw new FinanceError('Payment amount must be positive.');
  }

  const ordered = [...openInvoices].sort(compareInvoicesForAllocation);
  const allocations: Allocation[] = [];
  let remaining = paymentAmountMinor;

  for (const invoice of ordered) {
    if (remaining <= 0) break;

    const balance = invoice.totalMinor - invoice.paidMinor;
    if (balance <= 0) continue;

    const applied = Math.min(remaining, balance);
    allocations.push({ invoiceId: invoice.invoiceId, amountMinor: applied });
    remaining -= applied;
  }

  return { allocations, unappliedMinor: remaining };
}

export function compareInvoicesForAllocation(a: OpenInvoice, b: OpenInvoice): number {
  const dueDiff = a.dueDate.getTime() - b.dueDate.getTime();
  if (dueDiff !== 0) return dueDiff;
  const issuedDiff = a.issuedAt.getTime() - b.issuedAt.getTime();
  if (issuedDiff !== 0) return issuedDiff;
  return a.invoiceNo.localeCompare(b.invoiceNo);
}

// -----------------------------------------------------------------------------
// Invoice status derivation
// -----------------------------------------------------------------------------

/**
 * Invoice status is DERIVED, never independently set. Storing a status that can
 * drift from the amounts is how ledgers end up self-contradictory; here the
 * stored column is a cache of this function's output, recomputed on every write
 * that touches `paidMinor` or `totalMinor`.
 */
export function deriveInvoiceStatus(
  invoice: { totalMinor: Minor; paidMinor: Minor; dueDate: Date; voidedAt: Date | null },
  now: Date,
): InvoiceStatus {
  if (invoice.voidedAt) return 'VOID';
  if (invoice.paidMinor >= invoice.totalMinor) return 'PAID';
  if (now > invoice.dueDate) return 'OVERDUE';
  if (invoice.paidMinor > 0) return 'PARTIALLY_PAID';
  return 'ISSUED';
}

export function invoiceBalance(invoice: { totalMinor: Minor; paidMinor: Minor }): Minor {
  return Math.max(0, invoice.totalMinor - invoice.paidMinor);
}

// -----------------------------------------------------------------------------
// Student account summary
// -----------------------------------------------------------------------------

export interface AccountSummary {
  totalBilledMinor: Minor;
  totalPaidMinor: Minor;
  /** What the student owes right now (never negative). */
  outstandingMinor: Minor;
  /** Unapplied overpayment held to the student's credit. */
  creditMinor: Minor;
  /** Portion of `outstanding` that is past its due date. */
  overdueMinor: Minor;
  hasOverdue: boolean;
}

export function summariseAccount(
  invoices: readonly { totalMinor: Minor; paidMinor: Minor; dueDate: Date; voidedAt: Date | null }[],
  unappliedCreditMinor: Minor,
  now: Date,
): AccountSummary {
  let totalBilledMinor = 0;
  let totalPaidMinor = 0;
  let outstandingMinor = 0;
  let overdueMinor = 0;

  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    totalBilledMinor += inv.totalMinor;
    totalPaidMinor += inv.paidMinor;

    const balance = invoiceBalance(inv);
    outstandingMinor += balance;
    if (balance > 0 && now > inv.dueDate) overdueMinor += balance;
  }

  return {
    totalBilledMinor,
    totalPaidMinor,
    outstandingMinor,
    creditMinor: unappliedCreditMinor,
    overdueMinor,
    hasOverdue: overdueMinor > 0,
  };
}

// -----------------------------------------------------------------------------
// Receivables ageing
// -----------------------------------------------------------------------------

export const AGEING_BUCKETS = [
  { key: 'current', label: 'Not yet due', minDays: -Infinity, maxDays: 0 },
  { key: 'd1_30', label: '1–30 days', minDays: 1, maxDays: 30 },
  { key: 'd31_60', label: '31–60 days', minDays: 31, maxDays: 60 },
  { key: 'd61_90', label: '61–90 days', minDays: 61, maxDays: 90 },
  { key: 'd90_plus', label: 'Over 90 days', minDays: 91, maxDays: Infinity },
] as const;

export type AgeingBucketKey = (typeof AGEING_BUCKETS)[number]['key'];

export type AgeingReport = Record<AgeingBucketKey, Minor> & { totalMinor: Minor };

const MS_PER_DAY = 86_400_000;

/**
 * ALGORITHM: RECEIVABLES AGEING
 * -----------------------------
 * The standard finance-office view: how much is owed, and how long has it been
 * owed. Each unpaid balance is bucketed by days past due.
 *
 *   daysPastDue = floor((now − dueDate) / 86,400,000)
 *
 * Using floor on whole milliseconds means an invoice due today is 0 days past
 * due until midnight tomorrow, which matches how a bursar counts. Ceiling or
 * rounding here would age every invoice a day early and misstate the report.
 *
 * Complexity: O(n) single pass, O(1) space.
 */
export function buildAgeingReport(
  invoices: readonly { totalMinor: Minor; paidMinor: Minor; dueDate: Date; voidedAt: Date | null }[],
  now: Date,
): AgeingReport {
  const report = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    totalMinor: 0,
  } as AgeingReport;

  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const balance = invoiceBalance(inv);
    if (balance <= 0) continue;

    const daysPastDue = Math.floor((now.getTime() - inv.dueDate.getTime()) / MS_PER_DAY);
    const bucket = AGEING_BUCKETS.find(
      (b) => daysPastDue >= b.minDays && daysPastDue <= b.maxDays,
    );

    report[(bucket?.key ?? 'current') as AgeingBucketKey] += balance;
    report.totalMinor += balance;
  }

  return report;
}

// -----------------------------------------------------------------------------
// Financial hold policy
// -----------------------------------------------------------------------------

/** The DEFAULT hold policy. A school passes its own. */
export const FINANCIAL_HOLD_POLICY = DEFAULT_FINANCE_CONFIG.holdPolicy;

export interface HoldRecommendation {
  shouldHold: boolean;
  reason: string;
  overdueMinor: Minor;
  maxDaysPastDue: number;
}

/**
 * ALGORITHM: FINANCIAL HOLD DETERMINATION
 * ---------------------------------------
 * A hold is recommended when a balance is BOTH materially overdue in amount and
 * past the grace period in time. Requiring both conditions prevents two failure
 * modes seen in practice:
 *
 *   · amount-only  -> a ₦1 rounding residue blocks a student's registration
 *   · time-only    -> a fully-paid invoice with a stale due date raises a hold
 *
 * This function only RECOMMENDS. Placing and releasing holds is a deliberate
 * act recorded against a named officer in the `holds` table — never an
 * invisible side effect of a nightly job.
 */
export function recommendFinancialHold(
  invoices: readonly { totalMinor: Minor; paidMinor: Minor; dueDate: Date; voidedAt: Date | null }[],
  now: Date,
  policy = FINANCIAL_HOLD_POLICY,
): HoldRecommendation {
  let overdueMinor = 0;
  let maxDaysPastDue = 0;

  for (const inv of invoices) {
    if (inv.voidedAt) continue;
    const balance = invoiceBalance(inv);
    if (balance <= 0) continue;

    const daysPastDue = Math.floor((now.getTime() - inv.dueDate.getTime()) / MS_PER_DAY);
    if (daysPastDue > 0) {
      overdueMinor += balance;
      maxDaysPastDue = Math.max(maxDaysPastDue, daysPastDue);
    }
  }

  const shouldHold =
    overdueMinor > policy.toleranceMinor && maxDaysPastDue > policy.graceDays;

  return {
    shouldHold,
    overdueMinor,
    maxDaysPastDue,
    reason: shouldHold
      ? `Outstanding balance overdue by ${maxDaysPastDue} days, beyond the ${policy.graceDays}-day grace period.`
      : 'No qualifying overdue balance.',
  };
}

// -----------------------------------------------------------------------------
// Refunds
// -----------------------------------------------------------------------------

/** The DEFAULT refund schedule. A school passes its own. */
export const REFUND_SCHEDULE = DEFAULT_FINANCE_CONFIG.refundSchedule;

/**
 * Tuition refund on withdrawal, on a declining weekly schedule measured from
 * the first day of the term. Returns minor units.
 */
export function computeRefund(
  paidMinor: Minor,
  termStart: Date,
  withdrawalDate: Date,
  schedule: readonly { throughWeek: number; percent: number }[] = DEFAULT_FINANCE_CONFIG.refundSchedule,
): { percent: number; refundMinor: Minor; weeksElapsed: number } {
  const elapsedMs = Math.max(0, withdrawalDate.getTime() - termStart.getTime());
  const weeksElapsed = Math.floor(elapsedMs / (7 * MS_PER_DAY)) + 1;

  // Bands are walked in ascending week order; past the last one the refund is
  // nil, which is why no explicit Infinity band is needed.
  const band = [...schedule]
    .sort((a, b) => a.throughWeek - b.throughWeek)
    .find((b) => weeksElapsed <= b.throughWeek) ?? { percent: 0 };

  return {
    percent: band.percent,
    refundMinor: Math.round((paidMinor * band.percent) / 100 + Number.EPSILON),
    weeksElapsed,
  };
}

// -----------------------------------------------------------------------------
// FEE STRUCTURE DRAFTS
// -----------------------------------------------------------------------------
//
// These live HERE rather than beside `saveFeeStructure` because the dialog that
// collects them is a client component. A service module imports the Prisma
// client, and importing one from the browser bundle pulls in a Prisma build
// with no `dmmf` — which is how `/calendar` came to crash on a page that had
// nothing wrong with it. The rules are pure, so they belong in the domain.

/** A fee line as a bursar types it, before it is converted to minor units. */
export interface FeeItemDraft {
  code: string;
  description: string;
  /** MAJOR units, as typed. Converted when saved. */
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
