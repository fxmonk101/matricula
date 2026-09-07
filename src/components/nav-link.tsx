'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Active state is computed from the pathname rather than passed in, so nav
 * items stay correct on client-side navigation without the parent re-rendering.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();

  // Exact match, or a descendant route — but "/me" must not light up for
  // "/me/finance" when a dedicated "/me/finance" link also exists, so the
  // longest matching link wins by virtue of the more specific href.
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
        isActive
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
      )}
    >
      {children}
    </Link>
  );
}
