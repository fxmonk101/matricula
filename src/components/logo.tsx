import { cn } from '@/lib/utils';

/**
 * =============================================================================
 * THE MARK
 * =============================================================================
 *
 * "Many records, one spine."
 *
 * A single vertical stroke binds three staggered bars. The bars are the things
 * a university keeps separately today — the admissions sheet, the registry
 * list, the departmental mark book, the bursary ledger — at different widths
 * because they never quite agree. The spine is the product's whole claim: one
 * authoritative record running through all of them.
 *
 * Drawn on a 32-unit grid with 4-unit rhythm so every edge lands on a whole
 * pixel at 16, 32, 48 and 64. A mark that is only crisp at its design size is a
 * mark that looks broken in a browser tab, which is where most people will meet
 * it.
 *
 * Rendered inline rather than as an <img> so it inherits `currentColor` — the
 * same component then works on white, on the ink panel, and on a school's own
 * brand colour without three files to keep in step.
 */

export function LogoMark({
  className,
  title,
}: {
  className?: string;
  /** Omit inside a lockup that already carries the name in text. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      className={cn('h-8 w-8', className)}
    >
      {title ? <title>{title}</title> : null}

      {/* The tile. `currentColor` so the mark takes the colour it is given. */}
      <rect width="32" height="32" rx="8" fill="currentColor" />

      {/* The spine: one unbroken stroke, full height of the content area. */}
      <rect x="8" y="8" width="3" height="16" rx="1.5" className="fill-white" />

      {/* Three records, staggered. Widths deliberately unequal — they are not
          the same document, which is the point being made. */}
      <rect x="13" y="8" width="11" height="3" rx="1.5" className="fill-white" />
      <rect x="13" y="14.5" width="7" height="3" rx="1.5" className="fill-white/75" />
      <rect x="13" y="21" width="9" height="3" rx="1.5" className="fill-white/55" />
    </svg>
  );
}

/**
 * Mark plus name.
 *
 * The wordmark is set in the product's own typeface rather than drawn as
 * outlines: it stays legible at any size, it can be selected and read by a
 * screen reader, and it costs nothing to change when the name does.
 */
export function Logo({
  className,
  markClassName,
  name = 'Matricula',
  tagline,
  compact,
}: {
  className?: string;
  markClassName?: string;
  name?: string;
  tagline?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={cn(compact ? 'h-7 w-7' : 'h-8 w-8', markClassName)} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            'font-semibold tracking-[-0.02em]',
            compact ? 'text-[0.9375rem]' : 'text-base',
          )}
        >
          {name}
        </span>
        {tagline ? (
          <span className="mt-1 text-[10px] font-normal tracking-wide text-current/60">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
