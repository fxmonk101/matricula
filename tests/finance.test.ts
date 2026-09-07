import { describe, expect, it } from 'vitest';

import {
  allocateEvenly,
  applyPercentage,
  formatMoney,
  formatMoneyCompact,
  MoneyError,
  sumMinor,
  toMinor,
} from '@/lib/domain/money';
import {
  allocatePayment,
  assessTermFees,
  buildAgeingReport,
  computeRefund,
  deriveInvoiceStatus,
  FinanceError,
  invoiceBalance,
  recommendFinancialHold,
  resolveFeeStructure,
  summariseAccount,
} from '@/lib/domain/finance';

const NGN = (major: number) => toMinor(major);

describe('money', () => {
  it('converts major to minor units without float error', () => {
    // 1500.75 * 100 is 150074.99999999999 in IEEE 754.
    expect(toMinor(1500.75)).toBe(150075);
    expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3));
  });

  it('formats with thousands separators and a fixed exponent', () => {
    expect(formatMoney(150075)).toBe('₦1,500.75');
    expect(formatMoney(5)).toBe('₦0.05');
    expect(formatMoney(-150075)).toBe('-₦1,500.75');
  });

  it('formats compactly for dashboard tiles', () => {
    expect(formatMoneyCompact(toMinor(12_400_000))).toBe('₦12.4M');
    expect(formatMoneyCompact(toMinor(4_500))).toBe('₦4.5K');
  });

  it('splits an amount with no lost minor units', () => {
    // 100 kobo split three ways: 34 + 33 + 33, never 33 + 33 + 33.
    const parts = allocateEvenly(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(sumMinor(parts)).toBe(100);
  });

  it('always preserves the total when splitting, for any part count', () => {
    for (let n = 1; n <= 12; n++) {
      expect(sumMinor(allocateEvenly(10_000_7, n))).toBe(10_000_7);
    }
  });

  it('rejects a fractional minor amount', () => {
    expect(() => allocateEvenly(100.5, 2)).toThrow(MoneyError);
  });

  it('rejects an out-of-range percentage', () => {
    expect(() => applyPercentage(1000, 101)).toThrow(MoneyError);
  });
});

describe('fee structure resolution', () => {
  const candidates = [
    { id: 'default', name: 'Institution default', termId: 't1', programId: null, level: null, isActive: true },
    { id: 'program', name: 'Engineering', termId: 't1', programId: 'ENG', level: null, isActive: true },
    { id: 'level', name: 'Level 100', termId: 't1', programId: null, level: 100, isActive: true },
    { id: 'both', name: 'Engineering L100', termId: 't1', programId: 'ENG', level: 100, isActive: true },
  ];

  it('prefers the most specific match', () => {
    const result = resolveFeeStructure(candidates, { termId: 't1', programId: 'ENG', level: 100 });
    expect(result?.id).toBe('both');
  });

  it('falls back through the specificity ladder', () => {
    expect(
      resolveFeeStructure(candidates, { termId: 't1', programId: 'ENG', level: 200 })?.id,
    ).toBe('program');
    expect(
      resolveFeeStructure(candidates, { termId: 't1', programId: 'CSC', level: 100 })?.id,
    ).toBe('level');
    expect(
      resolveFeeStructure(candidates, { termId: 't1', programId: 'CSC', level: 200 })?.id,
    ).toBe('default');
  });

  it('discards a structure for the wrong program rather than ranking it lower', () => {
    const onlyEng = candidates.filter((c) => c.programId === 'ENG');
    expect(resolveFeeStructure(onlyEng, { termId: 't1', programId: 'CSC', level: 100 })).toBeNull();
  });

  it('ignores inactive structures and other terms', () => {
    const inactive = candidates.map((c) => ({ ...c, isActive: false }));
    expect(resolveFeeStructure(inactive, { termId: 't1', programId: 'ENG', level: 100 })).toBeNull();
    expect(resolveFeeStructure(candidates, { termId: 't2', programId: 'ENG', level: 100 })).toBeNull();
  });
});

describe('fee assessment', () => {
  const items = [
    { code: 'TUITION', description: 'Tuition', amountMinor: NGN(10_000), perCreditHour: true, isMandatory: true },
    { code: 'ICT', description: 'ICT levy', amountMinor: NGN(18_000), perCreditHour: false, isMandatory: true },
  ];

  it('multiplies per-credit items by the registered credit hours', () => {
    const result = assessTermFees(items, 15);
    expect(result.lines[0].quantity).toBe(15);
    expect(result.lines[0].amountMinor).toBe(NGN(150_000));
    expect(result.subtotalMinor).toBe(NGN(168_000));
  });

  it('applies stacked percentage discounts against the ORIGINAL subtotal', () => {
    // Two 10% discounts must total 20%, not 19%. Sequential application is a
    // classic and quietly expensive bug.
    const result = assessTermFees(items, 10, [
      { code: 'A', description: 'Award A', percent: 10 },
      { code: 'B', description: 'Award B', percent: 10 },
    ]);
    expect(result.discountMinor).toBe(Math.round(result.subtotalMinor * 0.2));
  });

  it('clamps a discount to the subtotal so a bill can never go negative', () => {
    const result = assessTermFees(items, 3, [
      { code: 'FULL', description: 'Full scholarship', percent: 100 },
      { code: 'EXTRA', description: 'Extra', flatMinor: NGN(50_000) },
    ]);
    expect(result.discountMinor).toBe(result.subtotalMinor);
    expect(result.totalMinor).toBe(0);
  });

  it('rejects a discount that specifies both a flat amount and a percentage', () => {
    expect(() =>
      assessTermFees(items, 3, [
        { code: 'BAD', description: 'Bad', percent: 10, flatMinor: NGN(1_000) },
      ]),
    ).toThrow(FinanceError);
  });

  it('rejects negative credit hours', () => {
    expect(() => assessTermFees(items, -1)).toThrow(FinanceError);
  });
});

describe('payment allocation', () => {
  const invoice = (
    id: string,
    due: string,
    total: number,
    paid = 0,
    issued = '2025-01-01',
  ) => ({
    invoiceId: id,
    invoiceNo: id,
    dueDate: new Date(due),
    issuedAt: new Date(issued),
    totalMinor: NGN(total),
    paidMinor: NGN(paid),
  });

  it('settles the oldest-due invoice first', () => {
    const { allocations } = allocatePayment(NGN(100), [
      invoice('newer', '2025-06-01', 100),
      invoice('older', '2025-01-01', 100),
    ]);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].invoiceId).toBe('older');
  });

  it('spills over into the next invoice once one is settled', () => {
    const { allocations, unappliedMinor } = allocatePayment(NGN(150), [
      invoice('a', '2025-01-01', 100),
      invoice('b', '2025-02-01', 100),
    ]);
    expect(allocations).toEqual([
      { invoiceId: 'a', amountMinor: NGN(100) },
      { invoiceId: 'b', amountMinor: NGN(50) },
    ]);
    expect(unappliedMinor).toBe(0);
  });

  it('never over-applies to an invoice', () => {
    const { allocations } = allocatePayment(NGN(500), [invoice('a', '2025-01-01', 100, 60)]);
    expect(allocations[0].amountMinor).toBe(NGN(40));
  });

  it('holds an overpayment as unapplied credit rather than discarding it', () => {
    const { unappliedMinor } = allocatePayment(NGN(200), [invoice('a', '2025-01-01', 100)]);
    expect(unappliedMinor).toBe(NGN(100));
  });

  it('skips invoices that are already fully paid', () => {
    const { allocations } = allocatePayment(NGN(50), [
      invoice('paid', '2025-01-01', 100, 100),
      invoice('open', '2025-02-01', 100),
    ]);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].invoiceId).toBe('open');
  });

  it('is deterministic when two invoices share a due date', () => {
    // Same-day tuition and hostel invoices are routine, so the tie-breakers
    // are load-bearing, not theoretical.
    const invoices = [
      invoice('b-invoice', '2025-01-01', 100, 0, '2025-01-02'),
      invoice('a-invoice', '2025-01-01', 100, 0, '2025-01-01'),
    ];
    const first = allocatePayment(NGN(100), invoices);
    const second = allocatePayment(NGN(100), [...invoices].reverse());
    expect(first.allocations).toEqual(second.allocations);
    expect(first.allocations[0].invoiceId).toBe('a-invoice');
  });

  it('rejects a non-positive or fractional payment', () => {
    expect(() => allocatePayment(0, [])).toThrow(FinanceError);
    expect(() => allocatePayment(-100, [])).toThrow(FinanceError);
    expect(() => allocatePayment(10.5, [])).toThrow();
  });
});

describe('invoice status derivation', () => {
  const now = new Date('2025-06-01');
  const base = { totalMinor: NGN(100), paidMinor: 0, dueDate: new Date('2025-07-01'), voidedAt: null };

  it('derives each status from the amounts and the clock', () => {
    expect(deriveInvoiceStatus(base, now)).toBe('ISSUED');
    expect(deriveInvoiceStatus({ ...base, paidMinor: NGN(40) }, now)).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...base, paidMinor: NGN(100) }, now)).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, dueDate: new Date('2025-05-01') }, now)).toBe('OVERDUE');
  });

  it('reports PAID over OVERDUE for a settled but late invoice', () => {
    const settled = { ...base, paidMinor: NGN(100), dueDate: new Date('2025-05-01') };
    expect(deriveInvoiceStatus(settled, now)).toBe('PAID');
  });

  it('reports VOID above everything else', () => {
    expect(deriveInvoiceStatus({ ...base, voidedAt: new Date('2025-05-01') }, now)).toBe('VOID');
  });

  it('never reports a negative balance', () => {
    expect(invoiceBalance({ totalMinor: NGN(100), paidMinor: NGN(150) })).toBe(0);
  });
});

describe('account summary', () => {
  const now = new Date('2025-06-01');

  it('separates overdue from merely outstanding, and excludes voided invoices', () => {
    const summary = summariseAccount(
      [
        { totalMinor: NGN(100), paidMinor: NGN(40), dueDate: new Date('2025-05-01'), voidedAt: null },
        { totalMinor: NGN(200), paidMinor: 0, dueDate: new Date('2025-07-01'), voidedAt: null },
        { totalMinor: NGN(999), paidMinor: 0, dueDate: new Date('2025-01-01'), voidedAt: new Date() },
      ],
      NGN(25),
      now,
    );

    expect(summary.totalBilledMinor).toBe(NGN(300));
    expect(summary.outstandingMinor).toBe(NGN(260));
    expect(summary.overdueMinor).toBe(NGN(60));
    expect(summary.hasOverdue).toBe(true);
    expect(summary.creditMinor).toBe(NGN(25));
  });
});

describe('receivables ageing', () => {
  const now = new Date('2025-06-30');
  const inv = (due: string, total: number, paid = 0) => ({
    totalMinor: NGN(total),
    paidMinor: NGN(paid),
    dueDate: new Date(due),
    voidedAt: null,
  });

  it('buckets each balance by whole days past due', () => {
    const report = buildAgeingReport(
      [
        inv('2025-07-15', 100), // not yet due
        inv('2025-06-15', 200), // 15 days
        inv('2025-05-15', 300), // 46 days
        inv('2025-04-15', 400), // 76 days
        inv('2025-01-15', 500), // 166 days
      ],
      now,
    );

    expect(report.current).toBe(NGN(100));
    expect(report.d1_30).toBe(NGN(200));
    expect(report.d31_60).toBe(NGN(300));
    expect(report.d61_90).toBe(NGN(400));
    expect(report.d90_plus).toBe(NGN(500));
    expect(report.totalMinor).toBe(NGN(1_500));
  });

  it('treats an invoice due today as not yet overdue', () => {
    // A bursar does not age an invoice on the day it falls due.
    const report = buildAgeingReport([inv('2025-06-30', 100)], now);
    expect(report.current).toBe(NGN(100));
    expect(report.d1_30).toBe(0);
  });

  it('excludes settled and voided invoices entirely', () => {
    const report = buildAgeingReport(
      [
        inv('2025-01-01', 100, 100),
        { ...inv('2025-01-01', 500), voidedAt: new Date() },
      ],
      now,
    );
    expect(report.totalMinor).toBe(0);
  });
});

describe('financial hold recommendation', () => {
  const now = new Date('2025-06-30');
  const inv = (due: string, total: number, paid = 0) => ({
    totalMinor: NGN(total),
    paidMinor: NGN(paid),
    dueDate: new Date(due),
    voidedAt: null,
  });

  it('recommends a hold for a materially overdue balance past the grace period', () => {
    const result = recommendFinancialHold([inv('2025-05-01', 100)], now);
    expect(result.shouldHold).toBe(true);
    expect(result.maxDaysPastDue).toBe(60);
  });

  it('does not hold inside the grace period', () => {
    // A bill three days late must not block registration.
    const result = recommendFinancialHold([inv('2025-06-27', 100)], now);
    expect(result.shouldHold).toBe(false);
  });

  it('does not hold a fully-paid invoice with a stale due date', () => {
    const result = recommendFinancialHold([inv('2025-01-01', 100, 100)], now);
    expect(result.shouldHold).toBe(false);
    expect(result.overdueMinor).toBe(0);
  });
});

describe('refund schedule', () => {
  const termStart = new Date('2025-09-01');

  it('refunds in full during the first week', () => {
    expect(computeRefund(NGN(100), termStart, new Date('2025-09-03')).percent).toBe(100);
  });

  it('declines across the published bands', () => {
    expect(computeRefund(NGN(100), termStart, new Date('2025-09-10')).percent).toBe(75);
    expect(computeRefund(NGN(100), termStart, new Date('2025-09-24')).percent).toBe(50);
    expect(computeRefund(NGN(100), termStart, new Date('2025-10-08')).percent).toBe(25);
    expect(computeRefund(NGN(100), termStart, new Date('2025-11-15')).percent).toBe(0);
  });

  it('computes the refund amount in whole minor units', () => {
    const result = computeRefund(NGN(150.55), termStart, new Date('2025-09-10'));
    expect(Number.isInteger(result.refundMinor)).toBe(true);
    expect(result.refundMinor).toBe(Math.round(NGN(150.55) * 0.75));
  });
});
