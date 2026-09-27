/**
 * GUARD — the approved Full & Open DNA reconciliation (P1-A) decides on AFFIRMATIVE evidence and
 * changes nothing but the full_open strand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFullOpenReconciliation, verifyReconciled, type FullOpenCandidate } from './full-open-reconcile';

const DNA = [
  { category: 'timing', key: 'closes_soon', label: 'Closes soon', tone: 'watch', tier: 3 },
  { category: 'approach', key: 'full_open', label: 'Full & Open', tone: 'neutral', tier: 1 },
  { category: 'buyer', key: 'repeat_buyer', label: 'Repeat buyer', tone: 'good', tier: 2 },
];
const KEYS = ['closes_soon', 'full_open', 'repeat_buyer'];
const row = (code: string | null, desc: string | null, extra: Partial<FullOpenCandidate> = {}): FullOpenCandidate => ({
  notice_id: 'n1', set_aside_code: code, set_aside_description: desc,
  opportunity_dna: DNA, opportunity_dna_keys: KEYS, ...extra,
});

describe('decision = affirmative Full & Open evidence, never absence', () => {
  it.each([
    ['NONE', 'No Set aside used'],
    ['NONE', null],
    [null, 'No Set aside used'],
    [null, 'Full and Open Competition'],
  ])('code %p / description %p → KEEP (the record says so)', (code, desc) => {
    const p = planFullOpenReconciliation(row(code, desc));
    expect(p.cls).toBe('affirmative_open');
    expect(p.action).toBe('keep');
    expect(p.next).toBeUndefined();
  });

  it('no set-aside on record → REMOVE (absence is not openness)', () => {
    const p = planFullOpenReconciliation(row(null, null));
    expect(p.cls).toBe('not_stated');
    expect(p.action).toBe('remove');
    expect(p.evidence).toBe('none on record');
  });

  it('whitespace-only fields are still absence', () => {
    expect(planFullOpenReconciliation(row('  ', ' ')).action).toBe('remove');
  });

  it.each([['LAS', 'Local Area Set-Aside (FAR 26.2)'], ['["SBA"]', '["SBA"]']])(
    'a STATED set-aside (%p) that fell into the NONE bucket → REMOVE', (code, desc) => {
      const p = planFullOpenReconciliation(row(code, desc));
      expect(p.cls).toBe('explicit_set_aside');
      expect(p.action).toBe('remove');
    });

  it('a code that is not open is not rescued by a description', () => {
    expect(planFullOpenReconciliation(row('SBA', 'No Set aside used')).action).toBe('remove');
  });
});

describe('only the full_open strand changes', () => {
  it('removes exactly the strand and the key, preserving every other strand and its order', () => {
    const p = planFullOpenReconciliation(row(null, null));
    expect(p.next!.opportunity_dna).toEqual([DNA[0], DNA[2]]);
    expect(p.next!.opportunity_dna_keys).toEqual(['closes_soon', 'repeat_buyer']);
  });

  it('a key/strand disagreement is never written', () => {
    const p = planFullOpenReconciliation(row(null, null, { opportunity_dna: [DNA[0]] }));
    expect(p.cls).toBe('inconsistent');
    expect(p.action).toBe('skip');
  });

  it('verification rejects ANY other DNA change', () => {
    const before = row(null, null);
    const p = planFullOpenReconciliation(before);
    expect(verifyReconciled(before, p.next!, p).ok).toBe(true);
    const drifted = { opportunity_dna: [{ ...DNA[0], label: 'Closes today' }, DNA[2]], opportunity_dna_keys: p.next!.opportunity_dna_keys };
    expect(verifyReconciled(before, drifted, p).ok).toBe(false);
    const reordered = { opportunity_dna: [DNA[2], DNA[0]], opportunity_dna_keys: p.next!.opportunity_dna_keys };
    expect(verifyReconciled(before, reordered, p).ok).toBe(false);
  });

  it('a kept row must be byte-identical afterwards', () => {
    const before = row('NONE', 'No Set aside used');
    const p = planFullOpenReconciliation(before);
    expect(verifyReconciled(before, { opportunity_dna: DNA, opportunity_dna_keys: KEYS }, p).ok).toBe(true);
    expect(verifyReconciled(before, { opportunity_dna: [DNA[0], DNA[2]], opportunity_dna_keys: ['closes_soon', 'repeat_buyer'] }, p).ok).toBe(false);
  });
});

describe('the script writes only DNA, guarded, after a snapshot', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'reconcile-full-open-dna.ts'), 'utf8');
  it('the update payload is exactly the two DNA columns', () => {
    expect(src).toMatch(/\.update\(\{ opportunity_dna: r\.plan\.next!\.opportunity_dna, opportunity_dna_keys: r\.plan\.next!\.opportunity_dna_keys \}/);
    expect(src).not.toMatch(/dna_computed_at:\s*new Date/);
  });
  it('writes are guarded on the snapshot and the snapshot is written before any update', () => {
    expect(src).toMatch(/q\.eq\('dna_computed_at', r\.dna_computed_at\)/);
    expect(src.indexOf('writeFileSync(file')).toBeLessThan(src.indexOf('.update('));
  });
  it('DRY by default', () => {
    expect(src).toMatch(/if \(!GO\) \{ console\.log\('\\nDRY RUN/);
  });
});
