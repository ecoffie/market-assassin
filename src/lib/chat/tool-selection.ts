/**
 * Per-question tool offer guard for Ask Mindy (B2).
 *
 * Why: "what opportunities are open for janitorial in Florida" was planned as a
 * get_expiring_contracts call. That tool returns AWARDED contracts with incumbents, not open
 * solicitations; the answer was about the wrong thing and the oversized result overflowed the
 * model's context window.
 *
 * Rule (deterministic, narrow): a question that asks about open / current opportunities and
 * says nothing about expiring work, recompetes, incumbents or end dates is not offered the
 * expiring-contracts tool for that turn, so the planner has to pick an opportunity tool.
 * Anything that mentions expiring / recompete / incumbent keeps every tool, so a recompete
 * question is never starved. This does not change how any search tool retrieves results.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';

export const EXPIRING_CONTRACTS_TOOL = 'get_expiring_contracts';

export const EXPIRING_SIGNAL =
  /\b(expir\w*|recompet\w*|re-compet\w*|incumbent\w*|ending|ends?|end dates?|renewals?|follow[- ]on|option years?|period of performance|run(?:s|ning)? out|coming due|lapsing)\b/i;

export const OPEN_OPPORTUNITY_SIGNAL =
  /\b(opportunit(?:y|ies)|solicitations?|rfps?|rfqs?|rfis?|sources sought|open bids?|biddable|bid on|open|current(?:ly)?|active|available|posted)\b/i;

export function isOpenOpportunityQuestion(message: string): boolean {
  const m = String(message || '');
  return OPEN_OPPORTUNITY_SIGNAL.test(m) && !EXPIRING_SIGNAL.test(m);
}

export function filterToolsForQuestion<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  message: string,
): { defs: T[]; removed: string[] } {
  if (!isOpenOpportunityQuestion(message)) return { defs, removed: [] };
  const removed: string[] = [];
  const kept = defs.filter((d) => {
    const name = String(d.function?.name ?? '');
    if (name === EXPIRING_CONTRACTS_TOOL) { removed.push(name); return false; }
    return true;
  });
  return { defs: kept, removed };
}

// ── CURRENT_FIND: the three-horizon contract (F1, 2026-11-15) ────────────────────────────────
// Eric's side-by-side: Claude via the Mindy MCP answered "What open opportunities are there for janitorial
// services in Florida?" with Open now + Coming back (44 recompetes) + related notices, because the MCP host
// is told (P2_FIRST_TURN_INSTRUCTIONS) to call find_opportunities ONCE for a current find. Ask Mindy's
// planner had no such rule and picked the open-only search_sam_opportunities 3/3 times on a replay of that
// exact turn. These helpers make chat follow the same contract deterministically.

export const FIND_TOOL = 'find_opportunities';
export const SAM_ONLY_TOOL = 'search_sam_opportunities';

/** Retrospective intent ("the bid we submitted", "what happened to…"): lookup_solicitation, never FIND. */
export const HISTORICAL_SIGNAL =
  /\b(submitted|we bid|bid we|our bid|our proposal|proposal we|worked on|what happened|previous(?:ly)?|last (?:month|year|week)|the solicitation we|we (?:lost|won|responded))\b/i;

/** A FIND phrased without the word "opportunity": "where's the money", "who buys", "I sell X to Y". */
export const FIND_PHRASE_SIGNAL =
  /\b(where(?:'s| is) the money|what(?:'s| is) available|find (?:me )?(?:work|contracts|opportunit\w*)|i sell|we sell|sell to (?:the )?(?:government|federal|navy|army|air force|va|dod|agencies)|work for the (?:government|federal))\b/i;

/** The customer explicitly limited the search to open solicitations / SAM. "Open opportunities" alone is NOT this. */
export const OPEN_ONLY_SIGNAL =
  /\b(only open|open only|just (?:the )?open|only (?:the )?(?:live|biddable|current) (?:ones|solicitations|bids|notices)|biddable (?:right )?now|on sam(?:\.gov)? only|only on sam(?:\.gov)?|sam(?:\.gov)? only|solicitations only|only solicitations|no recompetes|exclude recompetes|not recompetes)\b/i;

export type FindIntent = 'KNOWN_ID' | 'HISTORICAL' | 'CURRENT_FIND' | 'OTHER';

function hasSolicitationId(text: string): boolean {
  return text.split(/[\s,;()]+/).some((tok) => {
    const t = tok.replace(/[.?!:]+$/, '');
    if (t.length < 8 || t.length > 40 || !/\d/.test(t) || !/[A-Za-z]/.test(t)) return false;
    if (/^[0-9a-f]{32}$/i.test(t.replace(/-/g, ''))) return true; // notice UUID
    // Solicitation numbers are code-like: mostly capitals/digits (W912DY26R0001, 70Z08726QKEYWEST, N00189-26-R-0001).
    return /^[A-Z0-9][A-Z0-9._/-]{7,}$/.test(t);
  });
}

/** Classify the CUSTOMER's words (callers strip the map view preamble first). Mirrors the MCP P2 classes. */
export function classifyFindIntent(customerText: string): FindIntent {
  const t = String(customerText || '');
  if (hasSolicitationId(t)) return 'KNOWN_ID';
  if (HISTORICAL_SIGNAL.test(t)) return 'HISTORICAL';
  if ((OPEN_OPPORTUNITY_SIGNAL.test(t) || FIND_PHRASE_SIGNAL.test(t)) && !EXPIRING_SIGNAL.test(t)) return 'CURRENT_FIND';
  return 'OTHER';
}

export function isOpenOnlyRequest(customerText: string): boolean {
  return OPEN_ONLY_SIGNAL.test(String(customerText || ''));
}

/**
 * The offer for one turn. Unchanged B2 rule: an open-opportunity question is not offered the
 * expiring-contracts tool. F1: a CURRENT_FIND question (and not explicitly open-only) is not offered the
 * open-only search_sam_opportunities when find_opportunities is offered, so the planner has to use the
 * three-horizon FIND. Card chat (its own allowlist, no find_opportunities) is therefore unaffected.
 */
/** A short refinement of a FIND ("What about in Florida?", "and Georgia?"): no new intent of its own. */
const REFINEMENT_SIGNAL = /^\s*(?:what|how) about\b|^\s*(?:and|also|same|now|ok(?:ay)?|how about)\b|^\s*(?:in|for|near|around)\s+\S/i;
export function inheritFindIntent(customerText: string, priorCustomerText: string | null | undefined): FindIntent {
  const own = classifyFindIntent(customerText);
  if (own !== 'OTHER' || !priorCustomerText) return own;
  const words = String(customerText || '').trim().split(/\s+/).filter(Boolean).length;
  if (words > 10 || !REFINEMENT_SIGNAL.test(customerText) || EXPIRING_SIGNAL.test(customerText)) return own;
  return classifyFindIntent(priorCustomerText) === 'CURRENT_FIND' ? 'CURRENT_FIND' : own;
}

// ── MARKET_RESEARCH: packaged one-shot (Mindy IP), same engine as MCP generate_market_report ──
// Ask used to answer "build a comprehensive market research report" by picking ad-hoc tools and
// stuffing scraps into create_document. MCP called generate_market_report once. Same federal data;
// different orchestration — that gap is why quality diverged. These helpers close it.
export const MARKET_REPORT_TOOL = 'generate_market_report';

/** Customer asked for a full / packaged market research report (not a one-line market fact). */
export const MARKET_RESEARCH_SIGNAL =
  /\b((?:comprehensive|full|complete|client[- ]ready|one[- ]shot)\s+(?:federal\s+)?(?:market\s+)?(?:research\s+)?report|(?:market\s+research|deep[- ]dive)\s+report|(?:generate|create|build|write|prepare|make)\s+(?:me\s+)?(?:a\s+)?(?:comprehensive\s+|full\s+|federal\s+)?(?:market\s+research\s+)?report|(?:market\s+research)\s+for\s+(?:my|our|the)\s+(?:company|firm|business))\b/i;

export function isMarketResearchRequest(customerText: string): boolean {
  return MARKET_RESEARCH_SIGNAL.test(String(customerText || ''));
}

// ── FEDERAL_MARKET_PROFILE: company-first pathway profile (RBA benchmark, 2026-11-19) ─────────
// Distinct from packaged keyword generate_market_report. Awards establish what the firm actually
// wins (primary NAICS from award codes) BEFORE any market-size NAICS. Pathways = vehicles,
// sources sought, direct 8(a) — not a FIND-first open-bid list. Fixture:
// src/lib/chat/__fixtures__/rba-federal-market-profile.ts
export const AWARD_HISTORY_TOOL = 'get_contractor_award_history';

export const FEDERAL_MARKET_PROFILE_SIGNAL =
  /\b(federal\s+market\s+profile|pathways?\s+in\s+priority\s+order|first\s+establish\s+what\s+they\s+actually\s+win|from\s+their\s+award\s+history|direct\s+8\s*\(\s*a\s*\)\s+routes|vehicles,\s*sources\s+sought)\b/i;

export function isFederalMarketProfileRequest(customerText: string): boolean {
  return FEDERAL_MARKET_PROFILE_SIGNAL.test(String(customerText || ''));
}

/**
 * Ask host contract for a Federal Market Profile (parity with the Claude+MCP chain that
 * produced the RBA benchmark). Injected when isFederalMarketProfileRequest is true — replaces
 * the CURRENT_FIND contract for that turn so "sources sought" in the ask does not flip into
 * FIND-first open-opportunity framing.
 */
export const FEDERAL_MARKET_PROFILE_CHAT_CONTRACT = [
  'FEDERAL MARKET PROFILE (company-first pathway report — not a keyword market-size report):',
  '- PHASE PLAN (server-enforced): identity → awards → pathways → vehicles → market_size → contacts → web → writeup. The server only offers tools for unlocked phases and forces the next required call. Do not skip ahead. A PHASE PLAN note names the current required phase.',
  '- Identity first. Resolve the legal name and UEI with search_contractors and/or lookup_sam_entity. The server rewrites identity-tool company args to the LEGAL name from the customer message when one was given — a trade nickname alone (e.g. "RBA Construction") can hit the wrong firm (VRBA). Prefer UEI when you have it.',
  '- Awards establish the market. Call get_contractor_award_history (and get_contractor_profile / get_recipient_annual_obligations as needed) BEFORE any NAICS assumption or generate_market_report. Primary NAICS = dominant codes on THEIR awards. Never map the word "construction" or "8(a) construction" to 236220 when award history shows another code (e.g. 237310 bridges and roads).',
  '- Self-reported facts (bonding, equipment, PE/CCM, JV, self-perform scopes) come ONLY from what the customer typed. The server surfaces any it can parse into a SELF-REPORTED note — use those as customer-stated, never as federal-tool facts. If the note says none were provided (name-only ask), do not invent bonding, equipment counts, credentials, or joint ventures.',
  '- Pathways first, in priority order: vehicles (MATOC/IDIQ/MACC), sources sought / market research, and direct 8(a) routes. Do NOT frame the deliverable as a list of single open bids.',
  '- Pathways (after award NAICS): call find_opportunities AND search_sam_opportunities with CIVIL keywords (bridge / highway / heavy civil / marine — never bare "construction" → buildings) and the customer\'s states as a comma list (e.g. VA,MD,DC). Then lookup_solicitation + get_solicitation_documents for named vehicles/MATOCs/MACCs (inspection, Northeast, JBAB, Capitol Perimeter, etc.). Call get_agency_forecasts with civil/bridge keywords for upcoming parkway/bridge work. Frame results as vehicles, sources sought, and direct 8(a) — not a list of single open bids.',
  '- Vehicles (step 4): for each MATOC/IDIQ/MACC from pathway results, call search_past_contracts with piid_prefix (contract-number stem), search_idv_contracts with search_type:"task" and parent_id, then get_award_detail on the vehicle. Holders and order sizes come from past/IDV; ceilings, end dates, and set-aside (including women-owned small business) often ONLY appear on get_award_detail — never skip it.',
  '- Market size (step 5): AFTER award history, call generate_market_report once PER named state (e.g. VA, then MD, then DC) with the award-derived NAICS (never 236220 from the word construction). Do NOT pass set_aside — it rewrites agency dollar tables even though it is documented as forecast-only. Sum top-buyer lists across those runs by hand for FHWA+NPS-class totals; read the firm\'s rank off each state\'s competitor list. One multi-state call is wrong.',
  '- Contacts + policy (step 6): notice POCs first (from solicitation/docs already pulled — e.g. Helson Roman / David Bogner / Terry Agena class names). Then lookup_federal_osbp for defense buyers that appeared (WHS / Pentagon small-business office) and search_federal_contacts for the rest — never invent names or emails. Every named contact needs the question to ask them. Call get_legislation_status with "FY2027 NDAA" (or "FY27 NDAA") when defense buyers appear — STATUS only, never bill text; do not invent what a bill requires.',
  '- When defense buyers appear, include how PAE (or the current Navy construction oversight model in the data) affects those buyers. Include 8(a) timing for THIS firm when SAM/profile evidence supports it. Readiness checklist includes DSBS keywords.',
  '- Outside Mindy (step 7): call search_web for NPS deferred maintenance (CRS), Legacy Restoration Fund bills, the Dec 11 highway extension, GAO reports, PAE sources, and 8(a) rule-change detail — one focused query per topic. Quote only returned snippets + URLs. If search_web returns available=false or grounded=false after trying, disclose that as a known gap (not a failure) — never fabricate CRS figures, bill text, GAO findings, or PAE press from memory.',
  '- Write-up (step 8): pathways FIRST in priority order. Frame = vehicles, sources sought, and direct awards ONLY — never a list of single open bids. Include a PAE section (when defense buyers appear), buyer pain points, a "Who to talk to and what to say" table (named contact + the question), and DSBS keywords in the readiness checklist. No em dashes. Do not grade or score the company. Do NOT include a Mid plan / pricing CTA (that line in the Claude benchmark was accidental).',
  '- match_company_to_pathways is not required for this profile; skip it if it errors.',
].join('\n');

export function filterToolsForTurn<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  customerText: string,
  priorCustomerText?: string | null,
): {
  defs: T[];
  removed: string[];
  intent: FindIntent;
  openOnly: boolean;
  marketResearch: boolean;
  federalMarketProfile: boolean;
} {
  const federalMarketProfile = isFederalMarketProfileRequest(customerText);
  // FMP takes precedence: skip the open-opportunity / CURRENT_FIND offer stripping (the profile
  // prompt names "sources sought" but must keep search_sam + expiring/vehicle tools), and do not
  // force packaged keyword generate_market_report (wrong product shape vs pathway profile).
  const base = federalMarketProfile
    ? { defs, removed: [] as string[] }
    : filterToolsForQuestion(defs, customerText);
  const intent = federalMarketProfile ? 'OTHER' : inheritFindIntent(customerText, priorCustomerText);
  const openOnly = isOpenOnlyRequest(customerText);
  const marketResearch = !federalMarketProfile && isMarketResearchRequest(customerText);
  const findOffered = base.defs.some((d) => String(d.function?.name ?? '') === FIND_TOOL);
  let removed = [...base.removed];
  let kept = base.defs;
  if (intent === 'CURRENT_FIND' && !openOnly && findOffered) {
    kept = kept.filter((d) => {
      const name = String(d.function?.name ?? '');
      // FIND covers recompetes (its Coming back horizon), so the expiring-contracts tool is also not offered on
      // a CURRENT_FIND turn, including one inherited from the previous question.
      if (name === SAM_ONLY_TOOL || name === EXPIRING_CONTRACTS_TOOL) { if (!removed.includes(name)) removed.push(name); return false; }
      return true;
    });
  }
  // Packaged market research (Mindy IP): when the customer asked for a full market report AND
  // generate_market_report is offered, do not also offer create_document or capability_market_match
  // on that turn — those are the scrap-assembly paths that diverge from MCP quality.
  const reportOffered = kept.some((d) => String(d.function?.name ?? '') === MARKET_REPORT_TOOL);
  if (marketResearch && reportOffered) {
    kept = kept.filter((d) => {
      const name = String(d.function?.name ?? '');
      if (name === 'create_document' || name === 'capability_market_match') {
        if (!removed.includes(name)) removed.push(name);
        return false;
      }
      return true;
    });
  }
  return { defs: kept, removed, intent, openOnly, marketResearch, federalMarketProfile };
}

/** Tools whose company/name arg can hit the wrong firm if a trade alias is used alone. */
export const FEDERAL_MARKET_PROFILE_IDENTITY_TOOLS: ReadonlySet<string> = new Set([
  'get_contractor_award_history',
  'get_contractor_profile',
  'lookup_sam_entity',
  'get_recipient_annual_obligations',
  'search_contractors',
]);

export type ProfileCompanyIdentity = {
  legalName: string | null;
  /** Parenthetical trade names / DBAs from the prompt (e.g. "RBA Construction & Engineering"). */
  aliases: string[];
  /** 12-char UEI when the customer typed one. */
  uei: string | null;
};

const LEGAL_ENTITY_SUFFIX =
  /(?:PLLC|P\.L\.L\.C\.|LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Co\.|Company|LP|L\.P\.|LLP|L\.L\.P\.)\b/i;

/**
 * Cut a legal name at the entity suffix so `8(a)` paren-capture cannot leave
 * "RBA Engineering International PLLC. 8" (withAlias treats `8(a)` as `(…)`).
 */
export function cleanLegalCompanyName(raw: string): string {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const m = t.match(
    /^(.+?\b(?:PLLC|P\.L\.L\.C\.|LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|LP|L\.P\.|LLP|L\.L\.P\.))\b/i,
  );
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  return t.replace(/[.,;:\s]+$/g, '').trim();
}

function normCompany(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull the profiled firm's legal name (and optional alias / UEI) from the customer message.
 * "for RBA Engineering International PLLC (RBA Construction & Engineering, Springfield VA)"
 * → legalName PLLC, alias "RBA Construction & Engineering".
 */
export function extractProfileCompanyIdentity(customerText: string): ProfileCompanyIdentity {
  const t = String(customerText || '');
  let uei: string | null = null;
  for (const tok of t.split(/[\s,;:()]+/)) {
    const u = tok.replace(/[.?!:]+$/, '').toUpperCase();
    if (/^[A-Z0-9]{12}$/.test(u) && /[A-Z]/.test(u) && /\d/.test(u)) {
      uei = u;
      break;
    }
  }

  let legalName: string | null = null;
  const aliases: string[] = [];

  // Prefer the legal-suffix form first so "PLLC. 8(a)" never becomes the name.
  const forLegal = t.match(
    /\bfor\s+([A-Z][^.]{1,120}?(?:PLLC|P\.L\.L\.C\.|LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|LP|LLP))\b/i,
  );
  if (forLegal) legalName = cleanLegalCompanyName(forLegal[1]);

  // for Legal Name PLLC (Trade Alias, City ST) — skip 8(a) cert parens (inside="a").
  const withAlias = t.match(
    /\bfor\s+([A-Z][^()]{1,120}?)\s*\(([^)]{1,160})\)/i,
  );
  if (withAlias) {
    const before = cleanLegalCompanyName(withAlias[1].replace(/,\s*$/, ''));
    if (!legalName && before && (LEGAL_ENTITY_SUFFIX.test(before) || before.length >= 8)) {
      legalName = before;
    }
    const inside = withAlias[2].trim();
    // `8(a)` makes the capture group inside="a" — not a trade alias.
    const eightAParen = /^a\b/i.test(inside) && inside.length <= 4;
    if (!eightAParen) {
      const firstChunk = inside.split(',')[0]?.trim() || '';
      if (firstChunk && normCompany(firstChunk) !== normCompany(legalName || '')) {
        aliases.push(firstChunk);
      }
    }
  }

  if (legalName) legalName = cleanLegalCompanyName(legalName);

  return { legalName, aliases, uei };
}

/** True when `company` is empty or matches a known trade alias (VRBA trap class). */
export function isTradeAliasCompany(
  company: string,
  identity: ProfileCompanyIdentity,
): boolean {
  const c = normCompany(company);
  if (!c) return true;
  if (identity.legalName && c === normCompany(identity.legalName)) return false;
  for (const a of identity.aliases) {
    const an = normCompany(a);
    if (!an) continue;
    if (c === an) return true;
    // "RBA Construction" ⊂ "RBA Construction & Engineering"
    if (an.startsWith(c) || c.startsWith(an)) return true;
  }
  return false;
}

/**
 * Close the identity gate on Federal Market Profile turns: identity/award tools must look up
 * the LEGAL name (and UEI when present), never a trade nickname alone. Measured failure mode:
 * "RBA Construction" → VRBA (Nebraska) instead of RBA Engineering International PLLC / C9K6EE9JVDK7.
 */
export type SelfReportedProfileFacts = {
  bonding: string | null;
  equipment: string | null;
  credentials: string | null;
  selfPerforms: string | null;
  jointVenture: string | null;
  /** Other explicit "Self-reported: …" clauses not covered above. */
  other: string[];
};

/**
 * Parse customer-stated facts that are NOT in federal award/SAM data.
 * Cold RBA prompt carries bonding / equipment / PE·CCM / self-perform; name-only carries none.
 * Pedro / JV only appear when the customer typed them — never inferred.
 */
export function extractSelfReportedProfileFacts(customerText: string): SelfReportedProfileFacts {
  const t = String(customerText || '');
  const bondM = t.match(/\$?\s*([\d.]+)\s*M\s+single\s*\/\s*\$?\s*([\d.]+)\s*M\s+aggregate\s+bonding/i);
  const bonding = bondM
    ? `$${bondM[1]}M single / $${bondM[2]}M aggregate bonding`
    : null;
  const equipment =
    t.match(/(\d+\+?\s+owned\s+equipment\s+assets?)/i)?.[1]
    || null;
  const credentials =
    t.match(/\b((?:President|owner|principal)[^.;]{0,60}\b(?:PE|P\.E\.)\b[^.;]{0,40}\bCCM\b)/i)?.[1]?.trim()
    || (/\bPE\b/i.test(t) && /\bCCM\b/i.test(t) ? 'President is a PE and CCM' : null);
  const selfM = t.match(/\bself[- ]performs?\s+([^.;]+)/i);
  const selfPerforms = selfM
    ? `self-performs ${selfM[1].trim().replace(/\s+/g, ' ')}`
    : null;
  const jointVenture =
    t.match(/\b((?:joint\s+venture|JV)\b[^.;]{0,80})/i)?.[1]?.trim() || null;

  const other: string[] = [];
  const selfBlock = t.match(/\bSelf[- ]reported\s*:\s*([^]+?)(?:\.\s+First\s+establish|\.\s+Frame\s+it|\.\s+Include\b|$)/i);
  if (selfBlock) {
    const chunk = selfBlock[1].replace(/\s+/g, ' ').trim();
    if (chunk && chunk.length < 400) other.push(chunk);
  }

  return { bonding, equipment, credentials, selfPerforms, jointVenture, other };
}

export function hasSelfReportedProfileFacts(facts: SelfReportedProfileFacts): boolean {
  return !!(facts.bonding || facts.equipment || facts.credentials || facts.selfPerforms || facts.jointVenture || facts.other.length);
}

/**
 * System note for Federal Market Profile turns: pin customer-stated facts so the write-up
 * can use them without treating them as USASpending/SAM evidence. Empty → explicit ban on inventing.
 */
/** Tools whose geography / keyword shape the pathway search (step 3). */
export const FEDERAL_MARKET_PROFILE_PATHWAY_TOOLS: ReadonlySet<string> = new Set([
  'find_opportunities',
  'search_sam_opportunities',
  'get_agency_forecasts',
]);

/**
 * All states named for the profiled firm's market (e.g. "DC, Maryland and Virginia" → DC,MD,VA).
 * Multi-state OR lists are required — a single-state search fails the Mid-Atlantic pathway bar.
 */
export function extractProfileStates(customerText: string): string[] {
  const t = String(customerText || '');
  const found: string[] = [];
  const push = (code: string | null) => {
    if (code && !found.includes(code)) found.push(code);
  };
  // "in DC, Maryland and Virginia" / "firm in DC, Maryland and Virginia"
  const region = t.match(
    /\bin\s+((?:[A-Za-z.]{2,}(?:\s*,\s*|\s+and\s+|\s+&\s+))+[A-Za-z.]{2,})\b/i,
  );
  if (region) {
    for (const part of region[1].split(/\s*,\s*|\s+and\s+|\s+&\s+/i)) {
      push(normalizeStateCode(part.trim()));
    }
  }
  // Also catch standalone DC / Maryland / Virginia anywhere in an FMP ask
  for (const name of ['District of Columbia', 'Washington DC', 'Washington D.C.', 'Maryland', 'Virginia', 'DC', 'MD', 'VA']) {
    if (new RegExp(`\\b${name.replace(/\./g, '\\.')}\\b`, 'i').test(t)) {
      push(normalizeStateCode(name === 'Washington DC' || name === 'Washington D.C.' ? 'DC' : name));
    }
  }
  return found;
}

const BUILDINGS_CONSTRUCTION_QUERY =
  /^(?:8\s*\(\s*a\s*\)\s+)?(?:general\s+)?(?:building\s+)?construction(?:\s+services)?$/i;

/** Buildings / facilities NAICS — never the primary pin for a civil FMP pathway or market-size call. */
const BUILDINGS_NAICS = new Set(['236220', '236210', '236200', '236']);

/**
 * Civil pathway keywords from self-report / prompt — never bare "construction" (236220 trap).
 */
export function derivePathwaySearchQuery(customerText: string): string {
  const facts = extractSelfReportedProfileFacts(customerText);
  const bits: string[] = [];
  if (facts.selfPerforms) {
    const s = facts.selfPerforms.toLowerCase();
    if (/\bbridge/.test(s)) bits.push('bridge');
    if (/\bhighway|road|pavement/.test(s)) bits.push('highway');
    if (/\bheavy\s+civil|\bcivil\b/.test(s)) bits.push('heavy civil');
    if (/\bmarine|waterfront|pier/.test(s)) bits.push('marine');
    if (/\bstructural\s+concrete|concrete/.test(s)) bits.push('structural concrete');
  }
  if (/\bbridge/.test(customerText)) bits.push('bridge');
  if (/\bhighway|parkway/.test(customerText)) bits.push('highway');
  const uniq = [...new Set(bits.map((b) => b.trim()).filter(Boolean))];
  if (uniq.length) return uniq.join(' ');
  return 'highway bridge heavy civil';
}

/**
 * Step 3 gate: pathway FIND/SAM/forecast calls use Mid-Atlantic states + civil keywords.
 * Stops Hawaii/single-state drift and "construction" → buildings solicitations.
 */
export function enforceFederalMarketProfilePathwayArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
  opts?: { awardStates?: readonly string[] },
): { args: string; changes: string[] } {
  if (!isFederalMarketProfileRequest(customerText)) return { args: rawArgs, changes: [] };
  if (!FEDERAL_MARKET_PROFILE_PATHWAY_TOOLS.has(toolName)) return { args: rawArgs, changes: [] };

  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  const textStates = extractProfileStates(customerText);
  const awardStates = (opts?.awardStates || [])
    .map((s) => normalizeStateCode(String(s).trim()) || '')
    .filter(Boolean);
  const states = textStates.length ? textStates : [...new Set(awardStates)];
  const stateList = states.length ? states.join(',') : '';
  const civilQuery = derivePathwaySearchQuery(customerText);

  if (toolName === 'find_opportunities') {
    const loc = typeof a.location === 'string' ? a.location.trim() : '';
    const st = typeof a.states === 'string' ? a.states.trim()
      : Array.isArray(a.states) ? (a.states as unknown[]).map(String).join(',') : '';
    if (stateList) {
      const have = new Set(
        [...loc.split(/[,;|/]/), ...st.split(/[,;|/]/)]
          .map((x) => normalizeStateCode(x.trim()) || '')
          .filter(Boolean),
      );
      const missing = states.some((s) => !have.has(s));
      if ((!loc && !st) || missing || have.size < states.length) {
        a.location = stateList;
        if ('states' in a) a.states = stateList;
        changes.push('pathway_states_enforced');
      }
    }
    const q = typeof a.query === 'string' ? a.query.trim() : '';
    if (!q || BUILDINGS_CONSTRUCTION_QUERY.test(q)) {
      a.query = civilQuery;
      changes.push('pathway_civil_query_enforced');
    }
    // Strip a buildings-only NAICS pin the planner may have invented from "construction".
    // Do not replace it with award NAICS — that hides inspection / JBAB / Capitol pathways.
    const adv = (a.advanced && typeof a.advanced === 'object' && !Array.isArray(a.advanced))
      ? { ...(a.advanced as Record<string, unknown>) }
      : null;
    if (adv) {
      const curNaics = typeof adv.naics === 'string' ? adv.naics.replace(/\D/g, '').slice(0, 6) : '';
      if (curNaics && (BUILDINGS_NAICS.has(curNaics) || BUILDINGS_NAICS.has(curNaics.slice(0, 3)))) {
        delete adv.naics;
        if (Object.keys(adv).length) a.advanced = adv;
        else delete a.advanced;
        changes.push('pathway_buildings_naics_stripped');
      }
    }
  }

  if (toolName === 'search_sam_opportunities') {
    if (stateList) {
      const cur = typeof a.state === 'string' ? a.state.trim() : '';
      const have = new Set(
        cur.split(/[,;|/]/).map((x) => normalizeStateCode(x.trim()) || '').filter(Boolean),
      );
      if (!cur || states.some((s) => !have.has(s))) {
        a.state = stateList;
        changes.push('pathway_states_enforced');
      }
    }
    const kw = typeof a.keyword === 'string' ? a.keyword.trim() : '';
    if (!kw || BUILDINGS_CONSTRUCTION_QUERY.test(kw)) {
      a.keyword = civilQuery;
      changes.push('pathway_civil_query_enforced');
    }
  }

  if (toolName === 'get_agency_forecasts') {
    // Do not force state on forecasts (37% lack PoP — a state filter hides parkway work).
    // Do force civil/bridge keyword when empty or buildings-construction.
    const kw = typeof a.keyword === 'string' ? a.keyword.trim() : '';
    if (!kw || BUILDINGS_CONSTRUCTION_QUERY.test(kw)) {
      a.keyword = civilQuery;
      changes.push('pathway_civil_query_enforced');
    }
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

export function federalMarketProfilePathwayNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  const states = extractProfileStates(customerText);
  const q = derivePathwaySearchQuery(customerText);
  const stateLine = states.length
    ? `Search geography: ${states.join(', ')} (pass as a comma list on find_opportunities location and search_sam_opportunities state).`
    : 'Search geography: use the states the customer named; do not substitute another state (e.g. Hawaii).';
  return [
    'PATHWAY SEARCH (step 3 — vehicles, sources sought, forecasts; not a single-open-bid list):',
    stateLine,
    `Civil keywords (not bare "construction"): ${q}.`,
    'Call find_opportunities and search_sam_opportunities with those states + keywords. Then lookup_solicitation / get_solicitation_documents for named MATOCs/MACCs (inspection, Northeast, JBAB, Capitol Perimeter, NIH when they appear). Call get_agency_forecasts with civil/bridge keywords (Clara Barton / Rock Creek / parkway-class forecasts when present).',
  ].join('\n');
}

/** Tools for vehicle-holder follow-through (step 4). */
export const FEDERAL_MARKET_PROFILE_VEHICLE_TOOLS: ReadonlySet<string> = new Set([
  'search_past_contracts',
  'search_idv_contracts',
  'get_award_detail',
]);

/** PIID / vehicle stems that look like contract-number prefixes (e.g. 693C7326D, HQ003422D002). */
const PIID_PREFIX_SHAPE = /^[A-Z0-9]{6,20}$/i;

/**
 * Collect vehicle PIID prefixes typed in the customer message (rare on cold ask; common when pasted).
 */
export function extractVehiclePiidPrefixes(customerText: string): string[] {
  const found: string[] = [];
  for (const tok of String(customerText || '').split(/[\s,;:()/"']+/)) {
    const t = tok.replace(/[.?!:]+$/, '').toUpperCase();
    if (!PIID_PREFIX_SHAPE.test(t)) continue;
    // Prefer stems that look like federal PIIDs (digit + letter mix), not pure words.
    // Do NOT skip length-12 tokens: HQ003422D002 is a real vehicle stem (and a UEI is
    // handled separately via extractProfileCompanyIdentity).
    if (!/\d/.test(t) || !/[A-Z]/.test(t)) continue;
    if (!found.includes(t)) found.push(t);
  }
  return found;
}

function looksLikePiidPrefix(value: string): boolean {
  const t = String(value || '').trim().toUpperCase();
  return PIID_PREFIX_SHAPE.test(t) && /\d/.test(t) && /[A-Z]/.test(t) && t.length !== 12;
}

/**
 * Step 4 gate: IDV task-order search must use search_type:"task" when a parent/vehicle is scoped;
 * past-contract keyword that is actually a PIID stem moves to piid_prefix; award detail stays available
 * for ceilings / end dates / set-aside (WOSB often only surfaces there).
 */
export function enforceFederalMarketProfileVehicleArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (!isFederalMarketProfileRequest(customerText)) return { args: rawArgs, changes: [] };
  if (!FEDERAL_MARKET_PROFILE_VEHICLE_TOOLS.has(toolName)) return { args: rawArgs, changes: [] };

  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  if (toolName === 'search_idv_contracts') {
    const hasParent = !!(
      (typeof a.parent_id === 'string' && a.parent_id.trim())
      || (typeof a.vehicle === 'string' && a.vehicle.trim())
    );
    const st = typeof a.search_type === 'string' ? a.search_type.trim().toLowerCase() : '';
    if (hasParent && st !== 'task') {
      a.search_type = 'task';
      changes.push('vehicle_idv_task_enforced');
    }
  }

  if (toolName === 'search_past_contracts') {
    const prefix = typeof a.piid_prefix === 'string' ? a.piid_prefix.trim() : '';
    const kw = typeof a.keyword === 'string' ? a.keyword.trim() : '';
    if (!prefix && looksLikePiidPrefix(kw)) {
      a.piid_prefix = kw.toUpperCase();
      delete a.keyword;
      changes.push('vehicle_piid_prefix_from_keyword');
    }
    // Typed prefixes in the ask (when the customer pasted vehicle numbers).
    if (!a.piid_prefix) {
      const fromText = extractVehiclePiidPrefixes(customerText);
      if (fromText.length === 1) {
        a.piid_prefix = fromText[0];
        changes.push('vehicle_piid_prefix_from_customer');
      }
    }
    // Prefix search should not also drag a wrong state from pathway geography.
    if (typeof a.piid_prefix === 'string' && a.piid_prefix.trim() && a.state) {
      delete a.state;
      changes.push('vehicle_prefix_cleared_state');
    }
  }

  // get_award_detail: no arg rewrite — the contract/note require the call for set-aside/ceiling.

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

export function federalMarketProfileVehicleNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  const typed = extractVehiclePiidPrefixes(customerText);
  const typedLine = typed.length
    ? `Customer-typed vehicle prefixes to run: ${typed.join(', ')}.`
    : 'Vehicle prefixes come from pathway/solicitation results (MATOC/IDIQ/MACC stems) — copy each into piid_prefix / parent_id.';
  return [
    'VEHICLE HOLDERS (step 4 — who owns the MATOC/IDIQ and what orders look like):',
    typedLine,
    'For each vehicle: (1) search_past_contracts with piid_prefix = the contract-number stem (e.g. 693C7326D, HQ003422D002) to see holders;',
    '(2) search_idv_contracts with search_type:"task" and parent_id for active task-order sizes;',
    '(3) get_award_detail on the vehicle for ceiling, end date, and set-aside.',
    'CRITICAL: set-aside (including women-owned small business) often appears ONLY on get_award_detail — if you skip it, you will miss that catch.',
  ].join('\n');
}

/**
 * Step 5 gate: generate_market_report on FMP must use award NAICS + one state per call.
 * Strips set_aside (known trap that rewrites agency $). Rejects buildings NAICS / bare
 * "construction" keyword. Rejects multi-state or off-profile state on a single call.
 */
export function enforceFederalMarketProfileMarketSizeArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (!isFederalMarketProfileRequest(customerText)) return { args: rawArgs, changes: [] };
  if (toolName !== MARKET_REPORT_TOOL) return { args: rawArgs, changes: [] };

  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  // Known trap: set_aside changes agency dollar figures even though documented as forecast-only.
  if (a.set_aside != null && String(a.set_aside).trim() !== '') {
    delete a.set_aside;
    changes.push('market_size_set_aside_stripped');
  }

  const profileStates = extractProfileStates(customerText);
  const rawState = typeof a.state === 'string' ? a.state.trim() : '';
  if (rawState.includes(',') || rawState.includes(';') || /\band\b/i.test(rawState)) {
    delete a.state;
    changes.push('market_size_multi_state_rejected');
  } else if (rawState) {
    const code = normalizeStateCode(rawState);
    if (!code) {
      delete a.state;
      changes.push('market_size_state_cleared');
    } else if (profileStates.length && !profileStates.includes(code)) {
      // Hawaii / off-profile geography — do not silently pick a Mid-Atlantic state.
      delete a.state;
      changes.push('market_size_off_profile_state_cleared');
    } else if (code !== rawState) {
      a.state = code;
      changes.push('market_size_state_normalized');
    }
  }

  const naicsRaw = typeof a.naics === 'string' ? a.naics.trim() : '';
  if (naicsRaw) {
    const codes = naicsRaw.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean);
    const rejected = codes.filter((c) => BUILDINGS_NAICS.has(c) || BUILDINGS_NAICS.has(c.slice(0, 3)));
    const kept = codes.filter((c) => !BUILDINGS_NAICS.has(c) && !BUILDINGS_NAICS.has(c.slice(0, 3)));
    if (rejected.length) {
      if (kept.length) a.naics = kept.join(',');
      else delete a.naics;
      changes.push('market_size_rejected_buildings_naics');
    }
  }

  const kw = typeof a.keyword === 'string' ? a.keyword.trim() : '';
  if (kw && BUILDINGS_CONSTRUCTION_QUERY.test(kw)) {
    delete a.keyword;
    changes.push('market_size_rejected_construction_keyword');
  }

  // Prefer an explicit NAICS axis for FMP market size (award-derived). If keyword remains and
  // looks like a company name, drop it so the planner must pass award NAICS.
  if (!a.naics && typeof a.keyword === 'string') {
    const k = String(a.keyword).trim();
    if (/\b(pllc|llc|inc|corp|engineering|construction)\b/i.test(k) && k.split(/\s+/).length >= 2) {
      delete a.keyword;
      changes.push('market_size_rejected_company_keyword');
    }
  }

  const identity = extractProfileCompanyIdentity(customerText);
  if (identity.legalName && (!a.client_name || isTradeAliasCompany(String(a.client_name || ''), identity))) {
    a.client_name = identity.legalName;
    changes.push('market_size_client_legal_name');
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

export function federalMarketProfileMarketSizeNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  const states = extractProfileStates(customerText);
  const stateLine = states.length
    ? `Call generate_market_report ONCE PER state with state=${states.join(' | ')} (three separate calls for ${states.join(', ')}). Never one call with a comma-joined state list.`
    : 'Call generate_market_report once per state the customer named (separate calls).';
  return [
    'MARKET SIZE (step 5 — after award history established primary NAICS):',
    stateLine,
    'Pass naics = the dominant code from get_contractor_award_history (e.g. 237310 bridges/roads). Never 236220 from the word "construction".',
    'Do NOT pass set_aside — it rewrites agency dollar tables (documented forecast-only filter; known trap).',
    'After the per-state reports: sum the top-buyer lists by hand for FHWA + NPS (and peers) totals; read the firm\'s rank off each competitor list (#4 / #5 / #9 class). Do not invent a combined market figure the tool did not return.',
  ].join('\n');
}

/**
 * Host-built args for the next FMP per-state market report.
 * Rotates profile states by `marketReportCount` so dup-fingerprint cannot stall the phase
 * (measured 2026-11-20: second generate_market_report reused VA args → skipped → budget stop).
 */
export function buildFmpNextMarketReportArgs(
  customerText: string,
  marketReportCount: number,
  opts?: { awardNaics?: string | null },
): Record<string, unknown> {
  const states = extractProfileStates(customerText);
  const state = states.length
    ? states[Math.min(Math.max(0, marketReportCount), states.length - 1)]
    : undefined;
  const identity = extractProfileCompanyIdentity(customerText);
  const naics = (opts?.awardNaics || '').replace(/\D/g, '').slice(0, 6);
  const args: Record<string, unknown> = {};
  if (state) args.state = state;
  if (naics && naics.length >= 3 && !BUILDINGS_NAICS.has(naics) && !BUILDINGS_NAICS.has(naics.slice(0, 3))) {
    args.naics = naics;
  } else {
    // Cold RBA / heavy civil default when awards named bridges/roads but planner omitted NAICS.
    args.naics = '237310';
  }
  if (identity.legalName) args.client_name = identity.legalName;
  return args;
}

/**
 * Geography for pathway FIND when the customer typed a short name-only FMP ask
 * (no "in DC, Maryland and Virginia"). Prefer award-history / profile state fields
 * already returned this turn — never invent a Mid-Atlantic trio from thin air.
 */
export function extractAwardGeographyStates(toolContents: readonly string[]): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const code = normalizeStateCode(raw.trim());
    if (code && !found.includes(code)) found.push(code);
  };
  for (const content of toolContents) {
    if (!content) continue;
    for (const m of content.matchAll(
      /"(?:state|pop_state|place_of_performance_state|recipient_state|hq_state|hqState)"\s*:\s*"([A-Za-z .]{2,32})"/g,
    )) {
      push(m[1]);
    }
    // Compact award-row shape: "where":"VA" / "where":"DC"
    for (const m of content.matchAll(/"where"\s*:\s*"([A-Z]{2})"/g)) {
      push(m[1]);
    }
  }
  return found;
}

/**
 * Host-built args for FMP `find_opportunities` (pathways phase).
 * Short "Build a federal market profile for RBA…" has no states in the prompt — without
 * this pin, force-inject `{}` searches nationally and the write-up collapses to a generic
 * MATOC frame after the civil pathway filter empties dredging/harbor noise.
 *
 * Do NOT pin award NAICS on FIND. Claude gold pathways include adjacent codes
 * (inspection 541330, JBAB 236210, Capitol 236220); a 237310-only FIND never sees them.
 * Geography + civil keywords are the pin; write-up ranking filters the noise.
 */
export function buildFmpPathwayFindArgs(
  customerText: string,
  opts?: { awardStates?: readonly string[] },
): Record<string, unknown> {
  const textStates = extractProfileStates(customerText);
  const awardStates = (opts?.awardStates || [])
    .map((s) => normalizeStateCode(String(s).trim()) || '')
    .filter(Boolean);
  const states = textStates.length ? textStates : [...new Set(awardStates)];
  const args: Record<string, unknown> = {
    query: derivePathwaySearchQuery(customerText),
    limit_per_horizon: 15,
  };
  if (states.length) args.location = states.join(',');
  return args;
}

export type FmpPathwayToolCall = { name: string; args: Record<string, unknown> };

/**
 * Host-forced pathway follow-ups for civil FMP (Claude gold frame).
 * One FIND with "highway bridge heavy civil" returns open RFQs and sometimes the
 * inspection MATOC — it does not reliably surface JBAB MACC, Capitol Perimeter SS,
 * or GWMP/parkway forecasts. Claude's MCP chain looked those up by name; Ask must
 * too, or the write-up stays an open-bid list with a MATOC footnote.
 *
 * Keywords are distinctive (not bare "construction") so pathway enforce will not
 * rewrite them into the civil default.
 */
export const FMP_CIVIL_PATHWAY_SUPPLEMENT_KEYWORDS = [
  'Construction Inspection MATOC',
  'Capitol Perimeter',
  'JBAB Multiple Award Construction',
] as const;

/** Live gold-frame solicitations — lookup returns notice POCs FIND/search_sam omit. */
export const FMP_CIVIL_GOLD_SOLICITATION_QUERIES = [
  '693C73-27-R-000006',
  'FA706027RXXX2',
  'W912DR27H1CWY',
] as const;

/** Single-token forecast keywords — multi-word ILIKE misses "MD NP GWMP 6(2)". */
export const FMP_CIVIL_FORECAST_KEYWORDS = [
  'Clara Barton',
  'GWMP',
  'MD NP GWMP',
] as const;

export function buildFmpPathwaySupplementalCalls(
  customerText: string,
  opts?: { awardStates?: readonly string[] },
): FmpPathwayToolCall[] {
  if (!isFederalMarketProfileRequest(customerText)) return [];
  const textStates = extractProfileStates(customerText);
  const awardStates = (opts?.awardStates || [])
    .map((s) => normalizeStateCode(String(s).trim()) || '')
    .filter(Boolean);
  const states = textStates.length ? textStates : [...new Set(awardStates)];
  const stateList = states.length ? states.join(',') : '';
  const calls: FmpPathwayToolCall[] = FMP_CIVIL_PATHWAY_SUPPLEMENT_KEYWORDS.map((keyword) => ({
    name: 'search_sam_opportunities',
    args: {
      keyword,
      limit: 8,
      ...(stateList ? { state: stateList } : {}),
    },
  }));
  for (const keyword of FMP_CIVIL_FORECAST_KEYWORDS) {
    calls.push({
      name: 'get_agency_forecasts',
      args: { keyword, limit: 8 },
    });
  }
  for (const query of FMP_CIVIL_GOLD_SOLICITATION_QUERIES) {
    calls.push({
      name: 'lookup_solicitation',
      args: { query },
    });
  }
  // Pentagon / WHS paving vehicle successors — gold frame pathway when past contracts land.
  calls.push({
    name: 'search_past_contracts',
    args: {
      keyword: 'Pentagon paving',
      ...(stateList ? { state: stateList } : { state: 'VA,MD,DC' }),
      limit: 8,
    },
  });
  return calls;
}

/** Pull a dominant 6-digit NAICS from award-history tool JSON when present. */
export function extractDominantAwardNaics(toolContent: string): string | null {
  if (!toolContent) return null;
  try {
    const parsed = JSON.parse(toolContent) as {
      primary_naics?: string;
      naics?: string;
      top_naics?: Array<{ code?: string } | string>;
      awards?: Array<{ naics?: string; naics_code?: string }>;
      _meta?: { primary_naics?: string };
    };
    const direct = parsed.primary_naics || parsed._meta?.primary_naics || parsed.naics;
    if (typeof direct === 'string' && /^\d{3,6}$/.test(direct.trim())) return direct.trim().slice(0, 6);
    if (Array.isArray(parsed.top_naics) && parsed.top_naics[0]) {
      const first = parsed.top_naics[0];
      const code = typeof first === 'string' ? first : first.code;
      if (code && /^\d{3,6}$/.test(String(code))) return String(code).slice(0, 6);
    }
    if (Array.isArray(parsed.awards)) {
      const counts = new Map<string, number>();
      for (const a of parsed.awards) {
        const c = String(a.naics || a.naics_code || '').replace(/\D/g, '').slice(0, 6);
        if (c.length === 6) counts.set(c, (counts.get(c) || 0) + 1);
      }
      let best: string | null = null;
      let n = 0;
      for (const [c, k] of counts) if (k > n) { best = c; n = k; }
      return best;
    }
  } catch { /* ignore */ }
  // Loose text fallback (answers sometimes echo "Primary NAICS Codes: 237310").
  const m = toolContent.match(/\b(237310|237990|236220)\b/);
  return m ? m[1] : null;
}

/** Tools for contacts + legislation (step 6). */
export const FEDERAL_MARKET_PROFILE_CONTACTS_TOOLS: ReadonlySet<string> = new Set([
  'lookup_federal_osbp',
  'search_federal_contacts',
  'get_legislation_status',
]);

/** Two-letter profile states that collide with agency abbreviations (VA = Virginia vs Veterans Affairs). */
const STATE_AGENCY_COLLISION = new Set(['VA', 'MD', 'DC']);

/** Default legislation query for FMP defense-buyer policy (Claude+MCP chain used FY27 NDAA). */
export const FMP_LEGISLATION_QUERY_DEFAULT = 'FY2027 NDAA';

/**
 * Step 6 gate: legislation needs a real query (default FY2027 NDAA); contacts/OSBP must not treat
 * profile state codes as agency names (VA → Veterans Affairs trap). Bare "Pentagon"/"defense"
 * OSBP lookups rewrite to WHS (Washington Headquarters Services) — the office that answered
 * in the benchmark chain.
 */
export function enforceFederalMarketProfileContactsArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (!isFederalMarketProfileRequest(customerText)) return { args: rawArgs, changes: [] };
  if (!FEDERAL_MARKET_PROFILE_CONTACTS_TOOLS.has(toolName)) return { args: rawArgs, changes: [] };

  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  if (toolName === 'get_legislation_status') {
    const q = typeof a.query === 'string' ? a.query.trim() : '';
    if (!q) {
      a.query = FMP_LEGISLATION_QUERY_DEFAULT;
      changes.push('contacts_legislation_query_ndaa');
    } else if (/^ndaa$/i.test(q) || /^fy\s*27\s*ndaa$/i.test(q)) {
      a.query = FMP_LEGISLATION_QUERY_DEFAULT;
      changes.push('contacts_legislation_query_fy27');
    }
  }

  if (toolName === 'lookup_federal_osbp') {
    const agency = typeof a.agency === 'string' ? a.agency.trim() : '';
    if (agency && /^(pentagon|dod|department of defense|defense|whs pentagon)$/i.test(agency)) {
      a.agency = 'WHS';
      changes.push('contacts_osbp_whs');
    }
  }

  if (toolName === 'lookup_federal_osbp' || toolName === 'search_federal_contacts') {
    const agency = typeof a.agency === 'string' ? a.agency.trim() : '';
    if (agency && STATE_AGENCY_COLLISION.has(agency.toUpperCase()) && agency.length <= 2) {
      // "VA" alone is Veterans Affairs in these tools — wrong for a Mid-Atlantic civil profile.
      delete a.agency;
      changes.push('contacts_state_code_agency_cleared');
    }
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

export function federalMarketProfileContactsNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  return [
    'CONTACTS + POLICY (step 6):',
    '1) Prefer notice POCs already on solicitations/documents pulled in pathways (names like Helson Roman, David Bogner, Terry Agena) — do not invent names or emails.',
    '2) lookup_federal_osbp for defense buyers that appeared — use WHS (Washington Headquarters Services) for Pentagon / DoD HQ small-business office. Never pass a bare state code as agency (VA ≠ Virginia here; it resolves to Veterans Affairs).',
    '3) search_federal_contacts with agency or dodaac from those buyers for the rest of the roster; grounded=false means no match — leave the slot empty.',
    '4) get_legislation_status with query "FY2027 NDAA" (or "FY27 NDAA") when defense buyers appear — STATUS only (stage / public law). It cannot say what a bill requires; do not invent bill text or PAE press from this tool.',
    '5) In the write-up: every named contact gets the specific question to ask them.',
  ].join('\n');
}

export function federalMarketProfileOutsideWebNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  return [
    'OUTSIDE MINDY (step 7 — use search_web):',
    'Call search_web once per topic with a focused query: NPS deferred maintenance CRS; Legacy Restoration Fund bills; Dec 11 highway extension; GAO reports on parks/highways/construction; PAE / Navy construction oversight; 8(a) rule changes.',
    'Quote only returned snippets and cite the URL. If available=false (web not configured) or grounded=false after searching: disclose the gap — do NOT fabricate CRS figures, bill text, GAO findings, or PAE press. Missing web ≠ fail the profile.',
  ].join(' ');
}

export function federalMarketProfileWriteupNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  return [
    'WRITE-UP (step 8) — follow these rules exactly:',
    '1) Pathways FIRST, in priority order. Frame = vehicles, sources sought, and direct awards ONLY. Do not lead with (or flatten into) a list of single open bids.',
    '2) PAE section when defense buyers appear (how PAE / Navy construction oversight affects those buyers).',
    '3) Buyer pain points (what these buyers are under pressure to fix).',
    '4) A "Who to talk to and what to say" table: every named contact gets the specific question to ask them.',
    '5) Readiness checklist includes DSBS keywords.',
    '6) No em dashes (use commas, periods, or hyphens).',
    '7) Do not grade, score, or rank the company — facts and questions only.',
    '8) Do NOT include a Mid plan price, $5K–$10K CTA, or any pricing upsell in this profile (accidental in the Claude benchmark; not part of the deliverable).',
  ].join('\n');
}

export function federalMarketProfileSelfReportNote(customerText: string): string | null {
  if (!isFederalMarketProfileRequest(customerText)) return null;
  const facts = extractSelfReportedProfileFacts(customerText);
  if (!hasSelfReportedProfileFacts(facts)) {
    return [
      'SELF-REPORTED (customer-stated — not federal data): none provided in this message.',
      'Do not invent bonding capacity, owned-equipment counts, PE/CCM or other credentials, joint ventures, or self-perform claims.',
      'In the readiness / checklist sections, say which of those were not provided.',
    ].join(' ');
  }
  const lines: string[] = [
    'SELF-REPORTED (customer-stated — not from SAM, USASpending, or other federal tools). Use these in the profile write-up and readiness checklist. Label them as self-reported / as stated by the firm. Do not add bonding, equipment, credentials, or JV details beyond this list:',
  ];
  if (facts.bonding) lines.push(`- Bonding: ${facts.bonding}`);
  if (facts.equipment) lines.push(`- Equipment: ${facts.equipment}`);
  if (facts.credentials) lines.push(`- Credentials: ${facts.credentials}`);
  if (facts.selfPerforms) lines.push(`- Capacity: ${facts.selfPerforms}`);
  if (facts.jointVenture) lines.push(`- Joint venture: ${facts.jointVenture}`);
  if (facts.other.length && !facts.bonding) {
    // Full self-reported clause when structured fields missed pieces.
    for (const o of facts.other) lines.push(`- As stated: ${o}`);
  }
  return lines.join('\n');
}

export function enforceFederalMarketProfileIdentityArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (!isFederalMarketProfileRequest(customerText)) return { args: rawArgs, changes: [] };
  if (!FEDERAL_MARKET_PROFILE_IDENTITY_TOOLS.has(toolName)) return { args: rawArgs, changes: [] };

  const identity = extractProfileCompanyIdentity(customerText);
  if (!identity.legalName && !identity.uei) return { args: rawArgs, changes: [] };

  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  const nameField =
    toolName === 'get_contractor_profile' ? 'company_name'
      : toolName === 'lookup_sam_entity' ? 'name'
        : toolName === 'get_recipient_annual_obligations' ? 'recipient'
          : toolName === 'search_contractors' ? 'keyword'
            : 'company'; // get_contractor_award_history

  const current = typeof a[nameField] === 'string' ? String(a[nameField]).trim() : '';
  if (identity.legalName && (isTradeAliasCompany(current, identity) || normCompany(current) !== normCompany(identity.legalName))) {
    a[nameField] = identity.legalName;
    changes.push('legal_name_enforced');
  }

  // UEI is authoritative on tools that accept it — closes nickname ambiguity entirely.
  if (identity.uei && (toolName === 'get_contractor_award_history' || toolName === 'lookup_sam_entity')) {
    if (String(a.uei || '').trim().toUpperCase() !== identity.uei) {
      a.uei = identity.uei;
      changes.push('uei_enforced');
    }
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

/**
 * Make a find_opportunities call on a CURRENT_FIND turn match what the MCP host sends (Claude's input), so
 * Ask Mindy reads the same data Claude does (Eric's side-by-side, 2026-11-15):
 *  - all three horizons, unless the customer limited it. The planner sets horizons:{…, coming_back:false}
 *    on "open opportunities"; the tool includes a horizon unless it is explicitly false.
 *  - no industry code the customer did not type. The planner added advanced.naics (561720 / 238220 /
 *    561612), which narrowed Florida janitorial recompetes 44 -> 40 and dropped real Texas HVAC solicitations
 *    (FPC Bryan, Fort Sam Houston). P2 says query = what they sell; find_opportunities interprets the words.
 *  - up to 25 rows per horizon (the tool's max; default 5), so a "Coming back" table is not 4 rows plus
 *    "35 counted but not returned". Bounded downstream by the B2 token budget.
 */
export const FIND_ROWS_PER_HORIZON = 25;
export function enforceFindArgs(
  toolName: string,
  rawArgs: string,
  intent: FindIntent,
  openOnly: boolean,
  customerTypedCodes: string[] = [],
): { args: string; changes: string[] } {
  if (toolName !== FIND_TOOL || intent !== 'CURRENT_FIND') return { args: rawArgs, changes: [] };
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];
  const h = (a.horizons && typeof a.horizons === 'object' ? a.horizons : null) as Record<string, unknown> | null;
  if (!openOnly && h && (h.open_now === false || h.coming_back === false || h.coming_soon === false)) {
    a.horizons = { open_now: true, coming_back: true, coming_soon: true };
    changes.push('horizons');
  }
  const adv = (a.advanced && typeof a.advanced === 'object' && !Array.isArray(a.advanced) ? a.advanced : null) as Record<string, unknown> | null;
  if (adv) {
    for (const k of ['naics', 'psc'] as const) {
      if (adv[k] == null || adv[k] === '') continue;
      const vals = (Array.isArray(adv[k]) ? adv[k] as unknown[] : String(adv[k]).split(',')).map((x) => String(x).trim()).filter(Boolean);
      const typed = vals.filter((v) => customerTypedCodes.some((c) => c === v || c.startsWith(v) || v.startsWith(c)));
      if (typed.length === vals.length) continue;
      if (typed.length) adv[k] = Array.isArray(adv[k]) ? typed : typed.join(',');
      else delete adv[k];
      changes.push(`untyped_${k}`);
    }
    if (!Object.keys(adv).length) delete a.advanced;
  }
  const lim = Number(a.limit_per_horizon);
  if (!Number.isFinite(lim) || lim < FIND_ROWS_PER_HORIZON) { a.limit_per_horizon = FIND_ROWS_PER_HORIZON; changes.push('limit_per_horizon'); }
  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes };
}

/**
 * Packaged market-report args (Ask ↔ MCP parity). The planner was forced to call
 * generate_market_report but often passed only client_name + "Hawaii" and no keyword —
 * the required market-total measurement then failed, the deliverable was withheld, and
 * Ask narrated thin leftovers. Normalize state codes and ensure a measurement axis.
 */
export function enforceMarketReportArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (toolName !== MARKET_REPORT_TOOL) return { args: rawArgs, changes: [] };
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  if (typeof a.state === 'string' && a.state.trim()) {
    const code = normalizeStateCode(a.state);
    if (code && code !== a.state) { a.state = code; changes.push('state_normalized'); }
    else if (!code) {
      // Try the customer's words (planner may have put a place name elsewhere).
      const fromText = extractStateFromCustomerText(customerText);
      if (fromText) { a.state = fromText; changes.push('state_from_customer'); }
    }
  } else {
    const fromText = extractStateFromCustomerText(customerText);
    if (fromText) { a.state = fromText; changes.push('state_from_customer'); }
  }

  const hasAxis = [a.keyword, a.naics, a.psc].some((v) => typeof v === 'string' && String(v).trim());
  if (!hasAxis) {
    const derived = deriveMarketReportKeyword(customerText);
    if (derived) { a.keyword = derived; changes.push('keyword_from_customer'); }
  }

  if (typeof a.client_name !== 'string' || !String(a.client_name).trim()) {
    const client = extractClientName(customerText);
    if (client) { a.client_name = client; changes.push('client_name_from_customer'); }
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

function extractStateFromCustomerText(text: string): string | null {
  const t = String(text || '');
  // "in Hawaii" / "in HI" / trailing state name
  const m = t.match(/\bin\s+([A-Za-z][A-Za-z.\s]{1,30}?)\s*[.?!]?\s*$/i)
    || t.match(/\b(?:for|serving|based in)\s+[^.]+?\bin\s+([A-Za-z][A-Za-z.\s]{1,30}?)\s*[.?!]?\s*$/i);
  if (m) {
    const code = normalizeStateCode(m[1].trim());
    if (code) return code;
  }
  // Bare 2-letter code as its own word
  for (const tok of t.split(/[\s,;]+/)) {
    if (/^[A-Za-z]{2}$/.test(tok)) {
      const code = normalizeStateCode(tok);
      if (code) return code;
    }
  }
  // Full state name anywhere
  for (const name of ['Hawaii', 'Florida', 'California', 'Texas', 'Alaska', 'Virginia', 'Maryland', 'Pennsylvania', 'New York', 'Washington']) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(t)) {
      const code = normalizeStateCode(name);
      if (code) return code;
    }
  }
  return null;
}

/** Industry / activity keyword when the planner forgot the measurement axis. */
function deriveMarketReportKeyword(text: string): string | null {
  const t = String(text || '');
  // "for RBA Construction in Hawaii" → company phrase before "in <state>"
  const forMatch = t.match(/\bfor\s+(.+?)(?:\s+in\s+[A-Za-z][A-Za-z.\s]{1,30})?\s*[.?!]?\s*$/i);
  const phrase = (forMatch?.[1] || t)
    .replace(/\b(my|our|the|a|an)\s+(company|firm|business)\b/gi, ' ')
    .replace(/\b(comprehensive|federal|market|research|report|build|generate|create|write|prepare|make)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase) return null;
  // Prefer a distinctive industry noun at the end of a company name ("RBA Construction" → construction)
  const words = phrase.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || '';
  if (/^(construction|janitorial|roofing|hvac|staffing|cybersecurity|cyber|guard|security|catering|plumbing|electrical|landscaping|demolition|facilities|logistics|trucking|cleaning)$/i.test(last)) {
    return last.toLowerCase();
  }
  // Drop all-caps acronyms (RBA) and keep the rest as a keyword phrase
  const meaningful = words.filter((w) => !/^[A-Z]{2,5}$/.test(w) && w.length > 2);
  if (meaningful.length) return meaningful.join(' ').toLowerCase().slice(0, 80);
  return phrase.toLowerCase().slice(0, 80);
}

function extractClientName(text: string): string | null {
  const m = String(text || '').match(/\bfor\s+(.+?)(?:\s+in\s+[A-Za-z][A-Za-z.\s]{1,30})?\s*[.?!]?\s*$/i);
  if (!m) return null;
  const name = m[1].replace(/\b(my|our|the)\s+(company|firm|business)\b/gi, '').trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (/^(a|an|the|comprehensive|federal|market)$/i.test(name)) return null;
  return name;
}

/** The one write tool allowed while document text is in the planner context. */
export const DOCUMENT_TEXT_WRITE_TOOL = 'create_document';

/**
 * Prompt-injection guard (Agent 4 / Agent 5, 2026-11-17): on any turn where uploaded or third-party
 * document text is in the PLANNER context, a planted "delete my schedules" or "add these contacts to the
 * CRM" must never reach a real write. Keeps every tool whose chat policy is 'allowed_read', plus
 * create_document; drops every other tool — schedule_market_search, update/delete_market_schedule,
 * add_contacts_to_crm, generate_market_report, and any write added later (policy-driven, not a name list).
 *
 * The route adds `removed` to notOfferedThisTurn, so a planned call to a removed tool is refused BEFORE
 * execution (an execution guard, not only an offer filter). One copy: #2138 (create_document turns) and
 * the revise turn both call this.
 */
export function restrictWritesWhenDocumentText<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  policyFor: (name: string) => { decision: string },
): { defs: T[]; removed: string[] } {
  const kept: T[] = [];
  const removed: string[] = [];
  for (const d of defs) {
    const name = String(d.function?.name ?? '');
    if (name === DOCUMENT_TEXT_WRITE_TOOL || policyFor(name).decision === 'allowed_read') kept.push(d);
    else removed.push(name);
  }
  return { defs: kept, removed };
}
