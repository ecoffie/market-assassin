// @vitest-environment jsdom
/** Anchors in content-research.ts point at real elements in the panel each tab renders. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_TIPS } from './content-research';
import { TAB_TIPS_IFRAME_PANELS, normalizeTabTipSteps } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const panels = join(here, '../../../components/app/panels');

/** Panel id → the source files whose elements its anchors may name. */
const PANEL_SOURCES: Record<string, string[]> = {
  dashboard: ['DashboardPanel.tsx'],
  'my-market': ['MarketDossierPanel.tsx'],
  alerts: ['AlertsPanel.tsx'],
  research: ['MarketResearchPanel.tsx'],
  today: ['TodayPanel.tsx'],
};

/** Expected anchor for every step, in order (undefined = hint without a highlight). */
const EXPECTED: Record<string, Array<string | undefined>> = {
  map: [undefined, undefined, undefined],
  watchlist: [undefined, undefined, undefined],
  saved: [undefined, undefined, undefined],
  dashboard: ['[data-tip="dashboard-review-fit"]', '[data-tour="dash-track"]', '[data-tip="dashboard-tune"]'],
  'my-market': ['[data-tip="my-market-setup"]', '[data-tip="my-market-title"]', '[data-tip="my-market-draft"]'],
  alerts: ['[data-tip="alerts-filters"]', '[data-tip="alerts-search"]', '[data-tip="alerts-save"]'],
  research: ['[data-tip="research-mode"]', '[data-tip="research-suggest-codes"]', '[data-tip="research-build"]'],
  today: ['[aria-label="Your saved searches"]', '[data-tip="today-ask-mindy"]', '[data-testid="today-open-map"]'],
};

/** `[attr="value"]` → the literal `attr="value"` that must appear in the panel source. */
function attributeLiteral(selector: string): string {
  const m = selector.match(/^\[([a-z-]+)="([^"]+)"\]$/);
  if (!m) throw new Error(`unexpected selector shape: ${selector}`);
  return `${m[1]}="${m[2]}"`;
}

describe('content-research anchors', () => {
  it('each step has exactly the expected anchor', () => {
    for (const [panel, tips] of Object.entries(TAB_TIPS)) {
      const anchors = normalizeTabTipSteps(tips!).map(s => s.anchor);
      expect(anchors, panel).toEqual(EXPECTED[panel]);
    }
  });

  it('iframe tabs (map, watchlist, saved) carry no anchors', () => {
    for (const panel of TAB_TIPS_IFRAME_PANELS) {
      const tips = TAB_TIPS[panel as keyof typeof TAB_TIPS];
      if (!tips) continue;
      expect(normalizeTabTipSteps(tips).some(s => s.anchor), panel).toBe(false);
    }
  });

  it('every anchor names an attribute present in that panel source, and is a valid selector', () => {
    for (const [panel, tips] of Object.entries(TAB_TIPS)) {
      const anchors = normalizeTabTipSteps(tips!).flatMap(s => (s.anchor ? [s.anchor] : []));
      if (anchors.length === 0) continue;
      const files = PANEL_SOURCES[panel];
      expect(files, `no panel source registered for ${panel}`).toBeDefined();
      const source = files.map(f => readFileSync(join(panels, f), 'utf8')).join('\n');
      for (const a of anchors) {
        expect(() => document.createDocumentFragment().querySelector(a), a).not.toThrow();
        expect(source.includes(attributeLiteral(a)), `${panel}: ${a} not found in ${files.join(', ')}`).toBe(true);
      }
    }
  });
});
