import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { THEME_BOOT_SCRIPT } from '@/components/theme-toggle';

/**
 * Inter, self-hosted.
 *
 * `next/font` downloads the font FILES at build time and serves them from
 * `/_next/static` — there is no runtime request to Google, so this works under
 * the strict `font-src 'self'` in the CSP without loosening it. The `<style>`
 * it injects is inline, already covered by `style-src 'unsafe-inline'`.
 *
 * `display: 'swap'` shows the system fallback immediately and swaps Inter in
 * when it loads, rather than blocking first paint on a font file. The stack in
 * `tailwind.config.ts` is chosen so the swap barely moves anything.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

/**
 * Root metadata is PLATFORM-level and deliberately names no school: this layout
 * wraps the public pages and every tenant alike. The signed-in title template
 * is set per-tenant in `(app)/layout.tsx`, so a page opened at one school never
 * carries another school's name in the browser tab.
 */
export const metadata: Metadata = {
  title: {
    default: 'School Portal',
    template: '%s',
  },
  description: 'Admissions, student records and finance.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * The theme is applied BEFORE first paint, not after hydration.
         *
         * A deferred script runs too late: the page would render light, then
         * flip to dark, so every navigation flashes white for anyone using the
         * dark theme. That is the one case where a blocking inline script is
         * the right answer.
         *
         * `suppressHydrationWarning` on <html> is required because this script
         * mutates the element's class list before React reconciles it, and
         * React would otherwise report the mismatch it caused itself.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
