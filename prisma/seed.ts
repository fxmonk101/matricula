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

// The seed builds config through the SAME module the app parses it with, so a
// seeded school cannot end up with a shape the loader silently rejects.
import {
  DEFAULT_ADMISSIONS_CONFIG,
  DEFAULT_ENROLLMENT_POLICY,
  DEFAULT_FINANCE_CONFIG,
  DEFAULT_REGISTRATION_PORTAL_CONFIG,
  assertGradingConfigWellFormed,
  gradingPreset,
} from '../src/lib/domain/config';
import { scoreToGrade } from '../src/lib/domain/grading';
import { seedK12School } from './seed-k12';

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
    // Engineering and Management need their own dean and heads: EEE and ACC sit
    // outside the Faculty of Science, and without these their staff would have
    // to report across a faculty boundary to be managed at all.
    { email: 'b.adewale@geu.edu', first: 'Bola', last: 'Adewale', role: 'INSTRUCTOR', dept: 'EEE', rank: 'PROFESSOR', staffNo: 'STF-0300', office: 'EEE-200', title: 'Dean, Faculty of Engineering' },
    { email: 'i.nwachukwu@geu.edu', first: 'Ifeanyi', last: 'Nwachukwu', role: 'INSTRUCTOR', dept: 'EEE', rank: 'SENIOR_LECTURER', staffNo: 'STF-0302', office: 'EEE-118', title: 'Head, Electrical & Electronic Engineering' },
    { email: 's.oyelaran@geu.edu', first: 'Simisola', last: 'Oyelaran', role: 'INSTRUCTOR', dept: 'ACC', rank: 'PROFESSOR', staffNo: 'STF-0400', office: 'ACC-101', title: 'Dean, Faculty of Management Sciences' },
    { email: 'k.abiodun@geu.edu', first: 'Kehinde', last: 'Abiodun', role: 'INSTRUCTOR', dept: 'ACC', rank: 'SENIOR_LECTURER', staffNo: 'STF-0401', office: 'ACC-014', title: 'Head, Accounting' },
    // Ordinary lecturers, so each head actually has somebody to head.
    { email: 'c.nnaji@geu.edu', first: 'Chinelo', last: 'Nnaji', role: 'INSTRUCTOR', dept: 'CSC', rank: 'LECTURER', staffNo: 'STF-0103', office: 'CSC-112' },
    { email: 'y.sani@geu.edu', first: 'Yakubu', last: 'Sani', role: 'INSTRUCTOR', dept: 'MTH', rank: 'LECTURER', staffNo: 'STF-0202', office: 'MTH-009' },
    { email: 'r.okeke@geu.edu', first: 'Rita', last: 'Okeke', role: 'INSTRUCTOR', dept: 'EEE', rank: 'ASSISTANT_LECTURER', staffNo: 'STF-0303', office: 'EEE-044' },
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
  // Same percentage cut-offs, scaled to this school's maximum grade point —
  // exactly the kind of thing that must be per-school data rather than a
  // constant in the code.
  const grading = gradingPreset(spec.maxGradePoint);
  // Fail loudly at seed time rather than shipping a scale the app would reject.
  assertGradingConfigWellFormed(grading);

  return {
    gradingJson: JSON.stringify(grading),
    enrollmentJson: JSON.stringify({
      ...DEFAULT_ENROLLMENT_POLICY,
      overloadMinCgpa: Math.round(spec.maxGradePoint * 0.75 * 100) / 100,
    }),
    admissionsJson: JSON.stringify(DEFAULT_ADMISSIONS_CONFIG),
    financeJson: JSON.stringify({
      ...DEFAULT_FINANCE_CONFIG,
      currency: { code: spec.currencyCode, symbol: spec.currencySymbol, exponent: 2 },
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
      ...DEFAULT_REGISTRATION_PORTAL_CONFIG,
      openProgramCodes: spec.programs.map((p) => p.code),
    }),
  };
}

// -----------------------------------------------------------------------------
// seedSchool
// -----------------------------------------------------------------------------

/**
 * The plans a school can be sold.
 *
 * Prices in MINOR units, as everywhere else in the system. The ceilings are the
 * interesting part: `null` is unlimited and `0` sells nothing, and the two must
 * stay distinguishable — `checkSeat` treats them as opposites and a test pins
 * that they are not confused.
 */
async function seedPlans() {
  const specs = [
    {
      code: 'STARTER',
      name: 'Starter',
      description: 'A single primary or secondary school finding its feet.',
      priceMinor: 45_000_00,
      maxStudents: 300,
      maxStaff: 30,
      trialDays: 30,
      position: 0,
      features: { library: true, forums: true, timetable: true, admissions: false },
    },
    {
      code: 'STANDARD',
      name: 'Standard',
      description: 'A full school with admissions, finance and reporting.',
      priceMinor: 120_000_00,
      maxStudents: 1_500,
      maxStaff: 150,
      trialDays: 30,
      position: 1,
      features: { library: true, forums: true, timetable: true, admissions: true },
    },
    {
      code: 'INSTITUTION',
      name: 'Institution',
      description: 'A university or multi-campus group. No seat ceiling.',
      priceMinor: 480_000_00,
      maxStudents: null,
      maxStaff: null,
      trialDays: 14,
      position: 2,
      features: { library: true, forums: true, timetable: true, admissions: true },
    },
  ];

  const created: Record<string, string> = {};
  for (const spec of specs) {
    const plan = await db.plan.create({
      data: {
        code: spec.code,
        name: spec.name,
        description: spec.description,
        priceMinor: spec.priceMinor,
        currencyCode: 'NGN',
        billingPeriod: 'ANNUAL',
        maxStudents: spec.maxStudents,
        maxStaff: spec.maxStaff,
        featuresJson: JSON.stringify(spec.features),
        trialDays: spec.trialDays,
        position: spec.position,
      },
    });
    created[spec.code] = plan.id;
    console.log(`  · ${spec.name.padEnd(12)} ${spec.maxStudents ?? '∞'} students`);
  }
  return created;
}

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
  // Grade through the SAME scale the app uses. The seed previously had its own
  // band arithmetic, which meant a freshly seeded grade disagreed with what the
  // app would compute for the identical score — and the disagreement only
  // surfaced the first time anything recomputed.
  const { letter, point } = scoreToGrade(total, gradingPreset(maxPoint).scale);

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
  await db.reportCardLine.deleteMany();
  await db.reportCard.deleteMany();
  await db.attendanceRecord.deleteMany();
  await db.subjectResult.deleteMany();
  await db.subjectAssignment.deleteMany();
  await db.classEnrolment.deleteMany();
  await db.subject.deleteMany();
  await db.formClass.deleteMany();
  await db.yearGroup.deleteMany();
  await db.guardianStudent.deleteMany();
  await db.guardian.deleteMany();
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
  await db.subscriptionInvoiceLine.deleteMany();
  await db.subscriptionInvoice.deleteMany();
  await db.subscription.deleteMany();
  await db.plan.deleteMany();
  await db.platformAdmin.deleteMany();
  await db.school.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  console.log('Seeding subscription plans…');
  const plans = await seedPlans();

  console.log('Seeding schools…');
  const geu = await seedSchool(GEU, passwordHash);
  await seedGeuHistory(geu, GEU.maxGradePoint);
  await seedFinance(geu, GEU);
  await seedAdmissions(geu, GEU, passwordHash);

  const mit = await seedSchool(MIT, passwordHash);
  await seedMitHistory(mit, MIT.maxGradePoint);
  await seedFinance(mit, MIT);
  await seedAdmissions(mit, MIT, passwordHash);

  // --- a K-12 school, to prove the academic-model switch is real -------------
  const gis = await seedK12School(db, passwordHash, day);

  // Report cards are GENERATED by the service, not written by the seed: the
  // positions, class averages and promotion decisions have to come from the
  // same code the app runs, or the seeded document would disagree with a
  // regenerated one.
  const { generateClassReportCards } = await import('../src/server/k12-reports');
  const run = await generateClassReportCards({
    schoolId: gis.schoolId,
    schoolCode: 'GIS',
    formClassId: gis.formClassId,
    termId: gis.termId,
    actorId: null,
    publish: true,
  });
  console.log(`    report cards: ${run.message} (${run.promoted} promoted, ${run.repeating} repeating, ${run.underReview} under review)`);

  // --- collaboration layer (Phase 3) -----------------------------------------
  // Hierarchy, teaching allocation, tasks and notifications, for the two
  // universities. Everything is created through the real services so a seeded
  // task cannot disagree with one the application would have raised.
  console.log('\nSeeding hierarchy, allocations and tasks…');
  const {
    seedHierarchy,
    seedAllocations,
    seedTaskActivity,
    seedAdHocTasks,
  } = await import('./seed-collaboration');

  // --- Golden Eagles: a three-level line under the Dean ----------------------
  // Dean → two heads of department → the lecturers under each. Three levels is
  // the minimum that makes transitive resolution mean anything: with only two,
  // "my team" and "my direct reports" are the same set and a bug between them
  // is invisible.
  const geuCtx = { db, schoolId: geu.schoolId, day };
  await seedHierarchy(geuCtx, {
    lines: {
      'a.okafor@geu.edu':   { manager: null,               unit: 'SCI', title: 'Dean, Faculty of Science' },
      'f.dauda@geu.edu':    { manager: 'a.okafor@geu.edu', unit: 'MTH', title: 'Head of Department, Mathematics' },
      'e.balogun@geu.edu':  { manager: 'f.dauda@geu.edu',  unit: 'CSC', title: 'Senior Lecturer' },
      'o.eze@geu.edu':      { manager: 'f.dauda@geu.edu',  unit: 'EEE', title: 'Lecturer' },
      'registrar@geu.edu':  { manager: null,               unit: null,  title: 'Registrar' },
      'library@geu.edu':    { manager: 'registrar@geu.edu', unit: null, title: 'University Librarian' },
      'bursary@geu.edu':    { manager: null,               unit: null,  title: 'Bursar' },
      'admissions@geu.edu': { manager: 'registrar@geu.edu', unit: null, title: 'Head of Admissions' },
    },
    heads: { SCI: 'a.okafor@geu.edu', MTH: 'f.dauda@geu.edu' },
  });

  const geuAlloc = await seedAllocations(geuCtx, {
    deanEmail: 'a.okafor@geu.edu',
    termIds: [geu.termIds.t2, geu.termIds.t3],
  });
  const geuMoved = await seedTaskActivity(geuCtx, {
    deanEmail: 'a.okafor@geu.edu',
    staffEmails: ['e.balogun@geu.edu', 'f.dauda@geu.edu', 'o.eze@geu.edu'],
  });
  const geuAdHoc = await seedAdHocTasks(geuCtx, {
    deanEmail: 'a.okafor@geu.edu',
    items: [
      {
        to: 'e.balogun@geu.edu',
        title: 'Revise CSC201 syllabus for accreditation',
        description: 'The accreditation panel flagged the data-structures outline as thin on complexity analysis. Revise and return for faculty review.',
        priority: 'HIGH',
        dueInDays: -9,
      },
      {
        to: 'o.eze@geu.edu',
        title: 'Submit laboratory equipment inventory',
        description: 'Annual return for the electrical engineering teaching laboratory.',
        priority: 'URGENT',
        dueInDays: -2,
      },
      {
        to: 'f.dauda@geu.edu',
        title: 'Nominate external examiner for MTH301',
        description: 'Two names with affiliations and a short justification for each.',
        priority: 'NORMAL',
        dueInDays: 5,
      },
      {
        to: 'e.balogun@geu.edu',
        title: 'Faculty board paper: intake projections',
        description: 'One page on projected computer science intake for the coming session.',
        priority: 'LOW',
        dueInDays: 21,
      },
    ],
  });
  console.log(`  GEU  allocations ${geuAlloc.allocated} (skipped ${geuAlloc.skipped}) · task moves ${geuMoved.moved} · ad-hoc ${geuAdHoc}`);

  // --- Meridian: a smaller, flatter department -------------------------------
  // Two academics, one of whom is the GEU Dean wearing a different hat. That
  // person's Meridian tasks must never appear in their Golden Eagles queue,
  // which is the property tasks-keyed-on-membership exists to guarantee.
  const mitCtx = { db, schoolId: mit.schoolId, day };
  await seedHierarchy(mitCtx, {
    lines: {
      'n.owusu@meridian.edu.gh':   { manager: null,                     unit: 'TECH', title: 'Head of Department, Software Engineering' },
      'a.okafor@geu.edu':          { manager: 'n.owusu@meridian.edu.gh', unit: 'DAT', title: 'Visiting Professor' },
      'registrar@meridian.edu.gh': { manager: null,                     unit: null,  title: 'Registrar' },
      'finance@meridian.edu.gh':   { manager: null,                     unit: null,  title: 'Finance Officer' },
    },
    heads: { TECH: 'n.owusu@meridian.edu.gh' },
  });

  const mitAlloc = await seedAllocations(mitCtx, {
    deanEmail: 'n.owusu@meridian.edu.gh',
    termIds: [mit.termIds.t2, mit.termIds.t3],
  });
  const mitMoved = await seedTaskActivity(mitCtx, {
    deanEmail: 'n.owusu@meridian.edu.gh',
    staffEmails: ['a.okafor@geu.edu'],
  });
  const mitAdHoc = await seedAdHocTasks(mitCtx, {
    deanEmail: 'n.owusu@meridian.edu.gh',
    items: [
      {
        to: 'a.okafor@geu.edu',
        title: 'Design the DAT201 capstone brief',
        description: 'A machine-learning capstone the second-year cohort can complete in eight weeks.',
        priority: 'HIGH',
        dueInDays: 10,
      },
      {
        to: 'a.okafor@geu.edu',
        title: 'Confirm visiting-teaching dates for next semester',
        description: 'Meridian needs your availability before the timetable is published.',
        priority: 'NORMAL',
        dueInDays: -1,
      },
    ],
  });
  console.log(`  MIT  allocations ${mitAlloc.allocated} (skipped ${mitAlloc.skipped}) · task moves ${mitMoved.moved} · ad-hoc ${mitAdHoc}`);

  // --- forums (Phase 4) ------------------------------------------------------
  console.log('\nSeeding forums…');
  const {
    seedForums, GEU_FORUMS, GEU_THREADS, MIT_FORUMS, MIT_THREADS,
  } = await import('./seed-forums');

  const geuForums = await seedForums(
    { db, schoolId: geu.schoolId },
    { forums: GEU_FORUMS, threads: GEU_THREADS },
  );
  console.log(`  GEU  ${geuForums.forums} forums · ${geuForums.threads} threads · ${geuForums.posts} posts`);

  const mitForums = await seedForums(
    { db, schoolId: mit.schoolId },
    { forums: MIT_FORUMS, threads: MIT_THREADS },
  );
  console.log(`  MIT  ${mitForums.forums} forums · ${mitForums.threads} threads · ${mitForums.posts} posts`);

  // --- library (Phase 5) -----------------------------------------------------
  console.log('\nSeeding the resource library…');
  const { seedLibrary, GEU_RESOURCES, MIT_RESOURCES } = await import('./seed-library');

  const geuLib = await seedLibrary(
    { db, schoolId: geu.schoolId },
    { curatorEmail: 'library@geu.edu', resources: GEU_RESOURCES },
  );
  console.log(`  GEU  ${geuLib.added} resources (${geuLib.refused} refused) · ${geuLib.views} views`);

  // Meridian has no librarian membership, so the registrar curates — which is
  // also the realistic case for a smaller institution.
  const mitLib = await seedLibrary(
    { db, schoolId: mit.schoolId },
    { curatorEmail: 'registrar@meridian.edu.gh', resources: MIT_RESOURCES },
  );
  console.log(`  MIT  ${mitLib.added} resources (${mitLib.refused} refused) · ${mitLib.views} views`);

  // An escalation sweep, so overdue work has actually escalated and the bell
  // has something in it on first sign-in.
  const { runEscalationSweep } = await import('../src/server/services/task.service');
  for (const s of [geu, mit]) {
    const sweep = await runEscalationSweep(s.schoolId);
    console.log(`  sweep ${s.school.code}: examined ${sweep.examined}, escalated ${sweep.escalated}, reminded ${sweep.reminded}`);
  }

  // --- subscriptions ---------------------------------------------------------
  // Each demo school gets the plan it would plausibly have bought. GEU and MIT
  // are live customers; the K-12 school is left on trial so the trial banner and
  // the countdown are visible somewhere without having to create a school first.
  console.log('\nAttaching subscriptions…');
  const subscriptions: { schoolId: string; planId: string; status: string; trialDays: number }[] = [
    { schoolId: geu.schoolId, planId: plans.INSTITUTION, status: 'ACTIVE', trialDays: 0 },
    { schoolId: mit.schoolId, planId: plans.INSTITUTION, status: 'ACTIVE', trialDays: 0 },
    { schoolId: gis.schoolId, planId: plans.STANDARD, status: 'TRIALING', trialDays: 21 },
  ];
  for (const spec of subscriptions) {
    await db.subscription.create({
      data: {
        schoolId: spec.schoolId,
        planId: spec.planId,
        status: spec.status,
        trialEndsAt:
          spec.trialDays > 0 ? new Date(day(0).getTime() + spec.trialDays * 86_400_000) : null,
        renewsAt: spec.status === 'ACTIVE' ? day(-1) : null,
      },
    });
  }
  // The trialing school's own status must agree with its subscription, or the
  // list page would show a school as ACTIVE while its subscription says trial.
  await db.school.update({ where: { id: gis.schoolId }, data: { status: 'TRIAL' } });

  // Raised and paid through the real service rather than written directly, so
  // the seeded invoice cannot be in a shape the product would never produce —
  // the reference format, the line copy and the status transitions are all the
  // ones an operator would get.
  const { raiseSubscriptionInvoice, recordSubscriptionPayment } = await import(
    '../src/server/services/platform.service'
  );
  const raised = await raiseSubscriptionInvoice({
    schoolId: geu.schoolId,
    periodStart: day(-365),
    periodEnd: day(0),
    dueInDays: 14,
    actorUserId: null,
  });
  if (raised.ok && raised.invoiceId) {
    await recordSubscriptionPayment({
      invoiceId: raised.invoiceId,
      amountMajor: 480_000,
      method: 'BANK_TRANSFER',
      reference: 'FT25091200871',
      actorUserId: null,
    });
  }
  // MIT's is raised and left unpaid, so the receivable and the "due" figure on
  // the school page are exercised by something other than a zero.
  await raiseSubscriptionInvoice({
    schoolId: mit.schoolId,
    periodStart: day(-30),
    periodEnd: day(335),
    dueInDays: 14,
    actorUserId: null,
  });

  // --- platform operator -----------------------------------------------------
  // Holds a membership at GEU as their home school, plus the platform grant. A
  // session always needs a school; the platform grant is what unlocks the
  // cross-tenant routes on top of it.
  //
  // Promoted to OWNER as well, so the demo actually exercises the role that
  // sits above ADMIN rather than leaving it reachable only by provisioning a
  // brand-new school.
  // The school's own owner. A customer, not the vendor.
  const owner = await db.user.findUnique({ where: { email: 'admin@geu.edu' } });
  if (owner) {
    await db.membership.updateMany({
      where: { userId: owner.id, schoolId: geu.schoolId },
      data: { role: 'OWNER', title: 'Vice-Chancellor' },
    });
  }

  /*
   * The VENDOR's operator account, and it belongs to NO SCHOOL.
   *
   * It used to be the same row as Golden Eagles' administrator, which made the
   * vendor look like a member of a customer institution and meant the console
   * rendered inside that customer's shell. The console is now its own portal
   * with its own cookie, so the account behind it holds no membership anywhere
   * — which is what it should always have been.
   */
  const operator = await db.user.create({
    data: {
      email: 'operator@platform.local',
      passwordHash,
      firstName: 'Platform',
      lastName: 'Operator',
    },
  });
  await db.platformAdmin.create({ data: { userId: operator.id } });
  console.log(`\n  Operator console: ${operator.email} (belongs to no school)`);

  // --- the academic reporting line -------------------------------------------
  // A university runs on Student → Lecturer → HOD → Dean → Registrar, so the
  // demo has to contain one of each or the org chart and the timetable are
  // exercised by nobody. These people already exist as instructors and keep
  // their Instructor profile — a dean still lectures — so only the MEMBERSHIP
  // role changes, which is where authorisation lives.
  console.log('\nAppointing deans and heads of department…');
  const appointments: { email: string; role: string; title: string }[] = [
    { email: 'a.okafor@geu.edu', role: 'DEAN', title: 'Dean, Faculty of Science' },
    { email: 'b.adewale@geu.edu', role: 'DEAN', title: 'Dean, Faculty of Engineering' },
    { email: 's.oyelaran@geu.edu', role: 'DEAN', title: 'Dean, Faculty of Management Sciences' },
    { email: 'e.balogun@geu.edu', role: 'HOD', title: 'Head, Computer Science' },
    { email: 'f.dauda@geu.edu', role: 'HOD', title: 'Head, Mathematics' },
    { email: 'i.nwachukwu@geu.edu', role: 'HOD', title: 'Head, Electrical & Electronic Engineering' },
    { email: 'k.abiodun@geu.edu', role: 'HOD', title: 'Head, Accounting' },
  ];
  for (const appointment of appointments) {
    const person = await db.user.findUnique({ where: { email: appointment.email } });
    if (!person) continue;
    await db.membership.updateMany({
      where: { userId: person.id, schoolId: geu.schoolId },
      data: { role: appointment.role, title: appointment.title },
    });
    console.log(`  · ${appointment.title.padEnd(28)} ${appointment.email}`);
  }

  // Wire the line itself, so /team and /org show a real chain rather than a
  // flat list. Each link is validated by `canReportTo` in the app; here the
  // shape is simply asserted by construction.
  const membershipFor = async (email: string) => {
    const person = await db.user.findUnique({ where: { email } });
    if (!person) return null;
    return db.membership.findFirst({ where: { userId: person.id, schoolId: geu.schoolId } });
  };

  /*
   * THE LINE IS DERIVED FROM THE STRUCTURE, NOT HAND-LISTED.
   *
   * It used to be three hardcoded pairs plus "remaining lecturers in Computer
   * Science answer to its head" — which wired Obinna Eze, who lectures in
   * Electrical & Electronic Engineering, to the head of Computer Science. EEE
   * is in the Faculty of ENGINEERING, so that one line had a lecturer reporting
   * across a department AND a faculty boundary. Nothing detected it, because
   * nothing was checking: a hand-written line is only correct on the day it is
   * written.
   *
   * Deriving it from each person's own department means the chain is right by
   * construction, and stays right when a department is added.
   */
  const registrar = await membershipFor('registrar@geu.edu');

  const deansByFaculty = new Map<string, string>();
  const headsByDepartment = new Map<string, string>();

  const academics = await db.membership.findMany({
    where: { schoolId: geu.schoolId, role: { in: ['DEAN', 'HOD', 'INSTRUCTOR'] } },
    include: { user: { select: { id: true, email: true } } },
  });

  // Resolve each academic's own department and faculty from their Instructor
  // profile, which is the only place that fact actually lives.
  const placement = new Map<string, { departmentId: string; facultyId: string }>();
  for (const member of academics) {
    const profile = await db.instructor.findFirst({
      where: { userId: member.userId, schoolId: geu.schoolId },
      include: { department: { select: { id: true, facultyId: true } } },
    });
    if (!profile?.department) continue;
    placement.set(member.id, {
      departmentId: profile.department.id,
      facultyId: profile.department.facultyId,
    });
    if (member.role === 'DEAN') deansByFaculty.set(profile.department.facultyId, member.id);
    if (member.role === 'HOD') headsByDepartment.set(profile.department.id, member.id);
  }

  for (const member of academics) {
    const where = placement.get(member.id);
    if (!where) continue;

    let managerId: string | null = null;
    if (member.role === 'INSTRUCTOR') {
      // A lecturer answers to the head of the department they teach in, and
      // falls back to their own dean where a department has no head yet.
      managerId = headsByDepartment.get(where.departmentId) ?? deansByFaculty.get(where.facultyId) ?? null;
    } else if (member.role === 'HOD') {
      managerId = deansByFaculty.get(where.facultyId) ?? null;
    } else if (member.role === 'DEAN') {
      managerId = registrar?.id ?? null;
    }

    // Nobody manages themselves — a dean who also heads a department would
    // otherwise be wired into a one-person cycle.
    if (!managerId || managerId === member.id) continue;
    await db.membership.update({ where: { id: member.id }, data: { managerId } });
  }

  // The org unit is what the presence roll-up reads to decide whose records a
  // dean or head may see, so it has to agree with the reporting line.
  for (const member of academics) {
    const where = placement.get(member.id);
    if (!where) continue;
    const unitName =
      member.role === 'DEAN'
        ? (await db.faculty.findUnique({ where: { id: where.facultyId } }))?.name
        : (await db.department.findUnique({ where: { id: where.departmentId } }))?.name;
    if (!unitName) continue;
    const unit = await db.orgUnit.findFirst({ where: { schoolId: geu.schoolId, name: unitName } });
    if (unit) await db.membership.update({ where: { id: member.id }, data: { orgUnitId: unit.id } });
  }

  // --- the register ----------------------------------------------------------
  /*
   * A FORTNIGHT OF SIGN-IN HISTORY.
   *
   * Without it a dean opens the team register and sees "never" against every
   * name — which is literally correct and reads as a broken page. A demo has to
   * show the feature doing its job, and the job includes showing the things
   * that go wrong: somebody who never signs in, somebody who forgets to sign
   * out, somebody who keys their arrival time in by hand.
   *
   * Deterministic, not random. A seed that produces different data every run
   * cannot be used to reproduce anything anybody reports.
   */
  console.log('\nWriting a fortnight of sign-in history…');

  const registerPeople = await db.membership.findMany({
    where: {
      schoolId: geu.schoolId,
      status: 'ACTIVE',
      role: { in: ['DEAN', 'HOD', 'INSTRUCTOR', 'REGISTRAR', 'FINANCE', 'LIBRARIAN', 'STUDENT'] },
    },
    include: { user: { select: { id: true, username: true, email: true } }, orgUnit: true },
  });

  await db.presenceBreak.deleteMany({ where: { schoolId: geu.schoolId } });
  await db.presenceSession.deleteMany({ where: { schoolId: geu.schoolId } });

  const dayNames = (back: number) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return d;
  };

  let sessionsWritten = 0;
  let personIndex = 0;

  for (const member of registerPeople) {
    personIndex += 1;

    // One person in every seven never signs in at all: the case the register
    // exists to surface, and the one a page that lists only rows would hide.
    const neverSignsIn = personIndex % 7 === 0;
    if (neverSignsIn) continue;

    const identity = await db.instructor.findFirst({
      where: { userId: member.userId, schoolId: geu.schoolId },
      include: { department: true },
    });
    const student = identity
      ? null
      : await db.student.findFirst({
          where: { userId: member.userId, schoolId: geu.schoolId },
          include: { program: { include: { department: true } } },
        });

    const identifier =
      student?.matricNumber ?? identity?.staffNumber ?? member.user.username ?? member.user.email;
    const unit =
      student?.program?.department?.name ?? identity?.department?.name ?? member.orgUnit?.name ?? null;

    for (let back = 13; back >= 0; back -= 1) {
      const day = dayNames(back);
      const weekday = day.getDay();
      if (weekday === 0 || weekday === 6) continue;

      // Deterministic absences, spread so no two people are off on the same
      // pattern.
      if ((back + personIndex) % 5 === 0) continue;

      const localDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

      const startHour = 7 + (personIndex % 3);
      const startMinute = (personIndex * 7) % 60;
      const startedAt = new Date(day);
      startedAt.setHours(startHour, startMinute, 0, 0);

      const lengthMinutes = 7 * 60 + ((personIndex * 13) % 150);
      const endedAt = new Date(startedAt.getTime() + lengthMinutes * 60_000);

      // One person is still in the building today, so "in right now" is not
      // always zero.
      const stillIn = back === 0 && personIndex % 4 === 1;

      // Somebody, occasionally, forgets to sign out and gets swept.
      const forgotten = !stillIn && back > 0 && (back + personIndex) % 11 === 0;

      // A keyed arrival time, so the "keyed" marker appears somewhere.
      const declared = (back + personIndex) % 6 === 0;

      const takesLunch = lengthMinutes > 6 * 60;
      const lunchMinutes = 30 + ((personIndex * 5) % 30);
      const takesShort = personIndex % 3 === 0;

      const breakDeduction = takesLunch ? lunchMinutes : 0;
      const gross = forgotten ? 16 * 60 : lengthMinutes;

      const session = await db.presenceSession.create({
        data: {
          schoolId: geu.schoolId,
          membershipId: member.id,
          localDate,
          startedAt,
          startDeclared: declared,
          endedAt: stillIn ? null : forgotten ? new Date(startedAt.getTime() + 16 * 60 * 60_000) : endedAt,
          durationMinutes: stillIn ? null : gross,
          breakMinutes: stillIn ? 0 : breakDeduction,
          netMinutes: stillIn ? null : Math.max(0, gross - breakDeduction),
          status: stillIn ? 'OPEN' : forgotten ? 'AUTO_CLOSED' : 'CLOSED',
          startSource: 'SELF',
          endSource: stillIn ? null : forgotten ? 'OFFICE' : 'SELF',
          openKey: stillIn ? member.id : null,
          identifierGiven: identifier,
          unitGiven: unit,
        },
      });
      sessionsWritten += 1;

      if (takesLunch && !stillIn) {
        const lunchStart = new Date(startedAt.getTime() + 4 * 60 * 60_000);
        await db.presenceBreak.create({
          data: {
            schoolId: geu.schoolId,
            sessionId: session.id,
            kind: 'LUNCH',
            startedAt: lunchStart,
            endedAt: new Date(lunchStart.getTime() + lunchMinutes * 60_000),
            minutes: lunchMinutes,
            paid: false,
          },
        });
      }
      if (takesShort && !stillIn) {
        const shortStart = new Date(startedAt.getTime() + 2 * 60 * 60_000);
        await db.presenceBreak.create({
          data: {
            schoolId: geu.schoolId,
            sessionId: session.id,
            kind: personIndex % 2 === 0 ? 'SHORT' : 'PRAYER',
            startedAt: shortStart,
            endedAt: new Date(shortStart.getTime() + 15 * 60_000),
            minutes: 15,
            // Short and prayer breaks are paid, so they must NOT be deducted.
            paid: true,
          },
        });
      }
    }
  }

  console.log(`  · ${sessionsWritten} sessions across ${registerPeople.length} people`);

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

  /*
   * The operator portal is a SEPARATE sign-in with a separate cookie, and the
   * account that reaches it holds no school membership at all. Leaving it out
   * of this summary meant the only way to find it was to read the schema.
   */
  const operators = await db.platformAdmin.findMany({
    include: { user: { select: { email: true, username: true } } },
  });
  if (operators.length > 0) {
    console.log('  Platform operator (us, not a school) — /operator/login');
    for (const operator of operators) {
      console.log(
        `    ${(operator.user.email ?? operator.user.username ?? '').padEnd(29)} Provisions and suspends schools`,
      );
    }
    console.log('');
  }
  console.log('  Golden Eagles University — /s/golden-eagles/login');
  console.log('    admin@geu.edu                 Owner (school admin — NOT the platform operator)');
  console.log('    registrar@geu.edu             Registrar');
  console.log('    admissions@geu.edu            Admissions officer');
  console.log('    bursary@geu.edu               Finance officer (Bursar)');
  console.log('    chidi.eze@student.geu.edu     Student (strong record)');
  console.log('    kunle.adeoye@student.geu.edu  Student (repeated course)');
  console.log('    segun.okonkwo@student.geu.edu Student (probation + financial hold)');

  /*
   * THE ACADEMIC CHAIN IS PRINTED FROM THE DATABASE, NOT HAND-LISTED.
   *
   * This block used to describe one person as "Instructor · Dean" and mention
   * no heads of department at all, which made it impossible to tell from the
   * summary that a dean and a lecturer are different accounts — or that the
   * heads existed. A hand-written summary of derived data drifts away from it
   * the first time the data changes.
   */
  console.log('');
  console.log('    The academic line — a dean, a head and a lecturer are DIFFERENT people:');
  const chain = await db.membership.findMany({
    where: { schoolId: geu.schoolId, role: { in: ['DEAN', 'HOD', 'INSTRUCTOR'] } },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      orgUnit: { select: { name: true } },
      manager: { include: { user: { select: { lastName: true } } } },
      _count: { select: { reports: true } },
    },
    orderBy: [{ role: 'asc' }, { title: 'asc' }],
  });
  const ORDER = { DEAN: 0, HOD: 1, INSTRUCTOR: 2 } as Record<string, number>;
  for (const person of chain.sort(
    (a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || a.user.lastName.localeCompare(b.user.lastName),
  )) {
    const reports = person._count.reports;
    const under = person.manager ? `under ${person.manager.user.lastName}` : 'top of the line';
    console.log(
      `    ${(person.user.email ?? '').padEnd(29)} ${person.role.padEnd(11)} ${(person.orgUnit?.name ?? '—').padEnd(37)} ${under}${reports > 0 ? `, ${reports} report${reports === 1 ? '' : 's'}` : ''}`,
    );
  }
  console.log('');
  console.log('  Golden Eagles International School (K-12) — /s/gis/login');
  console.log('    head@gis.edu.ng               Head teacher');
  console.log('    f.adeleke@gis.edu.ng          Form teacher, Year 7 Blue');
  console.log('    amara.nwosu@gis.edu.ng        Pupil (the report card on the design canvas)');
  console.log('    ngozi.nwosu@example.com       Parent of Amara');
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
