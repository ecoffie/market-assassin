/**
 * Federal Strategy Plan (Ask Mindy benchmark, Eric 2026-11-22): the reasoning a professional plan follows, for ONE
 * company and ONE objective, written with the existing research tools and the existing document builder
 * (create_document). One contract, not one generator per deliverable type.
 *
 * What the benchmark deliverables share (a capability-statement diagnosis, a company growth strategy, an event action
 * plan around one pursuit, a product-to-buyer event plan, a local market map) is an ARGUMENT, not a template:
 *   1. the customer's actual objective, restated and answered first;
 *   2. where the company stands, from its own records;
 *   3. only the research that changes a choice;
 *   4. two to four chosen focuses, each with the evidence that it fits;
 *   5. why those and not the alternatives;
 *   6. things the customer can use as-is: corrected wording, a pitch line, the question to ask each named person,
 *      a follow-up email, a first step for every move;
 *   7. a structure that fits the assignment (a plan, a day-by-day schedule, a market map), never a fixed report.
 *
 * How it runs: on the EXISTING research workflow established by the RBA analysis, the Federal Market Profile phase
 * machine (identity -> awards -> pathways -> vehicles -> market_size -> contacts -> web -> writeup), with this
 * contract in place of the RBA-specific one and the saved company profile as the first input. The write-up is a
 * create_document DocModel, so preview and export are the existing ones.
 *
 * strategyPlanCheck() is the structural check used to evaluate a plan: it reads the document's argument (is every
 * table interpreted, does every focus say why, does every move have a first step), not its formatting.
 */
import { flagMode } from '@/lib/vault/flags';
import type { FmpCompanyContext } from '@/lib/chat/tool-selection';
import type { CompanyProfile } from './company-profile';
import { fitRankingNote, rankFindResult } from './compose';

export const STRATEGY_PLAN_ENV = 'ASK_MINDY_STRATEGY_PLAN';
export const STRATEGY_PLAN_ALLOWLIST_ENV = 'ASK_MINDY_STRATEGY_PLAN_ALLOWLIST';

/** Default off. 'true' = everyone; 'allowlist' = emails in ASK_MINDY_STRATEGY_PLAN_ALLOWLIST. A flag change (rule 1). */
export function askMindyStrategyPlanEnabledFor(verifiedEmail: string | null | undefined): boolean {
  const mode = flagMode(STRATEGY_PLAN_ENV);
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const email = (verifiedEmail || '').trim().toLowerCase();
  if (!email) return false;
  return (process.env[STRATEGY_PLAN_ALLOWLIST_ENV] || '')
    .split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')).includes(email);
}

/**
 * A request for a plan for THIS company (not a market-size number, not one opportunity): "federal growth strategy for
 * us", "build a federal market plan for Acme", "where should we focus and what do we do first", "action plan for the
 * expo". A packaged market research report request without a plan or strategy word is not matched.
 */
const STRATEGY_PLAN_SIGNAL = new RegExp([
  String.raw`\b(?:federal\s+)?(?:growth\s+|go[- ]to[- ]market\s+|capture\s+|business\s+development\s+|bd\s+)?strategy\s+(?:plan|for|document|report)\b`,
  String.raw`\b(?:federal\s+)?(?:growth|go[- ]to[- ]market|capture|market|business\s+development|bd)\s+(?:strategy|plan)\b`,
  String.raw`\b(?:strategic|action|game|90[- ]day|30[- ]day|first[- ]year)\s+plan\b`,
  String.raw`\bwhere\s+should\s+(?:we|i|they)\s+(?:focus|start|compete|go)\b`,
  String.raw`\bwhat\s+should\s+(?:we|i|they)\s+(?:do|focus\s+on|go\s+after)\s+(?:first|next)\b`,
  String.raw`\bhow\s+(?:do|can|should)\s+(?:we|i|they)\s+grow\b.*\bfederal\b`,
].join('|'), 'i');

export function isStrategyPlanRequest(customerText: string): boolean {
  return STRATEGY_PLAN_SIGNAL.test(String(customerText || ''));
}

/**
 * The host contract for a strategy-plan turn. It replaces the RBA-specific Federal Market Profile contract on these
 * turns and rides the same server-enforced phase machine (fmp-phase-machine.ts):
 * identity -> awards -> pathways -> vehicles -> market_size -> contacts -> web -> writeup.
 * Eric's reporting doctrine is stated once here, for any company.
 */
export const STRATEGY_PLAN_CHAT_CONTRACT = [
  'FEDERAL STRATEGY PLAN (company-first research, then an argued plan; not a keyword market report):',
  'The plan makes one case the customer can act on without a consultant: where the company stands -> where it should focus -> why -> which pathways and buyers matter -> what to do over the next 90 days.',
  '- PHASE PLAN (server-enforced): identity -> awards -> pathways -> vehicles -> market_size -> contacts -> web -> writeup. The server offers only unlocked phases and forces the next required call. A PHASE PLAN note names the current phase.',
  '- Identity: use the saved COMPANY PROFILE note (legal name, UEI) with lookup_sam_entity / search_contractors. Never guess a company from a nickname.',
  '- Awards decide the market: get_contractor_award_history (and get_contractor_profile) shows what the company actually wins. Award NAICS outrank the registered NAICS list. No awards is a fact to state, not a gap to fill.',
  '- Company-supplied facts (capabilities, bonding, equipment, certifications, constraints) come only from the COMPANY PROFILE note and the customer\'s own words, labeled as company-stated. Never invent them.',
  '- Pathways before open bids: contract vehicles (IDIQ, MATOC, GSA Schedule, BPA), sources sought and market research notices, forecasts, recompetes, and direct awards where the company is eligible. find_opportunities and search_sam_opportunities with the company\'s own work words and states; lookup_solicitation / get_solicitation_documents for named vehicles; get_agency_forecasts.',
  '- Vehicles: for each vehicle that matters, search_past_contracts / search_idv_contracts (task orders) and get_award_detail for holders, ceilings, end dates and set-asides.',
  '- Market size supports the choice; it is never the deliverable. generate_market_report runs per state with the award NAICS.',
  '- Prioritization: when a FIT RANKING note is present, it was computed for THIS company by Mindy\'s shared fit scorer. "Pathways in priority order" follows its order and uses its reasons; a subcontract-route pick is labeled as a teaming or subcontract pathway. Never print a fit score.',
  '- Contacts and policy: notice contacts first, then lookup_federal_osbp / search_federal_contacts; get_legislation_status for legislation that affects these buyers (status only). Never invent a name, email or phone.',
  '- Outside Mindy: search_web for the agency problems, policy and budget context that change a choice. Quote returned snippets with URLs; if search is unavailable, say so as a known gap.',
  '',
  'Write the plan with create_document (it is previewed and exported as PDF and Word). Use these headings (the server\'s write-up check reads them), dropping any section the research did not support:',
  '1. "Executive summary": the objective in one line, then the short version of the argument.',
  '2. "About the company: where <company> stands": registration, what it actually wins (award NAICS, buyers, prime vs sub), vehicles, company-stated facts. Cited.',
  '3. "Pathways in priority order: where to focus": two to four pathways and buyers, ranked, each with why it fits THIS company and the evidence. This is the first section after the two above.',
  '4. "Why these and not others": what was considered and set aside, and why.',
  '5. "Buyer pain points": what these buyers are under pressure to fix, and what it means for <company> (cited; include policy context that changes the choice).',
  '6. "Who to talk to and what to say": named contact, why approach them, and the question to ask.',
  '7. "Readiness checklist": SAM and DSBS / SBA profile fixes (now -> why it matters -> change to), including DSBS keywords.',
  '8. "Next 90 days": Move -> First step -> Why first -> By when, three to six moves in order.',
  '',
  'Rules: every table carries an interpretation column (why it fits, why it matters, what it means, the question, the first step); no list of opportunities without a recommendation for each; no generic moves; recommendations are labeled and tied to facts; unknown stays unknown; no grades or scores for the company; no Mindy plans, prices or upsells; plain English, no em dashes. In chat, give two or three lines and the document link; do not repeat the plan.',
].join('\n');

/** The saved company profile as the strategy turn's FIRST input (step 1 and step 3). */
export interface StrategyProfileInput {
  status: 'ok' | 'refused' | 'unavailable';
  profile?: CompanyProfile;
}

/** The host note that opens a strategy turn: who the company is, from its authorized saved profile. */
export function strategyProfileNote(input: StrategyProfileInput): string {
  if (input.status !== 'ok' || !input.profile) {
    return input.status === 'refused'
      ? 'COMPANY PROFILE: not used this turn (the acting workspace could not be confirmed). Identify the company only from the customer\'s own words; do not ask for a UEI before giving value.'
      : 'COMPANY PROFILE: unavailable this turn (it could not be read; it is not empty). Identify the company from the customer\'s own words and say that saved profile facts could not be used.';
  }
  const p = input.profile;
  const line = (label: string, v: string | undefined | null) => (v ? `- ${label}: ${v}` : null);
  const pp = p.pastPerformance;
  const lines = [
    'COMPANY PROFILE (saved, authorized workspace; company-stated unless a tool confirms it):',
    line('Legal name', p.companyName),
    line('UEI', p.uei),
    line('Registered NAICS (award history decides what they actually win)', p.naicsCodes?.join(', ')),
    line('Works in', p.states?.join(', ')),
    line('Target agencies (preferences)', p.targetAgencies?.join(', ')),
    line('Certifications (self-reported, not verified)', p.certifications?.map((c) => c.name).join(', ')),
    line('Contract vehicles held (company-stated)', p.vehiclesHeld?.join(', ')),
    line('Capabilities (company keywords)', p.keywords?.slice(0, 12).join(', ')),
    pp ? `- Past performance on file: ${pp.primeCount} as prime, ${pp.subCount} as sub${pp.buyerAgencies.length ? `; buyers ${pp.buyerAgencies.slice(0, 6).join(', ')}` : ''}` : null,
    p.unknown.length ? `- Not in the profile (unknown, not zero): ${p.unknown.join(', ')}` : null,
    p.unavailable?.length ? `- Could not be read this turn (unavailable, not empty): ${p.unavailable.join(', ')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

/** The company context the FMP host builders use on a strategy turn (no RBA civil defaults). */
export function strategyCompanyContext(input: StrategyProfileInput): FmpCompanyContext {
  const p = input.status === 'ok' ? input.profile : undefined;
  return {
    ...(p?.companyName ? { legalName: p.companyName } : {}),
    ...(p?.keywords?.length ? { workPhrase: p.keywords.slice(0, 4).join(' ') } : {}),
    ...(p?.naicsCodes?.length ? { naics: p.naicsCodes[0] } : {}),
    ...(p?.states?.length ? { states: p.states.slice(0, 3) } : {}),
  };
}

/**
 * The FIT RANKING note for a strategy turn: the first successful find_opportunities result in the research rounds,
 * ranked for THIS company by the shared fit scorer (compose.ts, the same note as #2285's chat ranking). Returns
 * null when there is no profile, no successful FIND, nothing rankable, or the result cannot be read: no guessed
 * ranking, ever.
 */
export function strategyFitNote(
  results: ReadonlyArray<{ record: { tool: string; status: string }; content: string }>,
  input: StrategyProfileInput | null,
  nowMs?: number,
): { note: string | null; reason: 'ok' | 'no_profile' | 'no_find' | 'nothing_ranked' | 'unreadable' } {
  if (!input || input.status !== 'ok' || !input.profile) return { note: null, reason: 'no_profile' };
  const find = results.find((r) => r.record.tool === 'find_opportunities' && r.record.status === 'success');
  if (!find) return { note: null, reason: 'no_find' };
  try {
    const parsed = JSON.parse(find.content) as Parameters<typeof rankFindResult>[0];
    const note = fitRankingNote(rankFindResult(parsed, input.profile, nowMs !== undefined ? { nowMs } : {}));
    return note ? { note, reason: 'ok' } : { note: null, reason: 'nothing_ranked' };
  } catch {
    return { note: null, reason: 'unreadable' };
  }
}

// ── Structural check (evaluation) ───────────────────────────────────────────────────────────────────────────────

type Cell = string | number | null;
interface Block { type: string; claim?: string; text?: string; items?: Array<{ text: string; claim?: string }>; columns?: Array<{ key: string; label: string }>; rows?: Array<Record<string, Cell>> }
interface Section { heading: string; role?: string; blocks: Block[] }
export interface StrategyDocLike { title?: string; sections: Section[] }

export interface StrategyPlanCheck {
  pass: boolean;
  /** Missing parts of the argument (each makes pass false). */
  missing: string[];
  /** Weaker signals worth a look (never fail on their own). */
  warnings: string[];
}

const STANDING = /\b(stands?|starting\s+point|current\s+position|about\s+the\s+company|company\s+profile|track\s+record)\b/i;
const FOCUS = /\b(focus|priorit|where\s+to\s+(?:focus|start|compete)|top\s+buyers|targets?|pathways?|opportunit\w*)\b/i;
const MOVES = /\b(first\s+moves?|next\s+(?:steps?|moves?|\d+\s+days)|action\s+plan|what\s+to\s+do|first\s+\d+\s+days|\d+[- ]day\s+plan|plan\s+of\s+action|schedule|day\s+\d)\b/i;
const NOT_CHOSEN = /\b(not\s+(?:to\s+)?(?:do|pursue|chase|now)|set\s+aside|deprioriti|why\s+these|avoid|skip|instead|what\s+not)\b/i;
const INTERPRET_COL = /\b(why|means?|matters?|fit|change\s+to|first\s+step|next\s+step|how\s+to|use\s+it|action|ask|question|what\s+to\s+say|recommend)\b/i;
const FIRST_STEP_COL = /\b(first\s+step|how|next\s+step|what\s+to\s+do|ask|question)\b/i;
const WHY_COL = /\b(why|rationale|fit|reason)\b/i;

/** Read the plan's argument. A packaged market report (tables without interpretation, no moves) fails. */
export function strategyPlanCheck(doc: StrategyDocLike): StrategyPlanCheck {
  const missing: string[] = [];
  const warnings: string[] = [];
  const body = (doc.sections || []).filter((s) => s.role !== 'about');
  const headings = body.map((s) => s.heading || '');

  if (!headings.some((h) => STANDING.test(h))) missing.push('a "where the company stands" section from its own records');
  const focusSecs = body.filter((s) => FOCUS.test(s.heading || ''));
  if (!focusSecs.length) missing.push('a "where to focus" section naming the chosen buyers, programs or partners');
  const moveSecs = body.filter((s) => MOVES.test(s.heading || ''));
  if (!moveSecs.length) missing.push('a "first moves" section');

  // Every table is interpreted: an interpretation column, or a recommendation in the same section. The company's own
  // record ("where it stands") is the exception: it is the facts the argument starts from.
  for (const s of body) {
    if (STANDING.test(s.heading || '') && !FOCUS.test(s.heading || '')) continue;
    const sectionRecommends = s.blocks.some((b) => b.claim === 'recommendation' || (b.items ?? []).some((i) => i.claim === 'recommendation'));
    for (const b of s.blocks) {
      if (b.type !== 'table') continue;
      const interpreted = (b.columns ?? []).some((c) => INTERPRET_COL.test(c.label));
      if (!interpreted && !sectionRecommends) missing.push(`an interpretation for the table in "${s.heading}" (a "why it matters / what it means" column or a recommendation)`);
    }
  }

  // Focus items say why.
  for (const s of focusSecs) {
    const tables = s.blocks.filter((b) => b.type === 'table');
    const bullets = s.blocks.filter((b) => b.type === 'bullets');
    const tableHasWhy = tables.some((t) => (t.columns ?? []).some((c) => WHY_COL.test(c.label)));
    const prose = s.blocks.filter((b) => b.type === 'paragraph').map((b) => b.text ?? '').join(' ') + ' ' + bullets.flatMap((b) => (b.items ?? []).map((i) => i.text)).join(' ');
    if (!tableHasWhy && !/\b(why|because|fits?|so\s+that|which\s+means)\b/i.test(prose)) missing.push(`a reason for each choice in "${s.heading}"`);
  }

  // Moves have a first step.
  for (const s of moveSecs) {
    const tables = s.blocks.filter((b) => b.type === 'table');
    const hasStep = tables.some((t) => (t.columns ?? []).some((c) => FIRST_STEP_COL.test(c.label)))
      || s.blocks.some((b) => (b.items ?? []).length >= 2 && (b.items ?? []).every((i) => i.text.trim().split(/\s+/).length >= 6));
    if (!hasStep) missing.push(`a concrete first step for each move in "${s.heading}"`);
    const hasWhy = tables.some((t) => (t.columns ?? []).some((c) => WHY_COL.test(c.label)));
    if (tables.length && !hasWhy) warnings.push(`moves in "${s.heading}" do not say why each comes first`);
  }

  const recs = body.flatMap((s) => s.blocks).reduce((n, b) => n + (b.claim === 'recommendation' ? 1 : 0) + (b.items ?? []).filter((i) => i.claim === 'recommendation').length, 0);
  if (recs < 2) missing.push('labeled recommendations (at least two) tied to the evidence');

  const allText = body.map((s) => s.heading + ' ' + s.blocks.map((b) => b.text ?? (b.items ?? []).map((i) => i.text).join(' ')).join(' ')).join(' ');
  if (!NOT_CHOSEN.test(allText)) warnings.push('nothing says what was set aside or what not to do, so the choices may read as unexplained');

  const tables = body.flatMap((s) => s.blocks).filter((b) => b.type === 'table').length;
  const blocks = body.flatMap((s) => s.blocks).length;
  if (blocks && tables / blocks > 0.6) warnings.push('mostly tables: check that the plan argues, not just lists');

  return { pass: missing.length === 0, missing, warnings };
}
