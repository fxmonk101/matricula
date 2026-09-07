'use server';

import { z } from 'zod';

import { dbFor, platformDb } from '@/lib/tenant';
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
  /** Which school is being applied to. Comes from the /s/<slug>/apply path. */
  schoolSlug: z.string().trim().min(1, 'No school selected.').max(64),
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
 * The school is resolved from the URL slug and then VERIFIED to be accepting
 * applications, and the chosen program and term are checked to belong to that
 * school. Without those checks a crafted form could file an application to one
 * school against another school's program — the classic multi-tenant
 * confused-deputy.
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

  const school = await platformDb.school.findUnique({
    where: { slug: d.schoolSlug },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!school || school.status === 'SUSPENDED') {
    return { ok: false, message: 'That school is not accepting applications.' };
  }

  const db = dbFor(school.id);

  // The program and term must belong to THIS school. The scoped client makes
  // that automatic: a foreign id simply does not resolve.
  const [program, term] = await Promise.all([
    db.program.findUnique({ where: { id: d.programId }, select: { id: true, isActive: true } }),
    db.term.findUnique({ where: { id: d.termId }, select: { id: true } }),
  ]);
  if (!program?.isActive || !term) {
    return { ok: false, message: 'That programme or intake is not available at this school.' };
  }

  const account = await createApplicantAccount({
    schoolId: school.id,
    email: d.email,
    password: d.password,
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
  });

  if (!account.ok || !account.applicantId) {
    return { ok: false, message: account.message };
  }

  try {
    const application = await db.$transaction(async (tx) => {
      const referenceNo = await nextApplicationReference(tx, school.code);
      return tx.application.create({
        data: {
          schoolId: school.id,
          referenceNo,
          applicantId: account.applicantId!,
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
      schoolId: school.id,
      actorId: account.userId,
      action: 'application.submit',
      entityType: 'Application',
      entityId: application.id,
      summary: `${application.referenceNo} submitted to ${school.name} by ${d.email}.`,
    });

    return {
      ok: true,
      referenceNo: application.referenceNo,
      message: `Application received. Your reference is ${application.referenceNo}.`,
    };
  } catch (error) {
    console.error('[apply] failed to create application', error);
    return {
      ok: false,
      message:
        'Your account was created, but the application could not be submitted. Sign in and try again.',
    };
  }
}
