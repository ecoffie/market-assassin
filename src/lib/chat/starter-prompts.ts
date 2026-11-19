/**
 * Mindy Chat — starter-prompt suggestions for the empty state.
 *
 * Audience: someone uncomfortable with AI. Every chip must read like something
 * you would ask a colleague out loud — no "NAICS", "Vault", "pipeline", or
 * tool jargon in the generic set. Personalization may name the user's real
 * NAICS or set-aside (facts they already configured), never invent them.
 *
 * Four slots, always:
 *   (0) what to work on next
 *   (1) who's buying now
 *   (2) who wins that work
 *   (3) research → downloadable report  (the full product loop)
 */

export interface StarterContext {
  naicsCodes?: string[];        // user's real NAICS from their profile
  companyName?: string;
  hasPipeline?: boolean;        // do they have any tracked pursuits?
  setAsides?: string[];         // e.g. ['WOSB','HUBZone']
}

export function buildStarterPrompts(ctx: StarterContext = {}): string[] {
  const naics = (ctx.naicsCodes || []).map((c) => String(c || '').trim()).filter(Boolean);
  const primaryNaics = naics[0];
  const setAside = (ctx.setAsides || []).map((s) => String(s || '').trim()).filter(Boolean)[0];

  // Slot 0 — WHAT TO WORK ON. Only say "my pursuits" when they have some.
  const nextUpPrompt = ctx.hasPipeline
    ? 'Which of my pursuits has the nearest deadline?'
    : 'Find open contracts I should look at this week';

  // Slot 1 — WHO'S BUYING. Personalize with their real NAICS when present;
  // generic copy stays jargon-free.
  const marketPrompt = primaryNaics
    ? `Who is buying work in NAICS ${primaryNaics} right now?`
    : 'Who is buying what I sell right now?';

  // Slot 2 — WHO WINS.
  const intelPrompt = primaryNaics
    ? `Which companies win the most work in NAICS ${primaryNaics}?`
    : 'Which companies win the work I want?';

  // Slot 3 — FULL LOOP: upload-style ask → research → downloadable report.
  // Phrase it like a customer talking to a colleague (capability statement → agencies → report).
  const briefPrompt = setAside
    ? `Here is what my company does — find agencies that buy it and make me a downloadable report (highlight my ${setAside} status)`
    : 'Here is what my company does — find agencies that buy it and make me a downloadable report';

  return [nextUpPrompt, marketPrompt, intelPrompt, briefPrompt];
}

export const DEFAULT_STARTER_PROMPTS: string[] = buildStarterPrompts({});
