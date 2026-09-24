import { ROLES, type Role } from './enums';

/**
 * =============================================================================
 * ANNOUNCEMENTS
 * =============================================================================
 *
 * A school-wide notice: a closure, a fee deadline, a change to an examination
 * timetable. The `Announcement` table has existed since the first phase and
 * nothing ever read or wrote it, so this is the rules half of finally using it.
 *
 * THE AUDIENCE IS AN ALLOW-LIST, STORED AS TEXT, AND EMPTY MEANS EVERYONE.
 * That last part is the trap in the column and it is worth stating: an empty
 * audience is the WIDEST possible reach, not the narrowest. A bug that clears
 * the field sends a staff notice to every student in the school, which is the
 * failure worth designing against — so `audienceMatches` treats empty as
 * everyone exactly once, here, and no caller is left to decide it again.
 */

export const ANNOUNCEMENT_SEVERITIES = ['INFO', 'WARNING', 'URGENT'] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<AnnouncementSeverity, string> = {
  INFO: 'Notice',
  WARNING: 'Important',
  URGENT: 'Urgent',
};

export function isSeverity(value: unknown): value is AnnouncementSeverity {
  return (ANNOUNCEMENT_SEVERITIES as readonly unknown[]).includes(value);
}

export const ANNOUNCEMENT_LIMITS = {
  maxTitle: 160,
  maxBody: 4000,
  /** Beyond this an "announcement" is a document and belongs in the library. */
  maxDaysAhead: 365,
} as const;

/** Roles a notice can be addressed to. Everybody who can sign in. */
export const ADDRESSABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'OWNER');

/** Store an audience as text: a sorted, comma-separated list, or empty. */
export function encodeAudience(roles: readonly Role[]): string {
  const unique = [...new Set(roles)].filter((r) => ADDRESSABLE_ROLES.includes(r));
  // Everybody selected is the same reach as nobody selected, and storing the
  // empty form keeps one representation of "everyone" rather than two.
  if (unique.length === 0 || unique.length === ADDRESSABLE_ROLES.length) return '';
  return [...unique].sort().join(',');
}

export function decodeAudience(raw: string | null | undefined): Role[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is Role => (ROLES as readonly string[]).includes(part));
}

/**
 * Does this notice reach this person?
 *
 * Empty audience means everyone — see the note at the top of this file. An
 * audience naming roles that no longer exist reaches nobody rather than
 * everybody, which is the safe direction for a list that has been edited.
 */
export function audienceMatches(raw: string | null | undefined, role: Role): boolean {
  const roles = decodeAudience(raw);
  if (!raw?.trim()) return true;
  return roles.includes(role);
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: readonly Role[];
  expiresAt: Date | null;
}

export function validateAnnouncement(draft: AnnouncementDraft, now = new Date()): string[] {
  const problems: string[] = [];

  const title = draft.title.trim();
  if (!title) problems.push('Give the announcement a title.');
  else if (title.length > ANNOUNCEMENT_LIMITS.maxTitle) problems.push('That title is too long.');

  const body = draft.body.trim();
  if (!body) problems.push('An announcement with no text says nothing.');
  else if (body.length > ANNOUNCEMENT_LIMITS.maxBody) {
    problems.push('That is long enough to be a document — put it in the library and link to it.');
  }

  if (!isSeverity(draft.severity)) problems.push('Choose how important this is.');

  if (draft.expiresAt) {
    if (draft.expiresAt <= now) {
      // An announcement that has already expired is one nobody will ever see,
      // and saving it silently is worse than refusing it.
      problems.push('That expiry is in the past, so nobody would ever see it.');
    } else {
      const days = (draft.expiresAt.getTime() - now.getTime()) / 86_400_000;
      if (days > ANNOUNCEMENT_LIMITS.maxDaysAhead) {
        problems.push('Set an expiry within a year, or leave it blank to keep it indefinitely.');
      }
    }
  }

  return problems;
}

/** Is this notice live right now? */
export function isLive(
  announcement: { publishedAt: Date; expiresAt: Date | null },
  now = new Date(),
): boolean {
  if (announcement.publishedAt > now) return false;
  return announcement.expiresAt === null || announcement.expiresAt > now;
}

/**
 * Order for display: the urgent first, then the newest.
 *
 * A closure notice posted this morning must not sit under a fee reminder from
 * three weeks ago merely because both are live.
 */
export function displayOrder<T extends { severity: string; publishedAt: Date }>(
  announcements: readonly T[],
): T[] {
  const rank: Record<string, number> = { URGENT: 0, WARNING: 1, INFO: 2 };
  return [...announcements].sort(
    (a, b) =>
      (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
      b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

/** A one-line summary for the audience, in words rather than role constants. */
export function describeAudience(raw: string | null | undefined): string {
  const roles = decodeAudience(raw);
  if (!raw?.trim()) return 'Everybody at the school';
  if (roles.length === 0) return 'Nobody — the roles on this notice no longer exist';
  if (roles.length === 1) return `${roles[0]} only`;
  return `${roles.slice(0, -1).join(', ')} and ${roles[roles.length - 1]}`;
}
