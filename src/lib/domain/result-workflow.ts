import type { Role } from './enums';

/**
 * =============================================================================
 * HOW A MARK BECOMES A RESULT
 * =============================================================================
 *
 * Until now it did not become anything: a lecturer typing a score into the
 * gradesheet set the enrolment to COMPLETED, recomputed the CGPA and put the
 * grade on the student's transcript in the same request. A typo in week six
 * was a published degree classification, and there was no moment at which
 * anybody decided results were ready.
 *
 * That is not how a university works, and in this market it is not optional.
 * A result passes through a chain — the lecturer submits, the head of
 * department vets the spread, the faculty board reviews, Senate approves — and
 * only then is it RELEASED to students. Each step is a person, on a date, who
 * can be named afterwards when somebody disputes a mark.
 *
 * WHAT THIS MODULE IS. The stages, the order, who may act at each, and what
 * "released" means. It touches no database and no session; the service reads
 * these answers and the pages render them.
 *
 * WHAT IT IS NOT. A general workflow engine. The chain is fixed because the
 * chain IS fixed — a school that does not convene a faculty board turns that
 * stage off, it does not invent a new one.
 */

export const RESULT_STAGES = [
  /** The lecturer is still entering marks. Nothing is on any record. */
  'DRAFT',
  /** Submitted by the lecturer, waiting on the head of department. */
  'HOD_REVIEW',
  /** Passed by the HOD, waiting on the faculty board. */
  'FACULTY_REVIEW',
  /** Passed by the faculty, waiting on Senate. */
  'SENATE_REVIEW',
  /** Approved. Visible to students, on the transcript, counted in the CGPA. */
  'RELEASED',
] as const;
export type ResultStage = (typeof RESULT_STAGES)[number];

export const STAGE_LABELS: Record<ResultStage, string> = {
  DRAFT: 'Being marked',
  HOD_REVIEW: 'With the head of department',
  FACULTY_REVIEW: 'With the faculty board',
  SENATE_REVIEW: 'With Senate',
  RELEASED: 'Released to students',
};

/**
 * What a student is told at each stage.
 *
 * Deliberately different from the labels above. "With Senate" is a fact about
 * an office and means nothing to somebody refreshing a results page; "Your
 * results are being approved" is what they need to know. Neither wording ever
 * shows a mark that has not been released.
 */
export const STUDENT_STAGE_LABELS: Record<ResultStage, string> = {
  DRAFT: 'Not yet marked',
  HOD_REVIEW: 'Being approved',
  FACULTY_REVIEW: 'Being approved',
  SENATE_REVIEW: 'Being approved',
  RELEASED: 'Released',
};

export function isResultStage(value: unknown): value is ResultStage {
  return (RESULT_STAGES as readonly unknown[]).includes(value);
}

/**
 * Which stages this school actually uses.
 *
 * Every one defaults to ON, because the safe direction for an approval chain
 * is more approval rather than less: a school that quietly skipped Senate
 * because a flag defaulted false would be publishing unapproved results and
 * would not find out until somebody asked for the minutes.
 */
export interface ResultWorkflowPolicy {
  requireHod: boolean;
  requireFaculty: boolean;
  requireSenate: boolean;
}

export const DEFAULT_RESULT_WORKFLOW: ResultWorkflowPolicy = {
  requireHod: true,
  requireFaculty: true,
  requireSenate: true,
};

const STAGE_REQUIREMENT: Record<
  Exclude<ResultStage, 'DRAFT' | 'RELEASED'>,
  keyof ResultWorkflowPolicy
> = {
  HOD_REVIEW: 'requireHod',
  FACULTY_REVIEW: 'requireFaculty',
  SENATE_REVIEW: 'requireSenate',
};

/**
 * The stage after this one, skipping any the school has turned off.
 *
 * A school with every stage disabled goes straight from DRAFT to RELEASED on
 * submission, which is the old behaviour and is exactly what such a school has
 * asked for — stated here rather than left as an accident of the loop.
 */
export function nextStage(
  current: ResultStage,
  policy: ResultWorkflowPolicy = DEFAULT_RESULT_WORKFLOW,
): ResultStage {
  if (current === 'RELEASED') return 'RELEASED';

  const order = RESULT_STAGES;
  for (let i = order.indexOf(current) + 1; i < order.length; i += 1) {
    const stage = order[i];
    if (stage === 'RELEASED') return 'RELEASED';
    if (policy[STAGE_REQUIREMENT[stage as keyof typeof STAGE_REQUIREMENT]]) return stage;
  }
  return 'RELEASED';
}

/** Every stage this sheet will pass through, for showing progress. */
export function stagesFor(policy: ResultWorkflowPolicy = DEFAULT_RESULT_WORKFLOW): ResultStage[] {
  const out: ResultStage[] = ['DRAFT'];
  let stage: ResultStage = 'DRAFT';
  while (stage !== 'RELEASED') {
    stage = nextStage(stage, policy);
    out.push(stage);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Who may act
// -----------------------------------------------------------------------------

/**
 * The roles that may APPROVE at each stage.
 *
 * OWNER and ADMIN are absent from every one, and that is the point. An
 * administrator can already do almost anything in this system; letting them
 * wave results through would make the whole chain decorative, and the chain
 * exists precisely so that no single account can turn a mark into a degree
 * classification. REGISTRAR carries Senate's decision because that is who
 * minutes it in practice.
 */
const APPROVERS: Record<Exclude<ResultStage, 'DRAFT' | 'RELEASED'>, readonly Role[]> = {
  HOD_REVIEW: ['HOD'],
  FACULTY_REVIEW: ['DEAN'],
  SENATE_REVIEW: ['REGISTRAR'],
};

export function mayApprove(stage: ResultStage, role: Role): boolean {
  if (stage === 'DRAFT' || stage === 'RELEASED') return false;
  return APPROVERS[stage].includes(role);
}

/** The roles that may submit a sheet in the first place. */
export function maySubmit(role: Role): boolean {
  return role === 'INSTRUCTOR' || role === 'HOD' || role === 'DEAN';
}

/**
 * May this person send the sheet back to the lecturer?
 *
 * Anybody who could have approved it at the stage it is sitting at. A reviewer
 * who can only say yes is not reviewing.
 */
export function mayReturn(stage: ResultStage, role: Role): boolean {
  return mayApprove(stage, role);
}

/** Who is being waited on, in words a page can print. */
export function waitingOn(stage: ResultStage): string | null {
  if (stage === 'DRAFT') return 'the lecturer';
  if (stage === 'RELEASED') return null;
  const roles = APPROVERS[stage];
  return roles.join(' or ').toLowerCase();
}

// -----------------------------------------------------------------------------
// What the stage means
// -----------------------------------------------------------------------------

/**
 * Are these marks part of the academic record?
 *
 * The single question the transcript, the CGPA and the student's own page all
 * ask. Written once so that three screens cannot answer it differently.
 */
export function isReleased(stage: ResultStage): boolean {
  return stage === 'RELEASED';
}

/** Is the lecturer still able to change the marks? */
export function isEditable(stage: ResultStage): boolean {
  // Only in DRAFT. Once submitted, a mark changing underneath a reviewer who
  // has already approved it is the failure the whole chain exists to prevent.
  return stage === 'DRAFT';
}

export interface SubmissionReadiness {
  ok: boolean;
  reason?: string;
}

/**
 * May this sheet be submitted?
 *
 * A partly-marked sheet is the commonest thing somebody tries to send, and
 * refusing it here — with the count — is kinder than an HOD returning it a
 * week later.
 */
export function readyToSubmit(params: {
  stage: ResultStage;
  total: number;
  graded: number;
}): SubmissionReadiness {
  if (params.stage !== 'DRAFT') {
    return { ok: false, reason: 'These results have already been submitted.' };
  }
  if (params.total === 0) {
    return { ok: false, reason: 'Nobody is registered on this section.' };
  }

  const missing = params.total - params.graded;
  if (missing > 0) {
    return {
      ok: false,
      reason: `${missing} of ${params.total} students ${missing === 1 ? 'has' : 'have'} no mark yet.`,
    };
  }

  return { ok: true };
}
