'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { isValidResourceUrl, RESOURCE_KINDS } from '@/lib/domain/library';
import { archiveResourceAction, saveResourceAction, type LibraryFormState } from './actions';

export interface EditingResource {
  id: string;
  title: string;
  authors: string;
  description: string | null;
  kind: string;
  url: string;
  publisher: string | null;
  isbn: string | null;
  language: string;
  pageCount: number | null;
  durationMin: number | null;
  tags: string;
  audience: string;
  programIdsJson: string;
  levelsJson: string;
  isPublished: boolean;
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to catalogue'}
    </Button>
  );
}

function ArchiveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending}>
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}

function parseJson<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function ResourceEditor({
  programs,
  editing,
}: {
  programs: { id: string; code: string; name: string }[];
  editing: EditingResource | null;
}) {
  const [state, action] = useActionState<LibraryFormState, FormData>(saveResourceAction, {});
  const [archiveState, archiveAction] = useActionState<LibraryFormState, FormData>(
    archiveResourceAction,
    {},
  );
  const [url, setUrl] = useState(editing?.url ?? '');
  const router = useRouter();

  const selectedPrograms = editing ? parseJson<string>(editing.programIdsJson) : [];
  const selectedLevels = editing ? parseJson<number>(editing.levelsJson) : [];

  // Validated with the SAME function the server uses, so the warning a
  // librarian sees while typing matches the refusal they would get on save.
  const urlLooksSafe = url.trim() === '' || isValidResourceUrl(url.trim());

  return (
    <Card>
      <CardHeader
        title={editing ? `Editing: ${editing.title}` : 'Add a resource'}
        description={
          editing
            ? 'Changes take effect immediately for every reader.'
            : 'Digital only — a link or an uploaded document. There are no copies, loans or due dates.'
        }
        actions={
          editing ? (
            <button
              type="button"
              onClick={() => router.push('/library/manage')}
              className="text-xs font-medium text-slate-500 hover:underline"
            >
              Cancel edit
            </button>
          ) : null
        }
      />
      <CardBody>
        {state.message ? (
          <div className="mb-4">
            <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>
          </div>
        ) : null}
        {archiveState.message ? (
          <div className="mb-4">
            <Alert tone={archiveState.ok ? 'success' : 'danger'}>{archiveState.message}</Alert>
          </div>
        ) : null}

        <form action={action} className="space-y-4">
          {editing ? <input type="hidden" name="resourceId" value={editing.id} /> : null}
          <input type="hidden" name="publish" value="true" />

          <Field label="Title" htmlFor="title" required>
            <Input id="title" name="title" required maxLength={300} defaultValue={editing?.title ?? ''} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Authors" htmlFor="authors" hint="Free text — “Cormen, Leiserson…”">
              <Input id="authors" name="authors" maxLength={300} defaultValue={editing?.authors ?? ''} />
            </Field>
            <Field label="Publisher" htmlFor="publisher">
              <Input id="publisher" name="publisher" maxLength={200} defaultValue={editing?.publisher ?? ''} />
            </Field>
          </div>

          <Field label="Description" htmlFor="description">
            <Textarea id="description" name="description" rows={2} maxLength={2000} defaultValue={editing?.description ?? ''} />
          </Field>

          <Field
            label="Link"
            htmlFor="url"
            required
            error={urlLooksSafe ? undefined : 'Only http://, https:// and paths within this site are accepted.'}
            hint="Where the material actually lives."
          >
            <Input
              id="url"
              name="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… or /library/docs/…"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Format" htmlFor="kind">
              <Select id="kind" name="kind" defaultValue={editing?.kind ?? 'DOCUMENT'}>
                {RESOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.charAt(0) + k.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Language" htmlFor="language">
              <Input id="language" name="language" maxLength={8} defaultValue={editing?.language ?? 'en'} />
            </Field>
            <Field label="Pages" htmlFor="pageCount">
              <Input id="pageCount" name="pageCount" type="number" min={1} defaultValue={editing?.pageCount ?? ''} />
            </Field>
            <Field label="Minutes" htmlFor="durationMin" hint="Video / audio">
              <Input id="durationMin" name="durationMin" type="number" min={1} defaultValue={editing?.durationMin ?? ''} />
            </Field>
          </div>

          <Field
            label="Subjects"
            htmlFor="tags"
            hint="Comma separated. Case and spacing are normalised, so “Algebra” and “algebra” are one subject."
          >
            <Input id="tags" name="tags" defaultValue={editing?.tags ?? ''} placeholder="algebra, mathematics" />
          </Field>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-800">Who can see it</p>
            <p className="mb-3 mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Leave the programme and level boxes empty for “everyone in the school”. They narrow
              the audience; they never widen it. Confidential material belongs under
              <strong> Staff only</strong>, which is a deliberate choice rather than an omission.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Audience" htmlFor="audience">
                <Select id="audience" name="audience" defaultValue={editing?.audience ?? 'ALL'}>
                  <option value="ALL">Everyone in the school</option>
                  <option value="STAFF">Staff only</option>
                </Select>
              </Field>

              <Field label="Levels" htmlFor="levels" hint="e.g. 300, 400">
                <Input id="levels" name="levels" defaultValue={selectedLevels.join(', ')} placeholder="all levels" />
              </Field>

              <Field label="Programmes" htmlFor="programIds" hint="Ctrl-click for several">
                <select
                  id="programIds"
                  name="programIds"
                  multiple
                  defaultValue={selectedPrograms}
                  className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                  size={3}
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            {editing ? (
              <span className="text-[11px] text-slate-500">
                Archiving removes it from the catalogue but keeps its usage history.
              </span>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <SaveButton editing={Boolean(editing)} />
            </div>
          </div>
        </form>

        {editing ? (
          <form action={archiveAction} className="mt-3 flex justify-end border-t border-slate-200 pt-3">
            <input type="hidden" name="resourceId" value={editing.id} />
            <ArchiveButton />
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
