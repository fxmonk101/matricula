'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireTenantRole } from '@/server/tenant-context';
import { respondToOffer } from '@/server/services/admissions.service';

export interface OfferState {
  ok?: boolean;
  message?: string;
}

const schema = z.object({
  applicationId: z.string().min(1),
  decision: z.enum(['accept', 'decline']),
});

export async function respondToOfferAction(
  _prev: OfferState,
  formData: FormData,
): Promise<OfferState> {
  const { db, schoolId, session } = await requireTenantRole('APPLICANT');
  if (!session.pid) return { ok: false, message: 'No applicant record is linked to your account.' };

  const parsed = schema.safeParse({
    applicationId: formData.get('applicationId'),
    decision: formData.get('decision'),
  });
  if (!parsed.success) return { ok: false, message: 'Invalid response.' };

  // Ownership: the application must belong to the signed-in applicant. Without
  // this, any applicant could accept or decline anyone else's offer by editing
  // one hidden field.
  const application = await db.application.findUnique({
    where: { id: parsed.data.applicationId },
    select: { applicantId: true },
  });

  if (!application || application.applicantId !== session.pid) {
    return { ok: false, message: 'That application is not yours.' };
  }

  const result = await respondToOffer({
    schoolId,
    applicationId: parsed.data.applicationId,
    accept: parsed.data.decision === 'accept',
    actorId: session.sub,
  });

  revalidatePath('/portal');
  return result;
}
