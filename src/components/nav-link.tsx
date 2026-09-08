'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Active state is computed from the pathname rather than passed in, so nav
 * items stay correct on client-side navigation without the parent re-rendering.
 */
export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  /*
   * Exact match, or a descendant route — but matched on a SEGMENT boundary.
   *
   * A plain `startsWith(href)` would light "/team" up for "/teamwork", and
   * "/me" for "/messages". The trailing slash is what makes the test mean
   * "inside this section" rather than "shares these characters".
   *
   * "/me" still deliberately lights up for "/me/registration": the sidebar
   * lists both, and a reader deep in a section expects its parent to be
   * highlighted too.
   */
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        // The active pill is a soft brand wash with an inset ring for a crisp
        // edge; the left accent bar (via before:) is the extra cue that reads
        // at a glance down a column of items.
        'relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-colors duration-100',
        isActive
          ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/10 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-600'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {icon ? (
        <span className={cn('transition-colors', isActive ? 'text-brand-600' : 'text-slate-400')}>
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </Link>
  );
}
