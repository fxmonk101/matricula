import { describe, expect, it } from 'vitest';

import {
  ADDRESSABLE_ROLES,
  audienceMatches,
  decodeAudience,
  describeAudience,
  displayOrder,
  encodeAudience,
  isLive,
  validateAnnouncement,
} from '@/lib/domain/announcement';
import type { Role } from '@/lib/domain/enums';

/*
 * Announcements.
 *
 * Posting one now sends email as well as filling a bell, which makes it the
 * loudest thing a school officer can do in this system. The rule worth getting
 * right is therefore the audience — and the trap in the stored column is that
 * EMPTY MEANS EVERYONE, so a bug that clears the field sends a staff notice to
 * every student in the school.
 */

const NOW = new Date('2026-09-24T09:00:00Z');

const good = {
  title: 'The school will close early on Friday',
  body: 'Buses will leave at 13:00.',
  severity: 'WARNING' as const,
  audience: [] as Role[],
  expiresAt: null,
};

describe('the audience', () => {
  it('treats an empty audience as EVERYBODY', () => {
    /*
     * Stated once, here, so no caller decides it again. It is the widest
     * reach, not the narrowest, which is the opposite of what an empty field
     * usually implies.
     */
    expect(audienceMatches('', 'STUDENT')).toBe(true);
    expect(audienceMatches(null, 'INSTRUCTOR')).toBe(true);
    expect(audienceMatches(undefined, 'GUARDIAN')).toBe(true);
  });

  it('reaches only the roles named', () => {
    expect(audienceMatches('INSTRUCTOR,HOD', 'INSTRUCTOR')).toBe(true);
    expect(audienceMatches('INSTRUCTOR,HOD', 'STUDENT')).toBe(false);
  });

  it('reaches NOBODY when every named role has since been removed', () => {
    // The safe direction for a list that has been edited: a notice addressed
    // to roles that no longer exist must not fall through to everyone.
    expect(audienceMatches('NOT_A_ROLE', 'STUDENT')).toBe(false);
  });

  it('stores "everybody selected" the same way as "nobody selected"', () => {
    // One representation of everyone rather than two, so the display predicate
    // has a single case to handle.
    expect(encodeAudience([])).toBe('');
    expect(encodeAudience([...ADDRESSABLE_ROLES])).toBe('');
  });

  it('sorts and deduplicates what it stores', () => {
    expect(encodeAudience(['STUDENT', 'INSTRUCTOR', 'STUDENT'])).toBe('INSTRUCTOR,STUDENT');
  });

  it('survives a round trip', () => {
    const roles: Role[] = ['INSTRUCTOR', 'HOD'];
    expect(decodeAudience(encodeAudience(roles)).sort()).toEqual([...roles].sort());
  });

  it('describes itself in words a person can check', () => {
    expect(describeAudience('')).toMatch(/Everybody/);
    expect(describeAudience('STUDENT')).toMatch(/STUDENT only/);
    expect(describeAudience('INSTRUCTOR,HOD')).toMatch(/INSTRUCTOR and HOD/);
    expect(describeAudience('GONE')).toMatch(/Nobody/);
  });
});

describe('validation', () => {
  it('accepts an ordinary notice', () => {
    expect(validateAnnouncement(good, NOW)).toEqual([]);
  });

  it('refuses one with no title or no text', () => {
    expect(validateAnnouncement({ ...good, title: '  ' }, NOW).join(' ')).toMatch(/title/);
    expect(validateAnnouncement({ ...good, body: '  ' }, NOW).join(' ')).toMatch(/says nothing/);
  });

  it('REFUSES an expiry already in the past', () => {
    /*
     * Saving it silently would produce a notice nobody will ever see, and the
     * person who wrote it would assume it went out.
     */
    const past = new Date('2026-09-23T09:00:00Z');
    expect(validateAnnouncement({ ...good, expiresAt: past }, NOW).join(' ')).toMatch(
      /in the past/,
    );
  });

  it('refuses an expiry years away', () => {
    const far = new Date('2030-01-01T00:00:00Z');
    expect(validateAnnouncement({ ...good, expiresAt: far }, NOW).join(' ')).toMatch(/within a year/);
  });

  it('points a very long body at the library instead', () => {
    const long = { ...good, body: 'x'.repeat(5000) };
    expect(validateAnnouncement(long, NOW).join(' ')).toMatch(/library/);
  });
});

describe('what is live', () => {
  it('is live with no expiry', () => {
    expect(isLive({ publishedAt: NOW, expiresAt: null }, NOW)).toBe(true);
  });

  it('is not live once the expiry has passed', () => {
    expect(
      isLive({ publishedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: new Date('2026-09-20T00:00:00Z') }, NOW),
    ).toBe(false);
  });

  it('is not live before it is published', () => {
    expect(
      isLive({ publishedAt: new Date('2026-09-25T00:00:00Z'), expiresAt: null }, NOW),
    ).toBe(false);
  });
});

describe('the order they are shown in', () => {
  it('puts the urgent first, then the newest', () => {
    /*
     * A closure notice posted this morning must not sit under a fee reminder
     * from three weeks ago merely because both are live.
     */
    const rows = [
      { id: 'old-info', severity: 'INFO', publishedAt: new Date('2026-09-01T00:00:00Z') },
      { id: 'new-info', severity: 'INFO', publishedAt: new Date('2026-09-24T00:00:00Z') },
      { id: 'old-urgent', severity: 'URGENT', publishedAt: new Date('2026-09-02T00:00:00Z') },
      { id: 'warn', severity: 'WARNING', publishedAt: new Date('2026-09-23T00:00:00Z') },
    ];

    expect(displayOrder(rows).map((r) => r.id)).toEqual([
      'old-urgent',
      'warn',
      'new-info',
      'old-info',
    ]);
  });

  it('does not mutate what it was given', () => {
    const rows = [
      { severity: 'INFO', publishedAt: new Date('2026-09-01T00:00:00Z') },
      { severity: 'URGENT', publishedAt: new Date('2026-09-02T00:00:00Z') },
    ];
    const before = [...rows];
    displayOrder(rows);
    expect(rows).toEqual(before);
  });
});
