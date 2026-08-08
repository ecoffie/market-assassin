/**
 * Map-native Settings drawer (Homepage Readiness #34). The account menu's "Settings" must open an
 * IN-MAP drawer for the everyday preferences (alert frequency · NAICS · keywords · target agencies)
 * instead of leaving to /app. Reads the SAME endpoint /app reads (alerts/preferences) and writes the
 * CANONICAL persist path (/api/app/profile with precise:true so a NAICS prefix can't fan into a whole
 * family). Heavy account-admin stays as explicit /app links. This locks that contract + the injection
 * order (drawer HTML before LOGIN_MODAL_HTML, which has a latent unclosed div).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const drawer = readFileSync(join(__dirname, 'settings-drawer.ts'), 'utf8');
const menu = readFileSync(join(__dirname, 'account-menu.ts'), 'utf8');

describe('map-native Settings drawer (#34)', () => {
  it('is imported and injected (CSS in head, HTML + JS in body)', () => {
    expect(route).toContain("from './settings-drawer'");
    expect(route).toContain('SETTINGS_DRAWER_CSS');
    expect(route).toContain('SETTINGS_DRAWER_HTML');
    expect(route).toContain('SETTINGS_DRAWER_JS');
  });

  it('drawer HTML is injected BEFORE LOGIN_MODAL_HTML (latent unclosed div hazard)', () => {
    const inject = route.match(/const bodyInject =([^;]*);/);
    expect(inject).toBeTruthy();
    const order = inject![1];
    expect(order.indexOf('SETTINGS_DRAWER_HTML')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('SETTINGS_DRAWER_HTML')).toBeLessThan(order.indexOf('LOGIN_MODAL_HTML'));
  });

  it('SETTINGS_DRAWER_JS runs before ACCOUNT_MENU_JS (so openSettingsDrawer exists when menu wires it)', () => {
    const inject = route.match(/const bodyInject =([^;]*);/)![1];
    expect(inject.indexOf('SETTINGS_DRAWER_JS')).toBeLessThan(inject.indexOf('ACCOUNT_MENU_JS'));
  });

  it('the account menu Settings link opens the drawer when present, /app fallback otherwise', () => {
    expect(menu).toContain('id="mindyAcctSettings"');
    expect(menu).toContain('window.openSettingsDrawer');
    // Fallback href stays for pages that do NOT inject the drawer (favorites/saved).
    expect(menu).toContain("href=\"/app?panel=settings\"");
  });

  it('covers the four everyday settings sections', () => {
    expect(drawer).toContain('Alert frequency');
    expect(drawer).toContain('NAICS codes');
    expect(drawer).toContain('Keywords');
    expect(drawer).toContain('Target agencies');
    // ALL real alert_frequency values are offered — incl. mwf/tth (the cron accepts them;
    // omitting them would silently downgrade a mwf/tth user to whatever they click instead).
    for (const f of ['daily', 'weekdays', 'mwf', 'tth', 'weekends', 'weekly', 'paused']) {
      expect(drawer).toContain(`data-f="${f}"`);
    }
  });

  it('reads the SAME endpoint /app reads and writes the CANONICAL persist path', () => {
    expect(drawer).toContain('/api/alerts/preferences?email=');   // read
    expect(drawer).toContain("fetch(\"/api/app/profile\"");        // write
    // precise:true → 6-digit codes stay EXACT (persist-vs-query rule; no prefix fan-out).
    expect(drawer).toContain('precise:true');
  });

  it('keeps heavy account-admin as explicit /app links (not rebuilt in the map)', () => {
    for (const s of ['billing', 'security', 'team']) {
      expect(drawer).toContain(`section=${s}`);
    }
  });

  it('exposes window.openSettingsDrawer as the public entry', () => {
    expect(drawer).toContain('window.openSettingsDrawer=open');
  });
});
