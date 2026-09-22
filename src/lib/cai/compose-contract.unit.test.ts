/**
 * CAI Phase 1 compose contract — killer rule + internal-first routing.
 */
import { describe, expect, it } from 'vitest';
import {
  CAI_FORBIDDEN_SOURCES,
  CAI_HOST_RULES,
  CAI_MINIMUM_STACK,
  CAI_SECTION_PRESENTATION,
  buildDefaultPotentialNotEstablished,
  clampCaiWindowDays,
  filterByCaiKillerRule,
  isCaiForbiddenSource,
  passesCaiKillerRule,
  routeCaiEvidenceNeed,
  type CaiItem,
} from './compose-contract';

describe('CAI compose contract — Phase 1', () => {
  it('forbids pain / FR / Institute / 1-FY coverage-as-size as buyer-fact sources', () => {
    expect(isCaiForbiddenSource('federal_register_passthrough')).toBe(true);
    expect(isCaiForbiddenSource('agency_pain_points_json')).toBe(true);
    expect(isCaiForbiddenSource('institute_gao_pilot')).toBe(true);
    expect(isCaiForbiddenSource('keyword_coverage_1fy_as_market_size')).toBe(true);
    expect(CAI_FORBIDDEN_SOURCES).not.toContain('sam_opportunities');
  });

  it('routes policy to not_established (no FR gap-fill)', () => {
    const d = routeCaiEvidenceNeed('policy');
    expect(d.action).toBe('not_established');
    expect(d.sources).toEqual([]);
  });

  it('routes change and concentration to owned living sources', () => {
    expect(routeCaiEvidenceNeed('change').action).toBe('use_owned');
    expect(routeCaiEvidenceNeed('change').sources).toContain('recompete_changes');
    expect(routeCaiEvidenceNeed('concentration').sources).toContain('sam_opportunities');
    expect(routeCaiEvidenceNeed('spend').action).toBe('owned_plus_live_verify');
  });

  it('enforces killer rule on do_differently', () => {
    const ok = passesCaiKillerRule({
      item: { epistemic: 'do_differently', caused_by: ['chg_01'] },
      allowedCauseIds: new Set(['chg_01']),
    });
    const bad = passesCaiKillerRule({
      item: { epistemic: 'do_differently', caused_by: [] },
      allowedCauseIds: new Set(['chg_01']),
    });
    const orphan = passesCaiKillerRule({
      item: { epistemic: 'do_differently', caused_by: ['pain_01'] },
      allowedCauseIds: new Set(['chg_01']),
    });
    expect(ok).toBe(true);
    expect(bad).toBe(false);
    expect(orphan).toBe(false);
  });

  it('filters implications that cite non-cause ids', () => {
    const pool: CaiItem[] = [
      {
        id: 'chg_01',
        epistemic: 'observed_change',
        statement: 'Contract moved into final 12 months',
        citations: [],
      },
      {
        id: 'see_01',
        epistemic: 'current_state',
        statement: 'Open demand concentrates at office X',
        citations: [],
      },
    ];
    const actions: CaiItem[] = [
      {
        id: 'act_ok',
        epistemic: 'do_differently',
        statement: 'Engage office X now',
        citations: [],
        caused_by: ['chg_01'],
      },
      {
        id: 'act_bad',
        epistemic: 'do_differently',
        statement: 'Generic BD advice',
        citations: [],
        caused_by: [],
      },
    ];
    const kept = filterByCaiKillerRule(actions, pool);
    expect(kept.map((i) => i.id)).toEqual(['act_ok']);
  });

  it('clamps window_days and always lists potential pathways', () => {
    expect(clampCaiWindowDays(undefined)).toBe(90);
    expect(clampCaiWindowDays(3)).toBe(7);
    expect(clampCaiWindowDays(900)).toBe(365);
    const nym = buildDefaultPotentialNotEstablished('SOCOM', 'cybersecurity');
    expect(nym).toHaveLength(4);
    expect(nym.every((p) => p.established === false)).toBe(true);
    expect(nym[0].statement).toContain('SOCOM');
  });

  it('locks host presentation titles and Phase 0 market-size host rule', () => {
    expect(CAI_SECTION_PRESENTATION.what_changed.display_title).toBe('What changed');
    expect(CAI_HOST_RULES.some((r) => r.includes('keyword-coverage'))).toBe(true);
    expect(CAI_MINIMUM_STACK.what_changed).toContain('recompete_changes');
    expect(CAI_MINIMUM_STACK.what_we_are_seeing_now).toContain('agency_forecasts');
  });
});
