'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Badge, Button, Card, CardHeader, Input, Table, Td, Th } from '@/components/ui';
import { scoreToGrade } from '@/lib/domain/grading';
import type { GradeBand } from '@/lib/domain/grading';
import { saveMarksAction, type K12FormState } from '../../actions';

interface Row {
  studentId: string;
  admissionNo: string;
  name: string;
  caScore: number | null;
  examScore: number | null;
  totalScore: number | null;
  letterGrade: string | null;
  remark: string | null;
}

function SaveButton({ readOnly }: { readOnly: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || readOnly}>
      {pending ? 'Saving…' : 'Save mark sheet'}
    </Button>
  );
}

export function MarkSheet({
  assignmentId,
  rows,
  readOnly,
  weights,
  scale,
}: {
  assignmentId: string;
  rows: Row[];
  readOnly: boolean;
  weights: { ca: number; exam: number };
  scale: readonly GradeBand[];
}) {
  const [state, action] = useActionState<K12FormState, FormData>(saveMarksAction, {});

  const [draft, setDraft] = useState<Record<string, { ca: string; exam: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.studentId,
        { ca: r.caScore?.toString() ?? '', exam: r.examScore?.toString() ?? '' },
      ]),
    ),
  );

  const set = (id: string, key: 'ca' | 'exam', value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { ca: '', exam: '' }), [key]: value } }));

  /*
   * The live preview runs the SAME `scoreToGrade` against the SAME scale the
   * server was given, so the letter a teacher watches appear while typing is
   * the one that gets stored. A second, drifting implementation of the grading
   * scale in the browser is how a mark sheet starts lying.
   */
  const preview = (id: string): { total: number; band: GradeBand } | null => {
    const d = draft[id];
    if (!d || d.ca.trim() === '' || d.exam.trim() === '') return null;
    const ca = Number(d.ca);
    const exam = Number(d.exam);
    if (!Number.isFinite(ca) || !Number.isFinite(exam)) return null;
    if (ca < 0 || ca > weights.ca || exam < 0 || exam > weights.exam) return null;
    const total = Math.round((ca + exam) * 10) / 10;
    try {
      return { total, band: scoreToGrade(total, scale) };
    } catch {
      return null;
    }
  };

  // The class average shown at the foot is the live one, over marked rows only,
  // so a half-entered sheet does not read as a collapse in performance.
  const { marked, average } = useMemo(() => {
    const totals = rows.map((r) => preview(r.studentId)?.total ?? null).filter((t): t is number => t !== null);
    return {
      marked: totals.length,
      average: totals.length === 0 ? null : totals.reduce((s, t) => s + t, 0) / totals.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, rows]);

  return (
    <Card>
      <CardHeader
        title="Mark sheet"
        description={`Continuous assessment out of ${weights.ca}, examination out of ${weights.exam}. Leave both blank for a pupil who was not assessed — a blank is not a zero.`}
      />

      {state.message ? (
        <div className="px-5 pt-4">
          <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
        </div>
      ) : null}

      <form action={action}>
        <input type="hidden" name="assignmentId" value={assignmentId} />

        <Table className="table-zebra">
          <thead>
            <tr>
              <Th>Admission no.</Th>
              <Th>Pupil</Th>
              <Th className="w-24 text-right">CA / {weights.ca}</Th>
              <Th className="w-24 text-right">Exam / {weights.exam}</Th>
              <Th className="w-20 text-right">Total</Th>
              <Th className="w-20 text-center">Grade</Th>
              <Th className="w-56">Teacher remark</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const p = preview(row.studentId);
              const error = state.fieldErrors?.[row.studentId];
              return (
                <tr key={row.studentId}>
                  <Td className="font-mono text-xs">{row.admissionNo}</Td>
                  <Td className="font-medium text-slate-900">
                    {row.name}
                    {error ? <div className="text-[11px] text-rose-600">{error}</div> : null}
                  </Td>
                  <Td>
                    <Input
                      name={`ca_${row.studentId}`}
                      type="number"
                      min={0}
                      max={weights.ca}
                      step="0.5"
                      disabled={readOnly}
                      value={draft[row.studentId]?.ca ?? ''}
                      onChange={(e) => set(row.studentId, 'ca', e.target.value)}
                      className="text-right tabular-nums"
                      aria-label={`Continuous assessment for ${row.name}`}
                    />
                  </Td>
                  <Td>
                    <Input
                      name={`exam_${row.studentId}`}
                      type="number"
                      min={0}
                      max={weights.exam}
                      step="0.5"
                      disabled={readOnly}
                      value={draft[row.studentId]?.exam ?? ''}
                      onChange={(e) => set(row.studentId, 'exam', e.target.value)}
                      className="text-right tabular-nums"
                      aria-label={`Examination score for ${row.name}`}
                    />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {p ? p.total.toFixed(1) : (row.totalScore?.toFixed(1) ?? '—')}
                  </Td>
                  <Td className="text-center">
                    {p ? (
                      <Badge tone={p.band.point >= 3 ? 'success' : p.band.point >= 1 ? 'warning' : 'danger'}>
                        {p.band.letter}
                      </Badge>
                    ) : row.letterGrade ? (
                      <Badge tone="neutral">{row.letterGrade}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    <Input
                      name={`remark_${row.studentId}`}
                      type="text"
                      maxLength={80}
                      disabled={readOnly}
                      defaultValue={row.remark ?? ''}
                      placeholder="Optional"
                      className="text-xs"
                      aria-label={`Remark for ${row.name}`}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500">
            {marked} of {rows.length} marked
            {average === null ? '' : ` · class average ${average.toFixed(1)}`}
          </p>
          <SaveButton readOnly={readOnly} />
        </div>
      </form>
    </Card>
  );
}
