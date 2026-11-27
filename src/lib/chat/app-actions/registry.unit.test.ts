import { describe, it, expect } from 'vitest';
import { validateAction } from './registry';

const ev = (name: string, args: unknown, id = 'a1') => ({ type: 'action', id, name, args });

describe('app action registry', () => {
  it('accepts a full Map view and normalises states', () => {
    const r = validateAction(ev('map.apply_view', { q: 'construction', filters: { state: 'fl, ga', agency: 'Department of Veterans Affairs' }, horizons: { recompete: true }, mode: 'open' }), 'map');
    expect(r).toEqual({ ok: true, action: { id: 'a1', name: 'map.apply_view', kind: 'view', args: { q: 'construction', filters: { state: 'FL,GA', agency: 'Department of Veterans Affairs' }, horizons: { recompete: true }, mode: 'open' } } });
  });
  it('rejects whole: unknown action, unknown arg, unknown filter key, bad values, wrong surface, empty', () => {
    expect(validateAction(ev('map.delete_everything', {}), 'map')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(validateAction(ev('map.search', { q: 'x', css: 'body' }), 'map')).toMatchObject({ ok: false, reason: 'arg:css' });
    expect(validateAction(ev('map.apply_view', { filters: { onclick: 'x' } }), 'map')).toMatchObject({ ok: false, reason: 'filter:onclick' });
    expect(validateAction(ev('map.apply_view', { filters: { agency: '<img src=x>' } }), 'map')).toMatchObject({ ok: false });
    expect(validateAction(ev('map.apply_view', { filters: { state: 'Florida' } }), 'map')).toMatchObject({ ok: false, reason: 'filter:state' });
    expect(validateAction(ev('map.apply_view', { mode: 'companies' }), 'map')).toMatchObject({ ok: false, reason: 'mode' });
    expect(validateAction(ev('map.apply_view', { horizons: { open: 'yes' } }), 'map')).toMatchObject({ ok: false, reason: 'horizons' });
    expect(validateAction(ev('map.apply_view', {}), 'map')).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateAction(ev('map.search', { q: 'x' }), 'map')).toMatchObject({ ok: false, reason: 'q' });
    expect(validateAction(ev('map.search', { q: 'cyber' }), 'app')).toMatchObject({ ok: false, reason: 'surface' });
    expect(validateAction({ type: 'action', id: 'bad id!', name: 'map.search', args: { q: 'cyber' } }, 'map')).toMatchObject({ ok: false, reason: 'id' });
  });
  it('horizons, place and record', () => {
    expect(validateAction(ev('map.set_horizons', { isolate: 'forecast' }), 'map')).toMatchObject({ ok: true });
    expect(validateAction(ev('map.set_horizons', { isolate: 'dla' }), 'map')).toMatchObject({ ok: false });
    expect(validateAction(ev('map.go_to', { state: 'fl' }), 'map')).toMatchObject({ ok: true, action: { args: { state: 'FL' } } });
    expect(validateAction(ev('map.go_to', { national: true }), 'map')).toMatchObject({ ok: true });
    expect(validateAction(ev('map.go_to', { lat: 1, lng: 2 }), 'map')).toMatchObject({ ok: false });
    expect(validateAction(ev('map.open_record', { notice_id: '0009f2dae25541e4a2782d4807461bd0' }), 'map')).toMatchObject({ ok: true });
    expect(validateAction(ev('map.open_record', { notice_id: '../admin' }), 'map')).toMatchObject({ ok: false });
  });
});

import { ACTIONS, MAP_FILTER_KEYS, toolInputSchema } from './registry';

describe('registry metadata for the server tool (Agent 1)', () => {
  it('every action: argsSchema lists exactly its args, forbids extras; needsConfirm iff write; has a description and gate', () => {
    for (const [name, d] of Object.entries(ACTIONS)) {
      const props = Object.keys((d.argsSchema as { properties: Record<string, unknown> }).properties).sort();
      expect(props, name).toEqual([...d.args].sort());
      expect((d.argsSchema as { additionalProperties: unknown }).additionalProperties, name).toBe(false);
      expect(d.needsConfirm, name).toBe(d.kind === 'write');
      expect(d.description.length, name).toBeGreaterThan(10);
      expect(['none', 'signed_in', 'pro']).toContain(d.gate);
    }
  });
  it('the apply_view filters schema covers exactly MAP_FILTER_KEYS', () => {
    const f = (ACTIONS['map.apply_view'].argsSchema as { properties: { filters: { properties: Record<string, unknown> } } }).properties.filters.properties;
    expect(Object.keys(f)).toEqual([...MAP_FILTER_KEYS]);
  });
  it('toolInputSchema offers one branch per registered action for the surface', () => {
    const s = toolInputSchema(['map']) as { oneOf: Array<{ properties: { name: { const: string } } }> };
    expect(s.oneOf.map((b) => b.properties.name.const).sort()).toEqual(Object.keys(ACTIONS).filter((n) => ACTIONS[n].surfaces.includes('map')).sort());
    expect((toolInputSchema(['app']) as { oneOf: unknown[] }).oneOf).toEqual([]);
  });
});

import Ajv from 'ajv';

describe('argsSchema agrees with validateAction (compiled with ajv)', () => {
  const ajv = new Ajv({ strict: false });
  const samples: Array<[string, Record<string, unknown>]> = [
    ['map.apply_view', { q: 'construction', filters: { state: 'FL', agency: 'Department of Veterans Affairs' }, horizons: { recompete: true } }],
    ['map.apply_view', { filters: { onclick: 'x' } }],
    ['map.apply_view', { mode: 'companies' }],
    ['map.apply_view', {}],
    ['map.search', { q: 'cybersecurity' }],
    ['map.search', { q: 'x' }],
    ['map.search', { q: 'cyber', css: 'body' }],
    ['map.set_horizons', { isolate: 'forecast' }],
    ['map.set_horizons', { isolate: 'dla' }],
    ['map.go_to', { state: 'FL' }],
    ['map.go_to', { national: true }],
    ['map.go_to', { lat: 1 }],
    ['map.open_record', { notice_id: '0009f2dae25541e4a2782d4807461bd0' }],
    ['map.open_record', { notice_id: '../admin' }],
    ['map.save_search', { name: 'VA construction FL', alert_frequency: 'weekly' }],
    ['map.save_search', { name: 'VA construction FL', alert_frequency: 'hourly' }],
    ['map.save_search', { name: 'x', alert_frequency: 'daily', filters: { state: 'FL' } }],
    ['map.update_alert', { search_id: '11111111-2222-4333-8444-555555555555', alert_frequency: 'off' }],
    ['map.update_alert', { search_id: 'not-a-uuid', alert_frequency: 'off' }],
    ['map.add_to_pursuits', { kind: 'opportunity', notice_id: '0009f2dae25541e4a2782d4807461bd0' }],
    ['map.add_to_pursuits', { kind: 'recompete', contract_id: 'N0001920C0009' }],
    ['map.add_to_pursuits', { kind: 'opportunity', contract_id: 'N0001920C0009' }],
    ['map.add_to_pursuits', { kind: 'opportunity', notice_id: '0009f2dae25541e4a2782d4807461bd0', contract_id: 'X1' }],
    ['map.remove_from_pursuits', { pursuit_id: '11111111-2222-4333-8444-555555555555' }],
    ['map.remove_from_pursuits', { pursuit_id: '11111111-2222-4333-8444-555555555555', notice_id: '0009f2dae25541e4a2782d4807461bd0' }],
    ['map.remove_from_pursuits', {}],
  ];
  for (const [name, args] of samples) {
    it(`${name} ${JSON.stringify(args)}`, () => {
      const schemaOk = ajv.compile(ACTIONS[name].argsSchema)(args);
      const clientOk = validateAction({ type: 'action', id: 'a1', name, args }, 'map').ok;
      expect(schemaOk).toBe(clientOk);
    });
  }
});

import { routeActionName } from './registry';
describe('write actions', () => {
  it('are writes that need a confirm and a signed-in user; the route gets the bare name', () => {
    for (const n of ['map.save_search', 'map.update_alert', 'map.add_to_pursuits', 'map.remove_from_pursuits']) {
      expect(ACTIONS[n]).toMatchObject({ kind: 'write', needsConfirm: true, gate: 'signed_in' });
    }
    expect(routeActionName('map.save_search')).toBe('save_search');
    expect(routeActionName('app.open_panel')).toBe('open_panel');
  });
});
