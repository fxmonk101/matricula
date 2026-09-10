import type { Metadata } from 'next';

import { getSession } from '@/lib/auth/session';
import { ROLE_HOME } from '@/lib/domain/enums';
import { redirect } from 'next/navigation';
import { Landing } from './(marketing)/landing';

export const metadata: Metadata = {
  title: 'School Portal — one record for every student',
  description:
    'Admissions, registration, assessment and the bursary on a single authoritative record. Built for government and private universities.',
};

/**
 * The root.
 *
 * A signed-in person is sent to their own home — they have no use for the
 * marketing page and bouncing them through it would be an extra click on every
 * visit. Everybody else gets the landing page.
 *
 * The redirect stays FIRST, and stays a redirect rather than a conditional
 * render, so a signed-in user never has the public page in their history to
 * navigate back into.
 */
export default async function RootPage() {
  const session = await getSession();
  if (session) redirect(ROLE_HOME[session.role]);

  return <Landing />;
}
