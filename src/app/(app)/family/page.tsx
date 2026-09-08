import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { getGuardianChildren } from '@/server/guardian';
import { ordinal } from '@/lib/domain/k12';
import { formatDate } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  type BadgeTone,
} from '@/components/ui';

export const metadata: Metadata = { title: 'My family' };

const DECISION_TONE: Record<string, BadgeTone> = {
  PROMOTED: 'success',
  GRADUATED: 'gold',
  REVIEW: 'warning',
  REPEAT: 'danger',
};

export default async function FamilyPage() {
  const { db, school, config } = await requireTenantRole('GUARDIAN');
  const children = await getGuardianChildren();

  // Only PUBLISHED cards. A draft is the school's working document; showing one
  // to a parent risks it changing under them before the term is finished.
  const cards =
    children.length === 0
      ? []
      : await db.reportCard.findMany({
          where: {
            studentId: { in: children.map((c) => c.studentId) },
            publishedAt: { not: null },
          },
          include: { term: true },
          orderBy: { term: { startDate: 'desc' } },
        });

  return (
    <>
      <PageHeader
        title="My family"
        description={`${school.name} — the records the school holds for your ${children.length === 1 ? 'child' : 'children'}.`}
      />

      {children.length === 0 ? (
        <Card>
          <EmptyState
            title="No children are linked to your account yet"
            description="The school office links a pupil to a guardian account. Contact them if you expected to see a child here."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {children.map((child) => {
            const theirs = cards.filter((c) => c.studentId === child.studentId);
            const latest = theirs[0];

            return (
              <Card key={child.studentId}>
                <CardHeader
                  title={child.name}
                  description={[
                    child.formClassName,
                    child.yearGroupName,
                    `Admission no. ${child.admissionNo}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
                    <Badge tone={child.isPrimary ? 'brand' : 'neutral'}>
                      {child.relationship.charAt(0) + child.relationship.slice(1).toLowerCase()}
                    </Badge>
                  }
                />
                <CardBody className="space-y-3">
                  {!latest ? (
                    <Alert tone="info">
                      No report card has been issued yet. You will see it here as soon as the
                      school publishes it.
                    </Alert>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Average
                          </p>
                          <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                            {latest.average.toFixed(1)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">
                            Grade
                          </p>
                          <p className="mt-0.5 text-xl font-semibold text-slate-900">
                            {latest.overallGrade}
                          </p>
                        </div>
                        {config.k12.showClassPosition ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-500">
                              Position
                            </p>
                            <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                              {ordinal(latest.positionInClass)}
                              <span className="text-sm font-normal text-slate-400">
                                {' '}
                                / {latest.classSize}
                              </span>
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={DECISION_TONE[latest.promotionDecision] ?? 'neutral'}>
                          {latest.promotionDecision === 'REVIEW'
                            ? 'Referred for review'
                            : latest.promotionDecision.charAt(0) +
                              latest.promotionDecision.slice(1).toLowerCase()}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {latest.term.name} · issued {formatDate(latest.publishedAt)}
                        </span>
                      </div>

                      {latest.promotionReason ? (
                        <p className="text-xs leading-relaxed text-slate-600">
                          {latest.promotionReason}
                        </p>
                      ) : null}
                    </>
                  )}

                  <div className="flex flex-wrap gap-3 pt-1">
                    <Link
                      href={`/family/${child.studentId}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {latest ? 'Open report card →' : 'View record →'}
                    </Link>
                    {theirs.length > 1 ? (
                      <span className="text-xs text-slate-500">
                        {theirs.length} terms on file
                      </span>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
