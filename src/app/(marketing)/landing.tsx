import Image from 'next/image';
import Link from 'next/link';

/**
 * The public landing page.
 *
 * Written for ONE reader: the registrar, bursar or vice-chancellor of a
 * university deciding whether to put their institution's records into somebody
 * else's software. That reader is not impressed by adjectives and has been
 * shown a dashboard screenshot by every vendor who came before — so the page
 * leads with the claim that is actually load-bearing (one authoritative record)
 * and then names the specific offices the product understands.
 *
 * It deliberately names NO customer. A landing page that lists the universities
 * already using the platform is the same customer register that was removed
 * from the sign-in page, wearing a testimonial.
 */

const OFFICES = [
  {
    role: 'Registrar',
    does: 'Builds the institution: faculties, departments, programmes and courses. Appoints deans and heads of department. Opens the forums the university talks on.',
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
    does: 'Enters marks, takes attendance, sees their own sections and the students in them.',
  },
  {
    role: 'Student',
    does: 'Registers for courses against the real rules, sees results and transcript, and knows exactly what is owed.',
  },
];

const CAPABILITIES = [
  {
    title: 'Admissions',
    body: 'Applications scored against a rubric you set, with reviewer disagreement surfaced rather than averaged away. Offers, acceptances and conversion to a student record.',
  },
  {
    title: 'Registration',
    body: 'Credit ceilings, prerequisites and financial holds checked at the moment of registration — not discovered at the end of the semester.',
  },
  {
    title: 'Assessment',
    body: 'Continuous assessment and examination weighted to your scheme. Grades derive from raw scores against the current scale, so a corrected mark corrects everything downstream.',
  },
  {
    title: 'Bursary',
    body: 'Fee structures, invoices, receipts and part payments in integer minor units. No floating-point money, and every document numbered so a human can quote it.',
  },
  {
    title: 'Timetable',
    body: 'A weekly grid built by the faculty that owns it, with teacher, room and class-group clashes refused as they are made.',
  },
  {
    title: 'Records',
    body: 'Transcripts, grade sheets and statements that print. An append-only audit trail behind every state change, attributable to the officer who made it.',
  },
];

export function Landing() {
  return (
    <div className="bg-white">
      {/* ---------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-[11px] font-bold text-onInk">
              SP
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              School Portal
            </span>
          </Link>

          <div className="flex items-center gap-1.5">
            <Link
              href="/apply"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 sm:block"
            >
              Apply for admission
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-onInk transition hover:bg-slate-800"
            >
              Sign in
            </Link>
          </div>
        </nav>
      </header>

      {/* -------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-slate-200/70">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-100">
              For universities
            </p>

            <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.08] tracking-tight text-slate-900 sm:text-[3.25rem]">
              One record for every student, from application to graduation.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
              Admissions, registration, assessment and the bursary run on a single authoritative
              record — so a grade, a fee and a transcript can never disagree about the same person.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-onAccent shadow-sm transition hover:bg-brand-700 hover:shadow"
              >
                Sign in to your institution
              </Link>
              <Link
                href="/apply"
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 hover:ring-slate-400"
              >
                Apply for admission
              </Link>
            </div>

            <p className="mt-5 text-xs text-slate-500">
              Each institution gets its own portal, its own address and its own branding. No
              university on this platform can see another.
            </p>
          </div>

          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/5">
              <Image
                src="/images/landing-hero.jpg"
                alt="A university campus seen from above"
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                priority
                className="object-cover"
              />
            </div>

            {/* A small, concrete claim floated over the photograph. Numbers a
                registrar recognises beat an abstract feature list. */}
            <div className="absolute -bottom-5 -left-5 hidden rounded-xl bg-white px-4 py-3 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 sm:block">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Built around</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                Faculty → Department → Programme
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- the actual problem */}
      <section className="border-b border-slate-200/70 bg-slate-50/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Most university software is four systems that disagree.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Admissions keeps a spreadsheet. The registry keeps another. The bursary keeps a third,
              and the department keeps the one that actually has the marks in it. Then a student
              graduates with a transcript nobody can reconcile against the fees they paid.
            </p>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              This is one system. A grade is derived from the raw scores against the scale in force.
              A fee statement is derived from the invoices raised. A transcript is derived from the
              enrolments that were actually registered. Nothing is typed twice, so nothing can
              disagree.
            </p>
          </div>

          <dl className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((item) => (
              <div key={item.title}>
                <dt className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden />
                  {item.title}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------ offices */}
      <section className="border-b border-slate-200/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                It knows who does what.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Not a single &ldquo;admin&rdquo; account that everybody shares the password to. The
                offices a university actually has, each seeing their own work — and the reporting
                line between them.
              </p>

              <div className="mt-6 rounded-xl bg-slate-50 px-5 py-4 ring-1 ring-inset ring-slate-200">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  The reporting line
                </p>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-slate-800">
                  Student → Lecturer → Head of Department → Dean → Registrar
                </p>
              </div>

              <div className="relative mt-8 hidden aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-900/5 lg:block">
                <Image
                  src="/images/landing-grad.jpg"
                  alt="A graduate in cap and gown"
                  fill
                  sizes="40vw"
                  className="object-cover"
                />
              </div>
            </div>

            <ul className="space-y-1">
              {OFFICES.map((office) => (
                <li
                  key={office.role}
                  className="rounded-xl px-4 py-4 transition hover:bg-slate-50"
                >
                  <p className="text-sm font-semibold text-slate-900">{office.role}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{office.does}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- isolation */}
      <section className="border-b border-slate-200/70 bg-ink text-onInk">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:py-20">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Your institution&rsquo;s portal is yours.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-300">
              Your own sign-in address, your own crest and colours, your own data. Every record in
              the system carries the institution it belongs to, enforced at the database layer
              rather than remembered by each page — so one university cannot read another&rsquo;s
              students even if a link is forwarded or a URL is edited.
            </p>

            <ul className="mt-8 space-y-3">
              {[
                'A dedicated sign-in address for each institution',
                'Your crest, your colours, on every page and document',
                'Nothing on the platform names any other institution',
                'Every state change written to an append-only audit trail',
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
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/10">
              <Image
                src="/images/landing-study.jpg"
                alt="A student working on a laptop"
                fill
                sizes="(min-width: 1024px) 24vw, 45vw"
                className="object-cover"
              />
            </div>
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/10 sm:mt-10">
              <Image
                src="/images/landing-quad.jpg"
                alt="A university quadrangle"
                fill
                sizes="(min-width: 1024px) 24vw, 45vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cta */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 px-8 py-12 text-center shadow-lg shadow-brand-900/10 sm:px-12">
            <h2 className="text-2xl font-semibold tracking-tight text-onAccent sm:text-3xl">
              Already have an account?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-onAccent/85">
              Sign in with the credentials your registry or faculty issued. If your institution has
              given you its own address, go there directly.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-brand-700 shadow-sm transition hover:bg-slate-50"
              >
                Sign in
              </Link>
              <Link
                href="/apply"
                className="rounded-xl px-5 py-3 text-sm font-medium text-onAccent ring-1 ring-inset ring-white/40 transition hover:bg-white/10"
              >
                Apply for admission
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- footer */}
      <footer className="border-t border-slate-200/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[10px] font-bold text-onInk">
              SP
            </span>
            <span className="text-xs text-slate-500">
              School Portal — student information, admissions and finance
            </span>
          </div>
          <p className="text-xs text-slate-400">Authorised users only. All access is logged.</p>
        </div>
      </footer>
    </div>
  );
}
