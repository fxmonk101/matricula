import type { Metadata, Viewport } from 'next';
import './globals.css';
import { INSTITUTION } from '@/lib/utils';

export const metadata: Metadata = {
  title: {
    default: `${INSTITUTION.name} — Portal`,
    template: `%s · ${INSTITUTION.short}`,
  },
  description:
    'Student information, admissions and finance system for ' + INSTITUTION.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1b5df5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
