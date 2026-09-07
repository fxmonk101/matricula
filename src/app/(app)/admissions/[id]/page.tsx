import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import {
  ADMISSION_WEIGHTS,
  aggregateReviews,
  computeCompositeScore,
  REVIEWER_DISAGREEMENT_THRESHOLD,
} from '@/lib/domain/admissions';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  Meter,
  PageHeader,
  StatTile,
  toneForStatus,
} from '@/components/ui';
import { ReviewForm, ConvertForm } from './review-form';

export const metadata: Metadata = { title: 'Application' };

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, school, schoolId, session } = await requireTenantRole('ADMIN', 'ADMISSIONS', 'REGISTRAR');
  const { id } = await params;

  const application = await db.application.findUnique({
    where: { id },
    include: {
      applicant: { include: { user: true } },
      program: { include: { department: true } },
      term: true,
      reviews: { orderBy: { createdAt: 'asc' } },
      documents: true,
    },
  });

  if (!application) notFound();

  const aggregate = aggregateReviews(
    application.reviews.map((r) => ({
      reviewerId: r.reviewerId,
      academicScore: r.academicScore,
      essayScore: r.essayScore,
      interviewScore: r.interviewScore,
      extracurricularScore: r.extracurricularScore,
      recommendation: r.recommendation as 'ADMIT' | 'WAITLIST' | 'REJECT',
    })),
  );

  const hasReviews = aggregate.reviewCount > 0;
  const scored = computeCompositeScore({
    priorGpaScore: application.priorGpaScore,
    entranceExamScore: application.entranceExamScore,
    essayScore: hasReviews ? aggregate.essayScore : application.essayScore,
    interviewScore: hasReviews ? aggregate.interviewScore : application.interviewScore,
    extracurricularScore: hasReviews
      ? aggregate.extracurricularScore
      : application.extracurricularScore,
  });

  const myReview = application.reviews.find((r) => r.reviewerId === session.sub);

  return (
    <>
      <PageHeader
        title={`${application.applicant.user.firstName} ${application.applicant.user.lastName}`}
        description={`${application.referenceNo} · ${application.program.name} · ${application.term.name}`}
        actions={
          <>
            <Badge tone={toneForStatus(application.status)}>{titleCase(application.status)}</Badge>
            <Link href="/admissions" className="text-sm text-brand-700 hover:underline">
              ← All applications
            </Link>
          </>
        }
      />

      {aggregate.requiresAdjudication ? (
        <Alert tone="warning" title="Reviewers disagree substantially" className="mb-4">
          The academic scores span {aggregate.disagreementSpread.toFixed(1)} points, above the{' '}
          {REVIEWER_DISAGREEMENT_THRESHOLD}-point threshold. A third, adjudicating review should be
          obtained rather than averaging the disagreement away.
        </Alert>
      ) : null}

      {scored.missingComponents.length > 0 ? (
        <Alert tone="info" title="Incomplete rubric" className="mb-4">
          {scored.missingComponents.map(titleCase).join(', ')} {scored.missingComponents.length === 1 ? 'has' : 'have'} not
          been scored. The composite is computed over the {(scored.coverage * 100).toFixed(0)}% of
          the rubric that is available — missing components are excluded, not treated as zero.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Composite score"
          value={scored.composite.toFixed(2)}
          sublabel={`${(scored.coverage * 100).toFixed(0)}% rubric coverage`}
          tone={scored.composite >= 70 ? 'success' : scored.composite >= 50 ? 'warning' : 'danger'}
        />
        <StatTile
          label="Reviews"
          value={aggregate.reviewCount}
          sublabel={aggregate.consensusRecommendation ? `Consensus: ${titleCase(aggregate.consensusRecommendation)}` : 'Not yet reviewed'}
          tone={aggregate.reviewCount >= 2 ? 'success' : 'warning'}
        />
        <StatTile
          label="Cohort rank"
          value={application.rankInCohort ?? '—'}
          sublabel="at the last allocation run"
        />
        <StatTile
          label="Offer expires"
          value={application.offerExpiresAt ? formatDate(application.offerExpiresAt) : '—'}
          sublabel={application.status === 'OFFERED' ? 'Awaiting applicant response' : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Applicant" />
            <CardBody>
              <dl>
                <DetailRow label="Email">
                  <span className="text-xs">{application.applicant.user.email}</span>
                </DetailRow>
                <DetailRow label="Phone">{application.applicant.user.phone ?? '—'}</DetailRow>
                <DetailRow label="Date of birth">
                  {formatDate(application.applicant.dateOfBirth)}
                </DetailRow>
                <DetailRow label="Nationality">
                  {application.applicant.nationality ?? '—'}
                </DetailRow>
                <DetailRow label="Previous school">
                  {application.previousSchool ?? '—'}
                </DetailRow>
                <DetailRow label="Submitted">
                  {application.submittedAt ? formatDateTime(application.submittedAt) : 'Not submitted'}
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Score breakdown"
              description="Each component's weighted contribution to the composite."
            />
            <CardBody className="space-y-2.5">
              {scored.breakdown.length === 0 ? (
                <p className="text-xs text-slate-500">No scores recorded yet.</p>
              ) : (
                scored.breakdown.map((b) => (
                  <div key={b.component}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-600">{titleCase(b.component)}</span>
                      <span className="tabular-nums text-slate-900">
                        {b.raw.toFixed(1)}
                        <span className="ml-1.5 text-slate-400">
                          × {(b.weight * 100).toFixed(0)}% = {b.contribution.toFixed(1)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1">
                      <Meter value={b.raw} tone={b.raw >= 70 ? 'success' : b.raw >= 50 ? 'warning' : 'danger'} />
                    </div>
                  </div>
                ))
              )}

              {scored.missingComponents.map((c) => (
                <div key={c} className="flex justify-between text-xs text-slate-400">
                  <span>{titleCase(c)}</span>
                  <span>not scored ({(ADMISSION_WEIGHTS[c] * 100).toFixed(0)}% excluded)</span>
                </div>
              ))}
            </CardBody>
          </Card>

          {application.status === 'ACCEPTED' ? (
            <Card>
              <CardHeader
                title="Matriculate"
                description="Creates the student record, issues a matriculation number, and converts the account role."
              />
              <CardBody>
                <ConvertForm applicationId={application.id} />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {application.personalStatement ? (
            <Card>
              <CardHeader title="Personal statement" />
              <CardBody>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {application.personalStatement}
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Committee reviews"
              description="Each reviewer scores independently. Scores are averaged per dimension; the recommendation is the mode, with ties resolving conservatively."
            />
            {application.reviews.length === 0 ? (
              <CardBody>
                <p className="text-xs text-slate-500">No reviews recorded yet.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-slate-100">
                {application.reviews.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              r.recommendation === 'ADMIT'
                                ? 'success'
                                : r.recommendation === 'WAITLIST'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {titleCase(r.recommendation)}
                          </Badge>
                          <span className="text-[11px] text-slate-400">
                            {formatDateTime(r.createdAt)}
                            {r.reviewerId === session.sub ? ' · your review' : ''}
                          </span>
                        </div>
                        {r.comments ? (
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                            {r.comments}
                          </p>
                        ) : null}
                      </div>
                      <dl className="shrink-0 space-y-0.5 text-right text-[11px] tabular-nums">
                        <div>
                          <dt className="inline text-slate-400">Academic </dt>
                          <dd className="inline font-medium text-slate-900">
                            {r.academicScore.toFixed(1)}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-slate-400">Essay </dt>
                          <dd className="inline font-medium text-slate-900">
                            {r.essayScore.toFixed(1)}
                          </dd>
                        </div>
                        {r.interviewScore !== null ? (
                          <div>
                            <dt className="inline text-slate-400">Interview </dt>
                            <dd className="inline font-medium text-slate-900">
                              {r.interviewScore.toFixed(1)}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {session.role === 'ADMIN' || session.role === 'ADMISSIONS' ? (
            <Card>
              <CardHeader
                title={myReview ? 'Update your review' : 'Add your review'}
                description="Score each dimension out of 100. Leave a dimension blank if you have no basis to judge it — a blank is excluded, a zero is a judgement."
              />
              <CardBody>
                <ReviewForm applicationId={application.id} existing={myReview ?? null} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
