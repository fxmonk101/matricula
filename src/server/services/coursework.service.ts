import { dbFor } from '@/lib/tenant';
import {
  isLate,
  validateCourseworkDraft,
  validateSubmission,
  type CourseworkDraft,
} from '@/lib/domain/coursework';
import { GRADED_ITEM_KINDS, nextPosition, validateItemDraft } from '@/lib/domain/lms';
import {
  computeCaScore,
  previewPost,
  summarisePost,
  validateMark,
  type GradebookItem,
  type PostPreviewRow,
  type PostSummary,
} from '@/lib/domain/gradebook';
import { computeTotalScore, scoreToGrade } from '@/lib/domain/grading';
import { loadSchoolConfig } from '@/server/school-config';
import { recomputeStudentAcademics } from '@/server/academics';
import { SUBMISSION_LIMITS, sniffType, validateUpload, extensionOf } from '@/lib/domain/upload';
import { buildKey, newObjectId, storage } from '@/server/storage';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * COURSEWORK
 * =============================================================================
 *
 * Setting work, and receiving it.
 *
 * A piece of coursework is a `ModuleItem` of kind COURSEWORK with a `Coursework`
 * row beside it, created together in one transaction. Splitting them means a
 * failure halfway leaves an item a student can see and cannot submit to.
 */

export interface CourseworkResult {
  ok: boolean;
  message: string;
  id?: string;
}

// -----------------------------------------------------------------------------
// Setting work
// -----------------------------------------------------------------------------

export async function saveCoursework(params: {
  schoolId: string;
  moduleId: string;
  /** Present when editing; the ModuleItem id, not the Coursework id. */
  itemId?: string | null;
  title: string;
  instructions?: string | null;
  pointsPossible: number;
  dueAt?: Date | null;
  allowsText: boolean;
  allowsFile: boolean;
  acceptsLate: boolean;
  rubricJson?: string | null;
  actorUserId: string;
  now?: Date;
}): Promise<CourseworkResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const draft: CourseworkDraft = {
    title: params.title,
    instructions: params.instructions,
    pointsPossible: params.pointsPossible,
    dueAt: params.dueAt,
    allowsText: params.allowsText,
    allowsFile: params.allowsFile,
    acceptsLate: params.acceptsLate,
  };

  const problems = [
    ...validateItemDraft({ kind: 'COURSEWORK', title: params.title }),
    ...validateCourseworkDraft(draft, now),
  ];
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // Re-read through the tenant client: a crafted id must not attach work to
  // another university's module.
  const module = await db.courseModule.findUnique({ where: { id: params.moduleId } });
  if (!module) return { ok: false, message: 'That module is not part of this school.' };

  const courseworkData = {
    instructions: params.instructions?.trim() || null,
    pointsPossible: params.pointsPossible,
    dueAt: params.dueAt ?? null,
    allowsText: params.allowsText,
    allowsFile: params.allowsFile,
    acceptsLate: params.acceptsLate,
    rubricJson: params.rubricJson?.trim() || null,
  };

  try {
    if (params.itemId) {
      const existing = await db.moduleItem.findFirst({
        where: { id: params.itemId, moduleId: module.id },
        include: { coursework: { include: { _count: { select: { submissions: true } } } } },
      });
      if (!existing?.coursework) return { ok: false, message: 'That assignment no longer exists.' };

      /*
       * THE MARK SCHEME IS FROZEN ONCE WORK HAS BEEN HANDED IN.
       *
       * Changing `pointsPossible` after submissions exist silently rescales
       * every mark already given: 8/10 becomes 8/20 without anybody editing a
       * mark. The title, the instructions and the deadline stay editable,
       * because correcting a typo in a question is a normal and necessary
       * thing to do mid-assignment.
       */
      const submitted = existing.coursework._count.submissions;
      if (submitted > 0 && existing.coursework.pointsPossible !== params.pointsPossible) {
        return {
          ok: false,
          message: `${submitted} student${submitted === 1 ? ' has' : 's have'} already submitted, so the marks available cannot change — every mark given would silently rescale.`,
        };
      }

      await db.$transaction([
        db.moduleItem.update({ where: { id: existing.id }, data: { title: params.title.trim() } }),
        db.coursework.update({ where: { id: existing.coursework.id }, data: courseworkData }),
      ]);

      void recordAudit({
        schoolId: params.schoolId,
        actorId: params.actorUserId,
        action: 'lms.coursework.update',
        entityType: 'Coursework',
        entityId: existing.coursework.id,
        summary: `Assignment "${params.title.trim()}" edited.`,
      });

      return { ok: true, message: 'Assignment saved.', id: existing.id };
    }

    const siblings = await db.moduleItem.findMany({
      where: { moduleId: module.id },
      select: { position: true },
    });

    // One transaction: an item a student can see but not submit to is worse
    // than no item at all.
    const item = await db.$transaction(async (tx) => {
      const created = await tx.moduleItem.create({
        data: {
          schoolId: params.schoolId,
          moduleId: module.id,
          kind: 'COURSEWORK',
          title: params.title.trim(),
          position: nextPosition(siblings),
          isPublished: false,
        },
      });

      await tx.coursework.create({
        data: { schoolId: params.schoolId, moduleItemId: created.id, ...courseworkData },
      });

      return created;
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.coursework.create',
      entityType: 'ModuleItem',
      entityId: item.id,
      summary: `Assignment "${params.title.trim()}" set, worth ${params.pointsPossible}.`,
    });

    return { ok: true, message: 'Assignment added as a draft.', id: item.id };
  } catch (error) {
    console.error('[coursework] save failed', error);
    return { ok: false, message: 'Could not save that assignment.' };
  }
}

/** One piece of coursework, with the roster and every hand-in. For the lecturer. */
export async function loadCourseworkForTeacher(params: {
  schoolId: string;
  courseworkId: string;
}) {
  const db = dbFor(params.schoolId);

  const coursework = await db.coursework.findUnique({
    where: { id: params.courseworkId },
    include: {
      moduleItem: {
        include: { module: { include: { space: { include: { offering: true } } } } },
      },
      submissions: {
        orderBy: [{ enrollmentId: 'asc' }, { attempt: 'desc' }],
        include: {
          enrollment: { include: { student: { include: { user: true } } } },
          gradedBy: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });

  return coursework;
}

// -----------------------------------------------------------------------------
// Handing in
// -----------------------------------------------------------------------------

export interface SubmitResult extends CourseworkResult {
  attempt?: number;
}

/**
 * A student hands work in.
 *
 * Every hand-in is a NEW ATTEMPT rather than an edit of the last. Work that can
 * be silently replaced after it was marked is not evidence of anything, and a
 * question about what was submitted, and when, has to be answerable afterwards.
 */
export async function submitCoursework(params: {
  schoolId: string;
  courseworkId: string;
  /** The student's own enrolment. Resolved by the caller from the session. */
  enrollmentId: string;
  textBody?: string | null;
  file?: File | null;
  actorUserId: string;
  now?: Date;
}): Promise<SubmitResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const coursework = await db.coursework.findUnique({
    where: { id: params.courseworkId },
    include: { moduleItem: { include: { module: true } } },
  });
  if (!coursework) return { ok: false, message: 'That assignment no longer exists.' };

  /*
   * A DRAFT CANNOT BE SUBMITTED TO. The student list never shows one, so
   * reaching this means a stale page or a crafted id — and accepting the work
   * would create a submission against something the class was never set.
   */
  if (!coursework.moduleItem.isPublished || !coursework.moduleItem.module.isPublished) {
    return { ok: false, message: 'That assignment is not open.' };
  }

  const enrollment = await db.enrollment.findUnique({ where: { id: params.enrollmentId } });
  if (!enrollment) return { ok: false, message: 'You are not registered on this course.' };

  const rules = {
    allowsText: coursework.allowsText,
    allowsFile: coursework.allowsFile,
    acceptsLate: coursework.acceptsLate,
    dueAt: coursework.dueAt,
  };

  const problems = validateSubmission(
    { textBody: params.textBody, hasFile: Boolean(params.file && params.file.size > 0) },
    rules,
    now,
  );
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  // --- the file ------------------------------------------------------------
  let fileKey: string | null = null;
  let fileName: string | null = null;
  let fileSize: number | null = null;

  if (params.file && params.file.size > 0) {
    const bytes = new Uint8Array(await params.file.arrayBuffer());
    const verdict = validateUpload({
      bytes,
      fileName: params.file.name,
      limits: SUBMISSION_LIMITS,
    });
    if (!verdict.ok) return { ok: false, message: verdict.message };

    /*
     * NOT RE-ENCODED, and that is the honest difference from every other upload
     * here. An image can be decoded to pixels and written out clean; a Word
     * document cannot. What protects this instead is that it is never rendered:
     * stored private, served only through a route that checks who is asking,
     * and always as an attachment with nosniff.
     */
    const type = sniffType(bytes, extensionOf(params.file.name)) ?? verdict.type;

    const key = buildKey({
      visibility: 'private',
      schoolId: params.schoolId,
      folder: 'submission',
      id: newObjectId(),
      type,
    });

    await (await storage()).put({
      key,
      body: bytes,
      mediaType: type.mediaType,
      visibility: 'private',
    });

    fileKey = key;
    // The name the student gave it, kept for display only — never used to
    // build a path. `buildKey` derives the stored name from the sniffed type.
    fileName = params.file.name.slice(0, 200);
    fileSize = bytes.length;
  }

  const previous = await db.submission.findFirst({
    where: { courseworkId: coursework.id, enrollmentId: enrollment.id },
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  });
  const attempt = (previous?.attempt ?? 0) + 1;

  try {
    const submission = await db.submission.create({
      data: {
        schoolId: params.schoolId,
        courseworkId: coursework.id,
        enrollmentId: enrollment.id,
        attempt,
        textBody: params.textBody?.trim() || null,
        fileKey,
        fileName,
        fileSize,
        submittedAt: now,
        // Recorded AT HAND-IN against the deadline as it stood. Moving the
        // deadline afterwards must not rewrite who was late.
        isLate: isLate(coursework.dueAt, now),
      },
    });

    void recordAudit({
      schoolId: params.schoolId,
      actorId: params.actorUserId,
      action: 'lms.submission.create',
      entityType: 'Submission',
      entityId: submission.id,
      summary: `Attempt ${attempt} submitted for "${coursework.moduleItem.title}"${submission.isLate ? ' (late)' : ''}.`,
    });

    return {
      ok: true,
      attempt,
      message: submission.isLate
        ? `Submitted, and recorded as late. This is attempt ${attempt}.`
        : attempt === 1
          ? 'Submitted.'
          : `Submitted. This is attempt ${attempt}; your lecturer sees the most recent one.`,
    };
  } catch (error) {
    console.error('[coursework] submit failed', error);
    return { ok: false, message: 'Could not submit that. Try again.' };
  }
}

/** A student's own latest attempt at one piece of work. */
export async function latestSubmission(params: {
  schoolId: string;
  courseworkId: string;
  enrollmentId: string;
}) {
  return dbFor(params.schoolId).submission.findFirst({
    where: { courseworkId: params.courseworkId, enrollmentId: params.enrollmentId },
    orderBy: { attempt: 'desc' },
  });
}

/** Every attempt, newest first — so a student can see what they sent before. */
export async function submissionHistory(params: {
  schoolId: string;
  courseworkId: string;
  enrollmentId: string;
}) {
  return dbFor(params.schoolId).submission.findMany({
    where: { courseworkId: params.courseworkId, enrollmentId: params.enrollmentId },
    orderBy: { attempt: 'desc' },
  });
}

/**
 * One piece of coursework as a STUDENT may see it.
 *
 * Returns null for anything not published, rather than returning the row with a
 * flag. The caller cannot then forget to check.
 */
export async function loadCourseworkForStudent(params: {
  schoolId: string;
  courseworkId: string;
}) {
  const coursework = await dbFor(params.schoolId).coursework.findUnique({
    where: { id: params.courseworkId },
    include: {
      moduleItem: {
        include: { module: { include: { space: { select: { offeringId: true } } } } },
      },
    },
  });

  if (!coursework) return null;
  if (!coursework.moduleItem.isPublished) return null;
  if (!coursework.moduleItem.module.isPublished) return null;

  return coursework;
}

/**
 * May this person read this submission's attachment?
 *
 * The answer the `/files/[...key]` route cannot give. That route checks the
 * session and the tenant, which is right for a school logo and nowhere near
 * enough for a student's work: every signed-in member of the school would
 * otherwise be able to read any submission whose key they learned.
 */
export async function mayReadSubmission(params: {
  schoolId: string;
  submissionId: string;
  userId: string;
  role: string;
}): Promise<boolean> {
  const db = dbFor(params.schoolId);

  const submission = await db.submission.findUnique({
    where: { id: params.submissionId },
    include: {
      enrollment: { include: { student: { select: { userId: true } } } },
      coursework: {
        include: {
          moduleItem: {
            include: {
              module: {
                include: { space: { include: { offering: { select: { instructorId: true } } } } },
              },
            },
          },
        },
      },
    },
  });
  if (!submission) return false;

  // Its author.
  if (submission.enrollment.student.userId === params.userId) return true;

  // The office, who may already override any grade in the institution.
  if (['OWNER', 'ADMIN', 'REGISTRAR', 'DEAN', 'HOD'].includes(params.role)) return true;

  // The lecturer of record for the section it was submitted to.
  const instructorId = submission.coursework.moduleItem.module.space.offering?.instructorId;
  if (!instructorId) return false;

  const instructor = await db.instructor.findFirst({
    where: { id: instructorId },
    select: { userId: true },
  });

  return instructor?.userId === params.userId;
}

// -----------------------------------------------------------------------------
// Marking
// -----------------------------------------------------------------------------

/**
 * Mark one submission.
 *
 * The mark lands on the SUBMISSION, not on the enrolment. Nothing here touches
 * a student's academic record: moving coursework marks into `caScore` is a
 * separate, deliberate act (`postCourseworkToGradesheet` below), because a
 * lecturer marking one essay at eleven at night has not decided to republish
 * every student's continuous assessment.
 */
export async function markSubmission(params: {
  schoolId: string;
  submissionId: string;
  score: number;
  feedback?: string | null;
  /** The marker's Membership id, for the audit trail. */
  markedByMembershipId: string;
  actorUserId: string;
  now?: Date;
}): Promise<CourseworkResult> {
  const now = params.now ?? new Date();
  const db = dbFor(params.schoolId);

  const submission = await db.submission.findUnique({
    where: { id: params.submissionId },
    include: {
      coursework: { include: { moduleItem: { select: { title: true } } } },
      enrollment: { include: { student: { include: { user: true } } } },
    },
  });
  if (!submission) return { ok: false, message: 'That submission no longer exists.' };

  const problems = validateMark({
    score: params.score,
    pointsPossible: submission.coursework.pointsPossible,
    feedback: params.feedback,
  });
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  await db.submission.update({
    where: { id: submission.id },
    data: {
      score: params.score,
      feedback: params.feedback?.trim() || null,
      gradedById: params.markedByMembershipId,
      gradedAt: now,
    },
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.submission.mark',
    entityType: 'Submission',
    entityId: submission.id,
    summary: `${submission.enrollment.student.matricNumber} marked ${params.score}/${submission.coursework.pointsPossible} on "${submission.coursework.moduleItem.title}".`,
    metadata: { score: params.score, pointsPossible: submission.coursework.pointsPossible },
  });

  return {
    ok: true,
    message: `Marked ${params.score} of ${submission.coursework.pointsPossible}.`,
    id: submission.id,
  };
}

// -----------------------------------------------------------------------------
// The roll-up
// -----------------------------------------------------------------------------

export interface GradebookRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  matricNumber: string;
  existingCaScore: number | null;
  examScore: number | null;
  items: GradebookItem[];
}

/**
 * Every student on the offering against every piece of coursework in it.
 *
 * Built from THREE queries rather than one per student: a class of two hundred
 * against ten assignments is otherwise two thousand round trips to draw one
 * table.
 */
export async function loadGradebook(params: { schoolId: string; offeringId: string }) {
  const db = dbFor(params.schoolId);

  const space = await db.courseSpace.findFirst({
    where: { offeringId: params.offeringId },
    include: {
      modules: {
        orderBy: { position: 'asc' },
        include: {
          items: {
            /*
             * Both graded kinds. A quiz IS a piece of coursework — it carries a
             * Coursework row and writes a Submission — so leaving it out here
             * meant it was marked and then quietly dropped from the CA roll-up.
             */
            where: { kind: { in: [...GRADED_ITEM_KINDS] } },
            orderBy: { position: 'asc' },
            include: { coursework: true },
          },
        },
      },
    },
  });

  const coursework = (space?.modules ?? [])
    .flatMap((module) => module.items)
    .flatMap((item) => (item.coursework ? [{ ...item.coursework, title: item.title }] : []));

  const [enrolments, submissions] = await Promise.all([
    db.enrollment.findMany({
      where: {
        offeringId: params.offeringId,
        status: { in: ['REGISTERED', 'COMPLETED'] },
      },
      include: { student: { include: { user: true } } },
      orderBy: { student: { matricNumber: 'asc' } },
    }),
    coursework.length > 0
      ? db.submission.findMany({
          where: { courseworkId: { in: coursework.map((c) => c.id) } },
          orderBy: { attempt: 'desc' },
        })
      : Promise.resolve([]),
  ]);

  /*
   * ONLY THE LATEST ATTEMPT COUNTS. Submissions arrive newest-first, so the
   * first one seen for a given (coursework, enrolment) pair is the one that
   * stands — which is also what the student was told would happen.
   */
  const latest = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    const key = `${submission.courseworkId}:${submission.enrollmentId}`;
    if (!latest.has(key)) latest.set(key, submission);
  }

  const rows: GradebookRow[] = enrolments.map((enrolment) => ({
    enrollmentId: enrolment.id,
    studentId: enrolment.studentId,
    studentName: `${enrolment.student.user.firstName} ${enrolment.student.user.lastName}`,
    matricNumber: enrolment.student.matricNumber,
    existingCaScore: enrolment.caScore,
    examScore: enrolment.examScore,
    items: coursework.map((piece) => {
      const submission = latest.get(`${piece.id}:${enrolment.id}`);
      return {
        courseworkId: piece.id,
        title: piece.title,
        pointsPossible: piece.pointsPossible,
        score: submission?.score ?? null,
        submitted: Boolean(submission),
      };
    }),
  }));

  return { coursework, rows };
}

export interface PostPreview {
  rows: PostPreviewRow[];
  summary: PostSummary;
  caWeight: number;
}

/** What posting would do, computed but not applied. */
export async function previewCourseworkPost(params: {
  schoolId: string;
  offeringId: string;
  countMissingAsZero: boolean;
}): Promise<PostPreview> {
  const { grading } = await loadSchoolConfig(params.schoolId);
  const caWeight = grading.assessmentWeights.ca;

  const { rows } = await loadGradebook(params);

  const previews: PostPreviewRow[] = rows.map((row) => {
    const computed = computeCaScore({
      items: row.items,
      caWeight,
      countMissingAsZero: params.countMissingAsZero,
    });
    return {
      enrollmentId: row.enrollmentId,
      studentName: row.studentName,
      matricNumber: row.matricNumber,
      computed,
      existingCaScore: row.existingCaScore,
      outcome: previewPost({ computed, existingCaScore: row.existingCaScore }),
    };
  });

  return { rows: previews, summary: summarisePost(previews), caWeight };
}

export interface PostResult {
  ok: boolean;
  message: string;
  written?: number;
  skipped?: number;
}

/**
 * Write computed coursework marks onto the enrolments as `caScore`.
 *
 * DELIBERATELY NOT `submitGrade`, and that distinction matters. `submitGrade`
 * requires an exam score, sets the letter grade and marks the enrolment
 * COMPLETED — which is correct at the end of a course and catastrophic in week
 * six: every student would be "completed" with a grade computed against an exam
 * that has not happened. This writes `caScore` and nothing else.
 *
 * Where an exam mark IS already present the total, letter and point are
 * recomputed, through the same pure functions the gradesheet uses, so the two
 * paths can never disagree about what a score means.
 *
 * Overwriting a `caScore` somebody typed requires `overwriteExisting`. That
 * figure may be a viva mark or an agreed adjustment, and replacing it silently
 * destroys a human judgement with no record that it existed.
 */
export async function postCourseworkToGradesheet(params: {
  schoolId: string;
  offeringId: string;
  countMissingAsZero: boolean;
  overwriteExisting: boolean;
  actorUserId: string;
}): Promise<PostResult> {
  const db = dbFor(params.schoolId);
  const { grading } = await loadSchoolConfig(params.schoolId);

  const preview = await previewCourseworkPost(params);

  const toWrite = preview.rows.filter(
    (row) =>
      row.outcome === 'WOULD_SET' ||
      (row.outcome === 'WOULD_OVERWRITE' && params.overwriteExisting),
  );
  // Hand-entered marks left alone, which is all of them unless asked.
  const skipped = params.overwriteExisting ? 0 : preview.summary.toOverwrite;

  if (toWrite.length === 0) {
    return {
      ok: false,
      written: 0,
      skipped,
      message:
        preview.summary.toOverwrite > 0 && !params.overwriteExisting
          ? `Nothing written. ${preview.summary.toOverwrite} student${preview.summary.toOverwrite === 1 ? ' has' : 's have'} a CA mark entered by hand — tick the overwrite box if you mean to replace it.`
          : 'Nothing to post. No coursework has been marked yet.',
    };
  }

  const enrolments = await db.enrollment.findMany({
    where: { id: { in: toWrite.map((r) => r.enrollmentId) } },
    select: { id: true, examScore: true, studentId: true },
  });
  const byId = new Map(enrolments.map((e) => [e.id, e]));

  const touchedStudents = new Set<string>();

  await db.$transaction(
    toWrite.map((row) => {
      const enrolment = byId.get(row.enrollmentId);
      const caScore = row.computed.caScore!;
      touchedStudents.add(enrolment!.studentId);

      // With an exam mark already in, the derived fields move with the CA.
      // Without one they stay untouched: there is no total yet to compute.
      if (enrolment?.examScore !== null && enrolment?.examScore !== undefined) {
        const total = computeTotalScore(caScore, enrolment.examScore, grading.assessmentWeights);
        const band = scoreToGrade(total, grading.scale);
        return db.enrollment.update({
          where: { id: row.enrollmentId },
          data: {
            caScore,
            totalScore: total,
            letterGrade: band.letter,
            gradePoint: band.point,
          },
        });
      }

      return db.enrollment.update({ where: { id: row.enrollmentId }, data: { caScore } });
    }),
  );

  /*
   * Aggregates are recomputed for every student whose derived grade moved. The
   * full CGPA is rebuilt rather than adjusted, for the reason `submitGrade`
   * documents: an incremental total drifts, and once it has drifted there is no
   * way to tell which of the two figures is wrong.
   */
  for (const studentId of touchedStudents) {
    await recomputeStudentAcademics(params.schoolId, studentId);
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorUserId,
    action: 'lms.coursework.post',
    entityType: 'CourseOffering',
    entityId: params.offeringId,
    summary: `Coursework posted to continuous assessment for ${toWrite.length} student(s)${params.countMissingAsZero ? ', missing work counted as zero' : ''}${params.overwriteExisting ? ', overwriting hand-entered marks' : ''}.`,
    metadata: {
      written: toWrite.length,
      caWeight: preview.caWeight,
      countMissingAsZero: params.countMissingAsZero,
      overwriteExisting: params.overwriteExisting,
    },
  });

  return {
    ok: true,
    written: toWrite.length,
    skipped,
    message:
      skipped > 0
        ? `Posted for ${toWrite.length} student${toWrite.length === 1 ? '' : 's'}. ${skipped} left alone because their CA was entered by hand.`
        : `Posted for ${toWrite.length} student${toWrite.length === 1 ? '' : 's'}.`,
  };
}
