import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { GRADING_PRESETS } from '@/lib/domain/config';
import { ACADEMIC_MODEL_LABELS, type AcademicModel } from '@/lib/domain/enums';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  AdmissionsForm,
  AttendanceForm,
  BrandingForm,
  EnrollmentForm,
  GradingForm,
} from './forms';

export const metadata: Metadata = { title: 'School setup' };

const TABS = [
  { key: 'grading', label: 'Grading' },
  { key: 'enrolment', label: 'Enrolment rules' },
  { key: 'admissions', label: 'Admissions rubric' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'branding', label: 'Branding' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function SchoolSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { school, config } = await requireTenantRole('ADMIN');
  const { tab } = await searchParams;
  const active: TabKey = (TABS.find((t) => t.key === tab)?.key ?? 'grading') as TabKey;

  return (
    <>
      <PageHeader
        title="School setup"
        description={`${school.name} · ${ACADEMIC_MODEL_LABELS[school.academicModel as AcademicModel]} · ${config.finance.currency.code}`}
      />

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
            {TABS.map((t) => (
              <li key={t.key}>
                <Link
                  href={`/settings/school?tab=${t.key}`}
                  aria-current={active === t.key ? 'page' : undefined}
                  className={cn(
                    'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active === t.key
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>

          <Card className="mt-4 hidden p-3 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Applies to
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Everything here is scoped to {school.shortName}. No other school on the platform is
              affected.
            </p>
          </Card>
        </nav>

        <div className="min-w-0">
          {active === 'grading' ? (
            <Card>
              <CardHeader
                title="Grading scheme"
                description="How scores become grades here. Every GPA, transcript and academic standing is computed from these bands."
              />
              <CardBody>
                <GradingForm
                  config={config.grading}
                  presets={Object.entries(GRADING_PRESETS).map(([key, p]) => ({
                    key,
                    label: p.label,
                    detail: p.detail,
                  }))}
                />
              </CardBody>
            </Card>
          ) : null}

          {active === 'enrolment' ? (
            <Card>
              <CardHeader
                title="Enrolment rules"
                description="Credit ceilings and the balance a student may carry and still register."
              />
              <CardBody>
                <EnrollmentForm
                  config={config.enrollment}
                  currencySymbol={config.finance.currency.symbol}
                />
              </CardBody>
            </Card>
          ) : null}

          {active === 'admissions' ? (
            <Card>
              <CardHeader
                title="Admissions rubric"
                description="Component weights must total 1.00 — they are renormalised over whichever components an application actually has, so a set that does not total 1 would rescale every composite."
              />
              <CardBody>
                <AdmissionsForm config={config.admissions} />
              </CardBody>
            </Card>
          ) : null}

          {active === 'attendance' ? (
            <Card>
              <CardHeader
                title="Attendance"
                description="How much of a course a student must attend to sit its examination, and whether that rule is enforced."
              />
              <CardBody>
                <AttendanceForm config={config.attendance} />
              </CardBody>
            </Card>
          ) : null}

          {active === 'branding' ? (
            <Card>
              <CardHeader
                title="Branding"
                description="The name, short name and colour used across this school's portal and public pages."
              />
              <CardBody>
                <BrandingForm config={config.branding} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
