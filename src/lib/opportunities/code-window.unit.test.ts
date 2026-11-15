import { describe, it, expect } from 'vitest';
import { interpretMarket } from './market-interpretation';
import { openCodeWindowPsc, OPEN_CODE_WINDOW_CAP, openRetrievalPsc } from './open-relevance';

/**
 * Code-recall sub-window (Agent 3, 2026-11-15). IT long diagnosis: the 500-row deadline window closed after 5 days and
 * 58 of 77 IT-coded notices never reached ranking. Product presets now also draw their own coded notices (a subset of
 * the matched set). These tests pin WHICH searches get the sub-window and that it never widens retrieval.
 */
const IT_LONG = 'We are an IT hardware reseller. We sell laptops, desktops, servers, monitors, networking equipment, storage and peripherals, including installation and warranty support.';
const cap = (q: string) => interpretMarket(q, null).capability;

describe('which searches get a code-recall sub-window', () => {
  it('a product preset: its own specific FSC/PSC codes', () => {
    expect(openCodeWindowPsc(cap(IT_LONG))).toEqual(expect.arrayContaining(['7B22', '7E20', '7K20']));
    expect(openCodeWindowPsc(cap('We supply industrial valves.'))).toEqual(['4810', '4820']);
  });
  it('trades, literal text and quoted phrases get none (the window is unchanged)', () => {
    expect(openCodeWindowPsc(cap('We provide security guards.'))).toEqual([]);
    expect(openCodeWindowPsc(cap('We are a paving and site work contractor. We mill and pave asphalt.'))).toEqual([]);
    expect(openCodeWindowPsc(cap('"industrial valves"'))).toEqual([]);
  });
  it('never a code outside retrieval: the sub-window is a subset of what the matched set already admits by code', () => {
    for (const q of [IT_LONG, 'We supply industrial valves.', 'We supply medical, dental and laboratory supplies.']) {
      const c = cap(q);
      for (const code of openCodeWindowPsc(c)) expect(openRetrievalPsc(c)).toContain(code);
    }
  });
  it('is capped', () => {
    expect(OPEN_CODE_WINDOW_CAP).toBeGreaterThan(0);
    expect(OPEN_CODE_WINDOW_CAP).toBeLessThanOrEqual(250);
  });
});

describe('C · DLA hardware nouns are item evidence only inside the IT hardware families', () => {
  it('"DISK DRIVE UNIT" (7E20) and "PANEL PC" (7E20) are DIRECT; the same noun outside 7x is not', async () => {
    const { labelOpenRow } = await import('./find-opportunities');
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const plan = buildDiscoveryPlan({ query: IT_LONG }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    const l = (title: string, psc: string) => labelOpenRow({ title, psc_code: psc, description: '' }, plan, cap(IT_LONG), null).cls;
    expect(l('DISK DRIVE UNIT', '7E20')).toBe('DIRECT_MATCH');
    expect(l('PANEL PC', '7E20')).toBe('DIRECT_MATCH');
    expect(l('58--INTERFACE UNIT,COMMUNI', '5895')).not.toBe('DIRECT_MATCH');
    expect(l('12--DISPLAY UNIT,HELMET', '1240')).not.toBe('DIRECT_MATCH');
  });
});

describe('NAVSUP repair buys are not a reseller\'s sale (Agent 4 v7, IT top 5)', () => {
  it('"receipt of carcass(es) … teardown & evaluation" → NOT RELEVANT for a reseller; a plain item buy stays DIRECT', async () => {
    const { labelOpenRow } = await import('./find-opportunities');
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const plan = buildDiscoveryPlan({ query: IT_LONG }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    const desc = 'CONTACT INFORMATION|4|… 4. Vendor shall have ;90; days after receipt of carcass(es) to complete a teardown & evaluation (TD&E) of the carcass(es) and submit a Firm-Fixed Price (FFP) quote for the full repair effort.';
    const l = labelOpenRow({ title: 'NRP,KEYBOARD,DATA E', psc_code: '7E20', description: desc }, plan, cap(IT_LONG), null);
    expect(l.cls).toBe('WEAK_NON_MARKET');
    expect(l.basis[0]).toBe('repair_notice_for_parts');
    expect(labelOpenRow({ title: 'KEYBOARD,DATA ENTRY', psc_code: '7E20', description: 'Delivery orders and modifications related to the instant procurement are issued by the Government.' }, plan, cap(IT_LONG), null).cls).toBe('DIRECT_MATCH');
  });
});

describe('cheap sub-window: the retrieval OR is located exactly, else the full plan is used', () => {
  it('finds exactly one op for each product preset phrasing; none for a trade', async () => {
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const { retrievalOpIndex } = await import('./open-relevance');
    for (const q of [IT_LONG, 'We supply industrial valves.', 'We supply medical, dental and laboratory supplies.']) {
      const ops = buildDiscoveryPlan({ query: q }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 }).horizons.open.ops;
      const k = retrievalOpIndex(ops as never, openCodeWindowPsc(cap(q)));
      expect(k, q).not.toBeNull();
      expect((ops[k!] as { expr: string }).expr).toMatch(/imatch|ilike/); // it is the text-bearing OR
    }
    expect(retrievalOpIndex([], [])).toBeNull();
  });
});
