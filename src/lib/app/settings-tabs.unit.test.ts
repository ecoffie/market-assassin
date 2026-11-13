import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_SECTION_VALUES,
  SETTINGS_TABS,
  anchorForSection,
  isSettingsTab,
  settingsSearchForTab,
  tabForSection,
  unsavedTabs,
} from './settings-tabs';
import { parseAppDeepLink } from './deep-link-params';

describe('settings tabs', () => {
  it('has at most 5 tabs and every tab id is itself a valid section', () => {
    expect(SETTINGS_TABS.length).toBeLessThanOrEqual(5);
    for (const t of SETTINGS_TABS) {
      expect(SETTINGS_SECTION_VALUES).toContain(t.id);
      expect(tabForSection(t.id)).toBe(t.id);
      expect(isSettingsTab(t.id)).toBe(true);
    }
  });

  it('every pre-split deep link lands on the tab that holds its card, and keeps its scroll anchor', () => {
    expect(tabForSection('credits')).toBe('billing');
    expect(anchorForSection('credits')).toBe('settings-credits');
    expect(tabForSection('billing')).toBe('billing');
    expect(anchorForSection('billing')).toBe('settings-billing');
    expect(tabForSection('notifications')).toBe('profile');
    expect(anchorForSection('notifications')).toBe('settings-notifications');
    expect(tabForSection('security')).toBe('account');
    expect(anchorForSection('security')).toBe('settings-security');
    expect(tabForSection('team')).toBe('team');
    expect(anchorForSection('team')).toBe('settings-team');
  });

  it('tab-level sections open the tab without a scroll target', () => {
    for (const s of ['matching', 'alerts', 'profile', 'account']) expect(anchorForSection(s)).toBeNull();
    expect(tabForSection('alerts')).toBe('matching');
  });

  it('unknown / missing / odd-case sections fall back sensibly', () => {
    expect(tabForSection(undefined)).toBe(DEFAULT_SETTINGS_TAB);
    expect(tabForSection(null)).toBe(DEFAULT_SETTINGS_TAB);
    expect(tabForSection('nope')).toBe(DEFAULT_SETTINGS_TAB);
    expect(tabForSection(' Credits ')).toBe('billing');
    expect(anchorForSection('nope')).toBeNull();
    expect(isSettingsTab('credits')).toBe(false);
  });

  it('the app deep-link parser accepts every section value (so /app passes it through)', () => {
    for (const section of SETTINGS_SECTION_VALUES) {
      expect(parseAppDeepLink('settings', new URLSearchParams(`panel=settings&section=${section}`))).toEqual({ section });
    }
  });
});

describe('settingsSearchForTab (URL sync on tab switch)', () => {
  it('sets section to the tab and keeps unrelated params', () => {
    const out = new URLSearchParams(settingsSearchForTab('?panel=settings&section=credits&email=a%40b.com', 'profile'));
    expect(out.get('panel')).toBe('settings');
    expect(out.get('section')).toBe('profile');
    expect(out.get('email')).toBe('a@b.com');
  });

  it('keeps the credits-console tab= only on Billing & credits', () => {
    const base = '?panel=settings&section=credits&tab=billing';
    expect(new URLSearchParams(settingsSearchForTab(base, 'billing')).get('tab')).toBe('billing');
    expect(new URLSearchParams(settingsSearchForTab(base, 'account')).has('tab')).toBe(false);
  });

  it('works from an empty query and without the leading ?', () => {
    expect(settingsSearchForTab('', 'team')).toBe('?panel=settings&section=team');
    expect(settingsSearchForTab('panel=settings', 'matching')).toBe('?panel=settings&section=matching');
  });
});

describe('unsavedTabs', () => {
  const saved = { display_name: 'A', email_frequency: 'daily', naics_codes: '541512', location_states: ['VA'], onboarding_completed: false };

  it('no baseline yet → nothing marked', () => {
    expect(unsavedTabs(saved, null).size).toBe(0);
  });
  it('identical → nothing marked', () => {
    expect(unsavedTabs({ ...saved, location_states: ['VA'] }, saved).size).toBe(0);
  });
  it('profile vs matching fields go to their own tab', () => {
    expect([...unsavedTabs({ ...saved, display_name: 'B' }, saved)]).toEqual(['profile']);
    expect([...unsavedTabs({ ...saved, location_states: ['VA', 'MD'] }, saved)]).toEqual(['matching']);
    expect(unsavedTabs({ ...saved, email_frequency: 'weekly', naics_codes: '' }, saved)).toEqual(new Set(['profile', 'matching']));
  });
  it('onboarding_completed is bookkeeping, never an unsaved edit', () => {
    expect(unsavedTabs({ ...saved, onboarding_completed: true }, saved).size).toBe(0);
  });
});
