'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { platformDb } from '@/lib/tenant';
import { requireTenantRole } from '@/server/tenant-context';
import { invalidateConfig, loadSchoolConfig } from '@/server/school-config';
import { recomputeStudentAcademics } from '@/server/academics';
import { recordAudit } from '@/server/services/audit.service';
import {
  AdmissionsConfigZ,
  AttendancePolicyZ,
  BrandingConfigZ,
  ConfigError,
  EnrollmentPolicyZ,
  FinanceConfigZ,
  GRADING_PRESETS,
  GradingConfigZ,
  assertAdmissionsConfigWellFormed,
  assertEnrollmentPolicyWellFormed,
  assertGradingConfigWellFormed,
  type GradingConfig,
} from '@/lib/domain/config';

export interface SettingsState {
  ok?: boolean;
  message?: string;
}

/**
 * Persist one config column and drop the cached bundle.
 *
 * Invalidation is not optional: the loader memoises per process, so a save that
 * forgot this would leave every subsequent request grading against the policy
 * the administrator just replaced.
 */
async function writeColumn(
  schoolId: string,
  column: string,
  value: unknown,
  actorId: string,
  summary: string,
): Promise<void> {
  await platformDb.schoolConfig.upsert({
    where: { schoolId },
    create: await buildCreatePayload(schoolId, column, value),
    update: { [column]: JSON.stringify(value) },
  });
  invalidateConfig(schoolId);

  void recordAudit({
    schoolId,
    actorId,
    action: 'school.config.update',
    entityType: 'SchoolConfig',
    entityId: schoolId,
    summary,
  });
}

/**
 * A school that has never saved settings has no config row, so an upsert's
 * `create` branch must supply every NOT NULL column. The current bundle
 * (defaults, if there is no row) fills the rest.
 */
async function buildCreatePayload(schoolId: string, column: string, value: unknown) {
  const current = await loadSchoolConfig(schoolId);
  const payload: Record<string, string> = {
    schoolId,
    gradingJson: JSON.stringify(current.grading),
    enrollmentJson: JSON.stringify(current.enrollment),
    admissionsJson: JSON.stringify(current.admissions),
    financeJson: JSON.stringify(current.finance),
    brandingJson: JSON.stringify(current.branding),
    localeJson: JSON.stringify(current.locale),
    registrationPortalJson: JSON.stringify(current.registrationPortal),
  };
  payload[column] = JSON.stringify(value);
  return payload as never;
}

function fail(error: unknown): SettingsState {
  if (error instanceof ConfigError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? 'Those settings are not valid.' };
  }
  console.error('[settings] save failed', error);
  return { ok: false, message: 'Could not save. Nothing has been changed.' };
}

// -----------------------------------------------------------------------------
// Grading
// -----------------------------------------------------------------------------

/**
 * Save the grading scheme.
 *
 * Two things make this the most consequential form in the product:
 *
 *  1. The scale is VALIDATED for contiguity before it is written. A gap means
 *     some score maps to no grade; an overlap means it maps to two. Either way
 *     a student ends up with a grade nobody can justify, so a bad scale is
 *     rejected rather than stored.
 *
 *  2. Changing it RETROSPECTIVELY changes every GPA the school has computed,
 *     because grades are stored as points and the CGPA is derived. So the save
 *     recomputes every student's academics rather than leaving the record
 *     silently disagreeing with the published scale.
 */
export async function saveGradingAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const presetKey = String(formData.get('preset') ?? '');
    let config: GradingConfig;

    if (presetKey && GRADING_PRESETS[presetKey]) {
      config = GRADING_PRESETS[presetKey].config;
    } else {
      const rows = JSON.parse(String(formData.get('scale') ?? '[]'));
      const current = (await loadSchoolConfig(schoolId)).grading;
      config = {
        ...current,
        maxGradePoint: Number(formData.get('maxGradePoint') ?? current.maxGradePoint),
        passingGradePoint: Number(formData.get('passingGradePoint') ?? current.passingGradePoint),
        assessmentWeights: {
          ca: Number(formData.get('ca') ?? current.assessmentWeights.ca),
          exam: Number(formData.get('exam') ?? current.assessmentWeights.exam),
        },
        standing: {
          ...current.standing,
          deansList: Number(formData.get('deansList') ?? current.standing.deansList),
          good: Number(formData.get('good') ?? current.standing.good),
          warning: Number(formData.get('warning') ?? current.standing.warning),
          probation: Number(formData.get('probation') ?? current.standing.probation),
        },
        scale: rows,
      };
    }

    const parsed = GradingConfigZ.parse(config);
    assertGradingConfigWellFormed(parsed);

    await writeColumn(
      schoolId,
      'gradingJson',
      parsed,
      session.sub,
      `Grading scheme updated — ${parsed.scale.length} bands, ${parsed.maxGradePoint.toFixed(2)} maximum.`,
    );

    // Grades are stored as points, so a new scale changes every derived figure.
    // Recomputing here is what keeps transcripts honest; leaving it to a
    // nightly job would publish a CGPA that no longer matches the bands.
    const students = await platformDb.student.findMany({
      where: { schoolId },
      select: { id: true },
    });
    for (const s of students) {
      await recomputeStudentAcademics(schoolId, s.id);
    }

    revalidatePath('/settings/school');
    return {
      ok: true,
      message: `Grading scheme saved. ${students.length} student record${students.length === 1 ? '' : 's'} recomputed against the new scale.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Enrolment
// -----------------------------------------------------------------------------

export async function saveEnrollmentAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const policy = EnrollmentPolicyZ.parse({
      minCreditsPerTerm: Number(formData.get('minCreditsPerTerm')),
      maxCreditsPerTerm: Number(formData.get('maxCreditsPerTerm')),
      maxCreditsWithOverloadApproval: Number(formData.get('maxCreditsWithOverloadApproval')),
      overloadMinCgpa: Number(formData.get('overloadMinCgpa')),
      outstandingBalanceToleranceMinor: Number(formData.get('outstandingBalanceToleranceMinor')),
    });
    assertEnrollmentPolicyWellFormed(policy);

    await writeColumn(
      schoolId,
      'enrollmentJson',
      policy,
      session.sub,
      `Enrolment rules updated — ${policy.minCreditsPerTerm}–${policy.maxCreditsPerTerm} credits per term.`,
    );

    revalidatePath('/settings/school');
    return { ok: true, message: 'Enrolment rules saved. They apply to the next registration.' };
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

/**
 * Attendance.
 *
 * The only setting in here that can take something away from a student, so
 * the audit line records whether enforcement was switched on or off as well
 * as the numbers. "Who barred the third years?" has to be answerable.
 */
export async function saveAttendanceAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const policy = AttendancePolicyZ.parse({
      examEligibilityThreshold: Number(formData.get('examEligibilityThreshold')),
      warningThreshold: Number(formData.get('warningThreshold')),
      enforced: formData.get('enforced') === 'on',
    });

    await writeColumn(
      schoolId,
      'attendanceJson',
      policy,
      session.sub,
      `Attendance: ${policy.examEligibilityThreshold}% required, ` +
        `${policy.enforced ? 'ENFORCED' : 'not enforced'}.`,
    );

    revalidatePath('/settings/school');
    return {
      ok: true,
      message: policy.enforced
        ? `Saved. Students below ${policy.examEligibilityThreshold}% are now barred from examinations.`
        : 'Saved. Attendance is recorded and shown, and nobody is barred.',
    };
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Admissions
// -----------------------------------------------------------------------------

export async function saveAdmissionsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const config = AdmissionsConfigZ.parse({
      weights: {
        priorGpa: Number(formData.get('priorGpa')),
        entranceExam: Number(formData.get('entranceExam')),
        essay: Number(formData.get('essay')),
        interview: Number(formData.get('interview')),
        extracurricular: Number(formData.get('extracurricular')),
      },
      autoRejectThreshold: Number(formData.get('autoRejectThreshold')),
      minReviewsRequired: Number(formData.get('minReviewsRequired')),
      reviewerDisagreementThreshold: Number(formData.get('reviewerDisagreementThreshold')),
      minimumCoverage: Number(formData.get('minimumCoverage')),
      offerValidityDays: Number(formData.get('offerValidityDays')),
    });
    // Weights are renormalised over available components at scoring time, so a
    // set that does not total 1 would silently rescale every composite.
    assertAdmissionsConfigWellFormed(config);

    await writeColumn(
      schoolId,
      'admissionsJson',
      config,
      session.sub,
      'Admissions rubric updated.',
    );

    revalidatePath('/settings/school');
    return {
      ok: true,
      message: 'Admissions rubric saved. Re-run a cohort allocation to see its effect.',
    };
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Finance
// -----------------------------------------------------------------------------

export async function saveFinanceAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const current = (await loadSchoolConfig(schoolId)).finance;
    const config = FinanceConfigZ.parse({
      currency: {
        code: String(formData.get('code') ?? '').toUpperCase(),
        symbol: String(formData.get('symbol') ?? ''),
        exponent: Number(formData.get('exponent')),
      },
      holdPolicy: {
        toleranceMinor: Number(formData.get('toleranceMinor')),
        graceDays: Number(formData.get('graceDays')),
      },
      refundSchedule: current.refundSchedule,
    });

    await writeColumn(
      schoolId,
      'financeJson',
      config,
      session.sub,
      `Finance settings updated — currency ${config.currency.code}.`,
    );

    // The school row carries the currency too, for the places that read the
    // school without loading the whole bundle.
    await platformDb.school.update({
      where: { id: schoolId },
      data: { currencyCode: config.currency.code },
    });

    revalidatePath('/settings/school');
    return { ok: true, message: 'Finance settings saved.' };
  } catch (error) {
    return fail(error);
  }
}

// -----------------------------------------------------------------------------
// Branding
// -----------------------------------------------------------------------------

export async function saveBrandingAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { schoolId, session } = await requireTenantRole('ADMIN');

  try {
    const logoUrl = String(formData.get('logoUrl') ?? '').trim();
    const branding = BrandingConfigZ.parse({
      name: String(formData.get('name') ?? '').trim(),
      short: String(formData.get('short') ?? '').trim(),
      brandColor: String(formData.get('brandColor') ?? '').trim(),
      logoUrl: logoUrl === '' ? null : logoUrl,
    });

    await writeColumn(schoolId, 'brandingJson', branding, session.sub, 'Branding updated.');

    // The school row is what the shell and the public pages read, so it is
    // updated alongside — otherwise the settings page and the header would
    // disagree about the school's own name.
    await platformDb.school.update({
      where: { id: schoolId },
      data: {
        name: branding.name,
        shortName: branding.short,
        brandColor: branding.brandColor,
        logoUrl: branding.logoUrl,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, message: 'Branding saved.' };
  } catch (error) {
    return fail(error);
  }
}
