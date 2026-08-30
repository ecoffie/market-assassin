/**
 * Tool → job grouping for the /mcp/tools reference page.
 *
 * WHY THIS FILE EXISTS: `listMcpTools()` is the source of truth for WHICH tools
 * exist, their credits, and their tier — but it carries no "what job is this for"
 * grouping, and it shouldn't (the registry is a dispatch table, not IA). This map
 * adds only the editorial layer: which bucket a tool belongs in, and the one-line
 * "why you'd reach for this" that the raw tool description is too long to serve.
 *
 * THE RULE: this file NEVER decides what is listed. The page renders whatever the
 * live catalog returns; this map only sorts it. A tool missing from here still
 * renders — it lands in "Everything else" and `assertGroupCoverage()` fails the
 * unit test, so the gap is caught in CI instead of silently hiding a tool from the
 * only page that documents them.
 *
 * Names, credits, tiers and descriptions all come from /api/mcp/catalog at runtime.
 * Do not hardcode any of them here.
 */

export interface ToolGroup {
  id: string;
  label: string;
  /** The job, in the user's words — not a category name. */
  blurb: string;
  tools: string[];
}

/**
 * Grouped by what a bidder is trying to DO, not by data source. A contractor
 * looking for teaming partners does not care that one tool reads BigQuery and
 * another reads SAM — they care that both answer "who else can do this work."
 */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'discovery',
    label: 'Opportunity Discovery',
    blurb: "What's open, what's coming, what's expiring — across keywords, buying offices, grants, R&D and vehicles.",
    tools: [
      'search_sam_opportunities',
      'search_agency_opps_by_office',
      'get_agency_forecasts',
      'get_expiring_contracts',
      'search_grants',
      'search_sbir',
      'search_idv_contracts',
      'search_past_contracts',
      'match_recompete_sow',
    ],
  },
  {
    id: 'competitive',
    label: 'Competitive Intelligence',
    blurb: 'Who holds it now, who else can do it, and how strong they are — financially and by track record.',
    tools: [
      'lookup_sam_entity',
      'search_contractors',
      'get_contractor_profile',
      'get_contractor_award_history',
      'get_incumbent_financials',
      'get_recipient_annual_obligations',
      'find_predecessor_award',
      'get_solicitation_incumbent',
      'find_capable_contractors',
    ],
  },
  {
    id: 'market',
    label: 'Market, Pricing & Positioning',
    blurb: 'What to charge, whether it can be set aside, where demand is heading, and the words that win.',
    tools: [
      'get_keyword_coverage',
      'get_pricing_intel',
      'get_regulatory_demand',
      'derive_company_keywords',
      'get_market_vocabulary',
      'search_podcast_lessons',
      'assess_market_depth',
      'get_winning_playbook',
    ],
  },
  {
    id: 'agency',
    label: 'Agency & Award Intelligence',
    blurb: "The buyer's pain points and priorities, its spending and budget trend, and the fine print of one award.",
    tools: [
      'get_agency_intel',
      'get_agency_budget_trends',
      'get_agency_spending_detail',
      'get_sba_goaling_share',
      'get_award_detail',
    ],
  },
  {
    id: 'monitoring',
    label: 'Watchlists & Alerts',
    blurb: 'Save an Opportunity Map filter and get emailed when new matches appear — the same saved search + alert cron the app uses.',
    tools: [
      'schedule_market_search',
      'list_market_schedules',
      'update_market_schedule',
      'delete_market_schedule',
    ],
  },
  {
    id: 'contacts',
    label: 'Contacts & Events',
    blurb: 'The named people at a buying office, the small-business front door, the prime to team with — and where to meet them.',
    tools: [
      'lookup_federal_osbp',
      'search_federal_events',
      'get_federal_event_series',
      'search_federal_contacts',
      'get_sblo_contact',
      'add_contacts_to_crm',
    ],
  },
  {
    id: 'proposal',
    label: 'Proposal Pipeline',
    blurb: 'Decide, extract, structure, draft, referee, export. Each step runs on what you pass it, so an agent can enter anywhere.',
    tools: [
      'evaluate_bid_decision',
      'extract_compliance_matrix',
      'extract_statement_of_work',
      'get_solicitation_documents',
      'build_proposal_structure',
      'draft_proposal',
      'draft_proposal_section',
      'scan_proposal_compliance',
      'referee_proposal_compliance',
      'export_proposal',
    ],
  },
  {
    id: 'combination',
    label: 'Combination Tools',
    blurb: 'Each runs a chain you would otherwise call by hand. Priced higher because they fan out across many of the tools above.',
    tools: [
      'build_pursuit_dossier',
      'capability_market_match',
      'generate_market_report',
      'one_click_proposal',
    ],
  },
  {
    id: 'account',
    label: 'Account & Proof',
    blurb: 'Free utilities. Check a balance, poll a job, or independently re-verify our branded numbers against their oracle.',
    tools: ['get_balance', 'get_proposal_job', 'verify_m_scale'],
  },
];

/** Every tool named in the map above, flattened — for coverage checks. */
export const GROUPED_TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_GROUPS.flatMap((g) => g.tools));

/** Bucket for anything live that this map forgot. Renders, then fails the test. */
export const UNGROUPED_LABEL = 'Everything else';

/**
 * Coverage check used by the unit test: given the LIVE tool names, report what the
 * map missed and what it names that no longer exists. Both directions matter — a
 * stale entry is how a removed tool keeps being documented.
 */
export function assertGroupCoverage(liveNames: string[]): { missing: string[]; stale: string[] } {
  const live = new Set(liveNames);
  return {
    missing: liveNames.filter((n) => !GROUPED_TOOL_NAMES.has(n)).sort(),
    stale: [...GROUPED_TOOL_NAMES].filter((n) => !live.has(n)).sort(),
  };
}
