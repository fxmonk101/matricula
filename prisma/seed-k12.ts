import type { PrismaClient } from '@prisma/client';

import { toLocalDate } from '../src/lib/domain/time';

/** The demo K-12 school sits in Lagos, like its parent university. */
const SEED_TIMEZONE = 'Africa/Lagos';

import {
  DEFAULT_ADMISSIONS_CONFIG,
  DEFAULT_ENROLLMENT_POLICY,
  DEFAULT_FINANCE_CONFIG,
  DEFAULT_K12_CONFIG,
  DEFAULT_REGISTRATION_PORTAL_CONFIG,
  assertGradingConfigWellFormed,
  gradingPreset,
} from '../src/lib/domain/config';

/**
 * =============================================================================
 * SEED — a K-12 school
 * =============================================================================
 *
 * Golden Eagles International School sits on the same platform as the two
 * universities and shares nothing with them but the code. It exists to prove
 * the `academicModel` switch is real: year groups and form classes rather than
 * faculties and programmes, subjects rather than credit-bearing courses,
 * termly report cards rather than transcripts, and guardians as first-class
 * users.
 *
 * Its marks are the ones on the design canvas's report card, so the rendered
 * document and the mockup agree — including the position, which the app
 * computes rather than takes on trust.
 */

const PASSWORD_NOTE = 'shared with the other seeded schools';

export async function seedK12School(db: PrismaClient, passwordHash: string, day: (n: number) => Date) {
  console.log('\n  ── Golden Eagles International School (GIS) ──');

  const grading = gradingPreset(4.0);
  assertGradingConfigWellFormed(grading);

  const school = await db.school.create({
    data: {
      slug: 'gis',
      code: 'GIS',
      name: 'Golden Eagles International School',
      shortName: 'Golden Eagles International',
      academicModel: 'K12',
      status: 'ACTIVE',
      country: 'NG',
      locale: 'en-NG',
      timezone: 'Africa/Lagos',
      currencyCode: 'NGN',
      brandColor: '#7c3aed',
      config: {
        create: {
          gradingJson: JSON.stringify(grading),
          enrollmentJson: JSON.stringify(DEFAULT_ENROLLMENT_POLICY),
          admissionsJson: JSON.stringify(DEFAULT_ADMISSIONS_CONFIG),
          financeJson: JSON.stringify({
            ...DEFAULT_FINANCE_CONFIG,
            currency: { code: 'NGN', symbol: '₦', exponent: 2 },
          }),
          brandingJson: JSON.stringify({
            name: 'Golden Eagles International School',
            short: 'Golden Eagles International',
            brandColor: '#7c3aed',
            logoUrl: null,
          }),
          localeJson: JSON.stringify({
            locale: 'en-NG', timezone: 'Africa/Lagos', firstDayOfWeek: 1, dateFormat: 'dd MMM yyyy',
          }),
          registrationPortalJson: JSON.stringify(DEFAULT_REGISTRATION_PORTAL_CONFIG),
          k12Json: JSON.stringify({
            ...DEFAULT_K12_CONFIG,
            // A pupil must pass English and Mathematics whatever their average.
            compulsorySubjectCodes: ['ENG', 'MTH'],
          }),
        },
      },
    },
  });
  const schoolId = school.id;

  const person = async (email: string, firstName: string, lastName: string, role: string, title?: string) => {
    const user =
      (await db.user.findUnique({ where: { email } })) ??
      (await db.user.create({
        data: { email, passwordHash, firstName, lastName, phone: '+234 802 000 0000' },
      }));
    await db.membership.create({
      data: {
        userId: user.id, schoolId, role, title: title ?? null,
        isPrimary: (await db.membership.count({ where: { userId: user.id } })) === 0,
        status: 'ACTIVE',
      },
    });
    return user;
  };

  // --- staff -----------------------------------------------------------------
  await person('head@gis.edu.ng', 'Tobi', 'Bakare', 'ADMIN', 'Head Teacher');
  await person('office@gis.edu.ng', 'Ronke', 'Adeleke', 'REGISTRAR', 'School Secretary');
  await person('bursar@gis.edu.ng', 'Musa', 'Danjuma', 'FINANCE', 'Bursar');

  // A K-12 school still needs a department to hang teachers off, because
  // Instructor requires one. One "Teaching Staff" unit is the honest minimum.
  const faculty = await db.faculty.create({
    data: { schoolId, code: 'SCH', name: 'Golden Eagles International School' },
  });
  const department = await db.department.create({
    data: { schoolId, code: 'TCH', name: 'Teaching Staff', facultyId: faculty.id },
  });

  const teacherSpecs = [
    { email: 'f.adeleke@gis.edu.ng', first: 'Folake', last: 'Adeleke', staffNo: 'GIS-T01', title: 'Form Teacher, Year 7 Blue' },
    { email: 'j.okoro@gis.edu.ng', first: 'James', last: 'Okoro', staffNo: 'GIS-T02', title: 'Mathematics' },
    { email: 'b.nwankwo@gis.edu.ng', first: 'Bisi', last: 'Nwankwo', staffNo: 'GIS-T03', title: 'Sciences' },
    { email: 'p.eze@gis.edu.ng', first: 'Peter', last: 'Eze', staffNo: 'GIS-T04', title: 'Humanities' },
  ];
  const teachers: Record<string, string> = {};
  for (const t of teacherSpecs) {
    const user = await person(t.email, t.first, t.last, 'INSTRUCTOR', t.title);
    const row = await db.instructor.create({
      data: { schoolId, userId: user.id, staffNumber: t.staffNo, departmentId: department.id, rank: 'LECTURER' },
    });
    teachers[t.email] = row.id;
  }

  // --- terms -----------------------------------------------------------------
  // Three terms a year, which is the K-12 shape rather than two semesters.
  const term = await db.term.create({
    data: {
      schoolId, code: '2025-T1', name: 'First Term', academicYear: '2025/2026', season: 'FALL',
      startDate: day(-90), endDate: day(-5),
      registrationOpensAt: day(-120), registrationClosesAt: day(-95),
      addDropDeadline: day(-85), withdrawalDeadline: day(-40),
      isCurrent: true,
    },
  });

  // --- year groups and form classes -------------------------------------------
  const yearGroups: Record<string, string> = {};
  for (const [code, name, seq, terminal] of [
    ['Y7', 'Year 7', 7, false],
    ['Y8', 'Year 8', 8, false],
    ['Y9', 'Year 9', 9, true],
  ] as const) {
    const row = await db.yearGroup.create({
      data: { schoolId, code, name, sequence: seq, isTerminal: terminal },
    });
    yearGroups[code] = row.id;
  }

  const formClass = await db.formClass.create({
    data: {
      schoolId, yearGroupId: yearGroups.Y7, code: '7B', name: 'Year 7 — Blue',
      formTeacherId: teachers['f.adeleke@gis.edu.ng'], capacity: 30,
    },
  });
  await db.formClass.create({
    data: {
      schoolId, yearGroupId: yearGroups.Y7, code: '7G', name: 'Year 7 — Gold',
      formTeacherId: teachers['j.okoro@gis.edu.ng'], capacity: 30,
    },
  });

  // --- subjects ---------------------------------------------------------------
  const subjectSpecs: [string, string, string][] = [
    ['ENG', 'English Language', 'p.eze@gis.edu.ng'],
    ['MTH', 'Mathematics', 'j.okoro@gis.edu.ng'],
    ['BSC', 'Basic Science', 'b.nwankwo@gis.edu.ng'],
    ['BTC', 'Basic Technology', 'b.nwankwo@gis.edu.ng'],
    ['SOS', 'Social Studies', 'p.eze@gis.edu.ng'],
    ['CIV', 'Civic Education', 'p.eze@gis.edu.ng'],
    ['BUS', 'Business Studies', 'f.adeleke@gis.edu.ng'],
    ['CMP', 'Computer Studies', 'j.okoro@gis.edu.ng'],
    ['FRE', 'French', 'f.adeleke@gis.edu.ng'],
    ['CRA', 'Creative Arts', 'b.nwankwo@gis.edu.ng'],
  ];

  const assignments: Record<string, string> = {};
  for (const [code, name, teacherEmail] of subjectSpecs) {
    const subject = await db.subject.create({
      data: { schoolId, code, name, yearGroupId: yearGroups.Y7, isCore: true },
    });
    const assignment = await db.subjectAssignment.create({
      data: {
        schoolId, subjectId: subject.id, formClassId: formClass.id, termId: term.id,
        teacherId: teachers[teacherEmail], marksPosted: true,
      },
    });
    assignments[code] = assignment.id;
  }

  // --- pupils ------------------------------------------------------------------
  // A Year 7 form needs a programme row only because Student requires one; the
  // K-12 side never reads it.
  const programme = await db.program.create({
    data: {
      schoolId, code: 'Y7', name: 'Year 7', degreeType: 'DIPLOMA',
      departmentId: department.id, creditsRequired: 0, durationTerms: 3, minCgpaToGraduate: 0,
    },
  });

  /** Marks per pupil, keyed by subject code: [continuous assessment, examination]. */
  const pupilSpecs: {
    email: string; first: string; last: string; admission: string; dob: string; gender: string;
    marks: Record<string, [number, number]>;
    guardian?: { email: string; first: string; last: string; relationship: string };
  }[] = [
    {
      email: 'amara.nwosu@gis.edu.ng', first: 'Amara', last: 'Nwosu', admission: 'GIS/2023/0184',
      dob: '2013-03-14', gender: 'Female',
      // The design canvas's report card, to the mark: totals 742, average 74.2.
      marks: { ENG: [34, 50], MTH: [32, 47], BSC: [29, 42], BTC: [27, 41], SOS: [31, 45], CIV: [33, 48], BUS: [25, 37], CMP: [35, 51], FRE: [23, 34], CRA: [31, 47] },
      guardian: { email: 'ngozi.nwosu@example.com', first: 'Ngozi', last: 'Nwosu', relationship: 'MOTHER' },
    },
    {
      email: 'daniel.okeke@gis.edu.ng', first: 'Daniel', last: 'Okeke', admission: 'GIS/2023/0185',
      dob: '2013-07-02', gender: 'Male',
      marks: { ENG: [36, 52], MTH: [35, 50], BSC: [33, 48], BTC: [30, 44], SOS: [34, 49], CIV: [35, 50], BUS: [30, 43], CMP: [36, 53], FRE: [28, 40], CRA: [33, 48] },
    },
    {
      email: 'zara.ibrahim@gis.edu.ng', first: 'Zara', last: 'Ibrahim', admission: 'GIS/2023/0186',
      dob: '2013-01-22', gender: 'Female',
      marks: { ENG: [35, 51], MTH: [33, 49], BSC: [32, 46], BTC: [29, 43], SOS: [33, 47], CIV: [34, 49], BUS: [28, 41], CMP: [34, 50], FRE: [26, 38], CRA: [32, 46] },
    },
    {
      email: 'kelechi.obi@gis.edu.ng', first: 'Kelechi', last: 'Obi', admission: 'GIS/2023/0187',
      dob: '2012-11-30', gender: 'Male',
      marks: { ENG: [33, 48], MTH: [31, 45], BSC: [30, 43], BTC: [28, 40], SOS: [30, 44], CIV: [32, 46], BUS: [26, 38], CMP: [33, 47], FRE: [24, 35], CRA: [30, 44] },
    },
    {
      email: 'temi.balogun@gis.edu.ng', first: 'Temi', last: 'Balogun', admission: 'GIS/2023/0188',
      dob: '2013-05-18', gender: 'Female',
      marks: { ENG: [28, 40], MTH: [26, 37], BSC: [25, 36], BTC: [24, 34], SOS: [27, 38], CIV: [28, 40], BUS: [22, 32], CMP: [29, 41], FRE: [20, 29], CRA: [26, 37] },
    },
    {
      email: 'chinedu.eze@gis.edu.ng', first: 'Chinedu', last: 'Eze', admission: 'GIS/2023/0189',
      dob: '2013-09-09', gender: 'Male',
      // Fails both compulsory subjects — the promotion engine must refer him.
      marks: { ENG: [12, 18], MTH: [11, 16], BSC: [20, 28], BTC: [19, 27], SOS: [21, 30], CIV: [22, 31], BUS: [18, 26], CMP: [23, 33], FRE: [15, 22], CRA: [20, 29] },
      guardian: { email: 'emeka.eze.snr@example.com', first: 'Emeka', last: 'Eze', relationship: 'FATHER' },
    },
    {
      email: 'aisha.yusuf@gis.edu.ng', first: 'Aisha', last: 'Yusuf', admission: 'GIS/2023/0190',
      dob: '2013-02-27', gender: 'Female',
      marks: { ENG: [30, 44], MTH: [29, 42], BSC: [28, 40], BTC: [26, 38], SOS: [29, 42], CIV: [30, 43], BUS: [24, 35], CMP: [31, 44], FRE: [22, 32], CRA: [28, 41] },
    },
    {
      email: 'segun.lawal@gis.edu.ng', first: 'Segun', last: 'Lawal', admission: 'GIS/2023/0191',
      dob: '2012-12-05', gender: 'Male',
      // Deliberately identical to Amara's total, so the report card has a real
      // tie to rank — both should come out on the same position.
      marks: { ENG: [34, 50], MTH: [32, 47], BSC: [29, 42], BTC: [27, 41], SOS: [31, 45], CIV: [33, 48], BUS: [25, 37], CMP: [35, 51], FRE: [23, 34], CRA: [31, 47] },
    },
  ];

  const pupils: Record<string, string> = {};
  for (const p of pupilSpecs) {
    const user = await person(p.email, p.first, p.last, 'STUDENT');
    const student = await db.student.create({
      data: {
        schoolId, userId: user.id, matricNumber: p.admission, programId: programme.id,
        level: 7, admissionTermCode: '2025-T1', dateOfBirth: new Date(p.dob),
        gender: p.gender, nationality: 'Nigerian', address: 'Lagos, Nigeria',
      },
    });
    pupils[p.email] = student.id;

    await db.classEnrolment.create({
      data: { schoolId, studentId: student.id, formClassId: formClass.id, termId: term.id },
    });

    // Marks. Grades, class averages and positions are left null here — the
    // service computes them, so the seed cannot disagree with the app.
    for (const [code, [ca, exam]] of Object.entries(p.marks)) {
      await db.subjectResult.create({
        data: {
          schoolId, studentId: student.id, assignmentId: assignments[code],
          caScore: ca, examScore: exam,
        },
      });
    }

    // Attendance across a 62-day term.
    const absent = p.email.startsWith('chinedu') ? 18 : p.email.startsWith('temi') ? 7 : 4;
    const late = p.email.startsWith('amara') ? 2 : 1;
    const present = 62 - absent - late;
    let d = 0;
    for (let i = 0; i < 62; i++) {
      const date = day(-88 + i);
      const status = i < present ? 'PRESENT' : i < present + late ? 'LATE' : 'ABSENT';
      await db.attendanceRecord.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: term.id,
          // The school's calendar day as a string. Seeded through the same
          // helper the app uses, so seeded registers cannot be in a shape the
          // product would never produce.
          localDate: toLocalDate(date, SEED_TIMEZONE),
          sessionKey: 'DAY',
          status,
        },
      });
      d++;
    }
    void d;

    if (p.guardian) {
      const gUser = await person(p.guardian.email, p.guardian.first, p.guardian.last, 'GUARDIAN');
      const guardian =
        (await db.guardian.findFirst({ where: { schoolId, userId: gUser.id } })) ??
        (await db.guardian.create({
          data: { schoolId, userId: gUser.id, phone: '+234 803 000 0000', address: 'Lagos, Nigeria' },
        }));
      await db.guardianStudent.create({
        data: {
          schoolId, guardianId: guardian.id, studentId: student.id,
          relationship: p.guardian.relationship, isPrimary: true, canViewFinance: true,
        },
      });
    }
  }

  await db.announcement.create({
    data: {
      schoolId,
      title: 'First Term report cards',
      body: 'Report cards are published to parents at the end of term. Please ensure your contact details are current.',
      audience: 'GUARDIAN',
      severity: 'INFO',
    },
  });

  // Grade every mark sheet through the real service, so the stored grades,
  // class averages and subject positions are exactly what the app computes.
  // The seed writes raw marks and nothing else — it must never be a second
  // implementation of grading.
  const { saveSubjectMarks } = await import('../src/server/k12-reports');
  for (const assignmentId of Object.values(assignments)) {
    const rows = await db.subjectResult.findMany({ where: { assignmentId } });
    await saveSubjectMarks({
      schoolId,
      assignmentId,
      rows: rows.map((r) => ({ studentId: r.studentId, caScore: r.caScore, examScore: r.examScore })),
      actorId: null,
    });
  }

  return { school, schoolId, termId: term.id, formClassId: formClass.id, pupils, note: PASSWORD_NOTE };
}
