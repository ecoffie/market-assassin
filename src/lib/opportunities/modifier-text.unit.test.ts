import { describe, it, expect } from 'vitest';
import { interpretMarket } from './market-interpretation';
import { labelOpenRow } from './find-opportunities';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/**
 * N2 / N2b (Agent 3, 2026-11-15; nursing diagnosis + Agent 4 v7: nursing long 5 of 23 relevant reach the top 20).
 * Titles are real open notices that held nursing-long ranks 4-20 as RELATED; descriptions are trimmed to the words that
 * matched. Business descriptions are Agent 4's public phrasings.
 */
const CTX = { today: '2026-11-15', fiscalYear: 2027 };
const NURSING = 'We are a healthcare staffing firm. We place registered nurses, licensed practical nurses, nursing assistants and other clinical staff in hospitals, clinics and medical facilities.';
const label = (q: string, title: string, psc: string | null, description: string) =>
  labelOpenRow({ title, psc_code: psc, description }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretMarket(q, null).capability, null);

describe('N2: text sharing only where / for-whom words is NOT RELEVANT (long descriptions)', () => {
  it('a notice whose text only names the kind of facility is not evidence of the work', () => {
    const l = label(NURSING, 'Grounds Maintenance Services', 'S208', 'Services at the hospitals and clinics of the medical center.');
    expect(l.cls).toBe('WEAK_NON_MARKET');
    expect(l.basis[0]).toBe('modifier_words_only');
  });
});

describe('N2b: a trade in a long description needs its own vocabulary in the requirement text', () => {
  it('generic sector words ("healthcare", "clinical", "practical") in VA boilerplate are NOT RELEVANT', () => {
    for (const t of ['F108--Contaminated Soil Disposal', 'Z1MG--Annual REC Solar Panel Maintenance', 'R408--FY27 Lean and High Reliability Organization Transformation']) {
      const l = label(NURSING, t, 'F108', 'VA Healthcare System. Contractor shall coordinate with clinical staff; as practical, work in medical facilities.');
      expect(l.cls, t).toBe('WEAK_NON_MARKET');
    }
  });
  it('requirement text that uses the trade\'s vocabulary stays RELATED (clinical staffing that asks for registered nurses)', () => {
    const l = label(NURSING, 'Q701--7 Full Time Equivalent Medical Technologists - Clinical Laboratory', 'Q701', 'The contractor shall provide medical technologists and a registered nurse for the clinical laboratory.');
    expect(l.cls).toBe('RELATED_MARKET_CANDIDATE');
  });
  it('the trade\'s own code is still DIRECT; a short description is untouched', () => {
    expect(label(NURSING, 'License Practical Nurse (LPN)', 'Q401', '').cls).toBe('DIRECT_MATCH');
    expect(label('We provide nurses and medical staffing.', 'F108--Contaminated Soil Disposal', 'F108', 'VA Healthcare System nurses station').cls).not.toBe('WEAK_NON_MARKET');
  });
});
