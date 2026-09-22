/**
 * Content-Security-Policy notes
 * -----------------------------
 * Forums make this necessary rather than merely good practice: from Phase 4
 * onwards one user's text is rendered in another user's browser. The renderer
 * in `src/lib/domain/markdown.ts` is the primary defence — it escapes before it
 * transforms, so user input cannot become markup. CSP is the second line, for
 * the day a bug gets past the first.
 *
 * `'unsafe-inline'` on script-src is present and NOT accidental. Next.js App
 * Router streams RSC payloads and its bootstrap through inline `<script>` tags,
 * and removing it breaks hydration outright. The correct fix is per-request
 * nonces, which means generating one in middleware and threading it through the
 * document — worth doing, but it is a change to every rendered page rather than
 * a config line, so it is recorded here as owed rather than pretended away.
 *
 * What this policy DOES buy, today:
 *
 *   - `object-src 'none'` kills <object>/<embed> plugin vectors outright.
 *   - `base-uri 'self'` stops an injected <base> rewriting every relative URL
 *     on the page to an attacker's origin.
 *   - `form-action 'self'` stops an injected form posting credentials offsite.
 *   - `frame-ancestors 'none'` blocks clickjacking (and supersedes the older
 *     X-Frame-Options header, which is kept for ancient browsers).
 *   - `connect-src 'self'` means injected script cannot exfiltrate to a remote
 *     endpoint — which removes most of the value of an XSS even if one lands.
 *
 * In development the policy is relaxed: the dev server needs `'unsafe-eval'`
 * for React Fast Refresh and a websocket for HMR. Shipping those to production
 * would be a real weakening, so the split is explicit.
 */
const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // Tailwind injects styles at build time, but styled-jsx and inline style
  // attributes (school brand colours) need this.
  "style-src 'self' 'unsafe-inline'",
  // data: for inlined icons; blob: for anything generated client-side.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  // Nothing in this app is framed, and no plugin content is loaded.
  "child-src 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

/*
 * Build output directory
 * ----------------------
 * `next dev` and `next build` both own `.next`, and a build run while a dev
 * server is up DELETES the assets that server is still serving. The dev server
 * keeps answering, so the failure does not look like what it is: the page loads
 * with every stylesheet and script 404ing — unstyled HTML — and server actions
 * fail in confusing ways.
 *
 * That happened here, and reached the user as "the app displays raw HTML".
 * `npm run verify` therefore sets NEXT_DIST_DIR so a correctness build writes
 * somewhere else entirely and cannot touch a running dev server.
 */
const distDir = process.env.NEXT_DIST_DIR || '.next';

/*
 * The upload ceiling, in megabytes.
 *
 * Kept here rather than imported because a Next config is plain JavaScript
 * loaded before the TypeScript pipeline exists. The duplication is real, so
 * it is guarded by a test rather than by hope: `tests/upload-limits.test.ts`
 * reads both this file and `src/lib/domain/upload.ts` and fails if this
 * number ever drops below what the upload code promises to accept.
 *
 * A NOTE FOR SERVERLESS HOSTS. Raising this does not raise a platform's own
 * request limit. Vercel caps a serverless function request body at about
 * 4.5 MB and returns 413 before any of this runs, so a deployment there
 * either lowers SUBMISSION_LIMITS to match and tells students the truth, or
 * uploads bypass the server action and go straight to object storage with a
 * presigned URL. Setting a bigger number here changes nothing about that.
 */
const UPLOAD_CEILING_MB = 24;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    /*
     * How large a server action request may be.
     *
     * THIS IS THE CEILING ON EVERY UPLOAD, and it is not the one the upload
     * code enforces. It sat at 2 MB while `SUBMISSION_LIMITS` in
     * `src/lib/domain/upload.ts` allowed 20 MB and the hand-in form told
     * students so. A 3 MB dissertation was accepted by the form, validated
     * happily by the service in a test, and rejected by the framework in
     * between — the one layer with no error message of its own.
     *
     * So it is derived from that constant plus headroom for the multipart
     * envelope, and `tests/upload-limits.test.ts` fails if the two drift
     * apart again.
     */
    serverActions: { bodySizeLimit: `${UPLOAD_CEILING_MB}mb` },
  },
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Superseded by frame-ancestors above, kept for older browsers.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // A student record system should never be a search result.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
