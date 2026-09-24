'use server';

import { revalidatePath } from 'next/cache';

import { assertCan } from '@/lib/auth/rbac';
import {
  REVEAL_POLICIES,
  isQuestionKind,
  type QuestionKind,
  type QuizSettings,
  type RevealPolicy,
} from '@/lib/domain/quiz';
import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering, setItemPublished } from '@/server/services/lms.service';
import { saveQuiz, type QuestionDraft } from '@/server/services/quiz.service';

/**
 * Authoring a quiz.
 *
 * The same two gates as everything else under /teaching: a role that may author
 * courses at all, and `mayAuthorOffering` for whether this is YOUR course. The
 * second is a fact about a record and no role can answer it.
 *
 * The paper arrives as one JSON field. A quiz has a variable number of
 * questions with a variable number of options each, and encoding that as form
 * fields means parsing `q3_opt2_correct` keys back into a structure — which is
 * the same parsing, done less safely, in a place with no types.
 */

export interface QuizFormState {
  ok?: boolean;
  message?: string;
  id?: string;
}

const AUTHOR_ROLES = ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'] as const;

async function authorise(offeringId: string) {
  const ctx = await requireTenantRole(...AUTHOR_ROLES);
  assertCan(ctx.role, 'lms:author');

  const allowed = await mayAuthorOffering({
    schoolId: ctx.schoolId,
    offeringId,
    instructorProfileId: ctx.session.pid,
    role: ctx.role,
  });

  return { ctx, allowed };
}

const NOT_YOURS = {
  ok: false,
  message: 'That is not your course. Only its lecturer or the faculty office can change it.',
} as const;

export async function saveQuizAction(
  _previous: QuizFormState,
  formData: FormData,
): Promise<QuizFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  const questions = parseQuestions(String(formData.get('questions') ?? '[]'));
  if (questions === null) {
    return { ok: false, message: 'That paper could not be read. Nothing was saved.' };
  }

  const result = await saveQuiz({
    schoolId: ctx.schoolId,
    moduleId: String(formData.get('moduleId') ?? ''),
    itemId: String(formData.get('itemId') ?? '') || null,
    title: String(formData.get('title') ?? ''),
    instructions: String(formData.get('instructions') ?? '') || null,
    dueAt: instantOf(String(formData.get('dueAt') ?? '')),
    acceptsLate: formData.get('acceptsLate') === 'on',
    settings: parseSettings(formData),
    questions,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath(`/teaching/${offeringId}/modules`);
    revalidatePath(`/teaching/${offeringId}/quizzes/${result.id}`);
    revalidatePath('/me/courses');
  }

  return { ok: result.ok, message: result.message, id: result.id };
}

/** Publish or withdraw the paper. Reuses the LMS's own publish path. */
export async function setQuizPublishedAction(
  _previous: QuizFormState,
  formData: FormData,
): Promise<QuizFormState> {
  const offeringId = String(formData.get('offeringId') ?? '');
  const { ctx, allowed } = await authorise(offeringId);
  if (!allowed) return NOT_YOURS;

  assertCan(ctx.role, 'lms:publish');

  const itemId = String(formData.get('itemId') ?? '');
  const publish = formData.get('publish') === 'true';

  const result = await setItemPublished({
    schoolId: ctx.schoolId,
    itemId,
    isPublished: publish,
    actorUserId: ctx.session.sub,
  });

  if (result.ok) {
    revalidatePath(`/teaching/${offeringId}/quizzes/${itemId}`);
    revalidatePath(`/teaching/${offeringId}/modules`);
    revalidatePath('/me/courses');
  }

  return {
    ok: result.ok,
    message: result.ok
      ? publish
        ? 'Published. Students can sit it now.'
        : 'Withdrawn. Students can no longer reach it.'
      : result.message,
  };
}

function parseSettings(formData: FormData): QuizSettings {
  const limit = Number(formData.get('timeLimitMinutes'));
  const reveal = String(formData.get('reveal') ?? 'AFTER_DUE');

  return {
    // Blank or zero means untimed, which is a different thing from "0 minutes".
    timeLimitMinutes: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
    maxAttempts: Math.max(1, Math.floor(Number(formData.get('maxAttempts')) || 1)),
    shuffleQuestions: formData.get('shuffleQuestions') === 'on',
    shuffleOptions: formData.get('shuffleOptions') === 'on',
    reveal: (REVEAL_POLICIES as readonly string[]).includes(reveal)
      ? (reveal as RevealPolicy)
      : 'AFTER_DUE',
  };
}

/**
 * Read the paper, or refuse the whole thing.
 *
 * Returns null rather than a partial paper on anything it does not recognise.
 * Dropping an unreadable question would save a paper the lecturer did not
 * write, and they would find out when a student sat it.
 */
function parseQuestions(raw: string): QuestionDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: QuestionDraft[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null;
    const row = entry as Record<string, unknown>;

    if (!isQuestionKind(row.kind)) return null;
    if (typeof row.prompt !== 'string') return null;

    const points = Number(row.points);
    if (!Number.isFinite(points)) return null;

    const options = Array.isArray(row.options) ? row.options : [];
    const parsedOptions: QuestionDraft['options'] = [];

    for (const option of options) {
      if (!option || typeof option !== 'object') return null;
      const o = option as Record<string, unknown>;
      if (typeof o.text !== 'string') return null;
      parsedOptions.push({ text: o.text, isCorrect: o.isCorrect === true });
    }

    out.push({
      kind: row.kind as QuestionKind,
      prompt: row.prompt,
      points,
      acceptedAnswers: typeof row.acceptedAnswers === 'string' ? row.acceptedAnswers : null,
      options: parsedOptions,
    });
  }

  return out;
}

/** A `datetime-local` value carries no zone; it means what the typist meant. */
function instantOf(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
