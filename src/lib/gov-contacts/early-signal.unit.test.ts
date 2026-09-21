/**
 * Guards for the per-office early-signal score.
 *
 * The score drives a badge and a map filter, so a silent change to the
 * thresholds or the denominator would quietly relabel hundreds of offices with
 * nothing failing. Every number here was measured against live data 2026-08-01.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { earlySignalBand, EARLY_SIGNAL_MIN_SAMPLE } from './refresh-dodaac-directory';

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/gov-contacts/refresh-dodaac-directory.ts'),
  'utf8',
);

describe('earlySignalBand', () => {
  it('buckets at the measured thresholds', () => {
    expect(earlySignalBand(100)).toBe('high');
    expect(earlySignalBand(89)).toBe('high');   // NAVAIR, real
    expect(earlySignalBand(50)).toBe('high');   // inclusive boundary
    expect(earlySignalBand(49)).toBe('medium');
    expect(earlySignalBand(20)).toBe('medium'); // inclusive boundary
    expect(earlySignalBand(19)).toBe('low');
    expect(earlySignalBand(1)).toBe('low');     // inclusive boundary
    expect(earlySignalBand(0)).toBe('none');
  });

  it('separates the two offices that motivated the feature', () => {
    // The whole point: one average (21.2%) describes neither of these.
    expect(earlySignalBand(89)).toBe('high');   // NAVAL AIR SYSTEMS COMMAND
    expect(earlySignalBand(10)).toBe('low');    // DLA AVIATION
  });

  it('only ever returns a band the DB CHECK constraint allows', () => {
    const allowed = new Set(['high', 'medium', 'low', 'none']);
    for (let pct = 0; pct <= 100; pct++) {
      expect(allowed.has(earlySignalBand(pct)), `pct ${pct}`).toBe(true);
    }
  });
});

describe('sample floor', () => {
  it('requires enough notices for the score to mean anything', () => {
    // A 1-of-1 office is "100% early" and is noise, not signal.
    expect(EARLY_SIGNAL_MIN_SAMPLE).toBeGreaterThanOrEqual(8);
  });

  it('matches the floor the display view enforces', () => {
    // The view gates early_signal_shown on sample >= 8; if this constant moves
    // without the view, the badge and the score disagree.
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260801_office_early_signal.sql'),
      'utf8',
    );
    expect(migration).toContain(`early_signal_sample, 0) >= ${EARLY_SIGNAL_MIN_SAMPLE}`);
  });
});

describe('refreshOfficeEarlySignal write shape', () => {
  const fn = SRC.slice(SRC.indexOf('export async function refreshOfficeEarlySignal'));

  it('excludes non-biddable notice types from the denominator', () => {
    // Award notices are not opportunities. Including them understates every
    // office (mean 19.0% vs the correct 21.2%).
    expect(SRC).toContain("'Award Notice'");
    expect(SRC).toContain("'Justification'");
    expect(fn).toContain('NON_BIDDABLE_NOTICE_TYPES');
  });

  it('counts only pre-solicitation notice types as early', () => {
    expect(SRC).toContain("'Sources Sought'");
    expect(SRC).toContain("'Presolicitation'");
  });

  it('writes ONLY the early_signal_* columns', () => {
    const update = /\.update\(\{([\s\S]*?)\}\)/.exec(fn);
    expect(update, 'no .update() found').toBeTruthy();
    const payload = update![1];
    expect(payload).toContain('early_signal_pct');
    expect(payload).toContain('early_signal_band');
    // Must never touch the name columns — word-boundary checks, since
    // "sam_office_name" contains "office_name".
    expect(payload).not.toMatch(/(^|[^_a-z])office_name\s*:/);
    expect(payload).not.toMatch(/(^|[^_a-z])sam_office_name\s*:/);
  });

  it('never inserts (that would invent offices)', () => {
    expect(fn).not.toContain('.upsert(');
    expect(fn).not.toContain('.insert(');
  });

  it('checks dryRun before writing', () => {
    const dry = fn.indexOf('opts.dryRun');
    const upd = fn.indexOf('.update(');
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(upd);
  });
});
