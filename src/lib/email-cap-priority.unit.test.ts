import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The guard talks to Supabase, so rather than mock the whole client we assert on the
// declared policy sets — the thing that actually decides who wins a slot.
const src = fs.readFileSync(path.join(__dirname, 'send-email.ts'), 'utf8');

function setMembers(name: string): string[] {
  const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]);
}

describe('daily email cap — product beats promo', () => {
  const capExempt = setMembers('CAP_EXEMPT_TYPES');
  const promo = setMembers('PROMOTIONAL_TYPES');

  it('exempts the product email so marketing cannot block it', () => {
    // 2026-07-31: a paying user lost his alert to an upgrade_drip + 2FA codes.
    expect(capExempt).toContain('daily_alert');
    expect(capExempt).toContain('weekly_alert');
  });

  it('treats every upgrade drip as promotional', () => {
    for (const t of ['upgrade_drip_d1', 'upgrade_drip_d3', 'upgrade_drip_d7', 'upgrade_drip_d14']) {
      expect(promo).toContain(t);
    }
  });

  it('never marks the product email promotional (it would yield to itself)', () => {
    expect(promo).not.toContain('daily_alert');
    expect(promo).not.toContain('weekly_alert');
  });

  it('keeps the two policies disjoint', () => {
    expect(promo.filter((t) => capExempt.includes(t))) .toEqual([]);
  });

  it('promotional mail reserves headroom rather than using the full cap', () => {
    expect(src).toMatch(/DAILY_EMAIL_CAP - 1/);
    expect(src).toMatch(/daily_cap_promo_yield/); // distinguishable in logs
  });

  it('unknown/new email types fail OPEN — full cap, never silently throttled', () => {
    expect(promo).not.toContain('pursuit_change_alert');
    expect(promo).not.toContain('saved_search_alert');
  });
});
