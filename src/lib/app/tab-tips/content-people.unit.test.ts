// @vitest-environment jsdom
/** People-group tab tips: every anchor points at an element in THAT tab's own panel source. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_TIPS } from './content-people';
import { normalizeTabTipSteps } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const panels = join(here, '../../../components/app/panels');

const PANEL_FILE: Record<string, string> = {
  recompetes: 'RecompetesPanel.tsx',
  contractors: 'ContractorsPanel.tsx',
  'decision-makers': 'GovDecisionMakersPanel.tsx',
  contacts: 'RelationshipsPanel.tsx',
  'partner-finder': 'PartnerFinderPanel.tsx',
  'target-list': 'MyTargetListPanel.tsx',
  'osbp-smb': 'OsbpSmbResearchPanel.tsx',
};

// Exact anchor per step, so a rename in either place is caught.
const EXPECTED: Record<string, string[]> = {
  recompetes: ['[data-tip="recompetes-filters"]', '[data-tip="recompetes-result"]', '[data-tip="recompetes-track"]'],
  contractors: ['[data-tip="contractors-filters"]', '[data-tip="contractors-sort"]', '[data-tip="contractors-result"]'],
  'decision-makers': ['[data-tip="decision-makers-search"]', '[data-tip="decision-makers-agency"]', '[data-tip="decision-makers-track"]'],
  contacts: ['[data-tip="contacts-find-new"]', '[data-tip="contacts-search"]', '[data-tip="contacts-saved"]'],
  'partner-finder': ['[data-tip="partner-finder-describe"]', '[data-tip="partner-finder-complement"]', '[data-tip="partner-finder-save"]'],
  'target-list': ['[data-tour="target-add"]', '[data-tip="target-list-status"]', '[data-tip="target-list-outreach"]'],
  'osbp-smb': ['[data-tip="osbp-smb-psc"]', '[data-tip="osbp-smb-max"]', '[data-tip="osbp-smb-set-aside"]'],
};

describe('content-people anchors', () => {
  it('covers exactly the people panels', () => {
    expect(Object.keys(TAB_TIPS).sort()).toEqual(Object.keys(PANEL_FILE).sort());
  });

  for (const [id, file] of Object.entries(PANEL_FILE)) {
    it(`${id}: each anchor is the expected one and exists in ${file}`, () => {
      const steps = normalizeTabTipSteps(TAB_TIPS[id as keyof typeof TAB_TIPS]!);
      expect(steps.map(s => s.anchor)).toEqual(EXPECTED[id]);
      const source = readFileSync(join(panels, file), 'utf8');
      for (const s of steps) {
        const m = s.anchor!.match(/^\[(data-tip|data-tour)="([^"]+)"\]$/);
        expect(m, `unexpected anchor form ${s.anchor}`).not.toBeNull();
        const attr = `${m![1]}="${m![2]}"`;
        // Present in this panel, and exactly once in the source (one attribute per step; repeated rows render from one JSX site).
        expect(source.split(attr).length - 1, `${file} must contain ${attr} once`).toBe(1);
        // Valid CSS selector.
        expect(() => document.createDocumentFragment().querySelector(s.anchor!)).not.toThrow();
      }
    });
  }
});
