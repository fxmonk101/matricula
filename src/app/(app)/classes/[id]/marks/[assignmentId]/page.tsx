import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { Alert, Badge, PageHeader } from '@/components/ui';
import { MarkSheet } from './mark-sheet';

export const metadata: Metadata = { title: 'Mark sheet' };

export default async function MarkSheetPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { db, session, config } = await requireTenantRole('ADMIN', 'REGISTRAR', 'INSTRUCTOR');
  const { id, assignmentId } = await params;

  const assignment = await db.subjectAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      subject: true,
      formClass: { include: { yearGroup: true } },
      term: true,
      teacher: { include: { user: true } },
      results: true,
    },
  });

  // The assignment must belong to the class in the URL. Without this a valid
  // assignment id reached through the wrong class would render, and the "back"
  // link would send the teacher somewhere they were never working.
  if (!assignment || assignment.formClassId !== id) notFound();

  const enrolments = await db.classEnrolment.findMany({
    where: { formClassId: id, termId: assignment.termId },
    include: { student: { include: { user: true } } },
    orderBy: { student: { user: { lastName: 'asc' } } },
  });

  const readOnly =
    session.role === 'INSTRUCTOR' && assignment.teacherId !== session.pid;

  const resultByStudent = new Map(assignment.results.map((r) => [r.studentId, r]));

  const rows = enrolments.map((e) => {
    const r = resultByStudent.get(e.studentId);
    return {
      studentId: e.studentId,
      admissionNo: e.student.matricNumber,
      name: `${e.student.user.firstName} ${e.student.user.lastName}`,
      caScore: r?.caScore ?? null,
      examScore: r?.examScore ?? null,
      totalScore: r?.totalScore ?? null,
      letterGrade: r?.letterGrade ?? null,
      remark: r?.remark ?? null,
    };
  });

  return (
    <>
      <PageHeader
        title={`${assignment.subject.name} — ${assignment.formClass.name}`}
        description={`${assignment.term.name} · ${assignment.term.academicYear} · ${assignment.teacher ? `${assignment.teacher.user.firstName} ${assignment.teacher.user.lastName}` : 'no teacher assigned'}`}
        actions={
          <Link href={`/classes/${id}`} className="text-sm text-brand-700 hover:underline">
            ← {assignment.formClass.name}
          </Link>
        }
      />

      {readOnly ? (
        <div className="mb-4">
          <Alert tone="info" title="Read only">
            You are not the subject teacher for {assignment.subject.code} in{' '}
            {assignment.formClass.name}, so these marks are shown but cannot be edited.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="brand">{assignment.subject.code}</Badge>
        {config.k12.compulsorySubjectCodes.includes(assignment.subject.code) ? (
          <Badge tone="warning">Compulsory — a fail here refers the pupil for review</Badge>
        ) : null}
      </div>

      <MarkSheet
        assignmentId={assignmentId}
        rows={rows}
        readOnly={readOnly}
        weights={config.grading.assessmentWeights}
        scale={config.grading.scale}
      />
    </>
  );
}
