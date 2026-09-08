'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Badge, Button, Field, Input, Table, Td, Th } from '@/components/ui';
import { scoreToGrade } from '@/lib/domain/grading';
import type {
  AdmissionsConfig,
  BrandingConfig,
  EnrollmentPolicy,
  GradeBand,
  GradingConfig,
} from '@/lib/domain/config';
import {
  saveAdmissionsAction,
  saveBrandingAction,
  saveEnrollmentAction,
  saveGradingAction,
  type SettingsState,
} from './actions';

function Save({ label = 'Save changes' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function Result({ state }: { state: SettingsState }) {
  if (!state.message) return null;
  return (
    <Alert tone={state.ok ? 'success' : 'danger'} className="mb-4">
      {state.message}
    </Alert>
  );
}

// -----------------------------------------------------------------------------
// Grading
// -----------------------------------------------------------------------------

export function GradingForm({
  config,
  presets,
}: {
  config: GradingConfig;
  presets: { key: string; label: string; detail: string }[];
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveGradingAction, {});
  const [bands, setBands] = useState<GradeBand[]>(config.scale);
  const [ca, setCa] = useState(config.assessmentWeights.ca);
  const [exam, setExam] = useState(config.assessmentWeights.exam);
  const [probe, setProbe] = useState(68.5);

  const setBand = (i: number, patch: Partial<GradeBand>) =>
    setBands((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  /**
   * Contiguity is checked here as you type using the same rule the server
   * enforces on save. The server is still the authority — this only means you
   * find out before submitting rather than after.
   */
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const issues: string[] = [];
  if (sorted.length > 0) {
    if (sorted[0].min !== 0) issues.push('The scale must start at 0.');
    if (sorted[sorted.length - 1].max !== 100) issues.push('The scale must end at 100.');
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].min - sorted[i - 1].max;
      if (gap > 0.001) {
        issues.push(`Gap between ${sorted[i - 1].letter} and ${sorted[i].letter} — scores in between map to no grade.`);
      } else if (gap < -0.001) {
        issues.push(`${sorted[i - 1].letter} and ${sorted[i].letter} overlap.`);
      }
    }
  }
  if (Math.abs(ca + exam - 100) > 1e-9) {
    issues.push(`Continuous assessment and examination total ${ca + exam}, not 100.`);
  }

  let preview: { letter: string; point: number; description: string } | null = null;
  if (issues.length === 0) {
    try {
      preview = scoreToGrade(probe, bands);
    } catch {
      preview = null;
    }
  }

  return (
    <>
      <Result state={state} />

      {/* Presets post on their own so applying one is a single, explicit act. */}
      <form action={action} className="mb-6">
        <p className="mb-2 text-xs font-medium text-slate-700">Start from a published scheme</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.key}
              type="submit"
              name="preset"
              value={p.key}
              className="rounded-lg bg-white px-3 py-2 text-left shadow-sm ring-1 ring-slate-300 transition-colors hover:ring-brand-400"
            >
              <span className="block text-xs font-semibold text-slate-900">{p.label}</span>
              <span className="block text-[11px] text-slate-500">{p.detail}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Applying a preset replaces the bands below and recomputes every student&apos;s record.
        </p>
      </form>

      <form action={action} className="space-y-5">
        <input type="hidden" name="scale" value={JSON.stringify(bands)} />
        <input type="hidden" name="maxGradePoint" value={Math.max(...bands.map((b) => b.point), 0)} />
        <input type="hidden" name="passingGradePoint" value={config.passingGradePoint} />
        <input type="hidden" name="deansList" value={config.standing.deansList} />
        <input type="hidden" name="good" value={config.standing.good} />
        <input type="hidden" name="warning" value={config.standing.warning} />
        <input type="hidden" name="probation" value={config.standing.probation} />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700">Grade bands</p>
            {issues.length === 0 ? (
              <Badge tone="success">Contiguous</Badge>
            ) : (
              <Badge tone="danger">{issues.length} problem{issues.length === 1 ? '' : 's'}</Badge>
            )}
          </div>

          <div className="rounded-lg border border-slate-200">
            <Table>
              <thead>
                <tr>
                  <Th className="w-24">From</Th>
                  <Th className="w-24">To</Th>
                  <Th className="w-20">Letter</Th>
                  <Th className="w-24">Points</Th>
                  <Th>Description</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bands.map((b, i) => (
                  <tr key={i}>
                    <Td className="py-1.5">
                      <Input
                        type="number" step="0.01" min={0} max={100} value={b.min}
                        onChange={(e) => setBand(i, { min: Number(e.target.value) })}
                        className="text-right tabular-nums"
                        aria-label={`Lower bound for ${b.letter}`}
                      />
                    </Td>
                    <Td className="py-1.5">
                      <Input
                        type="number" step="0.000001" min={0} max={100} value={b.max}
                        onChange={(e) => setBand(i, { max: Number(e.target.value) })}
                        className="text-right tabular-nums"
                        aria-label={`Upper bound for ${b.letter}`}
                      />
                    </Td>
                    <Td className="py-1.5">
                      <Input
                        value={b.letter} maxLength={4}
                        onChange={(e) => setBand(i, { letter: e.target.value })}
                        className="text-center font-semibold"
                        aria-label={`Letter for band ${i + 1}`}
                      />
                    </Td>
                    <Td className="py-1.5">
                      <Input
                        type="number" step="0.01" min={0} value={b.point}
                        onChange={(e) => setBand(i, { point: Number(e.target.value) })}
                        className="text-right tabular-nums"
                        aria-label={`Grade point for ${b.letter}`}
                      />
                    </Td>
                    <Td className="py-1.5">
                      <Input
                        value={b.description} maxLength={60}
                        onChange={(e) => setBand(i, { description: e.target.value })}
                        aria-label={`Description for ${b.letter}`}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {issues.length > 0 ? (
            <Alert tone="danger" className="mt-3">
              <ul className="list-disc space-y-0.5 pl-4">
                {issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Continuous assessment (max)" htmlFor="ca" hint="Must total 100 with the examination">
            <Input
              id="ca" name="ca" type="number" min={0} max={100} value={ca}
              onChange={(e) => setCa(Number(e.target.value))}
              className="tabular-nums"
            />
          </Field>
          <Field label="Examination (max)" htmlFor="exam">
            <Input
              id="exam" name="exam" type="number" min={0} max={100} value={exam}
              onChange={(e) => setExam(Number(e.target.value))}
              className="tabular-nums"
            />
          </Field>
        </div>

        {/* A live check against the bands above, using the same function the
            server uses to grade — so what you see here is what students get. */}
        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <p className="mb-2 text-xs font-medium text-slate-700">Check a score</p>
          <div className="flex items-center gap-3">
            <Input
              type="number" min={0} max={100} step="0.1" value={probe}
              onChange={(e) => setProbe(Number(e.target.value))}
              className="w-24 text-right tabular-nums"
              aria-label="Score to check"
            />
            <span className="text-slate-400">→</span>
            {preview ? (
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-base font-bold text-brand-700">
                  {preview.letter}
                </span>
                <div>
                  <div className="text-sm font-semibold tabular-nums">
                    {preview.point.toFixed(2)} points
                  </div>
                  <div className="text-xs text-slate-500">{preview.description}</div>
                </div>
              </div>
            ) : (
              <span className="text-sm text-slate-500">Fix the bands above to preview.</span>
            )}
          </div>
        </div>

        <Alert tone="warning">
          Saving recomputes every student&apos;s GPA and academic standing against the new bands.
          Grades are stored as points, so a scale change is retrospective — leaving the records
          alone would publish a CGPA that no longer matches the published scale.
        </Alert>

        <Save label="Save and recompute" />
      </form>
    </>
  );
}

// -----------------------------------------------------------------------------
// Enrolment
// -----------------------------------------------------------------------------

export function EnrollmentForm({
  config,
  currencySymbol,
}: {
  config: EnrollmentPolicy;
  currencySymbol: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveEnrollmentAction, {});

  return (
    <form action={action} className="space-y-4">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum credits per term" htmlFor="minCreditsPerTerm" hint="Below this a student is part-time">
          <Input id="minCreditsPerTerm" name="minCreditsPerTerm" type="number" min={0} max={60}
            defaultValue={config.minCreditsPerTerm} className="tabular-nums" />
        </Field>
        <Field label="Maximum credits per term" htmlFor="maxCreditsPerTerm">
          <Input id="maxCreditsPerTerm" name="maxCreditsPerTerm" type="number" min={1} max={60}
            defaultValue={config.maxCreditsPerTerm} className="tabular-nums" />
        </Field>
        <Field label="Overload ceiling" htmlFor="maxCreditsWithOverloadApproval" hint="With registrar approval">
          <Input id="maxCreditsWithOverloadApproval" name="maxCreditsWithOverloadApproval"
            type="number" min={1} max={80} defaultValue={config.maxCreditsWithOverloadApproval}
            className="tabular-nums" />
        </Field>
        <Field label="Minimum CGPA to request an overload" htmlFor="overloadMinCgpa">
          <Input id="overloadMinCgpa" name="overloadMinCgpa" type="number" step="0.01" min={0}
            defaultValue={config.overloadMinCgpa} className="tabular-nums" />
        </Field>
        <Field
          label={`Balance tolerated at registration (${currencySymbol}, minor units)`}
          htmlFor="outstandingBalanceToleranceMinor"
          hint="0 means any outstanding balance blocks registration"
          className="sm:col-span-2"
        >
          <Input id="outstandingBalanceToleranceMinor" name="outstandingBalanceToleranceMinor"
            type="number" min={0} defaultValue={config.outstandingBalanceToleranceMinor}
            className="tabular-nums" />
        </Field>
      </div>

      <Save />
    </form>
  );
}

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

const WEIGHT_FIELDS = [
  ['priorGpa', 'Prior academic performance'],
  ['entranceExam', 'Entrance examination'],
  ['essay', 'Personal statement'],
  ['interview', 'Interview'],
  ['extracurricular', 'Extracurricular record'],
] as const;

export function AdmissionsForm({ config }: { config: AdmissionsConfig }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveAdmissionsAction, {});
  const [weights, setWeights] = useState(config.weights);

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const balanced = Math.abs(total - 1) < 1e-9;

  return (
    <form action={action} className="space-y-5">
      <Result state={state} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-700">Component weights</p>
          <Badge tone={balanced ? 'success' : 'danger'}>
            Total {total.toFixed(2)}
          </Badge>
        </div>

        <div className="space-y-3">
          {WEIGHT_FIELDS.map(([key, label]) => (
            <div key={key} className="flex items-center gap-3">
              <label htmlFor={key} className="w-56 shrink-0 text-sm text-slate-700">
                {label}
              </label>
              <div className="h-1.5 flex-grow overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.min(100, weights[key] * 100)}%` }}
                />
              </div>
              <Input
                id={key}
                name={key}
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={weights[key]}
                onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
                className="w-24 text-right tabular-nums"
              />
            </div>
          ))}
        </div>

        {!balanced ? (
          <Alert tone="danger" className="mt-3">
            Weights total {total.toFixed(2)}. They must total exactly 1.00 — the composite is
            renormalised over whichever components an application has, so any other total silently
            rescales every applicant&apos;s score.
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Auto-reject below composite" htmlFor="autoRejectThreshold">
          <Input id="autoRejectThreshold" name="autoRejectThreshold" type="number" step="0.5"
            min={0} max={100} defaultValue={config.autoRejectThreshold} className="tabular-nums" />
        </Field>
        <Field label="Reviews required before deciding" htmlFor="minReviewsRequired">
          <Input id="minReviewsRequired" name="minReviewsRequired" type="number" min={0} max={10}
            defaultValue={config.minReviewsRequired} className="tabular-nums" />
        </Field>
        <Field label="Reviewer disagreement threshold" htmlFor="reviewerDisagreementThreshold"
          hint="Above this spread, a third adjudicating review is demanded">
          <Input id="reviewerDisagreementThreshold" name="reviewerDisagreementThreshold"
            type="number" step="0.5" min={0} max={100}
            defaultValue={config.reviewerDisagreementThreshold} className="tabular-nums" />
        </Field>
        <Field label="Minimum rubric coverage" htmlFor="minimumCoverage"
          hint="Fraction of the rubric that must be present, 0–1">
          <Input id="minimumCoverage" name="minimumCoverage" type="number" step="0.05" min={0}
            max={1} defaultValue={config.minimumCoverage} className="tabular-nums" />
        </Field>
        <Field label="Offer validity (days)" htmlFor="offerValidityDays" className="sm:col-span-2">
          <Input id="offerValidityDays" name="offerValidityDays" type="number" min={1} max={365}
            defaultValue={config.offerValidityDays} className="tabular-nums" />
        </Field>
      </div>

      <Save />
    </form>
  );
}

// -----------------------------------------------------------------------------
// Branding
// -----------------------------------------------------------------------------

export function BrandingForm({ config }: { config: BrandingConfig }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveBrandingAction, {});
  const [color, setColor] = useState(config.brandColor);
  const [short, setShort] = useState(config.short);

  return (
    <form action={action} className="space-y-4">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Institution name" htmlFor="name" required className="sm:col-span-2">
          <Input id="name" name="name" required maxLength={120} defaultValue={config.name} />
        </Field>
        <Field label="Short name" htmlFor="short" required hint="Used in the browser tab and tight spaces">
          <Input id="short" name="short" required maxLength={40} value={short}
            onChange={(e) => setShort(e.target.value)} />
        </Field>
        <Field label="Brand colour" htmlFor="brandColor" required hint="6-digit hex, e.g. #1b5df5">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1b5df5'}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
              aria-label="Pick brand colour"
            />
            <Input id="brandColor" name="brandColor" required value={color}
              onChange={(e) => setColor(e.target.value)} className="font-mono" />
          </div>
        </Field>
        <Field label="Logo URL" htmlFor="logoUrl" hint="Optional" className="sm:col-span-2">
          <Input id="logoUrl" name="logoUrl" type="url" defaultValue={config.logoUrl ?? ''} />
        </Field>
      </div>

      <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
        <p className="mb-2 text-xs font-medium text-slate-700">Preview</p>
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-onAccent"
            style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1b5df5' }}
          >
            {short.slice(0, 3).toUpperCase()}
          </span>
          <span className="text-sm font-semibold text-slate-900">{short}</span>
        </div>
      </div>

      <Save />
    </form>
  );
}
