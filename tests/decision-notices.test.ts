import { describe, expect, it } from 'vitest';

import { decisionNotice } from '@/lib/domain/admissions';
import { invoiceNotice } from '@/lib/domain/finance';

/*
 * The notification policy has said since phase three that an admissions
 * decision and a new invoice go by email as well as the bell. Nothing sent
 * either, so an applicant learnt they had a place only by signing in to look,
 * and a student learnt what they owed at the bursary queue.
 */

describe('telling an applicant', () => {
  it('gives an offer its deadline', () => {
    const n = decisionNotice('OFFERED', 'Computer Science', '26 Oct 2026')!;
    expect(n.title).toContain('offered a place on Computer Science');
    expect(n.body).toContain('before 26 Oct 2026');
    expect(n.body).toMatch(/lapses/);
  });

  it('still says how to respond when there is no deadline', () => {
    expect(decisionNotice('OFFERED', 'Law', null)!.body).toMatch(/applicant portal/);
  });

  it('tells a waitlisted applicant there is nothing to do', () => {
    const n = decisionNotice('WAITLISTED', 'Law', null)!;
    expect(n.title).toContain('waiting list');
    expect(n.body).toMatch(/nothing you need to do/);
  });

  it('does not put the refusal in the subject line', () => {
    // The title becomes the email subject, read on a lock screen.
    const n = decisionNotice('REJECTED', 'Medicine', null)!;
    expect(n.title).not.toMatch(/reject|unsuccessful|sorry/i);
    expect(n.body).toMatch(/unable to offer you a place/);
  });

  it('says nothing about internal states', () => {
    for (const s of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'EXPIRED'] as const) {
      expect(decisionNotice(s as never, 'Law', null)).toBeNull();
    }
  });
});

describe('telling a student what they owe', () => {
  const base = {
    invoiceNo: 'INV-GEU-000123',
    termName: 'First Semester 2026/27',
    total: '₦250,000.00',
    balance: '₦250,000.00',
    dueOn: '30 Oct 2026',
    settled: false,
  };

  it('answers how much and by when, without signing in', () => {
    const n = invoiceNotice(base, 'ISSUED')!;
    expect(n.title).toContain('₦250,000.00');
    expect(n.title).toContain('First Semester 2026/27');
    expect(n.body).toContain('30 Oct 2026');
    expect(n.body).toContain('INV-GEU-000123');
  });

  it('stays silent when a reassessment changed nothing', () => {
    // A bursar re-running a whole level must not message every student.
    expect(invoiceNotice({ ...base, previousTotal: null }, 'REASSESSED')).toBeNull();
    expect(invoiceNotice({ ...base, previousTotal: base.total }, 'REASSESSED')).toBeNull();
  });

  it('shows both amounts when the bill moved', () => {
    const n = invoiceNotice(
      { ...base, total: '₦270,000.00', balance: '₦170,000.00', previousTotal: '₦250,000.00' },
      'REASSESSED',
    )!;
    expect(n.title).toMatch(/changed/);
    expect(n.body).toContain('from ₦250,000.00 to ₦270,000.00');
    expect(n.body).toContain('₦170,000.00 is outstanding, due by 30 Oct 2026');
  });

  it('does not ask for money when a reassessment left it paid', () => {
    const n = invoiceNotice(
      { ...base, total: '₦200,000.00', balance: '₦0.00', settled: true, previousTotal: '₦250,000.00' },
      'REASSESSED',
    )!;
    expect(n.body).toMatch(/fully paid/);
    expect(n.body).not.toMatch(/outstanding|due by/);
  });
});
