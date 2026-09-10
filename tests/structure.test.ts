import { describe, expect, it } from 'vitest';

import {
  DEGREE_TYPES,
  LEVELS,
  codeRejectionReason,
  deletionBlockers,
  isDegreeType,
  isValidCourseCode,
  isValidUnitCode,
  levelFromCourseCode,
  normaliseCode,
  validateCredits,
  validateLevel,
  validateName,
  validateProgramme,
} from '@/lib/domain/structure';

describe('codes', () => {
  it('normalises to upper case and collapses spacing', () => {
    expect(normaliseCode('  csc  101 ')).toBe('CSC 101');
    expect(normaliseCode('sci')).toBe('SCI');
  });

  it('accepts a faculty or department code', () => {
    expect(isValidUnitCode('SCI')).toBe(true);
    expect(isValidUnitCode('CSC')).toBe(true);
    expect(isValidUnitCode('BSCCSC')).toBe(true);
  });

  it('refuses punctuation in a unit code', () => {
    // These are quoted aloud and typed into spreadsheets, which interpret
    // leading punctuation as a formula.
    expect(isValidUnitCode('SCI-1')).toBe(false);
    expect(isValidUnitCode('=SCI')).toBe(false);
    expect(isValidUnitCode('S')).toBe(false);
  });

  it('accepts the course-code conventions universities actually use', () => {
    // Refusing a real code because it has a hyphen is the sort of rule that
    // gets a product rejected in the first demonstration.
    for (const code of ['CSC101', 'MTH 201', 'GEN-101', 'GST101', 'ENG.204']) {
      expect(isValidCourseCode(code), code).toBe(true);
    }
  });

  it('explains which rule a bad code broke', () => {
    expect(codeRejectionReason('', 'unit')).toMatch(/Enter a code/);
    expect(codeRejectionReason('S', 'unit')).toMatch(/two characters/);
    expect(codeRejectionReason('SCI-1', 'unit')).toMatch(/capital letters and digits/i);
    expect(codeRejectionReason('A'.repeat(20), 'unit')).toMatch(/at most 12/);
    expect(codeRejectionReason('CSC101', 'course')).toBeNull();
  });

  it('lower-cases input before judging it, rather than refusing it', () => {
    // A registrar typing in lower case has not made a mistake.
    expect(codeRejectionReason('csc', 'unit')).toBeNull();
  });
});

describe('level suggested by a course code', () => {
  it('reads the level out of the number', () => {
    expect(levelFromCourseCode('CSC101')).toBe(100);
    expect(levelFromCourseCode('MTH 205')).toBe(200);
    expect(levelFromCourseCode('ENG-499')).toBe(400);
  });

  it('returns nothing when the code carries no level', () => {
    // Plenty of institutions do not use that convention, and a code without a
    // level is not an error.
    expect(levelFromCourseCode('SEMINAR')).toBeNull();
    expect(levelFromCourseCode('CSC')).toBeNull();
    expect(levelFromCourseCode('CSC99')).toBeNull();
  });

  it('refuses an implausible level rather than inventing one', () => {
    expect(levelFromCourseCode('X9999')).toBeNull();
  });
});

describe('credits and levels', () => {
  it('accepts a zero-credit course', () => {
    // Use of English, an industrial-attachment seminar: compulsory, no credit.
    expect(validateCredits(0)).toBeNull();
  });

  it('refuses fractional or negative credits', () => {
    expect(validateCredits(2.5)).toMatch(/whole number/);
    expect(validateCredits(-1)).toMatch(/negative/);
  });

  it('refuses an implausibly large credit value', () => {
    expect(validateCredits(200)).toMatch(/more credits/);
  });

  it('accepts every level a university uses', () => {
    for (const level of LEVELS) expect(validateLevel(level), String(level)).toBeNull();
  });

  it('refuses a level off the scale', () => {
    expect(validateLevel(50)).toBeTruthy();
    expect(validateLevel(1000)).toBeTruthy();
    expect(validateLevel(150)).toBeTruthy();
  });
});

describe('names', () => {
  it('requires something meaningful', () => {
    expect(validateName('', 'faculty')).toMatch(/Enter a faculty name/);
    expect(validateName('A', 'faculty')).toBeTruthy();
    expect(validateName('Faculty of Science', 'faculty')).toBeNull();
  });

  it('caps the length', () => {
    expect(validateName('x'.repeat(200), 'course')).toMatch(/too long/);
  });
});

describe('programmes', () => {
  const good = {
    code: 'BSCCSC',
    name: 'B.Sc. Computer Science',
    degreeType: 'BSC',
    totalCredits: 120,
    durationTerms: 8,
    minCgpa: 1.5,
  };

  it('accepts a well-formed programme', () => {
    expect(validateProgramme(good, 4)).toEqual([]);
  });

  it('validates the minimum CGPA against THIS school’s scale', () => {
    // 2.5 is ordinary on a 5-point scale and impossible on a 4-point one. A
    // hard-coded 4.0 would tell a Nigerian university on a 5-point scale that
    // its own entry requirement is invalid.
    expect(validateProgramme({ ...good, minCgpa: 2.5 }, 5)).toEqual([]);
    expect(validateProgramme({ ...good, minCgpa: 4.5 }, 4).join(' ')).toMatch(/scale of 4/);
  });

  it('reports every problem at once', () => {
    // This form has six fields; one-at-a-time validation makes it six round
    // trips.
    const problems = validateProgramme(
      { code: '', name: '', degreeType: 'NOPE', totalCredits: 0, durationTerms: 0, minCgpa: -1 },
      4,
    );
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });

  it('knows the awards a university actually confers', () => {
    for (const d of ['BSC', 'BENG', 'MBBS', 'LLB', 'HND', 'PHD']) {
      expect(isDegreeType(d), d).toBe(true);
    }
    expect(isDegreeType('BACHELORS')).toBe(false);
    expect(DEGREE_TYPES.length).toBeGreaterThan(10);
  });

  it('refuses an implausible duration', () => {
    expect(validateProgramme({ ...good, durationTerms: 40 }, 4).join(' ')).toMatch(/longer than/);
  });
});

describe('refusing to delete structure', () => {
  it('allows deletion when nothing points at it', () => {
    expect(deletionBlockers([{ label: 'department', count: 0 }])).toBeNull();
    expect(deletionBlockers([])).toBeNull();
  });

  it('refuses, and names what is in the way', () => {
    // Faculty → Department → Programme → Course all cascade, so one mis-clicked
    // delete would take out a whole faculty tree and the student records
    // hanging off it.
    const message = deletionBlockers([{ label: 'department', count: 3 }]);
    expect(message).toMatch(/3 departments/);
    expect(message).toMatch(/Archive it instead/);
  });

  it('reads naturally with several blockers', () => {
    const message = deletionBlockers([
      { label: 'programme', count: 2 },
      { label: 'course', count: 5 },
      { label: 'lecturer', count: 1 },
    ]);
    expect(message).toMatch(/2 programmes, 5 courses and 1 lecturer/);
  });

  it('gets singular and plural right', () => {
    expect(deletionBlockers([{ label: 'course', count: 1 }])).toMatch(/1 course\b/);
    expect(deletionBlockers([{ label: 'course', count: 2 }])).toMatch(/2 courses/);
  });

  it('ignores the zero-count entries when listing', () => {
    const message = deletionBlockers([
      { label: 'programme', count: 0 },
      { label: 'course', count: 4 },
    ]);
    expect(message).toMatch(/4 courses/);
    expect(message).not.toMatch(/programme/);
  });
});
