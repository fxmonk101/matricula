import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_CLASS_MINUTES,
  TIMING_LABELS,
  classTiming,
  startsIn,
  validateVirtualClass,
} from '@/lib/domain/lms';
import {
  __setMeetingProvider,
  allProviders,
  automaticProvidersAvailable,
  meetingProvider,
} from '@/server/meetings';
import { __clearGraphToken, __setGraphTransport, graphProvider } from '@/server/meetings/graph-provider';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const IN_AN_HOUR = new Date('2026-09-22T13:00:00.000Z');
const IN_TWO_HOURS = new Date('2026-09-22T14:00:00.000Z');

const good = {
  title: 'Week 3 lecture',
  provider: 'MANUAL',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  startsAt: IN_AN_HOUR,
  endsAt: IN_TWO_HOURS,
};

describe('scheduling a class', () => {
  it('accepts an ordinary one', () => {
    expect(validateVirtualClass(good, NOW)).toEqual([]);
  });

  it('requires a title and both times', () => {
    expect(validateVirtualClass({ ...good, title: '  ' }, NOW).join(' ')).toMatch(/title/);
    expect(validateVirtualClass({ ...good, startsAt: null }, NOW).join(' ')).toMatch(/when the class starts/);
    expect(validateVirtualClass({ ...good, endsAt: null }, NOW).join(' ')).toMatch(/when the class ends/);
  });

  it('refuses a class that ends before it starts', () => {
    expect(
      validateVirtualClass({ ...good, startsAt: IN_TWO_HOURS, endsAt: IN_AN_HOUR }, NOW).join(' '),
    ).toMatch(/end after it starts/);
  });

  it('catches a mistyped end time', () => {
    const tooLong = new Date(IN_AN_HOUR.getTime() + (MAX_CLASS_MINUTES + 60) * 60_000);
    expect(validateVirtualClass({ ...good, endsAt: tooLong }, NOW).join(' ')).toMatch(/four hours/);

    const tooShort = new Date(IN_AN_HOUR.getTime() + 60_000);
    expect(validateVirtualClass({ ...good, endsAt: tooShort }, NOW).join(' ')).toMatch(/five minutes/);
  });

  it('ALLOWS a class in the recent past', () => {
    /*
     * Recording a session that already happened, so its link sits with the
     * right week, is something teachers genuinely do.
     */
    const yesterday = new Date('2026-09-21T09:00:00Z');
    const yesterdayEnd = new Date('2026-09-21T10:00:00Z');
    expect(
      validateVirtualClass({ ...good, startsAt: yesterday, endsAt: yesterdayEnd }, NOW),
    ).toEqual([]);
  });

  it('questions a date a year back', () => {
    const old = new Date('2024-09-22T09:00:00Z');
    const oldEnd = new Date('2024-09-22T10:00:00Z');
    expect(validateVirtualClass({ ...good, startsAt: old, endsAt: oldEnd }, NOW).join(' ')).toMatch(
      /Check the year/,
    );
  });

  it('requires a link for a pasted class, and refuses a dangerous one', () => {
    expect(validateVirtualClass({ ...good, joinUrl: '' }, NOW).join(' ')).toMatch(/Paste the link/);
    expect(
      validateVirtualClass({ ...good, joinUrl: 'javascript:alert(1)' }, NOW).join(' '),
    ).toMatch(/http and https/);
  });

  it('does not demand a link for a provider that makes its own', () => {
    // Teams is told the meeting; it is not given one.
    expect(validateVirtualClass({ ...good, provider: 'TEAMS', joinUrl: null }, NOW)).toEqual([]);
  });

  it('refuses a provider it does not know', () => {
    expect(validateVirtualClass({ ...good, provider: 'SKYPE' }, NOW).join(' ')).toMatch(
      /where the class will be held/,
    );
  });
});

describe('where a class sits in time', () => {
  it('is upcoming, live, then finished', () => {
    expect(classTiming(IN_AN_HOUR, IN_TWO_HOURS, NOW)).toBe('UPCOMING');
    expect(classTiming(IN_AN_HOUR, IN_TWO_HOURS, new Date('2026-09-22T13:30:00Z'))).toBe('LIVE');
    expect(classTiming(IN_AN_HOUR, IN_TWO_HOURS, new Date('2026-09-22T15:00:00Z'))).toBe('FINISHED');
  });

  it('counts the boundaries as live rather than missed', () => {
    // A student arriving exactly on the hour should be able to join.
    expect(classTiming(IN_AN_HOUR, IN_TWO_HOURS, IN_AN_HOUR)).toBe('LIVE');
    expect(classTiming(IN_AN_HOUR, IN_TWO_HOURS, IN_TWO_HOURS)).toBe('LIVE');
  });

  it('says "Live now" rather than counting up from the start', () => {
    // Somebody looking at a class that has begun needs to join it, not to be
    // told it started nine minutes ago.
    expect(startsIn(IN_AN_HOUR, IN_TWO_HOURS, new Date('2026-09-22T13:09:00Z'))).toBe('Live now');
  });

  it('counts down in sensible units', () => {
    // Exactly an hour reads as an hour, not sixty minutes.
    expect(startsIn(IN_AN_HOUR, IN_TWO_HOURS, NOW)).toBe('Starts in 1 hour');
    expect(startsIn(new Date('2026-09-22T12:30:00Z'), new Date('2026-09-22T13:30:00Z'), NOW)).toBe(
      'Starts in 30 minutes',
    );
    expect(startsIn(new Date('2026-09-25T12:00:00Z'), new Date('2026-09-25T13:00:00Z'), NOW)).toBe(
      'Starts in 3 days',
    );
  });

  it('has a label for every timing', () => {
    for (const key of Object.keys(TIMING_LABELS)) {
      expect(TIMING_LABELS[key as keyof typeof TIMING_LABELS]).toBeTruthy();
    }
  });
});

describe('choosing a provider', () => {
  afterEach(() => __setMeetingProvider(null));

  it('always has MANUAL available, with nothing to configure', () => {
    // The property that makes this sellable to a school with no Microsoft 365.
    expect(allProviders().MANUAL.configured).toBe(true);
    expect(meetingProvider('MANUAL').name).toBe('manual');
  });

  it('FALLS BACK TO MANUAL rather than throwing on an unknown provider', () => {
    // A configuration mistake must not take down the page; pasting a link is a
    // perfectly good answer.
    expect(meetingProvider('SKYPE').name).toBe('manual');
  });

  it('falls back to MANUAL when Teams is not configured here', () => {
    expect(graphProvider.configured).toBe(false);
    expect(meetingProvider('TEAMS').name).toBe('manual');
  });

  it('reports honestly that no automatic provider is available', () => {
    /*
     * The UI asks this so it can tell the truth. Offering "Microsoft Teams" on
     * a deployment with no Azure app is a promise the product cannot keep.
     */
    expect(automaticProvidersAvailable()).toEqual([]);
  });

  it('can be replaced wholesale for a test', () => {
    __setMeetingProvider({
      name: 'stub',
      configured: true,
      async create() {
        return { ok: true, via: 'stub', joinUrl: 'https://example.test/x' };
      },
    });
    expect(meetingProvider('TEAMS').name).toBe('stub');
  });
});

describe('the fake provider', () => {
  it('is deterministic, so a test can assert on its link', async () => {
    const request = {
      subject: 'Week 3',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
    };
    const a = await allProviders().FAKE.create(request);
    const b = await allProviders().FAKE.create(request);
    expect(a.joinUrl).toBe(b.joinUrl);
  });

  it('mints a link that is OBVIOUSLY not real', async () => {
    // A demo link that looks like a genuine Teams URL is one somebody
    // eventually sends to a class.
    const result = await allProviders().FAKE.create({
      subject: 'Week 3',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
    });
    expect(result.joinUrl).toContain('.invalid');
    expect(result.joinUrl).not.toContain('teams.microsoft.com');
  });
});

describe('the Microsoft Graph driver', () => {
  const ENV = { ...process.env };

  beforeEach(() => {
    process.env.AZURE_TENANT_ID = 'tenant-abc';
    process.env.AZURE_CLIENT_ID = 'client-abc';
    process.env.AZURE_CLIENT_SECRET = 'secret-abc';
    __clearGraphToken();
  });

  afterEach(() => {
    process.env = { ...ENV };
    __setGraphTransport(null);
    __clearGraphToken();
  });

  function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers });
  }

  it('is configured once the three variables are present', () => {
    expect(graphProvider.configured).toBe(true);
    delete process.env.AZURE_CLIENT_SECRET;
    expect(graphProvider.configured).toBe(false);
  });

  it('gets a token, then creates the meeting, and maps the join link', async () => {
    const calls: string[] = [];
    __setGraphTransport(async (url) => {
      calls.push(url);
      if (url.includes('oauth2')) return respond(200, { access_token: 't', expires_in: 3600 });
      return respond(201, { id: 'meeting-1', joinWebUrl: 'https://teams.microsoft.com/l/x' });
    });

    const result = await graphProvider.create({
      subject: 'Week 3',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'o.eze@geu.edu',
    });

    expect(result.ok).toBe(true);
    expect(result.joinUrl).toBe('https://teams.microsoft.com/l/x');
    expect(result.externalId).toBe('meeting-1');
    expect(calls[0]).toContain('login.microsoftonline.com/tenant-abc');
    expect(calls[1]).toContain('/users/o.eze%40geu.edu/onlineMeetings');
  });

  it('CACHES the token across calls', async () => {
    let tokenCalls = 0;
    __setGraphTransport(async (url) => {
      if (url.includes('oauth2')) {
        tokenCalls += 1;
        return respond(200, { access_token: 't', expires_in: 3600 });
      }
      return respond(201, { id: 'm', joinWebUrl: 'https://teams.microsoft.com/l/x' });
    });

    const request = {
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'a@b.c',
    };
    await graphProvider.create(request);
    await graphProvider.create(request);

    // Fetching a fresh token per meeting is a needless round trip on the path
    // of somebody pressing a button.
    expect(tokenCalls).toBe(1);
  });

  it('RETRIES a 429 once, and succeeds', async () => {
    let attempts = 0;
    __setGraphTransport(async (url) => {
      if (url.includes('oauth2')) return respond(200, { access_token: 't', expires_in: 3600 });
      attempts += 1;
      if (attempts === 1) return respond(429, {}, { 'retry-after': '0' });
      return respond(201, { id: 'm', joinWebUrl: 'https://teams.microsoft.com/l/x' });
    });

    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'a@b.c',
    });
    expect(attempts).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('does NOT retry a 403, which would fail identically', async () => {
    let attempts = 0;
    __setGraphTransport(async (url) => {
      if (url.includes('oauth2')) return respond(200, { access_token: 't', expires_in: 3600 });
      attempts += 1;
      return respond(403, {});
    });

    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'a@b.c',
    });
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    // The fix for a 403 is specific and not guessable from a status code.
    expect(result.message).toMatch(/application access policy/);
  });

  it('names the 404 case, which means the organiser is unknown to the tenant', async () => {
    __setGraphTransport(async (url) => {
      if (url.includes('oauth2')) return respond(200, { access_token: 't', expires_in: 3600 });
      return respond(404, {});
    });
    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'ghost@geu.edu',
    });
    expect(result.message).toMatch(/does not recognise ghost@geu.edu/);
  });

  it('RETURNS a failure rather than throwing when the network dies', async () => {
    // A throw here would reach a form action and become a 500 page.
    __setGraphTransport(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'a@b.c',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/did not respond|Could not sign in/);
  });

  it('refuses when there is nobody to make the organiser', async () => {
    delete process.env.AZURE_DEFAULT_ORGANISER;
    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no email address/);
  });

  it('never puts a credential in a user-facing message', async () => {
    __setGraphTransport(async (url) => {
      if (url.includes('oauth2')) return respond(401, { error: 'invalid_client', secret: 'secret-abc' });
      return respond(201, {});
    });
    const result = await graphProvider.create({
      subject: 'W',
      startsAt: IN_AN_HOUR,
      endsAt: IN_TWO_HOURS,
      organiserEmail: 'a@b.c',
    });
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('secret-abc');
    expect(result.message).not.toContain('client-abc');
  });
});
