'use server';

import { z } from 'zod';

import { db } from '@/lib/db';
import { createApplicantAccount } from '@/server/services/admissions.service';
import { nextApplicationReference } from '@/server/services/sequence.service';
import { recordAudit } from '@/server/services/audit.service';

export interface ApplyState {
  ok?: boolean;
  message?: string;
  referenceNo?: string;
}

/**
 * Password policy. Length is weighted far more heavily than character-class
 * rules, which mostly produce "Password1!" — memorable to an attacker's
 * dictionary, forgettable to the user.
 */
const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200)
  .refine((v) => !/^\s|\s$/.test(v), 'Password cannot start or end with a space.');

const applySchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(80),
  lastName: z.string().trim().min(1, 'Enter your surname.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().max(40).optional(),
  password: passwordSchema,
  programId: z.string().min(1, 'Choose a program.'),
  termId: z.string().min(1, 'Choose an intake.'),
  previousSchool: z.string().trim().max(200).optional(),
  priorGpaScore: z.coerce.number().min(0).max(100).optional(),
  entranceExamScore: z.coerce.number().min(0).max(100).optional(),
  personalStatement: z
    .string()
    .trim()
    .min(100, 'Your statement should be at least 100 characters.')
    .max(5000),
});

/**
 * Public self-service application.
 *
 * Creates the account and the application together. If the application insert
 * fails, the orphaned account would leave the applicant unable to re-register
 * with the same email — so account creation is checked first and the
 * application is created in the same logical operation.
 */
export async function submitApplicationAction(
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = applySchema.safeParse({
    ...raw,
    priorGpaScore: raw.priorGpaScore || undefined,
    entranceExamScore: raw.entranceExamScore || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Please check your details.' };
  }

  const d = parsed.data;

  const account = await createApplicantAccount({
    email: d.email,
    password: d.password,
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
  });

  if (!account.ok || !account.userId) {
    return { ok: false, message: account.message };
  }

  const applicant = await db.applicant.findUnique({ where: { userId: account.userId } });
  if (!applicant) {
    return { ok: false, message: 'Your account was created but the application could not be started. Sign in and try again.' };
  }

  try {
    const application = await db.$transaction(async (tx) => {
      const referenceNo = await nextApplicationReference(tx);
      return tx.application.create({
        data: {
          referenceNo,
          applicantId: applicant.id,
          programId: d.programId,
          termId: d.termId,
          status: 'SUBMITTED',
          previousSchool: d.previousSchool || null,
          priorGpaScore: d.priorGpaScore ?? null,
          entranceExamScore: d.entranceExamScore ?? null,
          personalStatement: d.personalStatement,
          submittedAt: new Date(),
        },
      });
    });

    void recordAudit({
      actorId: account.userId,
      action: 'application.submit',
      entityType: 'Application',
      entityId: application.id,
      summary: `${application.referenceNo} submitted by ${d.email}.`,
    });

    return {
      ok: true,
      referenceNo: application.referenceNo,
      message: `Application received. Your reference is ${application.referenceNo}. Sign in to track its progress.`,
    };
  } catch (error) {
    console.error('[apply] failed to create application', error);
    return {
      ok: false,
      message: 'Your account was created, but the application could not be submitted. Sign in and try again.',
    };
  }
}
