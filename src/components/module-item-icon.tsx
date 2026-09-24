import type { ModuleItemKind } from '@/lib/domain/lms';

/**
 * The glyph for each kind of module item.
 *
 * A server component with no state: it is rendered inside both the authoring
 * page and the student page, and neither needs it to be interactive.
 *
 * Each kind gets its own SHAPE, not merely its own colour. A row scanned at
 * speed is recognised by silhouette, and colour alone excludes the roughly one
 * in twelve men who cannot reliably separate these hues — on a list whose whole
 * job is to be scannable.
 */
export function ModuleItemIcon({ kind }: { kind: ModuleItemKind }) {
  const common = 'h-4 w-4 shrink-0';

  switch (kind) {
    case 'PAGE':
      // A document.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <path d="M5 2.5h6l4 4v11H5z" strokeLinejoin="round" />
            <path d="M11 2.5V7h4M7.5 11h5M7.5 14h5" strokeLinecap="round" />
          </svg>
        </span>
      );

    case 'FILE':
      // A downward arrow into a tray.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-700">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <path d="M10 3v8m0 0 3-3m-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 13v2.5h13V13" strokeLinecap="round" />
          </svg>
        </span>
      );

    case 'LINK':
      // A chain.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 1 0-4.2-4.2l-1 1" strokeLinecap="round" />
            <path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 1 0 4.2 4.2l1-1" strokeLinecap="round" />
          </svg>
        </span>
      );

    case 'QUIZ':
      // A checklist with a clock face, so a quiz reads as timed at a glance
      // and is never mistaken for an essay on a list of twenty items.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-violet-50 text-violet-700">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M10 6.5V10l2.2 1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );

    case 'COURSEWORK':
      // A clipboard — the PRD's own choice, and the conventional one.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-700">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <path d="M7 4H5.5v13h9V4H13" strokeLinejoin="round" />
            <path d="M7.5 2.5h5v3h-5z" strokeLinejoin="round" />
            <path d="M8 10.5l1.5 1.5 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      );

    case 'MEETING':
      // A camera. Purple, as the PRD asks — but the shape carries it.
      return (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-violet-50 text-violet-700">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={common} aria-hidden>
            <rect x="2.5" y="5.5" width="10" height="9" rx="2" />
            <path d="M12.5 9.5l5-2.5v6l-5-2.5z" strokeLinejoin="round" />
          </svg>
        </span>
      );
  }
}
