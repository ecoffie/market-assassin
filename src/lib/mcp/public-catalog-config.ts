/**
 * Public MCP catalog CONFIG — pure data, no imports, safe for client components.
 * The registry-aware helpers (listPublicMcpTools, auditPublicCatalog) live in
 * public-catalog.ts. See that file for the contract.
 */
export type HiddenDecision = 'hide' | 'hide_reconsider' | 'hide_until_fixed';

export interface HiddenToolEntry {
  decision: HiddenDecision;
  /** One line: why an external host should not select this tool today. */
  reason: string;
}

/** Explicit allowlist. Sorted. Every name must be a registered tool. */
export const PUBLIC_MCP_TOOLS: readonly string[] = [
  'assess_market_depth',
  'build_pursuit_dossier',
  'capability_market_match',
  'delete_market_schedule',
  'derive_company_keywords',
  'draft_proposal',
  'draft_proposal_section',
  'evaluate_bid_decision',
  'extract_compliance_matrix',
  'find_capable_contractors',
  'find_opportunities',
  'find_predecessor_award',
  'generate_market_report',
  'get_agency_forecasts',
  'get_agency_intel',
  'get_agency_spending_detail',
  'get_award_detail',
  'get_balance',
  'get_contractor_award_history',
  'get_contractor_profile',
  'get_current_acquisition_intelligence',
  'get_expiring_contracts',
  'get_federal_event_series',
  'get_keyword_coverage',
  'get_legislation_status',
  'get_market_vocabulary',
  'get_pricing_intel',
  'get_recipient_annual_obligations',
  'get_sba_goaling_share',
  'get_sblo_contact',
  'get_solicitation_documents',
  'get_solicitation_incumbent',
  'get_winning_playbook',
  'list_market_schedules',
  'lookup_federal_osbp',
  'lookup_sam_entity',
  'lookup_solicitation',
  'match_company_to_pathways',
  'match_recompete_sow',
  'referee_proposal_compliance',
  'scan_proposal_compliance',
  'schedule_market_search',
  'search_agency_opps_by_office',
  'search_contractors',
  'search_federal_contacts',
  'search_federal_events',
  'search_grants',
  'search_idv_contracts',
  'search_past_contracts',
  'search_podcast_lessons',
  'search_sam_opportunities',
  'understand_customer',
  'update_market_schedule',
];

/** Registered but not listed to external MCP hosts. Implementation is kept. */
export const HIDDEN_FROM_PUBLIC_MCP: Readonly<Record<string, HiddenToolEntry>> = {
  verify_m_scale: {
    decision: 'hide',
    reason: 'QA oracle (npm run verify:m-scale), not a customer job.',
  },
  add_contacts_to_crm: {
    decision: 'hide_until_fixed',
    reason: '0 customers ever connected a CRM; the only customer "success" was a charged no-op. Re-expose only with live end-to-end proof.',
  },
  one_click_proposal: {
    decision: 'hide_until_fixed',
    reason: 'Async job drops the caller identity (draft built without their Vault) and bills at enqueue. Re-expose only with live end-to-end proof.',
  },
  get_proposal_job: {
    decision: 'hide_until_fixed',
    reason: 'Polling helper for one_click_proposal; hidden with it.',
  },
  search_sbir: {
    decision: 'hide_until_fixed',
    reason: 'SBIR coverage is 1 of ~11 agencies; the feed is parked.',
  },
  get_agency_budget_trends: {
    decision: 'hide_until_fixed',
    reason: 'change_percent is a ratio (USDA -18.3% returns 0.81685) and the data is the FY26 request.',
  },
  export_proposal: {
    decision: 'hide',
    reason: 'Pipeline step (.docx render); the proposal flow runs it internally.',
  },
  build_proposal_structure: {
    decision: 'hide',
    reason: 'Pipeline step (outline); the proposal flow runs it internally.',
  },
  extract_statement_of_work: {
    decision: 'hide',
    reason: 'Subset of get_solicitation_documents at a higher price; 0 customer calls.',
  },
  get_regulatory_demand: {
    decision: 'hide_reconsider',
    reason: '0 customer calls in 30 days and an unsourced "before SAM" claim. Hidden, not retired: reconsider with outcome telemetry.',
  },
  get_incumbent_financials: {
    decision: 'hide',
    reason: 'Composed inside build_pursuit_dossier; 1 customer call in 90 days as a standalone tool.',
  },
};

const PUBLIC_SET: ReadonlySet<string> = new Set(PUBLIC_MCP_TOOLS);

/** True when an external MCP host may list and call this tool. */
export function isPublicMcpTool(name: string): boolean {
  return PUBLIC_SET.has(name);
}
