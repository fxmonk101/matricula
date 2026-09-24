import type { AcademicModel, Role } from './enums';

/**
 * =============================================================================
 * NAVIGATION
 * =============================================================================
 *
 * Which pages each role is offered, as pure data.
 *
 * Separate from the shell component on purpose. This table is a PERMISSION
 * table wearing a navigation costume: a link offered to a role that cannot open
 * it lands the user on /forbidden, and a role offered nothing at all sees an
 * empty sidebar and concludes their account is broken. Both failures are
 * invisible to a typecheck and neither shows up until someone signs in as that
 * role — so the table lives here, where a test can read it without pulling in
 * React, and `tests/navigation.test.ts` checks it against `ROUTE_GUARDS`.
 *
 * `icon` is a key rather than a rendered element for the same reason: this
 * module must stay free of JSX, and the shell owns how a key becomes a glyph.
 */

export type NavIcon =
  | 'home'
  | 'people'
  | 'book'
  | 'grid'
  | 'money'
  | 'check'
  | 'team'
  | 'org'
  | 'chat'
  | 'library'
  | 'cog'
  | 'doc'
  | 'building';

export interface NavItem {
  href: string;
  label: string;
  /**
   * Roles offered this link. OWNER is deliberately NOT listed anywhere: it
   * inherits from ADMIN through `roleSatisfies`, so listing it would be a
   * second place to keep in step with the route guards.
   */
  roles: Role[];
  /** Omit to show for every academic model. */
  models?: AcademicModel[];
  icon: NavIcon;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', roles: ['ADMIN', 'REGISTRAR', 'DEAN'], icon: 'home' },
      { href: '/me', label: 'My Record', roles: ['STUDENT'], icon: 'home' },
      { href: '/portal', label: 'My Application', roles: ['APPLICANT'], icon: 'doc' },
      { href: '/family', label: 'My Children', roles: ['GUARDIAN'], icon: 'people' },
    ],
  },
  {
    heading: 'Academic',
    items: [
      { href: '/students', label: 'Students', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'ADMISSIONS', 'FINANCE', 'INSTRUCTOR'], icon: 'people' },
      { href: '/instructors', label: 'Lecturers', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD'], icon: 'people' },
      { href: '/structure', label: 'Structure', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD'], models: ['HIGHER_ED'], icon: 'org' },
      { href: '/calendar', label: 'Calendar & Fees', roles: ['ADMIN', 'REGISTRAR', 'FINANCE'], icon: 'check' },
      { href: '/courses', label: 'Courses', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT', 'ADMISSIONS'], models: ['HIGHER_ED'], icon: 'book' },
      { href: '/offerings', label: 'Sections', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT'], models: ['HIGHER_ED'], icon: 'grid' },
      { href: '/timetable', label: 'Timetable', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR', 'STUDENT'], models: ['HIGHER_ED'], icon: 'grid' },
      { href: '/classes', label: 'Classes', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'], models: ['K12'], icon: 'grid' },
      { href: '/reports', label: 'Report Cards', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'], models: ['K12'], icon: 'doc' },
      // DEAN included: deans hold sections of their own, and the page lists
      // what you actually teach — so it is empty rather than wrong for one
      // who does not. REGISTRAR is deliberately NOT offered here: they may
      // reach the pages to administer them, but they teach nothing and an
      // empty list in their sidebar would read as a fault.
      { href: '/teaching', label: 'My Teaching', roles: ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN'], icon: 'book' },
      { href: '/me/registration', label: 'Registration', roles: ['STUDENT'], icon: 'check' },
      { href: '/admissions', label: 'Admissions', roles: ['ADMIN', 'ADMISSIONS', 'REGISTRAR'], icon: 'doc' },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { href: '/finance', label: 'Bursary', roles: ['ADMIN', 'FINANCE', 'REGISTRAR'], icon: 'money' },
      { href: '/me/finance', label: 'My Fees', roles: ['STUDENT'], icon: 'money' },
    ],
  },
  {
    heading: 'Work',
    items: [
      { href: '/presence', label: 'Sign In / Out', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'], icon: 'check' },
      { href: '/presence/teaching', label: 'Teaching Log', roles: ['INSTRUCTOR', 'HOD', 'DEAN', 'ADMIN', 'REGISTRAR'], icon: 'book' },
      // A student's own courses, and a pupil's own subjects. They are separate
      // entries rather than one because they read from different roster models
      // — Enrollment for a university, ClassEnrolment for a form class — and a
      // single page branching on the academic model would be two pages sharing
      // a URL.
      { href: '/me/courses', label: 'My Courses', roles: ['STUDENT'], models: ['HIGHER_ED'], icon: 'book' },
      // And the K-12 one, which is why the comment above no longer says the
      // content layer does not serve a form class. It does now.
      { href: '/me/subjects', label: 'My Subjects', roles: ['STUDENT'], models: ['K12'], icon: 'book' },
      // Offered only to the roles that actually oversee somebody. A lecturer
      // following this to an empty table would reasonably conclude it is broken.
      { href: '/presence/team', label: 'Team Register', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD'], icon: 'team' },
      { href: '/tasks', label: 'Tasks', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF'], icon: 'check' },
      { href: '/team', label: 'My Team', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'], icon: 'team' },
      { href: '/org', label: 'Organisation', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'INSTRUCTOR'], icon: 'org' },
    ],
  },
  {
    heading: 'Community',
    items: [
      { href: '/library', label: 'Library', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'], icon: 'library' },
      { href: '/announcements', label: 'Announcements', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT', 'GUARDIAN'], icon: 'chat' },
      { href: '/forums', label: 'Forums', roles: ['ADMIN', 'REGISTRAR', 'DEAN', 'HOD', 'FINANCE', 'ADMISSIONS', 'INSTRUCTOR', 'LIBRARIAN', 'STAFF', 'STUDENT'], icon: 'chat' },
    ],
  },
  {
    heading: 'School',
    items: [
      { href: '/setup', label: 'Get Started', roles: ['ADMIN'], icon: 'check' },
      { href: '/people', label: 'People', roles: ['ADMIN', 'REGISTRAR'], icon: 'team' },
      // The way a real intake actually arrives. Offered beside People rather
      // than buried inside it, because a registry looking for it on day one
      // is looking for the words "import", not for a person.
      { href: '/people/import', label: 'Import People', roles: ['ADMIN', 'REGISTRAR'], icon: 'team' },
      { href: '/settings/school', label: 'Settings', roles: ['ADMIN'], icon: 'cog' },
      { href: '/admin/audit', label: 'Audit Log', roles: ['ADMIN'], icon: 'doc' },
    ],
  },
];

/*
 * There is deliberately NO platform section here any more.
 *
 * The vendor console moved to its own portal at /operator, with its own cookie,
 * its own sign-in page and its own shell. A school's sidebar therefore contains
 * nothing about the vendor at all — which is the point: somebody signed in to a
 * university is a member of that university and nothing else, whatever else
 * they may also be elsewhere.
 */

/**
 * The sidebar one person actually sees.
 *
 * Lives here rather than inside the shell component so that the test exercises
 * the SAME function the app renders from. A test that re-implemented this
 * filter would have gone on passing while the shell used `roles.includes` and
 * showed the school's own owner an empty sidebar.
 *
 * Empty sections are dropped rather than rendered as a bare heading — an
 * applicant would otherwise see "Finance" with nothing under it.
 */
export function visibleSections(opts: {
  role: Role;
  academicModel: AcademicModel;
  /** `roleSatisfies`, passed in so this module needs no dependency on rbac. */
  satisfies: (role: Role, allowed: readonly Role[]) => boolean;
}): NavSection[] {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          opts.satisfies(opts.role, item.roles) &&
          (!item.models || item.models.includes(opts.academicModel)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
