import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function src(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
}

describe('every NAICS write path uses the Census validator', () => {
  it('company setup rejects unknown before write', () => {
    expect(src('src/app/api/company-setup/route.ts')).toContain('validateMarketCodesInput');
  });

  it('Manage preferences cannot add a new unknown', () => {
    expect(src('src/app/api/alerts/preferences/route.ts')).toContain('persistNaicsWrite');
  });

  it('signup save-profile rejects unknown', () => {
    expect(src('src/app/api/alerts/save-profile/route.ts')).toContain('validateMarketCodesInput');
  });

  it('app profile rejects unknown', () => {
    expect(src('src/app/api/app/profile/route.ts')).toContain('validateMarketCodesInput');
  });

  it('admin profile edits cannot add a new unknown', () => {
    expect(src('src/app/api/admin/set-user-profile/route.ts')).toContain('persistNaicsWrite');
  });

  it('vault identity syncs only known NAICS', () => {
    expect(src('src/app/api/app/vault/identity/route.ts')).toContain('isKnownNaicsCode');
  });

  it('vault document commit syncs only known NAICS', () => {
    expect(src('src/app/api/app/vault/documents/commit/route.ts')).toContain('isKnownNaicsCode');
  });

  it('sample-opportunities seeds only known NAICS', () => {
    expect(src('src/app/api/sample-opportunities/route.ts')).toContain('isKnownNaicsCode');
  });

  it('coach seed filters unknown NAICS', () => {
    expect(src('src/lib/mindy/coach-provision.ts')).toContain('isKnownNaicsCode');
  });

  it('suggest-codes drops unknown NAICS', () => {
    expect(src('src/app/api/suggest-codes/route.ts')).toContain('isKnownNaicsCode');
  });

  it('MCP tools do not write user_notification_settings.naics_codes', () => {
    const registry = src('src/lib/mcp/tool-registry.ts');
    expect(registry).not.toMatch(/user_notification_settings/);
  });

  it('clients cannot commit a newly typed unknown', () => {
    expect(src('src/app/alerts/preferences/page.tsx')).toContain('commitNaicsFromTypedInput');
    expect(src('src/components/briefings/SettingsPanel.tsx')).toContain('commitNaicsFromTypedInput');
    expect(src('src/components/app/panels/UnifiedSettingsPanel.tsx')).toContain('commitNaicsFromTypedInput');
    expect(src('src/components/codes/NaicsPicker.tsx')).toContain('if (!getNaics(code)) return');
  });
});

describe('daily-alerts has no customer-email matcher branches', () => {
  it('does not hard-code a customer address', () => {
    const route = src('src/app/api/cron/daily-alerts/route.ts');
    expect(route).not.toMatch(/@[a-z0-9.-]+\.(com|org|net|ai)/i);
  });
});
