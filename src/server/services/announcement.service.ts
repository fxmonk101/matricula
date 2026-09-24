import 'server-only';

import {
  audienceMatches,
  displayOrder,
  encodeAudience,
  isLive,
  validateAnnouncement,
  type AnnouncementSeverity,
} from '@/lib/domain/announcement';
import type { Role } from '@/lib/domain/enums';
import { dbFor } from '@/lib/tenant';
import { recordAudit } from '@/server/services/audit.service';
import { notify } from '@/server/services/notification.service';

/**
 * =============================================================================
 * SCHOOL ANNOUNCEMENTS
 * =============================================================================
 *
 * The table has existed since the first phase and nothing read or wrote it.
 * This is the other half.
 *
 * POSTING ONE FANS OUT A NOTIFICATION, which now also sends email — so an
 * announcement is the loudest thing a school officer can do in this system.
 * That is why the audience is explicit on the form rather than defaulted, and
 * why the confirmation says how many people it will actually reach before it
 * is sent rather than afterwards.
 */

export interface AnnouncementResult {
  ok: boolean;
  message: string;
  id?: string;
  reached?: number;
}

export async function postAnnouncement(params: {
  schoolId: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: readonly Role[];
  expiresAt: Date | null;
  actorMembershipId: string;
  actorUserId: string;
  now?: Date;
}): Promise<AnnouncementResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const problems = validateAnnouncement(
    {
      title: params.title,
      body: params.body,
      severity: params.severity,
      audience: params.audience,
      expiresAt: params.expiresAt,
    },
    now,
  );
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const audience = encodeAudience(params.audience);

  try {
    const created = await db.announcement.create({
      data: {
        schoolId: params.schoolId,
        title: params.title.trim(),
        body: params.body.trim(),
        severity: params.severity,
        audience,
        authorId: params.actorUserId,
        publishedAt: now,
        expiresAt: params.expiresAt,
      },
    });

    /*
     * Recipients resolved from the SAME predicate the display uses, so "sent to
     * 412 people" and "412 people can see it" cannot disagree. Only ACTIVE
     * memberships: a suspended account gets no mail about a school it cannot
     * currently reach.
     */
    const members = await db.membership.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, role: true },
    });
    const recipients = members
      .filter((m) => audienceMatches(audience, m.role as Role))
      .map((m) => m.id);

    void notify({
      schoolId: params.schoolId,
      membershipIds: recipients,
      kind: 'ANNOUNCEMENT',
      title: params.title.trim(),
      body: params.body.trim().slice(0, 500),
      href: '/notifications',
      subjectType: 'Announcement',
      subjectId: created.id,
      // The person who wrote it does not need to be told about it.
      exceptMembershipId: params.actorMembershipId,
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'announcement.post',
      entityType: 'Announcement',
      entityId: created.id,
      summary:
        `${params.severity}: "${params.title.trim()}" to ` +
        `${audience || 'everybody'} (${recipients.length} people).`,
    });

    return {
      ok: true,
      message: `Posted to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.`,
      id: created.id,
      reached: recipients.length,
    };
  } catch (error) {
    console.error('[announcement] post failed', error);
    return { ok: false, message: 'Could not post that announcement.' };
  }
}

/** Take one down. Not deleted — an announcement people acted on is a record. */
export async function withdrawAnnouncement(params: {
  schoolId: string;
  announcementId: string;
  actorUserId: string;
  now?: Date;
}): Promise<AnnouncementResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const existing = await db.announcement.findUnique({ where: { id: params.announcementId } });
  if (!existing) return { ok: false, message: 'That announcement is not part of this school.' };

  /*
   * Expired rather than deleted. A notice that a fee deadline moved is
   * something people acted on, and "it was never posted" is not a true answer
   * to a dispute about it three months later.
   */
  await db.announcement.update({
    where: { id: existing.id },
    data: { expiresAt: now },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'announcement.withdraw',
    entityType: 'Announcement',
    entityId: existing.id,
    summary: `"${existing.title}" taken down.`,
  });

  return { ok: true, message: 'Taken down. It is kept in the record.' };
}

/** What this person should see right now, most important first. */
export async function liveAnnouncementsFor(params: {
  schoolId: string;
  role: Role;
  now?: Date;
  limit?: number;
}) {
  const now = params.now ?? new Date();

  const rows = await dbFor(params.schoolId).announcement.findMany({
    where: {
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: (params.limit ?? 5) * 4,
  });

  return displayOrder(
    rows.filter((row) => isLive(row, now) && audienceMatches(row.audience, params.role)),
  ).slice(0, params.limit ?? 5);
}

/** Everything, live or not — for the officer who manages them. */
export async function allAnnouncements(params: { schoolId: string; limit?: number }) {
  const rows = await dbFor(params.schoolId).announcement.findMany({
    orderBy: { publishedAt: 'desc' },
    take: params.limit ?? 50,
  });
  return rows;
}
