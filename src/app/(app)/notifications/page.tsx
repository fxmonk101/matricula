import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantContext } from '@/server/tenant-context';
import { listNotifications } from '@/server/services/notification.service';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, type BadgeTone } from '@/components/ui';
import { markAllReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

const KIND: Record<string, { label: string; tone: BadgeTone }> = {
  TASK_ASSIGNED: { label: 'Assigned', tone: 'brand' },
  TASK_DUE_SOON: { label: 'Due soon', tone: 'warning' },
  TASK_OVERDUE: { label: 'Overdue', tone: 'danger' },
  TASK_ESCALATED: { label: 'Escalated', tone: 'danger' },
  TASK_COMMENTED: { label: 'Comment', tone: 'neutral' },
  TASK_COMPLETED: { label: 'Completed', tone: 'success' },
  GRADES_POSTED: { label: 'Grades', tone: 'info' },
  APPLICATION_DECIDED: { label: 'Admissions', tone: 'info' },
  INVOICE_ISSUED: { label: 'Finance', tone: 'info' },
  ANNOUNCEMENT: { label: 'Announcement', tone: 'neutral' },
  MEETING_SCHEDULED: { label: 'Live class', tone: 'brand' },
  HOLD_PLACED: { label: 'Hold', tone: 'danger' },
  HOLD_RELEASED: { label: 'Hold lifted', tone: 'success' },
  REGISTRATION_OPEN: { label: 'Registration', tone: 'brand' },
};

export default async function NotificationsPage() {
  const { schoolId, membershipId, school } = await requireTenantContext();
  const items = await listNotifications(schoolId, membershipId, 100);
  const unread = items.filter((n) => n.readAt === null).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`Everything ${school.shortName} has told you, newest first.`}
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit" size="sm" variant="secondary">
                Mark all {unread} read
              </Button>
            </form>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="Inbox"
          description="Each entry is a record of what was said at the time it was sent — it is not re-derived later, so it cannot quietly change."
        />
        {items.length === 0 ? (
          <EmptyState
            title="Nothing yet"
            description="Task assignments, deadlines and comments will appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
              const meta = KIND[n.kind] ?? { label: n.kind, tone: 'neutral' as BadgeTone };
              const inner = (
                <div className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={
                      n.readAt
                        ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-200'
                        : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600'
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className={n.readAt ? 'text-sm text-slate-600' : 'text-sm font-medium text-slate-900'}>
                      {n.title}
                    </p>
                    {n.body ? <p className="mt-0.5 text-xs text-slate-500">{n.body}</p> : null}
                    <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
              );

              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} className="block hover:bg-slate-50">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
