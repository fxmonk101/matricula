'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { markAllReadAction } from '@/app/(app)/notifications/actions';

export interface BellItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const KIND_DOT: Record<string, string> = {
  TASK_ESCALATED: 'bg-rose-500',
  TASK_OVERDUE: 'bg-rose-500',
  TASK_DUE_SOON: 'bg-amber-500',
  TASK_ASSIGNED: 'bg-brand-500',
  TASK_COMPLETED: 'bg-emerald-500',
  TASK_COMMENTED: 'bg-slate-400',
};

function ago(date: Date): string {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function NotificationBell({
  items,
  unread,
}: {
  items: BellItem[];
  unread: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path d="M10 2a6 6 0 0 0-6 6v3.6l-1.3 2.2A.75.75 0 0 0 3.4 15h13.2a.75.75 0 0 0 .65-1.13L16 11.6V8a6 6 0 0 0-6-6Zm0 16a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 10 18Z" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-4 text-onAccent">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-away. A backdrop rather than a document listener so the
              dropdown closes predictably without fighting other handlers. */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-lg ring-1 ring-slate-900/[0.04]">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-2.5">
              <p className="text-xs font-semibold text-slate-900">
                Notifications{unread > 0 ? ` · ${unread} unread` : ''}
              </p>
              {unread > 0 ? (
                <form
                  action={async () => {
                    await markAllReadAction();
                    router.refresh();
                  }}
                >
                  <button type="submit" className="text-[11px] font-medium text-brand-700 hover:underline">
                    Mark all read
                  </button>
                </form>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-500">Nothing yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((n) => {
                    const body = (
                      <div className="flex gap-2.5 px-4 py-2.5">
                        <span
                          className={cn(
                            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                            n.readAt ? 'bg-slate-200' : (KIND_DOT[n.kind] ?? 'bg-brand-500'),
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p
                            className={cn(
                              'truncate text-xs',
                              n.readAt ? 'text-slate-600' : 'font-medium text-slate-900',
                            )}
                          >
                            {n.title}
                          </p>
                          {n.body ? (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{n.body}</p>
                          ) : null}
                          <p className="mt-0.5 text-[10px] text-slate-400">{ago(n.createdAt)}</p>
                        </div>
                      </div>
                    );

                    return (
                      <li key={n.id}>
                        {n.href ? (
                          <Link href={n.href} onClick={() => setOpen(false)} className="block hover:bg-slate-50">
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-slate-200/70 px-4 py-2.5 text-center text-[11px] font-medium text-brand-700 hover:bg-slate-50"
            >
              See all notifications
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
