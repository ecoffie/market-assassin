import { describe, it, expect } from 'vitest';
import { interpretMarket } from './market-interpretation';

/** DLA NSN parts (Eric 2026-11-15, dev only): a hardware stock-numbered item buy is DIRECT for a replacement-parts supplier. */
const PARTS = 'We supply industrial and defense replacement parts.';
const cap = (q: string) => interpretMarket(q, null).capability;
async function label(q: string, row: Record<string, unknown>) {
  const { labelOpenRow } = await import('./find-opportunities');
  const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
  const { MCP_POLICY } = await import('@/lib/discovery/policy');
  const plan = buildDiscoveryPlan({ query: q }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
  return labelOpenRow(row, plan, cap(q), null).cls;
}
describe('DLA NSN parts', () => {
  it('the parts phrase fires the replacement_parts preset; other product phrases do not', () => {
    expect(cap(PARTS).codePresets?.products).toContain('replacement_parts');
    expect(cap('We supply industrial valves.').codePresets?.products || []).not.toContain('replacement_parts');
  });
  it('hardware NSN item buys are DIRECT (Eric: VALVE,THROTTLE and BEARING)', async () => {
    expect(await label(PARTS, { title: '48--VALVE,THROTTLE', psc_code: '48', description: 'Proposed procurement for NSN 4820014186456 VALVE,THROTTLE: Line 0001 Qty 5' })).toBe('DIRECT_MATCH');
    expect(await label(PARTS, { title: '31--BEARING,BALL,ANNULA', psc_code: '3110', description: 'NSN 3H-3110-009873734-NT, QTY 265 EA. This part requires engineering source approval.' })).toBe('DIRECT_MATCH');
  });
  it('non-hardware FSC (medical 65, food 89, IT 70) and items with no NSN stay non-DIRECT', async () => {
    expect(await label(PARTS, { title: '65--BANDAGE,GAUZE', psc_code: '6510', description: 'NSN 6510-01-234-5678' })).not.toBe('DIRECT_MATCH');
    expect(await label(PARTS, { title: '89--RATIONS', psc_code: '8970', description: 'NSN 8970-01-234-5678' })).not.toBe('DIRECT_MATCH');
    expect(await label(PARTS, { title: 'Hangar door motor', psc_code: '5410', description: 'Furnish and install a motor.' })).not.toBe('DIRECT_MATCH');
  });
  it('the rule never applies to another search', async () => {
    expect(await label('We supply industrial valves.', { title: '31--BEARING,BALL,ANNULA', psc_code: '3110', description: 'NSN 3110-00-987-3734' })).not.toBe('DIRECT_MATCH');
  });
});
