import { Prisma } from '@prisma/client';

import { dbFor } from '@/lib/tenant';
import { loadSchoolConfig } from '@/server/school-config';
import {
  codeRejectionReason,
  deletionBlockers,
  isDegreeType,
  normaliseCode,
  validateCredits,
  validateLevel,
  validateName,
  validateProgramme,
} from '@/lib/domain/structure';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * ACADEMIC STRUCTURE
 * =============================================================================
 *
 * Faculties, departments, programmes and courses — the Registrar's office.
 *
 * TWO RULES RUN THROUGH EVERY FUNCTION HERE.
 *
 * First, the parent is re-read through the TENANT-SCOPED client before it is
 * referenced. `src/lib/tenant.ts` documents that `connect: { id }` is not
 * validated against the tenant, so a crafted `facultyId` would otherwise let
 * one university hang a department off another university's faculty.
 *
 * Second, nothing structural is hard-deleted while anything points at it.
 * Faculty→Department→Programme→Course all cascade in the schema, so a single
 * mis-clicked delete on a faculty would take out every department, programme
 * and course beneath it — and, through those, the offerings and enrolments
 * that make up students' records. The database will do exactly what it is
 * told; refusing before it is told is the whole job.
 */

export interface StructureResult {
  ok: boolean;
  message: string;
  id?: string;
}

/** A unique-constraint violation on (schoolId, code), in words. */
function duplicateCode(error: unknown, what: string, code: string): StructureResult | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return { ok: false, message: `A ${what} with the code ${code} already exists.` };
  }
  return null;
}

// -----------------------------------------------------------------------------
// Faculties
// -----------------------------------------------------------------------------

export async function saveFaculty(params: {
  schoolId: string;
  facultyId?: string | null;
  code: string;
  name: string;
  actorUserId: string;
}): Promise<StructureResult> {
  const code = normaliseCode(params.code);
  const problems = [
    codeRejectionReason(code, 'unit'),
    validateName(params.name, 'faculty'),
  ].filter((p): p is string => p !== null);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const db = dbFor(params.schoolId);
  const name = params.name.trim();

  try {
    if (params.facultyId) {
      const existing = await db.faculty.findUnique({ where: { id: params.facultyId } });
      if (!existing) return { ok: false, message: 'That faculty is not part of this school.' };

      await db.faculty.update({ where: { id: existing.id }, data: { code, name } });
      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'structure.faculty.update',
        entityType: 'Faculty',
        entityId: existing.id,
        summary: `Faculty ${existing.code} → ${code} “${name}”.`,
      });
      return { ok: true, message: `${name} saved.`, id: existing.id };
    }

    // `schoolId` is stated explicitly even though the tenant client injects
    // it: the extension honours an explicit value rather than overwriting, and
    // the generated types require it, so stating it keeps the two in step.
    const created = await db.faculty.create({
      data: { schoolId: params.schoolId, code, name },
    });
    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'structure.faculty.create',
      entityType: 'Faculty',
      entityId: created.id,
      summary: `Faculty ${code} “${name}” created.`,
    });
    return { ok: true, message: `${name} created.`, id: created.id };
  } catch (error) {
    const duplicate = duplicateCode(error, 'faculty', code);
    if (duplicate) return duplicate;
    console.error('[structure] faculty save failed', error);
    return { ok: false, message: 'Could not save that faculty.' };
  }
}

export async function deleteFaculty(params: {
  schoolId: string;
  facultyId: string;
  actorUserId: string;
}): Promise<StructureResult> {
  const db = dbFor(params.schoolId);
  const faculty = await db.faculty.findUnique({
    where: { id: params.facultyId },
    include: { _count: { select: { departments: true } } },
  });
  if (!faculty) return { ok: false, message: 'That faculty is not part of this school.' };

  const blocked = deletionBlockers([
    { label: 'department', count: faculty._count.departments },
  ]);
  if (blocked) return { ok: false, message: blocked };

  await db.faculty.delete({ where: { id: faculty.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'structure.faculty.delete',
    entityType: 'Faculty',
    entityId: faculty.id,
    summary: `Faculty ${faculty.code} “${faculty.name}” deleted (it was empty).`,
  });
  return { ok: true, message: `${faculty.name} deleted.` };
}

// -----------------------------------------------------------------------------
// Departments
// -----------------------------------------------------------------------------

export async function saveDepartment(params: {
  schoolId: string;
  departmentId?: string | null;
  facultyId: string;
  code: string;
  name: string;
  actorUserId: string;
}): Promise<StructureResult> {
  const code = normaliseCode(params.code);
  const problems = [
    codeRejectionReason(code, 'unit'),
    validateName(params.name, 'department'),
  ].filter((p): p is string => p !== null);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const db = dbFor(params.schoolId);

  // Re-read through the tenant client: a crafted id must not attach this
  // department to another university's faculty.
  const faculty = await db.faculty.findUnique({ where: { id: params.facultyId } });
  if (!faculty) return { ok: false, message: 'Choose a faculty from this school.' };

  const name = params.name.trim();

  try {
    if (params.departmentId) {
      const existing = await db.department.findUnique({ where: { id: params.departmentId } });
      if (!existing) return { ok: false, message: 'That department is not part of this school.' };

      await db.department.update({
        where: { id: existing.id },
        data: { code, name, facultyId: faculty.id },
      });
      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'structure.department.update',
        entityType: 'Department',
        entityId: existing.id,
        summary: `Department ${code} “${name}” saved under ${faculty.code}.`,
      });
      return { ok: true, message: `${name} saved.`, id: existing.id };
    }

    const created = await db.department.create({
      data: { schoolId: params.schoolId, code, name, facultyId: faculty.id },
    });
    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'structure.department.create',
      entityType: 'Department',
      entityId: created.id,
      summary: `Department ${code} “${name}” created under ${faculty.code}.`,
    });
    return { ok: true, message: `${name} created.`, id: created.id };
  } catch (error) {
    const duplicate = duplicateCode(error, 'department', code);
    if (duplicate) return duplicate;
    console.error('[structure] department save failed', error);
    return { ok: false, message: 'Could not save that department.' };
  }
}

export async function deleteDepartment(params: {
  schoolId: string;
  departmentId: string;
  actorUserId: string;
}): Promise<StructureResult> {
  const db = dbFor(params.schoolId);
  const department = await db.department.findUnique({
    where: { id: params.departmentId },
    include: {
      _count: { select: { programs: true, courses: true, instructors: true } },
    },
  });
  if (!department) return { ok: false, message: 'That department is not part of this school.' };

  const blocked = deletionBlockers([
    { label: 'programme', count: department._count.programs },
    { label: 'course', count: department._count.courses },
    { label: 'lecturer', count: department._count.instructors },
  ]);
  if (blocked) return { ok: false, message: blocked };

  await db.department.delete({ where: { id: department.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'structure.department.delete',
    entityType: 'Department',
    entityId: department.id,
    summary: `Department ${department.code} “${department.name}” deleted (it was empty).`,
  });
  return { ok: true, message: `${department.name} deleted.` };
}

// -----------------------------------------------------------------------------
// Programmes
// -----------------------------------------------------------------------------

export async function saveProgramme(params: {
  schoolId: string;
  programmeId?: string | null;
  departmentId: string;
  code: string;
  name: string;
  degreeType: string;
  creditsRequired: number;
  durationTerms: number;
  minCgpa: number;
  actorUserId: string;
}): Promise<StructureResult> {
  // Validated against THIS school's grading scale — a minimum CGPA of 2.5 is
  // ordinary on a 5-point scale and impossible on a 4-point one.
  const config = await loadSchoolConfig(params.schoolId);
  const problems = validateProgramme(
    {
      code: params.code,
      name: params.name,
      degreeType: params.degreeType,
      totalCredits: params.creditsRequired,
      durationTerms: params.durationTerms,
      minCgpa: params.minCgpa,
    },
    config.grading.maxGradePoint,
  );
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };
  if (!isDegreeType(params.degreeType)) return { ok: false, message: 'Choose an award.' };

  const db = dbFor(params.schoolId);
  const department = await db.department.findUnique({ where: { id: params.departmentId } });
  if (!department) return { ok: false, message: 'Choose a department from this school.' };

  const code = normaliseCode(params.code);
  const name = params.name.trim();
  const data = {
    code,
    name,
    degreeType: params.degreeType,
    departmentId: department.id,
    creditsRequired: params.creditsRequired,
    durationTerms: params.durationTerms,
    minCgpaToGraduate: params.minCgpa,
  };

  try {
    if (params.programmeId) {
      const existing = await db.program.findUnique({ where: { id: params.programmeId } });
      if (!existing) return { ok: false, message: 'That programme is not part of this school.' };

      await db.program.update({ where: { id: existing.id }, data });
      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'structure.programme.update',
        entityType: 'Program',
        entityId: existing.id,
        summary: `Programme ${code} “${name}” saved.`,
      });
      return { ok: true, message: `${name} saved.`, id: existing.id };
    }

    const created = await db.program.create({ data: { ...data, schoolId: params.schoolId } });
    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'structure.programme.create',
      entityType: 'Program',
      entityId: created.id,
      summary: `Programme ${code} “${name}” created in ${department.code}.`,
    });
    return { ok: true, message: `${name} created.`, id: created.id };
  } catch (error) {
    const duplicate = duplicateCode(error, 'programme', code);
    if (duplicate) return duplicate;
    console.error('[structure] programme save failed', error);
    return { ok: false, message: 'Could not save that programme.' };
  }
}

/**
 * Archive or restore a programme.
 *
 * Never deleted while students hold it: a graduate's record names the
 * programme they took, including one the university stopped offering years
 * ago. Archiving closes it to new intake and leaves every existing record
 * intact, which is what "we no longer run that course" actually means.
 */
export async function setProgrammeActive(params: {
  schoolId: string;
  programmeId: string;
  isActive: boolean;
  actorUserId: string;
}): Promise<StructureResult> {
  const db = dbFor(params.schoolId);
  const programme = await db.program.findUnique({
    where: { id: params.programmeId },
    include: { _count: { select: { students: true } } },
  });
  if (!programme) return { ok: false, message: 'That programme is not part of this school.' };

  await db.program.update({
    where: { id: programme.id },
    data: { isActive: params.isActive },
  });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.isActive ? 'structure.programme.restore' : 'structure.programme.archive',
    entityType: 'Program',
    entityId: programme.id,
    summary: `Programme ${programme.code} ${params.isActive ? 'reopened' : 'closed to new intake'}.`,
  });

  return {
    ok: true,
    message: params.isActive
      ? `${programme.name} is open to new intake again.`
      : `${programme.name} is closed to new intake. Its ${programme._count.students} existing ${programme._count.students === 1 ? 'student keeps' : 'students keep'} their record.`,
  };
}

// -----------------------------------------------------------------------------
// Courses
// -----------------------------------------------------------------------------

export async function saveCourse(params: {
  schoolId: string;
  courseId?: string | null;
  departmentId: string;
  code: string;
  title: string;
  description?: string | null;
  creditHours: number;
  level: number;
  actorUserId: string;
}): Promise<StructureResult> {
  const code = normaliseCode(params.code);
  const problems = [
    codeRejectionReason(code, 'course'),
    validateName(params.title, 'course'),
    validateCredits(params.creditHours),
    validateLevel(params.level),
  ].filter((p): p is string => p !== null);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const db = dbFor(params.schoolId);
  const department = await db.department.findUnique({ where: { id: params.departmentId } });
  if (!department) return { ok: false, message: 'Choose a department from this school.' };

  const data = {
    code,
    title: params.title.trim(),
    description: params.description?.trim() || null,
    creditHours: params.creditHours,
    level: params.level,
    departmentId: department.id,
  };

  try {
    if (params.courseId) {
      const existing = await db.course.findUnique({ where: { id: params.courseId } });
      if (!existing) return { ok: false, message: 'That course is not part of this school.' };

      await db.course.update({ where: { id: existing.id }, data });
      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'structure.course.update',
        entityType: 'Course',
        entityId: existing.id,
        summary: `Course ${code} “${data.title}” saved.`,
      });
      return { ok: true, message: `${code} saved.`, id: existing.id };
    }

    const created = await db.course.create({ data: { ...data, schoolId: params.schoolId } });
    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'structure.course.create',
      entityType: 'Course',
      entityId: created.id,
      summary: `Course ${code} “${data.title}” created in ${department.code}.`,
    });
    return { ok: true, message: `${code} created.`, id: created.id };
  } catch (error) {
    const duplicate = duplicateCode(error, 'course', code);
    if (duplicate) return duplicate;
    console.error('[structure] course save failed', error);
    return { ok: false, message: 'Could not save that course.' };
  }
}

export async function setCourseActive(params: {
  schoolId: string;
  courseId: string;
  isActive: boolean;
  actorUserId: string;
}): Promise<StructureResult> {
  const db = dbFor(params.schoolId);
  const course = await db.course.findUnique({ where: { id: params.courseId } });
  if (!course) return { ok: false, message: 'That course is not part of this school.' };

  await db.course.update({ where: { id: course.id }, data: { isActive: params.isActive } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.isActive ? 'structure.course.restore' : 'structure.course.archive',
    entityType: 'Course',
    entityId: course.id,
    summary: `Course ${course.code} ${params.isActive ? 'reopened' : 'retired'}.`,
  });
  return {
    ok: true,
    message: params.isActive ? `${course.code} reopened.` : `${course.code} retired.`,
  };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/** The whole tree, in one pass, for the structure console. */
export async function loadStructure(schoolId: string) {
  const db = dbFor(schoolId);

  const [faculties, departments, programmes, courses] = await Promise.all([
    db.faculty.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { departments: true } } },
    }),
    db.department.findMany({
      orderBy: { code: 'asc' },
      include: {
        faculty: { select: { id: true, code: true, name: true } },
        _count: { select: { programs: true, courses: true, instructors: true } },
      },
    }),
    db.program.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        department: { select: { id: true, code: true, name: true, facultyId: true } },
        _count: { select: { students: true } },
      },
    }),
    db.course.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        department: { select: { id: true, code: true, name: true } },
        _count: { select: { offerings: true } },
      },
    }),
  ]);

  return { faculties, departments, programmes, courses };
}
