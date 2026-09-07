import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { listAudit } from '@/server/services/audit.service';
import { formatDateTime, titleCase } from '@/lib/utils';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage() {
  await requireRole('ADMIN');

  const entries = await listAudit(200);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every state-changing operation, attributed to the officer who performed it."
      />

      <Alert tone="info" className="mb-4">
        Entries are never updated or deleted. If an operation was wrong, the correction appears as a
        new entry — the original stays. That is what makes the log evidence rather than a summary.
      </Alert>

      <Card>
        <CardHeader
          title="Recent activity"
          description={`Showing the ${entries.length} most recent entries.`}
        />
        {entries.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <Table className="table-zebra">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Summary</Th>
                <Th>Actor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                    {formatDateTime(entry.createdAt)}
                  </Td>
                  <Td>
                    <code className="font-mono text-[11px] text-brand-700">{entry.action}</code>
                  </Td>
                  <Td className="text-xs">
                    {entry.entityType}
                    <div className="font-mono text-[11px] text-slate-400">
                      {entry.entityId.slice(0, 12)}…
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-700">{entry.summary}</Td>
                  <Td className="text-xs">
                    {entry.actor ? (
                      <>
                        {entry.actor.firstName} {entry.actor.lastName}
                        <div className="mt-0.5">
                          <Badge tone="neutral">{titleCase(entry.actor.role)}</Badge>
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">system</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
