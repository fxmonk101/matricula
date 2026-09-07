'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantRole } from '@/server/tenant-context';
import { registerForOffering, dropEnrollment } from '@/server/services/enrollment.service';

export interface RegistrationFormState {
  ok?: boolean;
  message?: string;
  reasons?: string[];
}

const registerSchema = z.object({ offeringId: z.string().min(1) });
const dropSchema = z.object({ enrollmentId: z.string().min(1) });

/**
 * Register the SIGNED-IN student for a section.
 *
 * The student id comes from the session, never from the form. Accepting a
 * studentId from the client would let any student register — or drop — any
 * other student's courses by editing one hidden field. This is the single most
 * important line in the file.
 */
export async function registerAction(
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const { db, schoolId, session } = await requireTenantRole('STUDENT');
  if (!session.pid) return { ok: false, message: 'No student record is linked to your account.' };

  const parsed = registerSchema.safeParse({ offeringId: formData.get('offeringId') });
  if (!parsed.success) return { ok: false, message: 'Invalid section.' };

  const result = await registerForOffering({
    schoolId,
    studentId: session.pid,
    offeringId: parsed.data.offeringId,
    actorId: session.sub,
  });

  revalidatePath('/me/registration');
  revalidatePath('/me');

  return {
    ok: result.ok,
    message: result.ok ? result.message : result.message,
    reasons: result.reasons,
  };
}

export async function dropAction(
  _prev: RegistrationFormState,
  formData: FormData,
): Promise<RegistrationFormState> {
  const { db, schoolId, session } = await requireTenantRole('STUDENT');
  if (!session.pid) return { ok: false, message: 'No student record is linked to your account.' };

  const parsed = dropSchema.safeParse({ enrollmentId: formData.get('enrollmentId') });
  if (!parsed.success) return { ok: false, message: 'Invalid registration.' };

  // Ownership check: the enrollment must belong to the signed-in student.
  // Middleware guards the ROUTE; this guards the RECORD, which is the thing
  // that actually matters.
  const enrollment = await db.enrollment.findUnique({
    where: { id: parsed.data.enrollmentId },
    select: { studentId: true },
  });

  if (!enrollment || enrollment.studentId !== session.pid) {
    return { ok: false, message: 'That registration is not on your record.' };
  }

  const result = await dropEnrollment({
    schoolId,
    enrollmentId: parsed.data.enrollmentId,
    actorId: session.sub,
  });

  revalidatePath('/me/registration');
  revalidatePath('/me');

  return { ok: result.ok, message: result.message };
}
