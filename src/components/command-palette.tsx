'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { globalSearch, type SearchHit } from '@/app/(app)/search-action';

const KIND_TONE: Record<SearchHit['kind'], string> = {
  Student: 'bg-brand-50 text-brand-700',
  Course: 'bg-sky-50 text-sky-700',
  Task: 'bg-amber-50 text-amber-700',
  Resource: 'bg-emerald-50 text-emerald-700',
  Discussion: 'bg-slate-100 text-slate-600',
  Person: 'bg-slate-100 text-slate-600',
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ⌘K / Ctrl-K anywhere, Escape to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  /*
   * Debounced, and every response carries the query it answered.
   *
   * Without the sequence check a slow request for "ad" can land after a fast
   * one for "adaeze" and repaint the list with stale results — the classic
   * out-of-order search bug, and it looks exactly like the search being wrong.
   */
  const latest = useRef(0);
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const seq = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await globalSearch(query);
        if (seq !== latest.current) return;
        setHits(results);
        setActive(0);
      } finally {
        if (seq === latest.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-left text-xs text-slate-500 transition-colors hover:bg-slate-200"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden>
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.63 3.64a1 1 0 0 0 1.42-1.42l-3.64-3.63A5.5 5.5 0 0 0 9 3.5Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
            clipRule="evenodd"
          />
        </svg>
        <span className="flex-1 truncate">Search…</span>
        <kbd className="hidden shrink-0 rounded border border-slate-300 px-1 font-sans text-[10px] text-slate-400 sm:block">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-scrim/50 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-4">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.63 3.64a1 1 0 0 0 1.42-1.42l-3.64-3.63A5.5 5.5 0 0 0 9 3.5Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Students, courses, tasks, resources, discussions…"
                className="w-full bg-transparent py-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                aria-label="Search"
                aria-autocomplete="list"
                aria-controls="palette-results"
              />
              {loading ? (
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
              ) : null}
            </div>

            <div id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto">
              {query.trim().length < 2 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">
                  Type at least two characters.
                </p>
              ) : hits.length === 0 && !loading ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">
                  Nothing found for “{query}”.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {hits.map((hit, i) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(hit)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left',
                          i === active ? 'bg-brand-50' : 'hover:bg-slate-50',
                        )}
                      >
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                            KIND_TONE[hit.kind],
                          )}
                        >
                          {hit.kind}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-900">{hit.title}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {hit.subtitle}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2 text-[10px] text-slate-400">
              <span>↑↓ to move</span>
              <span>↵ to open</span>
              <span>esc to close</span>
              <span className="ml-auto">Only what you are allowed to see</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
