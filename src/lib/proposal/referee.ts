/**
 * Independent compliance referee — the shared engine behind BOTH the in-app proposal
 * route (`/api/app/proposal/referee`) and the MCP tool (`referee_proposal_compliance`).
 *
 * Eric's original vision: "extract requirements → create draft → final gets run against
 * an INDEPENDENT evaluator so at minimum it's compliant." A SEPARATE model (Claude, via
 * job:'referee') reads the requirements + the assembled draft and judges, per requirement:
 * met / partial / missing. Independence matters — the model that WROTE the draft thinks
 * it's done; a fresh model with only (requirements + draft) is an honest referee. Flags
 * every unmet "shall" so the user ships something at-minimum compliant.
 *
 * Factored out of the route (Jul 2026) so the eval is a pure, transport-agnostic fn — no
 * auth, no NextResponse. The route keeps its HTTP shape; this lib is the primitives + flow.
 */
import { callLLM } from '@/lib/llm/call-llm';

/** The draft is capped so each referee call has room to reason about every requirement. */
export const DRAFT_CAP_CHARS = 24000;
/** Requirements per referee call — small enough that the model reasons about each. */
export const REFEREE_BATCH = 15;

export interface RefereeRequirement {
  id?: string;
  requirement: string;
  category?: string;
  section?: string;
}

export interface RefereeVerdict {
  id: string;
  requirement: string;
  status: 'met' | 'partial' | 'missing';
  evidence?: string; // where in the draft it's addressed (or why it's not)
}

export interface RefereeSummary {
  total: number;
  met: number;
  partial: number;
  missing: number;
  score: number; // (met + 0.5*partial) / total, as a 0-100 percentage
}

export interface RefereeResult {
  verdicts: RefereeVerdict[];
  summary: RefereeSummary;
  ok: boolean; // at least one batch returned (distinguishes provider-down from a real "all missing")
}

const REFEREE_PROMPT = `You are an INDEPENDENT federal proposal compliance reviewer. You did NOT write this draft — your only job is to verify, requirement by requirement, whether the draft actually satisfies it. Be strict: a real Contracting Officer would.

For EACH requirement, judge:
- "met": the draft clearly and specifically addresses it.
- "partial": the draft touches it but is vague, generic, or incomplete.
- "missing": the draft does not address it at all.

Give one short evidence note: quote/paraphrase where the draft addresses it, OR say what's absent.

Return ONLY JSON:
{"verdicts":[{"id":"REQ-001","status":"met|partial|missing","evidence":"..."}]}

Be honest. Defaulting everything to "met" is useless — the value is catching what's NOT covered before submission.`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Referee an assembled draft against a compliance matrix. Numbers the requirements
 * stably, checks them in batches against the draft via an INDEPENDENT model (Claude,
 * job:'referee'), and returns per-requirement verdicts + a summary score. `ok=false`
 * means every batch failed (provider down), distinct from a genuine "all missing".
 * `userEmail` attributes LLM cost to the caller. The draft carries the bidder's vault
 * facts → dataClass:'sensitive' pins it to no-training providers (Data Trust 3.1).
 */
export async function refereeProposal(
  requirements: RefereeRequirement[],
  draft: string,
  opts: { userEmail?: string | null } = {},
): Promise<RefereeResult> {
  const reqs = requirements.filter((r) => r.requirement && r.requirement.trim());
  // Number stably, then check in batches so each referee call has enough room to reason.
  const numbered = reqs.map((r, i) => ({ ...r, id: r.id || `REQ-${String(i + 1).padStart(3, '0')}` }));
  const draftForPrompt = draft.slice(0, DRAFT_CAP_CHARS);
  const verdicts: RefereeVerdict[] = [];
  let ok = false;

  for (const batch of chunk(numbered, REFEREE_BATCH)) {
    const reqList = batch
      .map((r) => `${r.id} [${r.category || 'other'}${r.section ? ` · ${r.section}` : ''}]: ${r.requirement}`)
      .join('\n');
    try {
      const { text } = await callLLM({
        system: REFEREE_PROMPT,
        user: `REQUIREMENTS TO CHECK:\n${reqList}\n\n=== THE DRAFT ===\n${draftForPrompt}`,
        json: true,
        maxTokens: 2500,
        temperature: 0.1,
        dataClass: 'sensitive', // draft contains the bidder's vault facts → no-training providers only
        job: 'referee', // independent model (Claude) — different from the drafter
        tool: 'proposal_referee',
        userEmail: opts.userEmail ?? null,
      });
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      ok = true;
      for (const v of parsed.verdicts || []) {
        const req = batch.find((b) => b.id === v.id);
        verdicts.push({
          id: v.id,
          requirement: req?.requirement || '',
          status: ['met', 'partial', 'missing'].includes(v.status) ? v.status : 'missing',
          evidence: v.evidence,
        });
      }
    } catch (err) {
      console.warn('[proposal/referee] batch failed:', err instanceof Error ? err.message : err);
      // On failure, mark the batch missing so it's surfaced, not hidden.
      for (const r of batch) {
        verdicts.push({ id: r.id, requirement: r.requirement, status: 'missing', evidence: 'Referee could not evaluate — review manually.' });
      }
    }
  }

  const met = verdicts.filter((v) => v.status === 'met').length;
  const partial = verdicts.filter((v) => v.status === 'partial').length;
  const missing = verdicts.filter((v) => v.status === 'missing').length;
  const score = verdicts.length ? Math.round(((met + partial * 0.5) / verdicts.length) * 100) : 0;

  return { verdicts, summary: { total: verdicts.length, met, partial, missing, score }, ok };
}
