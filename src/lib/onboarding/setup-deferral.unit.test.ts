import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FINISH_SETUP_PATH,
  deferralPreferencePatch,
  profileSetupRequired,
  skipWriteTouchesAlerts,
} from './setup-deferral';

describe('skip is not a profile and not an alert enrollment', () => {
  it('no NAICS and no deferral still needs setup', () => {
    expect(profileSetupRequired({ naicsCodes: null, preferences: {} })).toBe(true);
    expect(profileSetupRequired({ naicsCodes: [], preferences: null })).toBe(true);
  });

  it('a real NAICS profile does not need setup', () => {
    expect(profileSetupRequired({ naicsCodes: ['236220'], preferences: null })).toBe(false);
  });

  it('a skip stamp clears the gate without inventing codes or alert fields', () => {
    const patch = deferralPreferencePatch({ theme: 'dark' }, '2026-09-15T18:20:00.000Z');
    expect(skipWriteTouchesAlerts(patch)).toBe(false);
    expect(patch.theme).toBe('dark');
    expect(profileSetupRequired({ naicsCodes: [], preferences: patch })).toBe(false);
  });

  it('finish-later stays on the current company setup, not the legacy builder', () => {
    expect(FINISH_SETUP_PATH).toBe('/welcome/company');
    expect(FINISH_SETUP_PATH).not.toContain('/app/onboarding');
  });

  it('the deferral route does not insert notification settings or enable alerts', () => {
    const src = readFileSync(join(__dirname, '../../app/api/app/setup-deferral/route.ts'), 'utf8');
    expect(src).toContain('requireMIAuthSession');
    expect(src).toContain('deferralPreferencePatch');
    expect(src).not.toContain('user_notification_settings');
    expect(src).not.toContain('alerts_enabled');
  });

  it('setup exits are visible on every step and the save does not forward a login JWT', () => {
    const onboarding = readFileSync(join(__dirname, '../../app/app/onboarding/page.tsx'), 'utf8');
    const exit = readFileSync(join(__dirname, '../../components/app/onboarding/SetupExit.tsx'), 'utf8');
    const signup = readFileSync(join(__dirname, '../../app/alerts/signup/page.tsx'), 'utf8');
    const settings = readFileSync(join(__dirname, '../../components/app/panels/UnifiedSettingsPanel.tsx'), 'utf8');
    expect(exit).toContain('Skip for now · Exit setup');
    expect(onboarding).toContain('<SetupExit email={email} />');
    expect(onboarding).toContain('credentialForSetupSave');
    expect(onboarding).toContain("'x-mi-auth-token': cred.token");
    expect(onboarding).not.toContain('getMIApiHeaders(email, { \'Content-Type\': \'application/json\', Authorization:');
    expect(signup).toContain('<SetupExit email={email} />');
    expect(signup).not.toContain('setBusinessDescription(\'\');\n                  goToStep(2);');
    expect(settings).toContain('href="/welcome/company"');
  });
});
