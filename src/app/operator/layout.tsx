import type { Metadata } from 'next';
import Link from 'next/link';

import { LogoMark } from '@/components/logo';
import { getOperatorSession } from '@/lib/auth/operator';
import { ToastProvider } from '@/components/ui/overlays';
import { OperatorSignOut } from './sign-out';

export const metadata: Metadata = {
  title: { default: 'Operator console', template: '%s · Operator console' },
  robots: { index: false, follow: false },
};

/**
 * The vendor console's own shell.
 *
 * It carries NO school. That is the entire point of the separation: this
 * console previously rendered inside the school shell, so the person managing
 * every institution on the platform did so with one customer's crest in the
 * corner and that customer's sidebar down the side — which made the vendor look
 * like a member of the school and made it easy to forget which hat was on.
 *
 * The login page is under this route but must render without the chrome, so
 * the shell is skipped when there is no session rather than being duplicated
 * into a second layout.
 */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const session = await getOperatorSession();

  // /operator/login renders bare. `requireOperator()` on each page is what
  // actually guards them — this only decides whether to draw the frame.
  if (!session) return <>{children}</>;

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-800 bg-ink">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
            <div className="flex items-center gap-6">
              <Link href="/operator" className="flex items-center gap-2.5">
                <LogoMark className="h-7 w-7 text-brand-600" />
                <span className="text-sm font-semibold text-onInk">Operator console</span>
              </Link>

              <nav className="hidden items-center gap-1 sm:flex">
                {[
                  { href: '/operator', label: 'Schools' },
                  { href: '/operator/operators', label: 'Operators' },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden text-[11px] text-slate-400 sm:block">{session.email}</span>
              <OperatorSignOut />
            </div>
          </div>
        </header>

        {/* A standing reminder of scope. Everything below this bar reaches every
            institution on the platform, and the person using it is not a member
            of any of them. */}
        <div className="border-b border-amber-200/70 bg-amber-50">
          <div className="mx-auto max-w-7xl px-5 py-1.5 text-[11px] text-amber-900 sm:px-8">
            You are acting as the platform vendor, across every institution. Actions here are
            logged and attributed.
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
