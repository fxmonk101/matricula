/**
 * =============================================================================
 * CLASS ATTENDANCE
 * =============================================================================
 *
 * Who was actually in the room, and what follows from it.
 *
 * `TeachingLog.attended` already records a HEADCOUNT — "23 were there" — which
 * is enough to tell a head of department that a class ran and roughly how full
 * it was, and useless for the thing universities in this market actually do
 * with attendance: refuse to let a student sit the examination.
 *
 * That rule is close to universal here. A student must attend some percentage
 * of a course's classes — 75% is the common figure — or they are barred from
 * the examination regardless of their marks. Enforcing it needs a register: one
 * row per student per session, not a number per session.
 *
 * Four decisions are made here rather than in the service, because each of them
 * is a judgement about people and each would otherwise be re-decided, slightly
 * differently, at every call site.
 */

export const CLASS_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export type ClassAttendanceStatus = (typeof CLASS_ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<ClassAttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

export function isAttendanceStatus(value: unknown): value is ClassAttendanceStatus {
  return CLASS_ATTENDANCE_STATUSES.includes(value as ClassAttendanceStatus);
}

/**
 * DECISION 1 — LATE counts as attended.
 *
 * A student who arrived ten minutes into a lecture was at the lecture. Folding
 * lateness into absence means somebody who has missed nothing all term but has
 * a difficult commute is barred from an examination, which is not what the rule
 * is for. Punctuality is worth recording and worth a conversation; it is not
 * the same fact as absence and must not silently become it.
 */
export function countsAsAttended(status: ClassAttendanceStatus): boolean {
  return status === 'PRESENT' || status === 'LATE';
}

/**
 * DECISION 2 — EXCUSED leaves the calculation entirely.
 *
 * Not a present, not an absence: removed from numerator AND denominator. A
 * student with a hospital letter for three weeks should be judged on the
 * classes they could have attended. Counting an excused absence against them
 * punishes them for being ill; counting it as attendance would let an excuse
 * inflate a rate above what they actually attended.
 */
export function countsTowardTotal(status: ClassAttendanceStatus): boolean {
  return status !== 'EXCUSED';
}

export interface AttendanceTally {
  /** PRESENT + LATE. */
  attended: number;
  /** ABSENT. */
  missed: number;
  /** EXCUSED — recorded, and outside the percentage. */
  excused: number;
  /** attended + missed. The denominator. */
  counted: number;
  /**
   * Null when `counted` is zero, NEVER zero.
   *
   * DECISION 3 — no register means no percentage, not 0%.
   *
   * A student on a course whose lecturer has not yet taken a register has not
   * attended 0% of it; there is simply nothing known. Returning 0 here would
   * put every student in a new installation at the bottom of an eligibility
   * report on their first day, and somebody would act on it.
   */
  percentage: number | null;
}

export function tally(statuses: readonly ClassAttendanceStatus[]): AttendanceTally {
  let attended = 0;
  let missed = 0;
  let excused = 0;

  for (const status of statuses) {
    if (!countsTowardTotal(status)) {
      excused += 1;
      continue;
    }
    if (countsAsAttended(status)) attended += 1;
    else missed += 1;
  }

  const counted = attended + missed;
  return {
    attended,
    missed,
    excused,
    counted,
    percentage: counted === 0 ? null : (attended / counted) * 100,
  };
}

// -----------------------------------------------------------------------------
// Eligibility to sit the examination
// -----------------------------------------------------------------------------

export const ELIGIBILITY_VERDICTS = [
  'UNKNOWN',
  'ELIGIBLE',
  'AT_RISK',
  'BELOW',
  'BARRED',
] as const;
export type EligibilityVerdict = (typeof ELIGIBILITY_VERDICTS)[number];

export interface AttendancePolicyInput {
  /** At or above this percentage, a student may sit. */
  examEligibilityThreshold: number;
  /** At or above the bar but below this, they are warned. */
  warningThreshold: number;
  /**
   * DECISION 4 — the rule is OFF until a school turns it on.
   *
   * A newly installed system has no attendance history. Enforcing a 75% rule
   * against an empty register would bar an entire cohort on day one, and the
   * damage would be done before anybody understood why. So a school opts in,
   * deliberately, once it is actually taking registers.
   *
   * When this is false the percentages are still computed and shown — a
   * lecturer can see who is slipping — but nothing is ever BARRED.
   */
  enforced: boolean;
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicyInput = {
  examEligibilityThreshold: 75,
  warningThreshold: 80,
  enforced: false,
};

/**
 * The verdict for one student on one course.
 *
 * UNKNOWN is a real answer and is returned whenever no register has been taken.
 * It is deliberately not folded into ELIGIBLE: "we have no record" and "they
 * attended enough" are different things to show a student three days before an
 * examination, and a registry that cannot tell them apart will eventually tell
 * somebody the wrong one.
 */
export function eligibilityFor(
  tallied: AttendanceTally,
  policy: AttendancePolicyInput = DEFAULT_ATTENDANCE_POLICY,
): EligibilityVerdict {
  if (tallied.percentage === null) return 'UNKNOWN';
  if (tallied.percentage >= policy.warningThreshold) return 'ELIGIBLE';

  /*
   * Above the bar but under the warning line: genuinely close, and the
   * warning exists to give them time to do something about it.
   */
  if (tallied.percentage >= policy.examEligibilityThreshold) return 'AT_RISK';

  /*
   * Below the bar. BELOW and BARRED are the same FACT and different
   * CONSEQUENCES, and they are separate verdicts because folding them
   * together made the product lie: a student on 0% was shown the AT_RISK
   * copy and told they were "close to" the 75% they needed. Somebody at 0%
   * is not close to anything, and being told otherwise is exactly the kind
   * of reassurance that stops them acting.
   */
  return policy.enforced ? 'BARRED' : 'BELOW';
}

/**
 * How many more consecutive classes this student must attend to clear the bar.
 *
 * The number a student actually wants, and the one a lecturer is asked for in
 * week nine. Returns 0 when they are already above it, and null when it cannot
 * be reached — which is a kinder thing to say than a number that is arithmetic
 * nonsense.
 */
export function classesNeededToClear(
  tallied: AttendanceTally,
  policy: AttendancePolicyInput = DEFAULT_ATTENDANCE_POLICY,
): number | null {
  if (tallied.percentage === null) return null;
  if (tallied.percentage >= policy.examEligibilityThreshold) return 0;

  const target = policy.examEligibilityThreshold / 100;
  // (attended + n) / (counted + n) >= target  =>  n >= (target*counted - attended) / (1 - target)
  if (target >= 1) return null;
  const needed = (target * tallied.counted - tallied.attended) / (1 - target);
  const whole = Math.ceil(needed - 1e-9);
  return whole > 0 ? whole : 0;
}

export function formatRate(tallied: AttendanceTally): string {
  if (tallied.percentage === null) return 'No register taken';
  // One decimal place: 74.9% and 75.1% are different answers to "may I sit?"
  // and rounding them both to 75% hides the only distinction that matters.
  return `${tallied.percentage.toFixed(1)}%`;
}

// -----------------------------------------------------------------------------
// Taking the register
// -----------------------------------------------------------------------------

export interface RegisterMark {
  enrollmentId: string;
  status: ClassAttendanceStatus;
}

/**
 * Validate a submitted register.
 *
 * `roster` is the enrolments the session is allowed to cover. A mark for anyone
 * else is rejected rather than ignored: a register that silently drops rows
 * tells a lecturer it saved when it did not.
 */
export function validateRegister(
  marks: readonly RegisterMark[],
  roster: readonly string[],
): string[] {
  const problems: string[] = [];
  const allowed = new Set(roster);
  const seen = new Set<string>();

  for (const mark of marks) {
    if (!isAttendanceStatus(mark.status)) {
      problems.push(`"${String(mark.status)}" is not an attendance status.`);
      continue;
    }
    if (!allowed.has(mark.enrollmentId)) {
      problems.push('That register includes somebody who is not on this course.');
      continue;
    }
    if (seen.has(mark.enrollmentId)) {
      problems.push('That register marks the same student twice.');
      continue;
    }
    seen.add(mark.enrollmentId);
  }

  // Deduplicate: one of each complaint is a correction, five is a wall.
  return [...new Set(problems)];
}

/**
 * A register that has not been taken yet.
 *
 * Everyone PRESENT, because that is what is true of most people most of the
 * time and a lecturer marking thirty exceptions is slower and more error-prone
 * than one marking three. The opposite default — everyone absent until ticked —
 * turns a forgotten register into a cohort of absences nobody intended.
 */
export function blankRegister(roster: readonly string[]): RegisterMark[] {
  return roster.map((enrollmentId) => ({ enrollmentId, status: 'PRESENT' as const }));
}

/**
 * Does this session accept a register at all?
 *
 * A cancelled class produces no attendance. Nobody was absent from a lecture
 * that did not happen, and letting a cancellation carry absences is how a
 * student ends up barred for a class the lecturer called off.
 */
export function sessionAcceptsRegister(status: string): boolean {
  return status === 'DELIVERED';
}
