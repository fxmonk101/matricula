import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { schoolAcceptsSignIn } from '@/lib/domain/enums';
import { platformDb } from '@/lib/tenant';
import { LoginForm } from '@/app/(auth)/login/login-form';

/**
 * A school's own front door.
 *
 * THIS IS THE PAGE THAT MATTERS for tenant isolation. It carries the
 * institution's name, crest and colours and mentions no other school on the
 * platform — a person signing in to Golden Eagles has no way to learn that
 * Meridian exists, which is exactly what each institution is paying for.
 *
 * A school that is suspended or still being set up 404s rather than explaining
 * itself. "This school is suspended" tells an outsider that the school is a
 * customer and is in arrears, which is the school's business and not a
 * visitor's.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const school = await platformDb.school.findUnique({
    where: { slug },
    select: { name: true, status: true },
  });
  if (!school || !schoolAcceptsSignIn(school.status)) return { title: 'Sign in' };
  // The browser tab carries the institution, not the platform.
  return { title: `Sign in · ${school.name}` };
}

export default async function SchoolLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { slug } = await params;
  const { next } = await searchParams;

  const school = await platformDb.school.findUnique({
    where: { slug },
    select: {
      name: true,
      shortName: true,
      code: true,
      brandColor: true,
      logoUrl: true,
      status: true,
      academicModel: true,
    },
  });
  if (!school || !schoolAcceptsSignIn(school.status)) notFound();

  const isUniversity = school.academicModel === 'HIGHER_ED';

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* The institution's panel. Its colour, its crest, its name. */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-onAccent lg:flex"
        style={{ backgroundColor: school.brandColor }}
      >
        <Image
          src="/images/campus-hero.jpg"
          alt=""
          fill
          sizes="55vw"
          priority
          className="absolute inset-0 object-cover opacity-25 mix-blend-luminosity"
        />
        {/* The brand colour has to win over the photograph, or the text sits on
            whatever grey the image happens to have there. */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${school.brandColor}f2 0%, ${school.brandColor}d9 55%, ${school.brandColor}b3 100%)`,
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3.5">
          <SchoolCrest
            logoUrl={school.logoUrl}
            code={school.code}
            name={school.name}
            className="h-12 w-12"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{school.name}</p>
            <p className="text-[11px] text-onAccent/70">
              {isUniversity ? 'Student Information System' : 'School Portal'}
            </p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-[2.5rem] font-semibold leading-[1.1] tracking-tight">
            One system for the whole institution.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-onAccent/85">
            Admissions, the registry, teaching and the bursary working from the same records —
            so a grade, a fee and a transcript can never disagree about the same person.
          </p>
        </div>

        <p className="relative text-xs text-onAccent/70">
          Authorised users only. All access is logged.
        </p>
      </div>

      <div className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <SchoolCrest
              logoUrl={school.logoUrl}
              code={school.code}
              name={school.name}
              className="h-11 w-11"
              fallbackColor={school.brandColor}
            />
            <span className="text-sm font-semibold text-slate-900">{school.shortName}</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Sign in to {school.shortName}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Use the credentials issued by your {isUniversity ? 'faculty or the registry' : 'school office'}.
          </p>

          {/*
            A school still being provisioned admits its OWNER and nobody else.
            Saying so on the form matters: without it a teacher who was given
            the link early gets a generic credential failure and spends the
            afternoon convinced they have the wrong password.
          */}
          {school.status === 'PROVISIONING' && (
            <div className="mt-5 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
              <span className="font-medium">This school is still being set up.</span> Only the
              owner account can sign in until the setup is finished. If you are staff or a
              student here, your account will work once the school goes live.
            </div>
          )}

          <div className="mt-7">
            <LoginForm next={next} schoolSlug={slug} />
          </div>

          <p className="mt-7 border-t border-slate-200 pt-5 text-center text-xs text-slate-500">
            Applying for admission?{' '}
            <Link href={`/s/${slug}/apply`} className="font-medium text-brand-700 hover:underline">
              Start an application
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The school's crest, falling back to its document prefix.
 *
 * A school that has not uploaded a logo still needs to look like itself rather
 * than like a placeholder, so the fallback is its own code in its own colour —
 * which is recognisable, and which every school has from the moment it is
 * provisioned.
 */
function SchoolCrest({
  logoUrl,
  code,
  name,
  className,
  fallbackColor,
}: {
  logoUrl: string | null;
  code: string;
  name: string;
  className: string;
  fallbackColor?: string;
}) {
  /*
   * SAME-ORIGIN LOGOS ONLY, and this is not decoration.
   *
   * `logoUrl` is a free-text column that predates file upload, so it can hold
   * anything a school typed. An external URL fails twice over: `next/image`
   * throws unless the host is in `images.remotePatterns`, and the CSP allows
   * `img-src 'self'` so the browser would refuse it regardless. Between them
   * that turns one bad value into a school unable to reach its own login page.
   *
   * An uploaded logo is served from `/files/public/…` on this origin, so the
   * real case passes. Anything else falls back to the crest below, which is
   * always correct and always available.
   */
  const usable = logoUrl && logoUrl.startsWith('/') && !logoUrl.startsWith('//') ? logoUrl : null;

  if (usable) {
    return (
      <span
        className={`relative shrink-0 overflow-hidden rounded-xl bg-white/95 ${className}`}
      >
        <Image src={usable} alt={name} fill sizes="48px" className="object-contain p-1.5" />
      </span>
    );
  }
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl text-sm font-bold text-onAccent ${className} ${fallbackColor ? '' : 'bg-white/15 backdrop-blur-sm'}`}
      style={fallbackColor ? { backgroundColor: fallbackColor } : undefined}
    >
      {code.slice(0, 3)}
    </span>
  );
}
