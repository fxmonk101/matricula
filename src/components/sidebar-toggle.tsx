'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The sidebar: fixed on desktop, a dismissible drawer below `lg`.
 *
 * A client component only because the drawer needs state. The navigation
 * itself is passed in as `children` and stays a SERVER component, so the
 * role-filtered link list is still computed on the server and a link the user
 * cannot follow never reaches their browser.
 */
export function SidebarToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating on a phone must close the drawer. Without this the destination
  // renders underneath a panel the reader has to dismiss by hand, which feels
  // like the tap did not work.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="fixed left-3 top-3 z-40 grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 lg:hidden"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path d="M3 5h14v2H3Zm0 4h14v2H3Zm0 4h14v2H3Z" />
        </svg>
      </button>

      {/* Desktop: always present, no JavaScript required to see it. */}
      <div className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">{children}</div>

      {/* Mobile drawer. */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-scrim/50"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{children}</div>
        </div>
      ) : null}
    </>
  );
}
