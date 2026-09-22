import type { MeetingProvider, MeetingRequest, MeetingResult } from './index';

/**
 * A link the teacher already has.
 *
 * Not a fallback or a stub — a first-class answer, and the one most schools in
 * this market will use. Whatever they run their classes on today, they can
 * paste its link here and the class appears in the module with a time on it.
 *
 * It is ALWAYS configured, which is the point: no Azure tenant, no admin
 * consent, nothing to set up. That is what makes the feature sellable to a
 * school that has never heard of Entra.
 *
 * The URL arrives through `saveVirtualClass`, which validates it with the same
 * rule that governs link items — http and https only. A `javascript:` URL on a
 * page shown to a whole class would execute in every student's session.
 */
export const manualProvider: MeetingProvider = {
  name: 'manual',
  configured: true,

  async create(request: MeetingRequest): Promise<MeetingResult> {
    // Nothing to call. The caller supplies the URL; this provider exists so the
    // rest of the system can treat every meeting the same way.
    void request;
    return { ok: true, via: 'manual' };
  },
};
