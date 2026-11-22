/**
 * GUARD — the daily alert's "Coming Back to Market" section must not link to legacy /app.
 *
 * THE BUG (prod, Vercel log "[email-migration] daily_alert email links to legacy /app"):
 * COMING_BACK_PANEL_PATH was '/app?panel=recompetes' and COMING_BACK_CONFIRM_PATH was
 * '/app?panel=settings'. The send-time guard (legacy-destination-guard.ts) forbids /app,
 * so every daily alert that rendered this section tripped it.
 *
 * THE FIX: "View the full market" -> the Map's recompete horizon (the same link
 * src/lib/learn/missions.ts uses), "Confirm your market" -> /alerts/preferences
 * (MINDY_PREFERENCES_URL), where the alert's NAICS market is edited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpiringContract } from '@/lib/recompete/query';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';
import {
  COMING_BACK_CONFIRM_PATH,
  COMING_BACK_PANEL_PATH,
  renderComingBackSection,
  selectComingBackRows,
} from './coming-back-to-market';

function contract(partial: Partial<ExpiringContract> & { contract_id: string }): ExpiringContract {
  return {
    contract_id: partial.contract_id,
    piid: partial.contract_id,
    incumbent_name: 'Starter Incumbent LLC',
    incumbent_uei: null,
    awarding_agency: 'Department of Veterans Affairs',
    awarding_sub_agency: null,
    naics_code: '541512',
    naics_description: null,
    psc_code: 'D399',
    description: null,
    total_obligation: 2_000_000,
    potential_total_value: 2_000_000,
    period_of_performance_start: '2024-01-01',
    period_of_performance_current_end: '2027-03-15',
    place_of_performance_state: null,
    place_of_performance_city: null,
    set_aside_type: null,
    competition_type: null,
    number_of_offers: null,
    estimated_recompete_date: null,
    lead_time_months: 10,
    recompete_likelihood: null,
    ...partial,
  };
}

const SITE = 'https://getmindy.ai';

function starterHtml(trackedUrl?: (url: string, label: string) => string): string {
  const defaultFive = ['541512', '541511', '541519', '541611', '561210'];
  const out = selectComingBackRows({
    contracts: [contract({ contract_id: 'STARTER-1' })],
    count: 1,
    naicsCodes: defaultFive,
    profile: { storedNaics: defaultFive, naicsSource: 'system_default', keywords: [] },
  });
  expect(out.kind).toBe('show');
  return renderComingBackSection(out, { panelUrl: `${SITE}${COMING_BACK_PANEL_PATH}`, trackedUrl });
}

describe('Coming Back to Market links (email migration guard)', () => {
  it('points at the Map recompete horizon and alert preferences, not /app', () => {
    expect(COMING_BACK_PANEL_PATH).toBe('/opportunity-map?horizon=recompete');
    expect(COMING_BACK_CONFIRM_PATH).toBe('/alerts/preferences');
  });

  it('rendered section (both CTAs) passes the legacy-destination guard', () => {
    const html = starterHtml();
    expect(html).toContain('Confirm your market');
    expect(html).toContain(`${SITE}/opportunity-map?horizon=recompete`);
    expect(html).toContain(`${SITE}/alerts/preferences`);
    expect(findLegacyDestinations(html)).toEqual([]);
  });

  it('passes the guard even through a tracking redirect', () => {
    const tracked = (url: string, label: string) =>
      `${SITE}/api/track?l=${label}&url=${encodeURIComponent(url)}`;
    expect(findLegacyDestinations(starterHtml(tracked))).toEqual([]);
  });

  it('the daily-alerts call site builds panelUrl from COMING_BACK_PANEL_PATH', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/daily-alerts/route.ts'), 'utf8');
    expect(route).toContain('panelUrl: `${MINDY_SITE_URL}${COMING_BACK_PANEL_PATH}`');
    expect(route).not.toMatch(/panel=recompetes/);
  });
});
