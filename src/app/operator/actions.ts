'use server';

import { revalidatePath } from 'next/cache';

import { headers } from 'next/headers';

import { requireOperator } from '@/lib/auth/operator';
import { schoolEntranceUrl } from '@/lib/domain/tenancy';
import {
  activateSchool,
  clearDemoData,
  reissueOwnerPassword,
  provisionSchool,
  raiseSubscriptionInvoice,
  recordSubscriptionPayment,
  setPlan,
  setPlatformAdmin,
  setSubscriptionStatus,
} from '@/server/services/platform.service';
import type { SubscriptionStatus } from '@/lib/domain/provisioning';

/**
 * Every action here calls `requireOperator()` FIRST, which re-checks the
 * database rather than trusting the session claim. A server action is a public
 * endpoint: the page guard in middleware protects the page, not the action, and
 * an action that assumed the page had already vetted the caller would be
 * callable directly by anyone with a session.
 */

export interface PlatformFormState {
  ok?: boolean;
  message?: string;
  /** Shown once after provisioning, then gone. Never re-derivable. */
  temporaryPassword?: string;
  ownerEmail?: string;
  slug?: string;
  /** Absolute. This gets emailed to somebody who has never used the system. */
  entranceUrl?: string;
}

function intOrNull(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export async function provisionSchoolAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();

  const academicModel = String(formData.get('academicModel') ?? 'HIGHER_ED');
  if (academicModel !== 'HIGHER_ED' && academicModel !== 'K12') {
    return { ok: false, message: 'Choose an academic model.' };
  }

  const result = await provisionSchool({
    name: String(formData.get('name') ?? ''),
    shortName: String(formData.get('shortName') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    code: String(formData.get('code') ?? ''),
    academicModel,
    country: String(formData.get('country') ?? '') || undefined,
    locale: String(formData.get('locale') ?? '') || undefined,
    timezone: String(formData.get('timezone') ?? 'Africa/Lagos'),
    currencyCode: String(formData.get('currencyCode') ?? 'NGN'),
    gradingPresetKey: String(formData.get('gradingPresetKey') ?? ''),
    planId: String(formData.get('planId') ?? ''),
    owner: {
      email: String(formData.get('ownerEmail') ?? ''),
      firstName: String(formData.get('ownerFirstName') ?? ''),
      lastName: String(formData.get('ownerLastName') ?? ''),
    },
    actorUserId: session.sub,
  });

  revalidatePath('/operator');

  // Built server-side: only the server knows whether this deployment addresses
  // schools by path or by subdomain, and a client guessing would hand the new
  // owner a link that does not work.
  let entranceUrl: string | undefined;
  if (result.ok && result.slug) {
    const h = await headers();
    const host = h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    entranceUrl = schoolEntranceUrl({
      slug: result.slug,
      origin: `${proto}://${host}`,
      rootDomain: process.env.ROOT_DOMAIN ?? null,
    });
  }

  return {
    ok: result.ok,
    message: result.message,
    temporaryPassword: result.temporaryPassword,
    ownerEmail: result.ownerEmail,
    slug: result.slug,
    entranceUrl,
  };
}

export async function setStatusAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();

  const status = String(formData.get('status') ?? '');
  const valid: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'];
  if (!valid.includes(status as SubscriptionStatus)) {
    return { ok: false, message: 'Choose a valid subscription status.' };
  }

  const schoolId = String(formData.get('schoolId') ?? '');
  const result = await setSubscriptionStatus({
    schoolId,
    status: status as SubscriptionStatus,
    note: String(formData.get('note') ?? '') || null,
    actorUserId: session.sub,
  });

  revalidatePath('/operator');
  revalidatePath(`/operator/${schoolId}`);
  return result;
}

export async function activateSchoolAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();
  const schoolId = String(formData.get('schoolId') ?? '');

  const result = await activateSchool({ schoolId, actorUserId: session.sub });

  revalidatePath('/operator');
  revalidatePath(`/operator/${schoolId}`);
  return result;
}

/**
 * Reissue the owner's one-time password.
 *
 * The only credential nobody else can recover: a school's own /people page can
 * reset anybody, but the owner has to be able to sign in to use it. Without
 * this, an owner who loses the password shown once at provisioning is locked
 * out of their institution with nobody above them to ask.
 */
export async function reissueOwnerPasswordAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();
  const schoolId = String(formData.get('schoolId') ?? '');

  const result = await reissueOwnerPassword({ schoolId, actorUserId: session.sub });

  revalidatePath(`/operator/${schoolId}`);
  return {
    ok: result.ok,
    message: result.message,
    temporaryPassword: result.temporaryPassword,
    ownerEmail: result.email,
  };
}

export async function setPlanAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();
  const schoolId = String(formData.get('schoolId') ?? '');

  const result = await setPlan({
    schoolId,
    planId: String(formData.get('planId') ?? ''),
    seatOverrideStudents: intOrNull(formData.get('seatOverrideStudents')),
    seatOverrideStaff: intOrNull(formData.get('seatOverrideStaff')),
    actorUserId: session.sub,
  });

  revalidatePath('/operator');
  revalidatePath(`/operator/${schoolId}`);
  return result;
}

export async function raiseInvoiceAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();
  const schoolId = String(formData.get('schoolId') ?? '');

  const start = new Date(String(formData.get('periodStart') ?? ''));
  const end = new Date(String(formData.get('periodEnd') ?? ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, message: 'Enter both period dates.' };
  }

  const result = await raiseSubscriptionInvoice({
    schoolId,
    periodStart: start,
    periodEnd: end,
    dueInDays: intOrNull(formData.get('dueInDays')) ?? 14,
    actorUserId: session.sub,
  });

  revalidatePath(`/operator/${schoolId}`);
  return { ok: result.ok, message: result.message };
}

export async function recordPaymentAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();

  // Passed on in MAJOR units. The service converts against the invoice's own
  // currency; this layer does not know the exponent and must not guess it.
  const major = Number(formData.get('amount') ?? 0);
  if (!Number.isFinite(major) || major <= 0) {
    return { ok: false, message: 'Enter the amount received.' };
  }

  const result = await recordSubscriptionPayment({
    invoiceId: String(formData.get('invoiceId') ?? ''),
    amountMajor: major,
    method: String(formData.get('method') ?? 'BANK_TRANSFER'),
    reference: String(formData.get('reference') ?? '') || null,
    actorUserId: session.sub,
  });

  revalidatePath(`/operator/${String(formData.get('schoolId') ?? '')}`);
  return result;
}

export async function clearDemoDataAction(
  _prev: PlatformFormState,
  _formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();
  const result = await clearDemoData({ actorUserId: session.sub });

  revalidatePath('/operator');
  return { ok: result.ok, message: result.message };
}

export async function setPlatformAdminAction(
  _prev: PlatformFormState,
  formData: FormData,
): Promise<PlatformFormState> {
  const session = await requireOperator();

  const result = await setPlatformAdmin({
    userId: String(formData.get('userId') ?? ''),
    grant: formData.get('grant') === 'true',
    actorUserId: session.sub,
  });

  revalidatePath('/operator/operators');
  return result;
}
