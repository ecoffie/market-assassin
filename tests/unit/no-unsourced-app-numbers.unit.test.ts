/**
 * Eric, 2026-11-27: "remove unsourced numbers everywhere else too." In the Mindy App and Map UI a customer-visible
 * number is allowed only when it is (a) imported from src/lib/marketing-stats.ts, (b) computed from live data,
 * (c) a price/credit from packages.ts, (d) an opportunity fact, or (e) an official figure with its source cited.
 * This guard pins the surfaces that carried hand-typed or unsourced figures, so none comes back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Customer-visible text only: comments stripped so explanations of the fix do not trip the guard. */
const visible = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const SURFACES: Record<string, RegExp[]> = {
  'src/components/app/UpgradeModal.tsx': [/7,800\+/, /\$700B\+/, /290K\+/],
  'src/app/app/page.tsx': [/33,000\+/, /'10 reports'/],
  'src/app/opportunity-map/forecasts/route.ts': [/33,000\+/],
  'src/components/app/nav-groups.ts': [/33,000\+/],
  'src/components/app/ProductTour.tsx': [/3,500\+/],
  'src/components/app/onboarding/OnboardingScan.tsx': [/3,500\+/, /28 federal data sources/, /5 years of USASpending/, /12–18 months out/],
  'src/components/app/panels/PartnerFinderPanel.tsx': [/71,000\+/],
  'src/components/app/panels/MarketDossierPanel.tsx': [/28 sources/, /300\+ agencies/],
  'src/app/app/market-intel/page.tsx': [/195\+ active/, /29\+ active/],
  'src/components/briefings/GrantsPanel.tsx': [/\$700B\+/],
  'src/components/briefings/SbirPanel.tsx': [/~\$3\.5B/, /11 federal agencies/, /~\$275K/, /~\$1\.1M/, /At least 40% of work/],
  'src/components/app/panels/AlertsPanel.tsx': [/35% APEX/, /14 CTAs/],
  'src/app/opportunity-map/route.ts': [/thousands of real, comparable/],
  'src/components/app/panels/GovDecisionMakersPanel.tsx': [/100% list/],
  'src/components/federal-market-assassin/forms/CoreInputForm.tsx': [/5,000\+ contracts/],
  'src/components/federal-market-assassin/reports/ReportsDisplay.tsx': [/'50\+ prime/, /'100\+ contract vehicles/, /'200\+ historical/, /'25\+ tribal/],
};

describe('no unsourced numbers on the swept App and Map surfaces', () => {
  for (const [file, banned] of Object.entries(SURFACES)) {
    it(`${file}: none of the removed figures is shown`, () => {
      const text = visible(file);
      for (const re of banned) expect(text).not.toMatch(re);
    });
  }

  it('corpus counts that stay are imported from marketing-stats.ts, never typed by hand', () => {
    for (const [file, label] of [
      ['src/components/app/UpgradeModal.tsx', 'forecastsLabel'],
      ['src/components/app/UpgradeModal.tsx', 'contractorsLabel'],
      ['src/app/app/page.tsx', 'forecastsLabel'],
      ['src/app/opportunity-map/forecasts/route.ts', 'forecastsLabel'],
      ['src/components/app/nav-groups.ts', 'forecastsLabel'],
    ] as const) {
      const src = read(file);
      expect(src).toMatch(/from '@\/lib\/marketing-stats'/);
      expect(src).toContain(`\${${label}}`);
    }
  });

  it('the nav description renders the shared forecast label', async () => {
    const { forecastsLabel } = await import('@/lib/marketing-stats');
    const nav = await import('@/components/app/nav-groups');
    const all = JSON.stringify(nav);
    expect(all).toContain(`${forecastsLabel} planned`);
  });

  it('acquisition thresholds: one cited constant (FAR 2.101), shown with its citation, used by every panel and the backend', async () => {
    const far = await import('@/lib/far/thresholds');
    expect(far.SIMPLIFIED_ACQUISITION_THRESHOLD).toBe(350_000);
    expect(far.MICRO_PURCHASE_THRESHOLD).toBe(15_000);
    expect(far.FAR_THRESHOLDS_URL).toBe('https://www.acquisition.gov/far/2.101');
    expect(far.satLabel).toBe('$350K');
    const legacy = await import('@/lib/utils/agency-priority');
    expect(legacy.SIMPLIFIED_ACQUISITION_THRESHOLD).toBe(far.SIMPLIFIED_ACQUISITION_THRESHOLD);
    expect(legacy.MICRO_PURCHASE_THRESHOLD).toBe(far.MICRO_PURCHASE_THRESHOLD);
    for (const file of [
      'src/components/app/panels/EntryAccessibilityCard.tsx',
      'src/components/app/panels/MarketResearchPanel.tsx',
      'src/components/app/panels/MyTargetListPanel.tsx',
    ]) {
      const text = visible(file);
      expect(text).not.toMatch(/\$250K|\$350K|\$15K/);
      expect(read(file)).toMatch(/from '@\/lib\/far\/thresholds'/);
      expect(text).toContain('FAR_THRESHOLDS_CITATION');
    }
    for (const file of ['src/app/api/government-contracts/search/route.ts', 'src/app/api/usaspending/find-hit-list/route.ts']) {
      expect(visible(file)).not.toMatch(/\b250000\b|\b250_000\b/);
      expect(read(file)).toContain('SIMPLIFIED_ACQUISITION_THRESHOLD');
    }
  });

  it('client-workspace limits shown to customers are the limits coach-access enforces (Teams 5, add-on 3)', async () => {
    const { COACH_CLIENT_LIMITS } = await import('@/lib/mindy/coach-limits');
    expect(COACH_CLIENT_LIMITS).toEqual({ team: 5, grandfather: 10, coachAddon: 3 });
    for (const file of ['src/components/app/UpgradeModal.tsx', 'src/components/app/panels/CoachPanel.tsx']) {
      const text = visible(file);
      expect(text).not.toMatch(/up to (10|5|3) client workspaces|more than 3 clients/);
      expect(read(file)).toMatch(/from '@\/lib\/mindy\/coach-limits'/);
    }
    expect(read('src/lib/mindy/coach-access.ts')).toMatch(/from '\.\/coach-limits'/);
  });
});
