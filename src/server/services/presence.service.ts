import { Prisma } from '@prisma/client';

import { dbFor } from '@/lib/tenant';
import { toLocalDate } from '@/lib/domain/time';
import {
  autoCloseAt,
  evaluateClose,
  minutesBetween,
  summariseTeaching,
  summariseTimesheet,
  validateCorrection,
  validateTeachingLog,
  type TeachingDraft,
} from '@/lib/domain/presence';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * PRESENCE
 * =============================================================================
 *
 * Signing in and out of the building, and recording what was taught.
 *
 * One mechanism covers staff and students because it is keyed on `Membership`,
 * which is the row that already means "this person, at this school, in this
 * capacity". A lecturer's shift and a student's attendance at the library are
 * the same shape of fact.
 *
 * THE UNIQUE INDEX ON `openKey` IS THE REAL ENFORCEMENT. It holds the
 * membership id while a session is open and NULL once closed, and NULLs are
 * distinct in a unique index on both engines — so "one open session per
 * person" is a database constraint rather than a check that races. A
 * double-tapped button raises P2002 instead of opening a second session.
 */

export interface PresenceResult {
  ok: boolean;
  message: string;
  sessionId?: string;
  /** Present after a successful sign-out. */
  minutes?: number;
}

/** The school's own calendar day, which is the only correct answer. */
async function schoolDay(schoolId: string, at: Date): Promise<{ localDate: string; tz: string }> {
  const db = dbFor(schoolId);
  const school = await db.school.findFirst({ select: { timezone: true } });
  const tz = school?.timezone ?? 'UTC';
  return { localDate: toLocalDate(at, tz), tz };
}

// -----------------------------------------------------------------------------
// Signing in and out
// -----------------------------------------------------------------------------

export async function signIn(params: {
  schoolId: string;
  membershipId: string;
  now?: Date;
  source?: 'SELF' | 'OFFICE';
  note?: string | null;
  actorUserId: string;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const membership = await db.membership.findUnique({ where: { id: params.membershipId } });
  if (!membership) return { ok: false, message: 'That person is not a member of this school.' };
  if (membership.status === 'SUSPENDED') {
    return { ok: false, message: 'A suspended member cannot sign in.' };
  }

  const { localDate } = await schoolDay(params.schoolId, now);

  try {
    const session = await db.presenceSession.create({
      data: {
        schoolId: params.schoolId,
        membershipId: membership.id,
        localDate,
        startedAt: now,
        status: 'OPEN',
        startSource: params.source ?? 'SELF',
        // The constraint that makes a second open session impossible.
        openKey: membership.id,
        note: params.note?.trim() || null,
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'presence.signin',
      entityType: 'PresenceSession',
      entityId: session.id,
      summary: `Signed in at ${now.toISOString()} (${localDate}).`,
    });

    return { ok: true, message: 'Signed in.', sessionId: session.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Not an error the user caused — they are already signed in, which is
      // the state they were trying to reach.
      return { ok: false, message: 'You are already signed in. Sign out first.' };
    }
    console.error('[presence] sign-in failed', error);
    return { ok: false, message: 'Could not sign in.' };
  }
}

export async function signOut(params: {
  schoolId: string;
  membershipId: string;
  now?: Date;
  source?: 'SELF' | 'OFFICE';
  actorUserId: string;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const open = await db.presenceSession.findFirst({
    where: { membershipId: params.membershipId, status: 'OPEN' },
  });
  if (!open) return { ok: false, message: 'You are not signed in.' };

  const verdict = evaluateClose(
    { id: open.id, startedAt: open.startedAt, localDate: open.localDate },
    now,
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  await db.presenceSession.update({
    where: { id: open.id },
    data: {
      endedAt: now,
      durationMinutes: verdict.minutes,
      status: 'CLOSED',
      endSource: params.source ?? 'SELF',
      // Releasing the key is what allows the next sign-in.
      openKey: null,
    },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'presence.signout',
    entityType: 'PresenceSession',
    entityId: open.id,
    summary: `Signed out after ${verdict.minutes} minutes.`,
  });

  return { ok: true, message: 'Signed out.', sessionId: open.id, minutes: verdict.minutes };
}

/** The person's own open session, if any. */
export async function currentSession(schoolId: string, membershipId: string) {
  return dbFor(schoolId).presenceSession.findFirst({
    where: { membershipId, status: 'OPEN' },
  });
}

// -----------------------------------------------------------------------------
// The office's overrides
// -----------------------------------------------------------------------------

/**
 * Correct a session, and record that it was corrected.
 *
 * The correction row is written in the SAME transaction as the change. A
 * correction that could be applied without its trail would be exactly the
 * thing the trail exists to prevent.
 */
export async function correctSession(params: {
  schoolId: string;
  sessionId: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  reason: string;
  correctedByMembershipId: string;
  actorUserId: string;
  now?: Date;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const session = await db.presenceSession.findUnique({ where: { id: params.sessionId } });
  if (!session) return { ok: false, message: 'That session is not part of this school.' };

  const problems = validateCorrection({
    reason: params.reason,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    now,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const startedAt = params.startedAt ?? session.startedAt;
  const endedAt = params.endedAt ?? session.endedAt;

  if (endedAt && endedAt.getTime() < startedAt.getTime()) {
    return { ok: false, message: 'The sign-out time must be after the sign-in time.' };
  }

  const duration = endedAt ? minutesBetween(startedAt, endedAt) : null;

  await db.$transaction(async (tx) => {
    const changes: { field: string; previous: string | null; next: string | null }[] = [];

    if (params.startedAt && params.startedAt.getTime() !== session.startedAt.getTime()) {
      changes.push({
        field: 'STARTED_AT',
        previous: session.startedAt.toISOString(),
        next: params.startedAt.toISOString(),
      });
    }
    if (params.endedAt && params.endedAt.getTime() !== (session.endedAt?.getTime() ?? -1)) {
      changes.push({
        field: 'ENDED_AT',
        previous: session.endedAt?.toISOString() ?? null,
        next: params.endedAt.toISOString(),
      });
    }

    await tx.presenceSession.update({
      where: { id: session.id },
      data: {
        startedAt,
        endedAt,
        durationMinutes: duration,
        // Closing it by hand makes it CLOSED, not AUTO_CLOSED: somebody has now
        // stated the time, so it is a fact rather than an assumption.
        status: endedAt ? 'CLOSED' : session.status,
        endSource: endedAt ? 'OFFICE' : session.endSource,
        openKey: endedAt ? null : session.openKey,
      },
    });

    for (const change of changes) {
      await tx.presenceCorrection.create({
        data: {
          schoolId: params.schoolId,
          sessionId: session.id,
          field: change.field,
          previousValue: change.previous,
          newValue: change.next,
          reason: params.reason.trim(),
          correctedById: params.correctedByMembershipId,
        },
      });
    }
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'presence.correct',
    entityType: 'PresenceSession',
    entityId: session.id,
    summary: `Session corrected: ${params.reason.trim()}`,
  });

  return { ok: true, message: 'Session corrected.', sessionId: session.id, minutes: duration ?? undefined };
}

/**
 * Close every session left open past the cap.
 *
 * Marked AUTO_CLOSED and dated at the CAP rather than at the moment the sweep
 * runs — see `autoCloseAt`. Safe to run repeatedly.
 */
export async function sweepForgottenSessions(
  schoolId: string,
  now = new Date(),
): Promise<{ closed: number }> {
  const db = dbFor(schoolId);
  const open = await db.presenceSession.findMany({ where: { status: 'OPEN' } });

  let closed = 0;
  for (const session of open) {
    const verdict = evaluateClose(
      { id: session.id, startedAt: session.startedAt, localDate: session.localDate },
      now,
    );
    // Only the ones past the cap. A session opened an hour ago is somebody at
    // their desk, not somebody who forgot.
    if (verdict.allowed) continue;

    const endedAt = autoCloseAt(session.startedAt);
    await db.presenceSession.update({
      where: { id: session.id },
      data: {
        endedAt,
        durationMinutes: minutesBetween(session.startedAt, endedAt),
        status: 'AUTO_CLOSED',
        endSource: 'OFFICE',
        openKey: null,
      },
    });
    closed += 1;
  }

  return { closed };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/** One person's sessions over a date range, with totals. */
export async function timesheet(params: {
  schoolId: string;
  membershipId: string;
  from: string;
  to: string;
}) {
  const db = dbFor(params.schoolId);
  const sessions = await db.presenceSession.findMany({
    where: {
      membershipId: params.membershipId,
      localDate: { gte: params.from, lte: params.to },
    },
    orderBy: [{ localDate: 'desc' }, { startedAt: 'desc' }],
    include: { corrections: { orderBy: { createdAt: 'desc' } } },
  });

  return { sessions, totals: summariseTimesheet(sessions) };
}

/** Everybody in the building right now. */
export async function whoIsIn(schoolId: string) {
  const db = dbFor(schoolId);
  return db.presenceSession.findMany({
    where: { status: 'OPEN' },
    orderBy: { startedAt: 'asc' },
    include: {
      membership: {
        include: { user: { select: { firstName: true, lastName: true, email: true, username: true } } },
      },
    },
  });
}

// -----------------------------------------------------------------------------
// The teaching log
// -----------------------------------------------------------------------------

export async function logTeaching(params: {
  schoolId: string;
  membershipId: string;
  logId?: string | null;
  offeringId?: string | null;
  draft: TeachingDraft;
  note?: string | null;
  actorUserId: string;
}): Promise<PresenceResult> {
  const db = dbFor(params.schoolId);

  const problems = validateTeachingLog(params.draft);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // Re-read through the tenant client: a crafted id must not attach this
  // record to another university's section.
  if (params.offeringId) {
    const offering = await db.courseOffering.findUnique({ where: { id: params.offeringId } });
    if (!offering) return { ok: false, message: 'Choose a section from this school.' };
  }

  const durationMinutes = params.draft.endMinute - params.draft.startMinute;

  const data = {
    membershipId: params.membershipId,
    offeringId: params.offeringId ?? null,
    localDate: params.draft.localDate,
    startMinute: params.draft.startMinute,
    endMinute: params.draft.endMinute,
    durationMinutes,
    status: params.draft.status,
    topic: params.draft.topic?.trim() || null,
    note: params.note?.trim() || null,
    attended: params.draft.attended ?? null,
  };

  try {
    const log = params.logId
      ? await db.teachingLog.update({ where: { id: params.logId }, data })
      : await db.teachingLog.create({ data: { ...data, schoolId: params.schoolId } });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: params.logId ? 'teaching.update' : 'teaching.log',
      entityType: 'TeachingLog',
      entityId: log.id,
      summary: `${params.draft.status} on ${params.draft.localDate}, ${durationMinutes} minutes.`,
    });

    return { ok: true, message: 'Recorded.', sessionId: log.id, minutes: durationMinutes };
  } catch (error) {
    console.error('[teaching] log failed', error);
    return { ok: false, message: 'Could not record that.' };
  }
}

export async function deleteTeachingLog(params: {
  schoolId: string;
  logId: string;
  actorUserId: string;
}): Promise<PresenceResult> {
  const db = dbFor(params.schoolId);
  const log = await db.teachingLog.findUnique({ where: { id: params.logId } });
  if (!log) return { ok: false, message: 'That entry is not part of this school.' };

  await db.teachingLog.delete({ where: { id: log.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'teaching.delete',
    entityType: 'TeachingLog',
    entityId: log.id,
    summary: `Teaching entry for ${log.localDate} removed.`,
  });
  return { ok: true, message: 'Entry removed.' };
}

/** One lecturer's teaching over a range, with totals. */
export async function teachingLog(params: {
  schoolId: string;
  membershipId: string;
  from: string;
  to: string;
}) {
  const db = dbFor(params.schoolId);
  const rows = await db.teachingLog.findMany({
    where: {
      membershipId: params.membershipId,
      localDate: { gte: params.from, lte: params.to },
    },
    orderBy: [{ localDate: 'desc' }, { startMinute: 'desc' }],
    include: {
      offering: { include: { course: { select: { code: true, title: true } } } },
    },
  });

  return { rows, totals: summariseTeaching(rows) };
}

/** Hours taught per lecturer, for a head of department. */
export async function teachingByStaff(params: {
  schoolId: string;
  from: string;
  to: string;
}) {
  const db = dbFor(params.schoolId);
  const rows = await db.teachingLog.findMany({
    where: { localDate: { gte: params.from, lte: params.to } },
    include: {
      membership: {
        include: { user: { select: { firstName: true, lastName: true } } },
      },
    },
  });

  const byPerson = new Map<
    string,
    { name: string; membershipId: string; rows: typeof rows }
  >();

  for (const row of rows) {
    const key = row.membershipId;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        membershipId: key,
        name: `${row.membership.user.firstName} ${row.membership.user.lastName}`,
        rows: [],
      });
    }
    byPerson.get(key)!.rows.push(row);
  }

  return [...byPerson.values()]
    .map((person) => ({
      membershipId: person.membershipId,
      name: person.name,
      ...summariseTeaching(person.rows),
    }))
    .sort((a, b) => b.minutesTaught - a.minutesTaught);
}
