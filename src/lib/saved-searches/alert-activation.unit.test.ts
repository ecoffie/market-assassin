import { describe, it, expect } from 'vitest';
import { alertActivationPlan } from './alert-activation';

describe('alertActivationPlan — the one rule for turning alerts on', () => {
  it('a valid open watch → full', () => {
    const p = alertActivationPlan('open', { naics: '541512', horizons: { open: true, recompete: false, forecast: false } });
    expect(p).toMatchObject({ ok: true, kind: 'full', profileScoped: false });
  });
  it('recompete removed, nothing else changed → partial', () => {
    const p = alertActivationPlan('open', { naics: '541512', horizons: { open: true, recompete: true, forecast: false } });
    expect(p.ok && p.kind).toBe('partial');
    if (p.ok) expect(p.filters.horizons).toEqual({ open: true, recompete: false, forecast: false });
  });
  it('recompete only / recompete mode → refused, unsupported_alert_scope', () => {
    expect(alertActivationPlan('recompete', { naics: '541512' })).toEqual({ ok: false, refusal: { code: 'unsupported_alert_scope' } });
    expect(alertActivationPlan('open', { naics: '541512', horizons: { open: false, recompete: true, forecast: false } }))
      .toEqual({ ok: false, refusal: { code: 'unsupported_alert_scope' } });
  });
  it('map-only keys → refused invalid_filters with the key names', () => {
    const p = alertActivationPlan('open', { naics: '541512', valueRange: '1-2', horizons: { open: true } } as never);
    expect(p).toEqual({ ok: false, refusal: { code: 'invalid_filters', reason: 'unsupported_keys', keys: ['valueRange'] } });
  });
  it('whole market → refused invalid_filters / no_narrowing', () => {
    const p = alertActivationPlan('open', { horizons: { open: true, recompete: false, forecast: false } });
    expect(p).toMatchObject({ ok: false, refusal: { code: 'invalid_filters', reason: 'no_narrowing' } });
  });
  it('scope=profile is flagged so the caller checks profile NAICS', () => {
    const p = alertActivationPlan('open', { scope: 'profile', horizons: { open: true } });
    expect(p).toMatchObject({ ok: true, profileScoped: true });
  });
});
