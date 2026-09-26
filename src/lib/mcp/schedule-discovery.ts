/**
 * Shared MCP scheduling discovery copy — title, tool description, and connector
 * instructions must stay in sync so Claude (and any MCP client) routes natural
 * "monitor / schedule / watch / keep me updated" language to schedule_market_search
 * without requiring the user to say "alerts."
 *
 * Consumed by: tool-registry, tool-schemas, hosted transport, stdio server, tests.
 */

import {
  HOST_RULES_ACT,
  HOST_RULES_MONITOR,
  HOST_RULES_POSITION,
  HOST_RULES_TALENT_THIN,
  POTATO_JOURNEY_INSTRUCTIONS,
} from './potato-journey';

/** Phrases customers use that MUST map to schedule_market_search for procurement searches. */
export const SCHEDULE_DISCOVERY_PHRASES = [
  'schedule this',
  'run this search every week',
  'monitor this market',
  'keep me updated',
  'email me new opportunities',
  'create a watch',
] as const;

export type ScheduleDiscoveryPhrase = (typeof SCHEDULE_DISCOVERY_PHRASES)[number];

export const SCHEDULE_MARKET_SEARCH_TITLE =
  'Schedule / Monitor Market Search (watch + email updates)';

/**
 * Hosted + stdio tool description. Leads with discovery language, not "alerts."
 * Keep technical facts (saved_searches, cadence presets, no free-form recipient).
 */
export const SCHEDULE_MARKET_SEARCH_DESCRIPTION =
  'Create a recurring procurement-market watch from Opportunity Map filters — the SAME ' +
  'saved_searches rows the Map uses (daily/weekly cadence). Use this tool when the user ' +
  'says any of: "schedule this", "run this search every week", "monitor this market", ' +
  '"keep me updated", "email me new opportunities", or "create a watch" — even if they ' +
  'never say "alerts". Preserve every requested filter and cadence; unsupported filter ' +
  'keys are REJECTED (never silently dropped into a broader watch). Cadence presets only: ' +
  'daily | weekly | paused — no clock times (e.g. 9am). If the user asks for an exact ' +
  'time, explain those three options and get confirmation BEFORE saving. Emails go to the ' +
  'authenticated Mindy account only; do NOT pass a recipient email. Returns schedule_id, ' +
  'cadence, canonical filters, map_url (?ss=), and alert_destination=account_email. ' +
  'Idempotent: identical filter+cadence returns the existing schedule. Before telling the ' +
  'user that scheduling is unavailable, list/inspect available tools — this tool is ' +
  'schedule_market_search.';

/**
 * MCP initialize `instructions` — shared by hosted HTTP edge and stdio.
 * Clients surface this as connector guidance; keep it short and action-oriented.
 */
export const MCP_CONNECTOR_INSTRUCTIONS = [
  POTATO_JOURNEY_INSTRUCTIONS,
  '',
  'TALENT THIN:',
  ...HOST_RULES_TALENT_THIN,
  '',
  'POSITION:',
  ...HOST_RULES_POSITION,
  '',
  'ACT:',
  ...HOST_RULES_ACT,
  '',
  'MONITOR:',
  ...HOST_RULES_MONITOR,
  '- "Yes" / "keep going" on a prior journey question is NOT watch confirmation.',
  '  Only call schedule_market_search after an explicit yes to "Want me to watch this for you?"',
  '',
  'Finding opportunities (PRIMARY):',
  '- LEGISLATION is not a finding intent. NDAA / Congress bill status / H.R. or S. number / public law / "has it become',
  '  law" → call get_legislation_status ONCE — not find_opportunities, lookup_solicitation or get_regulatory_demand.',
  '  It returns stored status + links only; Mindy does not hold bill text.',
  '- HISTORICAL / KNOWN_ID SHORT-CIRCUIT P2 FIND-first. If the user named a notice UUID or solicitation id,',
  '  or is looking up a past bid/submission/proposal ("I submitted…", "what happened with…", "the solicitation we…"),',
  '  call lookup_solicitation ONCE. Do NOT call find_opportunities first. Closed ≠ gone. MATCHED_CANDIDATE is not identity.',
  '- When the user wants to find opportunities, what is available, what is coming, or a market hunt',
  '  (e.g. "cybersecurity in Florida" or "I sell cybersecurity to SOCOM — help me"), call find_opportunities ONCE',
  '  using the user\'s words — NOT search_sam_opportunities alone. Do not ask qualification questions first.',
  '- If find_opportunities errors, say the finder failed. Do NOT substitute get_agency_intel or',
  '  pain-points as "where the money is." Unavailable is not zero demand.',
  '- find_opportunities returns three independent horizons: OPEN NOW, COMING BACK, COMING SOON.',
  '  An empty Open result is not a market-wide zero if other horizons hit. Never invent a solicitation',
  '  number for a recompete or forecast. Obey presentation.host_rules on that result: present first value,',
  '  one FIND only, then one plain-English refine, then WAIT. Do not auto-call UNDERSTAND or CAI on this turn.',
  '  Do not call find_opportunities a second time or in parallel before presenting.',
  '- search_sam_opportunities remains for advanced SAM/Open-only searches.',
  '- After first value + refine (or the user asks to continue), when `_next` offers UNDERSTAND, call understand_customer',
  '  (notice_id + agency) — not get_agency_intel alone. UNDERSTAND is confirmation-gated — do not auto-call it.',
  '- Present understand_customer under its presentation.sections titles, in order:',
  '  (1) What we can verify from this opportunity/buyer,',
  '  (2) What broader Mindy research indicates,',
  '  (3) What that suggests you emphasize.',
  '  Say each section’s provenance_label BEFORE listing claims. Never headline curated research',
  '  as what the customer "actually cares about." Soften inferences ("may be more persuasive")',
  '  — do not invent buyer evaluation facts.',
  '- After UNDERSTAND, offer `_next` (what changed about how they buy) and wait. Do NOT close UNDERSTAND with',
  '  "what is your set-aside?" — set-aside is only relevant when opportunity evidence makes it so.',
  '  After PATHWAY FIT + TALENT THIN, draft capability statements / responses / meeting briefs from journey',
  '  evidence only (Potato POSITION). Do not auto-run paid or write tools.',
  '- Watch/email coverage today is Open now + Coming soon only; Coming back is not emailed yet — say so.',
  '',
  'Scheduling / monitoring procurement searches:',
  '- When the user wants to schedule a search, run it on a cadence, monitor a market,',
  '  keep them updated, email new opportunities, or create a watch — call',
  '  schedule_market_search (not a generic "alerts" product name). Use list_market_schedules',
  '  / update_market_schedule / delete_market_schedule to manage existing watches.',
  '- Always inspect the available tool list before saying scheduling or monitoring is',
  '  unavailable. If schedule_market_search is listed, use it.',
  '- Preserve the customer\'s requested filters and cadence. Never drop unsupported',
  '  filters and activate a broader watch — if a filter is unsupported, report the error',
  '  and ask them to adjust.',
  '- Cadence supports only daily, weekly, or paused. If they ask for an exact clock time',
  '  (e.g. "every Monday at 9am"), explain those options and confirm before saving.',
  '- Until recompete alerts ship, do not claim Coming back / recompetes are watched by email.',
  '',
  'Current Acquisition Intelligence (after first value + UNDERSTAND, not on the FIND turn):',
  '- After UNDERSTAND, or when the user asks what CHANGED about how a buyer is buying, call',
  '  get_current_acquisition_intelligence — not pain-points JSON, not generic BD advice. Do not auto-call CAI before first value is shown.',
  '- It returns cited OBSERVED_CHANGE + CURRENT_STATE sections, pathway evidence only, and a capability/door',
  '  _next prompt — never set-aside-first.',
  '- Obey presentation.host_rules on the tool result. Especially:',
  '  • Empty what_that_may_mean / do_differently → invent nothing (no urgency, no strategy add-ons).',
  '  • Never describe a failed/unavailable horizon (_meta.sources_failed) as zero demand.',
  '  • pathways.observed = record evidence only — not certainty about future acquisition vehicles.',
  '  • Do not say "the competition already happened", "the binding constraint is", or "whatever replaces X',
  '    is where the money goes next" unless the package citations explicitly establish that.',
  '',
  'PATHWAY FIT (after Current Acquisition Intelligence confirms):',
  '- When matching a company to doors becomes necessary, ask: "Which company should I match against what I found?"',
  '  Options: My company / A company I\'m helping / Keep this market-level for now. Then call',
  '  match_company_to_pathways. Resolve UEI internally. Do not ask company identity on the FIND turn. Obey presentation.host_rules on that result.',
  '- summary.no_proven_door === true is a complete successful result. Say: no door I can prove yet —',
  '  "I don\'t have enough evidence to establish an acquisition door for this company yet." Then what you',
  '  can verify, what is missing, and what would change the answer. That is intelligence. Do not apologize.',
  '- After no_proven_door: do NOT restart find_opportunities, do NOT offer a numbered research menu',
  '  (search opportunities / research awards / inspect the company), do NOT offer dossier or monitor,',
  '  do NOT manufacture a possible pathway. Ask at most the result\'s `_next` prompt (one proof question).',
  '  If `_next` is empty, STOP the door step. Never ask set-aside-first.',
  '- After a positive door result, TALENT THIN is the proof_to_lead_with + one `_next` missing-proof question.',
  '  Then POSITION (capability statement / response / meeting) → one ACT → MONITOR only with confirmation.',
].join('\n');
