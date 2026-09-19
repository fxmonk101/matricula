import { describe, expect, it } from 'vitest';

import {
  academicYearOf,
  starterTerms,
  starterUnitFor,
  STARTER_UNIT,
  STARTER_UNIT_K12,
} from '@/lib/domain/school-starter';

/**
 * What a newly provisioned school arrives with.
 *
 * The property that actually matters is the last one in this file: there is
 * ALWAYS exactly one current term, whatever day of the year the school is
 * created on. A school provisioned in July sits between two academic years, and
 * that is precisely when "no current term" would slip through — leaving an
 * institution where registration, offerings, fees and the timetable all render
 * empty with nothing on screen explaining why.
 */

const on = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

describe('which academic year a date falls in', () => {
  it('runs September to August, as West African institutions do', () => {
    expect(academicYearOf(on('2026-09-15')).label).toBe('2026/2027');
    expect(academicYearOf(on('2026-12-31')).label).toBe('2026/2027');
  });

  it('puts the spring half in the year that STARTED the previous September', () => {
    // 14 March 2026 belongs to 2025/2026. Getting this backwards files a whole
    // term's results under the wrong year.
    expect(academicYearOf(on('2026-03-14')).label).toBe('2025/2026');
    expect(academicYearOf(on('2026-01-02')).label).toBe('2025/2026');
    expect(academicYearOf(on('2026-08-31')).label).toBe('2025/2026');
  });

  it('flips on the first of September', () => {
    expect(academicYearOf(on('2026-08-31')).label).toBe('2025/2026');
    expect(academicYearOf(on('2026-09-01')).label).toBe('2026/2027');
  });
});

describe('the terms a new school gets', () => {
  it('creates two, in the same academic year', () => {
    const terms = starterTerms(on('2026-10-01'));
    expect(terms).toHaveLength(2);
    expect(new Set(terms.map((t) => t.academicYear)).size).toBe(1);
  });

  it('orders every date within a term sensibly', () => {
    for (const t of starterTerms(on('2026-10-01'))) {
      expect(t.registrationOpensAt.getTime()).toBeLessThan(t.registrationClosesAt.getTime());
      expect(t.startDate.getTime()).toBeLessThan(t.endDate.getTime());
      // A student must be able to drop before they can be refused a withdrawal.
      expect(t.addDropDeadline.getTime()).toBeLessThan(t.withdrawalDeadline.getTime());
      expect(t.withdrawalDeadline.getTime()).toBeLessThan(t.endDate.getTime());
      expect(t.addDropDeadline.getTime()).toBeGreaterThan(t.startDate.getTime());
    }
  });

  it('does not overlap the two terms', () => {
    const [first, second] = starterTerms(on('2026-10-01'));
    expect(first.endDate.getTime()).toBeLessThan(second.startDate.getTime());
  });

  it('gives them distinct codes', () => {
    const terms = starterTerms(on('2026-10-01'));
    expect(new Set(terms.map((t) => t.code)).size).toBe(2);
  });

  it('dates them at midday, not midnight', () => {
    /*
     * A date stored at 00:00 UTC lands on the PREVIOUS calendar day for every
     * school west of Greenwich, and this platform's market spans UTC-1 to
     * UTC+3 — so a deadline would read a day early depending on where the
     * registrar sat.
     */
    for (const t of starterTerms(on('2026-10-01'))) {
      expect(t.startDate.getUTCHours()).toBe(12);
      expect(t.withdrawalDeadline.getUTCHours()).toBe(12);
    }
  });

  it('ALWAYS marks exactly one term current, on every day of the year', () => {
    // The assertion this module exists for. Walked day by day rather than
    // spot-checked, because the gaps are the whole risk.
    for (let year = 2026; year <= 2028; year += 1) {
      for (let month = 0; month < 12; month += 1) {
        for (const day of [1, 14, 28]) {
          const today = new Date(Date.UTC(year, month, day, 9));
          const current = starterTerms(today).filter((t) => t.isCurrent);
          expect(current, today.toISOString().slice(0, 10)).toHaveLength(1);
        }
      }
    }
  });

  it('picks the term that is actually running, in mid-session', () => {
    const [first, second] = starterTerms(on('2026-10-01'));
    expect(first.isCurrent).toBe(true);
    expect(second.isCurrent).toBe(false);

    const [, spring] = starterTerms(on('2027-03-01'));
    expect(spring.isCurrent).toBe(true);
  });

  it('picks the NEXT term in the long vacation, rather than none', () => {
    // July belongs to no term. A school provisioned then still needs one.
    const terms = starterTerms(on('2027-07-15'));
    expect(terms.filter((t) => t.isCurrent)).toHaveLength(1);
  });
});

describe('the starting department', () => {
  it('is named generically, so nobody minds renaming it', () => {
    // Inventing "Faculty of Science" for a school of nursing would be worse
    // than inventing nothing.
    expect(STARTER_UNIT.facultyName).toBe('General Studies');
    expect(starterUnitFor('HIGHER_ED')).toEqual(STARTER_UNIT);
  });

  it('uses school vocabulary for a K-12 school', () => {
    expect(starterUnitFor('K12')).toEqual(STARTER_UNIT_K12);
    expect(STARTER_UNIT_K12.facultyName).toBe('The School');
  });
});

describe('the codes provisioning writes', () => {
  it('never reuses a code between the faculty and the department', () => {
    /*
     * Org units are unique on (schoolId, code) and provisioning creates one for
     * each. Sharing a code raised P2002 INSIDE the provisioning transaction, so
     * the entire school rolled back and the operator saw only "provisioning
     * failed" — a message that names nothing and points nowhere.
     */
    for (const model of ['HIGHER_ED', 'K12']) {
      const unit = starterUnitFor(model);
      expect(unit.facultyCode, model).not.toBe(unit.departmentCode);
    }
  });

  it('keeps codes short and alphanumeric, as the rest of the schema expects', () => {
    for (const model of ['HIGHER_ED', 'K12']) {
      const unit = starterUnitFor(model);
      for (const code of [unit.facultyCode, unit.departmentCode]) {
        expect(code, code).toMatch(/^[A-Z0-9]{2,8}$/);
      }
    }
  });
});
