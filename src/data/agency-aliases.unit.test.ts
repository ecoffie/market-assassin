/**
 * Structural guards for agency-aliases.json.
 *
 * These exist because the file silently accumulated 12 duplicate keys inside
 * the `aliases` block, each one a self-referential no-op appended AFTER a good
 * value ("USACE": "U.S. Army Corps of Engineers Civil Works" … "USACE":
 * "USACE"). JSON.parse is LAST-WINS, so every one of those destroyed the real
 * mapping — "USACE" expanded to "USACE", matched no sub_agency, and resolved
 * to nothing. Nothing in the build caught it: duplicate keys are valid JSON.
 *
 * The parsed object cannot reveal this — by the time you can inspect it, the
 * losing entries are already gone. The raw source text must be scanned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PATH = join(process.cwd(), 'src/data/agency-aliases.json');
const RAW = readFileSync(PATH, 'utf8');
const PARSED = JSON.parse(RAW) as Record<string, Record<string, string>>;

/**
 * Collect key→values per top-level block, from the SOURCE TEXT.
 * A naive whole-file regex would report false duplicates, because the same key
 * legitimately appears in both `aliases` and `parentMappings` — different
 * objects, no collision. Block tracking is what makes this test correct.
 */
function keysByBlock(): Record<string, Map<string, string[]>> {
  const out: Record<string, Map<string, string[]>> = {};
  let block: string | null = null;
  for (const line of RAW.split('\n')) {
    const top = /^ {2}"([a-zA-Z_]+)"\s*:\s*\{/.exec(line);
    if (top) { block = top[1]; out[block] = out[block] || new Map(); continue; }
    if (block && /^ {2}\}/.test(line)) { block = null; continue; }
    if (!block) continue;
    const kv = /^\s*"([^"]+)"\s*:\s*"([^"]*)"/.exec(line);
    if (!kv) continue;
    const m = out[block];
    if (!m.has(kv[1])) m.set(kv[1], []);
    m.get(kv[1])!.push(kv[2]);
  }
  return out;
}

describe('agency-aliases.json structure', () => {
  it('has no duplicate keys within any block', () => {
    const offenders: string[] = [];
    for (const [block, map] of Object.entries(keysByBlock())) {
      for (const [key, values] of map) {
        if (values.length > 1) offenders.push(`${block}."${key}" ×${values.length} → ${JSON.stringify(values)}`);
      }
    }
    expect(offenders, `duplicate keys silently drop values (JSON.parse is last-wins):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('has no self-referential aliases that expand to themselves', () => {
    // "USACE": "USACE" is a no-op — it resolves to an abbreviation that matches
    // no sub_agency, so the agency silently resolves to nothing.
    // "PEACE CORPS": "Peace Corps" is allowed: it canonicalizes CASE, which is
    // a real transformation, not a no-op.
    const bad = Object.entries(PARSED.aliases)
      .filter(([k, v]) => k.trim().toUpperCase() === String(v).trim().toUpperCase())
      .filter(([k, v]) => k.trim() === String(v).trim()); // identical, not just case-folded
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('has no empty or whitespace-only alias values', () => {
    const bad = Object.entries(PARSED.aliases).filter(([, v]) => !String(v).trim());
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('keeps the abbreviations the office alias layer depends on', () => {
    // Regression guard for the specific keys that were destroyed.
    for (const k of ['FAA', 'FDA', 'CDC', 'CMS', 'NIH', 'NIST', 'NOAA', 'USACE',
                     'NNSA', 'FHWA', 'FRA', 'FTA', 'NASA', 'DARPA',
                     'NAVFAC', 'NAVSEA', 'NAVAIR', 'NAVWAR']) {
      const v = PARSED.aliases[k];
      expect(v, `missing alias ${k}`).toBeTruthy();
      expect(String(v).toUpperCase(), `${k} is a self-referential no-op`).not.toBe(k);
      expect(String(v).length, `${k} expands to something too short to match`).toBeGreaterThan(k.length);
    }
  });
});
