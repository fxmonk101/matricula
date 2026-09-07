import { requireSession } from '@/lib/auth/session';
import { AppShell } from '@/components/shell';

/**
 * Every authenticated page hangs off this layout, so the session check happens
 * exactly once per request tree rather than being repeated (and eventually
 * forgotten) in each page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
