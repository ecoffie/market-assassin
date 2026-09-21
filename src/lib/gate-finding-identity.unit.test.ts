/**
 * The contract for pre-push gate FINDING IDENTITY (`scripts/lib/finding-identity.mjs`).
 *
 * Every baseline-ratchet gate used to key its accepted findings on `path:line`. A line
 * number describes everything ABOVE a finding, not the finding, so an edit earlier in the
 * file renamed every finding below it and the gate reported them as NEW while the code got
 * no worse. The cost is not the annoyance: a false NEW trains the operator to reach for
 * `--update-baseline`, which accepts EVERY current finding — a genuinely new bug in the
 * same push included. These tests pin the properties that removed that failure mode, so a
 * future "simplification" of the key cannot quietly reintroduce it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeEvidence,
  fingerprint,
  assignFindingKeys,
  partitionFindings,
  readBaseline,
  writeBaseline,
  isLegacyBaselineKey,
  planMigration,
  legacyKey,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain .mjs helper shared by the audit scripts; no types needed.
} from '../../scripts/lib/finding-identity.mjs';

type F = { file: string; line: number; rule: string; tag?: string; evidence: string };
const f = (over: Partial<F> = {}): F => ({
  file: 'src/lib/x.ts',
  line: 10,
  rule: 'count-null',
  tag: 'sam_opportunities',
  evidence: 'return { total: count ?? 0 };',
  ...over,
});

describe('finding identity — line numbers cannot rename a finding', () => {
  it('is unchanged when only the line moves (the whole point)', () => {
    const [a] = assignFindingKeys([f({ line: 10 })]);
    const [b] = assignFindingKeys([f({ line: 4212 })]);
    expect(b.key).toBe(a.key);
  });

  it('still records the line for humans, separately from identity', () => {
    const [a] = assignFindingKeys([f({ line: 77 })]);
    expect(a.line).toBe(77);
    expect(a.key).not.toContain('77');
    expect(a.legacy).toBe('src/lib/x.ts:77');
  });

  it('changes when the trigger statement changes (a material change is detectable)', () => {
    const [a] = assignFindingKeys([f({ evidence: 'return { total: count ?? 0 };' })]);
    const [b] = assignFindingKeys([f({ evidence: 'return { total: count ?? -1 };' })]);
    expect(b.key).not.toBe(a.key);
  });

  it('changes when the extracted table changes', () => {
    const [a] = assignFindingKeys([f({ tag: 'sam_opportunities' })]);
    const [b] = assignFindingKeys([f({ tag: 'user_profiles' })]);
    expect(b.key).not.toBe(a.key);
  });

  it('changes when the RULE changes, so two rules on one line stay two findings', () => {
    const [a] = assignFindingKeys([f({ rule: 'count-null' })]);
    const [b] = assignFindingKeys([f({ rule: 'swallowed-select' })]);
    expect(b.key).not.toBe(a.key);
  });

  it('is scoped to the file — the same defect elsewhere is a different place to fix', () => {
    const [a] = assignFindingKeys([f({ file: 'src/lib/x.ts' })]);
    const [b] = assignFindingKeys([f({ file: 'src/lib/y.ts' })]);
    expect(b.key).not.toBe(a.key);
  });

  it('is deterministic across runs (a baseline file must stay valid)', () => {
    expect(fingerprint('count-null', 'tbl', 'count ?? 0'))
      .toBe(fingerprint('count-null', 'tbl', 'count ?? 0'));
  });

  it('carries the file, rule and tag in plain text so a key is reviewable', () => {
    const [a] = assignFindingKeys([f()]);
    expect(a.key).toMatch(/^src\/lib\/x\.ts#count-null\(sam_opportunities\):[0-9a-f]{10}$/);
  });
});

describe('normalization — comments must not reach identity', () => {
  it('ignores a trailing comment that QUOTES the bad pattern while explaining it', () => {
    // Several real fixes in this repo do exactly this; flagging or re-keying them is the
    // false positive that makes people reflexively --update-baseline.
    const plain = 'const n = count;';
    const commented = 'const n = count; // NOT `count ?? 0` — that would fabricate a zero';
    expect(normalizeEvidence(commented)).toBe(normalizeEvidence(plain));
  });

  it('ignores block comments and collapses whitespace', () => {
    expect(normalizeEvidence('  a   /* why */  b  ')).toBe('a b');
  });

  it('treats reindentation as the same finding', () => {
    const [a] = assignFindingKeys([f({ evidence: 'return { total: count ?? 0 };' })]);
    const [b] = assignFindingKeys([f({ evidence: '        return  {  total: count ?? 0 };' })]);
    expect(b.key).toBe(a.key);
  });
});

describe('duplicates — identical findings in one file stay separately accountable', () => {
  const three = [f({ line: 10 }), f({ line: 20 }), f({ line: 30 })];

  it('gets distinct keys via an occurrence ordinal', () => {
    const keys = assignFindingKeys(three).map((x) => x.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toMatch(/@2$/);
    expect(keys[2]).toMatch(/@3$/);
  });

  it('keeps cardinality: fixing ONE leaves exactly one entry to tighten', () => {
    const baseline = assignFindingKeys(three).map((x) => x.key);
    const afterFix = assignFindingKeys([f({ line: 10 }), f({ line: 20 })]);
    const { fresh, stale } = partitionFindings(afterFix, baseline);
    expect(fresh).toHaveLength(0);
    expect(stale).toHaveLength(1);
  });

  it('is order-insensitive as a SET, so reordering never manufactures a NEW finding', () => {
    const baseline = assignFindingKeys(three).map((x) => x.key);
    const reordered = assignFindingKeys([f({ line: 30 }), f({ line: 10 }), f({ line: 20 })]);
    const { fresh, stale } = partitionFindings(reordered, baseline);
    expect(fresh).toHaveLength(0);
    expect(stale).toHaveLength(0);
  });
});

describe('the three states the ratchet needs', () => {
  it('fresh blocks, known passes, stale is reported for tightening', () => {
    const known = assignFindingKeys([f({ line: 10 })]);
    const baseline = [...known.map((x) => x.key), 'src/lib/gone.ts#count-null(t):aaaaaaaaaa'];
    const live = assignFindingKeys([f({ line: 99 }), f({ file: 'src/lib/new.ts' })]);
    const { fresh, known: ok, stale } = partitionFindings(live, baseline);
    expect(ok.map((x) => x.file)).toEqual(['src/lib/x.ts']);
    expect(fresh.map((x) => x.file)).toEqual(['src/lib/new.ts']);
    expect(stale).toEqual(['src/lib/gone.ts#count-null(t):aaaaaaaaaa']);
  });
});

describe('legacy key detection', () => {
  it('recognises the old shapes from every gate that used them', () => {
    expect(isLegacyBaselineKey('src/app/api/x/route.ts:40')).toBe(true);
    expect(isLegacyBaselineKey('src/app/api/x/route.ts:40 (purchases)')).toBe(true);
    expect(isLegacyBaselineKey('src/app/api/x/route.ts:40 [count-null]')).toBe(true);
    expect(isLegacyBaselineKey('src/lib/x.ts:192 :: const { rows } = await searchRecipients({')).toBe(true);
    expect(isLegacyBaselineKey('add-dod-sbir-cron.ts:24')).toBe(true);
  });

  it('does not mistake a content-addressed key for a legacy one', () => {
    const [a] = assignFindingKeys([f()]);
    expect(isLegacyBaselineKey(a.key)).toBe(false);
    expect(isLegacyBaselineKey(`${a.key}@2`)).toBe(false);
  });
});

describe('migration — acceptance is preserved exactly, never quietly reassigned', () => {
  it('carries every finding the old baseline accepted, whatever detail the old key held', () => {
    const live = assignFindingKeys([f({ line: 10 }), f({ file: 'src/lib/y.ts', line: 20 })]);
    const plan = planMigration(live, [
      'src/lib/x.ts:10 (sam_opportunities) [count-null]',
      'src/lib/y.ts:20 :: some snippet',
    ]);
    expect(plan.carried).toHaveLength(2);
    expect(plan.unmatchedFindings).toHaveLength(0);
    expect(plan.staleLegacy).toHaveLength(0);
  });

  it('reports a finding the old baseline did NOT accept instead of adopting it', () => {
    const live = assignFindingKeys([f({ line: 10 }), f({ file: 'src/lib/new.ts', line: 5 })]);
    const plan = planMigration(live, ['src/lib/x.ts:10']);
    expect(plan.carried).toHaveLength(1);
    expect(plan.unmatchedFindings.map((x: F) => x.file)).toEqual(['src/lib/new.ts']);
  });

  it('reports a legacy entry that matches nothing as stale (the baseline can tighten)', () => {
    const live = assignFindingKeys([f({ line: 10 })]);
    const plan = planMigration(live, ['src/lib/x.ts:10', 'src/lib/deleted.ts:7']);
    expect(plan.staleLegacy).toEqual(['src/lib/deleted.ts:7']);
  });

  it('rescues a 1:1 line shift in one file — migrating is itself an edit that moves lines', () => {
    // Measured while shipping this: adding ONE import to audit-unranged-selects.mjs moved
    // that gate's finding in its own source from :77 to :78.
    const live = assignFindingKeys([f({ line: 78 })]);
    const plan = planMigration(live, ['src/lib/x.ts:77']);
    expect(plan.carried).toHaveLength(1);
    expect(plan.unmatchedFindings).toHaveLength(0);
    expect(plan.staleLegacy).toHaveLength(0);
    expect(plan.shifted).toEqual([{ from: 'src/lib/x.ts:77', to: 'src/lib/x.ts:78' }]);
  });

  it('REFUSES to guess when a file has more than one leftover on either side', () => {
    // Two live findings, one leftover legacy entry: adopting either would silently decide
    // which finding inherits the acceptance. It must stay unmatched instead.
    const live = assignFindingKeys([f({ line: 78 }), f({ line: 90, evidence: 'count ?? 0;' })]);
    const plan = planMigration(live, ['src/lib/x.ts:77']);
    expect(plan.shifted).toHaveLength(0);
    expect(plan.unmatchedFindings).toHaveLength(2);
    expect(plan.staleLegacy).toEqual(['src/lib/x.ts:77']);
  });
});

describe('baseline file I/O', () => {
  it('round-trips, sorts, stamps the key format, and preserves other fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-identity-'));
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ violations: [], _why: 'keep me' }));
    writeBaseline(p, 'violations', ['b:2', 'a:1'], { note: 'hello' });
    const json = JSON.parse(readFileSync(p, 'utf8'));
    expect(json.violations).toEqual(['a:1', 'b:2']);
    expect(json._why).toBe('keep me');
    expect(json.note).toBe('hello');
    expect(json.keyFormat).toContain('content-addressed');
    expect(readBaseline(p, 'violations').keys).toEqual(['a:1', 'b:2']);
  });

  it('treats a missing baseline as empty rather than throwing', () => {
    expect(readBaseline(join(tmpdir(), 'definitely-absent-baseline.json'), 'violations').keys).toEqual([]);
  });

  it('exposes the legacy key builder migrations match on', () => {
    expect(legacyKey({ file: 'a/b.ts', line: 3 })).toBe('a/b.ts:3');
  });
});
