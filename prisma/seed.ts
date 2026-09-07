/**
 * =============================================================================
 * SEED — a platform with two schools on it
 * =============================================================================
 *
 * The seed builds the SAME institution twice, through one `seedSchool()`
 * function, because that is what actually exercises multi-tenancy. A single
 * seeded school proves nothing: every isolation bug looks like correct
 * behaviour when there is only one tenant to leak from.
 *
 *   Golden Eagles University   GEU  ·  Nigeria  ·  NGN  ·  full dataset
 *   Meridian Institute of Tech MIT  ·  Ghana    ·  GHS  ·  compact dataset
 *
 * The two share a person: `a.okafor@geu.edu` is a Dean at Golden Eagles and a
 * visiting professor at Meridian — ONE user row, two memberships. That is the
 * case that forces identity to be global and authorisation per-school, and it
 * is why `User` carries no role.
 *
 * Within each school the data exercises every interesting path, as before:
 * a Dean's-List student, one on probation, a repeated course collapsed by the
 * best-attempt policy, a withdrawal excluded from the GPA, a full section with
 * a waitlist behind it, and a paid / partly-paid / overdue invoice triple.
 *
 * Deterministic: no randomness. Running it twice produces the same platform.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const PASSWORD = 'Password123!';
const NOW = new Date();

function day(offset: number): Date {
  const d = new Date(NOW.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Major units -> integer minor units. */
const minor = (amount: number) => Math.round(amount * 100);

/** "09:30" -> minutes from midnight. */
const at = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

// -----------------------------------------------------------------------------
// School specifications
// -----------------------------------------------------------------------------

interface StaffSpec {
  email: string;
  first: string;
  last: string;
  role: string;
  title?: string;
}

interface InstructorSpec extends StaffSpec {
  dept: string;
  rank: string;
  staffNo: string;
  office: string;
}

interface SchoolSpec {
  slug: string;
  code: string;
  name: string;
  shortName: string;
  academicModel: string;
  country: string;
  locale: string;
  timezone: string;
  currencyCode: string;
  currencySymbol: string;
  brandColor: string;
  /** Points on the grading scale — 4.0 at GEU, 5.0 at MIT. */
  maxGradePoint: number;
  faculties: { code: string; name: string }[];
  departments: { code: string; name: string; faculty: string }[];
  programs: {
    code: string; name: string; degreeType: string; dept: string;
    credits: number; terms: number; minCgpa: number;
  }[];
  staff: StaffSpec[];
  instructors: InstructorSpec[];
  courses: {
    code: string; title: string; credits: number; level: number; dept: string; desc: string;
  }[];
  prerequisites: [string, string, number, boolean][];
  coreProgram: string;
  core: string[];
  electives: string[];
  students: {
    email: string; first: string; last: string; matric: string; program: string;
    level: number; dob: string; gender: string;
  }[];
  tuitionPerCredit: number;
  fixedFees: [string, string, number][];
}

const GEU: SchoolSpec = {
  slug: 'golden-eagles',
  code: 'GEU',
  name: 'Golden Eagles University',
  shortName: 'Golden Eagles',
  academicModel: 'HIGHER_ED',
  country: 'NG',
  locale: 'en-NG',
  timezone: 'Africa/Lagos',
  currencyCode: 'NGN',
  currencySymbol: '₦',
  brandColor: '#1b5df5',
  maxGradePoint: 4.0,
  faculties: [
    { code: 'SCI', name: 'Faculty of Science' },
    { code: 'ENG', name: 'Faculty of Engineering' },
    { code: 'MGT', name: 'Faculty of Management Sciences' },
  ],
  departments: [
    { code: 'CSC', name: 'Computer Science', faculty: 'SCI' },
    { code: 'MTH', name: 'Mathematics', faculty: 'SCI' },
    { code: 'EEE', name: 'Electrical & Electronic Engineering', faculty: 'ENG' },
    { code: 'ACC', name: 'Accounting', faculty: 'MGT' },
  ],
  programs: [
    { code: 'BSC-CSC', name: 'B.Sc. Computer Science', degreeType: 'BSC', dept: 'CSC', credits: 120, terms: 8, minCgpa: 1.5 },
    { code: 'BENG-EEE', name: 'B.Eng. Electrical & Electronic Engineering', degreeType: 'BENG', dept: 'EEE', credits: 150, terms: 10, minCgpa: 1.5 },
    { code: 'BSC-ACC', name: 'B.Sc. Accounting', degreeType: 'BSC', dept: 'ACC', credits: 120, terms: 8, minCgpa: 1.5 },
    { code: 'MSC-CSC', name: 'M.Sc. Computer Science', degreeType: 'MSC', dept: 'CSC', credits: 45, terms: 4, minCgpa: 2.5 },
  ],
  staff: [
    { email: 'admin@geu.edu', first: 'Amara', last: 'Nwosu', role: 'ADMIN', title: 'Director of Information Systems' },
    { email: 'registrar@geu.edu', first: 'Tunde', last: 'Bakare', role: 'REGISTRAR', title: 'Registrar' },
    { email: 'admissions@geu.edu', first: 'Ngozi', last: 'Adeyemi', role: 'ADMISSIONS', title: 'Head of Admissions' },
    { email: 'bursary@geu.edu', first: 'Ibrahim', last: 'Suleiman', role: 'FINANCE', title: 'Bursar' },
    { email: 'library@geu.edu', first: 'Chioma', last: 'Okonjo', role: 'LIBRARIAN', title: 'University Librarian' },
  ],
  instructors: [
    { email: 'a.okafor@geu.edu', first: 'Adaeze', last: 'Okafor', role: 'INSTRUCTOR', dept: 'CSC', rank: 'PROFESSOR', staffNo: 'STF-0101', office: 'CSC-301', title: 'Dean, Faculty of Science' },
    { email: 'e.balogun@geu.edu', first: 'Emeka', last: 'Balogun', role: 'INSTRUCTOR', dept: 'CSC', rank: 'SENIOR_LECTURER', staffNo: 'STF-0102', office: 'CSC-208' },
    { email: 'f.dauda@geu.edu', first: 'Fatima', last: 'Dauda', role: 'INSTRUCTOR', dept: 'MTH', rank: 'ASSOCIATE_PROFESSOR', staffNo: 'STF-0201', office: 'MTH-115' },
    { email: 'o.eze@geu.edu', first: 'Obinna', last: 'Eze', role: 'INSTRUCTOR', dept: 'EEE', rank: 'LECTURER', staffNo: 'STF-0301', office: 'EEE-042' },
  ],
  courses: [
    { code: 'CSC101', title: 'Introduction to Computer Science', credits: 3, level: 100, dept: 'CSC', desc: 'Foundations of computing, algorithms and problem decomposition.' },
    { code: 'CSC102', title: 'Programming Fundamentals', credits: 4, level: 100, dept: 'CSC', desc: 'Structured programming, data types, control flow and functions.' },
    { code: 'MTH101', title: 'Calculus I', credits: 3, level: 100, dept: 'MTH', desc: 'Limits, differentiation and applications.' },
    { code: 'MTH102', title: 'Linear Algebra', credits: 3, level: 100, dept: 'MTH', desc: 'Vector spaces, matrices and linear transformations.' },
    { code: 'CSC201', title: 'Data Structures', credits: 4, level: 200, dept: 'CSC', desc: 'Lists, trees, graphs, hashing and their complexity.' },
    { code: 'CSC202', title: 'Discrete Mathematics', credits: 3, level: 200, dept: 'CSC', desc: 'Logic, sets, relations, combinatorics and graph theory.' },
    { code: 'CSC301', title: 'Algorithms and Complexity', credits: 4, level: 300, dept: 'CSC', desc: 'Design paradigms, asymptotic analysis and intractability.' },
    { code: 'CSC302', title: 'Database Systems', credits: 3, level: 300, dept: 'CSC', desc: 'Relational modelling, normalisation, transactions and recovery.' },
    { code: 'CSC303', title: 'Operating Systems', credits: 3, level: 300, dept: 'CSC', desc: 'Processes, scheduling, memory management and concurrency.' },
    { code: 'CSC401', title: 'Distributed Systems', credits: 4, level: 400, dept: 'CSC', desc: 'Consistency, consensus, replication and fault tolerance.' },
    { code: 'EEE201', title: 'Circuit Theory', credits: 4, level: 200, dept: 'EEE', desc: 'Network analysis, transient and steady-state response.' },
    { code: 'ACC101', title: 'Principles of Accounting', credits: 3, level: 100, dept: 'ACC', desc: 'Double-entry bookkeeping and the accounting cycle.' },
  ],
  prerequisites: [
    ['CSC102', 'CSC101', 1.0, false],
    ['CSC201', 'CSC102', 2.0, false],
    ['CSC202', 'MTH101', 1.0, false],
    ['CSC301', 'CSC201', 2.0, false],
    ['CSC301', 'CSC202', 1.0, false],
    ['CSC302', 'CSC201', 1.0, false],
    ['CSC303', 'CSC201', 1.0, false],
    ['CSC401', 'CSC301', 2.0, false],
    ['CSC401', 'CSC303', 1.0, true],
    ['MTH102', 'MTH101', 1.0, false],
    ['EEE201', 'MTH101', 1.0, false],
  ],
  coreProgram: 'BSC-CSC',
  core: ['CSC101', 'CSC102', 'CSC201', 'CSC202', 'CSC301', 'CSC302', 'CSC303', 'MTH101'],
  electives: ['CSC401', 'MTH102'],
  students: [
    { email: 'chidi.eze@student.geu.edu', first: 'Chidi', last: 'Eze', matric: 'GEU/CSC/2024/0001', program: 'BSC-CSC', level: 200, dob: '2005-03-14', gender: 'Male' },
    { email: 'aisha.bello@student.geu.edu', first: 'Aisha', last: 'Bello', matric: 'GEU/CSC/2024/0002', program: 'BSC-CSC', level: 200, dob: '2005-07-22', gender: 'Female' },
    { email: 'kunle.adeoye@student.geu.edu', first: 'Kunle', last: 'Adeoye', matric: 'GEU/CSC/2024/0003', program: 'BSC-CSC', level: 200, dob: '2004-11-09', gender: 'Male' },
    { email: 'zainab.musa@student.geu.edu', first: 'Zainab', last: 'Musa', matric: 'GEU/EEE/2024/0001', program: 'BENG-EEE', level: 200, dob: '2005-01-30', gender: 'Female' },
    { email: 'segun.okonkwo@student.geu.edu', first: 'Segun', last: 'Okonkwo', matric: 'GEU/ACC/2024/0001', program: 'BSC-ACC', level: 200, dob: '2004-09-18', gender: 'Male' },
    { email: 'blessing.udo@student.geu.edu', first: 'Blessing', last: 'Udo', matric: 'GEU/CSC/2025/0004', program: 'BSC-CSC', level: 100, dob: '2006-05-05', gender: 'Female' },
  ],
  tuitionPerCredit: 12_500,
  fixedFees: [
    ['REGISTRATION', 'Registration and records', 15_000],
    ['LIBRARY', 'Library and learning resources', 12_000],
    ['ICT', 'ICT and network access', 18_000],
    ['HEALTH', 'Student health service', 10_000],
  ],
};

const MIT: SchoolSpec = {
  slug: 'meridian',
  code: 'MIT',
  name: 'Meridian Institute of Technology',
  shortName: 'Meridian',
  academicModel: 'HIGHER_ED',
  country: 'GH',
  locale: 'en-GH',
  timezone: 'Africa/Accra',
  currencyCode: 'GHS',
  currencySymbol: '₵',
  brandColor: '#0f766e',
  maxGradePoint: 5.0,
  faculties: [{ code: 'TECH', name: 'School of Technology' }],
  departments: [
    { code: 'SWE', name: 'Software Engineering', faculty: 'TECH' },
    { code: 'DAT', name: 'Data Science', faculty: 'TECH' },
  ],
  programs: [
    { code: 'BSC-SWE', name: 'B.Sc. Software Engineering', degreeType: 'BSC', dept: 'SWE', credits: 132, terms: 8, minCgpa: 2.0 },
    { code: 'BSC-DAT', name: 'B.Sc. Data Science', degreeType: 'BSC', dept: 'DAT', credits: 132, terms: 8, minCgpa: 2.0 },
  ],
  staff: [
    { email: 'admin@meridian.edu.gh', first: 'Kwame', last: 'Mensah', role: 'ADMIN', title: 'Head of IT' },
    { email: 'registrar@meridian.edu.gh', first: 'Akosua', last: 'Boateng', role: 'REGISTRAR', title: 'Registrar' },
    { email: 'finance@meridian.edu.gh', first: 'Yaw', last: 'Asante', role: 'FINANCE', title: 'Finance Officer' },
  ],
  instructors: [
    { email: 'n.owusu@meridian.edu.gh', first: 'Nana', last: 'Owusu', role: 'INSTRUCTOR', dept: 'SWE', rank: 'ASSOCIATE_PROFESSOR', staffNo: 'MIT-0101', office: 'SWE-11', title: 'Head of Department' },
    // Deliberately the SAME email as the GEU dean: one human, a membership at
    // each school. This is the case that forces identity to be global and
    // authorisation to be per-school.
    { email: 'a.okafor@geu.edu', first: 'Adaeze', last: 'Okafor', role: 'INSTRUCTOR', dept: 'DAT', rank: 'PROFESSOR', staffNo: 'MIT-0201', office: 'DAT-04', title: 'Visiting Professor' },
  ],
  courses: [
    { code: 'SWE101', title: 'Software Construction', credits: 4, level: 100, dept: 'SWE', desc: 'Programming, version control and testing fundamentals.' },
    { code: 'SWE201', title: 'Software Architecture', credits: 4, level: 200, dept: 'SWE', desc: 'Modularity, coupling, and architectural patterns.' },
    { code: 'DAT101', title: 'Statistics for Data Science', credits: 3, level: 100, dept: 'DAT', desc: 'Descriptive and inferential statistics.' },
    { code: 'DAT201', title: 'Machine Learning', credits: 4, level: 200, dept: 'DAT', desc: 'Supervised and unsupervised methods.' },
  ],
  prerequisites: [
    ['SWE201', 'SWE101', 2.0, false],
    ['DAT201', 'DAT101', 2.0, false],
  ],
  coreProgram: 'BSC-SWE',
  core: ['SWE101', 'SWE201'],
  electives: ['DAT101'],
  students: [
    { email: 'ama.darko@student.meridian.edu.gh', first: 'Ama', last: 'Darko', matric: 'MIT/SWE/2024/0001', program: 'BSC-SWE', level: 200, dob: '2005-02-11', gender: 'Female' },
    { email: 'kofi.antwi@student.meridian.edu.gh', first: 'Kofi', last: 'Antwi', matric: 'MIT/DAT/2024/0001', program: 'BSC-DAT', level: 200, dob: '2004-12-03', gender: 'Male' },
  ],
  tuitionPerCredit: 900,
  fixedFees: [
    ['REGISTRATION', 'Registration and records', 1_200],
    ['ICT', 'ICT and network access', 800],
  ],
};

// -----------------------------------------------------------------------------
// Config defaults (the configuration phase replaces these with a real module)
// -----------------------------------------------------------------------------

function defaultConfig(spec: SchoolSpec) {
  const max = spec.maxGradePoint;
  // Same percentage cut-offs, scaled to the school's maximum grade point —
  // which is exactly the kind of thing that must be per-school data rather
  // than a constant in the code.
  const scale = [
    { min: 70, max: 100, letter: 'A', point: max, description: 'Excellent' },
    { min: 60, max: 69.999999, letter: 'B', point: max - 1, description: 'Very Good' },
    { min: 50, max: 59.999999, letter: 'C', point: max - 2, description: 'Good' },
    { min: 45, max: 49.999999, letter: 'D', point: max - 3, description: 'Pass' },
    { min: 40, max: 44.999999, letter: 'E', point: Math.max(0.5, max - 3.5), description: 'Marginal Pass' },
    { min: 0, max: 39.999999, letter: 'F', point: 0, description: 'Fail' },
  ];

  return {
    gradingJson: JSON.stringify({
      scale,
      passingGradePoint: 0.5,
      assessmentWeights: { ca: 40, exam: 60 },
      standing: {
        deansList: max * 0.875,
        good: max * 0.5,
        warning: max * 0.375,
        probation: max * 0.25,
        deansListMinCredits: 12,
        maxConsecutiveProbationTerms: 2,
      },
    }),
    enrollmentJson: JSON.stringify({
      minCreditsPerTerm: 9,
      maxCreditsPerTerm: 24,
      maxCreditsWithOverloadApproval: 30,
      overloadMinCgpa: max * 0.75,
      outstandingBalanceToleranceMinor: 0,
    }),
    admissionsJson: JSON.stringify({
      weights: { priorGpa: 0.4, entranceExam: 0.3, essay: 0.15, interview: 0.1, extracurricular: 0.05 },
      autoRejectThreshold: 40,
      minReviewsRequired: 2,
      reviewerDisagreementThreshold: 20,
      offerValidityDays: 21,
    }),
    financeJson: JSON.stringify({
      currency: { code: spec.currencyCode, symbol: spec.currencySymbol, exponent: 2 },
      holdPolicy: { toleranceMinor: 0, graceDays: 7 },
      refundSchedule: [
        { throughWeek: 1, percent: 100 },
        { throughWeek: 2, percent: 75 },
        { throughWeek: 4, percent: 50 },
        { throughWeek: 6, percent: 25 },
      ],
    }),
    brandingJson: JSON.stringify({
      name: spec.name,
      short: spec.shortName,
      brandColor: spec.brandColor,
      logoUrl: null,
    }),
    localeJson: JSON.stringify({
      locale: spec.locale,
      timezone: spec.timezone,
      firstDayOfWeek: 1,
      dateFormat: 'dd MMM yyyy',
    }),
    registrationPortalJson: JSON.stringify({
      collectPriorGpa: true,
      collectEntranceExam: true,
      requirePersonalStatement: true,
      minStatementLength: 100,
      openProgramCodes: spec.programs.map((p) => p.code),
    }),
  };
}

// -----------------------------------------------------------------------------
// seedSchool
// -----------------------------------------------------------------------------

async function seedSchool(spec: SchoolSpec, passwordHash: string) {
  console.log(`\n  ── ${spec.name} (${spec.code}) ──`);

  const school = await db.school.create({
    data: {
      slug: spec.slug,
      code: spec.code,
      name: spec.name,
      shortName: spec.shortName,
      academicModel: spec.academicModel,
      status: 'ACTIVE',
      country: spec.country,
      locale: spec.locale,
      timezone: spec.timezone,
      currencyCode: spec.currencyCode,
      brandColor: spec.brandColor,
      config: { create: defaultConfig(spec) },
    },
  });
  const schoolId = school.id;

  /** Find-or-create the person, then grant them a membership of THIS school. */
  const person = async (
    email: string,
    firstName: string,
    lastName: string,
    role: string,
    title?: string,
  ) => {
    const user =
      (await db.user.findUnique({ where: { email } })) ??
      (await db.user.create({
        data: { email, passwordHash, firstName, lastName, phone: '+234 800 000 0000' },
      }));
    const membership = await db.membership.create({
      data: {
        userId: user.id,
        schoolId,
        role,
        title: title ?? null,
        // Their first school is their primary one.
        isPrimary: (await db.membership.count({ where: { userId: user.id } })) === 0,
        status: 'ACTIVE',
      },
    });
    return { user, membership };
  };

  // --- org structure ---------------------------------------------------------
  const faculties: Record<string, string> = {};
  for (const f of spec.faculties) {
    const row = await db.faculty.create({ data: { schoolId, code: f.code, name: f.name } });
    faculties[f.code] = row.id;
    await db.orgUnit.create({
      data: { schoolId, code: f.code, name: f.name, kind: 'FACULTY' },
    });
  }

  const departments: Record<string, string> = {};
  for (const d of spec.departments) {
    const row = await db.department.create({
      data: { schoolId, code: d.code, name: d.name, facultyId: faculties[d.faculty] },
    });
    departments[d.code] = row.id;
    const parent = await db.orgUnit.findFirst({ where: { schoolId, code: d.faculty } });
    await db.orgUnit.create({
      data: { schoolId, code: d.code, name: d.name, kind: 'DEPARTMENT', parentId: parent?.id ?? null },
    });
  }

  const programs: Record<string, string> = {};
  for (const p of spec.programs) {
    const row = await db.program.create({
      data: {
        schoolId, code: p.code, name: p.name, degreeType: p.degreeType,
        departmentId: departments[p.dept], creditsRequired: p.credits,
        durationTerms: p.terms, minCgpaToGraduate: p.minCgpa,
      },
    });
    programs[p.code] = row.id;
  }

  // --- terms -----------------------------------------------------------------
  const term1 = await db.term.create({
    data: {
      schoolId, code: '2024-FALL', name: 'Fall 2024', academicYear: '2024/2025', season: 'FALL',
      startDate: day(-400), endDate: day(-280),
      registrationOpensAt: day(-420), registrationClosesAt: day(-395),
      addDropDeadline: day(-385), withdrawalDeadline: day(-330), isCurrent: false,
    },
  });
  const term2 = await db.term.create({
    data: {
      schoolId, code: '2025-SPRING', name: 'Spring 2025', academicYear: '2024/2025', season: 'SPRING',
      startDate: day(-250), endDate: day(-130),
      registrationOpensAt: day(-270), registrationClosesAt: day(-245),
      addDropDeadline: day(-235), withdrawalDeadline: day(-180), isCurrent: false,
    },
  });
  // The current term's registration window is deliberately open right now, so
  // the registration screen is usable the moment the seed finishes.
  const term3 = await db.term.create({
    data: {
      schoolId, code: '2025-FALL', name: 'Fall 2025', academicYear: '2025/2026', season: 'FALL',
      startDate: day(-14), endDate: day(105),
      registrationOpensAt: day(-30), registrationClosesAt: day(21),
      addDropDeadline: day(28), withdrawalDeadline: day(70), isCurrent: true,
    },
  });
  const termIds: Record<string, string> = { t1: term1.id, t2: term2.id, t3: term3.id };

  // --- people ----------------------------------------------------------------
  for (const s of spec.staff) {
    await person(s.email, s.first, s.last, s.role, s.title);
  }

  const instructors: Record<string, string> = {};
  for (const spc of spec.instructors) {
    const { user } = await person(spc.email, spc.first, spc.last, 'INSTRUCTOR', spc.title);
    const row = await db.instructor.create({
      data: {
        schoolId, userId: user.id, staffNumber: spc.staffNo,
        departmentId: departments[spc.dept], rank: spc.rank, officeRoom: spc.office,
      },
    });
    instructors[spc.email] = row.id;
  }

  // --- curriculum ------------------------------------------------------------
  const courses: Record<string, { id: string; credits: number }> = {};
  for (const c of spec.courses) {
    const row = await db.course.create({
      data: {
        schoolId, code: c.code, title: c.title, description: c.desc,
        creditHours: c.credits, level: c.level, departmentId: departments[c.dept],
      },
    });
    courses[c.code] = { id: row.id, credits: c.credits };
  }

  for (const [course, prereq, minPoint, concurrent] of spec.prerequisites) {
    await db.prerequisite.create({
      data: {
        schoolId, courseId: courses[course].id, prerequisiteId: courses[prereq].id,
        minGradePoint: minPoint, isConcurrent: concurrent,
      },
    });
  }

  for (const code of spec.core) {
    await db.programRequirement.create({
      data: {
        schoolId, programId: programs[spec.coreProgram], courseId: courses[code].id,
        kind: 'CORE', level: spec.courses.find((c) => c.code === code)!.level,
      },
    });
  }
  for (const code of spec.electives) {
    await db.programRequirement.create({
      data: {
        schoolId, programId: programs[spec.coreProgram], courseId: courses[code].id,
        kind: 'ELECTIVE', level: 400,
      },
    });
  }

  // --- students --------------------------------------------------------------
  const students: Record<string, string> = {};
  for (const s of spec.students) {
    const { user } = await person(s.email, s.first, s.last, 'STUDENT');
    const row = await db.student.create({
      data: {
        schoolId, userId: user.id, matricNumber: s.matric, programId: programs[s.program],
        level: s.level, admissionTermCode: s.level === 100 ? '2025-FALL' : '2024-FALL',
        dateOfBirth: new Date(s.dob), gender: s.gender,
        nationality: spec.country === 'NG' ? 'Nigerian' : 'Ghanaian',
        address: spec.timezone.split('/')[1],
      },
    });
    students[s.email] = row.id;
  }

  return { school, schoolId, termIds, courses, instructors, students, programs, departments };
}

type SeededSchool = Awaited<ReturnType<typeof seedSchool>>;

// -----------------------------------------------------------------------------
// Academic history (shared shape, applied per school)
// -----------------------------------------------------------------------------

/** Grade a completed enrollment against this school's scale. */
async function gradeEnrollment(
  schoolId: string,
  studentId: string,
  offeringId: string,
  ca: number,
  exam: number,
  maxPoint: number,
) {
  const total = ca + exam;
  const bands: [number, string, number][] = [
    [70, 'A', maxPoint],
    [60, 'B', maxPoint - 1],
    [50, 'C', maxPoint - 2],
    [45, 'D', maxPoint - 3],
    [40, 'E', Math.max(0.5, maxPoint - 3.5)],
    [0, 'F', 0],
  ];
  const [, letter, point] = bands.find(([min]) => total >= min)!;

  await db.enrollment.create({
    data: {
      schoolId, studentId, offeringId, status: 'COMPLETED',
      caScore: ca, examScore: exam, totalScore: total,
      letterGrade: letter, gradePoint: point, gradedAt: day(-290),
    },
  });
  await db.courseOffering.update({
    where: { id: offeringId },
    data: { seatsTaken: { increment: 1 } },
  });
}

async function seedGeuHistory(s: SeededSchool, max: number) {
  const { schoolId, termIds, courses, instructors, students } = s;

  interface OfferingSpec {
    course: string; term: string; section: string; instructor: string;
    capacity: number; room: string; meetings: [number, string, string][];
    status?: string; gradesPosted?: boolean; waitlistCapacity?: number;
  }

  const offeringSpecs: OfferingSpec[] = [
    { course: 'CSC101', term: 't1', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 60, room: 'LT-1', meetings: [[1, '08:00', '10:00'], [3, '08:00', '09:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'MTH101', term: 't1', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 60, room: 'LT-2', meetings: [[2, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'ACC101', term: 't1', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 40, room: 'MGT-05', meetings: [[4, '14:00', '16:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'CSC102', term: 't2', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 55, room: 'LAB-1', meetings: [[1, '10:00', '12:00'], [4, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'CSC202', term: 't2', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 50, room: 'LT-3', meetings: [[2, '08:00', '10:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'MTH102', term: 't2', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 50, room: 'MTH-01', meetings: [[3, '14:00', '16:00']], status: 'CLOSED', gradesPosted: true },
    // Repeat offering: lets a student who failed ACC101 retake it, giving the
    // best-attempt policy a real case to collapse.
    { course: 'ACC101', term: 't2', section: 'R', instructor: 'e.balogun@geu.edu', capacity: 25, room: 'MGT-05', meetings: [[5, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },
    // Current term — capacity 3 so the waitlist is exercised.
    { course: 'CSC201', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 3, room: 'LAB-2', meetings: [[1, '09:00', '11:00'], [3, '09:00', '11:00']], waitlistCapacity: 5 },
    { course: 'CSC201', term: 't3', section: 'B', instructor: 'e.balogun@geu.edu', capacity: 30, room: 'LAB-3', meetings: [[2, '14:00', '16:00'], [4, '14:00', '16:00']] },
    { course: 'CSC301', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 40, room: 'LT-1', meetings: [[2, '09:00', '11:00'], [5, '09:00', '10:00']] },
    { course: 'CSC302', term: 't3', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 35, room: 'LAB-1', meetings: [[1, '14:00', '16:00']] },
    // Deliberately clashes with CSC301-A on Tuesday morning.
    { course: 'CSC303', term: 't3', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 35, room: 'LT-4', meetings: [[2, '10:00', '12:00'], [4, '08:00', '09:00']] },
    { course: 'MTH102', term: 't3', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 45, room: 'MTH-01', meetings: [[3, '11:00', '13:00']] },
    { course: 'EEE201', term: 't3', section: 'A', instructor: 'o.eze@geu.edu', capacity: 40, room: 'EEE-LAB', meetings: [[1, '11:00', '13:00'], [5, '14:00', '16:00']] },
    { course: 'CSC101', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 80, room: 'LT-1', meetings: [[5, '10:00', '12:00']] },
    { course: 'MTH101', term: 't3', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 80, room: 'LT-2', meetings: [[4, '11:00', '13:00']] },
  ];

  const offerings: Record<string, string> = {};
  for (const o of offeringSpecs) {
    const row = await db.courseOffering.create({
      data: {
        schoolId, courseId: courses[o.course].id, termId: termIds[o.term], section: o.section,
        instructorId: instructors[o.instructor], capacity: o.capacity,
        waitlistCapacity: o.waitlistCapacity ?? 10, room: o.room,
        status: o.status ?? 'OPEN', gradesPosted: o.gradesPosted ?? false,
        meetings: {
          create: o.meetings.map(([dow, start, end]) => ({
            schoolId, dayOfWeek: dow, startMinute: at(start), endMinute: at(end), room: o.room,
          })),
        },
      },
    });
    offerings[`${o.course}-${o.section}-${o.term}`] = row.id;
  }

  const g = (student: string, key: string, ca: number, exam: number) =>
    gradeEnrollment(schoolId, students[student], offerings[key], ca, exam, max);

  const chidi = 'chidi.eze@student.geu.edu';
  const aisha = 'aisha.bello@student.geu.edu';
  const kunle = 'kunle.adeoye@student.geu.edu';
  const zainab = 'zainab.musa@student.geu.edu';
  const segun = 'segun.okonkwo@student.geu.edu';

  // Chidi — strong throughout.
  await g(chidi, 'CSC101-A-t1', 36, 50);
  await g(chidi, 'MTH101-A-t1', 34, 46);
  await g(chidi, 'CSC102-A-t2', 38, 52);
  await g(chidi, 'CSC202-A-t2', 32, 44);
  await g(chidi, 'MTH102-A-t2', 30, 42);

  // Aisha — solid, mid-range.
  await g(aisha, 'CSC101-A-t1', 28, 38);
  await g(aisha, 'MTH101-A-t1', 24, 34);
  await g(aisha, 'CSC102-A-t2', 30, 40);
  await g(aisha, 'CSC202-A-t2', 26, 36);

  // Kunle — failed ACC101, retook and passed. The repeat policy's test case.
  await g(kunle, 'CSC101-A-t1', 22, 30);
  await g(kunle, 'MTH101-A-t1', 18, 24);
  await g(kunle, 'ACC101-A-t1', 15, 20); // F, superseded
  await g(kunle, 'ACC101-R-t2', 26, 34); // B, best attempt
  await g(kunle, 'CSC102-A-t2', 24, 32);
  await g(kunle, 'CSC202-A-t2', 20, 26);

  // Zainab — one withdrawal, which must NOT depress her GPA.
  await g(zainab, 'MTH101-A-t1', 30, 40);
  await db.enrollment.create({
    data: {
      schoolId, studentId: students[zainab], offeringId: offerings['CSC101-A-t1'],
      status: 'WITHDRAWN', letterGrade: 'W', droppedAt: day(-340),
    },
  });
  await g(zainab, 'MTH102-A-t2', 32, 44);

  // Segun — struggling; ends on probation.
  await g(segun, 'ACC101-A-t1', 16, 22);
  await g(segun, 'MTH101-A-t1', 20, 24);
  await g(segun, 'CSC202-A-t2', 18, 25);

  // --- current-term registrations, filling CSC201-A and queuing two ----------
  const register = async (student: string, key: string) => {
    await db.enrollment.create({
      data: { schoolId, studentId: students[student], offeringId: offerings[key], status: 'REGISTERED' },
    });
    await db.courseOffering.update({
      where: { id: offerings[key] }, data: { seatsTaken: { increment: 1 } },
    });
  };

  await register(chidi, 'CSC201-A-t3');
  await register(aisha, 'CSC201-A-t3');
  await register(kunle, 'CSC201-A-t3');
  await db.enrollment.create({
    data: { schoolId, studentId: students[zainab], offeringId: offerings['CSC201-A-t3'], status: 'WAITLISTED', waitlistPosition: 1 },
  });
  await db.enrollment.create({
    data: { schoolId, studentId: students[segun], offeringId: offerings['CSC201-A-t3'], status: 'WAITLISTED', waitlistPosition: 2 },
  });
  await register(chidi, 'CSC302-A-t3');
  await register(aisha, 'MTH102-A-t3');
  await register(zainab, 'EEE201-A-t3');

  return { offerings, term3: termIds.t3 };
}

async function seedMitHistory(s: SeededSchool, max: number) {
  const { schoolId, termIds, courses, instructors, students } = s;

  const specs: [string, string, string, number, string, [number, string, string][], boolean][] = [
    ['SWE101', 't1', 'A', 40, 'TECH-1', [[1, '09:00', '11:00']], true],
    ['DAT101', 't1', 'A', 40, 'TECH-2', [[2, '09:00', '11:00']], true],
    ['SWE201', 't3', 'A', 30, 'TECH-1', [[1, '13:00', '15:00']], false],
    ['DAT201', 't3', 'A', 30, 'TECH-2', [[3, '13:00', '15:00']], false],
  ];

  const instructorIds = Object.values(instructors);
  const offerings: Record<string, string> = {};
  for (const [course, term, section, capacity, room, meetings, closed] of specs) {
    const row = await db.courseOffering.create({
      data: {
        schoolId, courseId: courses[course].id, termId: termIds[term], section,
        instructorId: instructorIds[specs.indexOf(specs.find((x) => x[0] === course)!) % instructorIds.length],
        capacity, room, status: closed ? 'CLOSED' : 'OPEN', gradesPosted: closed,
        meetings: {
          create: meetings.map(([dow, start, end]) => ({
            schoolId, dayOfWeek: dow, startMinute: at(start), endMinute: at(end), room,
          })),
        },
      },
    });
    offerings[`${course}-${section}-${term}`] = row.id;
  }

  const ama = 'ama.darko@student.meridian.edu.gh';
  const kofi = 'kofi.antwi@student.meridian.edu.gh';

  await gradeEnrollment(schoolId, students[ama], offerings['SWE101-A-t1'], 35, 49, max);
  await gradeEnrollment(schoolId, students[kofi], offerings['DAT101-A-t1'], 28, 37, max);

  for (const [student, key] of [[ama, 'SWE201-A-t3'], [kofi, 'DAT201-A-t3']] as const) {
    await db.enrollment.create({
      data: { schoolId, studentId: students[student], offeringId: offerings[key], status: 'REGISTERED' },
    });
    await db.courseOffering.update({
      where: { id: offerings[key] }, data: { seatsTaken: { increment: 1 } },
    });
  }

  return { offerings, term3: termIds.t3 };
}

// -----------------------------------------------------------------------------
// Finance
// -----------------------------------------------------------------------------

async function seedFinance(s: SeededSchool, spec: SchoolSpec) {
  const { schoolId, termIds, programs, students } = s;
  const term3 = termIds.t3;

  await db.feeStructure.create({
    data: {
      schoolId, name: `Fall 2025 — Standard`, termId: term3, programId: null, level: null,
      items: {
        create: [
          { schoolId, code: 'TUITION', description: 'Tuition', amountMinor: minor(spec.tuitionPerCredit), perCreditHour: true, isMandatory: true },
          ...spec.fixedFees.map(([code, description, amount]) => ({
            schoolId, code, description, amountMinor: minor(amount), perCreditHour: false, isMandatory: true,
          })),
        ],
      },
    },
  });

  // A more specific structure for one program, so the resolver's
  // most-specific-wins rule has something real to choose between.
  const firstProgram = spec.programs[0];
  await db.feeStructure.create({
    data: {
      schoolId, name: `Fall 2025 — ${firstProgram.code}`, termId: term3,
      programId: programs[firstProgram.code], level: null,
      items: {
        create: [
          { schoolId, code: 'TUITION', description: 'Tuition (lab intensive)', amountMinor: minor(spec.tuitionPerCredit * 1.28), perCreditHour: true, isMandatory: true },
          { schoolId, code: 'LAB', description: 'Laboratory levy', amountMinor: minor(spec.tuitionPerCredit * 3.6), perCreditHour: false, isMandatory: true },
          ...spec.fixedFees.map(([code, description, amount]) => ({
            schoolId, code, description, amountMinor: minor(amount), perCreditHour: false, isMandatory: true,
          })),
        ],
      },
    },
  });

  // One paid, one partly paid, one overdue — per school, with school-prefixed
  // document numbers.
  const roster = spec.students.slice(0, 3);
  const year = NOW.getFullYear();
  let invSeq = 0;
  let rcpSeq = 0;

  // One invoice per student per term is a UNIQUE constraint, so the payment
  // patterns are zipped against however many students this school actually
  // has rather than padded to three.
  const patterns: { credits: number; paid: number | null; overdue: boolean }[] = [
    { credits: 7, paid: null, overdue: false }, // paid in full
    { credits: 7, paid: 0.55, overdue: false }, // partly paid
    { credits: 6, paid: 0, overdue: true },     // overdue, raises a hold
  ];
  const plans = roster.map((student, i) => ({ email: student.email, ...patterns[i] }));

  for (const plan of plans) {
    if (!students[plan.email]) continue;

    const tuition = minor(spec.tuitionPerCredit) * plan.credits;
    const lines = [
      {
        schoolId, code: 'TUITION', description: `Tuition (${plan.credits} credit hours)`,
        quantity: plan.credits, unitAmountMinor: minor(spec.tuitionPerCredit), amountMinor: tuition,
      },
      ...spec.fixedFees.map(([code, description, amount]) => ({
        schoolId, code, description, quantity: 1,
        unitAmountMinor: minor(amount), amountMinor: minor(amount),
      })),
    ];
    const subtotal = lines.reduce((t, l) => t + l.amountMinor, 0);
    const paid = plan.paid === null ? subtotal : Math.round(subtotal * plan.paid);
    const dueDate = plan.overdue ? day(-35) : day(14);
    const status = paid >= subtotal ? 'PAID' : plan.overdue ? 'OVERDUE' : paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED';

    invSeq += 1;
    const invoice = await db.invoice.create({
      data: {
        schoolId,
        invoiceNo: `INV-${spec.code}-${year}-${String(invSeq).padStart(6, '0')}`,
        studentId: students[plan.email], termId: term3,
        subtotalMinor: subtotal, discountMinor: 0, totalMinor: subtotal,
        paidMinor: Math.min(paid, subtotal), dueDate, issuedAt: day(-20), status,
        lines: { create: lines },
      },
    });

    if (paid > 0) {
      rcpSeq += 1;
      await db.payment.create({
        data: {
          schoolId,
          receiptNo: `RCP-${spec.code}-${year}-${String(rcpSeq).padStart(6, '0')}`,
          studentId: students[plan.email], amountMinor: paid, method: 'BANK_TRANSFER',
          status: 'CONFIRMED', unappliedMinor: 0, receivedAt: day(-10),
          allocations: { create: [{ schoolId, invoiceId: invoice.id, amountMinor: Math.min(paid, subtotal) }] },
        },
      });
    }

    if (plan.overdue) {
      await db.hold.create({
        data: {
          schoolId, studentId: students[plan.email], kind: 'FINANCIAL',
          reason: 'Tuition for Fall 2025 is more than 30 days overdue.',
          blocksRegistration: true, placedAt: day(-20),
        },
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

async function seedAdmissions(s: SeededSchool, spec: SchoolSpec, passwordHash: string) {
  const { schoolId, termIds, programs } = s;
  const year = NOW.getFullYear();

  const reviewer = await db.user.findFirst({
    where: { memberships: { some: { schoolId, role: { in: ['ADMISSIONS', 'ADMIN'] } } } },
  });
  const second = await db.user.findFirst({
    where: {
      memberships: { some: { schoolId, role: { in: ['ADMISSIONS', 'ADMIN', 'REGISTRAR'] } } },
      id: { not: reviewer?.id },
    },
  });

  const applicants = [
    { email: `hopeful.${spec.slug}@example.com`, first: 'Ifeoma', last: 'Chukwu', status: 'UNDER_REVIEW', gpa: 82, exam: 78, essay: 74, statement: 'I first wrote a program to help my mother track inventory for her shop, and I have not stopped building since. I want to study here because the problems that interest me — reliable systems people depend on without noticing — are engineering problems, not just coding ones.' },
    { email: `amina.${spec.slug}@example.com`, first: 'Amina', last: 'Mohammed', status: 'UNDER_REVIEW', gpa: 91, exam: 88, essay: 86, statement: 'My secondary school had one working computer for two hundred students. I taught myself to program on it during lunch breaks, then taught eleven classmates. I want to build the infrastructure that makes that scarcity unnecessary.' },
    { email: `grace.${spec.slug}@example.com`, first: 'Grace', last: 'Adamu', status: 'OFFERED', gpa: 88, exam: 84, essay: 80, statement: 'I am interested in how large systems stay consistent when parts of them fail. I have read what I can find on distributed consensus and would like to study it properly.' },
    { email: `daniel.${spec.slug}@example.com`, first: 'Daniel', last: 'Yusuf', status: 'SUBMITTED', gpa: 45, exam: 38, essay: null, statement: 'I am good with numbers and my uncle runs a practice where I could work after graduating. I have helped in his office during holidays.' },
    { email: `lami.${spec.slug}@example.com`, first: 'Lami', last: 'Ibrahim', status: 'ACCEPTED', gpa: 86, exam: 82, essay: 88, statement: 'My undergraduate project implemented a small Raft consensus library. I want to continue that work, focusing on how these protocols behave under the network conditions common in this region rather than in datacentre benchmarks.' },
  ];

  let seq = 0;
  for (const a of applicants) {
    const user = await db.user.create({
      data: { email: a.email, passwordHash, firstName: a.first, lastName: a.last },
    });
    await db.membership.create({
      data: { userId: user.id, schoolId, role: 'APPLICANT', isPrimary: true, status: 'ACTIVE' },
    });
    const applicant = await db.applicant.create({
      data: {
        schoolId, userId: user.id, nationality: spec.country === 'NG' ? 'Nigerian' : 'Ghanaian',
        address: spec.timezone.split('/')[1], dateOfBirth: new Date('2006-04-12'),
      },
    });

    seq += 1;
    const application = await db.application.create({
      data: {
        schoolId,
        referenceNo: `APP-${spec.code}-${year}-${String(seq).padStart(6, '0')}`,
        applicantId: applicant.id,
        programId: programs[spec.programs[seq % spec.programs.length].code],
        termId: termIds.t3,
        status: a.status,
        priorGpaScore: a.gpa, entranceExamScore: a.exam, essayScore: a.essay,
        personalStatement: a.statement, previousSchool: 'Government Secondary School',
        submittedAt: day(-25),
        decidedAt: ['OFFERED', 'ACCEPTED'].includes(a.status) ? day(-10) : null,
        offerExpiresAt: a.status === 'OFFERED' ? day(11) : null,
      },
    });

    if (['UNDER_REVIEW', 'OFFERED', 'ACCEPTED'].includes(a.status) && reviewer && second) {
      await db.applicationReview.create({
        data: {
          schoolId, applicationId: application.id, reviewerId: reviewer.id,
          academicScore: a.gpa, essayScore: a.essay ?? 70, interviewScore: 76,
          extracurricularScore: 68, recommendation: a.gpa >= 80 ? 'ADMIT' : 'WAITLIST',
          comments: a.gpa >= 80
            ? 'Strong academic record and a clear, specific motivation. Recommend admission.'
            : 'Adequate record; would benefit from a stronger statement of purpose.',
        },
      });
      await db.applicationReview.create({
        data: {
          schoolId, applicationId: application.id, reviewerId: second.id,
          academicScore: a.gpa - 3, essayScore: (a.essay ?? 70) + 4, interviewScore: 80,
          extracurricularScore: 72, recommendation: a.gpa >= 78 ? 'ADMIT' : 'WAITLIST',
          comments: 'Second read. Concur with the first reviewer.',
        },
      });
    }
  }

  await db.announcement.createMany({
    data: [
      {
        schoolId,
        title: 'Fall 2025 registration is open',
        body: `Registration closes on ${day(21).toDateString()}. Settle any outstanding fees first — an unpaid balance places a hold on your record and blocks registration.`,
        audience: 'STUDENT', severity: 'INFO',
      },
      {
        schoolId,
        title: 'Grade submission deadline',
        body: 'Final grades must be submitted and posted within two weeks of the last examination.',
        audience: 'INSTRUCTOR', severity: 'WARNING',
      },
    ],
  });
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

async function main() {
  console.log('Resetting…');

  // Children before parents — SQLite enforces the foreign keys.
  await db.auditLog.deleteMany();
  await db.paymentAllocation.deleteMany();
  await db.payment.deleteMany();
  await db.invoiceLine.deleteMany();
  await db.invoice.deleteMany();
  await db.feeItem.deleteMany();
  await db.feeStructure.deleteMany();
  await db.hold.deleteMany();
  await db.termGpa.deleteMany();
  await db.enrollment.deleteMany();
  await db.meeting.deleteMany();
  await db.courseOffering.deleteMany();
  await db.applicationReview.deleteMany();
  await db.applicationDocument.deleteMany();
  await db.application.deleteMany();
  await db.applicant.deleteMany();
  await db.programRequirement.deleteMany();
  await db.prerequisite.deleteMany();
  await db.course.deleteMany();
  await db.student.deleteMany();
  await db.instructor.deleteMany();
  await db.program.deleteMany();
  await db.department.deleteMany();
  await db.faculty.deleteMany();
  await db.term.deleteMany();
  await db.announcement.deleteMany();
  await db.membership.deleteMany();
  await db.orgUnit.deleteMany();
  await db.identityProvider.deleteMany();
  await db.schoolConfig.deleteMany();
  await db.platformAdmin.deleteMany();
  await db.school.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  console.log('Seeding schools…');
  const geu = await seedSchool(GEU, passwordHash);
  await seedGeuHistory(geu, GEU.maxGradePoint);
  await seedFinance(geu, GEU);
  await seedAdmissions(geu, GEU, passwordHash);

  const mit = await seedSchool(MIT, passwordHash);
  await seedMitHistory(mit, MIT.maxGradePoint);
  await seedFinance(mit, MIT);
  await seedAdmissions(mit, MIT, passwordHash);

  // --- reporting lines -------------------------------------------------------
  // The Dean's direct reports, so the hierarchy has something real in it before
  // the task system arrives.
  const dean = await db.membership.findFirst({
    where: { schoolId: geu.schoolId, user: { email: 'a.okafor@geu.edu' } },
  });
  if (dean) {
    await db.membership.updateMany({
      where: {
        schoolId: geu.schoolId,
        role: 'INSTRUCTOR',
        id: { not: dean.id },
      },
      data: { managerId: dean.id },
    });
  }

  // --- platform operator -----------------------------------------------------
  // Holds an ADMIN membership at GEU as their home school, plus the platform
  // grant. A session always needs a school; the platform grant is what unlocks
  // the cross-tenant routes on top of it.
  const operator = await db.user.findUnique({ where: { email: 'admin@geu.edu' } });
  if (operator) {
    await db.platformAdmin.create({ data: { userId: operator.id } });
  }

  // --- recompute derived academics ------------------------------------------
  console.log('\nComputing GPAs and academic standing…');
  const { recomputeStudentAcademics } = await import('../src/server/academics');
  for (const school of [geu, mit]) {
    for (const studentId of Object.values(school.students)) {
      await recomputeStudentAcademics(school.schoolId, studentId);
    }
  }

  // --- summary ---------------------------------------------------------------
  const schools = await db.school.findMany({ orderBy: { code: 'asc' } });
  console.log('\n  Seed complete.\n');

  for (const school of schools) {
    const students = await db.student.findMany({
      where: { schoolId: school.id },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { cgpa: 'desc' },
    });
    console.log(`  ${school.name} (${school.code}) · ${school.currencyCode} · /s/${school.slug}`);
    for (const s of students) {
      console.log(
        `    ${s.matricNumber.padEnd(20)} ${`${s.user.firstName} ${s.user.lastName}`.padEnd(20)}` +
        ` CGPA ${s.cgpa.toFixed(2)}  ${s.creditsEarned}/${s.creditsAttempted} cr  ${s.academicStanding}`,
      );
    }
    console.log('');
  }

  const shared = await db.user.findUnique({
    where: { email: 'a.okafor@geu.edu' },
    include: { memberships: { include: { school: { select: { code: true } } } } },
  });
  if (shared) {
    console.log(
      `  One identity, two schools: ${shared.email} -> ` +
      shared.memberships.map((m) => `${m.school.code}:${m.role}`).join(', '),
    );
  }

  console.log(`\n  Password for every account: ${PASSWORD}\n`);
  console.log('  Golden Eagles University — /s/golden-eagles/login');
  console.log('    admin@geu.edu                 School admin (also platform operator)');
  console.log('    registrar@geu.edu             Registrar');
  console.log('    admissions@geu.edu            Admissions officer');
  console.log('    bursary@geu.edu               Finance officer');
  console.log('    a.okafor@geu.edu              Instructor · Dean, 3 direct reports');
  console.log('    chidi.eze@student.geu.edu     Student (strong record)');
  console.log('    kunle.adeoye@student.geu.edu  Student (repeated course)');
  console.log('    segun.okonkwo@student.geu.edu Student (probation + financial hold)');
  console.log('');
  console.log('  Meridian Institute of Technology — /s/meridian/login');
  console.log('    admin@meridian.edu.gh         School admin');
  console.log('    registrar@meridian.edu.gh     Registrar');
  console.log('    ama.darko@student.meridian.edu.gh   Student');
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
