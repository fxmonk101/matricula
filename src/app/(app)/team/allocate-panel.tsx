import { requireTenantContext } from '@/server/tenant-context';
import { getTeachingWorkload } from '@/server/services/teaching.service';
import { proposeAssignee, viewWorkload } from '@/lib/domain/tasks';
import { AllocateDialog, type AllocOption, type AllocInstructor } from './allocate-dialog';

/**
 * Loads the sections and instructors the dialog needs, and computes the
 * fair-assignment suggestion for each unallocated section on the server.
 *
 * Done here rather than in the browser so the suggestion uses the same
 * `proposeAssignee` the tests pin, against data the client never sees. A
 * second implementation of "who is least loaded" in the browser is a second
 * thing to keep true.
 */
export async function AllocatePanel({ termId }: { termId: string }) {
  const { db, schoolId } = await requireTenantContext();

  const [offerings, workload] = await Promise.all([
    db.courseOffering.findMany({
      where: { termId, status: { not: 'CANCELLED' } },
      include: {
        course: { select: { code: true, title: true, creditHours: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
    }),
    getTeachingWorkload(schoolId, termId),
  ]);

  const views = viewWorkload(workload);
  const byMember = new Map(views.map((v) => [v.memberId, v]));

  const instructors: AllocInstructor[] = workload.map((w) => {
    const v = byMember.get(w.memberId);
    return {
      instructorId: w.instructorId,
      name: w.name,
      rank: w.rank,
      assignedUnits: w.assignedUnits,
      capacityUnits: w.capacityUnits,
      utilisation: v?.utilisation ?? 0,
    };
  });

  const options: AllocOption[] = offerings.map((o) => {
    const suggestion = proposeAssignee(workload, o.course.creditHours);
    const suggested = suggestion
      ? (workload.find((w) => w.memberId === suggestion.memberId) ?? null)
      : null;
    return {
      offeringId: o.id,
      label: `${o.course.code}-${o.section} · ${o.course.title}`,
      creditHours: o.course.creditHours,
      currentInstructor: o.instructor
        ? `${o.instructor.user.firstName} ${o.instructor.user.lastName}`
        : null,
      // Null means every instructor is already at their ceiling — a real and
      // actionable answer, not a failure to compute one.
      suggestedInstructorId: suggested?.instructorId ?? null,
      suggestedName: suggestion?.name ?? null,
    };
  });

  return <AllocateDialog options={options} instructors={instructors} />;
}
