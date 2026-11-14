import { describe, it, expect } from 'vitest';
import { listMcpTools } from './tool-registry';
import {
  HIDDEN_FROM_PUBLIC_MCP,
  PUBLIC_MCP_TOOLS,
  auditPublicCatalog,
  isPublicMcpTool,
  listPublicMcpTools,
} from './public-catalog';
import { mcpRegistrationList } from './tool-schemas';

const name = (t: Record<string, unknown>) => (t.function as { name: string }).name;

/** Approved 2026-10-02 (audit Phase 1): 12 candidates → 11 after match_company_to_pathways was kept. */
const APPROVED_HIDDEN = [
  'add_contacts_to_crm',
  'build_proposal_structure',
  'export_proposal',
  'extract_statement_of_work',
  'get_agency_budget_trends',
  'get_incumbent_financials',
  'get_proposal_job',
  'get_regulatory_demand',
  'one_click_proposal',
  'search_sbir',
  'verify_m_scale',
];

/**
 * Ask Mindy Phase 1 (2026-11-14): tools built for NATIVE Ask Mindy only. Hidden from every
 * external MCP surface; publishing or pricing them for MCP needs a separate owner review.
 */
const ASK_MINDY_ONLY = ['get_buying_offices', 'get_vehicle_spend_mix'];
const ALL_HIDDEN = [...APPROVED_HIDDEN, ...ASK_MINDY_ONLY].sort();

describe('public MCP catalog', () => {
  it('every registered tool is classified exactly once', () => {
    expect(auditPublicCatalog()).toEqual({ unclassified: [], both: [], unknownPublic: [], unknownHidden: [] });
  });

  it('hides exactly the 11 audit-approved tools plus the Ask-Mindy-only tools', () => {
    expect(Object.keys(HIDDEN_FROM_PUBLIC_MCP).sort()).toEqual(ALL_HIDDEN);
  });

  it('Ask-Mindy-only tools are hidden as plain "hide" (chat offers them), never public', () => {
    for (const t of ASK_MINDY_ONLY) {
      expect(HIDDEN_FROM_PUBLIC_MCP[t]?.decision, t).toBe('hide');
      expect(isPublicMcpTool(t), t).toBe(false);
    }
  });

  it('keeps the Potato journey step public (CAI → Pathway Fit)', () => {
    expect(isPublicMcpTool('match_company_to_pathways')).toBe(true);
    expect(isPublicMcpTool('get_current_acquisition_intelligence')).toBe(true);
    expect(isPublicMcpTool('understand_customer')).toBe(true);
  });

  it('does not touch the high-dependency tools the audit kept', () => {
    // 108 customers depend on search_sam_opportunities; FIND has not won that migration.
    for (const t of ['search_sam_opportunities', 'find_opportunities', 'get_balance']) {
      expect(isPublicMcpTool(t), t).toBe(true);
    }
  });

  it('the internal registry is unchanged: hidden tools stay registered for Chat and composition', () => {
    const internal = listMcpTools().map(name);
    for (const t of ALL_HIDDEN) expect(internal, t).toContain(t);
    expect(internal.length).toBe(PUBLIC_MCP_TOOLS.length + ALL_HIDDEN.length);
  });

  it('the public list is the registry minus the hidden set', () => {
    const pub = listPublicMcpTools().map(name).sort();
    expect(pub).toEqual([...PUBLIC_MCP_TOOLS].sort());
    for (const t of ALL_HIDDEN) expect(pub).not.toContain(t);
  });

  it('the external transport registers ONLY public tools (not listed, not callable)', () => {
    const transport = mcpRegistrationList().map((t) => t.name).sort();
    expect(transport).toEqual([...PUBLIC_MCP_TOOLS].sort());
  });

  it('every hidden entry states a reason', () => {
    for (const [tool, e] of Object.entries(HIDDEN_FROM_PUBLIC_MCP)) {
      expect(e.reason.length, tool).toBeGreaterThan(20);
    }
    expect(HIDDEN_FROM_PUBLIC_MCP.get_regulatory_demand.decision).toBe('hide_reconsider');
  });
});
