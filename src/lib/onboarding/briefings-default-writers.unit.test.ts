/**
 * SEC-5b (2026-10-03): user_notification_settings.briefings_enabled defaults to FALSE
 * (20261003_briefings_enabled_default_false.sql). That is only safe because every PAID
 * provisioning path writes TRUE explicitly; a paid path that relied on the old TRUE default
 * would leave a paying customer entitled but never sent a briefing (the watch-key-accounts
 * drift class: 27 accounts, 14 paying, 2026-08-05). This pins each paid writer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('paid provisioning never relies on the briefings_enabled column default', () => {
  it.each([
    ['src/lib/onboarding/ensure-notification-settings.ts', 'new paying customer row'],
    ['src/lib/access-codes.ts', 'grantBriefingAccess seed row'],
    ['src/lib/alerts/paused-delivery.ts', 'paid-state refresh of an existing row'],
    ['src/lib/supabase/briefings-entitlement.ts', 'entitlement → delivery sync'],
    ['scripts/grant-mindy-pro-once.ts', 'manual Pro / advocate grant'],
  ])('%s (%s) writes briefings_enabled true explicitly', (file) => {
    expect(read(file)).toMatch(/briefings_enabled\s*[:=]\s*true/);
  });

  it('grantBriefingAccess seeds the flag inside its own upsert', () => {
    const src = read('src/lib/access-codes.ts');
    const fn = src.slice(src.indexOf('export async function grantBriefingAccess'));
    const upsert = fn.slice(fn.indexOf('.upsert('), fn.indexOf("onConflict: 'user_email'"));
    expect(upsert).toMatch(/briefings_enabled:\s*true/);
  });

  it('the migration only changes the default, never existing rows', () => {
    const sql = read('supabase/migrations/20261003_briefings_enabled_default_false.sql')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/ALTER COLUMN briefings_enabled SET DEFAULT false/);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });

  it('the free-row helper stays explicit false', () => {
    expect(read('src/lib/onboarding/free-notification-defaults.ts')).toMatch(/briefings_enabled:\s*false/);
  });
});
