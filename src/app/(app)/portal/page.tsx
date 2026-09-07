import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';
import { isOfferLive } from '@/lib/domain/admissions';
import type { ApplicationStatus } from '@/lib/domain/enums';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  PageHeader,
  toneForStatus,
} from '@/components/ui';
import { OfferResponse } from './offer-response';

export const metadata: Metadata = { title: 'My application' };

/**
 * Applicant-facing status descriptions. Written to be informative without
 * revealing internal committee state — an applicant should know where they
 * stand, not who scored them what.
 */
const STATUS_COPY: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  DRAFT: { tone: 'info', text: 'Your application is a draft and has not been submitted.' },
  SUBMITTED: { tone: 'info', text: 'Received. It will be assigned to reviewers shortly.' },
  UNDER_REVIEW: { tone: 'info', text: 'Under review by the admissions committee.' },
  OFFERED: { tone: 'success', text: 'Congratulations — you have been offered a place.' },
  WAITLISTED: {
    tone: 'warning',
    text: 'You are on the waiting list. If places become available, offers are made in rank order.',
  },
  ACCEPTED: { tone: 'success', text: 'You have accepted your offer. The Registrar will issue your matriculation number.' },
  ENROLLED: { tone: 'success', text: 'You are now enrolled. Sign in again to reach your student record.' },
  REJECTED: { tone: 'danger', text: 'We are unable to offer you a place on this occasion.' },
  DECLINED: { tone: 'warning', text: 'You declined this offer.' },
  EXPIRED: { tone: 'danger', text: 'This offer expired before it was accepted.' },
  WITHDRAWN: { tone: 'warning', text: 'This application was withdrawn.' },
};

export default async function PortalPage() {
  const session = await requireRole('APPLICANT');
  if (!session.pid) redirect('/forbidden');

  const applications = await db.application.findMany({
    where: { applicantId: session.pid },
    include: {
      program: { include: { department: { include: { faculty: true } } } },
      term: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();

  return (
    <>
      <PageHeader
        title="My application"
        description="Track the progress of every application you have submitted."
      />

      {applications.length === 0 ? (
        <Card>
          <EmptyState
            title="You have not submitted an application yet"
            description="Contact the admissions office if you believe this is a mistake."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {applications.map((app) => {
            const copy = STATUS_COPY[app.status] ?? {
              tone: 'info' as const,
              text: titleCase(app.status),
            };
            const liveOffer = isOfferLive(
              app.status as ApplicationStatus,
              app.offerExpiresAt,
              now,
            );

            return (
              <Card key={app.id}>
                <CardHeader
                  title={app.program.name}
                  description={`${app.program.department.faculty.name} · ${app.term.name}`}
                  actions={<Badge tone={toneForStatus(app.status)}>{titleCase(app.status)}</Badge>}
                />
                <CardBody className="space-y-4">
                  <Alert tone={copy.tone}>{copy.text}</Alert>

                  <dl>
                    <DetailRow label="Reference">
                      <span className="font-mono text-xs">{app.referenceNo}</span>
                    </DetailRow>
                    <DetailRow label="Program code">{app.program.code}</DetailRow>
                    <DetailRow label="Intake">{app.term.name}</DetailRow>
                    <DetailRow label="Submitted">
                      {app.submittedAt ? formatDateTime(app.submittedAt) : 'Not submitted'}
                    </DetailRow>
                    {app.decidedAt ? (
                      <DetailRow label="Decision issued">{formatDate(app.decidedAt)}</DetailRow>
                    ) : null}
                    {app.offerExpiresAt && app.status === 'OFFERED' ? (
                      <DetailRow label="Respond by">
                        <span className={liveOffer ? 'text-slate-900' : 'text-rose-600'}>
                          {formatDate(app.offerExpiresAt)}
                        </span>
                      </DetailRow>
                    ) : null}
                  </dl>

                  {liveOffer ? (
                    <div className="border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs text-slate-600">
                        Respond to your offer before {formatDate(app.offerExpiresAt!)}. An offer
                        that is not accepted by then lapses automatically.
                      </p>
                      <OfferResponse applicationId={app.id} />
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
