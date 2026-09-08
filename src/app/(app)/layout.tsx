import type { Metadata, Viewport } from 'next';

import { getTenantContext, requireTenantContext } from '@/server/tenant-context';
import { AppShell } from '@/components/shell';
import { listNotifications, unreadCount } from '@/server/services/notification.service';

/**
 * The signed-in title template, resolved per tenant. Without this the browser
 * tab would carry whichever school the deployment was configured for rather
 * than the one the user is actually in — a small leak, but a leak.
 */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getTenantContext();
  return {
    title: {
      default: ctx?.school.name ?? 'Portal',
      template: `%s · ${ctx?.school.shortName ?? 'Portal'}`,
    },
  };
}

/**
 * `themeColor` moved out of `metadata` in Next.js 15 — leaving it there logs a
 * deprecation on every render and, more to the point, stops being applied.
 * It is per-tenant, so it belongs in `generateViewport` rather than a static
 * export: the browser chrome should carry the colour of the school the user is
 * actually signed in to.
 */
export async function generateViewport(): Promise<Viewport> {
  const ctx = await getTenantContext();
  return { themeColor: ctx?.school.brandColor };
}

/**
 * Every authenticated page hangs off this layout, so the session AND the tenant
 * are resolved exactly once per request tree rather than being repeated (and
 * eventually forgotten) in each page.
 *
 * `getTenantContext` is React-cached, so the pages below re-reading it — and
 * `generateMetadata` above — cost nothing extra.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, school, schoolId, membershipId } = await requireTenantContext();

  // Both queries are scoped to the signed-in membership, so the bell is
  // per-person AND per-school by construction: the professor who holds a post
  // at two institutions sees only the notifications for the one they are
  // currently signed in to.
  const [notifications, unread] = await Promise.all([
    listNotifications(schoolId, membershipId, 8),
    unreadCount(schoolId, membershipId),
  ]);

  return (
    <AppShell
      session={session}
      school={school}
      notifications={notifications}
      unreadCount={unread}
    >
      {children}
    </AppShell>
  );
}
