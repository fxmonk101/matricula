import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESULT_WORKFLOW,
  RESULT_STAGES,
  isEditable,
  isReleased,
  mayApprove,
  mayReturn,
  maySubmit,
  nextStage,
  readyToSubmit,
  stagesFor,
  waitingOn,
  type ResultStage,
} from '@/lib/domain/result-workflow';
import { ROLES, type Role } from '@/lib/domain/enums';

/*
 * How a mark becomes a result.
 *
 * The chain exists so that no single account can turn a typo into a degree
 * classification. Most of what follows is therefore about who CANNOT do
 * something, which is the half that is easy to get wrong and impossible to
 * notice.
 */

describe('the order of the chain', () => {
  it('goes lecturer, HOD, faculty, Senate, released', () => {
    expect(stagesFor(DEFAULT_RESULT_WORKFLOW)).toEqual([
      'DRAFT',
      'HOD_REVIEW',
      'FACULTY_REVIEW',
      'SENATE_REVIEW',
      'RELEASED',
    ]);
  });

  it('requires every stage by default', () => {
    /*
     * The safe direction. A school that quietly skipped Senate because a flag
     * defaulted false would be publishing unapproved results and would not
     * find out until somebody asked for the minutes.
     */
    expect(DEFAULT_RESULT_WORKFLOW).toEqual({
      requireHod: true,
      requireFaculty: true,
      requireSenate: true,
    });
  });

  it('skips the stages a school has turned off', () => {
    const noFaculty = { requireHod: true, requireFaculty: false, requireSenate: true };
    expect(nextStage('DRAFT', noFaculty)).toBe('HOD_REVIEW');
    expect(nextStage('HOD_REVIEW', noFaculty)).toBe('SENATE_REVIEW');
    expect(stagesFor(noFaculty)).toEqual(['DRAFT', 'HOD_REVIEW', 'SENATE_REVIEW', 'RELEASED']);
  });

  it('goes straight to released when a school uses no chain at all', () => {
    // The old behaviour, and exactly what such a school has asked for — said
    // out loud rather than left as an accident of the loop.
    const none = { requireHod: false, requireFaculty: false, requireSenate: false };
    expect(nextStage('DRAFT', none)).toBe('RELEASED');
    expect(stagesFor(none)).toEqual(['DRAFT', 'RELEASED']);
  });

  it('never moves past released', () => {
    expect(nextStage('RELEASED')).toBe('RELEASED');
  });
});

describe('who may approve', () => {
  it('puts each stage with the office that owns it', () => {
    expect(mayApprove('HOD_REVIEW', 'HOD')).toBe(true);
    expect(mayApprove('FACULTY_REVIEW', 'DEAN')).toBe(true);
    expect(mayApprove('SENATE_REVIEW', 'REGISTRAR')).toBe(true);
  });

  it('does NOT let an administrator wave results through', () => {
    /*
     * The property the whole chain rests on. An ADMIN or OWNER can already do
     * almost anything here; letting them approve would make every other rule
     * in this file decorative.
     */
    for (const stage of ['HOD_REVIEW', 'FACULTY_REVIEW', 'SENATE_REVIEW'] as ResultStage[]) {
      expect(mayApprove(stage, 'ADMIN')).toBe(false);
      expect(mayApprove(stage, 'OWNER')).toBe(false);
    }
  });

  it('does not let one office approve another office’s stage', () => {
    // A dean cannot stand in for the HOD, and an HOD cannot carry Senate.
    expect(mayApprove('HOD_REVIEW', 'DEAN')).toBe(false);
    expect(mayApprove('SENATE_REVIEW', 'HOD')).toBe(false);
    expect(mayApprove('FACULTY_REVIEW', 'HOD')).toBe(false);
  });

  it('lets nobody approve a draft or a released sheet', () => {
    for (const role of ROLES) {
      expect(mayApprove('DRAFT', role as Role)).toBe(false);
      expect(mayApprove('RELEASED', role as Role)).toBe(false);
    }
  });

  it('lets a reviewer send it back, or reviewing means nothing', () => {
    // Somebody who can only say yes is not reviewing.
    expect(mayReturn('HOD_REVIEW', 'HOD')).toBe(true);
    expect(mayReturn('SENATE_REVIEW', 'REGISTRAR')).toBe(true);
    expect(mayReturn('HOD_REVIEW', 'INSTRUCTOR')).toBe(false);
  });

  it('lets the people who teach submit, and nobody else', () => {
    expect(maySubmit('INSTRUCTOR')).toBe(true);
    expect(maySubmit('HOD')).toBe(true);
    expect(maySubmit('STUDENT')).toBe(false);
    expect(maySubmit('FINANCE')).toBe(false);
  });
});

describe('what a stage means', () => {
  it('counts only RELEASED as part of the academic record', () => {
    /*
     * The single question the transcript, the CGPA and the student's own page
     * all ask. One answer, so three screens cannot disagree.
     */
    for (const stage of RESULT_STAGES) {
      expect(isReleased(stage)).toBe(stage === 'RELEASED');
    }
  });

  it('freezes the marks the moment they are submitted', () => {
    /*
     * A mark changing underneath a reviewer who has already approved it is
     * the exact failure the chain exists to prevent.
     */
    expect(isEditable('DRAFT')).toBe(true);
    for (const stage of ['HOD_REVIEW', 'FACULTY_REVIEW', 'SENATE_REVIEW', 'RELEASED'] as ResultStage[]) {
      expect(isEditable(stage)).toBe(false);
    }
  });

  it('names who is being waited on', () => {
    expect(waitingOn('DRAFT')).toBe('the lecturer');
    expect(waitingOn('HOD_REVIEW')).toBe('hod');
    expect(waitingOn('RELEASED')).toBeNull();
  });
});

describe('submitting', () => {
  it('accepts a fully marked sheet', () => {
    expect(readyToSubmit({ stage: 'DRAFT', total: 30, graded: 30 })).toEqual({ ok: true });
  });

  it('REFUSES a partly marked one, and says how many are missing', () => {
    /*
     * The commonest thing somebody tries to send. Refusing it here with the
     * count is kinder than an HOD returning it a week later.
     */
    const verdict = readyToSubmit({ stage: 'DRAFT', total: 30, graded: 28 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/2 of 30/);
  });

  it('refuses a sheet already in the chain', () => {
    expect(readyToSubmit({ stage: 'HOD_REVIEW', total: 30, graded: 30 }).ok).toBe(false);
  });

  it('refuses a section with nobody on it', () => {
    // Zero of zero is technically "all marked", which would let an empty
    // sheet sail through the whole chain and be released.
    expect(readyToSubmit({ stage: 'DRAFT', total: 0, graded: 0 }).ok).toBe(false);
  });
});
