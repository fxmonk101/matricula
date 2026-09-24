'use server';

import { revalidatePath } from 'next/cache';

import type { GivenAnswer } from '@/lib/domain/quiz';
import { requireRoute } from '@/server/tenant-context';
import { enrolmentFor } from '@/server/services/lms.service';
import { saveAnswers, startAttempt, submitAttempt } from '@/server/services/quiz.service';

/**
 * Sitting a quiz.
 *
 * EVERY ACTION RE-RESOLVES THE ENROLMENT from the session rather than taking
 * one from the form. The enrolment is what says whose attempt this is, and a
 * form field naming it would let anybody submit into anybody's paper by
 * changing a hidden input.
 */

export interface QuizFormState {
  ok?: boolean;
  message?: string;
  attemptId?: string;
  score?: number;
}

async function context(offeringId: string) {
  const ctx = await requireRoute('/me/courses');
  const enrolment = ctx.session.pid
    ? await enrolmentFor({
        schoolId: ctx.schoolId,
        offeringId,
        studentProfileId: ctx.session.pid,
      })
    : null;
  return { ctx, enrolment };
}

const NOT_YOURS = { ok: false, message: 'You are not registered on that course.' } as const;

export async function startAttemptAction(
  _previous: QuizFormState,
  formData: FormData,
): Promise<QuizFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');

  const { ctx, enrolment } = await context(offeringId);
  if (!enrolment) return NOT_YOURS;

  const result = await startAttempt({
    schoolId: ctx.schoolId,
    itemId,
    enrollmentId: enrolment.id,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) revalidatePath(`/me/courses/${offeringId}/quiz/${itemId}`);
  return { ok: result.ok, message: result.message, attemptId: result.attemptId };
}

/**
 * Autosave.
 *
 * Called on every change, so it is deliberately the cheapest thing here: one
 * row, one column, no marking. A student on a phone in a hall with poor signal
 * loses the tab, and what makes that survivable is that the answers were
 * already written down.
 */
export async function saveAnswersAction(
  _previous: QuizFormState,
  formData: FormData,
): Promise<QuizFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const attemptId = String(formData.get('attemptId') ?? '');

  const { ctx, enrolment } = await context(offeringId);
  if (!enrolment) return NOT_YOURS;

  const result = await saveAnswers({
    schoolId: ctx.schoolId,
    attemptId,
    enrollmentId: enrolment.id,
    answers: parseAnswers(formData),
  });

  return { ok: result.ok, message: result.message };
}

export async function submitAttemptAction(
  _previous: QuizFormState,
  formData: FormData,
): Promise<QuizFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const attemptId = String(formData.get('attemptId') ?? '');

  const { ctx, enrolment } = await context(offeringId);
  if (!enrolment) return NOT_YOURS;

  const result = await submitAttempt({
    schoolId: ctx.schoolId,
    attemptId,
    enrollmentId: enrolment.id,
    answers: parseAnswers(formData),
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath(`/me/courses/${offeringId}/quiz/${itemId}`);
    revalidatePath(`/me/courses/${offeringId}`);
  }

  return { ok: result.ok, message: result.message, score: result.score };
}

/**
 * Answers come as one JSON field.
 *
 * A quiz posts a variable number of answers of three different shapes, and
 * encoding that as form fields means parsing `q_<id>_opt_<id>` keys back into
 * structure. The JSON is produced by our own client and is validated by shape
 * here — anything that is not a recognisable answer is dropped rather than
 * trusted, and an unparseable body becomes an empty paper rather than a crash.
 */
function parseAnswers(formData: FormData): GivenAnswer[] {
  const raw = String(formData.get('answers') ?? '[]');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: GivenAnswer[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const questionId = typeof row.questionId === 'string' ? row.questionId : null;
    if (!questionId) continue;

    const optionIds = Array.isArray(row.optionIds)
      ? row.optionIds.filter((id): id is string => typeof id === 'string').slice(0, 50)
      : undefined;
    const text = typeof row.text === 'string' ? row.text.slice(0, 5000) : undefined;

    out.push({ questionId, optionIds, text });
    if (out.length >= 500) break;
  }

  return out;
}
