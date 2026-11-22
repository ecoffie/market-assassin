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
 * What it replaces for these asks: the packaged keyword market report (fixed market-size sections) and the generic
 * "executive summary + opportunity list + evidence tables" document shape.
 *
 * strategyPlanCheck() is the structural check used to evaluate a plan: it reads the document's argument (is every
 * table interpreted, does every focus say why, does every move have a first step), not its formatting.
 */
import { flagMode } from '@/lib/vault/flags';

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

/** The host contract injected for a strategy-plan turn (replaces the FIND contract for that turn). */
export const STRATEGY_PLAN_CHAT_CONTRACT = [
  'FEDERAL STRATEGY PLAN (a plan for THIS company and THIS objective; an argument, not a market report):',
  'The plan must make one case the customer can act on without a consultant: where the company stands -> where it should focus -> why those choices -> what to do next, starting this week.',
  '',
  'Research (existing tools, company first; stop when more research would not change a choice):',
  '- Objective. Restate what the customer actually asked for in one line. If they asked for something specific first (a review of their capability statement, a plan for one event or one pursuit), that comes first in the plan.',
  '- Where they stand: the saved company profile above, then lookup_sam_entity / search_contractors for registration, then get_contractor_award_history (and get_contractor_profile) for what they actually win. No awards is a fact to state, not a gap to fill.',
  '- Where demand is for THEIR work: find_opportunities with their own words; get_agency_forecasts and get_expiring_contracts for planned buys and current holders; understand_customer or get_agency_intel for what the leading buyers are struggling with. Keep a finding only if it changes which buyer, vehicle or move you recommend.',
  '- Who to talk to: notice contacts first, then lookup_federal_osbp / search_federal_contacts. Never invent a name, email or phone.',
  '- Do not call generate_market_report for this plan: a market-size report is not the deliverable.',
  '',
  'Write the plan with create_document. Choose the sections that fit the objective; drop any section the research did not support. Typical spine:',
  '1. Summary: the objective in one line, then the short version of the argument (where they stand, the two to four focuses, the first move).',
  '2. Where <company> stands: registration, what they win, vehicles, certifications as the records show them. Facts only, cited.',
  '3. Where to focus: two to four chosen buyers, programs, vehicles or partners, ranked. Each one says why it fits THIS company, with the evidence.',
  '4. Why these and not others: what you considered and set aside (too large, wrong set-aside, no incumbent opening, outside their work), so the customer trusts the choice.',
  '5. Buyer problems or money shifts ONLY when they change the choice: a From -> To table must have a "What it means for <company>" column.',
  '6. Fix now (when the research found problems): a table of What it says now -> Why it matters -> Change to, so the customer can copy the correction.',
  '7. First moves: a table of Move -> First step -> Why first (and By when when known). Three to five moves, in order. Include the exact words where they help: the one-line pitch, the question to ask each named contact, the email to send.',
  '8. What not to do / open items, when the evidence calls for it.',
  '',
  'Rules for every section:',
  '- Every table carries an interpretation column (Why it fits, Why it matters, What it means, Why first, Change to). A table of numbers alone is not allowed.',
  '- Never a list of opportunities without a recommendation for each; never a generic action plan ("network", "build relationships", "monitor SAM") without the named office, person or document and the first step.',
  '- Recommendations are labeled recommendation and tied to the facts that support them. Facts cite their source. Unknown stays unknown.',
  '- Do not repeat the chat answer as the document; the document is the plan. In chat, give two or three lines and the link.',
  '- Plain English for a busy owner. No em dashes. No grades or scores for the company. No Mindy plans or prices.',
].join('\n');

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

const STANDING = /\b(stands?|starting\s+point|today|current\s+position|profile|record|readiness)\b/i;
const FOCUS = /\b(focus|priorit|where\s+to|top\s+buyers|targets?|pathways?|opportunit\w*|who\s+to\s+(?:talk|meet|contact)|buyers?)\b/i;
const MOVES = /\b(first\s+moves?|next\s+(?:steps?|moves?)|action\s+plan|what\s+to\s+do|first\s+\d+\s+days|plan\s+of\s+action|schedule|day\s+\d)\b/i;
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
