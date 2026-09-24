import 'server-only';

import { studentItemsOf, visibleToStudent } from '@/lib/domain/lms';
import { dbFor } from '@/lib/tenant';

/**
 * =============================================================================
 * COURSE CONTENT FOR A SECONDARY SCHOOL
 * =============================================================================
 *
 * The LMS was built on `CourseOffering` — a university section, with a roster
 * of `Enrollment` rows. A secondary school has neither. Its unit of teaching is
 * a `SubjectAssignment` (one subject, taught to one form class, in one term)
 * and its roster is `ClassEnrolment` (which form class a pupil is in).
 *
 * `CourseSpace` was shaped for both from the start — it carries a nullable
 * `offeringId` AND a nullable `subjectAssignmentId`, exactly one of which is
 * set. This file fills in the second, so a secondary school gets modules,
 * pages, files, links and virtual classes on the same machinery.
 *
 * WHAT IS NOT HERE, AND WHY
 * -------------------------
 * Coursework, quizzes and submissions. `Submission.enrollmentId` points at
 * `Enrollment`, which is a university registration; a pupil does not have one.
 * Making it polymorphic is possible, but the mark would then have to roll up
 * into `SubjectResult` rather than `Enrollment.caScore` — a second grading path
 * through code where being wrong is a wrong report card.
 *
 * So this delivers CONTENT for K-12 and says so plainly, rather than shipping
 * a half-wired gradebook that appears to work. The distinction is enforced in
 * `saveItem`'s callers rather than hoped for: a K-12 space has no route that
 * can create a COURSEWORK or QUIZ item.
 */

export async function ensureSpaceForSubject(params: {
  schoolId: string;
  subjectAssignmentId: string;
}): Promise<{ ok: boolean; spaceId?: string; message?: string }> {
  const db = dbFor(params.schoolId);

  // Re-read through the tenant client: a crafted id must not attach content to
  // another school's class.
  const assignment = await db.subjectAssignment.findUnique({
    where: { id: params.subjectAssignmentId },
    select: { id: true, termId: true },
  });
  if (!assignment) return { ok: false, message: 'Choose a subject from this school.' };

  const existing = await db.courseSpace.findFirst({
    where: { subjectAssignmentId: assignment.id },
  });
  if (existing) return { ok: true, spaceId: existing.id };

  const created = await db.courseSpace.create({
    data: {
      schoolId: params.schoolId,
      termId: assignment.termId,
      subjectAssignmentId: assignment.id,
      // offeringId stays null — the same "exactly one owner" invariant the
      // higher-ed path keeps, from the other side.
    },
  });

  return { ok: true, spaceId: created.id };
}

const MODULE_INCLUDE = {
  items: {
    orderBy: { position: 'asc' as const },
    include: {
      virtualClass: {
        select: {
          id: true,
          provider: true,
          joinUrl: true,
          startsAt: true,
          endsAt: true,
        },
      },
    },
  },
};

/** Everything in the subject, drafts included. For the teacher who owns it. */
export async function loadSubjectSpaceForTeacher(params: {
  schoolId: string;
  subjectAssignmentId: string;
}) {
  return dbFor(params.schoolId).courseSpace.findFirst({
    where: { subjectAssignmentId: params.subjectAssignmentId },
    include: { modules: { orderBy: { position: 'asc' }, include: MODULE_INCLUDE } },
  });
}

/**
 * What a pupil may see — a smaller list, not a filtered one.
 *
 * Same reasoning as the university path: filtering in the browser would still
 * have SENT the draft, sitting in the payload for anybody who opened the
 * network tab. The publish and unlock rules are the shared domain functions, so
 * a secondary school and a university cannot drift apart on what "published"
 * means.
 */
export async function loadSubjectSpaceForPupil(params: {
  schoolId: string;
  subjectAssignmentId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const space = await loadSubjectSpaceForTeacher(params);
  if (!space) return null;

  const modules = space.modules
    .filter((module) => visibleToStudent(module, now))
    .map((module) => ({ ...module, items: studentItemsOf(module, module.items, now) }));

  return { ...space, modules };
}

/**
 * May this person author content for this subject?
 *
 * The office oversees every class; a teacher owns the ones assigned to them.
 * Mirrors `mayAuthorOffering` deliberately — two functions that answer the same
 * question differently is how one of them ends up wrong.
 */
export async function mayAuthorSubject(params: {
  schoolId: string;
  subjectAssignmentId: string;
  instructorProfileId?: string | null;
  role: string;
}): Promise<boolean> {
  if (['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'].includes(params.role)) return true;

  const assignment = await dbFor(params.schoolId).subjectAssignment.findUnique({
    where: { id: params.subjectAssignmentId },
    select: { teacherId: true },
  });
  if (!assignment) return false;

  return Boolean(params.instructorProfileId) && assignment.teacherId === params.instructorProfileId;
}

/**
 * Is this pupil in the form class this subject is taught to?
 *
 * The K-12 analogue of `enrolmentFor`, and the reason a pupil cannot read
 * another class's material by changing an id.
 */
export async function pupilTakesSubject(params: {
  schoolId: string;
  subjectAssignmentId: string;
  studentProfileId: string;
}): Promise<boolean> {
  const db = dbFor(params.schoolId);

  const assignment = await db.subjectAssignment.findUnique({
    where: { id: params.subjectAssignmentId },
    select: { formClassId: true, termId: true },
  });
  if (!assignment) return false;

  const enrolment = await db.classEnrolment.findFirst({
    where: {
      studentId: params.studentProfileId,
      formClassId: assignment.formClassId,
      termId: assignment.termId,
    },
    select: { id: true },
  });

  return Boolean(enrolment);
}

/** Every subject a pupil is taught this term, with how much is published. */
export async function subjectsForPupil(params: {
  schoolId: string;
  studentProfileId: string;
  termId?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const enrolment = await db.classEnrolment.findFirst({
    where: {
      studentId: params.studentProfileId,
      ...(params.termId ? { termId: params.termId } : { term: { isCurrent: true } }),
    },
    select: { formClassId: true, termId: true, formClass: { select: { name: true } } },
  });
  if (!enrolment) return { formClass: null, subjects: [] };

  const assignments = await db.subjectAssignment.findMany({
    where: { formClassId: enrolment.formClassId, termId: enrolment.termId },
    include: {
      subject: { select: { code: true, name: true } },
      teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
      space: {
        include: {
          modules: {
            orderBy: { position: 'asc' },
            include: MODULE_INCLUDE,
          },
        },
      },
    },
  });

  return {
    formClass: enrolment.formClass.name,
    subjects: assignments
      .map((assignment) => {
        /*
         * Counted through the SAME visibility rules the subject page uses, so
         * a list that says "3 items" and a page that shows two is impossible.
         */
        const visible = (assignment.space?.modules ?? [])
          .filter((module) => visibleToStudent(module, now))
          .map((module) => studentItemsOf(module, module.items, now));

        return {
          subjectAssignmentId: assignment.id,
          code: assignment.subject.code,
          name: assignment.subject.name,
          teacher: assignment.teacher
            ? `${assignment.teacher.user.firstName} ${assignment.teacher.user.lastName}`.trim()
            : null,
          modules: visible.length,
          items: visible.reduce((sum, items) => sum + items.length, 0),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}
