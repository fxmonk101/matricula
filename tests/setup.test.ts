import { describe, expect, it } from 'vitest';

import {
  SETUP_STEPS,
  nextStep,
  resolveSteps,
  setupProgress,
  type SetupState,
  type SetupStepId,
} from '@/lib/domain/setup';
import { guardForPath } from '@/lib/auth/rbac';
import type { AcademicModel } from '@/lib/domain/enums';

function states(done: SetupStepId[]): Map<SetupStepId, SetupState> {
  return new Map(done.map((id) => [id, { id, done: true }]));
}

describe('the setup checklist', () => {
  it('shows a university its courses and a K-12 school its subjects', () => {
    // Rendering the wrong vocabulary is the fastest way to make a product feel
    // like it was built for somebody else.
    const uni = resolveSteps('HIGHER_ED', states([]));
    const k12 = resolveSteps('K12', states([]));
    expect(uni.map((s) => s.href)).toContain('/courses');
    expect(uni.map((s) => s.href)).not.toContain('/classes');
    expect(k12.map((s) => s.href)).toContain('/classes');
    expect(k12.map((s) => s.href)).not.toContain('/courses');
  });

  it('offers exactly one curriculum step per model', () => {
    for (const model of ['HIGHER_ED', 'K12'] as AcademicModel[]) {
      const curriculum = resolveSteps(model, states([])).filter((s) => s.id === 'curriculum');
      expect(curriculum, model).toHaveLength(1);
    }
  });

  it('blocks a step whose prerequisite is not done', () => {
    // A step shown as available that immediately dead-ends is worse than one
    // shown as blocked with a reason: the user assumes they did it wrong.
    const steps = resolveSteps('HIGHER_ED', states([]));
    expect(steps[0].available).toBe(true);
    expect(steps[1].available).toBe(false);
    expect(steps.filter((s) => s.available)).toHaveLength(1);
  });

  it('unblocks the next step as each one is completed', () => {
    const first = resolveSteps('HIGHER_ED', states(['branding']));
    expect(first[0].done).toBe(true);
    expect(first[1].available).toBe(true);
    expect(first[2].available).toBe(false);
  });

  it('does not let an optional step block the ones after it', () => {
    // Fees matter enormously and are still not a reason to hold up a term.
    const all: SetupStepId[] = [
      'branding', 'locale', 'grading', 'terms', 'structure', 'curriculum', 'staff', 'students',
    ];
    const steps = resolveSteps('HIGHER_ED', states(all));
    expect(steps.every((s) => s.available)).toBe(true);
    const finance = steps.find((s) => s.id === 'finance');
    expect(finance?.optional).toBe(true);
    expect(finance?.done).toBe(false);
  });

  it('reaches 100% without the optional steps', () => {
    const all: SetupStepId[] = [
      'branding', 'locale', 'grading', 'terms', 'structure', 'curriculum', 'staff', 'students',
    ];
    expect(setupProgress(resolveSteps('HIGHER_ED', states(all)))).toBe(100);
  });

  it('starts at 0% and never exceeds 100', () => {
    expect(setupProgress(resolveSteps('HIGHER_ED', states([])))).toBe(0);
    const everything = SETUP_STEPS.map((s) => s.id);
    expect(setupProgress(resolveSteps('K12', states(everything)))).toBe(100);
  });

  it('points at the first unfinished REQUIRED step, not the first unfinished one', () => {
    const steps = resolveSteps('HIGHER_ED', states(['branding', 'locale']));
    expect(nextStep(steps)?.id).toBe('grading');
  });

  it('falls back to an optional step once the required ones are done', () => {
    const all: SetupStepId[] = [
      'branding', 'locale', 'grading', 'terms', 'structure', 'curriculum', 'staff', 'students',
    ];
    expect(nextStep(resolveSteps('HIGHER_ED', states(all)))?.id).toBe('finance');
  });

  it('has nothing to point at when everything is done', () => {
    const everything = SETUP_STEPS.map((s) => s.id);
    expect(nextStep(resolveSteps('HIGHER_ED', states(everything)))).toBeNull();
  });
});

describe('checklist links', () => {
  it('sends an administrator only to pages an administrator can open', () => {
    // A checklist that links to /forbidden is a checklist that cannot be
    // completed, and the user has no way to know it is the app's fault.
    for (const step of SETUP_STEPS) {
      const path = step.href.split('?')[0];
      const guard = guardForPath(path);
      if (!guard) continue;
      expect(guard.roles.includes('ADMIN'), `${step.title} → ${path}`).toBe(true);
    }
  });

  it('gives every step a destination and a reason', () => {
    for (const step of SETUP_STEPS) {
      expect(step.href.startsWith('/'), step.title).toBe(true);
      expect(step.description.length, step.title).toBeGreaterThan(20);
    }
  });
});
