import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
