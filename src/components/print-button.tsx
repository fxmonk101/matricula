'use client';

import { Button } from '@/components/ui';

/**
 * Print the current page.
 *
 * Deliberately the browser's own print dialogue rather than a server-rendered
 * PDF. Schools print to paper or to PDF through that dialogue anyway, and a
 * headless-Chrome dependency would be a deployment burden — a second browser to
 * install, patch and keep alive — for a file the operating system already
 * produces. The print stylesheet in `globals.css` is what makes the output
 * presentable; `.no-print` removes navigation and controls.
 */
export function PrintButton({
  label = 'Print',
  variant = 'secondary',
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Button variant={variant} size="sm" onClick={() => window.print()} className="no-print">
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <path d="M6 2h8v4H6Zm-2 5h12a2 2 0 0 1 2 2v5h-4v3H6v-3H2V9a2 2 0 0 1 2-2Zm4 7h4v2H8Z" />
      </svg>
      {label}
    </Button>
  );
}
