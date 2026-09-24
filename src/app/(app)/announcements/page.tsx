import type { Metadata } from 'next';

import {
  SEVERITY_LABELS,
  describeAudience,
  isLive,
  type AnnouncementSeverity,
} from '@/lib/domain/announcement';
import { can } from '@/lib/auth/rbac';
import type { Role } from '@/lib/domain/enums';
import { requireTenantRole } from '@/server/tenant-context';
import {
  allAnnouncements,
  liveAnnouncementsFor,
} from '@/server/services/announcement.service';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { Composer } from './composer';
import { WithdrawButton } from './withdraw-button';

export const metadata: Metadata = { title: 'Announcements' };

const TONE: Record<AnnouncementSeverity, 'info' | 'warning' | 'danger'> = {
  INFO: 'info',
  WARNING: 'warning',
  URGENT: 'danger',
};

/**
 * Announcements — writing them, and reading them.
 *
 * One page for both audiences. Somebody who may post sees the composer and the
 * full history; everybody else sees the notices addressed to them. Splitting it
 * would mean two routes that answer the same question differently.
 */
export default async function AnnouncementsPage() {
  const { db, schoolId, role } = await requireTenantRole(
    'OWNER',
    'ADMIN',
    'REGISTRAR',
    'DEAN',
    'HOD',
    'FINANCE',
    'ADMISSIONS',
    'INSTRUCTOR',
    'LIBRARIAN',
    'STAFF',
    'STUDENT',
    'GUARDIAN',
  );

  const mayPost = can(role, 'announcement:write');
  const now = new Date();

  const [mine, history, members] = await Promise.all([
    liveAnnouncementsFor({ schoolId, role: role as Role, now, limit: 20 }),
    mayPost ? allAnnouncements({ schoolId }) : Promise.resolve([]),
    mayPost
      ? db.membership.groupBy({ by: ['role'], where: { status: 'ACTIVE' }, _count: true })
      : Promise.resolve([]),
  ]);

  const counts: Record<string, number> = {};
  for (const row of members) counts[row.role] = row._count;

  return (
    <>
      <PageHeader
        title="Announcements"
        description={
          mayPost
            ? 'Notices that reach everybody at the school, by bell and by email.'
            : 'Notices from the school office.'
        }
      />

      {mayPost && (
        <div className="mb-4">
          <Composer counts={counts} />
        </div>
      )}

      <Card>
        <CardHeader
          title={mayPost ? 'Live now' : 'For you'}
          description={mayPost ? 'What people can currently see.' : undefined}
        />
        <CardBody>
          {mine.length === 0 ? (
            <EmptyState
              title="Nothing right now"
              description="Announcements from the school office appear here."
            />
          ) : (
            <ul className="space-y-3">
              {mine.map((announcement) => (
                <li key={announcement.id}>
                  <Alert
                    tone={TONE[announcement.severity as AnnouncementSeverity] ?? 'info'}
                    title={announcement.title}
                  >
                    <p className="whitespace-pre-wrap">{announcement.body}</p>
                    <p className="mt-2 text-[11px] opacity-75">
                      {announcement.publishedAt.toISOString().slice(0, 10)}
                      {mayPost ? ` · ${describeAudience(announcement.audience)}` : ''}
                    </p>
                  </Alert>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {mayPost && history.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Everything posted"
            description="Withdrawn notices are kept — people acted on them, so “it was never posted” is not a true answer later."
          />
          <CardBody>
            <ul className="divide-y divide-slate-100">
              {history.map((announcement) => {
                const live = isLive(announcement, now);
                return (
                  <li key={announcement.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">
                        {announcement.title}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {SEVERITY_LABELS[announcement.severity as AnnouncementSeverity] ??
                          announcement.severity}
                        {' · '}
                        {describeAudience(announcement.audience)}
                        {' · '}
                        {announcement.publishedAt.toISOString().slice(0, 10)}
                      </span>
                    </span>

                    <Badge tone={live ? 'success' : 'neutral'}>{live ? 'Live' : 'Ended'}</Badge>

                    {live && <WithdrawButton announcementId={announcement.id} />}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
