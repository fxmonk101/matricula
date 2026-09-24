'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { QUESTION_KIND_LABELS, type GivenAnswer, type QuestionKind } from '@/lib/domain/quiz';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { saveAnswersAction, submitAttemptAction } from './actions';

/**
 * =============================================================================
 * SITTING THE PAPER
 * =============================================================================
 *
 * Written for somebody in a hall with one chance at this, on a machine and a
 * network neither of us controls. Three things follow from that and they shape
 * everything below.
 *
 * ANSWERS ARE SAVED BEFORE THEY ARE NEEDED. Every change schedules an autosave.
 * A student whose browser dies at question 18 of 20 must lose nothing, and the
 * only way to promise that is to have written it down already.
 *
 * THE CLOCK ON SCREEN IS A COPY. It counts down from a number the server gave
 * us and it is not the authority — the server decides what it accepts. A device
 * with a wrong clock, or one whose owner changed it, gets no extra time. When
 * it reaches zero the paper submits itself, because a student who has run out
 * of time should have their work handed in, not discarded.
 *
 * ONE QUESTION AT A TIME, with the whole paper navigable. A list of thirty
 * questions on a phone is a scroll with no sense of position; a single question
 * with a grid above it tells somebody where they are and what they have missed.
 */

export interface PaperQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  options: { id: string; text: string }[];
}

const AUTOSAVE_DELAY_MS = 1500;

export function Paper({
  offeringId,
  itemId,
  attemptId,
  title,
  instructions,
  questions,
  initialAnswers,
  secondsRemaining,
}: {
  offeringId: string;
  itemId: string;
  attemptId: string;
  title: string;
  instructions: string | null;
  questions: PaperQuestion[];
  initialAnswers: GivenAnswer[];
  secondsRemaining: number | null;
}) {
  const [answers, setAnswers] = useState<Record<string, GivenAnswer>>(() =>
    Object.fromEntries(initialAnswers.map((a) => [a.questionId, a])),
  );
  const [at, setAt] = useState(0);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [left, setLeft] = useState<number | null>(secondsRemaining);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string; score?: number } | null>(
    null,
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(false);

  const payload = useMemo(() => JSON.stringify(Object.values(answers)), [answers]);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  // ------------------------------------------------------------------ saving
  const save = useCallback(async () => {
    setSaving('saving');
    const form = new FormData();
    form.set('offeringId', offeringId);
    form.set('attemptId', attemptId);
    form.set('answers', payloadRef.current);
    const result = await saveAnswersAction({}, form);
    setSaving(result.ok ? 'saved' : 'failed');
  }, [attemptId, offeringId]);

  const submit = useCallback(
    async (automatic: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);

      const form = new FormData();
      form.set('offeringId', offeringId);
      form.set('itemId', itemId);
      form.set('attemptId', attemptId);
      form.set('answers', payloadRef.current);

      const result = await submitAttemptAction({}, form);
      setSubmitting(false);
      setOutcome({
        ok: Boolean(result.ok),
        message:
          result.message ??
          (automatic ? 'Time is up. Your paper has been handed in.' : 'Handed in.'),
        score: result.score,
      });
    },
    [attemptId, itemId, offeringId],
  );

  /* Debounced autosave. Rescheduled on every change, so a burst of clicks
     costs one write rather than one per click. */
  useEffect(() => {
    if (submittedRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [payload, save]);

  /* The countdown, and the automatic hand-in at zero. */
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      void submit(true);
      return;
    }
    const tick = setTimeout(() => setLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(tick);
  }, [left, submit]);

  /* A last attempt to save when the tab goes away. Not relied on — the
     debounced save is what actually protects the work — but it costs nothing
     and catches the common "closed the laptop" case. */
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === 'hidden' && !submittedRef.current) void save();
    }
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [save]);

  // ----------------------------------------------------------------- answers
  function setChoice(questionId: string, optionId: string, multiple: boolean) {
    setAnswers((current) => {
      const existing = current[questionId]?.optionIds ?? [];
      const next = multiple
        ? existing.includes(optionId)
          ? existing.filter((id) => id !== optionId)
          : [...existing, optionId]
        : [optionId];
      return { ...current, [questionId]: { questionId, optionIds: next } };
    });
  }

  function setText(questionId: string, text: string) {
    setAnswers((current) => ({ ...current, [questionId]: { questionId, text } }));
  }

  const answered = useMemo(
    () =>
      new Set(
        Object.values(answers)
          .filter((a) => (a.optionIds?.length ?? 0) > 0 || (a.text ?? '').trim() !== '')
          .map((a) => a.questionId),
      ),
    [answers],
  );

  // ---------------------------------------------------------------- finished
  if (outcome) {
    return (
      <Card>
        <CardHeader title={outcome.ok ? 'Handed in' : 'Not handed in'} />
        <CardBody>
          <Alert tone={outcome.ok ? 'success' : 'danger'}>{outcome.message}</Alert>
          {outcome.ok && outcome.score !== undefined && (
            <p className="mt-3 text-sm text-slate-700">
              You scored <strong className="tabular-nums">{outcome.score}</strong>.
            </p>
          )}
          <Button
            className="mt-4"
            type="button"
            onClick={() => window.location.assign(`/me/courses/${offeringId}`)}
          >
            Back to the course
          </Button>
        </CardBody>
      </Card>
    );
  }

  const question = questions[at];
  const urgent = left !== null && left <= 120;

  return (
    <>
      {/* The bar that matters: where you are, how long is left, and whether
          your work is safe. Sticky, because on a phone all three scroll away
          exactly when somebody starts to worry about them. */}
      <div
        className="sticky z-10 mb-4 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-slate-700">
            Question {at + 1} of {questions.length}
          </span>
          <span className="text-xs text-slate-500">
            {answered.size} answered
          </span>

          {left !== null && (
            <span
              className={[
                'ml-auto rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums',
                urgent ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700',
              ].join(' ')}
              aria-live={urgent ? 'polite' : 'off'}
            >
              {formatClock(left)}
            </span>
          )}

          <span
            className={[
              'text-[11px]',
              saving === 'failed' ? 'text-rose-700' : 'text-slate-500',
              left === null ? 'ml-auto' : '',
            ].join(' ')}
            aria-live="polite"
          >
            {saving === 'saving'
              ? 'Saving…'
              : saving === 'saved'
                ? 'Answers saved'
                : saving === 'failed'
                  ? 'Could not save — check your connection'
                  : ''}
          </span>
        </div>

        {/* Every question, as a grid. The only way to know at a glance which
            ones were skipped. */}
        <div className="mt-2 flex flex-wrap gap-1">
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Question ${i + 1}${answered.has(q.id) ? ', answered' : ', not answered'}`}
              aria-current={i === at}
              className={[
                'h-7 w-7 rounded text-[11px] font-medium transition-colors',
                i === at
                  ? 'bg-brand-600 text-onAccent'
                  : answered.has(q.id)
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              ].join(' ')}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {urgent && (
        <Alert tone="warning" className="mb-4">
          Less than two minutes left. Your answers are saved as you go, and the paper will be
          handed in automatically when the time runs out.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={title}
          description={instructions ?? undefined}
        />
        <CardBody>
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900">{question.prompt}</span>
              <span className="mt-1 block text-[11px] text-slate-500">
                {QUESTION_KIND_LABELS[question.kind]} · {question.points}{' '}
                {question.points === 1 ? 'mark' : 'marks'}
              </span>
            </span>
            {answered.has(question.id) && <Badge tone="success">Answered</Badge>}
          </div>

          <div className="mt-4 space-y-2">
            {question.kind === 'SHORT_ANSWER' ? (
              <textarea
                value={answers[question.id]?.text ?? ''}
                onChange={(e) => setText(question.id, e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Type your answer"
                className="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
              />
            ) : (
              question.options.map((option) => {
                const multiple = question.kind === 'MULTI_CHOICE';
                const chosen = (answers[question.id]?.optionIds ?? []).includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={[
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      chosen
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name={`q-${question.id}`}
                      checked={chosen}
                      onChange={() => setChoice(question.id, option.id, multiple)}
                      className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm text-slate-800">{option.text}</span>
                  </label>
                );
              })
            )}

            {question.kind === 'MULTI_CHOICE' && (
              <p className="text-[11px] text-slate-500">
                More than one answer may be correct. A wrong tick cancels out a right one.
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={at === 0}
              onClick={() => setAt((i) => Math.max(0, i - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={at === questions.length - 1}
              onClick={() => setAt((i) => Math.min(questions.length - 1, i + 1))}
            >
              Next
            </Button>

            <span className="ml-auto">
              <Button
                type="button"
                disabled={submitting}
                onClick={() => {
                  const missed = questions.length - answered.size;
                  const warning =
                    missed > 0
                      ? `You have not answered ${missed} ${missed === 1 ? 'question' : 'questions'}. Hand in anyway?`
                      : 'Hand in your paper? You cannot change it afterwards.';
                  if (window.confirm(warning)) void submit(false);
                }}
              >
                {submitting ? 'Handing in…' : 'Hand in'}
              </Button>
            </span>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
