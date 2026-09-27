import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAlertsEnabledWrite } from './alerts-enabled-write';

/**
 * Shared invariant: a partial update changes only explicitly submitted fields.
 * POST /api/app/profile used to write `alerts_enabled: true` on EVERY save, so a
 * Market Research "save to profile" or a Map settings-drawer save silently turned
 * a user's alerts back ON after they had turned them off.
 */
describe('resolveAlertsEnabledWrite — profile save never re-enables alerts implicitly', () => {
  it('a codes-only save (Market Research "save to profile") does not touch alerts_enabled', () => {
    expect(resolveAlertsEnabledWrite({})).toBeUndefined();
    expect(resolveAlertsEnabledWrite({ storedFrequency: 'daily' })).toBeUndefined();
    expect(resolveAlertsEnabledWrite({ storedFrequency: 'paused' })).toBeUndefined();
  });

  it('re-sending the UNCHANGED stored frequency (Map drawer) does not re-enable', () => {
    for (const f of ['daily', 'weekdays', 'weekends', 'weekly']) {
      expect(resolveAlertsEnabledWrite({ alertFrequency: f, storedFrequency: f })).toBeUndefined();
    }
  });

  it('an explicit alertsEnabled boolean is honoured', () => {
    expect(resolveAlertsEnabledWrite({ alertsEnabled: true })).toBe(true);
    expect(resolveAlertsEnabledWrite({ alertsEnabled: false })).toBe(false);
    expect(resolveAlertsEnabledWrite({ alertsEnabled: false, alertFrequency: 'daily', storedFrequency: 'paused' })).toBe(false);
  });

  it('a non-boolean alertsEnabled is not an instruction', () => {
    expect(resolveAlertsEnabledWrite({ alertsEnabled: 'yes' })).toBeUndefined();
    expect(resolveAlertsEnabledWrite({ alertsEnabled: 1 })).toBeUndefined();
  });

  it('choosing Paused disables — and wins over an explicit true', () => {
    expect(resolveAlertsEnabledWrite({ alertFrequency: 'paused' })).toBe(false);
    expect(resolveAlertsEnabledWrite({ alertFrequency: 'paused', alertsEnabled: true })).toBe(false);
  });

  it('moving OFF paused to an active frequency is an explicit enable', () => {
    expect(resolveAlertsEnabledWrite({ alertFrequency: 'daily', storedFrequency: 'paused' })).toBe(true);
    expect(resolveAlertsEnabledWrite({ alertFrequency: 'weekly', storedFrequency: 'paused' })).toBe(true);
  });

  it('an unknown frequency value is ignored', () => {
    expect(resolveAlertsEnabledWrite({ alertFrequency: 'hourly', storedFrequency: 'paused' })).toBeUndefined();
  });

  it('the route no longer hardcodes alerts_enabled: true into the update payload', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/profile/route.ts'), 'utf8')
      // line comments first: a `// … /api/app/*` comment would otherwise open a fake block comment
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/alerts_enabled:\s*true/);
    expect(src).toMatch(/resolveAlertsEnabledWrite\(/);
  });
});
