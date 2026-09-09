import type { AcademicModel } from './enums';

/**
 * =============================================================================
 * SCHOOL SETUP CHECKLIST
 * =============================================================================
 *
 * What a newly provisioned school has to do before it can be used, in the order
 * that makes each step possible.
 *
 * The ordering is not cosmetic. A course belongs to a department, a section
 * belongs to a term, a pupil is enrolled into a class — so a school that starts
 * by adding pupils gets three steps in and finds it cannot finish. Presenting
 * the dependency order up front is the difference between a school setting
 * itself up in an afternoon and a school raising a support ticket.
 *
 * Each step LINKS to the real page rather than duplicating it. A wizard with
 * its own forms is a second implementation of every rule, and the two diverge.
 */

export type SetupStepId =
  | 'branding'
  | 'locale'
  | 'grading'
  | 'terms'
  | 'structure'
  | 'curriculum'
  | 'staff'
  | 'students'
  | 'finance';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  /** What this step is for, in the words of somebody running a school. */
  description: string;
  href: string;
  /** Omit to apply to every academic model. */
  models?: AcademicModel[];
  /**
   * A step the school can open without, and be sensible. Fee structures matter
   * enormously and are still not a reason to hold up the first term.
   */
  optional?: boolean;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: 'branding',
    title: 'Name and logo',
    description:
      'What appears on report cards, invoices and the sign-in page. Parents recognise the crest before they read the name.',
    href: '/settings/school?tab=branding',
  },
  {
    id: 'locale',
    title: 'Timezone and dates',
    description:
      'Which day a register belongs to, and when a deadline falls. Get this wrong and every timestamp in the school is an hour out.',
    href: '/settings/school?tab=locale',
  },
  {
    id: 'grading',
    title: 'Grading scheme',
    description:
      'The scale, the pass mark, and how continuous assessment and examinations are weighted. Every mark ever entered is read against this.',
    href: '/settings/school?tab=grading',
  },
  {
    id: 'terms',
    title: 'Terms',
    description:
      'The academic calendar. Nothing can be timetabled, registered or assessed outside a term, so this comes before the teaching.',
    href: '/settings/structure?tab=terms',
  },
  {
    id: 'structure',
    title: 'Departments and programmes',
    description:
      'The shape of the school. Courses hang off departments and pupils belong to year groups, so this comes before either.',
    href: '/settings/structure',
  },
  {
    id: 'curriculum',
    title: 'Courses and subjects',
    description: 'What is actually taught, and who teaches it.',
    href: '/courses',
    models: ['HIGHER_ED'],
  },
  {
    id: 'curriculum',
    title: 'Subjects and classes',
    description: 'What is actually taught, and which class sits it.',
    href: '/classes',
    models: ['K12'],
  },
  {
    id: 'staff',
    title: 'Staff',
    description:
      'Teachers, the registry, the bursary. Each gets a one-time password to hand over; they set their own on first sign-in.',
    href: '/people',
  },
  {
    id: 'students',
    title: 'Students',
    description:
      'Enrol your first intake, or open the public application form and let them apply.',
    href: '/students',
  },
  {
    id: 'finance',
    title: 'Fees',
    description:
      'What is charged, to whom, and when. The school can open without this and add it before the first invoice run.',
    href: '/settings/school?tab=finance',
    optional: true,
  },
];

export interface SetupState {
  id: SetupStepId;
  done: boolean;
  /** What has been done so far, e.g. "3 departments". Shown beside the step. */
  detail?: string;
}

export interface ResolvedStep extends SetupStep {
  done: boolean;
  detail?: string;
  /**
   * Every earlier REQUIRED step is done, so this one can be attempted. A step
   * shown as available that immediately dead-ends is worse than one shown as
   * blocked with a reason.
   */
  available: boolean;
}

/**
 * Combine the step definitions with what the school has actually done.
 *
 * An OPTIONAL step never blocks the ones after it — that is what optional
 * means — but it does still appear in the list, because a school that never
 * sets its fees has not finished, it has just not finished that.
 */
export function resolveSteps(
  academicModel: AcademicModel,
  states: ReadonlyMap<SetupStepId, SetupState>,
): ResolvedStep[] {
  const applicable = SETUP_STEPS.filter((s) => !s.models || s.models.includes(academicModel));

  let blocked = false;
  return applicable.map((step) => {
    const state = states.get(step.id);
    const done = state?.done ?? false;
    const resolved: ResolvedStep = {
      ...step,
      done,
      detail: state?.detail,
      available: !blocked,
    };
    if (!done && !step.optional) blocked = true;
    return resolved;
  });
}

/** 0-100 over the REQUIRED steps. Optional ones cannot hold a school at 90%. */
export function setupProgress(steps: readonly ResolvedStep[]): number {
  const required = steps.filter((s) => !s.optional);
  if (required.length === 0) return 100;
  return Math.round((required.filter((s) => s.done).length / required.length) * 100);
}

/** The step to point somebody at. Null when everything required is done. */
export function nextStep(steps: readonly ResolvedStep[]): ResolvedStep | null {
  return steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done) ?? null;
}
