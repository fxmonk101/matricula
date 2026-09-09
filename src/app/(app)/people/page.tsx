import type { Metadata } from 'next';

import { requireTenantRole } from '@/server/tenant-context';
import { listPeople, peopleSummary } from '@/server/services/people.service';
import { loadEntitlement } from '@/server/services/platform.service';
import { can } from '@/lib/auth/rbac';
import { ASSIGNABLE_ROLES } from '@/lib/domain/people';
import { seatUtilisation } from '@/lib/domain/provisioning';
import { ROLE_LABELS, isRole, type Role } from '@/lib/domain/enums';
import { formatDate } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { AddPersonPanel } from './add-person';
import { PersonActions } from './person-actions';

export const metadata: Metadata = { title: 'People' };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; suspended?: string }>;
}) {
  const { schoolId, role, membershipId, school } = await requireTenantRole('ADMIN', 'REGISTRAR');
  const { q, role: roleFilter, suspended } = await searchParams;

  const filterRole = roleFilter && isRole(roleFilter) ? roleFilter : undefined;
  const includeSuspended = suspended === '1';

  const [people, summary, entitlement, orgUnits] = await Promise.all([
    listPeople(schoolId, { query: q, role: filterRole, includeSuspended }),
    peopleSummary(schoolId),
    loadEntitlement(schoolId),
    // Managers and departments are offered from THIS school only; the service
    // re-validates both, because a select is not a permission.
    (async () => {
      const { dbFor } = await import('@/lib/tenant');
      return dbFor(schoolId).orgUnit.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    })(),
  ]);

  const canCreate = can(role, 'user:create');
  const staffSeats = entitlement
    ? seatUtilisation(entitlement.usage.staff, entitlement.limits.maxStaff)
    : 0;
  const studentSeats = entitlement
    ? seatUtilisation(entitlement.usage.students, entitlement.limits.maxStudents)
    : 0;

  return (
    <>
      <PageHeader
        title="People"
        description={`Everybody with an account at ${school.shortName}. Suspending somebody here removes their access to this school only — their account, and any membership they hold elsewhere, is untouched.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active accounts" value={summary.total} tone="brand" />
        <StatTile
          label="Never signed in"
          value={summary.neverSignedIn}
          tone={summary.neverSignedIn > 0 ? 'warning' : 'success'}
          sublabel="Handed out and not yet used"
        />
        <StatTile
          label="On a one-time password"
          value={summary.pendingPassword}
          tone={summary.pendingPassword > 0 ? 'warning' : 'success'}
          sublabel="Still a shared secret until changed"
        />
        <StatTile
          label="Suspended"
          value={summary.suspended}
          tone={summary.suspended > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {entitlement && (
        <Card className="mt-4">
          <CardHeader
            title="Seats"
            description="Guardians and applicants are not seats — a school is not billed for a parent reading a report card."
          />
          <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
            <SeatRow
              label="Staff"
              used={entitlement.usage.staff}
              limit={entitlement.limits.maxStaff}
              pct={staffSeats}
            />
            <SeatRow
              label="Students"
              used={entitlement.usage.students}
              limit={entitlement.limits.maxStudents}
              pct={studentSeats}
            />
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Directory"
              description={`${people.length} ${people.length === 1 ? 'person' : 'people'}${filterRole ? ` with the ${ROLE_LABELS[filterRole]} role` : ''}.`}
              actions={
                <form method="get" className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    name="q"
                    defaultValue={q ?? ''}
                    placeholder="Name, email or title"
                    className="h-8 w-44 rounded-lg border-0 bg-white px-2.5 text-xs text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300 placeholder:text-slate-400"
                  />
                  <select
                    name="role"
                    defaultValue={filterRole ?? ''}
                    className="h-8 rounded-lg border-0 bg-white px-2 pr-6 text-xs text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300"
                  >
                    <option value="">All roles</option>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      name="suspended"
                      value="1"
                      defaultChecked={includeSuspended}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    Suspended
                  </label>
                  <button
                    type="submit"
                    className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-onInk hover:bg-slate-800"
                  >
                    Filter
                  </button>
                </form>
              }
            />

            {people.length === 0 ? (
              <EmptyState
                title={q || filterRole ? 'Nobody matches that' : 'No people yet'}
                description={
                  q || filterRole
                    ? 'Clear the filters to see everybody.'
                    : 'Add your first member of staff with the form beside this list.'
                }
              />
            ) : (
              <Table className="table-hover">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Department</Th>
                    <Th>Last signed in</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map((person) => (
                    <tr
                      key={person.membershipId}
                      className={person.status === 'SUSPENDED' ? 'opacity-55' : undefined}
                    >
                      <Td>
                        <div className="text-sm font-medium text-slate-900">{person.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {person.email}
                          {person.otherSchools > 0 && (
                            <>
                              {' · '}
                              <span title="This person holds an account at another school on this platform. Which one is not this school's business.">
                                also at {person.otherSchools}{' '}
                                {person.otherSchools === 1 ? 'other school' : 'other schools'}
                              </span>
                            </>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={person.role === 'OWNER' ? 'brand' : 'neutral'}>
                          {ROLE_LABELS[person.role] ?? person.role}
                        </Badge>
                        {person.title && (
                          <div className="mt-0.5 text-[11px] text-slate-500">{person.title}</div>
                        )}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {person.orgUnit?.name ?? <span className="text-slate-400">—</span>}
                        {person.manager && (
                          <div className="text-[11px] text-slate-400">
                            reports to {person.manager.name}
                          </div>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {person.lastLoginAt ? (
                          formatDate(person.lastLoginAt)
                        ) : (
                          <span className="text-amber-700">never</span>
                        )}
                        {person.status === 'SUSPENDED' && (
                          <div>
                            <Badge tone="danger">Suspended</Badge>
                          </div>
                        )}
                        {person.mustChangePassword && person.status !== 'SUSPENDED' && (
                          <div className="text-[11px] text-amber-700">one-time password</div>
                        )}
                      </Td>
                      <Td className="text-right">
                        <PersonActions
                          person={{
                            membershipId: person.membershipId,
                            name: person.name,
                            role: person.role,
                            status: person.status,
                          }}
                          actorRole={role}
                          actorMembershipId={membershipId}
                          assignableRoles={ASSIGNABLE_ROLES as Role[]}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {canCreate ? (
            <AddPersonPanel orgUnits={orgUnits} assignableRoles={ASSIGNABLE_ROLES as Role[]} />
          ) : (
            <Alert tone="info">
              Your role can view the directory but not change it. Ask an administrator to add or
              suspend an account.
            </Alert>
          )}

          <Card>
            <CardHeader title="By role" description="Active accounts only." />
            <ul className="divide-y divide-slate-100">
              {ASSIGNABLE_ROLES.filter((r) => (summary.byRole[r] ?? 0) > 0 || r === 'STUDENT').map(
                (r) => (
                  <li key={r} className="flex items-baseline justify-between gap-3 px-5 py-2">
                    <span className="text-xs text-slate-700">{ROLE_LABELS[r]}</span>
                    <span className="text-xs tabular-nums text-slate-900">
                      {summary.byRole[r] ?? 0}
                    </span>
                  </li>
                ),
              )}
              {(summary.byRole.OWNER ?? 0) > 0 && (
                <li className="flex items-baseline justify-between gap-3 px-5 py-2">
                  <span className="text-xs font-medium text-brand-700">{ROLE_LABELS.OWNER}</span>
                  <span className="text-xs tabular-nums text-slate-900">
                    {summary.byRole.OWNER}
                  </span>
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function SeatRow({
  label,
  used,
  limit,
  pct,
}: {
  label: string;
  used: number;
  limit: number | null;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-600">{label}</span>
        <span className="text-sm tabular-nums text-slate-900">
          {used}
          <span className="text-slate-400"> / {limit ?? 'unlimited'}</span>
        </span>
      </div>
      <div className="mt-1.5">
        <Meter value={pct} tone={pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'brand'} />
      </div>
    </div>
  );
}
