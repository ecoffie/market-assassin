/**
 * Intelligence gate: which turns it answers, and the inputs it needs from the customer's own words.
 * Facts come from the customer's words and the Vault profile, never from a model's guess: the work phrase a
 * model extracts must appear verbatim in what the customer typed, or the gate does not run.
 */
import Anthropic from '@anthropic-ai/sdk';
import { compileIntent } from '@/lib/chat/intent-compiler';
import { classifyFindIntent, isFederalMarketProfileRequest, isMarketResearchRequest } from '@/lib/chat/tool-selection';
import { isStrategyPlanRequest } from './strategy-plan';
import type { CompanyProfile } from './company-profile';
import type { CustomerEligibility } from './evidence-checks';

export const WORK_EXTRACT_MODEL = 'claude-haiku-5-5';

export interface GateTurn {
  /** Exact customer words naming the work, verified to appear in the question. */
  work: string;
  /** Two-letter states the customer named; empty = nationwide. */
  states: string[];
}

/** Turns the gate answers: a current find or a market research ask, up to GATE_MAX_STATES named states. */
export const GATE_MAX_STATES = 6;

export function gateEligible(ask: string): { ok: true; state: string | null; states: string[] } | { ok: false; reason: string } {
  if (isFederalMarketProfileRequest(ask)) return { ok: false, reason: 'federal_market_profile' };
  if (isStrategyPlanRequest(ask)) return { ok: false, reason: 'strategy_plan' };
  const find = classifyFindIntent(ask) === 'CURRENT_FIND';
  if (!find && !isMarketResearchRequest(ask)) return { ok: false, reason: 'not_market_question' };
  const states = compileIntent(ask).explicitStates;
  if (states.length > GATE_MAX_STATES) return { ok: false, reason: 'too_many_states' };
  return { ok: true, state: states.length === 1 ? states[0] : null, states };
}

/** Software check: the phrase must be the customer's own words (case-insensitive, whitespace-normalized). */
export function isVerbatim(phrase: string, ask: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const p = norm(phrase);
  return p.length >= 3 && norm(ask).includes(p);
}

export async function extractWorkPhrase(ask: string, opts: { client?: Anthropic } = {}): Promise<string | null> {
  const client = opts.client ?? new Anthropic();
  const msg = await client.messages.create({
    model: WORK_EXTRACT_MODEL,
    max_tokens: 1000,
    system:
      'Copy, exactly as written, the words in the customer message that name the kind of work, service or product they sell or want contracts for (for example "janitorial services", "bridge and highway heavy civil construction", "cybersecurity"). Do not include a location, agency, company name, or words like "opportunities" or "contracts". Return null if the message names no kind of work.',
    output_config: {
      format: {
        type: 'json_schema',
        schema: { type: 'object', additionalProperties: false, required: ['work'], properties: { work: { type: ['string', 'null'] } } },
      },
    },
    messages: [{ role: 'user', content: ask }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const work = (JSON.parse(text) as { work: string | null }).work;
  return work && isVerbatim(work, ask) ? work.trim() : null;
}

/** The Vault profile as analyst context (facts only; unknown stays unknown). */
export function profileForGate(p: CompanyProfile | null | undefined): { text: string | null; eligibility: CustomerEligibility } {
  if (!p) return { text: null, eligibility: {} };
  const parts = [
    p.companyName ? `Company: ${p.companyName}` : '',
    p.uei ? `SAM UEI: ${String(p.uei).toUpperCase()}` : '',
    p.naicsCodes?.length ? `NAICS codes: ${p.naicsCodes.join(', ')}` : '',
    p.states?.length ? `Works in: ${p.states.join(', ')}` : '',
    p.certifications?.length ? `Certifications (self-reported): ${p.certifications.map((c) => c.name).join(', ')}` : 'Certifications: none listed',
    p.targetSetAsides?.length ? `Set-asides they want to target (not certifications): ${p.targetSetAsides.join(', ')}` : '',
    p.vehiclesHeld?.length ? `Contract vehicles held: ${p.vehiclesHeld.join(', ')}` : '',
    p.pastPerformance ? `Past performance: ${p.pastPerformance.primeCount} prime and ${p.pastPerformance.subCount} sub awards${p.pastPerformance.buyerAgencies.length ? ` with ${p.pastPerformance.buyerAgencies.slice(0, 5).join(', ')}` : ''}` : '',
  ].filter(Boolean);
  // Certifications: an empty list from a successfully read profile means "none listed", which is still not
  // proof they hold none, so only a non-empty list is used to decide eligibility.
  const certs = p.certifications?.length ? p.certifications.map((c) => c.name) : null;
  return { text: parts.length ? parts.join('\n') : null, eligibility: { certifications: certs, uei: p.uei ? String(p.uei).toUpperCase() : null } };
}
