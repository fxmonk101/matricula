/**
 * =============================================================================
 * PLATFORM OPERATOR SERVICE
 * =============================================================================
 *
 * Provisioning a school, managing its plan, and billing it. Everything here
 * runs as the VENDOR, across tenants, so every function uses `platformDb` and
 * every caller must already have proved they are a platform admin.
 *
 * No `server-only` guard — the seed provisions the demo schools through these
 * same functions, so a seeded school cannot end up in a shape the product
 * could not have produced.
 */

import { randomBytes } from 'node:crypto';

import { platformDb } from '@/lib/tenant';
import { starterTerms, starterUnitFor } from '@/lib/domain/school-starter';
import { currencyFor, toMinor } from '@/lib/domain/money';
import { hashPassword } from '@/lib/auth/password';
import {
  checkSeat,
  deriveCode,
  disambiguate,
  effectiveLimits,
  formatTemporaryPassword,
  isValidCode,
  schoolStatusFor,
  slugRejectionReason,
  slugify,
  type SeatKind,
  type SeatUsage,
  type SubscriptionStatus,
} from '@/lib/domain/provisioning';
import {
  DEFAULT_ADMISSIONS_CONFIG,
  DEFAULT_ENROLLMENT_POLICY,
  DEFAULT_FINANCE_CONFIG,
  DEFAULT_K12_CONFIG,
  DEFAULT_LOCALE_CONFIG,
  DEFAULT_REGISTRATION_PORTAL_CONFIG,
  GRADING_PRESETS,
} from '@/lib/domain/config';
import { DEMO_OPERATOR_EMAIL, DEMO_SCHOOL_SLUGS } from '@/lib/domain/seed-guard';
import { recordAudit } from './audit.service';

export interface ProvisionResult {
  ok: boolean;
  message: string;
  schoolId?: string;
  slug?: string;
  /** Shown ONCE, never stored in readable form. */
  temporaryPassword?: string;
  ownerEmail?: string;
}

/**
 * Create a school, its configuration, its subscription and its first OWNER.
 *
 * All of it in ONE transaction. A school that exists with no config is a school
 * whose every page throws on `loadSchoolConfig`; a school with no owner is one
 * nobody can sign in to and only a database console can repair. Partial
 * provisioning is the failure mode that produces support tickets nobody can
 * diagnose, so there is no partial state to be in.
 *
 * The school starts in PROVISIONING. Its owner can sign in — the status gate
 * admits exactly that one role — and nobody else can, so staff are not invited
 * into a school with no terms and no grading scheme.
 */
export async function provisionSchool(params: {
  name: string;
  shortName?: string;
  slug?: string;
  code?: string;
  academicModel: 'HIGHER_ED' | 'K12';
  country?: string;
  locale?: string;
  timezone: string;
  currencyCode: string;
  /**
   * A key of `GRADING_PRESETS`, not a number of grade points. Two presets can
   * share a maximum — the Nigerian and US 4-point scales differ in their bands,
   * not their ceiling — so selecting by number would silently discard one of
   * them. The school edits the scale afterwards; this only decides where it
   * starts from.
   */
  gradingPresetKey: string;
  planId: string;
  owner: { email: string; firstName: string; lastName: string };
  actorUserId: string | null;
}): Promise<ProvisionResult> {
  const name = params.name.trim();
  if (name.length < 3) return { ok: false, message: 'Give the school a name.' };

  const email = params.owner.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address for the owner.' };
  }

  // --- identifiers ----------------------------------------------------------
  const [schools, plan] = await Promise.all([
    platformDb.school.findMany({ select: { slug: true, code: true } }),
    platformDb.plan.findUnique({ where: { id: params.planId } }),
  ]);
  if (!plan) return { ok: false, message: 'That plan no longer exists.' };

  const takenSlugs = new Set(schools.map((s) => s.slug));
  const takenCodes = new Set(schools.map((s) => s.code));

  const slug = disambiguate(params.slug?.trim() || slugify(name), takenSlugs);
  const slugProblem = slugRejectionReason(slug);
  if (slugProblem) return { ok: false, message: slugProblem };

  const codeBase = (params.code?.trim() || deriveCode(name)).toUpperCase();
  if (!isValidCode(codeBase)) {
    return { ok: false, message: 'The document prefix must be 2-8 capital letters or digits.' };
  }
  // Codes are stamped into invoice numbers, so a collision would make two
  // schools' documents indistinguishable. Disambiguated numerically rather
  // than with a hyphen, which would not match `isValidCode`.
  let code = codeBase;
  for (let n = 2; takenCodes.has(code) && n < 100; n += 1) code = `${codeBase}${n}`;
  if (takenCodes.has(code)) {
    return { ok: false, message: `Could not find a free document prefix near "${codeBase}".` };
  }

  // --- the owner's identity -------------------------------------------------
  // Global identity: a person who already runs another school on the platform
  // keeps their account and password, and simply gains a membership.
  const existingUser = await platformDb.user.findUnique({ where: { email } });
  const temporaryPassword = formatTemporaryPassword(randomBytes(32));

  const preset = GRADING_PRESETS[params.gradingPresetKey];
  if (!preset) return { ok: false, message: 'Choose a grading scale.' };
  const grading = preset.config;
  const now = new Date();
  const trialEndsAt =
    plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;

  try {
    const created = await platformDb.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          slug,
          code,
          name,
          shortName: params.shortName?.trim() || name,
          academicModel: params.academicModel,
          status: 'PROVISIONING',
          plan: plan.code,
          country: params.country ?? null,
          locale: params.locale ?? 'en-NG',
          timezone: params.timezone,
          currencyCode: params.currencyCode,
        },
      });

      await tx.schoolConfig.create({
        data: {
          schoolId: school.id,
          gradingJson: JSON.stringify(grading),
          enrollmentJson: JSON.stringify(DEFAULT_ENROLLMENT_POLICY),
          admissionsJson: JSON.stringify(DEFAULT_ADMISSIONS_CONFIG),
          financeJson: JSON.stringify({
            ...DEFAULT_FINANCE_CONFIG,
            // Resolved from the code rather than posted by the form: the
            // exponent in particular must not be a browser's opinion — a
            // zero-decimal currency stored with exponent 2 misstates every
            // fee the school will ever raise.
            currency: currencyFor(params.currencyCode),
          }),
          brandingJson: JSON.stringify({
            name,
            short: params.shortName?.trim() || name,
            brandColor: '#1b5df5',
            logoUrl: null,
          }),
          localeJson: JSON.stringify({
            ...DEFAULT_LOCALE_CONFIG,
            locale: params.locale ?? 'en-NG',
            timezone: params.timezone,
          }),
          registrationPortalJson: JSON.stringify(DEFAULT_REGISTRATION_PORTAL_CONFIG),
          // Only a K-12 school ever reads this, so a university gets null
          // rather than a block of settings it will never use.
          k12Json:
            params.academicModel === 'K12' ? JSON.stringify(DEFAULT_K12_CONFIG) : null,
        },
      });

      await tx.subscription.create({
        data: {
          schoolId: school.id,
          planId: plan.id,
          status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
          trialEndsAt,
        },
      });

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            passwordHash: await hashPassword(temporaryPassword),
            firstName: params.owner.firstName.trim(),
            lastName: params.owner.lastName.trim(),
            mustChangePassword: true,
          },
        }));

      const ownerMembership = await tx.membership.create({
        data: {
          userId: user.id,
          schoolId: school.id,
          role: 'OWNER',
          title: 'School Owner',
          isPrimary: !existingUser,
          status: 'ACTIVE',
        },
      });

      /*
       * THE SCAFFOLDING, in the same transaction as the school itself.
       *
       * A school used to arrive with a configuration and nothing to apply it
       * to, and almost every academic page hangs off a CURRENT TERM — offerings
       * belong to one, registration opens within one, fees are scoped by one,
       * the timetable is drawn for one. A school with no term is not a school
       * with less data; it is a school where most of the product does nothing
       * and nothing on screen says why.
       *
       * These are DEFAULTS, not sample data. Every institution has terms and a
       * department; only the names and dates differ, and an editable guess is
       * strictly better than an empty table.
       */
      await tx.term.createMany({
        data: starterTerms(now).map((t) => ({ ...t, schoolId: school.id })),
      });

      const unit = starterUnitFor(params.academicModel);
      const faculty = await tx.faculty.create({
        data: { schoolId: school.id, code: unit.facultyCode, name: unit.facultyName },
      });
      const department = await tx.department.create({
        data: {
          schoolId: school.id,
          facultyId: faculty.id,
          code: unit.departmentCode,
          name: unit.departmentName,
        },
      });

      /*
       * A starter programme, for the reason stated on `StarterUnit`:
       * `Student.programId` is required, so without one a freshly provisioned
       * school cannot create a single student. A K-12 school would never
       * think to make one, and would simply find that nothing worked.
       */
      await tx.program.create({
        data: {
          schoolId: school.id,
          departmentId: department.id,
          code: unit.programCode,
          name: unit.programName,
          degreeType: unit.programDegreeType,
          durationTerms: unit.programDurationTerms,
        },
      });

      // Org units mirror the academic structure, and the presence roll-up reads
      // them — so they are created together or the two disagree from day one.
      const facultyUnit = await tx.orgUnit.create({
        data: {
          schoolId: school.id,
          code: unit.facultyCode,
          name: unit.facultyName,
          kind: 'FACULTY',
        },
      });
      await tx.orgUnit.create({
        data: {
          schoolId: school.id,
          code: unit.departmentCode,
          name: unit.departmentName,
          kind: 'DEPARTMENT',
          parentId: facultyUnit.id,
        },
      });

      // The owner runs the institution, so they sit at the top of it.
      await tx.membership.update({
        where: { id: ownerMembership.id },
        data: { orgUnitId: facultyUnit.id },
      });

      void department;

      return school;
    });

    void recordAudit({
      schoolId: created.id,
      actorId: params.actorUserId,
      action: 'platform.school.provision',
      entityType: 'School',
      entityId: created.id,
      summary: `Provisioned ${name} (/s/${slug}) on plan ${plan.code}, owner ${email}.`,
    });

    return {
      ok: true,
      message: `${name} is ready, with its academic year and a starting department already set up. Give the owner their one-time password — it cannot be shown again.`,
      schoolId: created.id,
      slug,
      ownerEmail: email,
      // An existing user keeps the password they already have; showing a
      // freshly generated one would be a lie they could not sign in with.
      temporaryPassword: existingUser ? undefined : temporaryPassword,
    };
  } catch (error) {
    console.error('[platform] provisioning failed', error);
    return {
      ok: false,
      message: 'Provisioning failed and nothing was created. Check the details and try again.',
    };
  }
}

// -----------------------------------------------------------------------------
// Seats and entitlement
// -----------------------------------------------------------------------------

export async function countSeats(schoolId: string): Promise<SeatUsage> {
  const [students, staff] = await Promise.all([
    platformDb.membership.count({
      where: { schoolId, status: 'ACTIVE', role: 'STUDENT' },
    }),
    platformDb.membership.count({
      where: {
        schoolId,
        status: 'ACTIVE',
        // Applicants and guardians are not seats: a school is not billed for
        // people applying to it or for parents reading a report card.
        role: { in: ['OWNER', 'ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'] },
      },
    }),
  ]);
  return { students, staff };
}

export interface Entitlement {
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  limits: { maxStudents: number | null; maxStaff: number | null };
  usage: SeatUsage;
  trialEndsAt: Date | null;
  features: Record<string, boolean>;
}

export async function loadEntitlement(schoolId: string): Promise<Entitlement | null> {
  const subscription = await platformDb.subscription.findUnique({
    where: { schoolId },
    include: { plan: true },
  });
  if (!subscription) return null;

  const usage = await countSeats(schoolId);
  let features: Record<string, boolean> = {};
  try {
    const parsed = JSON.parse(subscription.plan.featuresJson);
    if (parsed && typeof parsed === 'object') features = parsed as Record<string, boolean>;
  } catch {
    // A corrupt feature blob must not take the school's pages down; an empty
    // set means "nothing extra is switched on", which is the safe reading.
    features = {};
  }

  return {
    planCode: subscription.plan.code,
    planName: subscription.plan.name,
    status: subscription.status as SubscriptionStatus,
    limits: effectiveLimits(
      { maxStudents: subscription.plan.maxStudents, maxStaff: subscription.plan.maxStaff },
      {
        maxStudents: subscription.seatOverrideStudents ?? undefined,
        maxStaff: subscription.seatOverrideStaff ?? undefined,
      },
    ),
    usage,
    trialEndsAt: subscription.trialEndsAt,
    features,
  };
}

/**
 * May this school add one more person of this kind?
 *
 * A school with NO subscription is allowed. That is deliberate: the seeded
 * demo schools predate the billing layer, and refusing to let an existing
 * customer add a pupil because a row is missing would be the platform's fault
 * charged to the school.
 */
export async function assertSeatAvailable(
  schoolId: string,
  kind: SeatKind,
): Promise<{ allowed: boolean; message?: string }> {
  const entitlement = await loadEntitlement(schoolId);
  if (!entitlement) return { allowed: true };
  const verdict = checkSeat(kind, entitlement.usage, entitlement.limits);
  return { allowed: verdict.allowed, message: verdict.message };
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/**
 * Move a school between statuses.
 *
 * The school's status and its subscription's status are kept in step by
 * `schoolStatusFor`, so an operator changes one thing and both agree. Setting
 * them independently is how a suspended school ends up with an active
 * subscription and nobody can tell which is true.
 */
export async function setSubscriptionStatus(params: {
  schoolId: string;
  status: SubscriptionStatus;
  note?: string | null;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const subscription = await platformDb.subscription.findUnique({
    where: { schoolId: params.schoolId },
    include: { school: { select: { name: true } } },
  });
  if (!subscription) return { ok: false, message: 'That school has no subscription.' };

  const schoolStatus = schoolStatusFor(params.status, subscription.trialEndsAt, new Date());

  await platformDb.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { schoolId: params.schoolId },
      data: {
        status: params.status,
        note: params.note ?? subscription.note,
        cancelledAt: params.status === 'CANCELLED' ? new Date() : null,
      },
    });
    await tx.school.update({
      where: { id: params.schoolId },
      data: { status: schoolStatus },
    });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'platform.subscription.status',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary: `${subscription.school.name}: subscription ${subscription.status} → ${params.status}, school now ${schoolStatus}.${params.note ? ` ${params.note}` : ''}`,
  });

  return {
    ok: true,
    message:
      schoolStatus === 'SUSPENDED'
        ? 'Subscription cancelled. Nobody at that school can sign in.'
        : `Subscription set to ${params.status.toLowerCase()}. The school is ${schoolStatus.toLowerCase()}.`,
  };
}

/** Finish provisioning: the school opens to everybody. */
export async function activateSchool(params: {
  schoolId: string;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const school = await platformDb.school.findUnique({
    where: { id: params.schoolId },
    include: { subscription: true },
  });
  if (!school) return { ok: false, message: 'School not found.' };

  const status = school.subscription
    ? schoolStatusFor(
        school.subscription.status as SubscriptionStatus,
        school.subscription.trialEndsAt,
        new Date(),
      )
    : 'ACTIVE';

  await platformDb.school.update({ where: { id: params.schoolId }, data: { status } });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'platform.school.activate',
    entityType: 'School',
    entityId: params.schoolId,
    summary: `${school.name} opened to all users (${status}).`,
  });

  return { ok: true, message: `${school.name} is now open to staff and students.` };
}

export async function setPlan(params: {
  schoolId: string;
  planId: string;
  seatOverrideStudents?: number | null;
  seatOverrideStaff?: number | null;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const [subscription, plan] = await Promise.all([
    platformDb.subscription.findUnique({ where: { schoolId: params.schoolId } }),
    platformDb.plan.findUnique({ where: { id: params.planId } }),
  ]);
  if (!subscription) return { ok: false, message: 'That school has no subscription.' };
  if (!plan) return { ok: false, message: 'That plan no longer exists.' };

  await platformDb.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { schoolId: params.schoolId },
      data: {
        planId: plan.id,
        seatOverrideStudents: params.seatOverrideStudents ?? null,
        seatOverrideStaff: params.seatOverrideStaff ?? null,
      },
    });
    await tx.school.update({ where: { id: params.schoolId }, data: { plan: plan.code } });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'platform.subscription.plan',
    entityType: 'Subscription',
    entityId: subscription.id,
    summary: `Plan set to ${plan.code}.`,
  });

  return { ok: true, message: `Plan changed to ${plan.name}.` };
}

// -----------------------------------------------------------------------------
// Subscription invoices
// -----------------------------------------------------------------------------

function pad(n: number, width = 6): string {
  return String(n).padStart(width, '0');
}

/**
 * `SUB-GEU-2026-000001`. Same shape as the student-facing `INV-` numbers and
 * for the same reason — a number a person can read down a phone line and say
 * which institution it belongs to — but a distinct prefix, because a vendor
 * invoice to the school and a school invoice to a student are different
 * documents that a bursar must never confuse.
 *
 * Counted rather than sequenced, with the UNIQUE on `reference` as the net.
 * Volume here is a handful of rows per school per year.
 */
async function nextSubscriptionReference(schoolCode: string, year: number): Promise<string> {
  const prefix = `SUB-${schoolCode.toUpperCase()}-${year}-`;
  const count = await platformDb.subscriptionInvoice.count({
    where: { reference: { startsWith: prefix } },
  });
  return `${prefix}${pad(count + 1)}`;
}

/**
 * Raise the next period's invoice.
 *
 * Priced from the plan at the moment of raising, and the price is COPIED onto
 * the line rather than referenced. An invoice is a historical document: if the
 * plan's price changes next year, last year's invoice must still say what was
 * actually charged. This is the same rule the student finance engine follows
 * for fee items.
 */
export async function raiseSubscriptionInvoice(params: {
  schoolId: string;
  periodStart: Date;
  periodEnd: Date;
  dueInDays?: number;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string; invoiceId?: string }> {
  const subscription = await platformDb.subscription.findUnique({
    where: { schoolId: params.schoolId },
    include: { plan: true, school: { select: { code: true, name: true } } },
  });
  if (!subscription) return { ok: false, message: 'That school has no subscription.' };

  if (params.periodEnd.getTime() <= params.periodStart.getTime()) {
    return { ok: false, message: 'The period must end after it starts.' };
  }

  const { plan, school } = subscription;
  // getUTCFullYear, NOT getFullYear. A period starting 2026-01-01 arrives as
  // UTC midnight, and server-local reckoning puts that in 2025 on any host
  // behind UTC — so the same invoice would be numbered differently depending
  // on which machine raised it. This is a vendor document with no school
  // timezone to consult, so UTC is the one reckoning that cannot drift.
  const reference = await nextSubscriptionReference(
    school.code,
    params.periodStart.getUTCFullYear(),
  );
  const dueAt = new Date(Date.now() + (params.dueInDays ?? 14) * 86_400_000);

  try {
    const invoice = await platformDb.$transaction(async (tx) => {
      const created = await tx.subscriptionInvoice.create({
        data: {
          schoolId: params.schoolId,
          subscriptionId: subscription.id,
          reference,
          status: 'ISSUED',
          currencyCode: plan.currencyCode,
          subtotalMinor: plan.priceMinor,
          taxMinor: 0,
          totalMinor: plan.priceMinor,
          paidMinor: 0,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          issuedAt: new Date(),
          dueAt,
        },
      });

      await tx.subscriptionInvoiceLine.create({
        data: {
          invoiceId: created.id,
          description: `${plan.name} — ${plan.billingPeriod.toLowerCase()} subscription`,
          quantity: 1,
          unitMinor: plan.priceMinor,
          amountMinor: plan.priceMinor,
          position: 0,
        },
      });

      // Raising the invoice is what ends a trial. Doing it here rather than on
      // a timer means a school is never quietly moved off a trial nobody
      // invoiced them for.
      if (subscription.status === 'TRIALING') {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'ACTIVE', renewsAt: params.periodEnd },
        });
        await tx.school.update({
          where: { id: params.schoolId },
          data: { status: 'ACTIVE' },
        });
      } else {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { renewsAt: params.periodEnd },
        });
      }

      return created;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'platform.invoice.raise',
      entityType: 'SubscriptionInvoice',
      entityId: invoice.id,
      summary: `Raised ${reference} for ${school.name}: ${plan.priceMinor} ${plan.currencyCode} minor units.`,
    });

    return { ok: true, message: `Invoice ${reference} raised.`, invoiceId: invoice.id };
  } catch (error) {
    console.error('[platform] invoice failed', error);
    return { ok: false, message: 'Could not raise the invoice. Nothing was changed.' };
  }
}

/**
 * Record a payment against a subscription invoice.
 *
 * Accepts a partial amount and says so: a school that pays two thirds is
 * PARTIALLY_PAID, not PAID and not unpaid. Rounding a part-payment up to PAID
 * loses money; treating it as nothing loses the record of what arrived.
 */
export async function recordSubscriptionPayment(params: {
  invoiceId: string;
  /**
   * MAJOR units, as a person typed them. Converted here rather than at the
   * form, because only this function knows the invoice's currency and so its
   * exponent — a browser multiplying by 100 would inflate a payment in a
   * zero-decimal currency a hundredfold.
   */
  amountMajor: number;
  method: string;
  reference?: string | null;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const invoice = await platformDb.subscriptionInvoice.findUnique({
    where: { id: params.invoiceId },
  });
  if (!invoice) return { ok: false, message: 'That invoice does not exist.' };
  if (invoice.status === 'VOID') return { ok: false, message: 'That invoice was voided.' };
  if (!Number.isFinite(params.amountMajor) || params.amountMajor <= 0) {
    return { ok: false, message: 'Enter an amount greater than zero.' };
  }

  const amountMinor = toMinor(params.amountMajor, currencyFor(invoice.currencyCode));
  const paidMinor = invoice.paidMinor + amountMinor;
  const settled = paidMinor >= invoice.totalMinor;

  await platformDb.$transaction(async (tx) => {
    await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor,
        status: settled ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: settled ? new Date() : null,
        paymentMethod: params.method,
        paymentReference: params.reference ?? null,
      },
    });

    // A payment clears a past-due state; it does not by itself reinstate a
    // school somebody cancelled, which stays an explicit operator decision.
    if (settled) {
      const subscription = await tx.subscription.findUnique({
        where: { id: invoice.subscriptionId },
      });
      if (subscription && subscription.status === 'PAST_DUE') {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'ACTIVE' },
        });
      }
    }
  });

  void recordAudit({
    schoolId: invoice.schoolId,
    actorId: params.actorUserId,
    action: 'platform.invoice.payment',
    entityType: 'SubscriptionInvoice',
    entityId: invoice.id,
    summary: `${amountMinor} ${invoice.currencyCode} minor units received against ${invoice.reference} (${params.method}). Now ${settled ? 'PAID' : 'PARTIALLY_PAID'}.`,
  });

  return {
    ok: true,
    message: settled
      ? `${invoice.reference} is paid in full.`
      : `Part payment recorded against ${invoice.reference}.`,
  };
}

/** Remove the seeded demo schools and operator account, leaving every real school alone. */
export async function clearDemoData(params: {
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string; schoolsRemoved: number; usersRemoved: number }> {
  const demoSlugs = Array.from(DEMO_SCHOOL_SLUGS);
  const schoolRows = await platformDb.school.findMany({
    where: { slug: { in: demoSlugs } },
    select: { id: true },
  });
  const schoolIds = schoolRows.map((school) => school.id);

  if (schoolIds.length === 0) {
    const demoOperator = await platformDb.user.findUnique({
      where: { email: DEMO_OPERATOR_EMAIL },
      select: { id: true },
    });
    if (!demoOperator) {
      return { ok: false, message: 'No demo schools or demo operator account to clear.', schoolsRemoved: 0, usersRemoved: 0 };
    }
  }

  const result = await platformDb.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({
      where: { schoolId: { in: schoolIds } },
    });

    const removedUsers = await tx.user.deleteMany({
      where: {
        OR: [
          { email: DEMO_OPERATOR_EMAIL },
          { memberships: { some: { school: { slug: { in: demoSlugs } } } } },
        ],
      },
    });

    if (schoolIds.length > 0) {
      await tx.school.deleteMany({ where: { id: { in: schoolIds } } });
    }

    return {
      schoolsRemoved: schoolIds.length,
      usersRemoved: removedUsers.count,
    };
  });

  void recordAudit({
    schoolId: null,
    actorId: params.actorUserId,
    action: 'platform.demo.clear',
    entityType: 'School',
    entityId: 'demo-reset',
    summary: `Cleared demo data (${result.schoolsRemoved} schools, ${result.usersRemoved} demo users removed).`,
  });

  return {
    ok: true,
    message:
      result.schoolsRemoved > 0 || result.usersRemoved > 0
        ? 'Demo school data has been removed. Real schools and operator accounts were left alone.'
        : 'No demo data remained, so there was nothing to clear.',
    schoolsRemoved: result.schoolsRemoved,
    usersRemoved: result.usersRemoved,
  };
}

/** Grant or revoke the platform-operator grant. */
export async function setPlatformAdmin(params: {
  userId: string;
  grant: boolean;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const user = await platformDb.user.findUnique({
    where: { id: params.userId },
    include: { platformAdmin: true },
  });
  if (!user) return { ok: false, message: 'That account does not exist.' };

  if (params.grant && !user.platformAdmin) {
    await platformDb.platformAdmin.create({ data: { userId: user.id } });
  } else if (!params.grant && user.platformAdmin) {
    // The last operator must not be able to remove themselves — there would be
    // no way back in short of a database console.
    const remaining = await platformDb.platformAdmin.count();
    if (remaining <= 1) {
      return { ok: false, message: 'That is the only platform operator. Grant another before revoking this one.' };
    }
    await platformDb.platformAdmin.delete({ where: { userId: user.id } });
  }

  void recordAudit({
    schoolId: null,
    actorId: params.actorUserId,
    action: params.grant ? 'platform.admin.grant' : 'platform.admin.revoke',
    entityType: 'User',
    entityId: user.id,
    summary: `Platform operator ${params.grant ? 'granted to' : 'revoked from'} ${user.email}.`,
  });

  return {
    ok: true,
    message: params.grant
      ? `${user.email} is now a platform operator.`
      : `${user.email} is no longer a platform operator.`,
  };
}

/**
 * Issue a fresh one-time password for a school's OWNER.
 *
 * The one credential nobody else can recover. A school's own `/people` page can
 * reset anybody's password, but the owner has to be able to sign in to use it —
 * so an owner who loses the password shown once at provisioning is locked out
 * of their institution permanently, with nobody above them to ask. That is not
 * a hypothetical: it is the first thing that happens when somebody provisions a
 * school, closes the tab, and comes back tomorrow.
 *
 * Deliberately restricted to OWNER. Reissuing a lecturer's password is the
 * school office's business and it has a page for it; the platform operator
 * reaching past a customer's own administration into arbitrary staff accounts
 * is a much larger power than the problem needs.
 */
export async function reissueOwnerPassword(params: {
  schoolId: string;
  actorUserId: string | null;
}): Promise<{ ok: boolean; message: string; temporaryPassword?: string; email?: string }> {
  const school = await platformDb.school.findUnique({
    where: { id: params.schoolId },
    select: { id: true, name: true },
  });
  if (!school) return { ok: false, message: 'School not found.' };

  const owner = await platformDb.membership.findFirst({
    where: { schoolId: params.schoolId, role: 'OWNER' },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    return {
      ok: false,
      message: `${school.name} has no owner account. Provision one before resetting anything.`,
    };
  }

  const temporaryPassword = formatTemporaryPassword(randomBytes(32));
  await platformDb.user.update({
    where: { id: owner.userId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      // Forces them onto /account/password before anything else, so a password
      // read aloud across a desk does not become the account's real one.
      mustChangePassword: true,
    },
  });

  // Any half-finished email confirmation is abandoned: it was authorised by a
  // password that no longer exists.
  await platformDb.accountChangeRequest.deleteMany({
    where: { userId: owner.userId, consumedAt: null },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'platform.owner.password.reissue',
    entityType: 'User',
    entityId: owner.userId,
    // What happened, by whom, to whom — never the secret itself.
    summary: `Platform operator reissued the owner password for ${school.name} (${owner.user.email ?? owner.user.id}).`,
  });

  return {
    ok: true,
    message: `New one-time password for ${owner.user.firstName} ${owner.user.lastName}. It cannot be shown again.`,
    temporaryPassword,
    email: owner.user.email ?? undefined,
  };
}
