/**
 * Contextual follow-up suggestions for Mindy Chat — the "what next?" chips that
 * render UNDER an answer (distinct from the empty-state starter prompts in
 * starter-prompts.ts). Given the user's question + Mindy's answer, propose 3
 * short, action-oriented next steps the user can click to send back to Mindy.
 *
 * Cheap by design: one `reasoning` call (gpt-4o-mini first, per LLM cost
 * discipline) with a tight token cap. Fully decoupled from the streamed answer
 * (the panel fetches these after the response completes), so it never adds
 * latency to the answer itself. Fails soft to [] — no chips is fine.
 */
import { callLLM } from '@/lib/llm/call-llm';
import { NEXT_STEP_SYSTEM_PROMPT, filterNextSteps } from '@/lib/chat/next-step-buttons';

// When Mindy redirected an off-topic question, there's no useful "next action".
// Substring-only (catches "I'm" / "I am" and any lead-in), matching the chat
// route's own redirect suppression.
const OFF_TOPIC_MARKERS = [
  'focused on federal contracting',
  "don't have that in my knowledge base",
];

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

/**
 * Drop suggestions that repeat something the user already asked: the same words (at least 80% of the suggestion's
 * words appear in one earlier message). Deterministic, so a repeated question never reaches a button.
 */
export function notAlreadyAsked(suggestions: string[], asked: string[]): string[] {
  const prior = asked.map(words).filter((w) => w.size);
  return suggestions.filter((s) => {
    const w = words(s);
    if (!w.size) return true;
    return !prior.some((p) => [...w].filter((x) => p.has(x)).length / w.size >= 0.8);
  });
}

export async function generateFollowups(
  userMessage: string,
  assistantAnswer: string,
  /** rulesLayer: the Ask Mindy rules layer is on for this verified caller (next-step-buttons.ts). */
  opts?: { userEmail?: string | null; rulesLayer?: boolean; earlier?: string[] },
): Promise<string[]> {
  const answer = (assistantAnswer || '').trim();
  // Too short to be a real answer (error/empty), or an off-topic redirect → skip.
  if (answer.length < 40) return [];
  const low = answer.toLowerCase();
  if (OFF_TOPIC_MARKERS.some((m) => low.includes(m))) return [];

  const earlier = (opts?.earlier ?? []).filter((e) => typeof e === 'string' && e.trim()).slice(-6);
  try {
    const { text } = await callLLM({
      job: 'reasoning', // gpt-4o-mini first — near-Claude quality, ~cents
      tool: 'chat_followups',
      userEmail: opts?.userEmail ?? null,
      json: true,
      maxTokens: 220,
      temperature: 0.4,
      system: opts?.rulesLayer ? NEXT_STEP_SYSTEM_PROMPT :
        'You suggest the NEXT action a federal-contracting user would take after Mindy\'s answer. ' +
        'Mindy can: look up named buying-office contacts, open live SAM solicitations, contractor/incumbent intel, ' +
        'agency spending, GSA CALC pricing, draft outreach emails, and run bid/no-bid analysis. Mindy cannot save, track or add anything to a pipeline or target list from chat — never suggest that. ' +
        'Return STRICT JSON: {"suggestions":["...","...","..."]}. ' +
        'Exactly 3. Each is a short imperative or question the user could click to send back to Mindy (max ~8 words), ' +
        'action-oriented and SPECIFIC to this answer — use the real names, agencies, or opportunities it mentions. ' +
        'Favor next steps (draft an email to X, find open opportunities at Y, who is the incumbent, what is the set-aside) ' +
        'over generic trivia. No numbering.',
      user:
        (earlier.length ? `Earlier in this conversation the user said:\n${earlier.map((e) => `- "${e.slice(0, 300)}"`).join('\n')}\n\n` : '') +
        `User asked: "${userMessage.slice(0, 500)}"\n\n` +
        `Mindy answered:\n"""${answer.slice(0, 2000)}"""\n\n` +
        (earlier.length ? 'Never suggest asking for, or re-asking, something the user already said or Mindy already answered above. ' : '') +
        'Suggest 3 next actions.',
    });
    const parsed = JSON.parse(text) as { suggestions?: unknown };
    const arr = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    const cleaned = arr
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().replace(/^[-*\d.)\s]+/, '').replace(/\.+$/, '')) // strip list bullets / trailing period (keep ?)
      .filter((s) => s.length > 2 && s.length <= (opts?.rulesLayer ? 100 : 80));
    // A button that repeats a question the user already asked is dropped (2026-11-22).
    const fresh = notAlreadyAsked(cleaned, [userMessage, ...earlier]);
    // Rules layer: keep only buttons that name an item from THIS answer (spec section 8).
    return opts?.rulesLayer ? filterNextSteps(fresh, answer) : fresh.slice(0, 3);
  } catch {
    return []; // fail soft — no chips
  }
}
