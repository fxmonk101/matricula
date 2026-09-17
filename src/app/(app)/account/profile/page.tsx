import type { Metadata } from 'next';

import { requireRoute } from '@/server/tenant-context';
import { loadProfile, pendingChangeFor } from '@/server/services/profile.service';
import { mailIsDeliverable } from '@/server/email';
import { confirmationRoute, maskEmail } from '@/lib/domain/profile';
import { Alert, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { AvatarForm, DetailsForm, PasswordForm } from './profile-forms';

export const metadata: Metadata = { title: 'Your account' };

/**
 * A person's own account.
 *
 * No route guard, deliberately: every member of every school has an account,
 * and editing your own name is not a privilege any role grants. The page acts
 * on the session's user id and never takes one as a parameter, so there is no
 * id to substitute to reach somebody else.
 *
 * What is NOT here matters as much as what is. A matriculation number, a staff
 * number, a department, a role and an email address are all absent, because
 * each is an assertion the INSTITUTION makes about a person. Letting the
 * subject of an assertion edit it is how a register stops being evidence — and
 * the register now signs people in against exactly those numbers.
 */
export default async function ProfilePage() {
  const { session, role, school } = await requireRoute('/account/profile');

  const [profile, pending] = await Promise.all([
    loadProfile(session.sub),
    pendingChangeFor(session.sub),
  ]);

  if (!profile) {
    return (
      <Alert tone="danger" title="Account not found">
        This session points at an account that no longer exists. Sign out and back in.
      </Alert>
    );
  }

  const confirmsByEmail = confirmationRoute(profile.email) === 'EMAIL';

  return (
    <>
      <PageHeader
        title="Your account"
        description={`Your details at ${school.shortName}. Your role and department are set by the office.`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DetailsForm
            profile={{
              firstName: profile.firstName,
              lastName: profile.lastName,
              username: profile.username,
              email: profile.email,
              phone: profile.phone,
              // A storage key is served through /files, which re-checks the
              // session and the tenant on every read.
              avatarUrl: profile.avatarKey ? `/files/${profile.avatarKey}` : null,
            }}
          />

          <PasswordForm
            confirmsByEmail={confirmsByEmail}
            maskedEmail={profile.email ? maskEmail(profile.email) : null}
            mailDeliverable={mailIsDeliverable()}
            pendingSince={pending ? pending.createdAt.toISOString() : null}
          />
        </div>

        <div className="space-y-4">
          <AvatarForm
            profile={{
              firstName: profile.firstName,
              lastName: profile.lastName,
              username: profile.username,
              email: profile.email,
              phone: profile.phone,
              avatarUrl: profile.avatarKey ? `/files/${profile.avatarKey}` : null,
            }}
          />

          <Card>
            <CardHeader
              title="Set by the school"
              description="These are the institution's record of you, not your own — ask the office to correct them."
            />
            <CardBody>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ['Role here', role],
                    ['School', school.name],
                    [
                      'Signs in with',
                      profile.username
                        ? `${profile.username}${profile.email ? ' or email' : ''}`
                        : (profile.email ?? '—'),
                    ],
                    [
                      'Last signed in',
                      profile.lastLoginAt
                        ? profile.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ')
                        : 'Never',
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-3 border-b border-slate-100 pb-2 last:border-0"
                  >
                    <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
                    <dd className="truncate text-right text-xs font-medium text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
