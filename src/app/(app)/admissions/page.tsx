import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { ADMISSION_WEIGHTS } from '@/lib/domain/admissions';
import { formatDate, titleCase } from '@/lib/utils';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { AllocationPanel } from './allocation-panel';

export const metadata: Metadata = { title: 'Admissions' };

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; program?: string }>;
}) {
  const { db, school, schoolId } = await requireTenantRole('ADMIN', 'ADMISSIONS', 'REGISTRAR');
  const params = await searchParams;

  const where = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.program ? { programId: params.program } : {}),
  };

  const [applications, byStatus, programs, terms] = await Promise.all([
    db.application.findMany({
      where,
      include: {
        applicant: { include: { user: true } },
        program: { select: { code: true, name: true } },
        term: { select: { code: true, name: true } },
        _count: { select: { reviews: true } },
      },
      orderBy: [{ compositeScore: 'desc' }, { submittedAt: 'asc' }],
      take: 100,
    }),
    db.application.groupBy({ by: ['status'], _count: { _all: true } }),
    db.program.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.term.findMany({ orderBy: { startDate: 'desc' } }),
  ]);

  const count = (status: string) =>
    byStatus.find((s) => s.status === status)?._count._all ?? 0;

  const inReview = count('SUBMITTED') + count('UNDER_REVIEW');

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Applications are scored on a weighted rubric, ranked within their cohort, and filled against capacity."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Awaiting decision" value={inReview} tone={inReview > 0 ? 'warning' : 'neutral'} />
        <StatTile label="Offers extended" value={count('OFFERED')} tone="brand" />
        <StatTile label="Accepted" value={count('ACCEPTED')} tone="success" />
        <StatTile label="Waitlisted" value={count('WAITLISTED')} />
        <StatTile label="Enrolled" value={count('ENROLLED')} tone="gold" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <AllocationPanel programs={programs} terms={terms} />

          <Card>
            <CardHeader
              title="Scoring rubric"
              description="Weights are renormalised over the components actually present, so a missing score never reads as a zero."
            />
            <CardBody>
              <dl className="space-y-1.5">
                {Object.entries(ADMISSION_WEIGHTS).map(([component, weight]) => (
                  <div key={component} className="flex items-center justify-between gap-3">
                    <dt className="text-xs text-slate-600">{titleCase(component)}</dt>
                    <dd className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-brand-600"
                          style={{ width: `${weight * 100}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums font-medium text-slate-900">
                        {(weight * 100).toFixed(0)}%
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Application pool"
            description={`${applications.length} application${applications.length === 1 ? '' : 's'}, ranked by composite score.`}
            actions={
              <form className="flex gap-2">
                <select
                  name="status"
                  defaultValue={params.status ?? ''}
                  className="rounded-lg border-0 px-2.5 py-1.5 text-xs ring-1 ring-inset ring-slate-300"
                >
                  <option value="">All statuses</option>
                  {[
                    'SUBMITTED',
                    'UNDER_REVIEW',
                    'OFFERED',
                    'WAITLISTED',
                    'ACCEPTED',
                    'REJECTED',
                    'ENROLLED',
                  ].map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white"
                >
                  Filter
                </button>
              </form>
            }
          />

          {applications.length === 0 ? (
            <EmptyState
              title="No applications match"
              description="Clear the filter, or wait for applications to be submitted."
            />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Applicant</Th>
                  <Th>Program</Th>
                  <Th className="text-right">Composite</Th>
                  <Th className="text-center">Reviews</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applications.map((app) => (
                  <tr key={app.id}>
                    <Td className="font-mono text-xs">{app.referenceNo}</Td>
                    <Td>
                      <div className="font-medium text-slate-900">
                        {app.applicant.user.firstName} {app.applicant.user.lastName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {app.submittedAt ? formatDate(app.submittedAt) : 'Not submitted'}
                      </div>
                    </Td>
                    <Td className="text-xs">
                      {app.program.code}
                      <div className="text-[11px] text-slate-400">{app.term.code}</div>
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {app.compositeScore?.toFixed(2) ?? '—'}
                      {app.rankInCohort ? (
                        <div className="text-[11px] font-normal text-slate-400">
                          rank {app.rankInCohort}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-center">
                      <Badge tone={app._count.reviews >= 2 ? 'success' : 'warning'}>
                        {app._count.reviews}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={toneForStatus(app.status)}>{titleCase(app.status)}</Badge>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/admissions/${app.id}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        Review
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
