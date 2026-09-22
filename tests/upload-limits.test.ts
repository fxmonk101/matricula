import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_LIMITS, LOGO_LIMITS, SUBMISSION_LIMITS } from '@/lib/domain/upload';

/*
 * The limit the framework enforces vs. the limit the code believes in.
 *
 * These were 2 MB and 20 MB respectively, and nothing failed: every unit test
 * passed, the service accepted a 3 MB file when called directly, and the form
 * told students 20 MB was fine. The rejection happened in the server-action
 * transport, above the application and below the UI — the one layer with no
 * error message of its own and no test looking at it.
 *
 * So this file reads the actual config text. Importing next.config.mjs would be
 * neater and would also evaluate a module that expects the Next build
 * environment; the number is what matters, and reading it is enough.
 */

const config = readFileSync('next.config.mjs', 'utf8');

function bodySizeLimitBytes(): number {
  const ceiling = config.match(/const UPLOAD_CEILING_MB = (\d+);/);
  expect(ceiling, 'UPLOAD_CEILING_MB has been renamed or removed').not.toBeNull();

  // And prove the constant is the one actually handed to Next, rather than a
  // leftover that no longer feeds anything.
  expect(config).toMatch(/bodySizeLimit: `\$\{UPLOAD_CEILING_MB\}mb`/);

  return Number(ceiling![1]) * 1024 * 1024;
}

describe('the server action body limit', () => {
  it('is at least as large as the biggest upload the app accepts', () => {
    const limit = bodySizeLimitBytes();
    const largest = Math.max(
      SUBMISSION_LIMITS.maxBytes,
      DOCUMENT_LIMITS.maxBytes,
      LOGO_LIMITS.maxBytes,
    );

    expect(
      limit,
      `next.config.mjs allows ${limit} bytes but the app accepts files up to ${largest}. ` +
        'Anything in between is refused by the framework before validation runs, ' +
        'with no message a user can act on.',
    ).toBeGreaterThanOrEqual(largest);
  });

  it('leaves headroom for the multipart envelope', () => {
    /*
     * A multipart body is larger than the file inside it: part headers, the
     * boundary, and the other form fields. A limit set exactly to the file size
     * rejects a file of exactly the permitted size, which is the most confusing
     * possible failure — the number on screen and the number enforced agree,
     * and it still will not go.
     */
    const limit = bodySizeLimitBytes();
    expect(limit).toBeGreaterThanOrEqual(SUBMISSION_LIMITS.maxBytes + 1024 * 1024);
  });
});
