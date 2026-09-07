import type { Metadata } from 'next';

import { getTenantContext, requireTenantContext } from '@/server/tenant-context';
import { AppShell } from '@/components/shell';

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
    themeColor: ctx?.school.brandColor,
  };
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
  const { session, school } = await requireTenantContext();
  return (
    <AppShell session={session} school={school}>
      {children}
    </AppShell>
  );
}
