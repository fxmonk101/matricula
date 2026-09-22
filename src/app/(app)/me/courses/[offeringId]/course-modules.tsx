'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Badge, Card } from '@/components/ui';
import { ModuleItemIcon } from '@/components/module-item-icon';
import { ITEM_KIND_LABELS, type ModuleItemKind } from '@/lib/domain/lms';

/**
 * The student's accordion of modules.
 *
 * Everything here has ALREADY been filtered on the server — this component
 * cannot receive a draft, so there is nothing for it to hide. Its only job is
 * the disclosure behaviour.
 *
 * The first module opens by default. A course that opens entirely collapsed
 * asks a student to click before they can see whether there is anything in it.
 */

export interface StudentItemView {
  id: string;
  kind: ModuleItemKind;
  title: string;
  externalUrl: string | null;
  /** Already sanitised on the server. */
  bodyHtml: string | null;
  /** Set for COURSEWORK items, so the row can link to the hand-in page. */
  courseworkId: string | null;
  dueLabel: string | null;
  stateLabel: string | null;
  /** MEETING items: how soon it starts, and whether it can be joined yet. */
  timingLabel: string | null;
  joinable: boolean;
  /** FILE items: what was attached, for the download link. */
  fileName: string | null;
}

export interface StudentModuleView {
  id: string;
  title: string;
  description: string | null;
  items: StudentItemView[];
}

export function CourseModules({
  modules,
  offeringId,
}: {
  modules: StudentModuleView[];
  offeringId: string;
}) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(modules.length > 0 ? [modules[0].id] : []),
  );
  const [reading, setReading] = useState<string | null>(null);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {modules.map((module) => {
        const isOpen = open.has(module.id);

        return (
          <Card key={module.id}>
            <button
              type="button"
              onClick={() => toggle(module.id)}
              aria-expanded={isOpen}
              aria-controls={`module-${module.id}`}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"
            >
              <span
                aria-hidden
                className={[
                  'text-slate-400 transition-transform',
                  isOpen ? 'rotate-90' : '',
                ].join(' ')}
              >
                ▸
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{module.title}</span>
                {module.description && (
                  <span className="mt-0.5 block text-xs text-slate-500">{module.description}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-slate-500">
                {module.items.length} item{module.items.length === 1 ? '' : 's'}
              </span>
            </button>

            {isOpen && (
              <ul id={`module-${module.id}`} className="divide-y divide-slate-100 border-t border-slate-100">
                {module.items.length === 0 && (
                  <li className="px-5 py-4 text-xs text-slate-500">
                    Nothing in this module yet.
                  </li>
                )}

                {module.items.map((item) => (
                  <li key={item.id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ModuleItemIcon kind={item.kind} />

                      <span className="min-w-0 flex-1">
                        {item.kind === 'LINK' && item.externalUrl ? (
                          <a
                            href={item.externalUrl}
                            target="_blank"
                            // noopener stops the opened page reaching back
                            // through window.opener; noreferrer keeps the
                            // student's location out of the target's logs.
                            rel="noopener noreferrer"
                            className="block truncate text-sm font-medium text-brand-700 hover:underline"
                          >
                            {item.title} ↗
                          </a>
                        ) : item.kind === 'PAGE' ? (
                          <button
                            type="button"
                            onClick={() => setReading(reading === item.id ? null : item.id)}
                            aria-expanded={reading === item.id}
                            className="block w-full truncate text-left text-sm font-medium text-slate-900 hover:text-brand-700"
                          >
                            {item.title}
                          </button>
                        ) : item.kind === 'FILE' ? (
                          /*
                            By ITEM, never by storage key — the route resolves
                            the row and checks the reader is on this course.
                          */
                          <a
                            href={`/materials/${item.id}/file`}
                            className="block truncate text-sm font-medium text-sky-700 hover:underline"
                          >
                            {item.title}
                            {item.fileName ? ` — ${item.fileName}` : ''}
                          </a>
                        ) : item.kind === 'MEETING' ? (
                          item.joinable ? (
                            /*
                              Through a redirect rather than straight to the
                              provider, so joining is something the system can
                              observe — and so the join link is never in the
                              page for somebody to copy out of a screenshot.
                            */
                            <a
                              href={`/me/courses/${offeringId}/join?item=${item.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-sm font-medium text-violet-700 hover:underline"
                            >
                              {item.title} ↗
                            </a>
                          ) : (
                            <span className="block truncate text-sm text-slate-900">
                              {item.title}
                            </span>
                          )
                        ) : item.kind === 'COURSEWORK' && item.courseworkId ? (
                          <Link
                            href={`/me/courses/${offeringId}/${item.courseworkId}`}
                            className="block truncate text-sm font-medium text-brand-700 hover:underline"
                          >
                            {item.title}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm text-slate-900">{item.title}</span>
                        )}

                        <span className="block text-[11px] text-slate-500">
                          {ITEM_KIND_LABELS[item.kind]}
                          {item.dueLabel && ` · ${item.dueLabel}`}
                          {item.timingLabel && ` · ${item.timingLabel}`}
                        </span>
                      </span>

                      {item.stateLabel && (
                        <Badge
                          tone={
                            item.stateLabel === 'Marked'
                              ? 'success'
                              : item.stateLabel === 'Closed'
                                ? 'danger'
                                : item.stateLabel === 'Submitted late'
                                  ? 'warning'
                                  : item.stateLabel === 'Submitted'
                                    ? 'success'
                                    : 'neutral'
                          }
                        >
                          {item.stateLabel}
                        </Badge>
                      )}

                      {item.kind === 'MEETING' && item.joinable && (
                        <Badge tone="success">Join</Badge>
                      )}
                    </div>

                    {item.kind === 'PAGE' && reading === item.id && item.bodyHtml && (
                      <div
                        className="prose-sm mt-3 max-w-none rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800"
                        // Sanitised on the server by the renderer this codebase
                        // already uses for forum posts.
                        dangerouslySetInnerHTML={{ __html: item.bodyHtml }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

