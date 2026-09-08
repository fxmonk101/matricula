/**
 * Design-system primitives.
 *
 * Deliberately dependency-free: each is a thin, typed wrapper over a native
 * element with a variant map. Everything composes through `className`, so a
 * caller can always escape the system without forking a component.
 */

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------

const buttonVariants = {
  primary:
    'bg-brand-600 text-onAccent shadow-sm hover:bg-brand-700 hover:shadow disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'bg-white text-slate-800 shadow-xs ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400',
  danger: 'bg-rose-600 text-onAccent shadow-sm hover:bg-rose-700 hover:shadow',
  success: 'bg-emerald-600 text-onAccent shadow-sm hover:bg-emerald-700 hover:shadow',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
} as const;

const buttonSizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}

/**
 * Fixed heights per size rather than padding, so a button lines up with an
 * input of the same size without either of them knowing about the other.
 * `active:translate-y-px` is the whole press feedback — small enough not to
 * be a distraction on a form with six buttons, present enough to feel real.
 */
const buttonBase =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium ' +
  'transition duration-150 ease-out-quart active:translate-y-px ' +
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60';

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <Link
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // A hairline border AND a soft shadow: the border defines the edge at
        // any zoom, the shadow lifts it off the page. Border at 70% opacity so
        // it reads as a hairline rather than a drawn line.
        'rounded-xl border border-slate-200/70 bg-white shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-3.5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold leading-5 text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/10',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  gold: 'bg-amber-100 text-amber-900 ring-amber-700/20',
} as const;

export type BadgeTone = keyof typeof badgeTones;

/**
 * `dot` prepends a small filled circle in the tone colour — the modern way to
 * show a status without the label having to shout it. `pill` rounds fully,
 * which reads better for a single-word state; the default squared shape is
 * kept for multi-word tags.
 */
export function Badge({
  tone = 'neutral',
  dot,
  pill,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean; pill?: boolean }) {
  const dotColour: Record<BadgeTone, string> = {
    neutral: 'bg-slate-400',
    brand: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    gold: 'bg-amber-500',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        pill ? 'rounded-full' : 'rounded-md',
        badgeTones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dotColour[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}

/**
 * Map a domain status string to a visual tone. Centralised so that, e.g.,
 * OVERDUE is the same red everywhere it appears.
 */
export function toneForStatus(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
    case 'REGISTERED':
    case 'PAID':
    case 'CONFIRMED':
    case 'OFFERED':
    case 'ACCEPTED':
    case 'ENROLLED':
    case 'GOOD':
    case 'OPEN':
      return 'success';
    case 'DEANS_LIST':
    case 'GRADUATED':
      return 'gold';
    case 'WAITLISTED':
    case 'PARTIALLY_PAID':
    case 'WARNING':
    case 'PENDING':
    case 'UNDER_REVIEW':
    case 'PROBATION':
    // A school still being set up, and one whose subscription has lapsed, are
    // both "needs attention" rather than failures — neither locks anyone out.
    case 'PROVISIONING':
    case 'PAST_DUE':
      return 'warning';
    case 'TRIAL':
    case 'TRIALING':
      return 'info';
    case 'REJECTED':
    case 'DISMISSED':
    case 'SUSPENDED':
    case 'OVERDUE':
    case 'FAILED':
    case 'CANCELLED':
    case 'REVERSED':
      return 'danger';
    case 'SUBMITTED':
    case 'ISSUED':
    case 'PLANNED':
      return 'info';
    default:
      return 'neutral';
  }
}

// -----------------------------------------------------------------------------
// Form controls
// -----------------------------------------------------------------------------

/**
 * `h-9` matches the `md` button, so a field and its submit button are the same
 * height without coordination. The focus state is a 2px inset brand ring that
 * REPLACES the resting border rather than stacking on it, so the control does
 * not visibly grow when focused.
 */
const fieldBase =
  'block w-full rounded-lg border-0 bg-white px-3 text-sm text-slate-900 shadow-xs ring-1 ring-inset ' +
  'ring-slate-300 transition-shadow placeholder:text-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-600 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9', className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'min-h-24 py-2 leading-relaxed', className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, 'h-9 pr-8', className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Table
// -----------------------------------------------------------------------------

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          'min-w-full divide-y divide-slate-200/70 text-sm [&_thead_tr]:border-b [&_thead_tr]:border-slate-200/70',
          className,
        )}
        {...props}
      />
    </div>
  );
}

/**
 * Header cells are sentence-case `text-xs font-medium`, not uppercase with
 * letter-spacing. The uppercase-tracked convention dates a UI instantly; a
 * quiet medium-weight label in the muted ink is what current products use, and
 * it stays legible next to the data instead of competing with it.
 */
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 align-middle text-slate-700', className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span
        className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"
        aria-hidden
      >
        {icon ?? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M4 3h9l3 3v11H4Zm9 1.5V7h2.5Z" />
          </svg>
        )}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Feedback
// -----------------------------------------------------------------------------

const alertTones = {
  info: 'bg-sky-50 text-sky-900 ring-sky-600/15',
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-600/15',
  warning: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-900 ring-rose-600/15',
} as const;

const alertIcons: Record<keyof typeof alertTones, string> = {
  info: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 12H9V9h2Zm0-7H9V5h2Z',
  success: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 6.2-4.2 4.2a1 1 0 0 1-1.4 0L6 10.5A1 1 0 1 1 7.4 9l1.4 1.4 3.5-3.5a1 1 0 1 1 1.4 1.4Z',
  warning: 'M8.6 3.2 1.7 15a1.6 1.6 0 0 0 1.4 2.4h13.8A1.6 1.6 0 0 0 18.3 15L11.4 3.2a1.6 1.6 0 0 0-2.8 0ZM11 15H9v-2h2Zm0-4H9V7h2Z',
  danger: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 12H9v-2h2Zm0-4H9V5h2Z',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof alertTones;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2.5 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset',
        alertTones[tone],
        className,
      )}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="mt-px h-4 w-4 shrink-0 opacity-70" aria-hidden>
        <path fillRule="evenodd" d={alertIcons[tone]} clipRule="evenodd" />
      </svg>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'mt-0.5', 'text-xs leading-relaxed')}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Statistics
// -----------------------------------------------------------------------------

/**
 * The number is the point, so it is large, tight and tabular. The label is a
 * small eyebrow above it; the sublabel a quiet line below. A hairline accent
 * bar down the left edge carries the tone — enough to group tiles by state on
 * a dashboard without tinting the whole card.
 */
export function StatTile({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: BadgeTone;
}) {
  const accent: Record<BadgeTone, { text: string; bar: string }> = {
    neutral: { text: 'text-slate-900', bar: 'bg-slate-200' },
    brand: { text: 'text-brand-700', bar: 'bg-brand-500' },
    success: { text: 'text-emerald-700', bar: 'bg-emerald-500' },
    warning: { text: 'text-amber-700', bar: 'bg-amber-500' },
    danger: { text: 'text-rose-700', bar: 'bg-rose-500' },
    info: { text: 'text-sky-700', bar: 'bg-sky-500' },
    gold: { text: 'text-amber-700', bar: 'bg-amber-500' },
  };

  return (
    <Card className="relative overflow-hidden p-4 pl-5">
      <span
        className={cn('absolute inset-y-0 left-0 w-1', accent[tone].bar)}
        aria-hidden
      />
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums', accent[tone].text)}>
        {value}
      </p>
      {sublabel ? <p className="mt-2 text-xs leading-relaxed text-slate-500">{sublabel}</p> : null}
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** A small label above the title — a section name, a status, a count. */
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{eyebrow}</p>
        ) : null}
        <h1 className="text-[1.375rem] font-semibold leading-tight tracking-tight text-slate-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A labelled key/value row, used throughout the detail pages. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/** Horizontal progress meter, 0-100. */
export function Meter({ value, tone = 'brand' }: { value: number; tone?: BadgeTone }) {
  const clamped = Math.max(0, Math.min(100, value));
  const fills: Record<BadgeTone, string> = {
    neutral: 'bg-slate-400',
    brand: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    gold: 'bg-amber-500',
  };
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out-quart', fills[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Avatar
// -----------------------------------------------------------------------------

const avatarSizes = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-11 w-11 text-sm',
} as const;

/**
 * Initials on a tinted ground, with the tint derived from the name.
 *
 * Deterministic rather than random: the same person is the same colour on
 * every page and in every session, which is what makes an avatar scannable in
 * a list. A random tint per render would be decoration, not information.
 */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof avatarSizes;
  className?: string;
}) {
  const parts = name.trim().split(/\s+/);
  const text =
    parts.length >= 2
      ? `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`
      : (name.slice(0, 2) || '?');

  const tints = [
    'bg-brand-100 text-brand-700',
    'bg-emerald-50 text-emerald-700',
    'bg-amber-50 text-amber-800',
    'bg-rose-50 text-rose-700',
    'bg-sky-50 text-sky-700',
    'bg-slate-200 text-slate-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold uppercase ring-1 ring-inset ring-slate-900/5',
        avatarSizes[size],
        tints[hash % tints.length],
        className,
      )}
      title={name}
      aria-hidden
    >
      {text}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

/**
 * Link-driven tabs.
 *
 * Deliberately NOT stateful: each tab is a real URL, so a tab is bookmarkable,
 * shareable, survives a refresh, and works with the back button. A stateful
 * tab strip looks identical and does none of that.
 */
export function Tabs({
  tabs,
  className,
}: {
  tabs: { href: string; label: string; active: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1 border-b border-slate-200/70', className)} role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          role="tab"
          aria-selected={t.active}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150',
            t.active
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                t.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500',
              )}
            >
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

/**
 * A loading placeholder.
 *
 * `aria-hidden` and no live region: a screen reader should be told the page is
 * busy once, by the container, not read a description of grey rectangles. The
 * shimmer is suppressed entirely under `prefers-reduced-motion` by the global
 * rule in `globals.css`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative block overflow-hidden rounded bg-slate-200',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer',
        'after:bg-gradient-to-r after:from-transparent after:via-white/40 after:to-transparent',
        className,
      )}
    />
  );
}

/** A skeleton shaped like a table, for a list page that is still loading. */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 px-5 py-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}
