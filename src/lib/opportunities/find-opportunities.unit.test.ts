/**
 * Unit tests for find_opportunities compose helpers (shape / next / handoffs).
 * Live acceptance queries run separately against Supabase.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFindNext,
  classifyFindShape,
  type HorizonKey,
  type HorizonResult,
} from './find-opportunities';

function hz(
  status: HorizonResult['status'],
  matched: number | null,
  items: HorizonResult['items'] = [],
): HorizonResult {
  return {
    status,
    matched_count: matched,
    returned_count: items.length,
    items,
    source: 'test',
    as_of: null,
    filters_consumed: [],
    filters_unsupported: [],
    unmapped_count: 0,
    error: status === 'unavailable' ? { class: 'x', message: 'x' } : null,
    allowed_handoffs: [],
    semantics_note: null,
  };
}

function openItem(daysOut: number) {
  const d = new Date(Date.now() + daysOut * 86400_000).toISOString();
  return {
    horizon: 'open_now' as const,
    title: 'Cyber RFP',
    buyer: 'DEPT OF DEFENSE',
    location_label: 'FL',
    relevant_date: d,
    relevant_date_label: 'response_deadline',
    value_label: null,
    source: 'sam_opportunities',
    why_this_matched: 'test',
    identity: { kind: 'notice_id', id: 'abc' },
    notice_id: 'abc',
  };
}

describe('classifyFindShape', () => {
  it('is specific when open closes within 30 days', () => {
    const horizons = {
      open_now: hz('grounded', 40, [openItem(7)]),
      coming_back: hz('empty', 0),
      coming_soon: hz('empty', 0),
    } as Record<HorizonKey, HorizonResult>;
    expect(classifyFindShape(horizons)).toBe('specific');
  });

  it('is broad when open is empty even if recompete/forecast hit', () => {
    const horizons = {
      open_now: hz('empty', 0),
      coming_back: hz('grounded', 18, [{ ...openItem(90), horizon: 'coming_back' as const }]),
      coming_soon: hz('grounded', 7, [{ ...openItem(120), horizon: 'coming_soon' as const }]),
    } as Record<HorizonKey, HorizonResult>;
    expect(classifyFindShape(horizons)).toBe('broad');
  });
});

describe('buildFindNext', () => {
  it('specific → understand primary + monitor secondary with watch_coverage', () => {
    const horizons = {
      open_now: hz('grounded', 3, [openItem(10)]),
      coming_back: hz('empty', 0),
      coming_soon: hz('empty', 0),
    } as Record<HorizonKey, HorizonResult>;
    const next = buildFindNext('specific', horizons);
    expect(next[0].tool).toBe('understand_customer');
    expect(next[0].prompt).toMatch(/what this customer cares about/);
    expect(next[0].requires_confirmation).toBe(true);
    expect(next[0].suggested_args?.notice_id).toBe('abc');
    expect(next[0].suggested_args?.agency).toBe('DEPT OF DEFENSE');
    expect(next[1].prompt).toMatch(/Coming back/);
    expect(next[1].suggested_args?.watch_coverage).toEqual(['open_now', 'coming_soon']);
  });

  it('broad with an open hit still continues UNDERSTAND — do not skip to MONITOR-only', () => {
    const horizons = {
      open_now: hz('grounded', 40, [openItem(90)]),
      coming_back: hz('empty', 0),
      coming_soon: hz('empty', 0),
    } as Record<HorizonKey, HorizonResult>;
    const next = buildFindNext('broad', horizons);
    expect(next[0].tool).toBe('understand_customer');
    expect(next[0].requires_confirmation).toBe(true);
    expect(next.some((n) => n.tool === 'schedule_market_search')).toBe(true);
  });

  it('broad with no open hit → CURRENT INTELLIGENCE first, then monitor (confirm-first)', () => {
    const horizons = {
      open_now: hz('empty', 0),
      coming_back: hz('grounded', 18),
      coming_soon: hz('grounded', 7),
    } as Record<HorizonKey, HorizonResult>;
    const next = buildFindNext('broad', horizons);
    expect(next[0].tool).toBe('get_current_acquisition_intelligence');
    expect(next[0].requires_confirmation).toBe(true);
    expect(next[1].prompt).toMatch(/monitor this market/);
    expect(next[1].prompt).toMatch(/not emailed yet/);
    expect(next[1].suggested_args?.watch_coverage).toEqual(['open_now', 'coming_soon']);
    expect(next[1].requires_confirmation).toBe(true);
  });
});

describe('independent horizon failure contract', () => {
  it('unavailable open must not coerce matched_count to 0', () => {
    const open = hz('unavailable', null);
    expect(open.matched_count).toBeNull();
    expect(open.status).toBe('unavailable');
  });
});
