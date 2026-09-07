import type { Metadata } from 'next';

import { requireTenantRole } from '@/server/tenant-context';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export const metadata: Metadata = { title: 'Course catalogue' };

export default async function CoursesPage() {
  const { db, school, schoolId } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS');

  const departments = await db.department.findMany({
    include: {
      faculty: true,
      courses: {
        where: { isActive: true },
        include: {
          prerequisites: { include: { prerequisite: { select: { code: true } } } },
          _count: { select: { offerings: true } },
        },
        orderBy: [{ level: 'asc' }, { code: 'asc' }],
      },
    },
    orderBy: { code: 'asc' },
  });

  const totalCourses = departments.reduce((s, d) => s + d.courses.length, 0);

  return (
    <>
      <PageHeader
        title="Course catalogue"
        description={`${totalCourses} active course${totalCourses === 1 ? '' : 's'} across ${departments.length} departments. Prerequisites shown are the immediate ones; transitive requirements are implied.`}
      />

      <div className="space-y-4">
        {departments.map((dept) => (
          <Card key={dept.id}>
            <div className="flex items-baseline justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{dept.name}</h2>
                <p className="text-xs text-slate-500">
                  {dept.faculty.name} · {dept.code}
                </p>
              </div>
              <span className="text-xs tabular-nums text-slate-500">
                {dept.courses.length} courses
              </span>
            </div>

            {dept.courses.length === 0 ? (
              <EmptyState title="No active courses in this department" />
            ) : (
              <Table className="table-hover">
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Title</Th>
                    <Th className="text-center">Level</Th>
                    <Th className="text-center">Credits</Th>
                    <Th>Prerequisites</Th>
                    <Th className="text-right">Sections</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dept.courses.map((course) => (
                    <tr key={course.id}>
                      <Td className="font-mono text-xs font-medium text-slate-900">{course.code}</Td>
                      <Td>
                        <div className="font-medium text-slate-900">{course.title}</div>
                        {course.description ? (
                          <div className="mt-0.5 max-w-xl text-xs text-slate-500">
                            {course.description}
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-center tabular-nums">{course.level}</Td>
                      <Td className="text-center tabular-nums">{course.creditHours}</Td>
                      <Td>
                        {course.prerequisites.length === 0 ? (
                          <span className="text-xs text-slate-400">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {course.prerequisites.map((p) => (
                              <Badge
                                key={p.id}
                                tone={p.isConcurrent ? 'info' : 'neutral'}
                                title={
                                  p.isConcurrent
                                    ? 'May be taken concurrently'
                                    : `Minimum grade point ${p.minGradePoint.toFixed(1)}`
                                }
                              >
                                {p.prerequisite.code}
                                {p.isConcurrent ? ' (concurrent)' : ''}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums text-xs text-slate-500">
                        {course._count.offerings}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
