import { describe, expect, it } from 'vitest';
import { alertStateFrom, profileSavedMessage, saveToProfileLabel } from './alert-state-copy';

describe('C-5: alert copy claims delivery only when alerts are known ON', () => {
  it('derives state; unknown never becomes on', () => {
    expect(alertStateFrom({ alertsEnabled: true, frequency: 'daily' })).toBe('on');
    expect(alertStateFrom({ alertsEnabled: false, frequency: 'daily' })).toBe('off');
    expect(alertStateFrom({ alertsEnabled: true, frequency: 'paused' })).toBe('off');
    expect(alertStateFrom({ frequency: 'daily' })).toBe('unknown');
    expect(alertStateFrom(null)).toBe('unknown');
  });
  it('never says "alerts now track" unless on', () => {
    expect(profileSavedMessage('on', 'drones')).toMatch(/alerts now track “drones”/);
    for (const s of ['off', 'unknown'] as const) expect(profileSavedMessage(s, 'drones')).not.toMatch(/now track/);
    expect(profileSavedMessage('off', 'drones')).toMatch(/Email alerts are off/);
    expect(saveToProfileLabel('off')).not.toMatch(/updates my alerts/);
  });
  it('never says "daily" — the stored schedule may be weekly', () => {
    expect(profileSavedMessage('on', 'x')).not.toMatch(/daily/i);
  });
});
