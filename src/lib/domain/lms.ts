/**
 * =============================================================================
 * THE LEARNING MANAGEMENT LAYER
 * =============================================================================
 *
 * The rules about what exists in a course, what order it comes in, and who is
 * allowed to see it. Pure: no database, no clock of its own, no session.
 *
 * The one rule in here that carries real weight is `visibleToStudent`. An
 * unpublished module is a lecturer's draft — next week's reading, an exam paper
 * being assembled, a piece of work whose questions are not settled — and the
 * difference between "not rendered" and "not sent" is the difference between a
 * draft and a leak. Everything that filters content does so by BUILDING A
 * SMALLER LIST on the server, never by hiding a row that was already sent.
 */

// -----------------------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------------------

export const MODULE_ITEM_KINDS = [
  'PAGE',
  'FILE',
  'LINK',
  'COURSEWORK',
  'QUIZ',
  'MEETING',
] as const;
export type ModuleItemKind = (typeof MODULE_ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Record<ModuleItemKind, string> = {
  PAGE: 'Page',
  FILE: 'File',
  LINK: 'Link',
  COURSEWORK: 'Assignment',
  QUIZ: 'Quiz',
  MEETING: 'Virtual class',
};

/**
 * A QUIZ is a COURSEWORK that marks itself.
 *
 * Both kinds carry a `Coursework` row and both produce a `Submission`; the
 * quiz adds a paper and an automatic marking pass. Keeping them separate
 * KINDS rather than a flag on one is what lets a student see at a glance
 * whether an item is something to write or something to sit, which is the
 * distinction they care about on a module list.
 */
export function isGradedKind(kind: ModuleItemKind): boolean {
  return kind === 'COURSEWORK' || kind === 'QUIZ';
}

/**
 * `COURSEWORK` is labelled "Assignment" because that is what a lecturer calls
 * it and what every other system they have used calls it. The TABLE is called
 * Coursework because this schema already has a `SubjectAssignment` meaning a
 * teaching allocation — the divergence is deliberate and documented at both
 * ends rather than resolved by making one of them wrong.
 */

export function isModuleItemKind(value: string): value is ModuleItemKind {
  return (MODULE_ITEM_KINDS as readonly string[]).includes(value);
}

export const MEETING_PROVIDERS = ['MANUAL', 'TEAMS', 'ZOOM', 'MEET'] as const;
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<MeetingProvider, string> = {
  MANUAL: 'A link I will paste',
  TEAMS: 'Microsoft Teams',
  ZOOM: 'Zoom',
  MEET: 'Google Meet',
};

export function isMeetingProvider(value: string): value is MeetingProvider {
  return (MEETING_PROVIDERS as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Visibility
// -----------------------------------------------------------------------------

export interface PublishState {
  isPublished: boolean;
  unlockAt?: Date | null;
}

export type ItemAvailability =
  | { state: 'OPEN' }
  | { state: 'LOCKED'; unlocksAt: Date; reason: string }
  | { state: 'DRAFT' };

/**
 * What a student may do with this module right now.
 *
 * LOCKED and DRAFT are different answers and a student is told only about the
 * first. A locked module is a promise — "this opens on Monday" — and showing it
 * is the point. A draft is not a promise, and announcing that one exists tells
 * a class that an unseen assessment is coming, which is exactly the information
 * a lecturer was withholding by not publishing it.
 */
export function availabilityOf(module: PublishState, now: Date): ItemAvailability {
  if (!module.isPublished) return { state: 'DRAFT' };
  if (module.unlockAt && module.unlockAt.getTime() > now.getTime()) {
    return {
      state: 'LOCKED',
      unlocksAt: module.unlockAt,
      reason: 'This module opens later.',
    };
  }
  return { state: 'OPEN' };
}

/** Whether a student should receive this module's contents at all. */
export function visibleToStudent(module: PublishState, now: Date): boolean {
  return availabilityOf(module, now).state === 'OPEN';
}

export interface ItemLike {
  isPublished: boolean;
}

/**
 * The items of an OPEN module that a student may receive.
 *
 * An item is published independently of its module, so a lecturer can add next
 * week's reading to this week's open module without it appearing. Both gates
 * apply; neither implies the other.
 */
export function studentItemsOf<T extends ItemLike>(
  module: PublishState,
  items: readonly T[],
  now: Date,
): T[] {
  if (!visibleToStudent(module, now)) return [];
  return items.filter((item) => item.isPublished);
}

// -----------------------------------------------------------------------------
// Ordering
// -----------------------------------------------------------------------------

/**
 * Positions are SPARSE and re-ordering rewrites the whole set.
 *
 * The alternative — dense positions maintained on every insert — means a module
 * added in the middle renumbers every sibling below it, and two lecturers doing
 * that at once interleave into an order neither chose. Rewriting the set in one
 * transaction makes the last writer win cleanly instead.
 */
export const POSITION_STEP = 100;

export function nextPosition(existing: readonly { position: number }[]): number {
  if (existing.length === 0) return POSITION_STEP;
  return Math.max(...existing.map((e) => e.position)) + POSITION_STEP;
}

/**
 * Move one id to a new index, and return the full new ordering.
 *
 * Returns ids in their new order rather than a position map, so the caller
 * decides the numbering. An id that is not in the list returns the list
 * unchanged — a stale drag from a page that has since been re-ordered elsewhere
 * should do nothing, not throw.
 */
export function reorder(ids: readonly string[], movedId: string, toIndex: number): string[] {
  const from = ids.indexOf(movedId);
  if (from === -1) return [...ids];

  const clamped = Math.max(0, Math.min(ids.length - 1, Math.trunc(toIndex)));
  if (clamped === from) return [...ids];

  const next = [...ids];
  next.splice(from, 1);
  next.splice(clamped, 0, movedId);
  return next;
}

/** Turn an ordering into the positions to write. */
export function positionsFor(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, (index + 1) * POSITION_STEP]));
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export const TITLE_MAX = 200;
export const BODY_MAX = 100_000;

export function validateModuleDraft(draft: { title: string; description?: string | null }): string[] {
  const problems: string[] = [];
  const title = draft.title.trim();

  if (!title) problems.push('Give the module a title.');
  else if (title.length > TITLE_MAX) problems.push(`A title can be at most ${TITLE_MAX} characters.`);

  if (draft.description && draft.description.length > 2000) {
    problems.push('That description is too long.');
  }

  return problems;
}

export interface ItemDraft {
  kind: string;
  title: string;
  bodyMarkdown?: string | null;
  externalUrl?: string | null;
}

/**
 * Only `http` and `https` may be linked.
 *
 * A `javascript:` URL in an href executes in the reader's session, and a
 * lecturer's page is rendered to a whole class. `data:` can carry a document
 * that runs in this origin. Both are refused by name so the message says what
 * was wrong rather than "invalid URL".
 */
export function linkRejectionReason(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Enter the address to link to.';
  if (value.length > 2000) return 'That address is too long.';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'That is not a complete web address. It should start with https://';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http and https addresses can be linked.';
  }
  return null;
}

export function validateItemDraft(draft: ItemDraft): string[] {
  const problems: string[] = [];

  if (!isModuleItemKind(draft.kind)) {
    problems.push('Choose what kind of item this is.');
  }

  const title = draft.title.trim();
  if (!title) problems.push('Give the item a title.');
  else if (title.length > TITLE_MAX) problems.push(`A title can be at most ${TITLE_MAX} characters.`);

  if (draft.kind === 'PAGE') {
    if (!draft.bodyMarkdown?.trim()) problems.push('A page needs some content.');
    else if (draft.bodyMarkdown.length > BODY_MAX) problems.push('That page is too long.');
  }

  if (draft.kind === 'LINK') {
    const reason = linkRejectionReason(draft.externalUrl ?? '');
    if (reason) problems.push(reason);
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Summarising, for the listing pages
// -----------------------------------------------------------------------------

export interface ModuleSummaryRow {
  isPublished: boolean;
  items: readonly ItemLike[];
}

export interface SpaceSummary {
  modules: number;
  publishedModules: number;
  items: number;
  publishedItems: number;
  /** True when there is content but a student would see none of it. */
  allDraft: boolean;
}

export function summariseSpace(modules: readonly ModuleSummaryRow[]): SpaceSummary {
  let items = 0;
  let publishedItems = 0;
  let publishedModules = 0;

  for (const module of modules) {
    if (module.isPublished) publishedModules += 1;
    items += module.items.length;
    if (module.isPublished) {
      publishedItems += module.items.filter((i) => i.isPublished).length;
    }
  }

  return {
    modules: modules.length,
    publishedModules,
    items,
    publishedItems,
    // Worth surfacing: a lecturer who has built a whole course and published
    // none of it sees an empty page from the student side and concludes the
    // feature is broken.
    allDraft: modules.length > 0 && publishedItems === 0,
  };
}

// -----------------------------------------------------------------------------
// Virtual classes
// -----------------------------------------------------------------------------

/**
 * The longest a single virtual class may run.
 *
 * Four hours covers a double lecture, a practical and an exam review. Beyond
 * that it is a mistyped end time — most often a date a day out, which would
 * otherwise sit in the module claiming the class runs until tomorrow.
 */
export const MAX_CLASS_MINUTES = 4 * 60;

export interface VirtualClassDraft {
  title: string;
  provider: string;
  /** Required for MANUAL; supplied by the provider otherwise. */
  joinUrl?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Check a virtual class before anything is created in somebody else's system.
 *
 * Validated BEFORE the provider is called, deliberately. Creating a Teams
 * meeting and then rejecting the form leaves a real meeting in the school's
 * tenant that nothing in this system points at, and nobody will ever find it to
 * cancel it.
 */
export function validateVirtualClass(draft: VirtualClassDraft, now: Date): string[] {
  const problems: string[] = [];

  if (!draft.title.trim()) problems.push('Give the class a title.');
  else if (draft.title.length > TITLE_MAX) problems.push('That title is too long.');

  if (!isMeetingProvider(draft.provider)) problems.push('Choose where the class will be held.');

  if (!draft.startsAt || Number.isNaN(draft.startsAt.getTime())) {
    problems.push('Say when the class starts.');
  }
  if (!draft.endsAt || Number.isNaN(draft.endsAt.getTime())) {
    problems.push('Say when the class ends.');
  }

  if (draft.startsAt && draft.endsAt && !Number.isNaN(draft.startsAt.getTime()) && !Number.isNaN(draft.endsAt.getTime())) {
    const minutes = (draft.endsAt.getTime() - draft.startsAt.getTime()) / 60_000;

    if (minutes <= 0) problems.push('The class must end after it starts.');
    else if (minutes < 5) problems.push('That is under five minutes — check the times.');
    else if (minutes > MAX_CLASS_MINUTES) {
      problems.push('That is longer than four hours. Check the end time, and the date.');
    }

    /*
     * A class scheduled in the past is ALLOWED. Recording a session that
     * already happened, so its recording link sits with the right week, is a
     * real thing teachers do — and a year is where it stops being that and
     * starts being a mistyped year.
     */
    if (draft.startsAt.getTime() < now.getTime() - 365 * 86_400_000) {
      problems.push('That start date is more than a year ago. Check the year.');
    }
  }

  // Only MANUAL carries its own URL; the others are told one by the provider.
  if (draft.provider === 'MANUAL') {
    const reason = linkRejectionReason(draft.joinUrl ?? '');
    if (reason) problems.push(reason === 'Enter the address to link to.' ? 'Paste the link students should join with.' : reason);
  }

  return problems;
}

/** Where a class sits relative to now, for the badge a student sees. */
export type ClassTiming = 'UPCOMING' | 'LIVE' | 'FINISHED';

export function classTiming(startsAt: Date, endsAt: Date, now: Date): ClassTiming {
  if (now.getTime() < startsAt.getTime()) return 'UPCOMING';
  if (now.getTime() <= endsAt.getTime()) return 'LIVE';
  return 'FINISHED';
}

export const TIMING_LABELS: Record<ClassTiming, string> = {
  UPCOMING: 'Upcoming',
  LIVE: 'Live now',
  FINISHED: 'Finished',
};

/**
 * How soon a class starts, in words.
 *
 * "Live now" wins over any countdown: a student looking at a class that has
 * already begun needs to join it, not to be told it started nine minutes ago.
 */
export function startsIn(startsAt: Date, endsAt: Date, now: Date): string {
  const timing = classTiming(startsAt, endsAt, now);
  if (timing === 'LIVE') return 'Live now';
  if (timing === 'FINISHED') return 'Finished';

  const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Starts in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `Starts in ${Math.floor(hours / 24)} days`;
}
