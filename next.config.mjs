/**
 * Content-Security-Policy
 * -----------------------
 * THE POLICY NOW LIVES IN `src/middleware.ts`, not here.
 *
 * It had to move because the useful version carries a per-request nonce, and
 * a header configured in this file is the same bytes for every response —
 * which is the definition of a nonce that is not one.
 *
 * What that bought: `script-src 'unsafe-inline'` is gone. It was noted here as
 * owed rather than pretended away, and it mattered because forums, module
 * pages and announcements render one person's text in another person's
 * browser. The markdown renderer escapes before it transforms, so user input
 * cannot become markup — but CSP is the second line for the day a bug gets
 * past the first, and with 'unsafe-inline' that second line did nothing.
 *
 * Deliberately NOT duplicated here. Two policies on one response means the
 * browser enforces the INTERSECTION, and a stale copy in this file would
 * silently block the nonced scripts the middleware just allowed.
 *
 * The headers below are the ones that do not vary per request.
 */

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
