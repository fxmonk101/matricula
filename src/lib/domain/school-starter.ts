/**
 * =============================================================================
 * WHAT A NEW SCHOOL ARRIVES WITH
 * =============================================================================
 *
 * Provisioning used to create a school, its policy configuration, a
 * subscription and an owner — and nothing else. Every academic page then
 * rendered an empty state, because almost all of them hang off a CURRENT TERM:
 * course offerings belong to a term, registration opens and closes within one,
 * fee structures are scoped by one, and the timetable is drawn for one. A
 * school with no term is not a school with less data in it; it is a school
 * where most of the product does nothing.
 *
 * So a term is not optional and is not a "sample" — every institution on earth
 * has one, the dates are the only thing that varies, and an editable guess is
 * strictly better than an empty table with no way to tell what is missing.
 *
 * Pure: dates in, plans out. No database, no clock of its own.
 */

export interface TermPlan {
  code: string;
  name: string;
  academicYear: string;
  season: 'FALL' | 'SPRING' | 'SUMMER';
  startDate: Date;
  endDate: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  addDropDeadline: Date;
  withdrawalDeadline: Date;
  isCurrent: boolean;
}

const DAY = 86_400_000;

function at(year: number, monthIndex: number, day: number): Date {
  // Midday UTC, not midnight. A date stored at 00:00 UTC lands on the previous
  // calendar day for every school west of Greenwich, and this platform's market
  // spans UTC-1 to UTC+3 — so the deadline a registrar sees would be a day out
  // depending on where they sat.
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
}

/**
 * The academic year containing `today`, on the Northern-Hemisphere convention
 * used across West Africa: first term opens in September, second in January.
 *
 * A date in, say, March belongs to the year that STARTED the previous
 * September — so 2026-03-14 is in 2025/2026, not 2026/2027. Getting this
 * backwards would file a whole term's results under the wrong year.
 */
export function academicYearOf(today: Date): { startYear: number; label: string } {
  const year = today.getUTCFullYear();
  const startYear = today.getUTCMonth() >= 8 ? year : year - 1;
  return { startYear, label: `${startYear}/${startYear + 1}` };
}

/**
 * Two terms for the current academic year, with the right one marked current.
 *
 * Both are created rather than just the current one, because the second thing
 * anybody does after setting up a school is plan the next term — and a UI that
 * can only show one term hides the concept entirely.
 */
export function starterTerms(today: Date): TermPlan[] {
  const { startYear, label } = academicYearOf(today);

  const first: TermPlan = {
    code: `${startYear}-FIRST`,
    name: 'First Semester',
    academicYear: label,
    season: 'FALL',
    startDate: at(startYear, 8, 15), // 15 September
    endDate: at(startYear, 11, 20), // 20 December
    registrationOpensAt: at(startYear, 7, 15), // 15 August
    registrationClosesAt: at(startYear, 8, 30),
    addDropDeadline: at(startYear, 9, 15),
    withdrawalDeadline: at(startYear, 10, 15),
    isCurrent: false,
  };

  const second: TermPlan = {
    code: `${startYear + 1}-SECOND`,
    name: 'Second Semester',
    academicYear: label,
    season: 'SPRING',
    startDate: at(startYear + 1, 0, 15), // 15 January
    endDate: at(startYear + 1, 4, 30), // 30 May
    registrationOpensAt: at(startYear + 1, 0, 1), // 1 January
    registrationClosesAt: at(startYear + 1, 0, 31),
    addDropDeadline: at(startYear + 1, 1, 15),
    withdrawalDeadline: at(startYear + 1, 2, 15),
    isCurrent: false,
  };

  /*
   * Which one is current is decided by the date, and the fallback matters: a
   * school provisioned in July sits between two academic years, and marking
   * NEITHER current would leave it with exactly the problem this function
   * exists to solve. The nearest upcoming term wins.
   */
  const now = today.getTime();
  if (now >= first.startDate.getTime() - 30 * DAY && now <= first.endDate.getTime()) {
    first.isCurrent = true;
  } else if (now >= second.startDate.getTime() - 30 * DAY && now <= second.endDate.getTime()) {
    second.isCurrent = true;
  } else if (now < first.startDate.getTime()) {
    first.isCurrent = true;
  } else {
    second.isCurrent = true;
  }

  return [first, second];
}

// -----------------------------------------------------------------------------
// A place to put people
// -----------------------------------------------------------------------------

export interface StarterUnit {
  facultyCode: string;
  facultyName: string;
  departmentCode: string;
  departmentName: string;
}

/**
 * One faculty and one department, so staff can be placed on the day the school
 * opens.
 *
 * A lecturer needs a department before they can hold an Instructor profile, and
 * the presence roll-up reads the reporting line that hangs off it — so a school
 * with no department cannot place its first member of staff without the owner
 * first discovering that Structure is a page and that it comes before People.
 *
 * Named GENERICALLY on purpose. "General Studies" is something every
 * institution has and nobody minds renaming; inventing "Faculty of Science"
 * for a school of nursing would be worse than inventing nothing.
 */
export const STARTER_UNIT: StarterUnit = {
  facultyCode: 'GEN',
  facultyName: 'General Studies',
  /*
   * DISTINCT from the faculty code, and it has to be.
   *
   * Org units are unique on (schoolId, code), and provisioning creates one for
   * the faculty and one for the department. Reusing the code raised P2002
   * inside the provisioning transaction — so the whole school rolled back and
   * the operator was told only that it had failed.
   */
  departmentCode: 'GST',
  departmentName: 'General Studies',
};

/** The K-12 equivalent: a school has forms, not faculties. */
export const STARTER_UNIT_K12: StarterUnit = {
  facultyCode: 'SCH',
  facultyName: 'The School',
  departmentCode: 'GEN',
  departmentName: 'General',
};

export function starterUnitFor(academicModel: string): StarterUnit {
  return academicModel === 'K12' ? STARTER_UNIT_K12 : STARTER_UNIT;
}
