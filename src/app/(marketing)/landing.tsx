import Image from 'next/image';
import Link from 'next/link';

import { Logo, LogoMark } from '@/components/logo';
import { Reveal, RevealGroup, StickyNav } from '@/components/motion';

/**
 * The public landing page.
 *
 * THIS IS A SCHOOL MANAGEMENT SYSTEM, sold to institutions. The reader is the
 * vice-chancellor, registrar or bursar deciding whether to run their university
 * on it — not a prospective student looking for somewhere to apply.
 *
 * That distinction drives the whole page. An applicant never arrives here: they
 * go to their chosen institution's own portal, which is the only place an
 * application can be made. So "apply" is a FEATURE the university operates, not
 * a call to action on this page, and it appears once, in the footer, for the
 * person who has landed in the wrong place.
 *
 * It names NO customer. A landing page listing the universities already on the
 * platform is the customer register that was removed from the sign-in page,
 * wearing a testimonial.
 */

/** What the institution actually operates. Framed as offices, not screens. */
const MODULES = [
  {
    title: 'Academic structure',
    body: 'Faculties, departments, programmes and courses, built and owned by the registry. Everything else in the system hangs off it.',
  },
  {
    title: 'Staff and students',
    body: 'Accounts issued by the office that should issue them, with the real reporting line behind them — and a suspension that stops access without destroying a record.',
  },
  {
    title: 'Admissions',
    body: 'Applications scored against a rubric the institution sets, with reviewer disagreement surfaced rather than averaged away.',
  },
  {
    title: 'Registration and results',
    body: 'Credit ceilings, prerequisites and financial holds enforced when a student registers. Grades derive from raw scores, so a corrected mark corrects everything downstream.',
  },
  {
    title: 'Bursary',
    body: 'Fee structures, invoices, receipts and part payments in integer minor units. No floating-point money, and every document numbered so a bursar can quote it.',
  },
  {
    title: 'Timetabling',
    body: 'A weekly grid built by the faculty that owns it, with teacher, room and class-group clashes refused as they are made rather than found in week three.',
  },
];

/** The offices. This section is only honest because the role model is real. */
const OFFICES = [
  {
    role: 'Registrar',
    does: 'Builds the institution — faculties, departments, programmes, courses. Appoints deans and heads of department. Opens the forums the university talks on.',
  },
  {
    role: 'Dean',
    does: 'Owns the faculty timetable and decides who teaches what. Sees their faculty’s students and results, and nothing from anyone else’s.',
  },
  {
    role: 'Head of Department',
    does: 'Assigns teaching within the department and lectures alongside it — because in a real university the same person does both.',
  },
  {
    role: 'Bursar',
    does: 'Registers students and runs the fee ledger. Registration completes where the fees are settled, which is how it already works.',
  },
  {
    role: 'Lecturer',
    does: 'Enters marks, records attendance, sees their own sections and the students in them.',
  },
  {
    role: 'Student',
    does: 'Registers against the real rules, sees results and transcript, and knows exactly what is owed.',
  },
];

export function Landing() {
  return (
    <div className="bg-white">
      {/* ---------------------------------------------------------------- nav */}
      <StickyNav>
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link
            href="/"
            className="text-slate-900 transition-opacity hover:opacity-80"
            aria-label="Matricula — home"
          >
            <Logo compact className="text-slate-900" />
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="#offices"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:block"
            >
              Who it is for
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-onInk transition-all duration-200 hover:bg-slate-800 hover:shadow-md hover:shadow-slate-900/10 active:translate-y-px"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </StickyNav>

      {/* -------------------------------------------------------------- hero */}
      <section className="relative -mt-[57px] overflow-hidden pt-[57px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(60rem_28rem_at_15%_-10%,theme(colors.brand.50),transparent_65%)]"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <Reveal>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-brand-700 shadow-sm ring-1 ring-inset ring-brand-100 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
                School management, for universities
              </p>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-[3.25rem]">
                Run the whole institution on one system.
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
                The registry, the faculties, the departments and the bursary working from the same
                records — so nothing is entered twice, and a grade, a fee and a transcript can never
                disagree about the same person.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="group rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-onAccent shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-600/20 active:translate-y-0"
                >
                  Sign in to your institution
                  <span
                    className="ml-1.5 inline-block transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  >
                    →
                  </span>
                </Link>
                <Link
                  href="#modules"
                  className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md hover:ring-slate-400 active:translate-y-0"
                >
                  See what it manages
                </Link>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <p className="mt-5 text-xs leading-relaxed text-slate-500">
                Each institution runs on its own portal, with its own address, branding and data. No
                university on this platform can see another.
              </p>
            </Reveal>
          </div>

          <Reveal delay={200} direction="left">
            <div className="relative">
              <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/5">
                <Image
                  src="/images/landing-hero.jpg"
                  alt="A university campus seen from above"
                  fill
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  priority
                  className="object-cover transition-transform duration-[1.2s] ease-out-quart group-hover:scale-[1.03]"
                />
              </div>

              <div className="absolute -bottom-5 -left-5 hidden rounded-xl bg-white px-4 py-3 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 transition-transform duration-300 hover:-translate-y-1 sm:block">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Built around</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                  Faculty → Department → Programme
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------- what it replaces */}
      <section className="border-y border-slate-200/70 bg-slate-50/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <Reveal>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Most universities are run by four systems that disagree.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Admissions keeps a spreadsheet. The registry keeps another. The bursary keeps a
                third, and the department keeps the one that actually has the marks in it. Then a
                student graduates with a transcript nobody can reconcile against the fees they paid,
                and somebody spends a fortnight finding out which copy was right.
              </p>
              <p className="mt-3 text-base leading-relaxed text-slate-600">
                This is one system. Nothing is entered twice, so nothing can disagree.
              </p>
            </div>
          </Reveal>

          <div id="modules" className="scroll-mt-24" />

          <RevealGroup
            as="dl"
            step={70}
            className="mt-12 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {MODULES.map((item) => (
              <div
                key={item.title}
                className="h-full rounded-xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:shadow-slate-900/5 hover:ring-1 hover:ring-slate-900/5"
              >
                <dt className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
                  {item.title}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</dd>
              </div>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ------------------------------------------------------------ offices */}
      <section id="offices" className="scroll-mt-16 border-b border-slate-200/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <Reveal>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                  It already knows how a university is run.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-slate-600">
                  Not one &ldquo;admin&rdquo; account that the whole office shares the password to.
                  The offices a university actually has, each with the authority that office
                  actually holds — and the reporting line between them.
                </p>
              </Reveal>

              <Reveal delay={120}>
                <div className="mt-6 rounded-xl bg-slate-50 px-5 py-4 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    The reporting line
                  </p>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-800">
                    Student → Lecturer → Head of Department → Dean → Registrar
                  </p>
                </div>
              </Reveal>

              <Reveal delay={200}>
                <div className="group relative mt-8 hidden aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5 lg:block">
                  <Image
                    src="/images/landing-quad.jpg"
                    alt="A university quadrangle"
                    fill
                    sizes="40vw"
                    className="object-cover transition-transform duration-[1.2s] ease-out-quart group-hover:scale-[1.04]"
                  />
                </div>
              </Reveal>
            </div>

            <RevealGroup as="ul" step={60} className="space-y-1">
              {OFFICES.map((office) => (
                <li
                  key={office.role}
                  className="group rounded-xl px-4 py-4 transition-colors duration-200 hover:bg-slate-50"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span
                      className="h-4 w-0.5 rounded-full bg-slate-200 transition-colors duration-200 group-hover:bg-brand-500"
                      aria-hidden
                    />
                    {office.role}
                  </p>
                  <p className="mt-1 pl-4 text-sm leading-relaxed text-slate-600">{office.does}</p>
                </li>
              ))}
            </RevealGroup>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- isolation */}
      <section className="relative overflow-hidden border-b border-slate-200/70 bg-ink text-onInk">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_80%_0%,theme(colors.brand.600/0.25),transparent_60%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:py-20">
          <div>
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Your institution&rsquo;s system is yours.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-300">
                Your own address, your own crest and colours, your own data. Every record carries
                the institution it belongs to, enforced at the database layer rather than remembered
                by each page — so one university cannot read another&rsquo;s students even if a link
                is forwarded or a URL is edited.
              </p>
            </Reveal>

            <RevealGroup as="ul" step={70} className="mt-8 space-y-3">
              {[
                'A dedicated address for each institution',
                'Your crest and colours on every page and printed document',
                'Nothing on the platform names any other institution',
                'Every state change written to an append-only audit trail',
                'Set up your faculties, staff and intake in an afternoon',
              ].map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm text-slate-200">
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-400"
                    aria-hidden
                  >
                    <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm3.7 6.2-4.2 4.2a1 1 0 0 1-1.4 0L6 10.5A1 1 0 1 1 7.4 9l1.4 1.4 3.5-3.5a1 1 0 1 1 1.4 1.4Z" />
                  </svg>
                  {line}
                </li>
              ))}
            </RevealGroup>
          </div>

          <Reveal delay={150} direction="left">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/10">
                <Image
                  src="/images/landing-study.jpg"
                  alt="A member of staff working at a laptop"
                  fill
                  sizes="(min-width: 1024px) 24vw, 45vw"
                  className="object-cover transition-transform duration-[1.2s] ease-out-quart group-hover:scale-[1.05]"
                />
              </div>
              <div className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/10 sm:mt-10">
                <Image
                  src="/images/landing-grad.jpg"
                  alt="A graduate in cap and gown"
                  fill
                  sizes="(min-width: 1024px) 24vw, 45vw"
                  className="object-cover transition-transform duration-[1.2s] ease-out-quart group-hover:scale-[1.05]"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 px-8 py-12 text-center shadow-lg shadow-brand-900/10 sm:px-12">
              <LogoMark tone="ink" className="mx-auto h-10 opacity-90" />
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-onAccent sm:text-3xl">
                Bring your institution onto one system.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-onAccent/85">
                Universities are set up by arrangement — we provision your institution, hand the
                first account to your registrar, and they build the rest.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/login"
                  className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-brand-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
                >
                  Sign in
                </Link>
                <a
                  href="mailto:hello@example.com?subject=Matricula%20for%20our%20institution"
                  className="rounded-xl px-5 py-3 text-sm font-medium text-onAccent ring-1 ring-inset ring-white/40 transition-all duration-200 hover:bg-white/10 hover:ring-white/60"
                >
                  Talk to us
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------- footer */}
      <footer className="border-t border-slate-200/70">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo
              compact
              className="text-slate-900"
              tagline="School management for universities"
            />
            <p className="text-xs text-slate-400">Authorised users only. All access is logged.</p>
          </div>

          {/*
            The only mention of applying on the whole page, and it is a
            signpost rather than a call to action. An applicant cannot apply
            HERE — applications are made on the institution's own portal, which
            is the only place that knows its programmes and its deadlines.
          */}
          <p className="mt-6 border-t border-slate-200/70 pt-6 text-xs leading-relaxed text-slate-500">
            Applying to a university that uses Matricula? Applications are made on your
            institution&rsquo;s own portal — use the address they gave you, or{' '}
            <Link href="/login" className="font-medium text-brand-700 hover:underline">
              find your institution
            </Link>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
