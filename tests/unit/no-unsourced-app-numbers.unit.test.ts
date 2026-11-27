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
});
