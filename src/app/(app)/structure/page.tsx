import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { loadStructure } from '@/server/services/structure.service';
import { loadSchoolConfig } from '@/server/school-config';
import { can } from '@/lib/auth/rbac';
import { Alert, PageHeader, StatTile } from '@/components/ui';
import { StructureConsole } from './structure-console';

export const metadata: Metadata = { title: 'Academic structure' };

/**
 * The Registrar's office: the shape of the university.
 *
 * Presented in dependency order — faculty, department, programme, course —
 * because that is the order in which it can actually be entered. A university
 * that starts with courses gets two screens in and finds every one of them
 * needs a department that does not exist yet.
 */
export default async function StructurePage() {
  const { schoolId, role, school } = await requireTenantRole('ADMIN', 'REGISTRAR', 'DEAN', 'HOD');

  const [{ faculties, departments, programmes, courses }, config] = await Promise.all([
    loadStructure(schoolId),
    loadSchoolConfig(schoolId),
  ]);

  const canWriteStructure = can(role, 'faculty:write') || can(role, 'course:write');
  const activeProgrammes = programmes.filter((p) => p.isActive).length;
  const activeCourses = courses.filter((c) => c.isActive).length;

  return (
    <>
      <PageHeader
        title="Academic structure"
        description={`The shape of ${school.shortName}: faculties, the departments inside them, and what each department teaches.`}
        actions={
          <Link href="/setup" className="text-sm text-brand-700 hover:underline">
            Setup checklist →
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Faculties" value={faculties.length} tone="brand" />
        <StatTile label="Departments" value={departments.length} />
        <StatTile
          label="Programmes"
          value={activeProgrammes}
          sublabel={
            programmes.length > activeProgrammes
              ? `${programmes.length - activeProgrammes} closed to new intake`
              : 'All open to new intake'
          }
        />
        <StatTile
          label="Courses"
          value={activeCourses}
          sublabel={
            courses.length > activeCourses ? `${courses.length - activeCourses} retired` : undefined
          }
        />
      </div>

      {faculties.length === 0 && (
        <Alert tone="info" title="Start with a faculty" className="mt-4">
          Departments belong to faculties, programmes and courses belong to departments, and
          sections belong to courses. Working down that order is the difference between setting the
          university up in an afternoon and getting stuck halfway.
        </Alert>
      )}

      <div className="mt-4">
        <StructureConsole
          faculties={faculties.map((f) => ({
            id: f.id,
            code: f.code,
            name: f.name,
            departmentCount: f._count.departments,
          }))}
          departments={departments.map((d) => ({
            id: d.id,
            code: d.code,
            name: d.name,
            facultyId: d.facultyId,
            facultyCode: d.faculty.code,
            programmeCount: d._count.programs,
            courseCount: d._count.courses,
            lecturerCount: d._count.instructors,
          }))}
          programmes={programmes.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            degreeType: p.degreeType,
            departmentId: p.departmentId,
            creditsRequired: p.creditsRequired,
            durationTerms: p.durationTerms,
            minCgpa: p.minCgpaToGraduate,
            isActive: p.isActive,
            studentCount: p._count.students,
          }))}
          courses={courses.map((c) => ({
            id: c.id,
            code: c.code,
            title: c.title,
            description: c.description,
            departmentId: c.departmentId,
            creditHours: c.creditHours,
            level: c.level,
            isActive: c.isActive,
            offeringCount: c._count.offerings,
          }))}
          maxGradePoint={config.grading.maxGradePoint}
          canWriteStructure={canWriteStructure}
        />
      </div>
    </>
  );
}
