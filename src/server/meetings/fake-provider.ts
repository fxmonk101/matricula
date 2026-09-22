import { createHash } from 'node:crypto';

import type { MeetingProvider, MeetingRequest, MeetingResult } from './index';

/**
 * A meeting that looks real and is not.
 *
 * For tests, and for showing the product to somebody before an Azure tenant
 * exists. It mints a join URL that is obviously fake on inspection — the host
 * says so — because a demo link that looks like a genuine Teams URL is a link
 * somebody will eventually send to a class.
 *
 * DETERMINISTIC. The same request produces the same URL, so a test can assert
 * on it without stubbing a clock or a random source.
 */
export const fakeProvider: MeetingProvider = {
  name: 'fake',
  configured: true,

  async create(request: MeetingRequest): Promise<MeetingResult> {
    const fingerprint = createHash('sha256')
      .update(`${request.subject}|${request.startsAt.toISOString()}|${request.endsAt.toISOString()}`)
      .digest('hex')
      .slice(0, 16);

    return {
      ok: true,
      via: 'fake',
      externalId: `fake-${fingerprint}`,
      joinUrl: `https://meetings.invalid/not-a-real-meeting/${fingerprint}`,
      message: 'A stand-in meeting was created. No real meeting exists.',
    };
  },
};
