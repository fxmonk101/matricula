import type { Metadata } from 'next';
import Link from 'next/link';

import { requireSession } from '@/lib/auth/session';
import { platformDb } from '@/lib/tenant';
import { ROLE_HOME } from '@/lib/domain/enums';
import { PasswordForm } from './password-form';

export const metadata: Metadata = { title: 'Set your password' };

/**
 * Set your own password.
 *
 * Deliberately OUTSIDE the `(app)` layout, so it has no sidebar. When the visit
 * is forced there is nowhere else to go, and rendering a full navigation the
 * user would be bounced back from on every click is worse than rendering none.
 */
export default async function PasswordPage() {
  const session = await requireSession();

  const user = await platformDb.user.findUnique({
    where: { id: session.sub },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      mustChangePassword: true,
      memberships: {
        where: { schoolId: session.sch },
        select: { school: { select: { name: true, brandColor: true, code: true } } },
        take: 1,
      },
    },
  });

  // A signature-valid token for a user who no longer exists. /session/end
  // clears the cookie and explains, rather than throwing on a null below.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-600">
          Your session has ended.{' '}
          <Link href="/session/end" className="font-medium text-brand-700 hover:underline">
            Sign in again
          </Link>
        </p>
      </div>
    );
  }

  const forced = user.mustChangePassword;
  const school = user.memberships[0]?.school;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {school && (
          <div className="mb-6 flex items-center gap-3">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-[11px] font-bold text-onAccent"
              style={{ backgroundColor: school.brandColor }}
            >
              {school.code.slice(0, 3)}
            </span>
            <span className="text-sm font-medium text-slate-700">{school.name}</span>
          </div>
        )}

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {forced ? 'Set your own password' : 'Change your password'}
        </h1>

        {forced ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
            <p className="font-semibold">You are signed in with a one-time password</p>
            <p className="mt-0.5">
              Somebody read it to you or handed it to you on a slip, so it is not a secret. Choose
              your own before you go any further — nothing else is available until you do.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            You will stay signed in on this device.
          </p>
        )}

        <div className="mt-6">
          <PasswordForm
            forced={forced}
            person={{
              email: user.email ?? undefined,
              firstName: user.firstName,
              lastName: user.lastName,
            }}
          />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          {forced ? (
            <>
              Not you, or on the wrong machine?{' '}
              <Link href="/session/end" className="font-medium text-brand-700 hover:underline">
                Sign out
              </Link>
            </>
          ) : (
            <Link href={ROLE_HOME[session.role]} className="font-medium text-brand-700 hover:underline">
              ← Back to the portal
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
