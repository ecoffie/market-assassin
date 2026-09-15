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
 * Clients surface this as connector guidance. Covers: guided next steps (`_next`),
 * confirmation before paid/watch/delivery writes, and schedule-discovery routing.
 */
export const MCP_CONNECTOR_INSTRUCTIONS = [
  'Mindy is federal contracting intelligence. Customers use ordinary language — they should',
  'not need tool names or a memorized workflow.',
  '',
  'Guided next steps:',
  '- After each successful tool result, look for the `_next` block. Offer its primary',
  '  suggestion in plain English. Occasionally offer the secondary too — never dump a',
  '  generic menu of every tool.',
  '- `_next` is a suggestion, not permission. When `requires_confirmation` is true',
  '  (paid calls, creating a watch/schedule, changing delivery), explain the action and',
  '  credit cost, then wait for the user to ask you to proceed. Do not auto-run those tools.',
  '- Common arc: search opportunities → offer to monitor; relevant opp → bid-fit or',
  '  incumbent; bid assessment done → pursuit dossier or compliance checklist; market',
  '  report → investigate top buyers.',
  '- Only cite facts returned by tools. If `_meta.grounded` is false, say so honestly —',
  '  do not invent agencies, dollars, or incumbents.',
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
].join('\n');
