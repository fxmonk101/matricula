import Link from 'next/link';

import { initials } from '@/lib/utils';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
import type { SessionClaims } from '@/lib/auth/jwt';
import type { School } from '@/server/tenant-context';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out-button';

/**
 * Navigation is derived from the session role rather than rendered-then-hidden.
 * A link the user cannot follow should not exist in their DOM at all — hiding
 * it with CSS leaks the shape of the system to anyone who opens dev tools.
 */
const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: '/dashboard', label: 'Overview', roles: ['ADMIN', 'REGISTRAR'] },
  { href: '/students', label: 'Students', roles: ['ADMIN', 'REGISTRAR', 'ADMISSIONS', 'FINANCE', 'INSTRUCTOR'] },
  { href: '/instructors', label: 'Faculty', roles: ['ADMIN', 'REGISTRAR'] },
  { href: '/courses', label: 'Courses', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'] },
  { href: '/offerings', label: 'Sections', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT'] },
  { href: '/admissions', label: 'Admissions', roles: ['ADMIN', 'ADMISSIONS', 'REGISTRAR'] },
  { href: '/finance', label: 'Finance', roles: ['ADMIN', 'FINANCE', 'REGISTRAR'] },
  { href: '/teaching', label: 'My Teaching', roles: ['INSTRUCTOR', 'ADMIN'] },
  { href: '/me', label: 'My Record', roles: ['STUDENT'] },
  { href: '/me/registration', label: 'Registration', roles: ['STUDENT'] },
  { href: '/me/finance', label: 'My Fees', roles: ['STUDENT'] },
  { href: '/portal', label: 'My Application', roles: ['APPLICANT'] },
  { href: '/settings/school', label: 'School Setup', roles: ['ADMIN'] },
  { href: '/admin/audit', label: 'Audit Log', roles: ['ADMIN'] },
];

export function AppShell({
  session,
  school,
  children,
}: {
  session: SessionClaims;
  school: School;
  children: React.ReactNode;
}) {
  const links = NAV.filter((item) => item.roles.includes(session.role));
  const [firstName = '', lastName = ''] = session.name.split(' ');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: school.brandColor }}
            >
              {school.code.slice(0, 3)}
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-slate-900 sm:block">
              {school.name}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight text-slate-900">{session.name}</p>
              <p className="text-[11px] leading-tight text-slate-500">
                {ROLE_LABELS[session.role]}
              </p>
            </div>
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-white"
              aria-hidden
            >
              {initials(firstName, lastName || firstName)}
            </span>
            <SignOutButton />
          </div>
        </div>

        <nav aria-label="Primary" className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <ul className="flex gap-1 overflow-x-auto pb-px">
            {links.map((link) => (
              <li key={link.href}>
                <NavLink href={link.href}>{link.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-4 text-xs text-slate-400 sm:px-6 no-print">
        {school.name} · Signed in as {session.email}
      </footer>
    </div>
  );
}
