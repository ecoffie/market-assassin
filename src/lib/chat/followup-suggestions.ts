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

// When Mindy redirected an off-topic question, there's no useful "next action".
// Substring-only (catches "I'm" / "I am" and any lead-in), matching the chat
// route's own redirect suppression.
const OFF_TOPIC_MARKERS = [
  'focused on federal contracting',
  "don't have that in my knowledge base",
];

export async function generateFollowups(
  userMessage: string,
  assistantAnswer: string,
  opts?: { userEmail?: string | null },
): Promise<string[]> {
  const answer = (assistantAnswer || '').trim();
  // Too short to be a real answer (error/empty), or an off-topic redirect → skip.
  if (answer.length < 40) return [];
  const low = answer.toLowerCase();
  if (OFF_TOPIC_MARKERS.some((m) => low.includes(m))) return [];

  try {
    const { text } = await callLLM({
      job: 'reasoning', // gpt-4o-mini first — near-Claude quality, ~cents
      tool: 'chat_followups',
      userEmail: opts?.userEmail ?? null,
      json: true,
      maxTokens: 220,
      temperature: 0.4,
      system:
        'You suggest the NEXT action a federal-contracting user would take after Mindy\'s answer. ' +
        'Mindy can: look up named buying-office contacts, open live SAM solicitations, contractor/incumbent intel, ' +
        'agency spending, GSA CALC pricing, draft outreach emails, add items to a pipeline/target list, and run bid/no-bid analysis. ' +
        'Return STRICT JSON: {"suggestions":["...","...","..."]}. ' +
        'Exactly 3. Each is a short imperative or question the user could click to send back to Mindy (max ~8 words), ' +
        'action-oriented and SPECIFIC to this answer — use the real names, agencies, or opportunities it mentions. ' +
        'Favor next steps (draft an email to X, find open opportunities at Y, who is the incumbent, what is the set-aside, add to my pipeline) ' +
        'over generic trivia. No numbering.',
      user:
        `User asked: "${userMessage.slice(0, 500)}"\n\n` +
        `Mindy answered:\n"""${answer.slice(0, 2000)}"""\n\n` +
        'Suggest 3 next actions.',
    });
    const parsed = JSON.parse(text) as { suggestions?: unknown };
    const arr = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return arr
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().replace(/^[-*\d.)\s]+/, '').replace(/\.+$/, '')) // strip list bullets / trailing period (keep ?)
      .filter((s) => s.length > 2 && s.length <= 80)
      .slice(0, 3);
  } catch {
    return []; // fail soft — no chips
  }
}
