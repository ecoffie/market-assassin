/**
 * Every tool that can run with no required parameter is either refused without an identifier
 * or listed here as genuinely useful with none. A new optional-only tool fails this test until
 * someone decides which it is.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({}), getReadClient: () => ({}) }));
import { REQUIRED_ONE_OF, preflightPaidInput } from './credit-integrity';
import { listMcpTools } from './tool-registry';

type Fn = { name: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } };
const tools = (listMcpTools() as unknown as { function: Fn }[]).map((t) => t.function);

/** Optional filters over a real corpus, or a tool whose own no-input outcome is already non-billable. */
const USEFUL_OR_SELF_GUARDED = new Set([
  'get_pricing_intel', 'get_regulatory_demand', // validation_error → not billed
  'capability_market_match', // nonbillable_no_market
  'generate_market_report', // measurement_failure → not billed
  'search_contractors', 'search_grants', 'search_govcon_jobs', 'get_agency_forecasts', 'search_sbir',
  'get_expiring_contracts', 'search_idv_contracts', 'search_past_contracts',
  'search_federal_contacts', 'get_federal_event_series',
  'get_balance', 'list_market_schedules', 'verify_m_scale',
  'evaluate_bid_decision', // scored=false: returns the gate/factor framework
  'one_click_proposal', // hidden; not exercised empty because it creates a job
]);

describe('REQUIRED_ONE_OF', () => {
  it('classifies every tool with no required parameter', () => {
    const unclassified = tools
      .filter((t) => !(t.parameters?.required ?? []).length)
      .map((t) => t.name)
      .filter((n) => !REQUIRED_ONE_OF[n] && !USEFUL_OR_SELF_GUARDED.has(n));
    expect(unclassified).toEqual([]);
  });

  it('every declared identifier is a real parameter of that tool', () => {
    for (const [name, keys] of Object.entries(REQUIRED_ONE_OF)) {
      const props = tools.find((t) => t.name === name)?.parameters?.properties ?? {};
      for (const k of keys) expect(Object.keys(props), `${name}.${k}`).toContain(k);
    }
  });

  it('refuses each tool with no identifier, and a filter alone is not an identifier', () => {
    for (const name of Object.keys(REQUIRED_ONE_OF)) {
      expect(preflightPaidInput(name, {})?.code, name).toBe('invalid_input');
    }
    expect(preflightPaidInput('lookup_sam_entity', { state: 'FL' })?.code).toBe('invalid_input');
    expect(preflightPaidInput('search_agency_opps_by_office', { naics: '541512' })?.code).toBe('invalid_input');
    expect(preflightPaidInput('get_current_acquisition_intelligence', { window_days: 30 })?.code).toBe('invalid_input');
  });

  it('accepts the non-string identifier shapes those tools declare', () => {
    expect(preflightPaidInput('derive_company_keywords', { capabilities: ['welding'] })).toBeNull();
    expect(preflightPaidInput('derive_company_keywords', { capabilities: [] })?.code).toBe('invalid_input');
    expect(preflightPaidInput('match_company_to_pathways', { cai: { summary: 'x' } })).toBeNull();
    expect(preflightPaidInput('match_company_to_pathways', { cai: {} })?.code).toBe('invalid_input');
    expect(preflightPaidInput('get_current_acquisition_intelligence', { naics: ['541512'] })).toBeNull();
  });

  it('names the wrong key and the right one in the refusal', () => {
    const r = preflightPaidInput('get_contractor_award_history', {}, [{ name: 'company_name', did_you_mean: 'company' }]);
    expect(r?.message).toContain('Unrecognized parameter company_name. Did you mean company?');
    expect(r?.message).toMatch(/nothing was charged/i);
  });
});
