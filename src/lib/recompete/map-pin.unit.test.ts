/**
 * Shared toPin() — the Awarded pin shape both the map and the by-id share route emit.
 * Locks id=contract_id, sol=piid, src=RECOMPETE so a fetched pin can enter toRow unchanged.
 */
import { describe, it, expect } from 'vitest';
import { toPin, money } from './map-pin';

const CHARLIE =
  'CONT_AWD_36C24721F0485_3600_GS07F0168T_4730';

const fixture = {
  contract_id: CHARLIE,
  piid: '36C24721F0485',
  incumbent_name: 'CHARLIE FIXTURE INC',
  incumbent_uei: 'ABC123DEF456',
  awarding_agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  awarding_sub_agency: 'VETERANS AFFAIRS',
  naics_code: '561210',
  naics_description: 'Facilities Support Services',
  potential_total_value: 1_250_000,
  total_obligation: 800_000,
  period_of_performance_current_end: '2027-09-30',
  set_aside_type: 'SBA',
  contract_type: 'DELIVERY ORDER',
  place_of_performance_city: 'Decatur',
  place_of_performance_state: 'GA',
  map_lat: 33.7748,
  map_lng: -84.2963,
  map_loc_source: 'task_order_city',
  last_synced_at: '2026-08-01T00:00:00Z',
};

describe('toPin — shared Awarded pin shape', () => {
  it('keys id on contract_id and sol on piid (Share emits CUR.id = nid = contract_id)', () => {
    const pin = toPin(fixture);
    expect(pin.id).toBe(CHARLIE);
    expect(pin.sol).toBe('36C24721F0485');
    expect(pin.src).toBe('RECOMPETE');
  });

  it('keeps the incumbent as the title and threads city/state/agency for the drawer', () => {
    const pin = toPin(fixture);
    expect(pin.title).toBe('CHARLIE FIXTURE INC');
    expect(pin.agency).toBe('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(pin.loc).toBe('Decatur, GA');
    expect(pin.state).toBe('GA');
    expect(pin.locPrecision).toBe('city');
    expect(pin.valueNum).toBe(1_250_000);
    expect(pin.uei).toBe('ABC123DEF456');
  });

  it('never fabricates a title when the incumbent is missing', () => {
    const pin = toPin({ ...fixture, incumbent_name: null });
    expect(pin.title).toBe('Incumbent');
  });
});

describe('money', () => {
  it('formats ceilings the map already shows', () => {
    expect(money(0)).toBe('');
    expect(money(1_250_000)).toBe('$1.3M');
  });
});
