import { Prisma } from '@prisma/client';

import { dbFor, platformDb } from '@/lib/tenant';
import { registrationOpenNotice } from '@/lib/domain/enrollment';
import { formatInZone } from '@/lib/domain/time';
import {
  normaliseTermCode,
  overlappingTerms,
  validateTerm,
  type TermDraft,
} from '@/lib/domain/term';
import { recordAudit } from './audit.service';
import { notifyStudents } from './notification.service';

/**
 * =============================================================================
 * ACADEMIC TERMS
 * =============================================================================
 *
 * The calendar the whole institution hangs its dates off.
 *
 * ONE INVARIANT DOMINATES THIS FILE: at most one term per school may be
 * current. The schema says so in a comment — "enforced in application logic" —
 * and nothing was enforcing it. Two current terms is not a cosmetic problem:
 * every screen that asks "which term are we in" resolves it with a
 * `findFirst`, so the answer becomes whichever row the database happens to
 * return, and marks, registrations and invoices start landing in different
 * terms on different pages.
 *
 * So setting one current clears the others IN THE SAME TRANSACTION.
 */

export interface TermResult {
  ok: boolean;
  message: string;
  id?: string;
  /** Non-blocking notes — an overlap the registrar may have meant. */
  warnings?: string[];
}

function duplicateCode(error: unknown, code: string): TermResult | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return { ok: false, message: `A term with the code ${code} already exists.` };
  }
  return null;
}

export async function saveTerm(params: {
  schoolId: string;
  termId?: string | null;
  draft: TermDraft;
  /** Mark it current as part of the save. */
  makeCurrent?: boolean;
  actorUserId: string;
}): Promise<TermResult> {
  const problems = validateTerm(params.draft);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const db = dbFor(params.schoolId);
  const code = normaliseTermCode(params.draft.code);

  const data = {
    code,
    name: params.draft.name.trim(),
    academicYear: params.draft.academicYear.trim(),
    season: params.draft.season,
    startDate: new Date(params.draft.startDate),
    endDate: new Date(params.draft.endDate),
    registrationOpensAt: new Date(params.draft.registrationOpensAt),
    registrationClosesAt: new Date(params.draft.registrationClosesAt),
    addDropDeadline: new Date(params.draft.addDropDeadline),
    withdrawalDeadline: new Date(params.draft.withdrawalDeadline),
  };

  // Overlap is reported, never refused. A summer session running across the
  // tail of the second semester is a real arrangement, and a rule that forbade
  // it is one schools work around by entering the wrong dates.
  const existing = await db.term.findMany({
    select: { id: true, code: true, name: true, season: true, startDate: true, endDate: true },
  });
  const clashes = overlappingTerms(
    { startDate: data.startDate, endDate: data.endDate, excludeId: params.termId ?? undefined },
    existing,
  );
  const warnings = clashes.map(
    (t) => `These dates overlap ${t.code} (${t.name}). That is allowed, but check it is intended.`,
  );

  try {
    const term = await db.$transaction(async (tx) => {
      const saved = params.termId
        ? await (async () => {
            const found = await tx.term.findUnique({ where: { id: params.termId! } });
            if (!found) throw new Prisma.PrismaClientKnownRequestError('not found', {
              code: 'P2025',
              clientVersion: 'n/a',
            });
            return tx.term.update({ where: { id: found.id }, data });
          })()
        : await tx.term.create({ data: { ...data, schoolId: params.schoolId } });

      if (params.makeCurrent) {
        // Clear first, then set. The other order leaves a window in which two
        // rows are current — which matters here because the clear is a bulk
        // update that would otherwise unset the one just written.
        await tx.term.updateMany({
          where: { isCurrent: true, id: { not: saved.id } },
          data: { isCurrent: false },
        });
        await tx.term.update({ where: { id: saved.id }, data: { isCurrent: true } });
      }

      return saved;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: params.termId ? 'term.update' : 'term.create',
      entityType: 'Term',
      entityId: term.id,
      summary: `${params.termId ? 'Updated' : 'Created'} term ${code} (${data.academicYear})${params.makeCurrent ? ', now current' : ''}.`,
    });

    return {
      ok: true,
      message: `${data.name} ${params.termId ? 'saved' : 'created'}.`,
      id: term.id,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { ok: false, message: 'That term is not part of this school.' };
    }
    const duplicate = duplicateCode(error, code);
    if (duplicate) return duplicate;
    console.error('[term] save failed', error);
    return { ok: false, message: 'Could not save that term.' };
  }
}

/**
 * Make one term current, and no others.
 *
 * The clear and the set are one transaction for the reason above: a moment in
 * which two terms are current is a moment in which the rest of the app
 * disagrees with itself about where a mark belongs.
 */
export async function setCurrentTerm(params: {
  schoolId: string;
  termId: string;
  actorUserId: string;
}): Promise<TermResult> {
  const db = dbFor(params.schoolId);
  const term = await db.term.findUnique({ where: { id: params.termId } });
  if (!term) return { ok: false, message: 'That term is not part of this school.' };
  if (term.isCurrent) return { ok: true, message: `${term.name} is already the current term.` };

  await db.$transaction(async (tx) => {
    await tx.term.updateMany({
      where: { isCurrent: true, id: { not: term.id } },
      data: { isCurrent: false },
    });
    await tx.term.update({ where: { id: term.id }, data: { isCurrent: true } });
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'term.current',
    entityType: 'Term',
    entityId: term.id,
    summary: `${term.code} is now the current term.`,
  });

  return { ok: true, message: `${term.name} is now the current term.` };
}

/**
 * Delete a term, but only while nothing has happened in it.
 *
 * Sections, invoices, marks and report cards all reference a term, and most of
 * those cascade. Deleting a term that has been taught would take a semester's
 * grades with it.
 */
export async function deleteTerm(params: {
  schoolId: string;
  termId: string;
  actorUserId: string;
}): Promise<TermResult> {
  const db = dbFor(params.schoolId);
  const term = await db.term.findUnique({
    where: { id: params.termId },
    include: {
      _count: {
        select: {
          offerings: true,
          invoices: true,
          feeStructures: true,
          applications: true,
        },
      },
    },
  });
  if (!term) return { ok: false, message: 'That term is not part of this school.' };

  const blockers: string[] = [];
  const counts: [number, string][] = [
    [term._count.offerings, 'section'],
    [term._count.invoices, 'invoice'],
    [term._count.feeStructures, 'fee structure'],
    [term._count.applications, 'application'],
  ];
  for (const [count, label] of counts) {
    if (count > 0) blockers.push(`${count} ${label}${count === 1 ? '' : 's'}`);
  }

  if (blockers.length > 0) {
    const list =
      blockers.length === 1
        ? blockers[0]
        : `${blockers.slice(0, -1).join(', ')} and ${blockers[blockers.length - 1]}`;
    return {
      ok: false,
      message: `${term.code} already has ${list} attached. A term that has been taught cannot be deleted — its records reference it.`,
    };
  }

  if (term.isCurrent) {
    return {
      ok: false,
      message: 'That is the current term. Make another term current first.',
    };
  }

  await db.term.delete({ where: { id: term.id } });
  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'term.delete',
    entityType: 'Term',
    entityId: term.id,
    summary: `Term ${term.code} deleted (nothing had happened in it).`,
  });

  return { ok: true, message: `${term.name} deleted.` };
}

/** Every term, newest first, with what has happened in each. */
export async function listTerms(schoolId: string) {
  const db = dbFor(schoolId);
  return db.term.findMany({
    orderBy: { startDate: 'desc' },
    include: {
      _count: {
        select: { offerings: true, invoices: true, feeStructures: true, applications: true },
      },
    },
  });
}

/**
 * Repair a school that already has more than one current term.
 *
 * The invariant was documented but unenforced for several phases, so existing
 * data can violate it. Keeps the one that started most recently, which is the
 * likeliest intent, and says what it did rather than fixing it silently.
 */
export async function reconcileCurrentTerm(
  schoolId: string,
): Promise<{ repaired: boolean; kept?: string; cleared: string[] }> {
  const db = dbFor(schoolId);
  const current = await db.term.findMany({
    where: { isCurrent: true },
    orderBy: { startDate: 'desc' },
  });
  if (current.length <= 1) return { repaired: false, cleared: [] };

  const [keep, ...rest] = current;
  await db.term.updateMany({
    where: { id: { in: rest.map((t) => t.id) } },
    data: { isCurrent: false },
  });

  return { repaired: true, kept: keep.code, cleared: rest.map((t) => t.code) };
}

/**
 * Students whose registration is not in question. A deny-list, like the
 * carryover report: a status added later is told rather than silently missed.
 */
const NOT_REGISTERING = ['WITHDRAWN', 'GRADUATED', 'DEFERRED', 'SUSPENDED'];

/** Announce a window this many hours before it opens… */
const ANNOUNCE_AHEAD_HOURS = 24;
/** …and not at all once it has been open this long. */
const TOO_LATE_DAYS = 7;

/**
 * Tell students that registration is opening. Runs nightly; announces each
 * term ONCE.
 *
 * "Once" is read from the notifications themselves rather than a flag on the
 * term: if the fan-out failed, there are no rows, and the next night tries
 * again. A flag set before a failed send would have swallowed it for good.
 *
 * A window that opened more than a week ago is not announced. The first night
 * after a deploy would otherwise tell every student about a term they
 * registered for a month ago.
 *
 * K-12 schools are skipped: pupils do not register themselves.
 */
export async function announceRegistrationOpening(schoolId: string, now = new Date()): Promise<number> {
  const school = await platformDb.school.findUnique({
    where: { id: schoolId },
    select: { academicModel: true, timezone: true },
  });
  if (!school || school.academicModel === 'K12') return 0;

  const db = dbFor(schoolId);
  const terms = await db.term.findMany({
    where: {
      registrationClosesAt: { gt: now },
      registrationOpensAt: {
        lte: new Date(now.getTime() + ANNOUNCE_AHEAD_HOURS * 3_600_000),
        gte: new Date(now.getTime() - TOO_LATE_DAYS * 86_400_000),
      },
    },
    select: { id: true, name: true, registrationOpensAt: true, registrationClosesAt: true },
  });

  let told = 0;
  for (const term of terms) {
    const already = await db.notification.findFirst({
      where: { kind: 'REGISTRATION_OPEN', subjectType: 'Term', subjectId: term.id },
      select: { id: true },
    });
    if (already) continue;

    const students = await db.student.findMany({
      where: { status: { notIn: NOT_REGISTERING } },
      select: { id: true },
    });

    const when = { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } as const;
    const message = registrationOpenNotice({
      termName: term.name,
      alreadyOpen: term.registrationOpensAt <= now,
      opensAt: formatInZone(term.registrationOpensAt, school.timezone, when),
      closesAt: formatInZone(term.registrationClosesAt, school.timezone, when),
    });

    told += await notifyStudents(schoolId, students.map((s) => s.id), {
      kind: 'REGISTRATION_OPEN',
      ...message,
      href: '/me/registration',
      subjectType: 'Term',
      subjectId: term.id,
    });
  }
  return told;
}
