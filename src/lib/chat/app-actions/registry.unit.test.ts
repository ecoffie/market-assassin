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
