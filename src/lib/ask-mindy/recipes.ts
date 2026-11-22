/**
 * Ask Mindy recipes (Ask Mindy Backend Spec, Nov 21 2026, section 5): each kind of question maps to a fixed
 * tool sequence over Mindy's existing MCP tools. This file is the CONTRACT only. It is not wired into the chat
 * route; the orchestrator (orchestrator.ts) runs a recipe through an injected tool executor.
 *
 * Built so far: the three high-priority recipes the spec's build order names first (Where to start,
 * Opportunity deep dive, Profile setup). The other seven are declared (so the classifier can name them and a
 * caller can offer them as a next step) but have no steps yet: a plan for one says `not_implemented`.
 *
 * A step whose tool does not exist yet (the spec's "NEW" tools) has `tool: null` and a `requirement` written
 * for Data Core, which owns the tools. Ask Mindy never rebuilds a Data Core tool.
 */

export type RecipeId =
  | 'where_to_start'
  | 'profile_setup'
  | 'opportunity_deep_dive'
  | 'event_plan'
  | 'buyer_brief'
  | 'teaming_finder'
  | 'sources_sought_response'
  | 'price_check'
  | 'outreach_draft'
  | 'general_research';

export const RECIPE_IDS: readonly RecipeId[] = [
  'where_to_start', 'profile_setup', 'opportunity_deep_dive', 'event_plan', 'buyer_brief',
  'teaming_finder', 'sources_sought_response', 'price_check', 'outreach_draft', 'general_research',
];

/** What Ask Mindy knows about the company. Every field is optional: absent means UNKNOWN, never guessed. */
export interface AskMindyProfile {
  companyName?: string;
  uei?: string;
  naicsCodes?: string[];
  /** Two-letter state codes the company works in. */
  states?: string[];
  agencies?: string[];
  setAsides?: string[];
  keywords?: string[];
  website?: string;
}

export interface RecipeContext {
  question: string;
  profile: AskMindyProfile;
  /** Identifiers the classifier pulled from the question (solicitation number, notice id, UEI, URL). */
  identifiers?: { solicitation?: string; noticeId?: string; uei?: string; url?: string };
}

/** Results of earlier steps, by step id. `value` is the tool's result as returned. */
export type PriorResults = Readonly<Record<string, { state: 'ok'; value: unknown } | { state: 'unavailable' | 'skipped' | 'missing_tool'; reason: string; unknownFields?: string[] }>>;

/** Args for a step, or why it cannot run from what is known. Never invents a value. */
export type StepArgs = { args: Record<string, unknown> } | { skip: string };

export interface RecipeStep {
  id: string;
  /** MCP tool name, or null when the spec's tool does not exist yet. */
  tool: string | null;
  /** Step ids whose results this step needs. Steps with no unmet needs run in parallel. */
  needs?: string[];
  args?: (ctx: RecipeContext, prior: PriorResults) => StepArgs;
  /** For tool:null steps: the interface Data Core would need to provide. */
  requirement?: string;
  /** For tool:null steps: profile fields only that tool can fill. They stay unknown, never guessed. */
  unknownFields?: string[];
}

export interface Recipe {
  id: RecipeId;
  name: string;
  priority: 'high' | 'medium' | 'low';
  /** Questions from the spec that this recipe answers. */
  examples: string[];
  steps: RecipeStep[];
  /** Answer sections, in order (spec section 8 shape). */
  output: string[];
  /** Recipes worth offering as a next-step button after this one. */
  offerNext?: RecipeId[];
}

const first = <T>(xs: T[] | undefined): T | undefined => (xs && xs.length ? xs[0] : undefined);

/** A short "what they do" phrase for search tools: profile keywords, else the question itself. */
function workPhrase(ctx: RecipeContext): string {
  return ctx.profile.keywords?.length ? ctx.profile.keywords.slice(0, 3).join(' ') : ctx.question;
}

/** First record-like object in a tool result that carries one of these keys. */
function pick(prior: PriorResults, stepId: string, keys: string[]): string | undefined {
  const r = prior[stepId];
  if (!r || r.state !== 'ok') return undefined;
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | undefined => {
    if (!v || typeof v !== 'object' || depth > 4 || seen.has(v)) return undefined;
    seen.add(v);
    for (const k of keys) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'string' && x.trim()) return x.trim();
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const found = walk(x, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(r.value, 0);
}

const WHERE_TO_START: Recipe = {
  id: 'where_to_start',
  name: 'Where to start (market map)',
  priority: 'high',
  examples: ['What should I go after?', "Where's the money for us?"],
  steps: [
    {
      id: 'open', tool: 'find_opportunities',
      args: (ctx) => ({ args: {
        query: workPhrase(ctx),
        ...(ctx.profile.uei ? { uei: ctx.profile.uei } : {}),
        ...(ctx.profile.states?.length ? { states: ctx.profile.states } : {}),
      } }),
    },
    {
      id: 'expiring', tool: 'get_expiring_contracts',
      args: (ctx) => ctx.profile.naicsCodes?.length
        ? { args: { naics: ctx.profile.naicsCodes.join(','), ...(ctx.profile.states?.length ? { state: ctx.profile.states.join(',') } : {}) } }
        : { skip: 'profile NAICS unknown' },
    },
    {
      id: 'forecasts', tool: 'get_agency_forecasts',
      args: (ctx) => {
        const naics = first(ctx.profile.naicsCodes);
        return naics || ctx.profile.keywords?.length
          ? { args: { ...(naics ? { naics } : { keyword: workPhrase(ctx) }), ...(first(ctx.profile.states) ? { state: first(ctx.profile.states) } : {}) } }
          : { skip: 'profile NAICS and keywords unknown' };
      },
    },
    {
      id: 'buyer_intel', tool: 'get_agency_intel', needs: ['open'],
      args: (ctx, prior) => {
        const agency = first(ctx.profile.agencies) ?? pick(prior, 'open', ['agency', 'department', 'buyer']);
        return agency ? { args: { agency } } : { skip: 'no buyer agency in the profile or the open results' };
      },
    },
    {
      id: 'competitors', tool: 'search_contractors',
      args: (ctx) => {
        const naics = first(ctx.profile.naicsCodes);
        return { args: { ...(naics ? { naics } : { keyword: workPhrase(ctx) }), ...(first(ctx.profile.states) ? { state: first(ctx.profile.states) } : {}), limit: 10 } };
      },
    },
  ],
  output: ['answer', 'top_picks', 'buyer_pain_point', 'who_to_contact', 'next_move'],
  offerNext: ['opportunity_deep_dive', 'buyer_brief', 'teaming_finder'],
};

const OPPORTUNITY_DEEP_DIVE: Recipe = {
  id: 'opportunity_deep_dive',
  name: 'Opportunity deep dive',
  priority: 'high',
  examples: ['Tell me about 36C25027R5412', '(clicks a map pin)'],
  steps: [
    {
      id: 'notice', tool: 'lookup_solicitation',
      args: (ctx) => {
        const q = ctx.identifiers?.noticeId ?? ctx.identifiers?.solicitation;
        return q ? { args: { query: q } } : { args: { query: ctx.question } };
      },
    },
    {
      id: 'documents', tool: 'get_solicitation_documents', needs: ['notice'],
      args: (ctx, prior) => {
        const id = pick(prior, 'notice', ['notice_id', 'noticeId']) ?? ctx.identifiers?.noticeId;
        return id ? { args: { notice_id: id } } : { skip: 'notice id not resolved' };
      },
    },
    {
      id: 'incumbent', tool: 'get_solicitation_incumbent', needs: ['notice'],
      args: (ctx, prior) => {
        const notice_id = pick(prior, 'notice', ['notice_id', 'noticeId']) ?? ctx.identifiers?.noticeId;
        const solicitation_number = pick(prior, 'notice', ['solicitation_number', 'solicitationNumber']) ?? ctx.identifiers?.solicitation;
        return notice_id || solicitation_number
          ? { args: { ...(notice_id ? { notice_id } : {}), ...(solicitation_number ? { solicitation_number } : {}) } }
          : { skip: 'neither notice id nor solicitation number resolved' };
      },
    },
    {
      id: 'customer', tool: 'understand_customer', needs: ['notice'],
      args: (ctx, prior) => {
        const notice_id = pick(prior, 'notice', ['notice_id', 'noticeId']) ?? ctx.identifiers?.noticeId;
        return notice_id ? { args: { notice_id } } : { skip: 'notice id not resolved' };
      },
    },
    {
      // evaluate_bid_decision scores gates/ratings that the answer model fills from the steps above.
      // The orchestrator never invents them, so this step is left to the answer turn.
      id: 'bid_decision', tool: 'evaluate_bid_decision', needs: ['documents', 'incumbent', 'customer'],
      args: () => ({ skip: 'needs gates and ratings from the answer model; not filled by the orchestrator' }),
    },
  ],
  output: ['pursue_or_pass', 'incumbent_and_price_history', 'what_the_buyer_cares_about', 'question_for_contracting_officer', 'next_move'],
  offerNext: ['teaming_finder', 'sources_sought_response', 'outreach_draft'],
};

const PROFILE_SETUP: Recipe = {
  id: 'profile_setup',
  name: 'Profile setup and readiness',
  priority: 'high',
  examples: ["Here's my website", '(a UEI)', '(first login)'],
  steps: [
    {
      id: 'sam', tool: 'lookup_sam_entity',
      args: (ctx) => {
        const uei = ctx.identifiers?.uei ?? ctx.profile.uei;
        if (uei) return { args: { uei } };
        if (ctx.profile.companyName) return { args: { name: ctx.profile.companyName, ...(first(ctx.profile.states) ? { state: first(ctx.profile.states) } : {}) } };
        return { skip: 'no UEI or company name to look up' };
      },
    },
    {
      id: 'sba_profile', tool: null,
      requirement: 'SBA profile lookup (spec section 6, NEW). Input: uei. Output: owner and contacts, capabilities narrative, keywords, past performance, certification types with dates and self-reported vs SBA-certified. Unknown fields returned as null, never empty strings.',
      // Eric, 2026-11-21: not accelerated. Profile Setup uses the verified fields above (SAM entity, award
      // history, derived keywords) and reports these as unknown until the tool exists.
      unknownFields: ['owner', 'sba_capabilities_narrative', 'sba_keywords', 'certification_dates', 'sba_certified_status'],
    },
    {
      id: 'awards', tool: 'get_contractor_award_history', needs: ['sam'],
      args: (ctx, prior) => {
        const uei = ctx.identifiers?.uei ?? ctx.profile.uei ?? pick(prior, 'sam', ['uei', 'ueiSAM']);
        const company = ctx.profile.companyName ?? pick(prior, 'sam', ['legal_business_name', 'legalBusinessName', 'name']);
        return uei || company ? { args: { ...(uei ? { uei } : { company }) } } : { skip: 'company not identified' };
      },
    },
    {
      id: 'keywords', tool: 'derive_company_keywords', needs: ['sam'],
      args: (ctx, prior) => {
        const company = ctx.profile.companyName ?? pick(prior, 'sam', ['legal_business_name', 'legalBusinessName', 'name']);
        const naics = first(ctx.profile.naicsCodes) ?? pick(prior, 'sam', ['primary_naics', 'primaryNaics']);
        return company || naics
          ? { args: { ...(company ? { brand_exclude: company } : {}), ...(naics ? { naics } : {}) } }
          : { skip: 'nothing known to derive keywords from' };
      },
    },
  ],
  output: ['saved_profile', 'readiness_checklist', 'missing_fields', 'next_move'],
  offerNext: ['where_to_start'],
};

/** Declared, not built yet: the classifier may name them; planning one says not_implemented. */
function declared(id: RecipeId, name: string, priority: Recipe['priority'], examples: string[]): Recipe {
  return { id, name, priority, examples, steps: [], output: [] };
}

export const RECIPES: Readonly<Record<RecipeId, Recipe>> = {
  where_to_start: WHERE_TO_START,
  opportunity_deep_dive: OPPORTUNITY_DEEP_DIVE,
  profile_setup: PROFILE_SETUP,
  event_plan: declared('event_plan', 'Event plan', 'high', ["I'm going to NVSBE", '(an event link)']),
  buyer_brief: declared('buyer_brief', 'Buyer brief', 'high', ['Tell me about the Coast Guard']),
  teaming_finder: declared('teaming_finder', 'Teaming finder', 'medium', ['Who should I team with on this?']),
  sources_sought_response: declared('sources_sought_response', 'Sources sought response', 'medium', ['Help me answer this RFI']),
  price_check: declared('price_check', 'Price check', 'medium', ['What should I charge for a General Clerk II?']),
  outreach_draft: declared('outreach_draft', 'Outreach draft', 'medium', ['Draft an email to the small business office']),
  general_research: declared('general_research', 'General research', 'low', ['(anything that fits no recipe)']),
};

export function isImplemented(id: RecipeId): boolean {
  return RECIPES[id].steps.length > 0;
}
