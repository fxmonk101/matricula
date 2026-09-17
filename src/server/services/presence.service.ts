import { Prisma } from '@prisma/client';

import { dbFor } from '@/lib/tenant';
import { toLocalDate } from '@/lib/domain/time';
import {
  BREAK_IS_PAID,
  autoCloseAt,
  evaluateBreakClose,
  evaluateClose,
  minutesBetween,
  netMinutes,
  summariseTeaching,
  summariseTimesheet,
  unpaidBreakMinutes,
  validateBreakStart,
  validateCorrection,
  validateSignIn,
  validateSignOut,
  validateSignature,
  validateTeachingLog,
  type BreakKind,
  type BreakRow,
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
// Who the register thinks this person is
// -----------------------------------------------------------------------------

export interface PresenceIdentity {
  /** The number this person signs with, or null if they have none. */
  identifier: string | null;
  /** What to call the number, since a student and a lecturer carry different ones. */
  identifierLabel: string;
  /** Their department or faculty, prefilled for them to confirm. */
  unit: string | null;
}

/**
 * Resolve what a person should be typing when they sign the register.
 *
 * The fallback chain matters, and it has to reach everybody. A bursar and a
 * registrar have neither a matric number nor a staff number — they have no
 * profile row at all — and a register that only knows how to identify students
 * and lecturers would lock the office out of the building it runs. So it falls
 * through to the username, and then to the email address, which every account
 * has. See the note on the last branch for why that last step is not optional.
 */
export async function presenceIdentity(
  schoolId: string,
  membershipId: string,
): Promise<PresenceIdentity> {
  const db = dbFor(schoolId);

  const membership = await db.membership.findUnique({
    where: { id: membershipId },
    include: {
      user: { select: { id: true, username: true, email: true } },
      orgUnit: { select: { name: true } },
    },
  });
  if (!membership) return { identifier: null, identifierLabel: 'Identifier', unit: null };

  const [student, instructor] = await Promise.all([
    db.student.findFirst({
      where: { userId: membership.userId },
      include: { program: { include: { department: { include: { faculty: true } } } } },
    }),
    db.instructor.findFirst({
      where: { userId: membership.userId },
      include: { department: { include: { faculty: true } } },
    }),
  ]);

  if (student) {
    return {
      identifier: student.matricNumber,
      identifierLabel: 'Matriculation number',
      unit: student.program?.department?.name ?? null,
    };
  }
  if (instructor) {
    return {
      identifier: instructor.staffNumber,
      identifierLabel: 'Staff number',
      unit: instructor.department?.name ?? null,
    };
  }

  /*
   * EVERY MEMBER MUST HAVE SOMETHING TO SIGN WITH.
   *
   * Falling back only as far as the username locked 23 of this school's 49
   * members out of the register — the owner, the registrars, the bursar and the
   * librarian among them — because a username is optional and those accounts
   * were created before it existed. The message they got told them to ask the
   * office to add one, which is no help at all to the people who ARE the office
   * and have nobody above them to ask.
   *
   * The email address is the last resort rather than the first because it is
   * the least like a register entry, but it is a real identifier: it is unique,
   * it is what they signed in with, and they know it without looking it up.
   * Being checked against a weaker identifier is far better than being unable
   * to sign the register at all.
   */
  return {
    identifier: membership.user.username ?? membership.user.email,
    identifierLabel: membership.user.username ? 'Staff username' : 'Work email',
    unit: membership.orgUnit?.name ?? null,
  };
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
  /** The matriculation or staff number, as typed. Checked against the record. */
  identifierGiven?: string;
  /** Department or faculty, as given. Stored verbatim. */
  unitGiven?: string;
  /** An arrival time the person keyed in, instead of the clock's. */
  declaredAt?: Date | null;
  signature?: string | null;
  requireSignature?: boolean;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const membership = await db.membership.findUnique({ where: { id: params.membershipId } });
  if (!membership) return { ok: false, message: 'That person is not a member of this school.' };
  if (membership.status === 'SUSPENDED') {
    return { ok: false, message: 'A suspended member cannot sign in.' };
  }

  /*
   * THE ATTESTATION IS CHECKED AGAINST THE RECORD, not merely stored.
   *
   * The office signing somebody else in is the one case that skips the
   * identifier check, and it has to: the whole point of an office override is
   * that the person is not at the terminal to type their own number. It is
   * still audited, and `startSource` says OFFICE on the row forever.
   */
  const identity = await presenceIdentity(params.schoolId, membership.id);
  const selfService = (params.source ?? 'SELF') === 'SELF';

  const verdict = validateSignIn({
    identifierGiven: params.identifierGiven ?? '',
    expectedIdentifier: selfService ? identity.identifier : (params.identifierGiven ?? ''),
    unitGiven: params.unitGiven ?? identity.unit ?? '',
    declaredAt: params.declaredAt ?? null,
    signature: params.signature ?? null,
    now,
    requireSignature: params.requireSignature ?? false,
  });
  if (verdict.problems.length > 0) {
    return { ok: false, message: verdict.problems.join(' ') };
  }

  const startedAt = verdict.effectiveAt;
  // The day the shift belongs to is the day it STARTED, which is not always the
  // day the row was written — somebody signing in at 00:10 for a 23:50 arrival
  // is on yesterday's register.
  const { localDate } = await schoolDay(params.schoolId, startedAt);

  try {
    const session = await db.presenceSession.create({
      data: {
        schoolId: params.schoolId,
        membershipId: membership.id,
        localDate,
        startedAt,
        startDeclared: verdict.declared,
        status: 'OPEN',
        startSource: params.source ?? 'SELF',
        identifierGiven: params.identifierGiven?.trim() || identity.identifier,
        unitGiven: (params.unitGiven ?? identity.unit ?? '').trim() || null,
        signature: params.signature?.trim() || null,
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
      summary: verdict.declared
        ? `Signed in for a DECLARED time of ${startedAt.toISOString()} (${localDate}), recorded at ${now.toISOString()}.`
        : `Signed in at ${startedAt.toISOString()} (${localDate}).`,
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
  declaredAt?: Date | null;
  signature?: string | null;
  requireSignature?: boolean;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const open = await db.presenceSession.findFirst({
    where: { membershipId: params.membershipId, status: 'OPEN' },
    include: { breaks: true },
  });
  if (!open) return { ok: false, message: 'You are not signed in.' };

  const attestation = validateSignOut({
    declaredAt: params.declaredAt ?? null,
    signature: params.signature ?? null,
    startedAt: open.startedAt,
    now,
    requireSignature: params.requireSignature ?? false,
  });
  if (attestation.problems.length > 0) {
    return { ok: false, message: attestation.problems.join(' ') };
  }

  const endedAt = attestation.effectiveAt;

  const verdict = evaluateClose(
    { id: open.id, startedAt: open.startedAt, localDate: open.localDate },
    endedAt,
  );
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  /*
   * A BREAK STILL RUNNING IS CLOSED WITH THE SESSION, not treated as an error.
   *
   * Somebody who goes to lunch and then leaves for the day without coming back
   * to tap "end break" has done nothing wrong, and refusing their sign-out
   * would strand them signed in until the nightly sweep invented a departure
   * time for them. Closing it at the sign-out instant is the only reading of
   * those minutes that is both defensible and visible on the row.
   */
  const openBreak = open.breaks.find((b) => b.endedAt === null) ?? null;
  const closedBreaks: BreakRow[] = open.breaks.map((b) =>
    b.id === openBreak?.id
      ? { ...b, endedAt, minutes: minutesBetween(b.startedAt, endedAt) }
      : b,
  );

  const deducted = unpaidBreakMinutes(closedBreaks);
  const net = netMinutes(verdict.minutes ?? 0, closedBreaks);

  await db.$transaction(async (tx) => {
    if (openBreak) {
      await tx.presenceBreak.update({
        where: { id: openBreak.id },
        data: {
          endedAt,
          minutes: minutesBetween(openBreak.startedAt, endedAt),
          openKey: null,
          note: openBreak.note ?? 'Closed automatically when the session ended.',
        },
      });
    }

    await tx.presenceSession.update({
      where: { id: open.id },
      data: {
        endedAt,
        endDeclared: attestation.declared,
        durationMinutes: verdict.minutes,
        breakMinutes: deducted,
        netMinutes: net,
        status: 'CLOSED',
        endSource: params.source ?? 'SELF',
        endSignature: params.signature?.trim() || null,
        // Releasing the key is what allows the next sign-in.
        openKey: null,
      },
    });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'presence.signout',
    entityType: 'PresenceSession',
    entityId: open.id,
    summary: `Signed out after ${verdict.minutes} minutes, ${deducted} deducted for breaks, ${net} net.`,
  });

  return { ok: true, message: 'Signed out.', sessionId: open.id, minutes: net };
}

// -----------------------------------------------------------------------------
// Breaks
// -----------------------------------------------------------------------------

/**
 * Start a break inside the person's open session.
 *
 * Whether the break is paid is decided HERE and copied onto the row, rather
 * than read back through policy whenever a timesheet is rendered. A school that
 * stops paying lunch breaks next year must not thereby rewrite every timesheet
 * its staff have already been paid against.
 */
export async function startBreak(params: {
  schoolId: string;
  membershipId: string;
  kind: string;
  now?: Date;
  note?: string | null;
  actorUserId: string;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const open = await db.presenceSession.findFirst({
    where: { membershipId: params.membershipId, status: 'OPEN' },
    include: { breaks: true },
  });
  if (!open) return { ok: false, message: 'You are not signed in, so there is nothing to break from.' };

  const problems = validateBreakStart({
    kind: params.kind,
    at: now,
    sessionStartedAt: open.startedAt,
    sessionEndedAt: open.endedAt,
    existing: open.breaks,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const kind = params.kind as BreakKind;

  try {
    const row = await db.presenceBreak.create({
      data: {
        schoolId: params.schoolId,
        sessionId: open.id,
        kind,
        startedAt: now,
        paid: BREAK_IS_PAID[kind],
        // One open break per session, enforced at the database.
        openKey: open.id,
        note: params.note?.trim() || null,
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'presence.break.start',
      entityType: 'PresenceBreak',
      entityId: row.id,
      summary: `${kind} break started at ${now.toISOString()}.`,
    });

    return { ok: true, message: 'Break started.', sessionId: open.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, message: 'You are already on a break.' };
    }
    console.error('[presence] break start failed', error);
    return { ok: false, message: 'Could not start the break.' };
  }
}

/** End the break that is running, and put the person back on the clock. */
export async function endBreak(params: {
  schoolId: string;
  membershipId: string;
  now?: Date;
  actorUserId: string;
}): Promise<PresenceResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const open = await db.presenceSession.findFirst({
    where: { membershipId: params.membershipId, status: 'OPEN' },
    include: { breaks: true },
  });
  if (!open) return { ok: false, message: 'You are not signed in.' };

  const running = open.breaks.find((b) => b.endedAt === null);
  if (!running) return { ok: false, message: 'You are not on a break.' };

  const verdict = evaluateBreakClose(running, now);
  if (!verdict.allowed) return { ok: false, message: verdict.reason! };

  await db.presenceBreak.update({
    where: { id: running.id },
    data: { endedAt: now, minutes: verdict.minutes, openKey: null },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'presence.break.end',
    entityType: 'PresenceBreak',
    entityId: running.id,
    summary: `${running.kind} break ended after ${verdict.minutes} minutes.`,
  });

  return { ok: true, message: 'Back on the clock.', sessionId: open.id, minutes: verdict.minutes };
}

/** The break running right now, if there is one. */
export async function currentBreak(schoolId: string, membershipId: string) {
  const open = await dbFor(schoolId).presenceSession.findFirst({
    where: { membershipId, status: 'OPEN' },
    include: { breaks: { where: { endedAt: null }, take: 1 } },
  });
  return open?.breaks[0] ?? null;
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
  const open = await db.presenceSession.findMany({
    where: { status: 'OPEN' },
    include: { breaks: true },
  });

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
    const gross = minutesBetween(session.startedAt, endedAt);

    // A break left running on a forgotten session is closed at the same capped
    // instant, for the same reason: leaving it open would hold the break's
    // unique key and block the person from ever taking another one.
    const running = session.breaks.find((b) => b.endedAt === null) ?? null;
    const breaks: BreakRow[] = session.breaks.map((b) =>
      b.id === running?.id
        ? { ...b, endedAt, minutes: minutesBetween(b.startedAt, endedAt) }
        : b,
    );

    await db.$transaction(async (tx) => {
      if (running) {
        await tx.presenceBreak.update({
          where: { id: running.id },
          data: {
            endedAt,
            minutes: minutesBetween(running.startedAt, endedAt),
            openKey: null,
            note: running.note ?? 'Closed automatically with a forgotten session.',
          },
        });
      }

      await tx.presenceSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          durationMinutes: gross,
          breakMinutes: unpaidBreakMinutes(breaks),
          netMinutes: netMinutes(gross, breaks),
          status: 'AUTO_CLOSED',
          endSource: 'OFFICE',
          openKey: null,
        },
      });
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
    include: {
      corrections: { orderBy: { createdAt: 'desc' } },
      breaks: { orderBy: { startedAt: 'asc' } },
    },
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
      breaks: { where: { endedAt: null }, take: 1 },
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
  signature?: string | null;
  actorUserId: string;
}): Promise<PresenceResult> {
  const db = dbFor(params.schoolId);

  const problems = [
    ...validateTeachingLog(params.draft),
    ...validateSignature(params.signature),
  ];
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
    signature: params.signature?.trim() || null,
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
