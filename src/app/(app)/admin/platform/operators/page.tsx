import type { Metadata } from 'next';
import Link from 'next/link';

import { requirePlatformAdmin } from '@/lib/auth/session';
import { platformDb } from '@/lib/tenant';
import { listPlatformAudit } from '@/server/services/audit.service';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { OperatorControls } from './operator-controls';
import { like } from '@/lib/search-filter';

export const metadata: Metadata = { title: 'Platform — operators' };

export default async function OperatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePlatformAdmin();
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const [operators, audit] = await Promise.all([
    platformDb.platformAdmin.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // The cross-tenant trail. This is the one place it is read: an operator
    // acting on many schools leaves entries under each, and only this view
    // shows them as one sequence.
    listPlatformAudit(60),
  ]);

  // Searched rather than listed. An installation with thousands of accounts
  // must not render all of them into a dropdown just to grant one person a
  // permission that is granted a handful of times in the system's life.
  const candidates = query
    ? await platformDb.user.findMany({
        where: {
          OR: [
            { email: like(query) },
            { firstName: like(query) },
            { lastName: like(query) },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true },
        take: 10,
      })
    : [];

  const operatorIds = new Set(operators.map((o) => o.userId));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/platform" className="hover:underline">← All schools</Link>}
        title="Platform operators"
        description="Who can provision, suspend and bill schools. This is not a role — no school can grant it, and it reaches every school's data at once."
      />

      <Alert tone="warning" className="mb-4">
        Revoking takes effect on the operator&rsquo;s next page load, not when their session
        expires: the grant is re-read from the database on every platform page rather than trusted
        from their sign-in token. The last remaining operator cannot be revoked — there would be no
        way back in short of a database console.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Operators" description={`${operators.length} with platform access.`} />
            {operators.length === 0 ? (
              <EmptyState title="No operators" />
            ) : (
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Last signed in</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operators.map((op) => (
                    <tr key={op.id}>
                      <Td className="text-sm text-slate-900">{fullName(op.user)}</Td>
                      <Td className="text-xs text-slate-600">{op.user.email}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {op.user.lastLoginAt ? formatDate(op.user.lastLoginAt) : 'never'}
                      </Td>
                      <Td className="text-right">
                        <OperatorControls
                          userId={op.userId}
                          label={op.user.email}
                          grant={false}
                          soleOperator={operators.length <= 1}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Cross-tenant activity"
              description="Every operator action, across every school, in one sequence."
            />
            {audit.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {audit.map((entry) => (
                  <li key={entry.id} className="px-5 py-2.5">
                    <p className="text-xs text-slate-700">{entry.summary}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      <code className="font-mono">{entry.action}</code> ·{' '}
                      {formatDateTime(entry.createdAt)}
                      {entry.actor ? ` · ${fullName(entry.actor)}` : ' · system'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Grant access"
            description="Search for an existing account. Platform access is given to a person, never to a school."
          />
          <div className="space-y-3 px-5 py-4">
            <form method="get" className="flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Name or email"
                className="block h-9 w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 shadow-xs ring-1 ring-inset ring-slate-300 placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="h-9 shrink-0 rounded-lg bg-brand-600 px-4 text-sm font-medium text-onAccent hover:bg-brand-700"
              >
                Search
              </button>
            </form>

            {query && candidates.length === 0 && (
              <p className="text-xs text-slate-500">No account matches “{query}”.</p>
            )}

            <ul className="divide-y divide-slate-100">
              {candidates.map((user) => (
                <li key={user.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800">{fullName(user)}</p>
                    <p className="truncate text-[11px] text-slate-500">{user.email}</p>
                  </div>
                  {operatorIds.has(user.id) ? (
                    <span className="shrink-0 text-[11px] text-slate-400">already an operator</span>
                  ) : (
                    <OperatorControls userId={user.id} label={user.email} grant soleOperator={false} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
