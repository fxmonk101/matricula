'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  ATTENDANCE_STATUS_LABELS,
  CLASS_ATTENDANCE_STATUSES,
  tally,
  type ClassAttendanceStatus,
} from '@/lib/domain/attendance';
import { Alert, Button, Card, CardHeader } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { saveRegisterAction, type RegisterFormState } from '../actions';

/**
 * Taking the register.
 *
 * Built for somebody standing in front of a lecture theatre with a phone, not
 * for somebody at a desk. That drives every decision here:
 *
 *   · Everybody starts PRESENT, so the common case is zero taps.
 *   · The four statuses are always visible as buttons rather than hidden in a
 *     select. A select costs two taps and a scroll per student.
 *   · The running count is at the top, where it can be checked against a head
 *     count in the room before saving.
 *
 * The component holds the marks in React state and posts them as one field per
 * student, so a half-finished register is never partially saved.
 */

export interface RegisterRowView {
  enrollmentId: string;
  name: string;
  matricNumber: string | null;
  status: ClassAttendanceStatus;
  note: string | null;
}

const TONE: Record<ClassAttendanceStatus, string> = {
  PRESENT: 'bg-emerald-600 text-white border-emerald-600',
  ABSENT: 'bg-rose-600 text-white border-rose-600',
  LATE: 'bg-amber-500 text-white border-amber-500',
  EXCUSED: 'bg-slate-600 text-white border-slate-600',
};

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : dirty ? 'Save register' : 'Save register'}
    </Button>
  );
}

export function RegisterPanel({
  offeringId,
  teachingLogId,
  localDate,
  rows: initial,
  alreadyTaken,
  threshold,
}: {
  offeringId: string;
  teachingLogId: string;
  localDate: string;
  rows: RegisterRowView[];
  alreadyTaken: boolean;
  threshold: number;
}) {
  const [state, action] = useActionState<RegisterFormState, FormData>(saveRegisterAction, {});
  const [marks, setMarks] = useState<Record<string, ClassAttendanceStatus>>(() =>
    Object.fromEntries(initial.map((row) => [row.enrollmentId, row.status])),
  );
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const { push } = useToast();

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Register saved' : 'Not saved',
      body: state.message,
    });
    if (state.ok) setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const counts = useMemo(() => {
    const values = Object.values(marks);
    return {
      present: values.filter((v) => v === 'PRESENT').length,
      absent: values.filter((v) => v === 'ABSENT').length,
      late: values.filter((v) => v === 'LATE').length,
      excused: values.filter((v) => v === 'EXCUSED').length,
    };
  }, [marks]);

  /*
   * The headcount a lecturer can compare against the room. `tally` is reused
   * rather than re-added here so that "in the room" means exactly what it means
   * in the percentage — LATE included.
   */
  const inTheRoom = useMemo(
    () => tally(Object.values(marks)).attended,
    [marks],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return initial;
    return initial.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.matricNumber ?? '').toLowerCase().includes(needle),
    );
  }, [filter, initial]);

  function set(enrollmentId: string, status: ClassAttendanceStatus) {
    setMarks((current) => ({ ...current, [enrollmentId]: status }));
    setDirty(true);
  }

  function setAll(status: ClassAttendanceStatus) {
    setMarks(Object.fromEntries(initial.map((row) => [row.enrollmentId, status])));
    setDirty(true);
  }

  return (
    <form action={action}>
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="teachingLogId" value={teachingLogId} />
      {/*
        Every student posts, including the ones the filter is hiding. Posting
        only the visible rows would silently drop everybody the lecturer had
        filtered out.
      */}
      {initial.map((row) => (
        <input
          key={row.enrollmentId}
          type="hidden"
          name={`status.${row.enrollmentId}`}
          value={marks[row.enrollmentId] ?? 'PRESENT'}
        />
      ))}

      <Card>
        <CardHeader
          title={`Register for ${localDate}`}
          description={
            alreadyTaken
              ? 'This register has been taken. Saving again corrects it.'
              : 'Everybody starts present. Mark the exceptions.'
          }
        />

        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              {counts.present} present
            </span>
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
              {counts.late} late
            </span>
            <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
              {counts.absent} absent
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              {counts.excused} excused
            </span>
            <span className="ml-auto text-slate-500">
              <strong className="text-slate-900">{inTheRoom}</strong> in the room
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a student…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setAll('PRESENT')}
              className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              All present
            </button>
            <button
              type="button"
              onClick={() => setAll('ABSENT')}
              className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              All absent
            </button>
          </div>
        </div>

        <ul className="divide-y divide-slate-100">
          {visible.length === 0 && (
            <li className="px-5 py-6 text-center text-xs text-slate-500">
              Nobody matches &ldquo;{filter}&rdquo;.
            </li>
          )}

          {visible.map((row) => {
            const status = marks[row.enrollmentId] ?? 'PRESENT';
            return (
              <li key={row.enrollmentId} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {row.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {row.matricNumber ?? 'No matriculation number'}
                    </span>
                  </span>

                  <div className="flex shrink-0 gap-1" role="group" aria-label={`Attendance for ${row.name}`}>
                    {CLASS_ATTENDANCE_STATUSES.map((option) => {
                      const active = status === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => set(row.enrollmentId, option)}
                          aria-pressed={active}
                          className={[
                            'h-9 rounded-lg border px-2.5 text-[11px] font-medium transition-colors',
                            active
                              ? TONE[option]
                              : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                          ].join(' ')}
                        >
                          {/* Initial on a phone, full word once there is room. */}
                          <span className="sm:hidden">{ATTENDANCE_STATUS_LABELS[option][0]}</span>
                          <span className="hidden sm:inline">
                            {ATTENDANCE_STATUS_LABELS[option]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {status === 'EXCUSED' && (
                  <div className="mt-2">
                    <input
                      name={`note.${row.enrollmentId}`}
                      defaultValue={row.note ?? ''}
                      maxLength={500}
                      placeholder="Why — a bar from an examination has to be answerable later"
                      className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-4">
          <SaveButton dirty={dirty} />
          {dirty && (
            <span className="text-xs text-amber-700">Not saved yet.</span>
          )}
          <span className="ml-auto text-[11px] text-slate-500">
            {threshold}% needed to sit the examination
          </span>
        </div>
      </Card>

      {state.ok === false && state.message && (
        <Alert tone="danger" className="mt-4">
          {state.message}
        </Alert>
      )}
    </form>
  );
}
