'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantRole } from '@/server/tenant-context';
import {
  convertApplicantToStudent,
  rescoreApplication,
  runCohortAllocation,
  type CohortRunSummary,
} from '@/server/services/admissions.service';
import { recordAudit } from '@/server/services/audit.service';

export interface AdmissionsState {
  ok?: boolean;
  message?: string;
  summary?: CohortRunSummary;
  dryRun?: boolean;
}

const allocationSchema = z.object({
  programId: z.string().min(1, 'Choose a program.'),
  termId: z.string().min(1, 'Choose an intake term.'),
  capacity: z.coerce.number().int().min(0).max(100000),
  waitlistCapacity: z.coerce.number().int().min(0).max(100000),
  minimumComposite: z.coerce.number().min(0).max(100),
  requiredReviews: z.coerce.number().int().min(0).max(10),
  dryRun: z.coerce.boolean().optional(),
});

/**
 * Run the cohort allocation.
 *
 * The default is a DRY RUN. Committing offers is an explicit, separate act:
 * an offer, once sent, cannot be quietly withdrawn, so the destructive path
 * must never be the one a mis-click reaches.
 */
export async function runAllocationAction(
  _prev: AdmissionsState,
  formData: FormData,
): Promise<AdmissionsState> {
  const { db, school, schoolId, session } = await requireTenantRole('ADMIN', 'ADMISSIONS');

  const parsed = allocationSchema.safeParse({
    programId: formData.get('programId'),
    termId: formData.get('termId'),
    capacity: formData.get('capacity'),
    waitlistCapacity: formData.get('waitlistCapacity'),
    minimumComposite: formData.get('minimumComposite'),
    requiredReviews: formData.get('requiredReviews'),
    dryRun: formData.get('commit') !== 'yes',
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid allocation settings.' };
  }

  const dryRun = parsed.data.dryRun ?? true;

  const summary = await runCohortAllocation({
    schoolId,
    programId: parsed.data.programId,
    termId: parsed.data.termId,
    actorId: session.sub,
    dryRun,
    policy: {
      capacity: parsed.data.capacity,
      waitlistCapacity: parsed.data.waitlistCapacity,
      minimumComposite: parsed.data.minimumComposite,
      requiredReviews: parsed.data.requiredReviews,
    },
  });

  if (!dryRun) revalidatePath('/admissions');

  // Say how many places were already taken, so a committee that re-runs with
  // the intake size can see why fewer offers go out the second time.
  const held =
    summary.placesHeld > 0
      ? ` ${summary.placesHeld} of ${parsed.data.capacity} places were already held, leaving ${summary.placesLeft}.`
      : '';
  const pending = summary.pending > 0 ? ` ${summary.pending} still awaiting review.` : '';

  return {
    ok: true,
    dryRun,
    summary,
    message: dryRun
      ? `Preview only — nothing has been changed.${held} ${summary.offered} would be offered, ${summary.waitlisted} waitlisted, ${summary.rejected} rejected.${pending}`
      : `Committed.${held} ${summary.offered} offers extended, ${summary.waitlisted} waitlisted, ${summary.rejected} rejected.${pending}`,
  };
}

const reviewSchema = z.object({
  applicationId: z.string().min(1),
  academicScore: z.coerce.number().min(0).max(100),
  essayScore: z.coerce.number().min(0).max(100),
  interviewScore: z.union([z.coerce.number().min(0).max(100), z.literal('')]).optional(),
  extracurricularScore: z.union([z.coerce.number().min(0).max(100), z.literal('')]).optional(),
  recommendation: z.enum(['ADMIT', 'WAITLIST', 'REJECT']),
  comments: z.string().max(2000).optional(),
});

/**
 * Record a reviewer's rubric scores. Upserted on (applicationId, reviewerId),
 * so a reviewer revising their own scores updates their review rather than
 * stacking a second one and silently doubling their weight in the average.
 */
export async function submitReviewAction(
  _prev: AdmissionsState,
  formData: FormData,
): Promise<AdmissionsState> {
  const { db, school, schoolId, session } = await requireTenantRole('ADMIN', 'ADMISSIONS');

  const parsed = reviewSchema.safeParse({
    applicationId: formData.get('applicationId'),
    academicScore: formData.get('academicScore'),
    essayScore: formData.get('essayScore'),
    interviewScore: formData.get('interviewScore') || '',
    extracurricularScore: formData.get('extracurricularScore') || '',
    recommendation: formData.get('recommendation'),
    comments: formData.get('comments') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid review.' };
  }

  const d = parsed.data;
  const toNullable = (v: number | '' | undefined) => (v === '' || v === undefined ? null : v);

  await db.applicationReview.upsert({
    where: {
      applicationId_reviewerId: {
        applicationId: d.applicationId,
        reviewerId: session.sub,
      },
    },
    create: {
      schoolId,
      applicationId: d.applicationId,
      reviewerId: session.sub,
      academicScore: d.academicScore,
      essayScore: d.essayScore,
      interviewScore: toNullable(d.interviewScore),
      extracurricularScore: toNullable(d.extracurricularScore),
      recommendation: d.recommendation,
      comments: d.comments || null,
    },
    update: {
      academicScore: d.academicScore,
      essayScore: d.essayScore,
      interviewScore: toNullable(d.interviewScore),
      extracurricularScore: toNullable(d.extracurricularScore),
      recommendation: d.recommendation,
      comments: d.comments || null,
    },
  });

  // Move SUBMITTED to UNDER_REVIEW the moment the first review lands.
  await db.application.updateMany({
    where: { id: d.applicationId, status: 'SUBMITTED' },
    data: { status: 'UNDER_REVIEW' },
  });

  const composite = await rescoreApplication(schoolId, d.applicationId);

  void recordAudit({
    schoolId,
    actorId: session.sub,
    action: 'application.review',
    entityType: 'Application',
    entityId: d.applicationId,
    summary: `Review recorded: ${d.recommendation}, composite now ${composite.toFixed(2)}.`,
  });

  revalidatePath(`/admissions/${d.applicationId}`);
  revalidatePath('/admissions');

  return { ok: true, message: `Review saved. Composite score is now ${composite.toFixed(2)}.` };
}

export async function convertAction(
  _prev: AdmissionsState,
  formData: FormData,
): Promise<AdmissionsState> {
  const { school, schoolId, session } = await requireTenantRole('ADMIN', 'ADMISSIONS', 'REGISTRAR');
  const applicationId = String(formData.get('applicationId') ?? '');
  if (!applicationId) return { ok: false, message: 'No application specified.' };

  const result = await convertApplicantToStudent({
    schoolId,
    schoolCode: school.code,
    applicationId,
    actorId: session.sub,
  });

  revalidatePath('/admissions');
  revalidatePath(`/admissions/${applicationId}`);
  revalidatePath('/students');

  return { ok: result.ok, message: result.message };
}
