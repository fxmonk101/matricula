'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * =============================================================================
 * SCROLL-REVEAL
 * =============================================================================
 *
 * Entrance animation driven by IntersectionObserver and CSS transitions.
 *
 * WHY NOT A MOTION LIBRARY
 * ------------------------
 * Framer Motion is the obvious reach here and it is roughly 50KB gzipped of
 * JavaScript that must parse before anything moves — on the one page whose job
 * is to load fast for somebody who has never heard of us, over a connection
 * that may be a phone on 3G in Lagos. What that library buys is choreography:
 * springs, layout animation, gesture-driven transitions. This page needs
 * things to fade up as they arrive, which is an observer and a transform.
 *
 * If the design later wants real choreography — shared-element transitions, a
 * draggable timetable preview — that is the moment to take the dependency, not
 * before.
 *
 * REDUCED MOTION IS HONOURED PROPERLY
 * -----------------------------------
 * Not by shortening the animation, but by never applying it: the element is
 * rendered in its final state from the first frame. Someone who has asked their
 * operating system for less motion has usually asked because motion makes them
 * ill, and a faster version of the thing that makes them ill is not an
 * accommodation.
 */

function usePrefersReducedMotion(): boolean {
  // Starts FALSE on the server and is corrected on mount. The alternative —
  // assuming reduced motion until proven otherwise — makes every visitor see a
  // flash of the un-animated state before the animation begins.
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

type Direction = 'up' | 'left' | 'right' | 'none';

const HIDDEN: Record<Direction, string> = {
  up: 'translate-y-6',
  left: '-translate-x-6',
  right: 'translate-x-6',
  none: '',
};

export function Reveal({
  children,
  className,
  delay = 0,
  direction = 'up',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** Milliseconds. Used to stagger siblings. */
  delay?: number;
  direction?: Direction;
  as?: 'div' | 'section' | 'li' | 'span' | 'header';
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const node = ref.current;
    if (!node) return;

    // `IntersectionObserver` is universally available in the browsers this
    // targets, but a missing implementation must show the content rather than
    // hide it forever — an animation that fails should degrade to no animation,
    // never to an invisible page.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          // Once only. Re-animating on every scroll past is the thing that
          // makes a long page feel restless rather than alive.
          observer.disconnect();
        }
      },
      // Fire slightly before the element reaches the viewport, so the motion
      // has finished by the time the reader's eye arrives at it.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      style={reduced ? undefined : { transitionDelay: `${delay}ms` }}
      className={cn(
        // A stable hook so the <noscript> rule in app/layout.tsx can force
        // these visible. Without JavaScript the observer never fires, and the
        // whole page would otherwise sit at opacity 0 — invisible copy on the
        // one page whose entire job is to be read.
        'js-reveal',
        reduced
          ? undefined
          : [
              'transition-[opacity,transform] duration-700 ease-out-quart will-change-[opacity,transform]',
              shown ? 'translate-x-0 translate-y-0 opacity-100' : `opacity-0 ${HIDDEN[direction]}`,
            ],
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Stagger a list of children without hand-writing a delay on each one.
 *
 * `step` is small on purpose. A 150ms cascade across six cards is a third of a
 * second before the last one appears, which reads as the page being slow rather
 * than as an effect.
 */
export function RevealGroup({
  children,
  className,
  step = 60,
  direction = 'up',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  step?: number;
  direction?: Direction;
  as?: 'div' | 'ul' | 'dl';
}) {
  const items = React.Children.toArray(children);
  return (
    <Tag className={className}>
      {items.map((child, index) => (
        <Reveal key={index} delay={index * step} direction={direction}>
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}

/**
 * A nav that gains a border and a shadow once the page has scrolled.
 *
 * Purely to separate it from the hero, which has no border of its own — a
 * sticky bar that looks identical over a photograph and over white text is a
 * bar that reads as floating debris.
 */
export function StickyNav({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300',
        scrolled
          ? 'border-b border-slate-200/70 bg-white/85 shadow-sm shadow-slate-900/[0.03] backdrop-blur-md'
          : 'border-b border-transparent bg-transparent',
        className,
      )}
    >
      {children}
    </header>
  );
}
