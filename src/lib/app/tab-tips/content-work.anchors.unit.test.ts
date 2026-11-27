// @vitest-environment jsdom
/** Anchors for the "work" tab tips: each one must point at an element that exists in THAT panel's source. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_TIPS } from './content-work';
import { normalizeTabTipSteps } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, '../../../components/app');

// Panel id → the source files that render that tab.
const PANEL_SOURCES: Record<string, string[]> = {
  pipeline: ['panels/PipelinePanel.tsx'],
  proposals: ['panels/ProposalsPanel.tsx', 'proposal/ProposalHome.tsx', 'proposal/ProposalEditor.tsx'],
  vault: ['panels/VaultPanel.tsx'],
  'knowledge-base': ['panels/KnowledgeBasePanel.tsx'],
  coach: ['panels/CoachPanel.tsx'],
};

// The exact anchor per step (null = no highlight on purpose). Changing an anchor means updating this table.
const EXPECTED: Record<string, Array<string | null>> = {
  pipeline: ['[data-tip="pipeline-view-toggle"]', '[data-tip="pipeline-card"]', '[data-tip="pipeline-draft"]'],
  proposals: ['[aria-label="Your pursuits"]', '[data-testid="draft-my-proposal"]', null],
  vault: ['[data-tip="vault-autofill"]', '[data-tour="vault-tabs"]', '[data-tip="vault-upload"]'],
  'knowledge-base': ['[data-tip="knowledge-base-search"]', '[data-tip="knowledge-base-types"]', '[data-tip="knowledge-base-list"]'],
  coach: ['[data-tip="coach-add-client"]', '[data-tip="coach-work-as"]', '[data-tip="coach-exit"]'],
};

/** `[attr="value"]` → the literal `attr="value"` the panel source must contain. */
function sourceNeedle(anchor: string): string {
  const m = anchor.match(/^\[([a-z-]+)="([^"]+)"\]$/);
  expect(m, `anchor ${anchor} must be a single [attr="value"] selector`).not.toBeNull();
  return `${m![1]}="${m![2]}"`;
}

describe('work tab-tip anchors', () => {
  it('each step carries the expected anchor', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const steps = normalizeTabTipSteps(TAB_TIPS[id as keyof typeof TAB_TIPS]!);
      expect(steps.map(s => s.anchor ?? null), id).toEqual(expected);
    }
  });

  it('every anchor target exists in that panel\'s own source', () => {
    for (const [id, files] of Object.entries(PANEL_SOURCES)) {
      const source = files.map(f => readFileSync(join(components, f), 'utf8')).join('\n');
      for (const step of normalizeTabTipSteps(TAB_TIPS[id as keyof typeof TAB_TIPS]!)) {
        if (!step.anchor) continue;
        const needle = sourceNeedle(step.anchor);
        expect(source.includes(needle), `${id}: no element has ${needle}`).toBe(true);
        expect(() => document.querySelector(step.anchor!)).not.toThrow();
      }
    }
  });

  it('every anchor matches the element when rendered markup carries it', () => {
    for (const expected of Object.values(EXPECTED)) {
      for (const a of expected) {
        if (!a) continue;
        const [attr, value] = sourceNeedle(a).split('=');
        const el = document.createElement('button');
        el.setAttribute(attr, value.slice(1, -1));
        document.body.appendChild(el);
        expect(document.querySelector(a)).toBe(el);
        el.remove();
      }
    }
  });
});
