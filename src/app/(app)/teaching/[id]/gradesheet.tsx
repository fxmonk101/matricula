'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { ASSESSMENT_WEIGHTS, scoreToGrade } from '@/lib/domain/grading';
import { saveGradesheetAction, submitResultsAction, type GradeFormState } from './actions';

interface Row {
  enrollmentId: string;
  matricNumber: string;
  name: string;
  /**
   * Set only when this school ENFORCES its attendance rule and this student
   * is below it.
   *
   * Shown here rather than made into a Hold, because a Hold is a fact about a
   * STUDENT that blocks registration and a bar from an examination is a fact
   * about one COURSE. Conflating them would stop somebody registering for next
   * term because they missed lectures in one subject this one.
   *
   * And shown rather than enforced: the lecturer entering the mark is the
   * person who knows whether the register is complete and whether an appeal is
   * running. A field that refuses the number would be worked around by typing
   * it somewhere else.
   */
  attendanceBar?: { percentage: number; threshold: number } | null;
  caScore: number | null;
  examScore: number | null;
  totalScore: number | null;
  letterGrade: string | null;
  gradePoint: number | null;
}

function SaveButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || locked}>
      {pending ? 'Saving…' : 'Save gradesheet'}
    </Button>
  );
}

/**
 * Submit, not publish.
 *
 * The wording matters more than it looks. This button used to say "Post
 * grades to students" and that is what it did — the marks went straight onto
 * transcripts. It now hands them to the head of department, and a lecturer
 * who thinks they have published when they have not will chase the wrong
 * office when a student complains their result is missing.
 */
function PostButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="success" disabled={pending || disabled}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </Button>
  );
}

export function Gradesheet({
  offeringId,
  rows,
  locked,
}: {
  offeringId: string;
  rows: Row[];
  locked: boolean;
}) {
  const [saveState, saveAction] = useActionState<GradeFormState, FormData>(
    saveGradesheetAction,
    {},
  );
  const [postState, postAction] = useActionState<GradeFormState, FormData>(submitResultsAction, {});

  /*
   * Local draft state exists purely so the letter grade updates as the
   * instructor types. It is a preview computed with the SAME `scoreToGrade`
   * the server uses, so what they see while typing is exactly what gets
   * stored — no second, drifting implementation of the grading scale.
   */
  const [draft, setDraft] = useState<Record<string, { ca: string; exam: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.enrollmentId,
        { ca: r.caScore?.toString() ?? '', exam: r.examScore?.toString() ?? '' },
      ]),
    ),
  );

  const preview = (id: string) => {
    const d = draft[id];
    if (!d?.ca || !d?.exam) return null;
    const ca = Number(d.ca);
    const exam = Number(d.exam);
    if (!Number.isFinite(ca) || !Number.isFinite(exam)) return null;
    if (ca < 0 || ca > ASSESSMENT_WEIGHTS.ca) return null;
    if (exam < 0 || exam > ASSESSMENT_WEIGHTS.exam) return null;
    const total = ca + exam;
    try {
      return { total, band: scoreToGrade(total) };
    } catch {
      return null;
    }
  };

  const ungradedCount = rows.filter((r) => {
    const p = preview(r.enrollmentId);
    return !p && r.gradePoint === null;
  }).length;

  return (
    <Card>
      <CardHeader
        title="Gradesheet"
        description={`Continuous assessment out of ${ASSESSMENT_WEIGHTS.ca}, examination out of ${ASSESSMENT_WEIGHTS.exam}. Leave both blank for a student who has not been assessed.`}
        actions={
          <form action={postAction}>
            <input type="hidden" name="offeringId" value={offeringId} />
            <PostButton disabled={ungradedCount > 0 || locked} />
          </form>
        }
      />

      {saveState.message ? (
        <div className="px-5 pt-4">
          <Alert tone={saveState.ok ? 'success' : 'danger'}>{saveState.message}</Alert>
        </div>
      ) : null}
      {postState.message ? (
        <div className="px-5 pt-4">
          <Alert tone={postState.ok ? 'success' : 'warning'}>{postState.message}</Alert>
        </div>
      ) : null}

      <form action={saveAction}>
        <input type="hidden" name="offeringId" value={offeringId} />

        <Table className="table-zebra">
          <thead>
            <tr>
              <Th>Matric number</Th>
              <Th>Student</Th>
              <Th className="w-28 text-right">CA / {ASSESSMENT_WEIGHTS.ca}</Th>
              <Th className="w-28 text-right">Exam / {ASSESSMENT_WEIGHTS.exam}</Th>
              <Th className="w-20 text-right">Total</Th>
              <Th className="w-24 text-center">Grade</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const p = preview(row.enrollmentId);
              const error = saveState.fieldErrors?.[row.enrollmentId];

              return (
                <tr key={row.enrollmentId}>
                  <Td className="font-mono text-xs">{row.matricNumber}</Td>
                  <Td className="font-medium text-slate-900">
                    {row.name}
                    {row.attendanceBar ? (
                      <div className="mt-0.5 text-[11px] font-normal text-rose-700">
                        Attendance {row.attendanceBar.percentage.toFixed(0)}% — below the{' '}
                        {row.attendanceBar.threshold}% needed to sit
                      </div>
                    ) : null}
                    {error ? <div className="text-[11px] text-rose-600">{error}</div> : null}
                  </Td>
                  <Td>
                    <Input
                      name={`ca_${row.enrollmentId}`}
                      type="number"
                      min={0}
                      max={ASSESSMENT_WEIGHTS.ca}
                      step="0.5"
                      disabled={locked}
                      value={draft[row.enrollmentId]?.ca ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [row.enrollmentId]: {
                            ca: e.target.value,
                            exam: d[row.enrollmentId]?.exam ?? '',
                          },
                        }))
                      }
                      className="text-right tabular-nums"
                      aria-label={`Continuous assessment for ${row.name}`}
                    />
                  </Td>
                  <Td>
                    <Input
                      name={`exam_${row.enrollmentId}`}
                      type="number"
                      min={0}
                      max={ASSESSMENT_WEIGHTS.exam}
                      step="0.5"
                      disabled={locked}
                      value={draft[row.enrollmentId]?.exam ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [row.enrollmentId]: {
                            ca: d[row.enrollmentId]?.ca ?? '',
                            exam: e.target.value,
                          },
                        }))
                      }
                      className="text-right tabular-nums"
                      aria-label={`Examination score for ${row.name}`}
                    />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {p ? p.total.toFixed(1) : (row.totalScore?.toFixed(1) ?? '—')}
                  </Td>
                  <Td className="text-center">
                    {p ? (
                      <Badge tone={p.band.point >= 2 ? 'success' : p.band.point >= 1 ? 'warning' : 'danger'}>
                        {p.band.letter} · {p.band.point.toFixed(1)}
                      </Badge>
                    ) : row.letterGrade ? (
                      <Badge tone="neutral">{row.letterGrade}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500">
            {ungradedCount > 0
              ? `${ungradedCount} student${ungradedCount === 1 ? '' : 's'} still to be assessed.`
              : 'All students assessed — ready to post.'}
          </p>
          <SaveButton locked={locked} />
        </div>
      </form>
    </Card>
  );
}
