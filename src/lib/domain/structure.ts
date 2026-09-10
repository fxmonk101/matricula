/**
 * =============================================================================
 * ACADEMIC STRUCTURE
 * =============================================================================
 *
 * Pure rules for the shape of a university: faculties, departments, programmes
 * and courses.
 *
 * The ordering is a dependency, not a preference. A department belongs to a
 * faculty, a programme to a department, a course to a department, a section to
 * a course and a term. So a university that starts by entering courses gets two
 * screens in and finds it cannot finish — which is why the setup checklist
 * presents them in this order and why each service below refuses a parent that
 * does not exist.
 */

export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructureError';
  }
}

// -----------------------------------------------------------------------------
// Codes
// -----------------------------------------------------------------------------

/**
 * Faculty, department and programme codes.
 *
 * Upper-case, 2–12 characters, letters and digits. These are quoted aloud in
 * registry offices, printed on transcripts and typed into spreadsheets — so
 * they exclude punctuation that a spreadsheet would interpret and lower case
 * that a human would transcribe inconsistently.
 */
const UNIT_CODE = /^[A-Z0-9]{2,12}$/;

/**
 * Course codes, which carry a level: `CSC101`, `MTH 201`, `GEN-101`.
 *
 * Deliberately looser than a unit code — universities have wildly different
 * conventions and refusing a real one because it has a hyphen is the sort of
 * rule that gets a product rejected in the first demonstration.
 */
const COURSE_CODE = /^[A-Z0-9][A-Z0-9 \-.]{1,15}$/;

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function isValidUnitCode(code: string): boolean {
  return UNIT_CODE.test(normaliseCode(code));
}

export function isValidCourseCode(code: string): boolean {
  return COURSE_CODE.test(normaliseCode(code));
}

export function codeRejectionReason(code: string, kind: 'unit' | 'course'): string | null {
  const value = normaliseCode(code);
  if (value.length === 0) return 'Enter a code.';
  if (value.length < 2) return 'A code needs at least two characters.';
  if (kind === 'unit') {
    if (value.length > 12) return 'A code can be at most 12 characters.';
    if (!UNIT_CODE.test(value)) return 'Use capital letters and digits only.';
    return null;
  }
  if (value.length > 16) return 'A course code can be at most 16 characters.';
  if (!COURSE_CODE.test(value)) {
    return 'Use capital letters, digits, spaces, hyphens or full stops.';
  }
  return null;
}

/**
 * The level a course code implies — `CSC101` → 100, `MTH 205` → 200.
 *
 * Offered as a SUGGESTION, never enforced. Most West African universities
 * encode the level in the number and typing it twice is an invitation to
 * disagree with yourself; but plenty of institutions do not, so a code that
 * carries no level is not an error.
 */
export function levelFromCourseCode(code: string): number | null {
  const digits = normaliseCode(code).match(/(\d{3,4})\s*$/)?.[1];
  if (!digits) return null;
  const level = Math.floor(Number(digits) / 100) * 100;
  return level >= 100 && level <= 900 ? level : null;
}

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

export function validateName(name: string, what: string): string | null {
  const value = name.trim();
  if (value.length < 2) return `Enter a ${what} name.`;
  if (value.length > 120) return `That ${what} name is too long.`;
  return null;
}

// -----------------------------------------------------------------------------
// Credits and levels
// -----------------------------------------------------------------------------

export const LEVELS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function validateCredits(credits: number): string | null {
  if (!Number.isFinite(credits)) return 'Enter the credit value.';
  if (!Number.isInteger(credits)) return 'Credits must be a whole number.';
  if (credits < 0) return 'Credits cannot be negative.';
  // Zero is legitimate: a compulsory non-credit course (use of English, an
  // industrial attachment seminar) is a real thing and carries no credit.
  if (credits > 60) return 'That is more credits than any single course carries.';
  return null;
}

export function validateLevel(level: number): string | null {
  if (!LEVELS.includes(level as (typeof LEVELS)[number])) {
    return 'Choose a level between 100 and 900.';
  }
  return null;
}

// -----------------------------------------------------------------------------
// Programmes
// -----------------------------------------------------------------------------

export const DEGREE_TYPES = [
  'BSC', 'BA', 'BENG', 'BED', 'LLB', 'MBBS',
  'PGD', 'MSC', 'MA', 'MENG', 'MBA', 'PHD',
  'HND', 'OND', 'CERT', 'DIPLOMA',
] as const;
export type DegreeType = (typeof DEGREE_TYPES)[number];

export const DEGREE_LABELS: Record<DegreeType, string> = {
  BSC: 'B.Sc.', BA: 'B.A.', BENG: 'B.Eng.', BED: 'B.Ed.', LLB: 'LL.B.', MBBS: 'MBBS',
  PGD: 'PGD', MSC: 'M.Sc.', MA: 'M.A.', MENG: 'M.Eng.', MBA: 'MBA', PHD: 'Ph.D.',
  HND: 'HND', OND: 'OND', CERT: 'Certificate', DIPLOMA: 'Diploma',
};

export function isDegreeType(value: string): value is DegreeType {
  return (DEGREE_TYPES as readonly string[]).includes(value);
}

export interface ProgrammeDraft {
  code: string;
  name: string;
  degreeType: string;
  totalCredits: number;
  durationTerms: number;
  minCgpa: number;
}

/** Every problem at once, not the first — this form has six fields. */
export function validateProgramme(draft: ProgrammeDraft, maxGradePoint: number): string[] {
  const problems: string[] = [];

  const codeProblem = codeRejectionReason(draft.code, 'unit');
  if (codeProblem) problems.push(codeProblem);

  const nameProblem = validateName(draft.name, 'programme');
  if (nameProblem) problems.push(nameProblem);

  if (!isDegreeType(draft.degreeType)) problems.push('Choose an award.');

  if (!Number.isInteger(draft.totalCredits) || draft.totalCredits < 1) {
    problems.push('Enter the total credits required to graduate.');
  } else if (draft.totalCredits > 600) {
    problems.push('That is more credits than any programme requires.');
  }

  if (!Number.isInteger(draft.durationTerms) || draft.durationTerms < 1) {
    problems.push('Enter how many terms the programme runs for.');
  } else if (draft.durationTerms > 24) {
    problems.push('That is longer than any programme runs.');
  }

  // Checked against THIS school's scale rather than a hard-coded 4.0: a
  // minimum CGPA of 2.0 means something different on a 5-point scale, and a
  // school on a 5-point scale entering 2.5 must not be told it is invalid.
  if (!Number.isFinite(draft.minCgpa) || draft.minCgpa < 0) {
    problems.push('Enter the minimum CGPA to remain in good standing.');
  } else if (draft.minCgpa > maxGradePoint) {
    problems.push(`The minimum CGPA cannot exceed this school's scale of ${maxGradePoint}.`);
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Archiving
// -----------------------------------------------------------------------------

export interface DependencyCount {
  label: string;
  count: number;
}

/**
 * Why something cannot be deleted, in words a registrar can act on.
 *
 * Structure is referenced by records that must survive it: a graduate's
 * transcript names a programme that the university stopped offering in 2019,
 * and deleting the programme would either fail on a foreign key or orphan the
 * transcript. So the rule is archive-by-default, and a hard delete is offered
 * only when nothing points at the row.
 */
export function deletionBlockers(dependencies: DependencyCount[]): string | null {
  const blocking = dependencies.filter((d) => d.count > 0);
  if (blocking.length === 0) return null;

  const parts = blocking.map((d) => `${d.count} ${d.label}${d.count === 1 ? '' : 's'}`);
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `This still has ${list} attached. Archive it instead — records that already reference it have to keep working.`;
}
