import { dbFor } from '@/lib/tenant';
import {
  isModuleItemKind,
  nextPosition,
  positionsFor,
  reorder,
  studentItemsOf,
  validateItemDraft,
  validateModuleDraft,
  visibleToStudent,
  type ModuleItemKind,
} from '@/lib/domain/lms';
import {
  SUBMISSION_LIMITS,
  extensionOf,
  sniffType,
  validateUpload,
} from '@/lib/domain/upload';
import { buildKey, newObjectId, storage } from '@/server/storage';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * COURSE CONTENT
 * =============================================================================
 *
 * Reading and writing the modules and items that make up a course.
 *
 * TWO READ PATHS, DELIBERATELY SEPARATE. `loadSpaceForTeacher` returns
 * everything including drafts; `loadSpaceForStudent` builds a smaller result
 * that never contains an unpublished row at all. They are not one function with
 * a flag, because a flag defaulting the wrong way — or forgotten at one call
 * site — leaks next week's exam to the class. Two functions cannot be got wrong
 * by omission: the student path has no branch that can return a draft.
 */

export interface LmsResult {
  ok: boolean;
  message: string;
  id?: string;
}

// -----------------------------------------------------------------------------
// The space
// -----------------------------------------------------------------------------

/**
 * Find or create the content container for an offering.
 *
 * Created lazily on first use rather than alongside every offering, because
 * most offerings in a freshly provisioned school will never have content and an
 * empty container is indistinguishable from no container to everything that
 * reads it.
 */
export async function ensureSpaceForOffering(params: {
  schoolId: string;
  offeringId: string;
}): Promise<{ ok: boolean; spaceId?: string; message?: string }> {
  const db = dbFor(params.schoolId);

  // Re-read through the tenant client: a crafted id must not attach content to
  // another university's section.
  const offering = await db.courseOffering.findUnique({
    where: { id: params.offeringId },
    select: { id: true, termId: true },
  });
  if (!offering) return { ok: false, message: 'Choose a section from this school.' };

  const existing = await db.courseSpace.findFirst({ where: { offeringId: offering.id } });
  if (existing) return { ok: true, spaceId: existing.id };

  const created = await db.courseSpace.create({
    data: {
      schoolId: params.schoolId,
      termId: offering.termId,
      offeringId: offering.id,
      // subjectAssignmentId stays null. The "exactly one owner" invariant is
      // asserted here rather than in the schema, and pinned by a test.
    },
  });
  return { ok: true, spaceId: created.id };
}

const MODULE_INCLUDE = {
  items: {
    orderBy: { position: 'asc' },
    include: {
      coursework: { select: { id: true, pointsPossible: true, dueAt: true } },
      virtualClass: {
        select: { id: true, provider: true, joinUrl: true, startsAt: true, endsAt: true },
      },
    },
  },
} as const;

/** Everything in the course, drafts included. For the person who owns it. */
export async function loadSpaceForTeacher(params: { schoolId: string; offeringId: string }) {
  const db = dbFor(params.schoolId);

  const space = await db.courseSpace.findFirst({
    where: { offeringId: params.offeringId },
    include: {
      modules: { orderBy: { position: 'asc' }, include: MODULE_INCLUDE },
    },
  });

  return space;
}

/**
 * What a student may see, built as a smaller list rather than filtered on read.
 *
 * The filtering happens HERE, on the server, before anything is serialised into
 * a page. Hiding a draft in the client would still have sent it: it would sit
 * in the RSC payload, readable by anybody who opened the network tab.
 */
export async function loadSpaceForStudent(params: {
  schoolId: string;
  offeringId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const space = await loadSpaceForTeacher(params);
  if (!space) return null;

  const modules = space.modules
    .filter((module) => visibleToStudent(module, now))
    .map((module) => ({
      ...module,
      items: studentItemsOf(module, module.items, now),
    }));

  return { ...space, modules };
}

// -----------------------------------------------------------------------------
// Modules
// -----------------------------------------------------------------------------

export async function saveModule(params: {
  schoolId: string;
  spaceId: string;
  moduleId?: string | null;
  title: string;
  description?: string | null;
  unlockAt?: Date | null;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const problems = validateModuleDraft({ title: params.title, description: params.description });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const space = await db.courseSpace.findUnique({ where: { id: params.spaceId } });
  if (!space) return { ok: false, message: 'That course is not part of this school.' };

  const data = {
    title: params.title.trim(),
    description: params.description?.trim() || null,
    unlockAt: params.unlockAt ?? null,
  };

  try {
    if (params.moduleId) {
      // Scoped by spaceId as well as id, so an id from another course in the
      // same school cannot be edited through this form.
      const existing = await db.courseModule.findFirst({
        where: { id: params.moduleId, spaceId: space.id },
      });
      if (!existing) return { ok: false, message: 'That module no longer exists.' };

      await db.courseModule.update({ where: { id: existing.id }, data });

      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'lms.module.update',
        entityType: 'CourseModule',
        entityId: existing.id,
        summary: `Module renamed to "${data.title}".`,
      });

      return { ok: true, message: 'Module saved.', id: existing.id };
    }

    const siblings = await db.courseModule.findMany({
      where: { spaceId: space.id },
      select: { position: true },
    });

    const created = await db.courseModule.create({
      data: {
        schoolId: params.schoolId,
        spaceId: space.id,
        position: nextPosition(siblings),
        // A new module is a DRAFT. Building next week's content in the open is
        // the normal way to work, and it must not appear half-finished.
        isPublished: false,
        ...data,
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.module.create',
      entityType: 'CourseModule',
      entityId: created.id,
      summary: `Module "${data.title}" added.`,
    });

    return { ok: true, message: 'Module added. It is a draft until you publish it.', id: created.id };
  } catch (error) {
    console.error('[lms] saveModule failed', error);
    return { ok: false, message: 'Could not save that module.' };
  }
}

export async function deleteModule(params: {
  schoolId: string;
  moduleId: string;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const module = await db.courseModule.findUnique({
    where: { id: params.moduleId },
    include: { _count: { select: { items: true } } },
  });
  if (!module) return { ok: false, message: 'That module no longer exists.' };

  await db.courseModule.delete({ where: { id: module.id } });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.module.delete',
    entityType: 'CourseModule',
    entityId: module.id,
    summary: `Module "${module.title}" deleted with ${module._count.items} item(s).`,
  });

  return { ok: true, message: 'Module deleted.' };
}

/**
 * Publish or unpublish a module.
 *
 * Unpublishing is allowed and is not destructive: it withdraws the module from
 * students without losing anything, which is what a lecturer wants when they
 * spot a mistake in something already out.
 */
export async function setModulePublished(params: {
  schoolId: string;
  moduleId: string;
  isPublished: boolean;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const module = await db.courseModule.findUnique({ where: { id: params.moduleId } });
  if (!module) return { ok: false, message: 'That module no longer exists.' };

  await db.courseModule.update({
    where: { id: module.id },
    data: { isPublished: params.isPublished },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.isPublished ? 'lms.module.publish' : 'lms.module.unpublish',
    entityType: 'CourseModule',
    entityId: module.id,
    summary: `Module "${module.title}" ${params.isPublished ? 'published' : 'withdrawn'}.`,
  });

  return {
    ok: true,
    message: params.isPublished
      ? 'Published. Students can see it now.'
      : 'Withdrawn. Students can no longer see it.',
  };
}

/**
 * Move a module, rewriting the whole ordering in one transaction.
 *
 * The full set is rewritten rather than the two rows that swapped, so two
 * lecturers re-ordering at once end with one coherent order — the last writer's
 * — instead of an interleaving neither of them chose.
 */
export async function moveModule(params: {
  schoolId: string;
  spaceId: string;
  moduleId: string;
  toIndex: number;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const modules = await db.courseModule.findMany({
    where: { spaceId: params.spaceId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  const ordered = reorder(
    modules.map((m) => m.id),
    params.moduleId,
    params.toIndex,
  );
  const positions = positionsFor(ordered);

  await db.$transaction(
    ordered.map((id) =>
      db.courseModule.update({ where: { id }, data: { position: positions.get(id)! } }),
    ),
  );

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.module.reorder',
    entityType: 'CourseSpace',
    entityId: params.spaceId,
    summary: `Modules re-ordered (${ordered.length}).`,
  });

  return { ok: true, message: 'Moved.' };
}

// -----------------------------------------------------------------------------
// Items
// -----------------------------------------------------------------------------

export async function saveItem(params: {
  schoolId: string;
  moduleId: string;
  itemId?: string | null;
  kind: string;
  title: string;
  bodyMarkdown?: string | null;
  externalUrl?: string | null;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const problems = validateItemDraft({
    kind: params.kind,
    title: params.title,
    bodyMarkdown: params.bodyMarkdown,
    externalUrl: params.externalUrl,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const module = await db.courseModule.findUnique({ where: { id: params.moduleId } });
  if (!module) return { ok: false, message: 'That module is not part of this school.' };

  const kind = params.kind as ModuleItemKind;
  if (!isModuleItemKind(kind)) return { ok: false, message: 'Choose what kind of item this is.' };

  /*
   * Only the fields belonging to this kind are written, and the others are
   * NULLED. Changing a page into a link otherwise leaves the old body behind,
   * where it is invisible on screen and still in every payload.
   */
  const data = {
    kind,
    title: params.title.trim(),
    bodyMarkdown: kind === 'PAGE' ? (params.bodyMarkdown?.trim() ?? null) : null,
    externalUrl: kind === 'LINK' ? (params.externalUrl?.trim() ?? null) : null,
  };

  try {
    if (params.itemId) {
      const existing = await db.moduleItem.findFirst({
        where: { id: params.itemId, moduleId: module.id },
      });
      if (!existing) return { ok: false, message: 'That item no longer exists.' };

      // The kind is fixed once created. A COURSEWORK item has a Coursework row
      // and submissions hanging off it; letting it become a LINK would orphan
      // marked work.
      if (existing.kind !== kind) {
        return {
          ok: false,
          message: `This item is ${existing.kind.toLowerCase()} and cannot change kind. Delete it and add a new one.`,
        };
      }

      await db.moduleItem.update({ where: { id: existing.id }, data });

      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'lms.item.update',
        entityType: 'ModuleItem',
        entityId: existing.id,
        summary: `Item "${data.title}" edited.`,
      });

      return { ok: true, message: 'Item saved.', id: existing.id };
    }

    const siblings = await db.moduleItem.findMany({
      where: { moduleId: module.id },
      select: { position: true },
    });

    const created = await db.moduleItem.create({
      data: {
        schoolId: params.schoolId,
        moduleId: module.id,
        position: nextPosition(siblings),
        isPublished: false,
        ...data,
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.item.create',
      entityType: 'ModuleItem',
      entityId: created.id,
      summary: `${kind} "${data.title}" added.`,
    });

    return { ok: true, message: 'Added as a draft.', id: created.id };
  } catch (error) {
    console.error('[lms] saveItem failed', error);
    return { ok: false, message: 'Could not save that item.' };
  }
}

export async function setItemPublished(params: {
  schoolId: string;
  itemId: string;
  isPublished: boolean;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: { module: { select: { isPublished: true, title: true } } },
  });
  if (!item) return { ok: false, message: 'That item no longer exists.' };

  await db.moduleItem.update({
    where: { id: item.id },
    data: { isPublished: params.isPublished },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: params.isPublished ? 'lms.item.publish' : 'lms.item.unpublish',
    entityType: 'ModuleItem',
    entityId: item.id,
    summary: `Item "${item.title}" ${params.isPublished ? 'published' : 'withdrawn'}.`,
  });

  /*
   * Publishing an item inside a draft module changes nothing a student can see,
   * and saying so prevents the obvious support call — "I published it and they
   * still cannot see it" — from ever being made.
   */
  if (params.isPublished && !item.module.isPublished) {
    return {
      ok: true,
      message: `Published — but "${item.module.title}" is still a draft, so students cannot see it yet.`,
    };
  }

  return {
    ok: true,
    message: params.isPublished ? 'Published.' : 'Withdrawn from students.',
  };
}

export async function deleteItem(params: {
  schoolId: string;
  itemId: string;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: { coursework: { include: { _count: { select: { submissions: true } } } } },
  });
  if (!item) return { ok: false, message: 'That item no longer exists.' };

  /*
   * WORK THAT HAS BEEN HANDED IN IS NOT DELETED BY A MISTAKEN CLICK.
   *
   * The cascade would take every submission with it, including marked ones. A
   * lecturer tidying up their module list has not decided to destroy a term of
   * student work, and there is no undo.
   */
  const submissions = item.coursework?._count.submissions ?? 0;
  if (submissions > 0) {
    return {
      ok: false,
      message: `${submissions} student${submissions === 1 ? ' has' : 's have'} already submitted to this. Withdraw it from students instead of deleting it.`,
    };
  }

  await db.moduleItem.delete({ where: { id: item.id } });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.item.delete',
    entityType: 'ModuleItem',
    entityId: item.id,
    summary: `${item.kind} "${item.title}" deleted.`,
  });

  return { ok: true, message: 'Item deleted.' };
}

export async function moveItem(params: {
  schoolId: string;
  moduleId: string;
  itemId: string;
  toIndex: number;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const items = await db.moduleItem.findMany({
    where: { moduleId: params.moduleId },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  const ordered = reorder(
    items.map((i) => i.id),
    params.itemId,
    params.toIndex,
  );
  const positions = positionsFor(ordered);

  await db.$transaction(
    ordered.map((id) =>
      db.moduleItem.update({ where: { id }, data: { position: positions.get(id)! } }),
    ),
  );

  return { ok: true, message: 'Moved.' };
}

// -----------------------------------------------------------------------------
// Who may author this course
// -----------------------------------------------------------------------------

/**
 * Is this person the lecturer of record for the offering?
 *
 * Route guards answer "may this ROLE use the LMS at all". They cannot answer
 * "is this YOUR course", which is a question about a record — so it is asked
 * here, exactly as the two existing gradesheets ask it.
 */
export async function mayAuthorOffering(params: {
  schoolId: string;
  offeringId: string;
  instructorProfileId?: string | null;
  role: string;
}): Promise<boolean> {
  // The office oversees every course; a lecturer owns their own.
  if (['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'].includes(params.role)) return true;

  const offering = await dbFor(params.schoolId).courseOffering.findUnique({
    where: { id: params.offeringId },
    select: { instructorId: true },
  });
  if (!offering) return false;

  return Boolean(params.instructorProfileId) && offering.instructorId === params.instructorProfileId;
}

/** Is this student enrolled on the offering, and therefore entitled to its content? */
export async function enrolmentFor(params: {
  schoolId: string;
  offeringId: string;
  studentProfileId: string;
}) {
  return dbFor(params.schoolId).enrollment.findFirst({
    where: {
      offeringId: params.offeringId,
      studentId: params.studentProfileId,
      // A dropped student loses access to the material. WITHDRAWN keeps it,
      // because a withdrawal still carries an academic record.
      status: { in: ['REGISTERED', 'COMPLETED', 'WAITLISTED'] },
    },
    select: { id: true, status: true },
  });
}

// -----------------------------------------------------------------------------
// Files handed out
// -----------------------------------------------------------------------------

/**
 * Attach a file to a module — a reading, a slide deck, a past paper.
 *
 * Shares the submission upload path exactly: sniff, validate, store private,
 * serve only through a route that checks who is asking. Course material is not
 * public: a past paper or an unreleased reading list is not something to leave
 * at a guessable URL.
 *
 * NOT re-encoded, for the same reason submissions are not — a slide deck cannot
 * be decoded to pixels and written out clean. What protects it instead is that
 * it is never rendered: stored private, served as an attachment unless it is
 * one of the few formats that cannot carry a surprise.
 */
export async function saveFileItem(params: {
  schoolId: string;
  moduleId: string;
  title: string;
  file: File;
  actorUserId: string;
}): Promise<LmsResult> {
  const db = dbFor(params.schoolId);

  const problems = validateItemDraft({ kind: 'FILE', title: params.title });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  if (!params.file || params.file.size === 0) {
    return { ok: false, message: 'Choose a file to attach.' };
  }

  const module = await db.courseModule.findUnique({ where: { id: params.moduleId } });
  if (!module) return { ok: false, message: 'That module is not part of this school.' };

  const bytes = new Uint8Array(await params.file.arrayBuffer());
  const verdict = validateUpload({
    bytes,
    fileName: params.file.name,
    limits: SUBMISSION_LIMITS,
  });
  if (!verdict.ok) return { ok: false, message: verdict.message };

  const type = sniffType(bytes, extensionOf(params.file.name)) ?? verdict.type;

  const key = buildKey({
    visibility: 'private',
    schoolId: params.schoolId,
    folder: 'material',
    id: newObjectId(),
    type,
  });

  await (await storage()).put({
    key,
    body: bytes,
    mediaType: type.mediaType,
    visibility: 'private',
  });

  try {
    const siblings = await db.moduleItem.findMany({
      where: { moduleId: module.id },
      select: { position: true },
    });

    const item = await db.moduleItem.create({
      data: {
        schoolId: params.schoolId,
        moduleId: module.id,
        kind: 'FILE',
        title: params.title.trim(),
        position: nextPosition(siblings),
        isPublished: false,
        fileKey: key,
        // The name the lecturer gave it, for display only. The stored name
        // comes from the sniffed type, so nothing user-chosen reaches a path.
        fileName: params.file.name.slice(0, 200),
        fileSize: bytes.length,
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.item.create',
      entityType: 'ModuleItem',
      entityId: item.id,
      summary: `File "${params.title.trim()}" attached (${params.file.name}).`,
    });

    return { ok: true, message: 'File added as a draft.', id: item.id };
  } catch (error) {
    console.error('[lms] saveFileItem failed', error);
    return { ok: false, message: 'Could not attach that file.' };
  }
}

/**
 * May this person download a piece of course material?
 *
 * Anybody enrolled on the course, plus whoever may author it. Published only —
 * a lecturer who withdraws a reading expects that to stop people fetching it,
 * and a file that stays reachable after withdrawal makes the button a lie.
 */
export async function mayReadMaterial(params: {
  schoolId: string;
  itemId: string;
  userId: string;
  role: string;
  studentProfileId?: string | null;
  instructorProfileId?: string | null;
}): Promise<boolean> {
  const db = dbFor(params.schoolId);

  const item = await db.moduleItem.findUnique({
    where: { id: params.itemId },
    include: {
      module: { include: { space: { select: { offeringId: true } } } },
    },
  });
  if (!item?.fileKey) return false;

  const offeringId = item.module.space.offeringId;
  if (!offeringId) return false;

  // The office and the lecturer of record see everything, drafts included —
  // they are the people building it.
  const mayAuthor = await mayAuthorOffering({
    schoolId: params.schoolId,
    offeringId,
    instructorProfileId: params.instructorProfileId,
    role: params.role,
  });
  if (mayAuthor) return true;

  // Everybody else needs it published, in a published module.
  if (!item.isPublished || !item.module.isPublished) return false;

  if (!params.studentProfileId) return false;
  const enrolment = await enrolmentFor({
    schoolId: params.schoolId,
    offeringId,
    studentProfileId: params.studentProfileId,
  });
  return Boolean(enrolment);
}
