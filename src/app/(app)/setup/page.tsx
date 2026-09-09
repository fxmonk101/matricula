import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { evaluateSetup } from '@/server/services/setup.service';
import { nextStep } from '@/lib/domain/setup';
import { Alert, Badge, Card, CardHeader, Meter, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Set up your school' };

/**
 * The readiness checklist for a newly provisioned school.
 *
 * Every step is derived from real rows rather than from a stored "step 3
 * complete" flag, so it cannot tell a school its terms are configured while it
 * has none. Each step links to the real page; nothing here is a second
 * implementation of a form that exists elsewhere.
 */
export default async function SetupPage() {
  const { schoolId, school } = await requireTenantRole('ADMIN');
  const { steps, progress } = await evaluateSetup(schoolId, school.academicModel);
  const next = nextStep(steps);
  const complete = progress === 100;

  return (
    <>
      <PageHeader
        eyebrow={school.name}
        title={complete ? 'Your school is set up' : 'Set up your school'}
        description={
          complete
            ? 'Everything essential is in place. The optional steps below are worth doing before your first invoice run.'
            : 'In this order, because each step needs the one before it. A school that starts with pupils gets three steps in and finds it cannot finish.'
        }
        actions={
          <div className="w-40">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] text-slate-500">Progress</span>
              <span className="text-xs font-medium tabular-nums text-slate-900">{progress}%</span>
            </div>
            <Meter value={progress} tone={complete ? 'success' : 'brand'} />
          </div>
        }
      />

      {school.status === 'PROVISIONING' && (
        <Alert tone="warning" title="Only you can sign in at the moment" className="mb-4">
          Your school stays closed to staff and students until the vendor opens it. That is
          deliberate — nobody should be invited into a school with no terms and no grading scheme.
          Finish the required steps below and ask your platform contact to open it.
        </Alert>
      )}

      {next && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Next</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">{next.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{next.description}</p>
            </div>
            <Link
              href={next.href}
              className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-onAccent hover:bg-brand-700"
            >
              {next.title} →
            </Link>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Checklist"
          description="Read from your school's own records, not from a saved progress flag — so deleting something puts its step back."
        />
        <ol className="divide-y divide-slate-100">
          {steps.map((step, index) => (
            <li key={`${step.id}-${step.href}`} className="flex items-start gap-4 px-5 py-4">
              <span
                className={[
                  'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  step.done
                    ? 'bg-emerald-100 text-emerald-700'
                    : step.available
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-400',
                ].join(' ')}
                aria-hidden
              >
                {step.done ? '✓' : index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      step.done
                        ? 'text-sm font-medium text-slate-500 line-through decoration-slate-300'
                        : 'text-sm font-medium text-slate-900'
                    }
                  >
                    {step.title}
                  </span>
                  {step.optional && <Badge tone="neutral">Optional</Badge>}
                  {step.detail && (
                    <span className="text-[11px] text-slate-500">{step.detail}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{step.description}</p>
              </div>

              <div className="shrink-0 self-center">
                {step.available ? (
                  <Link
                    href={step.href}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    {step.done ? 'Review' : 'Open'}
                  </Link>
                ) : (
                  <span
                    className="text-[11px] text-slate-400"
                    title="An earlier step has to be done first — this one would dead-end."
                  >
                    Blocked
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        You can leave and come back — nothing here is a wizard you have to finish in one sitting.
      </p>
    </>
  );
}
