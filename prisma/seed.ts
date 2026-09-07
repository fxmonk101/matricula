/**
 * =============================================================================
 * SEED — a small but complete institution
 * =============================================================================
 *
 * The seed is written to exercise every interesting path in the system, not
 * just to make the screens non-empty:
 *
 *   · a student on the Dean's List, one in good standing, one on probation
 *   · a repeated course, so the best-attempt policy has something to collapse
 *   · a withdrawal, so "W" appears and is correctly excluded from the GPA
 *   · a full section with a waitlist behind it
 *   · a paid invoice, a partially-paid one, and an overdue one with a hold
 *   · applications at every stage of the admissions lifecycle
 *
 * Deterministic: no randomness, no Date.now() in the data itself. Running it
 * twice produces the same institution, so a bug reproduced against the seed is
 * reproducible for everyone.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const PASSWORD = 'Password123!';
const NOW = new Date();

/** Days from today, for readable relative dates. */
function day(offset: number): Date {
  const d = new Date(NOW.getTime());
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Naira -> kobo. */
const naira = (amount: number) => Math.round(amount * 100);

/** "09:30" -> minutes from midnight. */
const at = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

async function main() {
  console.log('Resetting…');

  // Order matters: children before parents, since SQLite enforces FKs.
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
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // ---------------------------------------------------------------------------
  // Organisational structure
  // ---------------------------------------------------------------------------
  console.log('Creating faculties, departments and programs…');

  const sciences = await db.faculty.create({
    data: { code: 'SCI', name: 'Faculty of Science' },
  });
  const engineering = await db.faculty.create({
    data: { code: 'ENG', name: 'Faculty of Engineering' },
  });
  const management = await db.faculty.create({
    data: { code: 'MGT', name: 'Faculty of Management Sciences' },
  });

  const csc = await db.department.create({
    data: { code: 'CSC', name: 'Computer Science', facultyId: sciences.id },
  });
  const mth = await db.department.create({
    data: { code: 'MTH', name: 'Mathematics', facultyId: sciences.id },
  });
  const eee = await db.department.create({
    data: { code: 'EEE', name: 'Electrical & Electronic Engineering', facultyId: engineering.id },
  });
  const acc = await db.department.create({
    data: { code: 'ACC', name: 'Accounting', facultyId: management.id },
  });

  const bscCsc = await db.program.create({
    data: {
      code: 'BSC-CSC',
      name: 'B.Sc. Computer Science',
      degreeType: 'BSC',
      departmentId: csc.id,
      creditsRequired: 120,
      durationTerms: 8,
      minCgpaToGraduate: 1.5,
    },
  });
  const bengEee = await db.program.create({
    data: {
      code: 'BENG-EEE',
      name: 'B.Eng. Electrical & Electronic Engineering',
      degreeType: 'BENG',
      departmentId: eee.id,
      creditsRequired: 150,
      durationTerms: 10,
      minCgpaToGraduate: 1.5,
    },
  });
  const bscAcc = await db.program.create({
    data: {
      code: 'BSC-ACC',
      name: 'B.Sc. Accounting',
      degreeType: 'BSC',
      departmentId: acc.id,
      creditsRequired: 120,
      durationTerms: 8,
    },
  });
  const mscCsc = await db.program.create({
    data: {
      code: 'MSC-CSC',
      name: 'M.Sc. Computer Science',
      degreeType: 'MSC',
      departmentId: csc.id,
      creditsRequired: 45,
      durationTerms: 4,
      minCgpaToGraduate: 2.5,
    },
  });

  // ---------------------------------------------------------------------------
  // Terms
  // ---------------------------------------------------------------------------
  console.log('Creating academic terms…');

  const term1 = await db.term.create({
    data: {
      code: '2024-FALL',
      name: 'Fall 2024',
      academicYear: '2024/2025',
      season: 'FALL',
      startDate: day(-400),
      endDate: day(-280),
      registrationOpensAt: day(-420),
      registrationClosesAt: day(-395),
      addDropDeadline: day(-385),
      withdrawalDeadline: day(-330),
      isCurrent: false,
    },
  });

  const term2 = await db.term.create({
    data: {
      code: '2025-SPRING',
      name: 'Spring 2025',
      academicYear: '2024/2025',
      season: 'SPRING',
      startDate: day(-250),
      endDate: day(-130),
      registrationOpensAt: day(-270),
      registrationClosesAt: day(-245),
      addDropDeadline: day(-235),
      withdrawalDeadline: day(-180),
      isCurrent: false,
    },
  });

  // The current term's registration window is deliberately OPEN right now, so
  // the registration screen is usable the moment the seed finishes.
  const term3 = await db.term.create({
    data: {
      code: '2025-FALL',
      name: 'Fall 2025',
      academicYear: '2025/2026',
      season: 'FALL',
      startDate: day(-14),
      endDate: day(105),
      registrationOpensAt: day(-30),
      registrationClosesAt: day(21),
      addDropDeadline: day(28),
      withdrawalDeadline: day(70),
      isCurrent: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------
  console.log('Creating staff accounts…');

  const staff = async (
    email: string,
    firstName: string,
    lastName: string,
    role: string,
  ) =>
    db.user.create({
      data: { email, passwordHash, firstName, lastName, role, phone: '+234 800 000 0000' },
    });

  await staff('admin@geu.edu', 'Amara', 'Nwosu', 'ADMIN');
  await staff('registrar@geu.edu', 'Tunde', 'Bakare', 'REGISTRAR');
  await staff('admissions@geu.edu', 'Ngozi', 'Adeyemi', 'ADMISSIONS');
  await staff('bursary@geu.edu', 'Ibrahim', 'Suleiman', 'FINANCE');

  const instructorSpecs = [
    { email: 'a.okafor@geu.edu', first: 'Adaeze', last: 'Okafor', dept: csc.id, rank: 'PROFESSOR', staffNo: 'STF-0101', office: 'CSC-301' },
    { email: 'e.balogun@geu.edu', first: 'Emeka', last: 'Balogun', dept: csc.id, rank: 'SENIOR_LECTURER', staffNo: 'STF-0102', office: 'CSC-208' },
    { email: 'f.dauda@geu.edu', first: 'Fatima', last: 'Dauda', dept: mth.id, rank: 'ASSOCIATE_PROFESSOR', staffNo: 'STF-0201', office: 'MTH-115' },
    { email: 'o.eze@geu.edu', first: 'Obinna', last: 'Eze', dept: eee.id, rank: 'LECTURER', staffNo: 'STF-0301', office: 'EEE-042' },
  ];

  const instructors: Record<string, string> = {};
  for (const spec of instructorSpecs) {
    const user = await staff(spec.email, spec.first, spec.last, 'INSTRUCTOR');
    const instructor = await db.instructor.create({
      data: {
        userId: user.id,
        staffNumber: spec.staffNo,
        departmentId: spec.dept,
        rank: spec.rank,
        officeRoom: spec.office,
      },
    });
    instructors[spec.email] = instructor.id;
  }

  // ---------------------------------------------------------------------------
  // Courses and the prerequisite DAG
  // ---------------------------------------------------------------------------
  console.log('Creating courses…');

  const courseSpecs = [
    { code: 'CSC101', title: 'Introduction to Computer Science', credits: 3, level: 100, dept: csc.id, desc: 'Foundations of computing, algorithms and problem decomposition.' },
    { code: 'CSC102', title: 'Programming Fundamentals', credits: 4, level: 100, dept: csc.id, desc: 'Structured programming, data types, control flow and functions.' },
    { code: 'MTH101', title: 'Calculus I', credits: 3, level: 100, dept: mth.id, desc: 'Limits, differentiation and applications.' },
    { code: 'MTH102', title: 'Linear Algebra', credits: 3, level: 100, dept: mth.id, desc: 'Vector spaces, matrices and linear transformations.' },
    { code: 'CSC201', title: 'Data Structures', credits: 4, level: 200, dept: csc.id, desc: 'Lists, trees, graphs, hashing and their complexity.' },
    { code: 'CSC202', title: 'Discrete Mathematics', credits: 3, level: 200, dept: csc.id, desc: 'Logic, sets, relations, combinatorics and graph theory.' },
    { code: 'CSC301', title: 'Algorithms and Complexity', credits: 4, level: 300, dept: csc.id, desc: 'Design paradigms, asymptotic analysis and intractability.' },
    { code: 'CSC302', title: 'Database Systems', credits: 3, level: 300, dept: csc.id, desc: 'Relational modelling, normalisation, transactions and recovery.' },
    { code: 'CSC303', title: 'Operating Systems', credits: 3, level: 300, dept: csc.id, desc: 'Processes, scheduling, memory management and concurrency.' },
    { code: 'CSC401', title: 'Distributed Systems', credits: 4, level: 400, dept: csc.id, desc: 'Consistency, consensus, replication and fault tolerance.' },
    { code: 'EEE201', title: 'Circuit Theory', credits: 4, level: 200, dept: eee.id, desc: 'Network analysis, transient and steady-state response.' },
    { code: 'ACC101', title: 'Principles of Accounting', credits: 3, level: 100, dept: acc.id, desc: 'Double-entry bookkeeping and the accounting cycle.' },
  ];

  const courses: Record<string, { id: string; credits: number }> = {};
  for (const c of courseSpecs) {
    const created = await db.course.create({
      data: {
        code: c.code,
        title: c.title,
        description: c.desc,
        creditHours: c.credits,
        level: c.level,
        departmentId: c.dept,
      },
    });
    courses[c.code] = { id: created.id, credits: c.credits };
  }

  // Prerequisite edges. CSC301 requires BOTH CSC201 and CSC202 — a course with
  // two in-edges is what makes the satisfaction check non-trivial.
  const prereqSpecs: [string, string, number, boolean][] = [
    ['CSC102', 'CSC101', 1.0, false],
    ['CSC201', 'CSC102', 2.0, false],
    ['CSC202', 'MTH101', 1.0, false],
    ['CSC301', 'CSC201', 2.0, false],
    ['CSC301', 'CSC202', 1.0, false],
    ['CSC302', 'CSC201', 1.0, false],
    ['CSC303', 'CSC201', 1.0, false],
    ['CSC401', 'CSC301', 2.0, false],
    ['CSC401', 'CSC303', 1.0, true], // may be taken concurrently
    ['MTH102', 'MTH101', 1.0, false],
    ['EEE201', 'MTH101', 1.0, false],
  ];

  for (const [course, prereq, minPoint, concurrent] of prereqSpecs) {
    await db.prerequisite.create({
      data: {
        courseId: courses[course].id,
        prerequisiteId: courses[prereq].id,
        minGradePoint: minPoint,
        isConcurrent: concurrent,
      },
    });
  }

  // Program requirements — what a B.Sc. Computer Science actually needs.
  const cscCore = ['CSC101', 'CSC102', 'CSC201', 'CSC202', 'CSC301', 'CSC302', 'CSC303', 'MTH101'];
  for (const code of cscCore) {
    await db.programRequirement.create({
      data: {
        programId: bscCsc.id,
        courseId: courses[code].id,
        kind: 'CORE',
        level: courseSpecs.find((c) => c.code === code)!.level,
      },
    });
  }
  for (const code of ['CSC401', 'MTH102']) {
    await db.programRequirement.create({
      data: { programId: bscCsc.id, courseId: courses[code].id, kind: 'ELECTIVE', level: 400 },
    });
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------
  console.log('Creating course sections…');

  interface OfferingSpec {
    course: string;
    term: string;
    section: string;
    instructor: string;
    capacity: number;
    room: string;
    meetings: [number, string, string][];
    status?: string;
    gradesPosted?: boolean;
    waitlistCapacity?: number;
  }

  const termIds: Record<string, string> = { t1: term1.id, t2: term2.id, t3: term3.id };

  const offeringSpecs: OfferingSpec[] = [
    // --- Fall 2024 (graded and closed) ---
    { course: 'CSC101', term: 't1', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 60, room: 'LT-1', meetings: [[1, '08:00', '10:00'], [3, '08:00', '09:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'MTH101', term: 't1', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 60, room: 'LT-2', meetings: [[2, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'ACC101', term: 't1', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 40, room: 'MGT-05', meetings: [[4, '14:00', '16:00']], status: 'CLOSED', gradesPosted: true },

    // --- Spring 2025 (graded and closed) ---
    { course: 'CSC102', term: 't2', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 55, room: 'LAB-1', meetings: [[1, '10:00', '12:00'], [4, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'CSC202', term: 't2', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 50, room: 'LT-3', meetings: [[2, '08:00', '10:00']], status: 'CLOSED', gradesPosted: true },
    { course: 'MTH102', term: 't2', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 50, room: 'MTH-01', meetings: [[3, '14:00', '16:00']], status: 'CLOSED', gradesPosted: true },
    // Repeat offering: exists so a student who failed ACC101 in Fall can retake
    // it here, giving the best-attempt policy a real case to collapse.
    { course: 'ACC101', term: 't2', section: 'R', instructor: 'e.balogun@geu.edu', capacity: 25, room: 'MGT-05', meetings: [[5, '10:00', '12:00']], status: 'CLOSED', gradesPosted: true },

    // --- Fall 2025 (current, open for registration) ---
    { course: 'CSC201', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 3, room: 'LAB-2', meetings: [[1, '09:00', '11:00'], [3, '09:00', '11:00']], waitlistCapacity: 5 },
    { course: 'CSC201', term: 't3', section: 'B', instructor: 'e.balogun@geu.edu', capacity: 30, room: 'LAB-3', meetings: [[2, '14:00', '16:00'], [4, '14:00', '16:00']] },
    { course: 'CSC301', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 40, room: 'LT-1', meetings: [[2, '09:00', '11:00'], [5, '09:00', '10:00']] },
    { course: 'CSC302', term: 't3', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 35, room: 'LAB-1', meetings: [[1, '14:00', '16:00']] },
    // Deliberately clashes with CSC301-A on Tuesday morning, so the conflict
    // detector has something real to catch.
    { course: 'CSC303', term: 't3', section: 'A', instructor: 'e.balogun@geu.edu', capacity: 35, room: 'LT-4', meetings: [[2, '10:00', '12:00'], [4, '08:00', '09:00']] },
    { course: 'MTH102', term: 't3', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 45, room: 'MTH-01', meetings: [[3, '11:00', '13:00']] },
    { course: 'EEE201', term: 't3', section: 'A', instructor: 'o.eze@geu.edu', capacity: 40, room: 'EEE-LAB', meetings: [[1, '11:00', '13:00'], [5, '14:00', '16:00']] },
    { course: 'CSC101', term: 't3', section: 'A', instructor: 'a.okafor@geu.edu', capacity: 80, room: 'LT-1', meetings: [[5, '10:00', '12:00']] },
    { course: 'MTH101', term: 't3', section: 'A', instructor: 'f.dauda@geu.edu', capacity: 80, room: 'LT-2', meetings: [[4, '11:00', '13:00']] },
  ];

  const offerings: Record<string, string> = {};
  for (const spec of offeringSpecs) {
    const offering = await db.courseOffering.create({
      data: {
        courseId: courses[spec.course].id,
        termId: termIds[spec.term],
        section: spec.section,
        instructorId: instructors[spec.instructor],
        capacity: spec.capacity,
        waitlistCapacity: spec.waitlistCapacity ?? 10,
        room: spec.room,
        status: spec.status ?? 'OPEN',
        gradesPosted: spec.gradesPosted ?? false,
        meetings: {
          create: spec.meetings.map(([dow, start, end]) => ({
            dayOfWeek: dow,
            startMinute: at(start),
            endMinute: at(end),
            room: spec.room,
          })),
        },
      },
    });
    offerings[`${spec.course}-${spec.section}-${spec.term}`] = offering.id;
  }

  // ---------------------------------------------------------------------------
  // Students
  // ---------------------------------------------------------------------------
  console.log('Creating students…');

  const studentSpecs = [
    { email: 'chidi.eze@student.geu.edu', first: 'Chidi', last: 'Eze', matric: 'GEU/CSC/2024/0001', program: bscCsc.id, level: 200, dob: '2005-03-14', gender: 'Male' },
    { email: 'aisha.bello@student.geu.edu', first: 'Aisha', last: 'Bello', matric: 'GEU/CSC/2024/0002', program: bscCsc.id, level: 200, dob: '2005-07-22', gender: 'Female' },
    { email: 'kunle.adeoye@student.geu.edu', first: 'Kunle', last: 'Adeoye', matric: 'GEU/CSC/2024/0003', program: bscCsc.id, level: 200, dob: '2004-11-09', gender: 'Male' },
    { email: 'zainab.musa@student.geu.edu', first: 'Zainab', last: 'Musa', matric: 'GEU/EEE/2024/0001', program: bengEee.id, level: 200, dob: '2005-01-30', gender: 'Female' },
    { email: 'segun.okonkwo@student.geu.edu', first: 'Segun', last: 'Okonkwo', matric: 'GEU/ACC/2024/0001', program: bscAcc.id, level: 200, dob: '2004-09-18', gender: 'Male' },
    { email: 'blessing.udo@student.geu.edu', first: 'Blessing', last: 'Udo', matric: 'GEU/CSC/2025/0004', program: bscCsc.id, level: 100, dob: '2006-05-05', gender: 'Female' },
  ];

  const students: Record<string, string> = {};
  for (const spec of studentSpecs) {
    const user = await db.user.create({
      data: {
        email: spec.email,
        passwordHash,
        firstName: spec.first,
        lastName: spec.last,
        role: 'STUDENT',
        phone: '+234 810 000 0000',
      },
    });
    const student = await db.student.create({
      data: {
        userId: user.id,
        matricNumber: spec.matric,
        programId: spec.program,
        level: spec.level,
        admissionTermCode: spec.level === 100 ? '2025-FALL' : '2024-FALL',
        dateOfBirth: new Date(spec.dob),
        gender: spec.gender,
        nationality: 'Nigerian',
        address: 'Lagos, Nigeria',
      },
    });
    students[spec.email] = student.id;
  }

  const chidi = students['chidi.eze@student.geu.edu'];
  const aisha = students['aisha.bello@student.geu.edu'];
  const kunle = students['kunle.adeoye@student.geu.edu'];
  const zainab = students['zainab.musa@student.geu.edu'];
  const segun = students['segun.okonkwo@student.geu.edu'];

  // ---------------------------------------------------------------------------
  // Historical enrollments and grades
  // ---------------------------------------------------------------------------
  console.log('Creating enrollment history…');

  /** Post a completed, graded enrollment. */
  const graded = async (
    studentId: string,
    offeringKey: string,
    ca: number,
    exam: number,
  ) => {
    const total = ca + exam;
    const bands: [number, string, number][] = [
      [70, 'A', 4.0],
      [60, 'B', 3.0],
      [50, 'C', 2.0],
      [45, 'D', 1.0],
      [40, 'E', 0.5],
      [0, 'F', 0.0],
    ];
    const [, letter, point] = bands.find(([min]) => total >= min)!;

    await db.enrollment.create({
      data: {
        studentId,
        offeringId: offerings[offeringKey],
        status: 'COMPLETED',
        caScore: ca,
        examScore: exam,
        totalScore: total,
        letterGrade: letter,
        gradePoint: point,
        gradedAt: day(-290),
      },
    });
    await db.courseOffering.update({
      where: { id: offerings[offeringKey] },
      data: { seatsTaken: { increment: 1 } },
    });
  };

  // Chidi — strong student, heading for the Dean's List.
  await graded(chidi, 'CSC101-A-t1', 36, 50); // 86 A
  await graded(chidi, 'MTH101-A-t1', 34, 46); // 80 A
  await graded(chidi, 'CSC102-A-t2', 38, 52); // 90 A
  await graded(chidi, 'CSC202-A-t2', 32, 44); // 76 A
  await graded(chidi, 'MTH102-A-t2', 30, 42); // 72 A

  // Aisha — solid, mid-range.
  await graded(aisha, 'CSC101-A-t1', 28, 38); // 66 B
  await graded(aisha, 'MTH101-A-t1', 24, 34); // 58 C
  await graded(aisha, 'CSC102-A-t2', 30, 40); // 70 A
  await graded(aisha, 'CSC202-A-t2', 26, 36); // 62 B

  // Kunle — failed ACC101 in Fall (35, F), retook it in Spring and passed
  // (60, B). This is the case the best-attempt repeat policy exists for: the F
  // stays on the transcript marked "R" but is excluded from the CGPA.
  await graded(kunle, 'CSC101-A-t1', 22, 30); // 52 C
  await graded(kunle, 'MTH101-A-t1', 18, 24); // 42 E
  await graded(kunle, 'ACC101-A-t1', 15, 20); // 35 F  <- superseded
  await graded(kunle, 'ACC101-R-t2', 26, 34); // 60 B  <- best attempt
  await graded(kunle, 'CSC102-A-t2', 24, 32); // 56 C
  await graded(kunle, 'CSC202-A-t2', 20, 26); // 46 D

  // Zainab — one withdrawal, which must NOT depress her GPA.
  await graded(zainab, 'MTH101-A-t1', 30, 40); // 70 A
  await db.enrollment.create({
    data: {
      studentId: zainab,
      offeringId: offerings['CSC101-A-t1'],
      status: 'WITHDRAWN',
      letterGrade: 'W',
      droppedAt: day(-340),
    },
  });
  await graded(zainab, 'MTH102-A-t2', 32, 44); // 76 A

  // Segun — struggling; ends on probation.
  await graded(segun, 'ACC101-A-t1', 16, 22); // 38 F
  await graded(segun, 'MTH101-A-t1', 20, 24); // 44 E
  await graded(segun, 'CSC202-A-t2', 18, 25); // 43 E

  // ---------------------------------------------------------------------------
  // Current-term registrations, including a full section with a waitlist
  // ---------------------------------------------------------------------------
  console.log('Creating current-term registrations…');

  const register = async (studentId: string, offeringKey: string) => {
    await db.enrollment.create({
      data: { studentId, offeringId: offerings[offeringKey], status: 'REGISTERED' },
    });
    await db.courseOffering.update({
      where: { id: offerings[offeringKey] },
      data: { seatsTaken: { increment: 1 } },
    });
  };

  // CSC201-A has capacity 3. Fill it exactly, then queue two on the waitlist.
  await register(chidi, 'CSC201-A-t3');
  await register(aisha, 'CSC201-A-t3');
  await register(kunle, 'CSC201-A-t3');

  await db.enrollment.create({
    data: {
      studentId: zainab,
      offeringId: offerings['CSC201-A-t3'],
      status: 'WAITLISTED',
      waitlistPosition: 1,
    },
  });
  await db.enrollment.create({
    data: {
      studentId: segun,
      offeringId: offerings['CSC201-A-t3'],
      status: 'WAITLISTED',
      waitlistPosition: 2,
    },
  });

  await register(chidi, 'CSC302-A-t3');
  await register(aisha, 'MTH102-A-t3');
  await register(zainab, 'EEE201-A-t3');

  // ---------------------------------------------------------------------------
  // Fee structures
  // ---------------------------------------------------------------------------
  console.log('Creating fee structures…');

  // Institution-wide default for the current term.
  const baseFees = await db.feeStructure.create({
    data: {
      name: 'Fall 2025 — Standard undergraduate',
      termId: term3.id,
      programId: null,
      level: null,
      items: {
        create: [
          { code: 'TUITION', description: 'Tuition', amountMinor: naira(12_500), perCreditHour: true, isMandatory: true },
          { code: 'REGISTRATION', description: 'Registration and records', amountMinor: naira(15_000), perCreditHour: false, isMandatory: true },
          { code: 'LIBRARY', description: 'Library and learning resources', amountMinor: naira(12_000), perCreditHour: false, isMandatory: true },
          { code: 'ICT', description: 'ICT and network access', amountMinor: naira(18_000), perCreditHour: false, isMandatory: true },
          { code: 'HEALTH', description: 'Student health service', amountMinor: naira(10_000), perCreditHour: false, isMandatory: true },
        ],
      },
    },
  });

  // A more specific structure: engineering costs more per credit (lab intensive).
  // The resolver must prefer this over the institution-wide default for EEE.
  await db.feeStructure.create({
    data: {
      name: 'Fall 2025 — Engineering',
      termId: term3.id,
      programId: bengEee.id,
      level: null,
      items: {
        create: [
          { code: 'TUITION', description: 'Tuition (engineering)', amountMinor: naira(16_000), perCreditHour: true, isMandatory: true },
          { code: 'REGISTRATION', description: 'Registration and records', amountMinor: naira(15_000), perCreditHour: false, isMandatory: true },
          { code: 'LAB', description: 'Laboratory and workshop levy', amountMinor: naira(45_000), perCreditHour: false, isMandatory: true },
          { code: 'LIBRARY', description: 'Library and learning resources', amountMinor: naira(12_000), perCreditHour: false, isMandatory: true },
          { code: 'ICT', description: 'ICT and network access', amountMinor: naira(18_000), perCreditHour: false, isMandatory: true },
        ],
      },
    },
  });

  void baseFees;

  // ---------------------------------------------------------------------------
  // Invoices and payments — one paid, one partial, one overdue with a hold
  // ---------------------------------------------------------------------------
  console.log('Creating invoices and payments…');

  interface InvoiceSpec {
    studentId: string;
    invoiceNo: string;
    credits: number;
    perCredit: number;
    fixed: [string, string, number][];
    dueDate: Date;
    payments: { receiptNo: string; amount: number; method: string; daysAgo: number }[];
  }

  const invoiceSpecs: InvoiceSpec[] = [
    {
      studentId: chidi,
      invoiceNo: 'INV-2025-000001',
      credits: 7,
      perCredit: 12_500,
      fixed: [
        ['REGISTRATION', 'Registration and records', 15_000],
        ['LIBRARY', 'Library and learning resources', 12_000],
        ['ICT', 'ICT and network access', 18_000],
        ['HEALTH', 'Student health service', 10_000],
      ],
      dueDate: day(14),
      payments: [{ receiptNo: 'RCP-2025-000001', amount: 142_500, method: 'BANK_TRANSFER', daysAgo: 10 }],
    },
    {
      studentId: aisha,
      invoiceNo: 'INV-2025-000002',
      credits: 7,
      perCredit: 12_500,
      fixed: [
        ['REGISTRATION', 'Registration and records', 15_000],
        ['LIBRARY', 'Library and learning resources', 12_000],
        ['ICT', 'ICT and network access', 18_000],
        ['HEALTH', 'Student health service', 10_000],
      ],
      dueDate: day(14),
      payments: [{ receiptNo: 'RCP-2025-000002', amount: 80_000, method: 'CARD', daysAgo: 8 }],
    },
    {
      // Overdue: due date is in the past and nothing has been paid.
      studentId: segun,
      invoiceNo: 'INV-2025-000003',
      credits: 6,
      perCredit: 12_500,
      fixed: [
        ['REGISTRATION', 'Registration and records', 15_000],
        ['LIBRARY', 'Library and learning resources', 12_000],
        ['ICT', 'ICT and network access', 18_000],
      ],
      dueDate: day(-35),
      payments: [],
    },
  ];

  for (const spec of invoiceSpecs) {
    const tuitionMinor = naira(spec.perCredit) * spec.credits;
    const lines = [
      {
        code: 'TUITION',
        description: `Tuition (${spec.credits} credit hours)`,
        quantity: spec.credits,
        unitAmountMinor: naira(spec.perCredit),
        amountMinor: tuitionMinor,
      },
      ...spec.fixed.map(([code, description, amount]) => ({
        code,
        description,
        quantity: 1,
        unitAmountMinor: naira(amount),
        amountMinor: naira(amount),
      })),
    ];

    const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0);
    const paid = spec.payments.reduce((s, p) => s + naira(p.amount), 0);
    const status =
      paid >= subtotal ? 'PAID' : spec.dueDate < NOW ? 'OVERDUE' : paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED';

    const invoice = await db.invoice.create({
      data: {
        invoiceNo: spec.invoiceNo,
        studentId: spec.studentId,
        termId: term3.id,
        subtotalMinor: subtotal,
        discountMinor: 0,
        totalMinor: subtotal,
        paidMinor: Math.min(paid, subtotal),
        dueDate: spec.dueDate,
        issuedAt: day(-20),
        status,
        lines: { create: lines },
      },
    });

    for (const p of spec.payments) {
      const amountMinor = naira(p.amount);
      const applied = Math.min(amountMinor, subtotal);
      await db.payment.create({
        data: {
          receiptNo: p.receiptNo,
          studentId: spec.studentId,
          amountMinor,
          method: p.method,
          status: 'CONFIRMED',
          unappliedMinor: amountMinor - applied,
          receivedAt: day(-p.daysAgo),
          allocations: { create: [{ invoiceId: invoice.id, amountMinor: applied }] },
        },
      });
    }
  }

  // Segun's overdue balance justifies a financial hold — which is exactly what
  // the registration engine will refuse to register him against.
  await db.hold.create({
    data: {
      studentId: segun,
      kind: 'FINANCIAL',
      reason: 'Tuition for Fall 2025 is more than 30 days overdue.',
      blocksRegistration: true,
      blocksTranscript: false,
      placedAt: day(-20),
    },
  });

  // ---------------------------------------------------------------------------
  // Admissions pipeline
  // ---------------------------------------------------------------------------
  console.log('Creating applications…');

  const applicantSpecs = [
    { email: 'hopeful@example.com', first: 'Ifeoma', last: 'Chukwu', program: bscCsc.id, ref: 'APP-2025-000001', status: 'UNDER_REVIEW', gpa: 82, exam: 78, essay: 74, statement: 'I first wrote a program to help my mother track inventory for her shop, and I have not stopped building since. I want to study computer science because the problems that interest me — reliable systems that people depend on without noticing — are engineering problems, not just coding ones.' },
    { email: 'a.mohammed@example.com', first: 'Amina', last: 'Mohammed', program: bscCsc.id, ref: 'APP-2025-000002', status: 'UNDER_REVIEW', gpa: 91, exam: 88, essay: 86, statement: 'My secondary school had one working computer for two hundred students. I taught myself to program on it during lunch breaks, and then taught eleven of my classmates. I want to study computer science so that I can build the infrastructure that makes that scarcity unnecessary.' },
    { email: 'p.okoro@example.com', first: 'Peter', last: 'Okoro', program: bengEee.id, ref: 'APP-2025-000003', status: 'SUBMITTED', gpa: 68, exam: 61, essay: null, statement: 'I have repaired generators and inverters in my community since I was fourteen. I want to understand the theory behind what I have learned by hand, and to design systems that fail less often in the conditions we actually have.' },
    { email: 'g.adamu@example.com', first: 'Grace', last: 'Adamu', program: bscCsc.id, ref: 'APP-2025-000004', status: 'OFFERED', gpa: 88, exam: 84, essay: 80, statement: 'I am interested in how large systems stay consistent when parts of them fail. I have read what I can find on distributed consensus and I would like to study it properly.' },
    { email: 'd.yusuf@example.com', first: 'Daniel', last: 'Yusuf', program: bscAcc.id, ref: 'APP-2025-000005', status: 'SUBMITTED', gpa: 45, exam: 38, essay: null, statement: 'I want to study accounting because I am good with numbers and my uncle runs an accounting practice where I could work after graduating. I have helped in his office during holidays.' },
    { email: 'l.ibrahim@example.com', first: 'Lami', last: 'Ibrahim', program: mscCsc.id, ref: 'APP-2025-000006', status: 'ACCEPTED', gpa: 86, exam: 82, essay: 88, statement: 'My undergraduate project implemented a small Raft consensus library. I want to continue that work at postgraduate level, focusing on how these protocols behave under the network conditions common in this region rather than in datacentre benchmarks.' },
  ];

  const reviewerId = (await db.user.findUnique({ where: { email: 'admissions@geu.edu' } }))!.id;
  const adminId = (await db.user.findUnique({ where: { email: 'admin@geu.edu' } }))!.id;

  for (const spec of applicantSpecs) {
    const user = await db.user.create({
      data: {
        email: spec.email,
        passwordHash,
        firstName: spec.first,
        lastName: spec.last,
        role: 'APPLICANT',
      },
    });
    const applicant = await db.applicant.create({
      data: {
        userId: user.id,
        nationality: 'Nigerian',
        address: 'Abuja, Nigeria',
        dateOfBirth: new Date('2006-04-12'),
      },
    });

    const application = await db.application.create({
      data: {
        referenceNo: spec.ref,
        applicantId: applicant.id,
        programId: spec.program,
        termId: term3.id,
        status: spec.status,
        priorGpaScore: spec.gpa,
        entranceExamScore: spec.exam,
        essayScore: spec.essay,
        personalStatement: spec.statement,
        previousSchool: 'Government Secondary School',
        submittedAt: day(-25),
        decidedAt: ['OFFERED', 'ACCEPTED'].includes(spec.status) ? day(-10) : null,
        offerExpiresAt: spec.status === 'OFFERED' ? day(11) : null,
      },
    });

    // Two independent reviews for the applications that have progressed past
    // SUBMITTED — enough to satisfy the two-review minimum.
    if (['UNDER_REVIEW', 'OFFERED', 'ACCEPTED'].includes(spec.status)) {
      await db.applicationReview.create({
        data: {
          applicationId: application.id,
          reviewerId,
          academicScore: spec.gpa,
          essayScore: spec.essay ?? 70,
          interviewScore: 76,
          extracurricularScore: 68,
          recommendation: spec.gpa >= 80 ? 'ADMIT' : 'WAITLIST',
          comments:
            spec.gpa >= 80
              ? 'Strong academic record and a clear, specific motivation. Recommend admission.'
              : 'Adequate record; would benefit from a stronger statement of purpose.',
        },
      });
      await db.applicationReview.create({
        data: {
          applicationId: application.id,
          reviewerId: adminId,
          academicScore: spec.gpa - 3,
          essayScore: (spec.essay ?? 70) + 4,
          interviewScore: 80,
          extracurricularScore: 72,
          recommendation: spec.gpa >= 78 ? 'ADMIT' : 'WAITLIST',
          comments: 'Second read. Concur with the first reviewer.',
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Announcements
  // ---------------------------------------------------------------------------
  await db.announcement.createMany({
    data: [
      {
        title: 'Fall 2025 registration is open',
        body: `Registration closes on ${day(21).toDateString()}. Settle any outstanding fees before registering — an unpaid balance places a hold on your record and blocks registration.`,
        audience: 'STUDENT',
        severity: 'INFO',
      },
      {
        title: 'Grade submission deadline',
        body: 'Final grades for the current term must be submitted and posted within two weeks of the last examination.',
        audience: 'INSTRUCTOR',
        severity: 'WARNING',
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Recompute derived academics from the graded history
  // ---------------------------------------------------------------------------
  console.log('Computing GPAs and academic standing…');

  // Imported from the guard-free recomputation module rather than the service
  // wrapper, so the seed runs the SAME GPA code the application does instead of
  // a second, drifting copy.
  const { recomputeStudentAcademics } = await import('../src/server/academics');
  for (const studentId of Object.values(students)) {
    await recomputeStudentAcademics(studentId);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const summary = await db.student.findMany({
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { cgpa: 'desc' },
  });

  console.log('\n  Seed complete.\n');
  console.log('  Students:');
  for (const s of summary) {
    console.log(
      `    ${s.matricNumber.padEnd(20)} ${`${s.user.firstName} ${s.user.lastName}`.padEnd(20)} CGPA ${s.cgpa.toFixed(2)}  ${s.creditsEarned}/${s.creditsAttempted} cr  ${s.academicStanding}`,
    );
  }
  console.log(`\n  Sign in with any account below. Password: ${PASSWORD}\n`);
  console.log('    admin@geu.edu                 System administrator');
  console.log('    registrar@geu.edu             Registrar');
  console.log('    admissions@geu.edu            Admissions officer');
  console.log('    bursary@geu.edu               Finance officer');
  console.log('    a.okafor@geu.edu              Instructor (Prof. Adaeze Okafor)');
  console.log('    chidi.eze@student.geu.edu     Student (strong record)');
  console.log('    segun.okonkwo@student.geu.edu Student (probation + financial hold)');
  console.log('    hopeful@example.com           Applicant\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
