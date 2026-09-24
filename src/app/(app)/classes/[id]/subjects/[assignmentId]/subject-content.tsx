'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { ITEM_KIND_LABELS, type ModuleItemKind } from '@/lib/domain/lms';
import { ModuleItemIcon } from '@/components/module-item-icon';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import {
  deleteSubjectItemAction,
  deleteSubjectModuleAction,
  saveSubjectItemAction,
  saveSubjectModuleAction,
  setSubjectItemPublishedAction,
  setSubjectModulePublishedAction,
  type SubjectContentState,
} from './actions';

/**
 * A teacher's content for one subject with one form class.
 *
 * Deliberately smaller than the university module builder. A secondary school
 * teacher posts a reading, a worksheet link and a class link; they are not
 * assembling a twelve-week Canvas course, and a screen that offers drag-order,
 * rubrics and unlock dates costs them more than it gives.
 *
 * WHAT IS ABSENT: assignments and quizzes. Those write a Submission, which
 * keys on a university registration a pupil does not have. Rather than show a
 * control that half-works, the kinds a form class can use are the only ones
 * offered — and the actions refuse the rest regardless of what is posted.
 */

export interface SubjectModuleView {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  items: {
    id: string;
    kind: ModuleItemKind;
    title: string;
    isPublished: boolean;
    externalUrl: string | null;
  }[];
}

const KINDS: ModuleItemKind[] = ['PAGE', 'LINK', 'MEETING'];

function Submit({ label, variant }: { label: string; variant?: 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

function useNotice(state: SubjectContentState, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not saved',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function SubjectContent({
  classId,
  assignmentId,
  modules,
}: {
  classId: string;
  assignmentId: string;
  modules: SubjectModuleView[];
}) {
  const [moduleState, moduleAction] = useActionState<SubjectContentState, FormData>(
    saveSubjectModuleAction,
    {},
  );
  const [itemState, itemAction] = useActionState<SubjectContentState, FormData>(
    saveSubjectItemAction,
    {},
  );
  const [publishState, publishAction] = useActionState<SubjectContentState, FormData>(
    setSubjectModulePublishedAction,
    {},
  );
  const [itemPublishState, itemPublishAction] = useActionState<SubjectContentState, FormData>(
    setSubjectItemPublishedAction,
    {},
  );
  const [deleteItemState, deleteItemAction] = useActionState<SubjectContentState, FormData>(
    deleteSubjectItemAction,
    {},
  );
  const [deleteModuleState, deleteModuleAction] = useActionState<SubjectContentState, FormData>(
    deleteSubjectModuleAction,
    {},
  );

  useNotice(moduleState, 'Topic saved');
  useNotice(itemState, 'Added');
  useNotice(publishState, 'Done');
  useNotice(itemPublishState, 'Done');
  useNotice(deleteItemState, 'Removed');
  useNotice(deleteModuleState, 'Removed');

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [kind, setKind] = useState<ModuleItemKind>('PAGE');

  const hidden = (
    <>
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
    </>
  );

  return (
    <div className="space-y-4">
      {modules.length === 0 && (
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="Add a topic, then put a reading, a link or a class link inside it. Pupils see a topic only once you publish it."
          />
        </Card>
      )}

      {modules.map((module) => (
        <Card key={module.id}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{module.title}</span>
                <Badge tone={module.isPublished ? 'success' : 'neutral'}>
                  {module.isPublished ? 'Visible to pupils' : 'Hidden'}
                </Badge>
              </span>
            }
            description={module.description ?? undefined}
          />

          <CardBody>
            {module.items.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing in this topic yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {module.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                    <ModuleItemIcon kind={item.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">{item.title}</span>
                      <span className="block text-[11px] text-slate-500">
                        {ITEM_KIND_LABELS[item.kind]}
                        {item.externalUrl ? ` · ${item.externalUrl}` : ''}
                      </span>
                    </span>

                    <Badge tone={item.isPublished ? 'success' : 'neutral'}>
                      {item.isPublished ? 'Published' : 'Draft'}
                    </Badge>

                    <form action={itemPublishAction}>
                      {hidden}
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="publish" value={String(!item.isPublished)} />
                      <Submit
                        variant="secondary"
                        label={item.isPublished ? 'Hide' : 'Publish'}
                      />
                    </form>

                    <form action={deleteItemAction}>
                      {hidden}
                      <input type="hidden" name="itemId" value={item.id} />
                      <Submit variant="secondary" label="Remove" />
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {addingTo === module.id ? (
              <form action={itemAction} className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3">
                {hidden}
                <input type="hidden" name="moduleId" value={module.id} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="What is it?" htmlFor={`kind-${module.id}`}>
                    <Select
                      id={`kind-${module.id}`}
                      name="kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as ModuleItemKind)}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {ITEM_KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Title" htmlFor={`title-${module.id}`}>
                    <Input id={`title-${module.id}`} name="title" required />
                  </Field>
                </div>

                {kind === 'PAGE' && (
                  <Field label="The reading" htmlFor={`body-${module.id}`}>
                    <Textarea id={`body-${module.id}`} name="bodyMarkdown" rows={4} />
                  </Field>
                )}

                {(kind === 'LINK' || kind === 'MEETING') && (
                  <Field
                    label={kind === 'MEETING' ? 'The class link' : 'The web address'}
                    htmlFor={`url-${module.id}`}
                    hint={
                      kind === 'MEETING'
                        ? 'Paste the link from Teams, Zoom, Meet or whatever the school uses.'
                        : undefined
                    }
                  >
                    <Input
                      id={`url-${module.id}`}
                      name="externalUrl"
                      type="url"
                      placeholder="https://"
                      required
                    />
                  </Field>
                )}

                <div className="flex gap-2">
                  <Submit label="Add it" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setAddingTo(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setAddingTo(module.id)}
                >
                  Add something
                </Button>

                <form action={publishAction}>
                  {hidden}
                  <input type="hidden" name="moduleId" value={module.id} />
                  <input type="hidden" name="publish" value={String(!module.isPublished)} />
                  <Submit
                    variant="secondary"
                    label={module.isPublished ? 'Hide this topic' : 'Show this topic'}
                  />
                </form>

                {module.items.length === 0 && (
                  <form action={deleteModuleAction}>
                    {hidden}
                    <input type="hidden" name="moduleId" value={module.id} />
                    <Submit variant="secondary" label="Remove topic" />
                  </form>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader title="Add a topic" description="A week, a unit, or whatever you call it." />
        <CardBody>
          <form action={moduleAction} className="grid gap-3 sm:grid-cols-[2fr_3fr_auto] sm:items-end">
            {hidden}
            <Field label="Title" htmlFor="new-module-title">
              <Input id="new-module-title" name="title" placeholder="Week 1 — Fractions" required />
            </Field>
            <Field label="Description" htmlFor="new-module-description">
              <Input id="new-module-description" name="description" placeholder="Optional" />
            </Field>
            <Submit label="Add topic" />
          </form>
        </CardBody>
      </Card>

      <Alert tone="info">
        Assignments and quizzes are not available for a form class yet — they need a mark to roll
        into, and a pupil&rsquo;s marks live on the report card rather than on a course
        registration. Readings, links and class links all work.
      </Alert>
    </div>
  );
}
