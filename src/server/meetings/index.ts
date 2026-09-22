import { manualProvider } from './manual-provider';
import { fakeProvider } from './fake-provider';
import { graphProvider } from './graph-provider';

/**
 * =============================================================================
 * VIRTUAL CLASSES
 * =============================================================================
 *
 * Creating a meeting in somebody else's system, behind an interface.
 *
 * PROVIDER-AGNOSTIC, WITH MICROSOFT FIRST. The brief asked for Teams; this is
 * deliberately a superset, for a reason that matters commercially. A school in
 * this market may run Microsoft 365, or Google Workspace, or Zoom, or nothing
 * at all — and a virtual-class feature that only works for one of those cannot
 * be sold to the others. MANUAL, where a teacher pastes a link from whatever
 * they already use, works on the day the school signs up and needs no Azure
 * tenant, no admin consent and no configuration.
 *
 * The shape copies `src/server/email/index.ts` exactly: plain data types, one
 * narrow verb, an env-selected resolver, a test seam, and an honesty predicate
 * so the UI can say what is actually true rather than what would be convenient.
 */

export interface MeetingRequest {
  subject: string;
  startsAt: Date;
  endsAt: Date;
  /** The teacher, where the provider can make them the real organiser. */
  organiserEmail?: string | null;
  /** Free text the provider may show to attendees. */
  agenda?: string | null;
}

export interface MeetingResult {
  ok: boolean;
  /** Which driver handled it: "manual", "teams", "fake". For the audit trail. */
  via: string;
  joinUrl?: string;
  /** The provider's own identifier, so it can later be updated or cancelled. */
  externalId?: string;
  /** User-facing, and safe to show: never carries a token or a tenant id. */
  message?: string;
}

export interface MeetingProvider {
  readonly name: string;
  /**
   * Whether this provider can actually create a meeting right now.
   *
   * Separate from `createMeeting` so the UI can offer only what works. A
   * dropdown listing "Microsoft Teams" on a deployment with no Azure app is a
   * promise the product cannot keep.
   */
  readonly configured: boolean;
  create(request: MeetingRequest): Promise<MeetingResult>;
}

let override: MeetingProvider | null = null;

/** Every provider this build knows, whether or not it is usable here. */
export function allProviders(): Record<string, MeetingProvider> {
  return {
    MANUAL: manualProvider,
    TEAMS: graphProvider,
    FAKE: fakeProvider,
  };
}

/**
 * The provider for a chosen kind.
 *
 * Falls back to MANUAL rather than throwing, because the fallback is genuinely
 * usable: a teacher pastes a link and the class goes ahead. Throwing would take
 * down a page over a configuration problem that has a perfectly good answer.
 */
export function meetingProvider(kind: string): MeetingProvider {
  if (override) return override;

  const providers = allProviders();
  const chosen = providers[kind.toUpperCase()];

  if (!chosen) {
    console.warn(`[meetings] "${kind}" is not a provider this build knows. Using MANUAL.`);
    return manualProvider;
  }
  if (!chosen.configured) {
    console.warn(`[meetings] ${chosen.name} is not configured on this deployment. Using MANUAL.`);
    return manualProvider;
  }
  return chosen;
}

/** Test seam, mirroring `__setMailer` and `__setStorageDriver`. */
export function __setMeetingProvider(next: MeetingProvider | null): void {
  override = next;
}

/**
 * Can this deployment create a Teams meeting automatically?
 *
 * The UI asks so it can tell the truth. Offering "Microsoft Teams" and then
 * silently producing a pasted-link form is how somebody spends an afternoon
 * wondering what they configured wrongly.
 */
export function automaticProvidersAvailable(): string[] {
  return Object.entries(allProviders())
    .filter(([kind, provider]) => kind !== 'MANUAL' && kind !== 'FAKE' && provider.configured)
    .map(([kind]) => kind);
}
