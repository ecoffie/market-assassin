/**
 * Mindy Chat v2 — starter-prompt suggestions.
 *
 * The empty-state chips. In v1 these were 4 static teaching questions, which now
 * UNDERSELL the chat: v2 can reach the Data Core (pipeline, Vault, live SAM,
 * contractor intel), but a user who only sees "How do I respond to a Sources
 * Sought?" never discovers it. This builds a small, DIVERSE set that showcases
 * each capability — and personalizes to the user's real profile when we have it.
 *
 * Grounding rule (Rule #1): a personalized prompt only ever references data the
 * user actually has — their real NAICS, whether they have pursuits. We never
 * invent a NAICS or imply a pipeline they don't own. When context is thin, we
 * fall back to strong generic examples of the same capability.
 *
 * Pure function → unit-testable; the route just feeds it profile + pipeline count.
 */

export interface StarterContext {
  naicsCodes?: string[];        // user's real NAICS from their profile
  companyName?: string;
  hasPipeline?: boolean;        // do they have any tracked pursuits?
  setAsides?: string[];         // e.g. ['WOSB','HUBZone']
}

// One curated example per capability so the four chips always span the range:
// (0) your pipeline · (1) live market · (2) contractor/competitive intel ·
// (3) your Vault / a teaching anchor. Order = what to show; we fill each slot
// with the most personalized phrasing the context supports, else the generic.
export function buildStarterPrompts(ctx: StarterContext = {}): string[] {
  const naics = (ctx.naicsCodes || []).map((c) => String(c || '').trim()).filter(Boolean);
  const primaryNaics = naics[0];
  const setAside = (ctx.setAsides || []).map((s) => String(s || '').trim()).filter(Boolean)[0];

  // Slot 0 — YOUR PIPELINE. Only offer the "my pursuits" prompt if they have
  // some; otherwise steer them to fill the pipeline (honest — no fake pursuits).
  const pipelinePrompt = ctx.hasPipeline
    ? 'Which of my pursuits has the nearest deadline?'
    : 'Find me open opportunities to add to my pipeline';

  // Slot 1 — LIVE MARKET (SAM). Personalize by the user's real NAICS if present.
  const marketPrompt = primaryNaics
    ? `What SAM opportunities are open right now in NAICS ${primaryNaics}?`
    : 'What government contracts are open in my industry right now?';

  // Slot 2 — CONTRACTOR / COMPETITIVE INTEL. NAICS-personalized when we can;
  // otherwise a concrete named-company example that teaches the capability.
  const intelPrompt = primaryNaics
    ? `Who are the top contractors winning work in NAICS ${primaryNaics}?`
    : 'Who are the biggest contractors in my space, and what have they won?';

  // Slot 3 — YOUR VAULT / capability. Personalize with the set-aside they hold
  // (a real, grounded fact) or fall back to a Vault-drafting anchor.
  const vaultPrompt = setAside
    ? `Draft a capability statement intro highlighting my ${setAside} status`
    : 'Draft a capability statement intro from my Vault';

  return [pipelinePrompt, marketPrompt, intelPrompt, vaultPrompt];
}

// The static fallback, exported so the client can render instantly before the
// personalized set loads (and if the suggestions call fails). Mirrors the four
// capability slots with fully generic phrasing.
export const DEFAULT_STARTER_PROMPTS: string[] = buildStarterPrompts({});
