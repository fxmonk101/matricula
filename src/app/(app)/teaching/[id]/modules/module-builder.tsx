'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

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
import { ModuleItemIcon } from '@/components/module-item-icon';
import {
  ITEM_KIND_LABELS,
  MEETING_PROVIDERS,
  MODULE_ITEM_KINDS,
  PROVIDER_LABELS,
  type MeetingProvider,
  type ModuleItemKind,
} from '@/lib/domain/lms';
import {
  deleteItemAction,
  deleteModuleAction,
  moveItemAction,
  moveModuleAction,
  saveCourseworkAction,
  saveFileItemAction,
  saveItemAction,
  saveModuleAction,
  saveVirtualClassAction,
  setItemPublishedAction,
  setModulePublishedAction,
  type LmsFormState,
} from './actions';

/**
 * The course builder.
 *
 * Re-ordering is done with up/down buttons rather than drag-and-drop. Drag is
 * nicer with a mouse and unusable without one — on a phone, with a keyboard, or
 * with a screen reader — and this is a list a lecturer maintains, not a toy.
 * The server takes an index either way, so drag can be added later without the
 * contract changing.
 */

function Submit({ label, variant = 'primary', size }: {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

function useResult(state: LmsFormState, title: string) {
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

export interface ItemView {
  id: string;
  kind: ModuleItemKind;
  title: string;
  isPublished: boolean;
  externalUrl: string | null;
  dueAt: string | null;
  meetingStartsAt: string | null;
}

export interface ModuleView {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  unlockAt: string | null;
  items: ItemView[];
}

export function ModuleBuilder({
  offeringId,
  spaceId,
  modules,
  mayPublish,
  automaticProviders,
}: {
  offeringId: string;
  spaceId: string | null;
  modules: ModuleView[];
  mayPublish: boolean;
  /** Providers that can actually create a meeting on this deployment. */
  automaticProviders: string[];
}) {
  const [addState, addModule] = useActionState<LmsFormState, FormData>(saveModuleAction, {});
  const [publishState, publishModule] = useActionState<LmsFormState, FormData>(
    setModulePublishedAction,
    {},
  );
  const [removeState, removeModule] = useActionState<LmsFormState, FormData>(
    deleteModuleAction,
    {},
  );
  const [moveState, moveModule] = useActionState<LmsFormState, FormData>(moveModuleAction, {});
  const [itemState, addItem] = useActionState<LmsFormState, FormData>(saveItemAction, {});
  const [courseworkState, addCoursework] = useActionState<LmsFormState, FormData>(
    saveCourseworkAction,
    {},
  );
  const [classState, addClass] = useActionState<LmsFormState, FormData>(
    saveVirtualClassAction,
    {},
  );
  const [fileState, addFile] = useActionState<LmsFormState, FormData>(saveFileItemAction, {});
  const [itemPublishState, publishItem] = useActionState<LmsFormState, FormData>(
    setItemPublishedAction,
    {},
  );
  const [itemRemoveState, removeItem] = useActionState<LmsFormState, FormData>(
    deleteItemAction,
    {},
  );
  const [itemMoveState, moveItem] = useActionState<LmsFormState, FormData>(moveItemAction, {});

  useResult(addState, 'Module saved');
  useResult(publishState, 'Done');
  useResult(removeState, 'Deleted');
  useResult(moveState, 'Moved');
  useResult(itemState, 'Item saved');
  useResult(courseworkState, 'Assignment saved');
  useResult(classState, 'Class scheduled');
  useResult(fileState, 'File attached');
  useResult(itemPublishState, 'Done');
  useResult(itemRemoveState, 'Deleted');
  useResult(itemMoveState, 'Moved');

  // Which module's "add an item" form is open. One at a time, so the page does
  // not become a wall of identical forms.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [kind, setKind] = useState<ModuleItemKind>('PAGE');
  const [provider, setProvider] = useState<MeetingProvider>('MANUAL');

  return (
    <div className="space-y-4">
      {modules.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No modules yet"
              description="A module is a week, a topic, or a unit — whatever you organise your teaching by. Add the first one below."
            />
          </CardBody>
        </Card>
      ) : (
        modules.map((module, index) => (
          <Card key={module.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{module.title}</span>
                  {module.isPublished ? (
                    <Badge tone="success">Published</Badge>
                  ) : (
                    <Badge tone="neutral">Draft</Badge>
                  )}
                  {module.unlockAt && (
                    <Badge tone="info">Opens {module.unlockAt.slice(0, 16).replace('T', ' ')}</Badge>
                  )}
                </span>
              }
              description={module.description ?? undefined}
              actions={
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Ordering. Disabled at the ends rather than hidden, so the
                      controls do not move about as modules are shuffled. */}
                  <form action={moveModule}>
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <input type="hidden" name="spaceId" value={spaceId ?? ''} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="toIndex" value={index - 1} />
                    <Button type="submit" variant="ghost" size="sm" disabled={index === 0} aria-label="Move up">
                      ↑
                    </Button>
                  </form>
                  <form action={moveModule}>
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <input type="hidden" name="spaceId" value={spaceId ?? ''} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="toIndex" value={index + 1} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={index === modules.length - 1}
                      aria-label="Move down"
                    >
                      ↓
                    </Button>
                  </form>

                  {mayPublish && (
                    <form action={publishModule}>
                      <input type="hidden" name="offeringId" value={offeringId} />
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="isPublished" value={String(!module.isPublished)} />
                      <Submit
                        label={module.isPublished ? 'Withdraw' : 'Publish'}
                        variant="secondary"
                        size="sm"
                      />
                    </form>
                  )}

                  <form action={removeModule}>
                    <input type="hidden" name="offeringId" value={offeringId} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <Submit label="Delete" variant="ghost" size="sm" />
                  </form>
                </div>
              }
            />

            {module.items.length > 0 && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {module.items.map((item, itemIndex) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <ModuleItemIcon kind={item.kind} />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">{item.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {ITEM_KIND_LABELS[item.kind]}
                        {item.dueAt && ` · due ${item.dueAt.slice(0, 16).replace('T', ' ')}`}
                        {item.meetingStartsAt &&
                          ` · ${item.meetingStartsAt.slice(0, 16).replace('T', ' ')}`}
                      </span>
                    </span>

                    {!item.isPublished && <Badge tone="neutral">Draft</Badge>}

                    <span className="flex items-center gap-1">
                      <form action={moveItem}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="moduleId" value={module.id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="toIndex" value={itemIndex - 1} />
                        <Button type="submit" variant="ghost" size="sm" disabled={itemIndex === 0} aria-label="Move up">
                          ↑
                        </Button>
                      </form>
                      <form action={moveItem}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="moduleId" value={module.id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="toIndex" value={itemIndex + 1} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={itemIndex === module.items.length - 1}
                          aria-label="Move down"
                        >
                          ↓
                        </Button>
                      </form>

                      {mayPublish && (
                        <form action={publishItem}>
                          <input type="hidden" name="offeringId" value={offeringId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="isPublished" value={String(!item.isPublished)} />
                          <Submit
                            label={item.isPublished ? 'Withdraw' : 'Publish'}
                            variant="ghost"
                            size="sm"
                          />
                        </form>
                      )}

                      <form action={removeItem}>
                        <input type="hidden" name="offeringId" value={offeringId} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <Submit label="Delete" variant="ghost" size="sm" />
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-slate-100 px-5 py-3">
              {openFor === module.id && kind === 'FILE' ? (
                <form action={addFile} className="space-y-3">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="moduleId" value={module.id} />

                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <Field label="Kind" htmlFor={`kind-${module.id}`} required>
                      <Select
                        id={`kind-${module.id}`}
                        value={kind}
                        onChange={(e) => setKind(e.target.value as ModuleItemKind)}
                      >
                        {MODULE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {ITEM_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Title" htmlFor={`ftitle-${module.id}`} required>
                      <Input
                        id={`ftitle-${module.id}`}
                        name="title"
                        required
                        placeholder="Lecture 3 slides"
                      />
                    </Field>
                  </div>

                  <Field
                    label="File"
                    htmlFor={`file-${module.id}`}
                    required
                    hint="PDF, Word, Excel, PowerPoint or an image, up to 20 MB. Only students on this course can download it."
                  >
                    <input
                      id={`file-${module.id}`}
                      type="file"
                      name="file"
                      required
                      accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp"
                      className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:text-xs file:font-medium file:text-onInk hover:file:bg-slate-800"
                    />
                  </Field>

                  <div className="flex gap-2">
                    <Submit label="Attach the file" size="sm" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpenFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : openFor === module.id && kind === 'MEETING' ? (
                <form action={addClass} className="space-y-3">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="moduleId" value={module.id} />

                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <Field label="Kind" htmlFor={`kind-${module.id}`} required>
                      <Select
                        id={`kind-${module.id}`}
                        value={kind}
                        onChange={(e) => setKind(e.target.value as ModuleItemKind)}
                      >
                        {MODULE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {ITEM_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Title" htmlFor={`mtitle-${module.id}`} required>
                      <Input id={`mtitle-${module.id}`} name="title" required placeholder="Week 3 lecture" />
                    </Field>
                  </div>

                  <Field label="Held on" htmlFor={`provider-${module.id}`} required>
                    <Select
                      id={`provider-${module.id}`}
                      name="provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as MeetingProvider)}
                    >
                      {MEETING_PROVIDERS.map((p) => (
                        <option
                          key={p}
                          value={p}
                          disabled={p !== 'MANUAL' && !automaticProviders.includes(p)}
                        >
                          {PROVIDER_LABELS[p]}
                          {p !== 'MANUAL' && !automaticProviders.includes(p)
                            ? ' — not connected'
                            : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {provider === 'MANUAL' ? (
                    <Field
                      label="Join link"
                      htmlFor={`joinUrl-${module.id}`}
                      required
                      hint="Paste the link from Teams, Zoom, Meet or whatever you use."
                    >
                      <Input
                        id={`joinUrl-${module.id}`}
                        name="joinUrl"
                        required
                        placeholder="https://teams.microsoft.com/l/meetup-join/..."
                      />
                    </Field>
                  ) : (
                    <Alert tone="info">
                      The meeting will be created for you and the link saved here.
                    </Alert>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Starts" htmlFor={`startsAt-${module.id}`} required>
                      <Input id={`startsAt-${module.id}`} name="startsAt" type="datetime-local" required />
                    </Field>
                    <Field label="Ends" htmlFor={`endsAt-${module.id}`} required>
                      <Input id={`endsAt-${module.id}`} name="endsAt" type="datetime-local" required />
                    </Field>
                  </div>

                  <div className="flex gap-2">
                    <Submit label="Schedule the class" size="sm" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpenFor(null)}>
                      Cancel
                    </Button>
                  </div>

                  <p className="text-[11px] text-slate-500">
                    Students are told about it when you publish it, not now.
                  </p>
                </form>
              ) : openFor === module.id && kind === 'COURSEWORK' ? (
                <form action={addCoursework} className="space-y-3">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="moduleId" value={module.id} />

                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <Field label="Kind" htmlFor={`kind-${module.id}`} required>
                      <Select
                        id={`kind-${module.id}`}
                        value={kind}
                        onChange={(e) => setKind(e.target.value as ModuleItemKind)}
                      >
                        {MODULE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {ITEM_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Title" htmlFor={`ctitle-${module.id}`} required>
                      <Input id={`ctitle-${module.id}`} name="title" required placeholder="Problem set 1" />
                    </Field>
                  </div>

                  <Field
                    label="Instructions"
                    htmlFor={`instructions-${module.id}`}
                    hint="Markdown. What the student has to do."
                  >
                    <Textarea id={`instructions-${module.id}`} name="instructions" rows={5} />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Marks available" htmlFor={`points-${module.id}`} required>
                      <Input
                        id={`points-${module.id}`}
                        name="pointsPossible"
                        type="number"
                        min={1}
                        step="any"
                        defaultValue={100}
                        required
                      />
                    </Field>
                    <Field label="Due" htmlFor={`due-${module.id}`} hint="Optional.">
                      <Input id={`due-${module.id}`} name="dueAt" type="datetime-local" />
                    </Field>
                  </div>

                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-medium text-slate-700">How it is handed in</legend>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="allowsText" defaultChecked className="h-3.5 w-3.5 rounded border-slate-300" />
                      A typed answer
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="allowsFile" defaultChecked className="h-3.5 w-3.5 rounded border-slate-300" />
                      A file — PDF, Word, Excel, PowerPoint or an image
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" name="acceptsLate" defaultChecked className="h-3.5 w-3.5 rounded border-slate-300" />
                      Accept late work, marked as late
                    </label>
                  </fieldset>

                  <div className="flex gap-2">
                    <Submit label="Set the assignment" size="sm" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpenFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : openFor === module.id ? (
                <form action={addItem} className="space-y-3">
                  <input type="hidden" name="offeringId" value={offeringId} />
                  <input type="hidden" name="moduleId" value={module.id} />

                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <Field label="Kind" htmlFor={`kind-${module.id}`} required>
                      <Select
                        id={`kind-${module.id}`}
                        name="kind"
                        value={kind}
                        onChange={(e) => setKind(e.target.value as ModuleItemKind)}
                      >
                        {MODULE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {ITEM_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Title" htmlFor={`title-${module.id}`} required>
                      <Input id={`title-${module.id}`} name="title" required placeholder="Chapter 3 — Recursion" />
                    </Field>
                  </div>

                  {kind === 'PAGE' && (
                    <Field
                      label="Content"
                      htmlFor={`body-${module.id}`}
                      required
                      hint="Markdown. Headings, lists, bold and links all work."
                    >
                      <Textarea id={`body-${module.id}`} name="bodyMarkdown" rows={6} />
                    </Field>
                  )}

                  {kind === 'LINK' && (
                    <Field
                      label="Address"
                      htmlFor={`url-${module.id}`}
                      required
                      hint="Must start with https://"
                    >
                      <Input id={`url-${module.id}`} name="externalUrl" placeholder="https://example.edu/reading" />
                    </Field>
                  )}

                  <div className="flex gap-2">
                    <Submit label="Add item" size="sm" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenFor(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpenFor(module.id);
                    setKind('PAGE');
                  }}
                >
                  + Add an item
                </Button>
              )}
            </div>
          </Card>
        ))
      )}

      <Card>
        <CardHeader
          title="Add a module"
          description="It starts as a draft. Nothing reaches students until you publish it."
        />
        <CardBody>
          <form action={addModule} className="space-y-3">
            <input type="hidden" name="offeringId" value={offeringId} />

            <Field label="Title" htmlFor="moduleTitle" required>
              <Input id="moduleTitle" name="title" required placeholder="Week 1 — Foundations" />
            </Field>

            <Field label="Description" htmlFor="moduleDescription" hint="Optional.">
              <Input id="moduleDescription" name="description" placeholder="What this week covers." />
            </Field>

            <Field
              label="Opens at"
              htmlFor="unlockAt"
              hint="Optional. Published but not yet open — students see it listed and locked."
            >
              <Input id="unlockAt" name="unlockAt" type="datetime-local" />
            </Field>

            <Submit label="Add module" />
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
