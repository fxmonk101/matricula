import Link from 'next/link';

import { initials } from '@/lib/utils';
import { ROLE_LABELS, type AcademicModel, type Role } from '@/lib/domain/enums';
import type { SessionClaims } from '@/lib/auth/jwt';
import type { School } from '@/server/tenant-context';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out-button';
import { NotificationBell, type BellItem } from './notification-bell';
import { ThemeToggle } from './theme-toggle';
import { CommandPalette } from './command-palette';
import { SidebarToggle } from './sidebar-toggle';

/**
 * Navigation is derived from the session role rather than rendered-then-hidden.
 * A link the user cannot follow should not exist in their DOM at all — hiding
 * it with CSS leaks the shape of the system to anyone who opens dev tools.
 *
 * Grouped into sections because a flat list of fifteen items is a list nobody
 * reads. The groupings are the mental model a member of staff already has: the
 * people, the academic work, the money, their own work, the school itself.
 */
type NavItem = {
  href: string;
  label: string;
  roles: Role[];
  /** Omit to show for every academic model. */
  models?: AcademicModel[];
  icon: React.ReactNode;
};

type NavSection = { heading: string; items: NavItem[] };

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden>
    <path d={d} />
  </svg>
);

const I = {
  home: 'M10 2 2 8v10h5v-6h6v6h5V8Z',
  people: 'M7 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 17a5 5 0 0 1 10 0Zm11.5-6.5A5 5 0 0 1 18 17h-4a6.5 6.5 0 0 0-1.6-4.3Z',
  book: 'M3 3h5a3 3 0 0 1 2 .8A3 3 0 0 1 12 3h5v13h-5a2 2 0 0 0-2 1.5A2 2 0 0 0 8 16H3Z',
  grid: 'M3 3h6v6H3Zm8 0h6v6h-6ZM3 11h6v6H3Zm8 0h6v6h-6Z',
  money: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4v.6a2.4 2.4 0 0 1 .3 4.66l-1.8.5a.6.6 0 0 0 .15 1.18h2.1a.75.75 0 0 1 0 1.5h-.75v.56a.75.75 0 0 1-1.5 0v-.6a2.4 2.4 0 0 1-.3-4.66l1.8-.5a.6.6 0 0 0-.15-1.18h-2.1a.75.75 0 1 1 0-1.5h.75V6a.75.75 0 0 1 1.5 0Z',
  check: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 6.2-4.2 4.2a1 1 0 0 1-1.4 0L6 10.5A1 1 0 1 1 7.4 9l1.4 1.4 3.5-3.5a1 1 0 1 1 1.4 1.4Z',
  team: 'M10 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM4 17a6 6 0 0 1 12 0Zm-2-7a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Zm11 0a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z',
  org: 'M8 2h4v4h-1v2h4v2h1v4h-4v-4h1V8H9v2h1v4H6v-4h1v-2h4V6H8Z',
  chat: 'M10 3c-4.4 0-8 2.7-8 6 0 1.9 1.2 3.6 3 4.7V18l3.2-1.9c.6.1 1.2.2 1.8.2 4.4 0 8-2.7 8-6s-3.6-6-8-6Z',
  library: 'M3 2h3v16H3Zm4.5 0h3v16h-3ZM12 2.6l2.9-.8 3.6 15.4-2.9.8Z',
  cog: 'M10 6.5A3.5 3.5 0 1 0 10 13.5 3.5 3.5 0 0 0 10 6.5Zm7.4 3-1.5-.5a6 6 0 0 0-.5-1.2l.7-1.4-1.5-1.5-1.4.7a6 6 0 0 0-1.2-.5L11.5 3.6h-3l-.5 1.5a6 6 0 0 0-1.2.5l-1.4-.7-1.5 1.5.7 1.4a6 6 0 0 0-.5 1.2l-1.5.5v3l1.5.5a6 6 0 0 0 .5 1.2l-.7 1.4 1.5 1.5 1.4-.7a6 6 0 0 0 1.2.5l.5 1.5h3l.5-1.5a6 6 0 0 0 1.2-.5l1.4.7 1.5-1.5-.7-1.4a6 6 0 0 0 .5-1.2l1.5-.5Z',
  doc: 'M5 2h6l4 4v12H5Zm6 1.5V7h3.5Z',
};

const SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', roles: ['ADMIN', 'REGISTRAR'], icon: icon(I.home) },
      { href: '/me', label: 'My Record', roles: ['STUDENT'], icon: icon(I.home) },
      { href: '/portal', label: 'My Application', roles: ['APPLICANT'], icon: icon(I.doc) },
      { href: '/family', label: 'My Children', roles: ['GUARDIAN'], icon: icon(I.people) },
    ],
  },
  {
    heading: 'Academic',
    items: [
      { href: '/students', label: 'Students', roles: ['ADMIN', 'REGISTRAR', 'ADMISSIONS', 'FINANCE', 'INSTRUCTOR'], icon: icon(I.people) },
      { href: '/instructors', label: 'Faculty', roles: ['ADMIN', 'REGISTRAR'], icon: icon(I.people) },
      { href: '/courses', label: 'Courses', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'], models: ['HIGHER_ED'], icon: icon(I.book) },
      { href: '/offerings', label: 'Sections', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR', 'STUDENT'], models: ['HIGHER_ED'], icon: icon(I.grid) },
      { href: '/classes', label: 'Classes', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'], models: ['K12'], icon: icon(I.grid) },
      { href: '/reports', label: 'Report Cards', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'], models: ['K12'], icon: icon(I.doc) },
      { href: '/teaching', label: 'My Teaching', roles: ['INSTRUCTOR', 'ADMIN'], icon: icon(I.book) },
      { href: '/me/registration', label: 'Registration', roles: ['STUDENT'], icon: icon(I.check) },
      { href: '/admissions', label: 'Admissions', roles: ['ADMIN', 'ADMISSIONS', 'REGISTRAR'], icon: icon(I.doc) },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { href: '/finance', label: 'Bursary', roles: ['ADMIN', 'FINANCE', 'REGISTRAR'], icon: icon(I.money) },
      { href: '/me/finance', label: 'My Fees', roles: ['STUDENT'], icon: icon(I.money) },
    ],
  },
  {
    heading: 'Work',
    items: [
      { href: '/tasks', label: 'Tasks', roles: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'], icon: icon(I.check) },
      { href: '/team', label: 'My Team', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'], icon: icon(I.team) },
      { href: '/org', label: 'Organisation', roles: ['ADMIN', 'REGISTRAR', 'INSTRUCTOR'], icon: icon(I.org) },
    ],
  },
  {
    heading: 'Community',
    items: [
      { href: '/library', label: 'Library', roles: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'], icon: icon(I.library) },
      { href: '/forums', label: 'Forums', roles: ['ADMIN', 'REGISTRAR', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'], icon: icon(I.chat) },
    ],
  },
  {
    heading: 'School',
    items: [
      { href: '/settings/school', label: 'Setup', roles: ['ADMIN'], icon: icon(I.cog) },
      { href: '/admin/audit', label: 'Audit Log', roles: ['ADMIN'], icon: icon(I.doc) },
    ],
  },
];

export function AppShell({
  session,
  school,
  notifications,
  unreadCount,
  children,
}: {
  session: SessionClaims;
  school: School;
  notifications: BellItem[];
  unreadCount: number;
  children: React.ReactNode;
}) {
  // Filtered by BOTH role and academic model: a K-12 school should never see
  // "Sections", and a university should never see "Classes". Rendering the
  // wrong vocabulary is the fastest way to make a product feel like it was
  // built for somebody else.
  //
  // Empty sections are dropped rather than rendered as a bare heading — an
  // applicant would otherwise see "Finance" with nothing under it.
  const model = school.academicModel;
  const sections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter(
      (item) =>
        item.roles.includes(session.role) && (!item.models || item.models.includes(model)),
    ),
  })).filter((s) => s.items.length > 0);

  const [firstName = '', lastName = ''] = session.name.split(' ');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* A keyboard user should not have to tab through fifteen navigation
          links on every page before reaching the content. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-onAccent"
      >
        Skip to content
      </a>

      <SidebarToggle>
        <nav
          aria-label="Primary"
          className="flex h-full flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white px-3 py-4"
        >
          <Link href="/" className="mb-3 flex items-center gap-2.5 px-2">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-onAccent"
              style={{ backgroundColor: school.brandColor }}
            >
              {school.code.slice(0, 3)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight text-slate-900">
                {school.shortName}
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                {model === 'K12' ? 'Primary & secondary' : 'Higher education'}
              </span>
            </span>
          </Link>

          <div className="mb-2 px-1">
            <CommandPalette />
          </div>

          {sections.map((section) => (
            <div key={section.heading} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section.heading}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href} icon={item.icon}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-auto space-y-3 border-t border-slate-200 pt-3">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Theme
              </span>
              <ThemeToggle />
            </div>
            <div className="flex items-center gap-2.5 px-2">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-onInk"
                aria-hidden
              >
                {initials(firstName, lastName || firstName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-slate-900">
                  {session.name}
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {ROLE_LABELS[session.role]}
                </span>
              </span>
            </div>
            <div className="px-2 pb-1">
              <SignOutButton />
            </div>
          </div>
        </nav>
      </SidebarToggle>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur no-print sm:px-6">
          {/* The mobile menu button is rendered by SidebarToggle into this
              slot's leading space; the spacer keeps the title clear of it. */}
          <span className="w-9 shrink-0 lg:hidden" aria-hidden />
          <p className="truncate text-sm font-medium text-slate-500">{school.name}</p>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell items={notifications} unread={unreadCount} />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          {children}
        </main>

        <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-4 text-xs text-slate-400 sm:px-6 no-print">
          {school.name} · Signed in as {session.email}
        </footer>
      </div>
    </div>
  );
}
