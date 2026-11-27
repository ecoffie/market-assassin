/** "How to use this tab" content contract (owner request, 2026-11-27). */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAB_TIPS, TAB_TIPS_SOURCES, getTabTips, isTabTipsEnabled, normalizeTabTipStep, normalizeTabTipSteps, tabTipsStorageKey } from './index';

const here = dirname(fileURLToPath(import.meta.url));

// Money, plans/credits, hype and personal data never belong in tab tips.
const BANNED: Array<[RegExp, string]> = [
  [/\$/, 'a dollar sign (no prices)'],
  [/credit/i, 'credits'],
  [/\b(upgrade|subscription|pro plan|team plan|free plan|per month|\/mo\b|trial)\b/i, 'plans or upgrades'],
  [/\b(best|#1|number one|guarantee[ds]?|ultimate|unbeatable|world[- ]class|revolutionary|game[- ]chang\w*|cutting[- ]edge|unmatched|unrivaled)\b/i, 'a superlative'],
  [/#1/, 'a superlative'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'an email address'],
];

function allText(): Array<{ id: string; field: string; text: string }> {
  return Object.entries(TAB_TIPS).flatMap(([id, t]) => [
    ...(t!.title ? [{ id, field: 'title', text: t!.title }] : []),
    ...normalizeTabTipSteps(t!).map((s, i) => ({ id, field: `steps[${i}]`, text: s.text })),
    { id, field: 'tip', text: t!.tip },
  ]);
}

describe('tab tips content contract', () => {
  it('every content-*.ts file in this folder is listed in TAB_TIPS_SOURCES (so writers never edit index.ts)', () => {
    const files = readdirSync(here).filter(f => /^content-[\w-]+\.ts$/.test(f)).sort();
    expect(TAB_TIPS_SOURCES.map(s => s.file).sort()).toEqual(files);
  });

  it('a panel id appears in only one content file', () => {
    const seen = new Map<string, string>();
    for (const { file, tips } of TAB_TIPS_SOURCES) {
      for (const id of Object.keys(tips)) {
        expect(seen.get(id), `${id} is in both ${seen.get(id)} and ${file}`).toBeUndefined();
        seen.set(id, file);
      }
    }
  });

  it('every entry has 2-3 non-empty short steps and one tip', () => {
    expect(Object.keys(TAB_TIPS).length).toBeGreaterThan(0);
    for (const [id, t] of Object.entries(TAB_TIPS)) {
      expect(t!.steps.length, id).toBeGreaterThanOrEqual(2);
      expect(t!.steps.length, id).toBeLessThanOrEqual(3);
      for (const { text: s } of normalizeTabTipSteps(t!)) {
        expect(s.trim().length, id).toBeGreaterThan(0);
        expect(s.length, `${id} step too long: ${s}`).toBeLessThanOrEqual(240);
      }
      expect(t!.tip.trim().length, id).toBeGreaterThan(0);
      expect(t!.tip.length, `${id} tip too long`).toBeLessThanOrEqual(280);
    }
  });

  it('no prices, credits, plans, superlatives or email addresses', () => {
    for (const { id, field, text } of allText()) {
      for (const [re, what] of BANNED) {
        expect(re.test(text), `${id}.${field} contains ${what}: "${text}"`).toBe(false);
      }
    }
  });

  it('getTabTips returns the entry, or null when there is none', () => {
    expect(getTabTips('forecasts')?.steps.length).toBeGreaterThanOrEqual(2);
    expect(getTabTips('not-a-panel')).toBeNull();
    expect(getTabTips('toString')).toBeNull();
    expect(getTabTips(null)).toBeNull();
    expect(getTabTips(undefined)).toBeNull();
  });

  it('the switch is OFF unless exactly "on"', () => {
    expect(isTabTipsEnabled(undefined)).toBe(false);
    expect(isTabTipsEnabled('')).toBe(false);
    expect(isTabTipsEnabled('true')).toBe(false);
    expect(isTabTipsEnabled('ON')).toBe(false);
    expect(isTabTipsEnabled('on')).toBe(true);
  });

  it('remembers hide per tab', () => {
    expect(tabTipsStorageKey('forecasts')).toBe('mindy_tab_tips_hidden:forecasts');
    expect(tabTipsStorageKey('forecasts')).not.toBe(tabTipsStorageKey('recompetes'));
  });

  it('steps may be a string or { text, anchor }; strings normalise to text only', () => {
    expect(normalizeTabTipStep('Plain.')).toEqual({ text: 'Plain.' });
    expect(normalizeTabTipStep({ text: 'A.', anchor: ' [data-tip="x"] ' })).toEqual({ text: 'A.', anchor: '[data-tip="x"]' });
    expect(normalizeTabTipStep({ text: 'B.', anchor: '  ' })).toEqual({ text: 'B.' });
  });

  it('every [data-tip="..."] anchor exists as a data-tip attribute in a src/components file', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.tsx') && !f.endsWith('.test.tsx')) files.push(p);
      }
    };
    walk(join(here, '../../../components'));
    const source = files.map(f => readFileSync(f, 'utf8')).join('\n');
    const anchors = Object.values(TAB_TIPS).flatMap(t => normalizeTabTipSteps(t!).flatMap(s => (s.anchor ? [s.anchor] : [])));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      for (const [, name] of a.matchAll(/\[data-tip="([^"]+)"\]/g)) {
        expect(source.includes(`data-tip="${name}"`), `anchor ${a}: no element has data-tip="${name}"`).toBe(true);
      }
    }
  });
});
