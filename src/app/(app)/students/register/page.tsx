import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { registrationOptions } from '@/server/services/registration.service';
import { loadEntitlement } from '@/server/services/platform.service';
import { seatUtilisation } from '@/lib/domain/provisioning';
import { can } from '@/lib/auth/rbac';
import { Alert, Meter, PageHeader } from '@/components/ui';
import { RegisterStudentForm } from './register-form';

export const metadata: Metadata = { title: 'Register a student' };

/**
 * The Bursary's registration desk.
 *
 * Reachable by FINANCE, and by OWNER and ADMIN because a school with nobody in
 * the bursary seat must still be able to operate. The REGISTRAR can open the
 * page but holds no `student:register`, so they see it read-only — separating
 * admission from fee clearance means no single office can do both.
 */
export default async function RegisterStudentPage() {
  const { schoolId, role, school } = await requireTenantRole(
    'ADMIN',
    'FINANCE',
    'REGISTRAR',
  );

  const [programmes, entitlement] = await Promise.all([
    registrationOptions(schoolId),
    loadEntitlement(schoolId),
  ]);

  const mayRegister = can(role, 'student:register');
  const seats = entitlement
    ? seatUtilisation(entitlement.usage.students, entitlement.limits.maxStudents)
    : 0;
  const atLimit =
    entitlement?.limits.maxStudents !== null &&
    entitlement !== null &&
    entitlement.usage.students >= (entitlement.limits.maxStudents ?? Infinity);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/students" className="hover:underline">
            ← Students
          </Link>
        }
        title="Register a student"
        description={`Admit a person as a student of ${school.shortName}. For applicants who came through admissions, convert their accepted offer instead — that carries their application across.`}
        actions={
          entitlement && entitlement.limits.maxStudents !== null ? (
            <div className="w-44">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] text-slate-500">Student places</span>
                <span className="text-xs font-medium tabular-nums text-slate-900">
                  {entitlement.usage.students} / {entitlement.limits.maxStudents}
                </span>
              </div>
              <Meter value={seats} tone={seats >= 90 ? 'danger' : seats >= 70 ? 'warning' : 'brand'} />
            </div>
          ) : null
        }
      />

      {!mayRegister && (
        <Alert tone="info" title="This is the Bursary's desk" className="mb-4">
          Your role can see this page but not register a student. In this system registration
          completes where the fees are settled, so the office that confirms the payment is the one
          that issues the matriculation number.
        </Alert>
      )}

      {atLimit && (
        <Alert tone="danger" title="No student places left on this plan" className="mb-4">
          Every place this institution is licensed for is in use. The platform operator can raise
          the limit or move the school to a larger plan.
        </Alert>
      )}

      {mayRegister && !atLimit ? (
        <div className="max-w-3xl">
          <RegisterStudentForm programmes={programmes} />
        </div>
      ) : null}
    </>
  );
}
