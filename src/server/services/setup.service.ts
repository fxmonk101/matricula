import { dbFor } from '@/lib/tenant';
import { loadSchoolConfig } from '@/server/school-config';
import {
  resolveSteps,
  setupProgress,
  type ResolvedStep,
  type SetupState,
  type SetupStepId,
} from '@/lib/domain/setup';
import type { AcademicModel } from '@/lib/domain/enums';
import { pluralise } from '@/lib/utils';

/**
 * Evaluate the setup checklist against what the school has actually got.
 *
 * Every step is DERIVED from real rows, never from a "step 3 complete" flag.
 * A stored flag is a second source of truth that goes stale the moment somebody
 * deletes the thing it was recording — a school would then be told its terms
 * were configured while having none, which is worse than no checklist at all.
 */
export async function evaluateSetup(
  schoolId: string,
  academicModel: AcademicModel,
): Promise<{ steps: ResolvedStep[]; progress: number }> {
  const db = dbFor(schoolId);

  const [
    config,
    terms,
    departments,
    programs,
    courses,
    subjects,
    formClasses,
    staff,
    students,
    fees,
  ] = await Promise.all([
    loadSchoolConfig(schoolId),
    db.term.count(),
    db.department.count(),
    db.program.count(),
    db.course.count(),
    db.subject.count(),
    db.formClass.count(),
    db.membership.count({
      where: {
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
      },
    }),
    db.student.count(),
    db.feeStructure.count(),
  ]);

  const states = new Map<SetupStepId, SetupState>();

  // Branding counts as done once the school has replaced the name it was
  // provisioned with OR added a logo — a school that accepted the defaults
  // deliberately should not be nagged forever.
  const branding = config.branding;
  states.set('branding', {
    id: 'branding',
    done: Boolean(branding.logoUrl) || branding.short !== branding.name,
    detail: branding.logoUrl ? 'Logo uploaded' : 'Using the default crest',
  });

  states.set('locale', {
    id: 'locale',
    done: Boolean(config.locale.timezone),
    detail: `${config.locale.timezone} · ${config.locale.dateFormat}`,
  });

  states.set('grading', {
    id: 'grading',
    done: config.grading.scale.length > 0,
    detail: `${config.grading.scale.length}-band scale, ${config.grading.maxGradePoint} max`,
  });

  states.set('terms', {
    id: 'terms',
    done: terms > 0,
    detail: terms > 0 ? pluralise(terms, 'term') : undefined,
  });

  // A university needs departments; a K-12 school needs year groups, which the
  // structure page also creates. Either satisfies "the shape of the school".
  const structureCount = academicModel === 'K12' ? formClasses : departments + programs;
  states.set('structure', {
    id: 'structure',
    done: structureCount > 0,
    detail:
      academicModel === 'K12'
        ? formClasses > 0
          ? pluralise(formClasses, 'class', 'classes')
          : undefined
        : departments > 0
          ? `${pluralise(departments, 'department')}, ${pluralise(programs, 'programme')}`
          : undefined,
  });

  const curriculumCount = academicModel === 'K12' ? subjects : courses;
  states.set('curriculum', {
    id: 'curriculum',
    done: curriculumCount > 0,
    detail:
      curriculumCount > 0
        ? pluralise(curriculumCount, academicModel === 'K12' ? 'subject' : 'course')
        : undefined,
  });

  // The owner is a member of staff, so "has staff" means somebody BESIDES them.
  // Otherwise the step is complete the instant the school is provisioned, which
  // would tell the owner they had done something they had not.
  states.set('staff', {
    id: 'staff',
    done: staff > 0,
    detail: staff > 0 ? pluralise(staff, 'member of staff', 'members of staff') : undefined,
  });

  states.set('students', {
    id: 'students',
    done: students > 0,
    detail: students > 0 ? pluralise(students, 'student') : undefined,
  });

  states.set('finance', {
    id: 'finance',
    done: fees > 0,
    detail: fees > 0 ? pluralise(fees, 'fee structure') : undefined,
  });

  const steps = resolveSteps(academicModel, states);
  return { steps, progress: setupProgress(steps) };
}
