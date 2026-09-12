/**
 * =============================================================================
 * STUDENT REGISTRATION
 * =============================================================================
 *
 * Pure rules for admitting a person as a student of the institution.
 *
 * WHY THIS IS SEPARATE FROM ADMISSIONS
 * ------------------------------------
 * `admissions.service.ts` already converts an accepted APPLICATION into a
 * student, and that path is untouched. This is the other one, and in most West
 * African universities it is the larger of the two: direct entry, transfers,
 * students returning from deferral, and — the case that matters most on day one
 * — the several thousand students a university already has when it starts using
 * the system at all. None of those has an application to convert.
 *
 * The office is the BURSARY, not the registry. A student is not registered
 * until their fees are settled, and the desk that confirms the payment is the
 * desk that issues the matriculation number. Modelling it anywhere else
 * describes a process no school actually follows.
 */

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

// -----------------------------------------------------------------------------
// Matriculation numbers
// -----------------------------------------------------------------------------

/**
 * The shape a matriculation number may take when it is typed IN rather than
 * generated.
 *
 * Deliberately permissive. The system's own format is `GEU/CSC/2025/0417`, but
 * a university migrating twenty years of records has numbers in half a dozen
 * historical formats and every one of them is the number printed on a real
 * certificate. Refusing those would mean either losing them or inventing new
 * ones, and inventing a new matriculation number for an existing student is
 * the single most destructive thing this software could do to a record.
 *
 * So: anything that is quotable and unambiguous. No control characters, no
 * leading or trailing separators, and a length a human can read aloud.
 */
const MATRIC = /^[A-Z0-9][A-Z0-9/\-. ]{2,30}[A-Z0-9]$/;

export function normaliseMatric(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function isValidMatric(raw: string): boolean {
  return MATRIC.test(normaliseMatric(raw));
}

export function matricRejectionReason(raw: string): string | null {
  const value = normaliseMatric(raw);
  if (value.length === 0) return 'Enter a matriculation number.';
  if (value.length < 4) return 'A matriculation number needs at least four characters.';
  if (value.length > 32) return 'That matriculation number is too long.';
  if (!/^[A-Z0-9]/.test(value)) return 'It must start with a letter or number.';
  if (!/[A-Z0-9]$/.test(value)) return 'It must end with a letter or number.';
  if (!MATRIC.test(value)) {
    return 'Use letters, numbers, and only slashes, hyphens, full stops or spaces.';
  }
  return null;
}

// -----------------------------------------------------------------------------
// Level of study
// -----------------------------------------------------------------------------

/**
 * Is this level plausible for a programme of this length?
 *
 * A four-year programme runs 100 to 400. Admitting somebody at 500 is not a
 * typo the system should absorb silently: it puts a student on a level the
 * programme has no courses for, and the first thing anybody notices is an
 * empty registration screen weeks later.
 *
 * Terms are converted to years at two per year, which is the near-universal
 * arrangement in this market. A school on trimesters would want three, which
 * is why the divisor is a parameter rather than a constant buried in the sum.
 */
export function levelsForProgramme(durationTerms: number, termsPerYear = 2): number[] {
  const years = Math.max(1, Math.ceil(durationTerms / Math.max(1, termsPerYear)));
  return Array.from({ length: years }, (_, i) => (i + 1) * 100);
}

export function validateLevelForProgramme(
  level: number,
  durationTerms: number,
  termsPerYear = 2,
): string | null {
  const allowed = levelsForProgramme(durationTerms, termsPerYear);
  if (allowed.includes(level)) return null;
  const highest = allowed[allowed.length - 1];
  return `This programme runs to level ${highest}. Choose a level between 100 and ${highest}.`;
}

// -----------------------------------------------------------------------------
// The draft
// -----------------------------------------------------------------------------

export const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;
export type Gender = (typeof GENDERS)[number];

export interface RegistrationDraft {
  firstName: string;
  lastName: string;
  /** Either may be absent, but not both — see `validateIdentifiers`. */
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  programmeId: string;
  level: number;
  /** Blank means "generate one". */
  matricNumber?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  address?: string | null;
}

/**
 * A date of birth, rejected on the two failures that matter.
 *
 * In the future is obviously wrong. Implausibly old catches the other common
 * error, which is a year typed as the current one — a student born in 2026
 * and a student born in 1900 are both data-entry slips, and both silently
 * corrupt any age-based report the registry later runs.
 */
export function validateDateOfBirth(value: string, now = new Date()): string | null {
  if (!value.trim()) return null; // optional

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Enter a valid date of birth.';
  if (parsed.getTime() > now.getTime()) return 'A date of birth cannot be in the future.';

  const years = (now.getTime() - parsed.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 10) return 'That date of birth would make this student under ten years old.';
  if (years > 100) return 'That date of birth is more than a hundred years ago.';
  return null;
}

/** Every problem at once — this form has eleven fields. */
export function validateRegistration(
  draft: RegistrationDraft,
  programme: { durationTerms: number } | null,
  identifierProblems: string[],
  now = new Date(),
): string[] {
  const problems: string[] = [...identifierProblems];

  if (draft.firstName.trim().length < 1) problems.push('Enter a first name.');
  if (draft.lastName.trim().length < 1) problems.push('Enter a last name.');
  if (draft.firstName.trim().length > 80 || draft.lastName.trim().length > 80) {
    problems.push('Names must be 80 characters or fewer.');
  }

  if (!draft.programmeId) {
    problems.push('Choose a programme.');
  } else if (programme) {
    const levelProblem = validateLevelForProgramme(draft.level, programme.durationTerms);
    if (levelProblem) problems.push(levelProblem);
  }

  if (draft.matricNumber && draft.matricNumber.trim()) {
    const reason = matricRejectionReason(draft.matricNumber);
    if (reason) problems.push(reason);
  }

  if (draft.dateOfBirth) {
    const reason = validateDateOfBirth(draft.dateOfBirth, now);
    if (reason) problems.push(reason);
  }

  if (draft.phone && draft.phone.trim().length > 32) {
    problems.push('That phone number is too long.');
  }

  return problems;
}
