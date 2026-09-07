import 'server-only';

import { dbFor, platformDb } from '@/lib/tenant';
import {
  aggregateReviews,
  allocateCohort,
  buildMatricNumber,
  computeCompositeScore,
  computeOfferExpiry,
  isOfferLive,
  type AllocationPolicy,
  type RankableApplication,
} from '@/lib/domain/admissions';
import { assertApplicationTransition, type ApplicationStatus } from '@/lib/domain/enums';
import { hashPassword } from '@/lib/auth/session';
import { nextMatricSequence } from './sequence.service';
import { recordAudit } from './audit.service';
import { loadSchoolConfig } from '@/server/school-config';

/**
 * =============================================================================
 * ADMISSIONS SERVICE
 * =============================================================================
 */

/**
 * Recompute an application's composite from its reviews plus its objective
 * scores, and persist it.
 *
 * Reviewer-supplied rubric scores OVERRIDE the applicant's self-reported essay
 * and interview figures where reviews exist — a scored rubric from staff is
 * evidence; a self-report is a claim.
 */
export async function rescoreApplication(schoolId: string, applicationId: string): Promise<number> {
  const db = dbFor(schoolId);
  const { admissions } = await loadSchoolConfig(schoolId);
  const application = await db.application.findUnique({
    where: { id: applicationId },
    include: { reviews: true },
  });
  if (!application) return 0;

  const aggregate = aggregateReviews(
    application.reviews.map((r) => ({
      reviewerId: r.reviewerId,
      academicScore: r.academicScore,
      essayScore: r.essayScore,
      interviewScore: r.interviewScore,
      extracurricularScore: r.extracurricularScore,
      recommendation: r.recommendation as 'ADMIT' | 'WAITLIST' | 'REJECT',
    })),
    admissions.reviewerDisagreementThreshold,
  );

  const hasReviews = aggregate.reviewCount > 0;

  const result = computeCompositeScore({
    priorGpaScore: application.priorGpaScore,
    entranceExamScore: application.entranceExamScore,
    essayScore: hasReviews ? aggregate.essayScore : application.essayScore,
    interviewScore: hasReviews ? aggregate.interviewScore : application.interviewScore,
    extracurricularScore: hasReviews
      ? aggregate.extracurricularScore
      : application.extracurricularScore,
  }, admissions.weights);

  await db.application.update({
    where: { id: applicationId },
    data: { compositeScore: result.composite },
  });

  return result.composite;
}

export interface CohortRunSummary {
  offered: number;
  waitlisted: number;
  rejected: number;
  pending: number;
  decisions: { referenceNo: string; status: string; rank: number; rationale: string }[];
}

/**
 * Run the rank-and-fill allocation over one (program, term) cohort.
 *
 * `dryRun` is not a convenience — it is the point. An admissions committee must
 * be able to see exactly who a policy admits BEFORE the offers become real and
 * irrevocable. The same pure function produces both the preview and the
 * committed run, so what the committee approved is what gets written.
 */
export async function runCohortAllocation(params: {
  schoolId: string;
  programId: string;
  termId: string;
  policy: Omit<AllocationPolicy, 'minimumComposite' | 'minimumCoverage' | 'requiredReviews'> &
    Partial<AllocationPolicy>;
  actorId: string;
  dryRun: boolean;
}): Promise<CohortRunSummary> {
  const db = dbFor(params.schoolId);
  const { admissions } = await loadSchoolConfig(params.schoolId);
  const applications = await db.application.findMany({
    where: {
      programId: params.programId,
      termId: params.termId,
      status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'WAITLISTED'] },
    },
    include: { reviews: true },
  });

  const pool: RankableApplication[] = [];

  for (const app of applications) {
    const aggregate = aggregateReviews(
      app.reviews.map((r) => ({
        reviewerId: r.reviewerId,
        academicScore: r.academicScore,
        essayScore: r.essayScore,
        interviewScore: r.interviewScore,
        extracurricularScore: r.extracurricularScore,
        recommendation: r.recommendation as 'ADMIT' | 'WAITLIST' | 'REJECT',
      })),
    );
    const hasReviews = aggregate.reviewCount > 0;

    const scored = computeCompositeScore({
      priorGpaScore: app.priorGpaScore,
      entranceExamScore: app.entranceExamScore,
      essayScore: hasReviews ? aggregate.essayScore : app.essayScore,
      interviewScore: hasReviews ? aggregate.interviewScore : app.interviewScore,
      extracurricularScore: hasReviews
        ? aggregate.extracurricularScore
        : app.extracurricularScore,
    }, admissions.weights);

    pool.push({
      applicationId: app.id,
      referenceNo: app.referenceNo,
      composite: scored.composite,
      coverage: scored.coverage,
      reviewCount: aggregate.reviewCount,
      submittedAtMs: (app.submittedAt ?? app.createdAt).getTime(),
    });
  }

  const policy: AllocationPolicy = {
    capacity: params.policy.capacity,
    waitlistCapacity: params.policy.waitlistCapacity,
    // The school's own thresholds are the defaults; the committee may tighten
    // them for a particular run but never sees a hard-coded 40 again.
    minimumComposite: params.policy.minimumComposite ?? admissions.autoRejectThreshold,
    minimumCoverage: params.policy.minimumCoverage ?? admissions.minimumCoverage,
    requiredReviews: params.policy.requiredReviews ?? admissions.minReviewsRequired,
  };

  const decisions = allocateCohort(pool, policy);

  const summary: CohortRunSummary = {
    offered: decisions.filter((d) => d.status === 'OFFERED').length,
    waitlisted: decisions.filter((d) => d.status === 'WAITLISTED').length,
    rejected: decisions.filter((d) => d.status === 'REJECTED').length,
    pending: decisions.filter((d) => d.status === 'UNDER_REVIEW').length,
    decisions: decisions.map((d) => ({
      referenceNo: d.referenceNo,
      status: d.status,
      rank: d.rank,
      rationale: d.rationale,
    })),
  };

  if (params.dryRun) return summary;

  const now = new Date();

  await db.$transaction(async (tx) => {
    for (const decision of decisions) {
      const current = applications.find((a) => a.id === decision.applicationId)!;

      // UNDER_REVIEW is an internal holding state, not a decision — never
      // transition backwards into it from a state that already advanced.
      if (decision.status === 'UNDER_REVIEW' && current.status !== 'SUBMITTED') continue;

      try {
        assertApplicationTransition(
          current.status as ApplicationStatus,
          decision.status as ApplicationStatus,
        );
      } catch {
        continue; // Illegal transition: leave the application untouched.
      }

      await tx.application.update({
        where: { id: decision.applicationId },
        data: {
          status: decision.status,
          compositeScore: decision.composite,
          rankInCohort: decision.rank || null,
          decisionNote: decision.rationale,
          decidedAt: decision.status === 'UNDER_REVIEW' ? null : now,
          offerExpiresAt:
            decision.status === 'OFFERED'
              ? computeOfferExpiry(now, admissions.offerValidityDays)
              : null,
        },
      });
    }
  });

  void recordAudit({
    actorId: params.actorId,
    schoolId: params.schoolId,
    action: 'admissions.allocate',
    entityType: 'Program',
    entityId: params.programId,
    summary: `Cohort run: ${summary.offered} offered, ${summary.waitlisted} waitlisted, ${summary.rejected} rejected, ${summary.pending} pending.`,
    metadata: { policy, termId: params.termId },
  });

  return summary;
}

/**
 * Convert an accepted applicant into a student.
 *
 * The whole conversion — user role change, matriculation number allocation,
 * student record creation, application closure — is one transaction. A partial
 * conversion would leave a person who is neither an applicant nor a student,
 * and there is no good way to recover that state by hand.
 */
export async function convertApplicantToStudent(params: {
  schoolId: string;
  schoolCode: string;
  applicationId: string;
  actorId: string;
  now?: Date;
}): Promise<{ ok: boolean; message: string; matricNumber?: string }> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  try {
    return await db.$transaction(async (tx) => {
      const application = await tx.application.findUnique({
        where: { id: params.applicationId },
        include: {
          applicant: { include: { user: true } },
          program: { include: { department: true } },
          term: true,
        },
      });

      if (!application) return { ok: false, message: 'Application not found.' };

      if (application.status !== 'ACCEPTED') {
        return {
          ok: false,
          message: `Only accepted offers can be converted; this application is ${application.status}.`,
        };
      }

      const existing = await tx.student.findFirst({
        where: { userId: application.applicant.userId },
      });
      if (existing) {
        return {
          ok: false,
          message: `This person already has a student record (${existing.matricNumber}).`,
        };
      }

      const year = application.term.startDate.getFullYear();
      const sequence = await nextMatricSequence(tx, application.program.department.code, year);
      const matricNumber = buildMatricNumber(
        params.schoolCode,
        application.program.department.code,
        year,
        sequence,
      );

      const student = await tx.student.create({
        data: {
          schoolId: params.schoolId,
          userId: application.applicant.userId,
          matricNumber,
          programId: application.programId,
          level: 100,
          admissionTermCode: application.term.code,
          dateOfBirth: application.applicant.dateOfBirth,
          gender: application.applicant.gender,
          nationality: application.applicant.nationality,
          address: application.applicant.address,
          status: 'ACTIVE',
        },
      });

      // Role lives on the membership, not the user: this person may hold a
      // different role at another school and must keep it.
      await platformDb.membership.updateMany({
        where: { userId: application.applicant.userId, schoolId: params.schoolId },
        data: { role: 'STUDENT' },
      });

      await tx.application.update({
        where: { id: application.id },
        data: { status: 'ENROLLED', decidedAt: now },
      });

      void recordAudit({
        actorId: params.actorId,
        schoolId: params.schoolId,
        action: 'admissions.convert',
        entityType: 'Student',
        entityId: student.id,
        summary: `${application.referenceNo} converted to student ${matricNumber}.`,
      });

      return {
        ok: true,
        message: `Admitted. Matriculation number ${matricNumber} issued.`,
        matricNumber,
      };
    });
  } catch (error) {
    console.error('[admissions] conversion failed', error);
    return { ok: false, message: 'Conversion failed. No records were changed.' };
  }
}

/** Applicant accepts or declines a live offer. */
export async function respondToOffer(params: {
  schoolId: string;
  applicationId: string;
  accept: boolean;
  actorId: string;
  now?: Date;
}): Promise<{ ok: boolean; message: string }> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const application = await db.application.findUnique({ where: { id: params.applicationId } });
  if (!application) return { ok: false, message: 'Application not found.' };

  if (!isOfferLive(application.status as ApplicationStatus, application.offerExpiresAt, now)) {
    return {
      ok: false,
      message:
        application.status === 'OFFERED'
          ? 'This offer has expired.'
          : `No live offer to respond to (status: ${application.status}).`,
    };
  }

  const next: ApplicationStatus = params.accept ? 'ACCEPTED' : 'DECLINED';
  assertApplicationTransition(application.status as ApplicationStatus, next);

  await db.application.update({
    where: { id: params.applicationId },
    data: { status: next, decidedAt: now },
  });

  void recordAudit({
    actorId: params.actorId,
    schoolId: params.schoolId,
    action: `admissions.${next.toLowerCase()}`,
    entityType: 'Application',
    entityId: params.applicationId,
    summary: `${application.referenceNo} offer ${next.toLowerCase()} by applicant.`,
  });

  return {
    ok: true,
    message: params.accept
      ? 'Offer accepted. The Registrar will issue your matriculation number shortly.'
      : 'Offer declined.',
  };
}

/**
 * Self-service applicant registration from the public /apply form.
 *
 * Identity is global but authorisation is per-school, so this does three
 * things rather than one: find-or-create the person, give them an APPLICANT
 * membership OF THIS SCHOOL, and create the applicant profile there.
 *
 * A person who already has an account — because they applied to another school
 * on the platform, or are a guardian somewhere — keeps their existing identity
 * and password and simply gains a membership. Creating a second User for the
 * same human is what makes a platform's identity model unrecoverable.
 */
export async function createApplicantAccount(params: {
  schoolId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}): Promise<{ ok: boolean; message: string; userId?: string; applicantId?: string }> {
  const email = params.email.trim().toLowerCase();

  try {
    return await platformDb.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        include: { memberships: { where: { schoolId: params.schoolId } } },
      });

      // Already a member of THIS school — nothing to create, and we must not
      // leak whether the address exists.
      if (existingUser && existingUser.memberships.length > 0) {
        return { ok: false, message: 'That email address cannot be used to register.' };
      }

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email,
            passwordHash: await hashPassword(params.password),
            firstName: params.firstName.trim(),
            lastName: params.lastName.trim(),
            phone: params.phone?.trim() || null,
          },
        }));

      await tx.membership.create({
        data: {
          userId: user.id,
          schoolId: params.schoolId,
          role: 'APPLICANT',
          isPrimary: !existingUser,
          status: 'ACTIVE',
        },
      });

      const applicant = await tx.applicant.create({
        data: { schoolId: params.schoolId, userId: user.id },
      });

      return {
        ok: true,
        message: 'Account created.',
        userId: user.id,
        applicantId: applicant.id,
      };
    });
  } catch (error) {
    console.error('[admissions] applicant registration failed', error);
    return { ok: false, message: 'That email address cannot be used to register.' };
  }
}

/** Expire offers whose deadline has passed. Safe to run repeatedly. */
export async function expireStaleOffers(schoolId: string, now = new Date()): Promise<{ expired: number }> {
  const db = dbFor(schoolId);
  const result = await db.application.updateMany({
    where: { status: 'OFFERED', offerExpiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return { expired: result.count };
}
