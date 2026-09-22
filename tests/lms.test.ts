import { describe, expect, it } from 'vitest';

import {
  ITEM_KIND_LABELS,
  MODULE_ITEM_KINDS,
  POSITION_STEP,
  availabilityOf,
  isMeetingProvider,
  isModuleItemKind,
  linkRejectionReason,
  nextPosition,
  positionsFor,
  reorder,
  studentItemsOf,
  summariseSpace,
  validateItemDraft,
  validateModuleDraft,
  visibleToStudent,
} from '@/lib/domain/lms';

/*
 * The rules about what a course contains and who may see it.
 *
 * The visibility block is the one that matters. An unpublished module is a
 * lecturer's draft — next week's reading, an exam being assembled — and the
 * tests below assert that drafts are ABSENT from what a student receives, not
 * merely unrendered. "Not sent" and "not shown" are the difference between a
 * draft and a leak.
 */

const NOW = new Date('2026-09-21T10:00:00.000Z');
const LATER = new Date('2026-09-28T09:00:00.000Z');
const EARLIER = new Date('2026-09-14T09:00:00.000Z');

describe('vocabulary', () => {
  it('knows its own item kinds', () => {
    for (const kind of MODULE_ITEM_KINDS) expect(isModuleItemKind(kind)).toBe(true);
    expect(isModuleItemKind('QUIZ')).toBe(false);
    expect(isModuleItemKind('')).toBe(false);
  });

  it('labels COURSEWORK as "Assignment", which is what a lecturer calls it', () => {
    // The table is Coursework to avoid colliding with SubjectAssignment; the
    // person reading the screen should never have to know that.
    expect(ITEM_KIND_LABELS.COURSEWORK).toBe('Assignment');
  });

  it('knows its own meeting providers', () => {
    expect(isMeetingProvider('MANUAL')).toBe(true);
    expect(isMeetingProvider('TEAMS')).toBe(true);
    expect(isMeetingProvider('SKYPE')).toBe(false);
  });
});

describe('whether a student may see a module', () => {
  it('shows a published, unlocked module', () => {
    expect(availabilityOf({ isPublished: true, unlockAt: null }, NOW)).toEqual({ state: 'OPEN' });
    expect(visibleToStudent({ isPublished: true, unlockAt: null }, NOW)).toBe(true);
  });

  it('treats an unpublished module as a DRAFT, not as locked', () => {
    /*
     * The distinction is the whole point. "This opens on Monday" is a promise
     * worth showing. A draft is not a promise, and announcing that one exists
     * tells a class an unseen assessment is coming — exactly what the lecturer
     * was withholding by not publishing it.
     */
    expect(availabilityOf({ isPublished: false, unlockAt: null }, NOW).state).toBe('DRAFT');
    expect(availabilityOf({ isPublished: false, unlockAt: LATER }, NOW).state).toBe('DRAFT');
  });

  it('locks a published module until its unlock time', () => {
    const verdict = availabilityOf({ isPublished: true, unlockAt: LATER }, NOW);
    expect(verdict.state).toBe('LOCKED');
    if (verdict.state === 'LOCKED') expect(verdict.unlocksAt).toEqual(LATER);
    expect(visibleToStudent({ isPublished: true, unlockAt: LATER }, NOW)).toBe(false);
  });

  it('opens once the unlock time has passed', () => {
    expect(visibleToStudent({ isPublished: true, unlockAt: EARLIER }, NOW)).toBe(true);
  });
});

describe('the items a student receives', () => {
  const items = [
    { id: 'a', isPublished: true },
    { id: 'b', isPublished: false },
    { id: 'c', isPublished: true },
  ];

  it('sends only the published items of an open module', () => {
    const visible = studentItemsOf({ isPublished: true, unlockAt: null }, items, NOW);
    expect(visible.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('sends NOTHING from a draft module, however published its items', () => {
    // Both gates apply and neither implies the other.
    const visible = studentItemsOf({ isPublished: false, unlockAt: null }, items, NOW);
    expect(visible).toEqual([]);
  });

  it('sends nothing from a module that has not unlocked yet', () => {
    expect(studentItemsOf({ isPublished: true, unlockAt: LATER }, items, NOW)).toEqual([]);
  });

  it('returns a NEW list rather than mutating the one it was given', () => {
    const original = [...items];
    studentItemsOf({ isPublished: true, unlockAt: null }, items, NOW);
    expect(items).toEqual(original);
  });
});

describe('ordering', () => {
  it('starts at the step and leaves gaps', () => {
    expect(nextPosition([])).toBe(POSITION_STEP);
    expect(nextPosition([{ position: 100 }, { position: 200 }])).toBe(300);
  });

  it('does not collide with an existing position when they are out of order', () => {
    expect(nextPosition([{ position: 300 }, { position: 100 }])).toBe(400);
  });

  it('moves an item down', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('does nothing for a move to the same place', () => {
    expect(reorder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
  });

  it('clamps an index past either end rather than dropping the item', () => {
    expect(reorder(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an id that is not in the list', () => {
    // A stale drag from a page somebody else has since re-ordered should do
    // nothing, not throw.
    expect(reorder(['a', 'b'], 'ghost', 0)).toEqual(['a', 'b']);
  });

  it('never loses or duplicates an item', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const moved of ids) {
      for (let to = -1; to <= ids.length; to += 1) {
        const next = reorder(ids, moved, to);
        expect(next).toHaveLength(ids.length);
        expect(new Set(next)).toEqual(new Set(ids));
      }
    }
  });

  it('numbers a new ordering with gaps', () => {
    const positions = positionsFor(['x', 'y']);
    expect(positions.get('x')).toBe(100);
    expect(positions.get('y')).toBe(200);
  });
});

describe('validating a module', () => {
  it('accepts an ordinary one', () => {
    expect(validateModuleDraft({ title: 'Week 1 — Foundations' })).toEqual([]);
  });

  it('requires a title', () => {
    expect(validateModuleDraft({ title: '   ' }).join(' ')).toMatch(/title/);
  });

  it('refuses an absurdly long title', () => {
    expect(validateModuleDraft({ title: 'x'.repeat(300) }).join(' ')).toMatch(/at most/);
  });
});

describe('validating an item', () => {
  it('accepts a page with content', () => {
    expect(
      validateItemDraft({ kind: 'PAGE', title: 'Reading', bodyMarkdown: 'Chapter 3.' }),
    ).toEqual([]);
  });

  it('refuses an empty page', () => {
    expect(
      validateItemDraft({ kind: 'PAGE', title: 'Reading', bodyMarkdown: '  ' }).join(' '),
    ).toMatch(/needs some content/);
  });

  it('refuses a kind it does not recognise', () => {
    expect(validateItemDraft({ kind: 'QUIZ', title: 'Test' }).join(' ')).toMatch(/what kind/);
  });

  it('reports every problem at once', () => {
    const problems = validateItemDraft({ kind: 'NONSENSE', title: '', bodyMarkdown: '' });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('links', () => {
  it('accepts http and https', () => {
    expect(linkRejectionReason('https://example.edu/reading.pdf')).toBeNull();
    expect(linkRejectionReason('http://example.edu')).toBeNull();
  });

  it('REFUSES a javascript: URL', () => {
    /*
     * An href executes in the reader's session, and a lecturer's page is
     * rendered to a whole class. This is the assertion that stops one item
     * becoming a cross-site scripting vector against every student on it.
     */
    expect(linkRejectionReason('javascript:alert(1)')).toMatch(/Only http and https/);
    expect(linkRejectionReason('JavaScript:alert(1)')).toMatch(/Only http and https/);
  });

  it('refuses data: and file: URLs', () => {
    expect(linkRejectionReason('data:text/html;base64,PHNjcmlwdD4=')).toMatch(/Only http/);
    expect(linkRejectionReason('file:///etc/passwd')).toMatch(/Only http/);
  });

  it('explains a bare domain rather than calling it invalid', () => {
    expect(linkRejectionReason('example.edu')).toMatch(/should start with https/);
  });

  it('requires something', () => {
    expect(linkRejectionReason('   ')).toMatch(/Enter the address/);
  });
});

describe('summarising a course for its lecturer', () => {
  it('counts what a student would actually see', () => {
    const summary = summariseSpace([
      { isPublished: true, items: [{ isPublished: true }, { isPublished: false }] },
      { isPublished: false, items: [{ isPublished: true }] },
    ]);
    expect(summary.modules).toBe(2);
    expect(summary.publishedModules).toBe(1);
    expect(summary.items).toBe(3);
    // Only the published item inside the published module.
    expect(summary.publishedItems).toBe(1);
    expect(summary.allDraft).toBe(false);
  });

  it('flags a course that is entirely draft', () => {
    // A lecturer who has built everything and published none of it sees an
    // empty page from the student side and concludes the feature is broken.
    const summary = summariseSpace([
      { isPublished: false, items: [{ isPublished: true }, { isPublished: true }] },
    ]);
    expect(summary.allDraft).toBe(true);
  });

  it('does not call an empty course "all draft"', () => {
    expect(summariseSpace([]).allDraft).toBe(false);
  });
});
