/** Anchors in content-more.ts point at an element in THAT tab's own panel source (owner request, 2026-11-27). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_TIPS } from './content-more';
import { normalizeTabTipSteps } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const panels = join(here, '../../../components/app/panels');

const PANEL_FILE: Record<string, string> = {
  grants: 'GrantsPanel.tsx',
  dibbs: 'DibbsPanel.tsx',
  pricing: 'PricingIntelPanel.tsx',
  'disa-watch': 'DisaVehicleWatchPanel.tsx',
  'micc-mrr': 'MiccMrrPanel.tsx',
  team: 'TeamPanel.tsx',
  settings: 'UnifiedSettingsPanel.tsx',
};

/** The exact attribute text a selector needs in the panel source, or null if it uses an unsupported form. */
function sourceTarget(anchor: string): string | null {
  let m = anchor.match(/^\[data-tip="([^"]+)"\]$/);
  if (m) return `data-tip="${m[1]}"`;
  m = anchor.match(/^\[aria-label="([^"]+)"\]$/);
  if (m) return `aria-label="${m[1]}"`;
  m = anchor.match(/^#([\w-]+)$/);
  if (m) return `id="${m[1]}"`;
  return null;
}

describe('content-more tab tip anchors', () => {
  const entries = Object.entries(TAB_TIPS);

  it('every tab in this file has a known panel source', () => {
    for (const [id] of entries) expect(PANEL_FILE[id], `no panel file mapped for ${id}`).toBeTruthy();
  });

  it('every step of every tab here names an element, and that element is in its own panel', () => {
    let count = 0;
    for (const [id, tips] of entries) {
      const src = readFileSync(join(panels, PANEL_FILE[id]), 'utf8');
      for (const step of normalizeTabTipSteps(tips!)) {
        expect(step.anchor, `${id}: "${step.text}" has no anchor`).toBeTruthy();
        const target = sourceTarget(step.anchor!);
        expect(target, `${id}: unsupported selector ${step.anchor}`).not.toBeNull();
        const hits = src.split(target!).length - 1;
        expect(hits, `${id}: ${PANEL_FILE[id]} has ${hits} × ${target}`).toBe(1);
        count++;
      }
    }
    expect(count).toBe(21);
  });

  it('data-tip names follow <panel>-<thing>', () => {
    for (const [id, tips] of entries) {
      for (const step of normalizeTabTipSteps(tips!)) {
        const m = step.anchor?.match(/^\[data-tip="([^"]+)"\]$/);
        if (m) expect(m[1].startsWith(`${id}-`), `${m[1]} should start with ${id}-`).toBe(true);
      }
    }
  });
});
