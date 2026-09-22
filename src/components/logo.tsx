import Image from 'next/image';

import { cn } from '@/lib/utils';

import lockupDark from '../../public/logo/matricula-lockup-dark.png';
import lockupLight from '../../public/logo/matricula-lockup.png';
import markDark from '../../public/logo/matricula-mark-dark.png';
import markLight from '../../public/logo/matricula-mark.png';

/**
 * =============================================================================
 * THE MARK
 * =============================================================================
 *
 * The Matricula crest: a shield, an M cut from it, an arrow rising out of the
 * top right, and a single gold facet.
 *
 * WHY TWO FILES RATHER THAN ONE THAT INHERITS `currentColor`. The mark that
 * stood here before was a placeholder drawn in code, and being drawn in code it
 * could take any colour it was given. The real artwork cannot: it is three
 * colours whose relationship IS the brand — navy structure, a white field, one
 * gold facet. Recolouring it with CSS would either flatten it to a silhouette
 * or leave the navy invisible on the ink panels the operator console uses.
 *
 * So there are two renderings of the same artwork, and `tone` picks between
 * them:
 *
 *   tone="light"  navy structure on a white field — for white and tinted pages
 *   tone="ink"    the structure reversed to white, gold kept — for dark panels
 *
 * The gold survives both, because it is the one element that reads against
 * either background and it is what stops the reversed mark looking like a
 * generic white badge.
 *
 * SOURCE. Rebuilt from `public/logo/matricula-original.jpg`, which is an 887 x
 * 287 JPEG — the only copy available. The background was cut by flooding in
 * from the edges (so the shield's own white field survived, which a colour key
 * would have punched through), and the wordmark was rebuilt from its darkness
 * so the enclosed counters of A, R and O came out clean. It is faithful at the
 * sizes below and it is NOT a vector: anything above roughly 280px wide, and
 * anything going to print, wants the original artwork from whoever drew it.
 */

const SOURCES = {
  light: { mark: markLight, lockup: lockupLight },
  ink: { mark: markDark, lockup: lockupDark },
} as const;

export type LogoTone = keyof typeof SOURCES;

export function LogoMark({
  className,
  title,
  tone = 'light',
}: {
  className?: string;
  /** Omit inside a lockup that already carries the name in text. */
  title?: string;
  tone?: LogoTone;
}) {
  return (
    <Image
      src={SOURCES[tone].mark}
      alt={title ?? ''}
      /*
       * An empty alt with aria-hidden is the correct pairing for decoration:
       * a mark sitting next to the word "Matricula" announced as "Matricula
       * Matricula" is worse than one not announced at all.
       */
      aria-hidden={title ? undefined : true}
      priority
      className={cn('h-8 w-auto select-none', className)}
    />
  );
}

/**
 * Mark plus name.
 *
 * The name is set in the product's own typeface rather than taken from the
 * artwork, for three reasons that all still hold: it stays sharp at any size,
 * it can be selected and read aloud, and a school's portal sometimes needs the
 * school's name here instead — which `name` allows and a baked-in wordmark
 * would not.
 */
export function Logo({
  className,
  markClassName,
  name = 'Matricula',
  tagline,
  compact,
  tone = 'light',
}: {
  className?: string;
  markClassName?: string;
  name?: string;
  tagline?: string;
  compact?: boolean;
  tone?: LogoTone;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark
        tone={tone}
        className={cn(compact ? 'h-7 w-auto' : 'h-8 w-auto', markClassName)}
      />
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

/**
 * The full artwork — crest, wordmark and strapline as drawn.
 *
 * For the few places that should show the brand rather than label a page: the
 * marketing hero, a sign-in card, the head of a printed report. Everywhere
 * else wants `Logo`, which stays legible at nav size and lets the name change.
 */
export function LogoLockup({
  className,
  tone = 'light',
  priority,
}: {
  className?: string;
  tone?: LogoTone;
  priority?: boolean;
}) {
  return (
    <Image
      src={SOURCES[tone].lockup}
      alt="Matricula — empowering modern education"
      priority={priority}
      className={cn('h-12 w-auto select-none', className)}
    />
  );
}
