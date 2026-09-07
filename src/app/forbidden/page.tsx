import type { Metadata } from 'next';

import { getSession } from '@/lib/auth/session';
import { ROLE_HOME, ROLE_LABELS } from '@/lib/domain/enums';
import { LinkButton } from '@/components/ui';

export const metadata: Metadata = { title: 'Access denied' };

export default async function ForbiddenPage() {
  const session = await getSession();

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">
          403 — Forbidden
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          {session ? (
            <>
              Your account is signed in as{' '}
              <strong className="font-medium text-slate-900">
                {ROLE_LABELS[session.role]}
              </strong>
              , which doesn&apos;t include this area. If you believe this is a
              mistake, contact the Registrar&apos;s office — the attempt has been
              logged.
            </>
          ) : (
            'Your session may have expired. Sign in again to continue.'
          )}
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href={session ? ROLE_HOME[session.role] : '/login'}>
            {session ? 'Back to my home' : 'Sign in'}
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
