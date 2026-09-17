import type { Metadata } from 'next';

import { requireRoute } from '@/server/tenant-context';
import { titleCase } from '@/lib/utils';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export const metadata: Metadata = { title: 'Faculty' };

export default async function InstructorsPage() {
  const { db, school, schoolId } = await requireRoute('/instructors');

  const instructors = await db.instructor.findMany({
    include: {
      user: true,
      department: { include: { faculty: true } },
      offerings: {
        where: { term: { isCurrent: true } },
        include: { course: { select: { code: true, creditHours: true } } },
      },
    },
    orderBy: [{ department: { code: 'asc' } }, { user: { lastName: 'asc' } }],
  });

  return (
    <>
      <PageHeader
        title="Faculty"
        description={`${instructors.length} academic staff. Teaching load is shown for the current term only.`}
      />

      <Card>
        {instructors.length === 0 ? (
          <EmptyState title="No faculty records" />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Staff number</Th>
                <Th>Rank</Th>
                <Th>Department</Th>
                <Th>Office</Th>
                <Th>Teaching this term</Th>
                <Th className="text-right">Load</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instructors.map((i) => {
                const load = i.offerings.reduce((s, o) => s + o.course.creditHours, 0);
                return (
                  <tr key={i.id}>
                    <Td>
                      <div className="font-medium text-slate-900">
                        {i.user.firstName} {i.user.lastName}
                      </div>
                      <div className="text-xs text-slate-500">{i.user.email}</div>
                    </Td>
                    <Td className="font-mono text-xs">{i.staffNumber}</Td>
                    <Td className="text-xs">{titleCase(i.rank)}</Td>
                    <Td className="text-xs">
                      {i.department.code}
                      <div className="text-[11px] text-slate-400">{i.department.faculty.code}</div>
                    </Td>
                    <Td className="text-xs">{i.officeRoom ?? '—'}</Td>
                    <Td>
                      {i.offerings.length === 0 ? (
                        <span className="text-xs text-slate-400">No sections</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {i.offerings.map((o) => (
                            <Badge key={o.id} tone="brand">
                              {o.course.code}-{o.section}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums text-xs">
                      {load > 0 ? `${load} cr` : '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
