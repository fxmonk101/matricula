/**
 * The report card DOCUMENT.
 *
 * One component, rendered by both the staff route (`/reports/[studentId]`) and
 * the guardian route (`/family/[studentId]`). The two routes differ in who is
 * allowed to reach them, not in what the document says: a parent and a form
 * teacher must be looking at the same piece of paper, or the first disagreement
 * between them becomes an argument about which screen is right.
 *
 * Purely presentational and server-renderable — it takes plain data and does no
 * arithmetic beyond formatting. Every figure was computed by
 * `@/lib/domain/k12` at generation time and frozen on publication.
 */

import { ordinal } from '@/lib/domain/k12';
import { formatDate } from '@/lib/utils';
import { Badge, Card, Meter, type BadgeTone } from '@/components/ui';

export interface ReportCardLineView {
  subjectCode: string;
  subjectName: string;
  caScore: number | null;
  examScore: number | null;
  totalScore: number | null;
  letterGrade: string | null;
  classAverage: number | null;
  positionInClass: number | null;
  remark: string | null;
}

export interface ReportCardView {
  referenceNo: string;
  formClassCode: string;
  totalMarks: number;
  maxMarks: number;
  average: number;
  classAverage: number;
  positionInClass: number;
  classSize: number;
  overallGrade: string;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
  daysInTerm: number;
  promotionDecision: string;
  promotionReason: string | null;
  classTeacherRemark: string | null;
  headTeacherRemark: string | null;
  publishedAt: Date | null;
  lines: ReportCardLineView[];
}

const DECISION: Record<string, { tone: BadgeTone; label: string; blurb: string }> = {
  PROMOTED: {
    tone: 'success',
    label: 'Promoted',
    blurb: 'The pupil moves up to the next year group.',
  },
  GRADUATED: {
    tone: 'gold',
    label: 'Graduated',
    blurb: 'The pupil has completed the final year group.',
  },
  REVIEW: {
    tone: 'warning',
    label: 'Referred for review',
    blurb: 'The school will discuss this result with the family before deciding.',
  },
  REPEAT: {
    tone: 'danger',
    label: 'Repeating the year',
    blurb: 'The pupil will retake this year group.',
  },
  PENDING: { tone: 'neutral', label: 'Pending', blurb: 'Not yet decided.' },
};

function gradeTone(letter: string | null): BadgeTone {
  if (!letter) return 'neutral';
  const head = letter.charAt(0).toUpperCase();
  if (head === 'A') return 'success';
  if (head === 'B') return 'brand';
  if (head === 'C') return 'info';
  if (head === 'D' || head === 'E') return 'warning';
  return 'danger';
}

export function ReportCardDocument({
  card,
  pupil,
  school,
  term,
  showPosition,
}: {
  card: ReportCardView;
  pupil: { name: string; admissionNo: string };
  school: { name: string; shortName: string; brandColor: string; logoUrl: string | null };
  term: { name: string; academicYear: string };
  showPosition: boolean;
}) {
  const decision = DECISION[card.promotionDecision] ?? DECISION.PENDING;
  const attendanceRate =
    card.daysInTerm === 0 ? null : ((card.daysPresent + card.daysLate) / card.daysInTerm) * 100;

  return (
    <Card className="overflow-hidden print:border-0 print:shadow-none">
      {/* --- masthead --------------------------------------------------------- */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 text-onAccent"
        style={{ backgroundColor: school.brandColor }}
      >
        <div className="flex items-center gap-3">
          {school.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={school.logoUrl} alt="" className="h-10 w-10 rounded-md bg-white/90 object-contain p-1" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/15 text-sm font-semibold">
              {school.shortName.slice(0, 3).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-base font-semibold leading-tight">{school.name}</p>
            <p className="text-xs text-onAccent/80">
              Termly report · {term.name} · {term.academicYear}
            </p>
          </div>
        </div>
        <div className="text-right text-xs text-onAccent/85">
          <p className="font-mono">{card.referenceNo}</p>
          <p>
            {card.publishedAt
              ? `Issued ${formatDate(card.publishedAt)}`
              : 'DRAFT — not yet issued'}
          </p>
        </div>
      </div>

      {/* --- pupil identity --------------------------------------------------- */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-slate-200 px-6 py-4 sm:grid-cols-4">
        {[
          ['Pupil', pupil.name],
          ['Admission number', pupil.admissionNo],
          ['Class', card.formClassCode],
          [
            'Position',
            showPosition
              ? `${ordinal(card.positionInClass)} of ${card.classSize}`
              : 'Not published',
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {/* --- subjects --------------------------------------------------------- */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-6 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Subject
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                CA
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Exam
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total
              </th>
              <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Grade
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Class avg.
              </th>
              {showPosition ? (
                <th className="px-6 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Position
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {card.lines.map((line) => (
              <tr key={line.subjectCode}>
                <td className="px-6 py-2.5">
                  <span className="font-medium text-slate-900">{line.subjectName}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-400">{line.subjectCode}</span>
                  {line.remark ? (
                    <div className="text-[11px] italic text-slate-500">{line.remark}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {line.caScore?.toFixed(0) ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {line.examScore?.toFixed(0) ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                  {line.totalScore?.toFixed(0) ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {line.letterGrade ? (
                    <Badge tone={gradeTone(line.letterGrade)}>{line.letterGrade}</Badge>
                  ) : (
                    <span className="text-xs text-slate-400">Not assessed</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {line.classAverage?.toFixed(1) ?? '—'}
                </td>
                {showPosition ? (
                  <td className="px-6 py-2.5 text-right tabular-nums text-slate-500">
                    {line.positionInClass ? ordinal(line.positionInClass) : '—'}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <td className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Total
              </td>
              <td colSpan={2} />
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                {card.totalMarks.toFixed(0)}
                <span className="font-normal text-slate-400"> / {card.maxMarks.toFixed(0)}</span>
              </td>
              <td className="px-3 py-3 text-center">
                <Badge tone={gradeTone(card.overallGrade)}>{card.overallGrade}</Badge>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                {card.classAverage.toFixed(1)}
              </td>
              {showPosition ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* --- summary, attendance, decision ------------------------------------ */}
      <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-3">
        <div className="bg-white px-6 py-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Average</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {card.average.toFixed(1)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Class average {card.classAverage.toFixed(1)} —{' '}
            {card.average >= card.classAverage ? 'at or above' : 'below'} the class.
          </p>
        </div>

        <div className="bg-white px-6 py-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Attendance</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {attendanceRate === null ? '—' : `${attendanceRate.toFixed(0)}%`}
          </p>
          {attendanceRate === null ? (
            <p className="mt-1 text-xs text-slate-500">No register was kept this term.</p>
          ) : (
            <>
              <div className="mt-2">
                <Meter
                  value={attendanceRate}
                  tone={attendanceRate >= 90 ? 'success' : attendanceRate >= 75 ? 'warning' : 'danger'}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {card.daysPresent} present · {card.daysLate} late · {card.daysAbsent} absent of{' '}
                {card.daysInTerm} sessions
              </p>
            </>
          )}
        </div>

        <div className="bg-white px-6 py-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Decision</p>
          <div className="mt-1.5">
            <Badge tone={decision.tone} className="text-sm">
              {decision.label}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {card.promotionReason ?? decision.blurb}
          </p>
        </div>
      </div>

      {/* --- remarks ---------------------------------------------------------- */}
      {card.classTeacherRemark || card.headTeacherRemark ? (
        <div className="grid gap-4 border-t border-slate-200 px-6 py-4 sm:grid-cols-2">
          {card.classTeacherRemark ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Form teacher</p>
              <p className="mt-1 text-sm italic leading-relaxed text-slate-700">
                “{card.classTeacherRemark}”
              </p>
            </div>
          ) : null}
          {card.headTeacherRemark ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Head teacher</p>
              <p className="mt-1 text-sm italic leading-relaxed text-slate-700">
                “{card.headTeacherRemark}”
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="border-t border-slate-200 px-6 py-3 text-[11px] text-slate-500">
        Quote {card.referenceNo} in any correspondence about this report. Marks are recorded out of
        100 per subject; the average is the plain mean over the subjects assessed.
      </p>
    </Card>
  );
}
