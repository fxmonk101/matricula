import { requireTenantContext } from '@/server/tenant-context';
import { can } from '@/lib/auth/rbac';
import { NewTaskDialog, type Candidate } from './new-task-dialog';

/**
 * Loads who a task may be assigned to, then hands off to the client dialog.
 *
 * The candidate list is built server-side from the tenant-scoped client, so it
 * physically cannot contain someone from another school — and the action
 * re-checks the same thing rather than trusting the submitted id. The list is
 * a convenience; the check is the security.
 */
export async function NewTaskButton() {
  const { db, role, membershipId } = await requireTenantContext();
  if (!can(role, 'task:create')) return null;

  const rows = await db.membership.findMany({
    where: {
      status: 'ACTIVE',
      // Students, applicants and guardians are not staff and do not carry
      // assigned work. Offering them in the picker would invite a task nobody
      // has a queue for.
      role: { in: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
    },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: [{ role: 'asc' }, { user: { lastName: 'asc' } }],
  });

  const candidates: Candidate[] = rows.map((m) => ({
    membershipId: m.id,
    name: `${m.user.firstName} ${m.user.lastName}${m.id === membershipId ? ' (you)' : ''}`,
    title: m.title,
    role: m.role,
  }));

  return <NewTaskDialog candidates={candidates} canAssignOthers={can(role, 'task:assign')} myMembershipId={membershipId} />;
}
