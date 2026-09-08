/**
 * =============================================================================
 * K-12 REPORT CARD GENERATION
 * =============================================================================
 *
 * No `server-only` guard here, deliberately — the same reasoning as
 * `src/server/academics.ts`. The seed and any end-of-term maintenance job must
 * be able to generate report cards, and `server-only` throws when resolved
 * outside a React Server Component graph. Duplicating the generation logic so a
 * script could have its own copy would be far worse than a missing guard: the
 * seeded document would then be free to disagree with a regenerated one.
 */

import { dbFor } from '@/lib/tenant';
import {
  assembleReportCard,
  buildReportReference,
  classAverage,
  rankByScore,
  summariseAttendance,
  summariseTerm,
  type GradedSubject,
} from '@/lib/domain/k12';
import { gradeSubjectMark } from '@/lib/domain/k12';
import { loadSchoolConfig } from '@/server/school-config';
import { recordAudit } from '@/server/services/audit.service';

export interface MarkRow {
  studentId: string;
  caScore: number | null;
  examScore: number | null;
  remark?: string | null;
}

export interface SaveMarksResult {
  ok: boolean;
  message: string;
  graded: number;
}

/**
 * Save a whole subject mark sheet.
 *
 * Marks are saved for the CLASS, not one pupil at a time, because two of the
 * columns on a report card — the class average and the pupil's position in the
 * subject — cannot be computed from one pupil's row. Saving row by row would
 * leave both stale for everyone else until the next save happened to touch them.
 *
 * Validation is all-or-nothing: every row is graded before any is written, so a
 * rejected sheet leaves the previous marks untouched and is safe to resubmit.
 */
export async function saveSubjectMarks(params: {
  schoolId: string;
  assignmentId: string;
  rows: MarkRow[];
  /** Null for a system-initiated run such as the seed. */
  actorId: string | null;
}): Promise<SaveMarksResult> {
  const db = dbFor(params.schoolId);
  const { grading } = await loadSchoolConfig(params.schoolId);

  const assignment = await db.subjectAssignment.findUnique({
    where: { id: params.assignmentId },
    include: { subject: true, formClass: true },
  });
  if (!assignment) return { ok: false, message: 'Subject assignment not found.', graded: 0 };

  let graded: { row: MarkRow; result: GradedSubject }[];
  try {
    graded = params.rows.map((row) => ({
      row,
      result: gradeSubjectMark(
        {
          studentId: row.studentId,
          subjectCode: assignment.subject.code,
          subjectName: assignment.subject.name,
          caScore: row.caScore,
          examScore: row.examScore,
        },
        grading,
      ),
    }));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Those marks are not valid.',
      graded: 0,
    };
  }

  // Class average and per-subject position are computed across the whole
  // assessed set, which is why this is a class-level operation.
  const assessed = graded.filter((g) => g.result.totalScore !== null);
  const avg = classAverage(assessed.map((g) => g.result.totalScore as number));
  const positions = new Map(
    rankByScore(
      assessed.map((g) => ({ id: g.row.studentId, score: g.result.totalScore as number })),
    ).map((r) => [r.id, r.position]),
  );

  await db.$transaction(async (tx) => {
    for (const { row, result } of graded) {
      const data = {
        caScore: row.caScore,
        examScore: row.examScore,
        totalScore: result.totalScore,
        letterGrade: result.band?.letter ?? null,
        gradePoint: result.band?.point ?? null,
        positionInClass: positions.get(row.studentId) ?? null,
        classAverage: result.totalScore === null ? null : avg,
        remark: row.remark ?? null,
        gradedAt: result.totalScore === null ? null : new Date(),
      };

      await tx.subjectResult.upsert({
        where: {
          studentId_assignmentId: {
            studentId: row.studentId,
            assignmentId: params.assignmentId,
          },
        },
        create: {
          schoolId: params.schoolId,
          studentId: row.studentId,
          assignmentId: params.assignmentId,
          ...data,
        },
        update: data,
      });
    }
  });

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorId,
    action: 'k12.marks.save',
    entityType: 'SubjectAssignment',
    entityId: params.assignmentId,
    summary: `${assignment.subject.code} marks saved for ${assignment.formClass.code}: ${assessed.length} of ${graded.length} assessed, class average ${avg.toFixed(1)}.`,
  });

  return {
    ok: true,
    message: `Saved ${assessed.length} mark${assessed.length === 1 ? '' : 's'}. Class average ${avg.toFixed(1)}.`,
    graded: assessed.length,
  };
}

export interface ReportRunSummary {
  ok: boolean;
  message: string;
  generated: number;
  promoted: number;
  repeating: number;
  underReview: number;
}

/**
 * Generate the whole class's report cards for a term.
 *
 * Done for the class rather than the pupil because position-in-class and the
 * class average are properties OF THE CLASS: generating one card at a time
 * would either recompute the class on every card or, worse, report a position
 * derived from whoever happened to be generated so far.
 *
 * `publish` is a separate, explicit act. An unpublished card is a draft the
 * office can check; a published one is a document a parent has, and its lines
 * are frozen at that moment so a reissued copy matches the one they hold.
 */
export async function generateClassReportCards(params: {
  schoolId: string;
  schoolCode: string;
  formClassId: string;
  termId: string;
  /** Null for a system-initiated run such as the seed. */
  actorId: string | null;
  publish: boolean;
}): Promise<ReportRunSummary> {
  const db = dbFor(params.schoolId);
  const { grading, k12 } = await loadSchoolConfig(params.schoolId);

  const formClass = await db.formClass.findUnique({
    where: { id: params.formClassId },
    include: { yearGroup: true },
  });
  if (!formClass) {
    return { ok: false, message: 'Form class not found.', generated: 0, promoted: 0, repeating: 0, underReview: 0 };
  }

  const [enrolments, assignments, attendance] = await Promise.all([
    db.classEnrolment.findMany({
      where: { formClassId: params.formClassId, termId: params.termId },
      include: { student: { include: { user: true } } },
    }),
    db.subjectAssignment.findMany({
      where: { formClassId: params.formClassId, termId: params.termId },
      include: { subject: true, results: true },
      orderBy: { subject: { code: 'asc' } },
    }),
    db.attendanceRecord.findMany({
      where: { termId: params.termId },
      select: { studentId: true, status: true },
    }),
  ]);

  if (enrolments.length === 0) {
    return { ok: false, message: 'No pupils are enrolled in this class for the term.', generated: 0, promoted: 0, repeating: 0, underReview: 0 };
  }

  // --- per-subject class statistics ------------------------------------------
  const perSubject = new Map<string, { classAverage: number; positions: Map<string, number> }>();
  for (const a of assignments) {
    const scored = a.results
      .map((r) => ({
        studentId: r.studentId,
        total: r.caScore === null || r.examScore === null ? null : r.caScore + r.examScore,
      }))
      .filter((r): r is { studentId: string; total: number } => r.total !== null);

    perSubject.set(a.subject.code, {
      classAverage: classAverage(scored.map((r) => r.total)),
      positions: new Map(
        rankByScore(scored.map((r) => ({ id: r.studentId, score: r.total })))
          .map((r) => [r.id, r.position]),
      ),
    });
  }

  // --- each pupil's graded subjects and termly average ------------------------
  const perPupil = enrolments.map((e) => {
    // Grade from the RAW scores through the school's current scale rather than
    // reading a stored total. The raw marks are the fact; the total, the letter
    // and the grade point are an interpretation of them, and the interpretation
    // belongs to whichever scale the school publishes today. Trusting a stored
    // total would also mean a report card generated before any mark sheet was
    // saved would silently come out as zero.
    const graded: GradedSubject[] = assignments.map((a) => {
      const result = a.results.find((r) => r.studentId === e.studentId);
      return gradeSubjectMark(
        {
          studentId: e.studentId,
          subjectCode: a.subject.code,
          subjectName: a.subject.name,
          caScore: result?.caScore ?? null,
          examScore: result?.examScore ?? null,
        },
        grading,
      );
    });
    return { enrolment: e, graded, summary: summariseTerm(graded, grading) };
  });

  // --- position in class, on the termly average -------------------------------
  const classPositions = new Map(
    rankByScore(perPupil.map((p) => ({ id: p.enrolment.studentId, score: p.summary.average })))
      .map((r) => [r.id, r.position]),
  );
  const classMean = classAverage(perPupil.map((p) => p.summary.average));

  // --- attendance tallies ------------------------------------------------------
  const tallies = new Map<string, { present: number; absent: number; late: number; excused: number }>();
  for (const r of attendance) {
    const t = tallies.get(r.studentId) ?? { present: 0, absent: 0, late: 0, excused: 0 };
    if (r.status === 'PRESENT') t.present += 1;
    else if (r.status === 'ABSENT') t.absent += 1;
    else if (r.status === 'LATE') t.late += 1;
    else if (r.status === 'EXCUSED') t.excused += 1;
    tallies.set(r.studentId, t);
  }

  const year = new Date().getFullYear();
  let sequence = await db.reportCard.count({
    where: { referenceNo: { startsWith: `RPT-${params.schoolCode.toUpperCase()}-${year}-` } },
  });

  const counts = { promoted: 0, repeating: 0, underReview: 0 };

  for (const pupil of perPupil) {
    const studentId = pupil.enrolment.studentId;
    const att = summariseAttendance(
      tallies.get(studentId) ?? { present: 0, absent: 0, late: 0, excused: 0 },
    );

    const card = assembleReportCard(
      {
        graded: pupil.graded,
        perSubject: new Map(
          [...perSubject.entries()].map(([code, s]) => [
            code,
            { classAverage: s.classAverage, position: s.positions.get(studentId) ?? null },
          ]),
        ),
        attendance: att,
        positionInClass: classPositions.get(studentId) ?? perPupil.length,
        classSize: perPupil.length,
        classAverage: classMean,
        isTerminalYear: formClass.yearGroup.isTerminal,
      },
      grading,
      k12,
    );

    if (card.promotion.decision === 'PROMOTED' || card.promotion.decision === 'GRADUATED') counts.promoted += 1;
    else if (card.promotion.decision === 'REPEAT') counts.repeating += 1;
    else counts.underReview += 1;

    const existing = await db.reportCard.findUnique({
      where: { studentId_termId: { studentId, termId: params.termId } },
    });

    // A published card is a document a parent already holds. Regenerating it
    // would silently change what they were given, so it is refused.
    if (existing?.publishedAt) continue;

    const referenceNo = existing?.referenceNo ?? buildReportReference(params.schoolCode, year, ++sequence);

    const payload = {
      formClassCode: formClass.code,
      totalMarks: card.summary.totalMarks,
      maxMarks: card.summary.maxMarks,
      average: card.summary.average,
      classAverage: card.classAverage,
      positionInClass: card.positionInClass,
      classSize: card.classSize,
      overallGrade: card.summary.overallBand?.letter ?? '—',
      daysPresent: att.present,
      daysAbsent: att.absent,
      daysLate: att.late,
      daysInTerm: att.totalSessions,
      promotionDecision: card.promotion.decision,
      promotionReason: card.promotion.reason,
      publishedAt: params.publish ? new Date() : null,
    };

    await db.$transaction(async (tx) => {
      const saved = await tx.reportCard.upsert({
        where: { studentId_termId: { studentId, termId: params.termId } },
        create: { schoolId: params.schoolId, studentId, termId: params.termId, referenceNo, ...payload },
        update: payload,
      });

      // Lines are rewritten wholesale so a re-run never leaves a stale subject
      // row behind from a previous generation.
      await tx.reportCardLine.deleteMany({ where: { reportCardId: saved.id } });
      await tx.reportCardLine.createMany({
        data: card.lines.map((l, i) => ({
          schoolId: params.schoolId,
          reportCardId: saved.id,
          subjectCode: l.subjectCode,
          subjectName: l.subjectName,
          caScore: l.caScore,
          examScore: l.examScore,
          totalScore: l.totalScore,
          letterGrade: l.letterGrade,
          classAverage: l.classAverage,
          positionInClass: l.positionInClass,
          position: i,
        })),
      });
    });
  }

  void recordAudit({
    schoolId: params.schoolId,
    actorId: params.actorId,
    action: params.publish ? 'k12.reports.publish' : 'k12.reports.generate',
    entityType: 'FormClass',
    entityId: params.formClassId,
    summary: `${params.publish ? 'Published' : 'Generated'} ${perPupil.length} report cards for ${formClass.code}: ${counts.promoted} promoted, ${counts.repeating} repeating, ${counts.underReview} under review.`,
  });

  return {
    ok: true,
    message: params.publish
      ? `Published ${perPupil.length} report cards. Guardians can now see them.`
      : `Generated ${perPupil.length} draft report cards.`,
    generated: perPupil.length,
    ...counts,
  };
}

