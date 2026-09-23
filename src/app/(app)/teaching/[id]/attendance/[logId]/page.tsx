import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { loadRegister } from '@/server/services/attendance.service';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui';
import { RegisterPanel } from './register-panel';

export const metadata: Metadata = { title: 'Register' };

function clock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * One session's register.
 *
 * `loadRegister` returns null both for a session that does not exist and for
 * one this lecturer may not see, and this page turns both into the same 404.
 * Distinguishing them would tell somebody probing ids which of their guesses
 * were real.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ id: string; logId: string }>;
}) {
  const { schoolId, session, role, config } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId, logId } = await params;

  const view = await loadRegister({
    schoolId,
    teachingLogId: logId,
    actorRole: role,
    actorInstructorProfileId: session.pid,
  });

  if (!view || view.offeringId !== offeringId) notFound();

  return (
    <>
      <PageHeader
        title="Register"
        description={`${view.offeringLabel} · ${view.localDate}, ${clock(view.startMinute)}–${clock(view.endMinute)}`}
        actions={
          <Link
            href={`/teaching/${offeringId}/attendance`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← All attendance
          </Link>
        }
      />

      {!view.acceptsRegister ? (
        <Card>
          <EmptyState
            title="This class was not delivered"
            description={
              view.sessionStatus === 'CANCELLED'
                ? 'A cancelled class takes no register. Nobody was absent from a lecture that did not happen.'
                : 'A moved class takes no register. Mark the session it moved to instead.'
            }
          />
        </Card>
      ) : view.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nobody is registered on this section"
            description="Once students register for the course they appear on the register."
          />
        </Card>
      ) : (
        <>
          {!config.attendance.enforced && (
            <Alert tone="info" className="mb-4">
              Attendance is being recorded but not enforced — no student is barred from an
              examination on it yet.
            </Alert>
          )}

          <RegisterPanel
            offeringId={offeringId}
            teachingLogId={view.teachingLogId}
            localDate={view.localDate}
            rows={view.rows}
            alreadyTaken={view.alreadyTaken}
            threshold={config.attendance.examEligibilityThreshold}
          />
        </>
      )}
    </>
  );
}
