import type { MeetingProvider, MeetingRequest, MeetingResult } from './index';

/**
 * =============================================================================
 * MICROSOFT TEAMS, VIA THE GRAPH API
 * =============================================================================
 *
 * THE FIRST OUTBOUND HTTP CALL IN THIS CODEBASE. Everything else the app does
 * happens against its own database, so this module carries the things a network
 * call needs and nothing here had before: a timeout, one retry, a token cache,
 * and a hard rule that a failure returns a result rather than throwing into a
 * form action.
 *
 * WHY A PER-SCHOOL TENANT AND NOT ONE MASTER ACCOUNT. Creating every meeting
 * under a single service account in the vendor's own tenant is simpler and is
 * the wrong answer for an institution: the meeting would be hosted by us, the
 * lobby and recording policies would be ours, and recordings would land in our
 * OneDrive rather than the school's. So this is a multi-tenant application —
 * each school grants admin consent once, and meetings are created inside their
 * own tenant with their own teacher as organiser.
 *
 * APP-ONLY, NOT DELEGATED. Client credentials rather than a per-teacher sign-in,
 * because a delegated flow needs every lecturer to consent individually and
 * leaves refresh tokens to expire at the worst moment. The cost is that Graph
 * requires the tenant admin to grant an application access policy naming the
 * organiser accounts, which `configured` cannot detect and which is documented
 * for whoever sets this up:
 *
 *     New-CsApplicationAccessPolicy -Identity Geu-LMS -AppIds "<client id>"
 *     Grant-CsApplicationAccessPolicy -PolicyName Geu-LMS -Global
 *
 * UNTIL AN AZURE APP EXISTS THIS IS INERT. `configured` is false, the resolver
 * hands back MANUAL, and the UI offers a pasted link instead of pretending. The
 * code below is real and unit-tested against an injected transport; what it has
 * never been is run against Microsoft, and I will not claim otherwise until it
 * has been.
 */

const TOKEN_HOST = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Long enough for a slow link, short enough not to hold a form action open. */
const TIMEOUT_MS = 10_000;

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The account meetings are organised by when the teacher has no mailbox. */
  defaultOrganiser?: string;
}

function readConfig(): GraphConfig | null {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    defaultOrganiser: process.env.AZURE_DEFAULT_ORGANISER,
  };
}

/**
 * The transport, injectable so the retry and mapping logic can be tested
 * without reaching Microsoft — which a test must never do.
 */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

let transport: Transport = (url, init) => fetch(url, init);

/** Test seam. Pass null to restore the real one. */
export function __setGraphTransport(next: Transport | null): void {
  transport = next ?? ((url, init) => fetch(url, init));
}

// -----------------------------------------------------------------------------
// Tokens
// -----------------------------------------------------------------------------

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

/** Test seam: a token cached from a previous test would mask a token bug. */
export function __clearGraphToken(): void {
  cached = null;
}

/**
 * An application token for the school's tenant.
 *
 * Cached until shortly before it expires. A token lasts about an hour and
 * fetching a fresh one per meeting is a needless round trip on the critical
 * path of somebody pressing a button; the sixty-second margin means a token
 * that expires mid-flight is renewed rather than rejected.
 */
async function getToken(config: GraphConfig): Promise<string | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.value;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await withTimeout(
    `${TOKEN_HOST}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
  );

  if (!response || !response.ok) {
    // The body of a token failure can echo the client secret back in some
    // error shapes, so it is never logged.
    console.error(`[meetings] Entra rejected the credentials (${response?.status ?? 'no response'}).`);
    return null;
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  cached = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cached.value;
}

// -----------------------------------------------------------------------------
// The call
// -----------------------------------------------------------------------------

async function withTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await transport(url, { ...init, signal: controller.signal });
  } catch (error) {
    // An aborted request and a DNS failure are the same thing to the caller:
    // no answer. Both become a null, and the caller says so in plain words.
    console.error('[meetings] Graph request failed', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One retry, and only for failures that are worth retrying.
 *
 * A 429 or a 5xx is Microsoft asking to be left alone for a moment; a 400 or a
 * 403 is a request that will fail identically however many times it is sent.
 * Retrying the second kind turns one wrong call into two and delays the error
 * the user needs to see.
 */
function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(response: Response): number {
  const header = response.headers.get('retry-after');
  const seconds = header ? Number(header) : Number.NaN;
  // Honour what they ask for, within reason — a form action cannot sit open
  // for the minutes a throttled Graph sometimes requests.
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5_000);
  return 1_000;
}

export const graphProvider: MeetingProvider = {
  name: 'teams',

  get configured() {
    return readConfig() !== null;
  },

  async create(request: MeetingRequest): Promise<MeetingResult> {
    const config = readConfig();
    if (!config) {
      return {
        ok: false,
        via: 'teams',
        message: 'Microsoft Teams is not configured on this deployment.',
      };
    }

    const organiser = request.organiserEmail ?? config.defaultOrganiser;
    if (!organiser) {
      return {
        ok: false,
        via: 'teams',
        message:
          'This teacher has no email address on file, so Teams has nobody to make the organiser. Add one, or paste a link instead.',
      };
    }

    const token = await getToken(config);
    if (!token) {
      return {
        ok: false,
        via: 'teams',
        message: 'Could not sign in to Microsoft. Check the Azure credentials for this school.',
      };
    }

    const url = `${GRAPH}/users/${encodeURIComponent(organiser)}/onlineMeetings`;
    const init: RequestInit = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        startDateTime: request.startsAt.toISOString(),
        endDateTime: request.endsAt.toISOString(),
        subject: request.subject,
      }),
    };

    let response = await withTimeout(url, init);

    if (response && shouldRetry(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response!)));
      response = await withTimeout(url, init);
    }

    if (!response) {
      return {
        ok: false,
        via: 'teams',
        message: 'Microsoft did not respond. Try again, or paste a link instead.',
      };
    }

    if (!response.ok) {
      /*
       * The two failures worth naming, because both have a specific fix and
       * neither is obvious from a status code.
       */
      if (response.status === 403) {
        return {
          ok: false,
          via: 'teams',
          message:
            'Microsoft refused: this application is not permitted to create meetings for that account. The school’s Microsoft administrator needs to grant an application access policy.',
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          via: 'teams',
          message: `Microsoft does not recognise ${organiser} in this school’s tenant.`,
        };
      }
      return {
        ok: false,
        via: 'teams',
        message: `Microsoft refused the request (${response.status}).`,
      };
    }

    const json = (await response.json()) as { id?: string; joinWebUrl?: string };
    if (!json.joinWebUrl) {
      return {
        ok: false,
        via: 'teams',
        message: 'Microsoft created the meeting but returned no join link.',
      };
    }

    return {
      ok: true,
      via: 'teams',
      joinUrl: json.joinWebUrl,
      externalId: json.id,
    };
  },
};
