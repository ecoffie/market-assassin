/**
 * Shared MCP scheduling discovery copy — title, tool description, and connector
 * instructions must stay in sync so Claude (and any MCP client) routes natural
 * "monitor / schedule / watch / keep me updated" language to schedule_market_search
 * without requiring the user to say "alerts."
 *
 * Consumed by: tool-registry, tool-schemas, hosted transport, stdio server, tests.
 */

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
  'Finding opportunities (PRIMARY):',
  '- When the user wants to find opportunities, what is available, what is coming, or a market hunt',
  '  (e.g. "cybersecurity in Florida"), call find_opportunities — NOT search_sam_opportunities alone.',
  '- find_opportunities returns three independent horizons: OPEN NOW, COMING BACK, COMING SOON.',
  '  An empty Open result is not a market-wide zero if other horizons hit. Never invent a solicitation',
  '  number for a recompete or forecast.',
  '- search_sam_opportunities remains for advanced SAM/Open-only searches.',
  '- After a SPECIFIC find hit, when `_next` offers UNDERSTAND, call understand_customer',
  '  (notice_id + agency) — not get_agency_intel alone.',
  '- Present understand_customer under its presentation.sections titles, in order:',
  '  (1) What we can verify from this opportunity/buyer,',
  '  (2) What broader Mindy research indicates,',
  '  (3) What that suggests you emphasize.',
  '  Say each section’s provenance_label BEFORE listing claims. Never headline curated research',
  '  as what the customer "actually cares about." Soften inferences ("may be more persuasive")',
  '  — do not invent buyer evaluation facts.',
  '- After UNDERSTAND, offer `_next` (capability/door ask) and wait. Do NOT close UNDERSTAND with',
  '  "what is your set-aside?" — set-aside is only relevant when opportunity evidence makes it so.',
  '  Do not draft capability statements, outreach emails, responses, or meeting briefs until those tools ship.',
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
  'Current Acquisition Intelligence (after FIND):',
  '- After find_opportunities (or when the user asks what CHANGED about how a buyer is buying), call',
  '  get_current_acquisition_intelligence — not pain-points JSON, not generic BD advice.',
  '- It returns cited OBSERVED_CHANGE + CURRENT_STATE sections, pathway evidence only, and a capability/door',
  '  _next prompt — never set-aside-first.',
].join('\n');
