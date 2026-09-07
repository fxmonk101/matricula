import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { ROLE_HOME } from '@/lib/domain/enums';

/**
 * The root is a pure router: signed-in users go to their role's home, everyone
 * else to the sign-in page. Keeping this decision in one place means no other
 * page has to reason about "where does this person belong".
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? ROLE_HOME[session.role] : '/login');
}
