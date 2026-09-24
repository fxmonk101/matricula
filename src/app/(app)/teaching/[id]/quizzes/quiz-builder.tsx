'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  QUESTION_KINDS,
  QUESTION_KIND_LABELS,
  REVEAL_LABELS,
  REVEAL_POLICIES,
  totalPoints,
  validateQuestion,
  type QuestionKind,
  type QuizSettings,
} from '@/lib/domain/quiz';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { saveQuizAction, type QuizFormState } from './actions';

/**
 * Writing a paper.
 *
 * The whole quiz is held here and posted as one document. A quiz is not a list
 * of independently saved questions — its marks total must equal the sum of its
 * parts, and half a saved paper is a gradebook that disagrees with itself.
 *
 * Problems are shown PER QUESTION as they are typed, not collected on submit.
 * A paper of thirty questions rejected with "3 questions have a problem" is a
 * hunt; the same information beside the question is a fix.
 */

interface DraftOption {
  text: string;
  isCorrect: boolean;
}

interface DraftQuestion {
  /** Local only — the server assigns real ids. */
  key: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  acceptedAnswers: string;
  options: DraftOption[];
}

function blank(kind: QuestionKind = 'SINGLE_CHOICE'): DraftQuestion {
  return {
    key: `q-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    prompt: '',
    points: 1,
    acceptedAnswers: '',
    options:
      kind === 'TRUE_FALSE'
        ? [
            { text: 'True', isCorrect: false },
            { text: 'False', isCorrect: false },
          ]
        : kind === 'SHORT_ANSWER'
          ? []
          : [
              { text: '', isCorrect: false },
              { text: '', isCorrect: false },
            ],
  };
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function QuizBuilder({
  offeringId,
  moduleId,
  itemId,
  modules,
  initial,
  locked,
}: {
  offeringId: string;
  moduleId: string;
  itemId?: string;
  modules: { id: string; title: string }[];
  initial?: {
    title: string;
    instructions: string | null;
    dueAt: string | null;
    acceptsLate: boolean;
    settings: QuizSettings;
    questions: {
      id: string;
      kind: QuestionKind;
      prompt: string;
      points: number;
      acceptedAnswers: string[];
      options: { id: string; text: string; isCorrect: boolean }[];
    }[];
  };
  /** True once somebody has sat it: the paper is frozen. */
  locked?: boolean;
}) {
  const [state, action] = useActionState<QuizFormState, FormData>(saveQuizAction, {});
  const { push } = useToast();

  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    initial
      ? initial.questions.map((q, i) => ({
          key: `existing-${i}`,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          acceptedAnswers: q.acceptedAnswers.join('\n'),
          options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
        }))
      : [blank()],
  );

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Quiz saved' : 'Not saved',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const marks = useMemo(
    () =>
      totalPoints(
        questions.map((q) => ({
          id: q.key,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          acceptedAnswers: [],
          options: [],
        })),
      ),
    [questions],
  );

  const problems = useMemo(
    () =>
      questions.map((q) =>
        validateQuestion({
          id: q.key,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          acceptedAnswers: q.acceptedAnswers.split('\n').map((l) => l.trim()).filter(Boolean),
          options: q.options.map((o, i) => ({ id: `${q.key}-${i}`, ...o })),
        }),
      ),
    [questions],
  );

  const payload = useMemo(
    () =>
      JSON.stringify(
        questions.map((q) => ({
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          acceptedAnswers: q.acceptedAnswers,
          options: q.kind === 'SHORT_ANSWER' ? [] : q.options,
        })),
      ),
    [questions],
  );

  function update(key: string, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  function changeKind(key: string, kind: QuestionKind) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.key !== key) return q;
        const fresh = blank(kind);
        // Keep what still makes sense; a changed kind should not lose the text
        // somebody has already typed.
        return { ...fresh, key: q.key, prompt: q.prompt, points: q.points };
      }),
    );
  }

  function setOption(key: string, index: number, patch: Partial<DraftOption>) {
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.key !== key) return q;
        const options = q.options.map((o, i) => (i === index ? { ...o, ...patch } : o));
        /*
         * On a one-answer question, ticking a box unticks the rest. Leaving two
         * ticked is not a harder question — it is one that cannot be marked.
         */
        if (patch.isCorrect && q.kind !== 'MULTI_CHOICE') {
          return {
            ...q,
            options: options.map((o, i) => ({ ...o, isCorrect: i === index })),
          };
        }
        return { ...q, options };
      }),
    );
  }

  if (locked) {
    return (
      <Alert tone="warning" title="This paper cannot be changed">
        Students have already sat it. Editing a question now would re-mark papers against
        questions those students never saw. Create a new quiz instead.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="offeringId" value={offeringId} />
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <input type="hidden" name="questions" value={payload} />

      <Card>
        <CardHeader title="The quiz" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="title" className="sm:col-span-2">
              <Input
                id="title"
                name="title"
                defaultValue={initial?.title ?? ''}
                placeholder="Mid-semester test"
                required
              />
            </Field>

            <Field label="Module" htmlFor="moduleId">
              <Select id="moduleId" name="moduleId" defaultValue={moduleId}>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Closes" htmlFor="dueAt" hint="Leave blank for no deadline">
              <Input
                id="dueAt"
                name="dueAt"
                type="datetime-local"
                defaultValue={initial?.dueAt ?? ''}
              />
            </Field>

            <Field label="Instructions" htmlFor="instructions" className="sm:col-span-2">
              <Textarea
                id="instructions"
                name="instructions"
                rows={2}
                defaultValue={initial?.instructions ?? ''}
                placeholder="Answer every question. Calculators are not permitted."
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Time limit (minutes)"
              htmlFor="timeLimitMinutes"
              hint="Blank means untimed"
            >
              <Input
                id="timeLimitMinutes"
                name="timeLimitMinutes"
                type="number"
                min={1}
                max={480}
                defaultValue={initial?.settings.timeLimitMinutes ?? ''}
                className="tabular-nums"
              />
            </Field>

            <Field label="Attempts allowed" htmlFor="maxAttempts">
              <Input
                id="maxAttempts"
                name="maxAttempts"
                type="number"
                min={1}
                max={20}
                defaultValue={initial?.settings.maxAttempts ?? 1}
                className="tabular-nums"
              />
            </Field>

            <Field label="Show the answers" htmlFor="reveal">
              <Select id="reveal" name="reveal" defaultValue={initial?.settings.reveal ?? 'AFTER_DUE'}>
                {REVEAL_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {REVEAL_LABELS[policy]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleQuestions"
                defaultChecked={initial?.settings.shuffleQuestions}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Shuffle the questions
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleOptions"
                defaultChecked={initial?.settings.shuffleOptions}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Shuffle the options
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="acceptsLate"
                defaultChecked={initial?.acceptsLate ?? false}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              Accept late attempts
            </label>
          </div>

          <p className="text-[11px] text-slate-500">
            Shuffling raises the cost of reading a neighbour&rsquo;s screen. It does nothing
            against somebody who has the paper in advance, and is not a substitute for
            invigilation.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Questions"
          description={`${questions.length} ${questions.length === 1 ? 'question' : 'questions'} · ${marks} ${marks === 1 ? 'mark' : 'marks'} in total`}
        />
        <CardBody className="space-y-4">
          {questions.map((question, index) => (
            <div key={question.key} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="neutral">{index + 1}</Badge>
                <Select
                  value={question.kind}
                  onChange={(e) => changeKind(question.key, e.target.value as QuestionKind)}
                  className="h-9 w-auto text-xs"
                  aria-label="Question type"
                >
                  {QUESTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {QUESTION_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>

                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Marks
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={question.points}
                    onChange={(e) =>
                      update(question.key, { points: Number(e.target.value) || 0 })
                    }
                    className="h-9 w-20 tabular-nums"
                  />
                </label>

                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setQuestions((qs) => qs.filter((q) => q.key !== question.key))
                    }
                    className="ml-auto text-xs font-medium text-rose-700 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>

              <Textarea
                value={question.prompt}
                onChange={(e) => update(question.key, { prompt: e.target.value })}
                rows={2}
                placeholder="The question"
                className="mt-3"
              />

              {question.kind === 'SHORT_ANSWER' ? (
                <Field
                  label="Accepted answers"
                  hint="One per line. Case and extra spaces are ignored. Anything else is flagged for you to look at rather than marked wrong."
                  className="mt-3"
                >
                  <Textarea
                    value={question.acceptedAnswers}
                    onChange={(e) => update(question.key, { acceptedAnswers: e.target.value })}
                    rows={3}
                    placeholder={'Lagos\nLagos City'}
                  />
                </Field>
              ) : (
                <div className="mt-3 space-y-2">
                  {question.options.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type={question.kind === 'MULTI_CHOICE' ? 'checkbox' : 'radio'}
                        name={`correct-${question.key}`}
                        checked={option.isCorrect}
                        onChange={(e) =>
                          setOption(question.key, i, { isCorrect: e.target.checked })
                        }
                        aria-label={`Option ${i + 1} is correct`}
                        className="h-4 w-4 shrink-0 border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <Input
                        value={option.text}
                        onChange={(e) => setOption(question.key, i, { text: e.target.value })}
                        placeholder={`Option ${i + 1}`}
                        className="h-9"
                        disabled={question.kind === 'TRUE_FALSE'}
                      />
                      {question.kind !== 'TRUE_FALSE' && question.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            update(question.key, {
                              options: question.options.filter((_, j) => j !== i),
                            })
                          }
                          className="shrink-0 text-xs text-slate-400 hover:text-rose-700"
                          aria-label={`Remove option ${i + 1}`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  {question.kind !== 'TRUE_FALSE' && question.options.length < 10 && (
                    <button
                      type="button"
                      onClick={() =>
                        update(question.key, {
                          options: [...question.options, { text: '', isCorrect: false }],
                        })
                      }
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Add an option
                    </button>
                  )}
                </div>
              )}

              {problems[index].length > 0 && (
                <p className="mt-2 text-[11px] text-rose-700">{problems[index].join(' ')}</p>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            onClick={() => setQuestions((qs) => [...qs, blank()])}
          >
            Add a question
          </Button>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <SaveButton label={itemId ? 'Save the paper' : 'Create the quiz'} />
        <span className="text-xs text-slate-500">
          {marks} {marks === 1 ? 'mark' : 'marks'} in total
          {problems.some((p) => p.length > 0) && ' · some questions need attention'}
        </span>
      </div>

      {state.ok === false && state.message && <Alert tone="danger">{state.message}</Alert>}
    </form>
  );
}
