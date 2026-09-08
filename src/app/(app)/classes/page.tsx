import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Classes' };

export default async function ClassesPage() {
  const { db, school } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR');

  // A university has no form classes. Rather than 404, say plainly why the page
  // is empty — an administrator who switched academic model needs to know the
  // page exists and what would fill it.
  if (school.academicModel !== 'K12') {
    return (
      <>
        <PageHeader title="Classes" />
        <Alert tone="info" title="This school runs on the higher-education model">
          Form classes belong to the primary and secondary model. {school.shortName} uses
          faculties, programmes and course sections instead — see <Link href="/offerings" className="font-medium underline">Sections</Link>.
        </Alert>
      </>
    );
  }

  const term = await db.term.findFirst({ where: { isCurrent: true } });

  const classes = await db.formClass.findMany({
    include: {
      yearGroup: true,
      formTeacher: { include: { user: true } },
      _count: {
        select: {
          enrolments: term ? { where: { termId: term.id } } : true,
          assignments: term ? { where: { termId: term.id } } : true,
        },
      },
    },
    orderBy: [{ yearGroup: { sequence: 'asc' } }, { code: 'asc' }],
  });

  const totalPupils = classes.reduce((s, c) => s + c._count.enrolments, 0);

  return (
    <>
      <PageHeader
        title="Classes"
        description={
          term
            ? `${term.name} · ${term.academicYear} — ${totalPupils} pupils across ${classes.length} form ${classes.length === 1 ? 'class' : 'classes'}.`
            : 'No term is currently active.'
        }
      />

      {classes.length === 0 ? (
        <Card>
          <EmptyState
            title="No form classes yet"
            description="Create year groups and form classes before pupils can be enrolled."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Form classes"
            description="Each pupil belongs to exactly one form class per term; their subjects follow from it."
          />
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Year group</Th>
                <Th>Form teacher</Th>
                <Th className="text-right">Pupils</Th>
                <Th className="w-32">Fill</Th>
                <Th className="text-right">Subjects</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {classes.map((c) => {
                const pct = c.capacity === 0 ? 0 : (c._count.enrolments / c.capacity) * 100;
                return (
                  <tr key={c.id}>
                    <Td>
                      <div className="font-medium text-slate-900">{c.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{c.code}</div>
                    </Td>
                    <Td className="text-xs">
                      {c.yearGroup.name}
                      {c.yearGroup.isTerminal ? (
                        <Badge tone="gold" className="ml-2">Final year</Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs">
                      {c.formTeacher ? (
                        `${c.formTeacher.user.firstName} ${c.formTeacher.user.lastName}`
                      ) : (
                        <Badge tone="warning">Unassigned</Badge>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {c._count.enrolments}/{c.capacity}
                    </Td>
                    <Td>
                      <Meter value={pct} tone={pct >= 100 ? 'danger' : pct >= 85 ? 'warning' : 'brand'} />
                    </Td>
                    <Td className="text-right tabular-nums text-xs">{c._count.assignments}</Td>
                    <Td className="text-right">
                      <Link
                        href={`/classes/${c.id}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
