/**
 * Rules KB ("How the Government Buys Now", Eric 2026-11-27): parse fidelity, verification flags, official passages,
 * retrieval, and the pre-ship staleness check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  QUOTABLE_REWRITES, FRESHNESS_PHRASE, parseRulesKb, buildRegisterRows, rankRuleClaims, checkClaims, classifySource, RULES_KB_DOC, type SourcesSnapshot,
} from './rules-kb';

const MD = readFileSync(join(process.cwd(), RULES_KB_DOC), 'utf8');
const SNAP = JSON.parse(readFileSync(join(process.cwd(), 'docs/knowledge/how-government-buys-now-2026-11-27.sources.json'), 'utf8')) as SourcesSnapshot;
const entries = parseRulesKb(MD);
const rows = buildRegisterRows(entries, SNAP);
const byId = Object.fromEntries(rows.map((r) => [r.claim_id, r]));

describe('parse', () => {
  it('16 entries, KB-1..KB-16, parts A (1-7) B (8-15) C (16)', () => {
    expect(entries.map((e) => e.claim_id)).toEqual(Array.from({ length: 16 }, (_, i) => `KB-${i + 1}`));
    expect(entries.filter((e) => e.part === 'A').map((e) => e.entry_no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(entries.find((e) => e.entry_no === 16)!.part).toBe('C');
  });
  it('every A/B entry has all six fields, verbatim from the file', () => {
    for (const e of entries.filter((x) => x.part !== 'C')) {
      for (const f of [e.change, e.source_text, e.status_text, e.affects, e.common_mistake, e.how_to_use]) {
        expect(f, `${e.claim_id}`).toBeTruthy();
        const rewritten = QUOTABLE_REWRITES.some((r) => f!.includes(r.to));
        if (!rewritten) expect(MD.includes(f!.split('\n')[0].slice(0, 80)), `${e.claim_id} field not verbatim`).toBe(true);
      }
    }
  });
  it('Part C is labelled practice, not law, and keeps its list verbatim', () => {
    const c = byId['KB-16'];
    expect(c.legal_status).toBe('practice');
    expect(c.practice_text).toContain('The pitch formula for every meeting');
  });
  it('a changed file shape fails loudly, never a partial parse', () => {
    expect(() => parseRulesKb(MD.replace('### 7. ', '### 77. '))).toThrow();
  });
});

describe('no freshness dates in quotable text (Eric 2026-11-27)', () => {
  it('no claim a report can quote carries "as of <date>" / "through 2026"', () => {
    for (const e of entries) {
      for (const f of [e.claim, e.change, e.status_text, e.affects, e.common_mistake, e.how_to_use, e.practice_text]) {
        expect(FRESHNESS_PHRASE.test(f ?? ''), `${e.claim_id}: ${f}`).toBe(false);
      }
    }
  });
  it('every rewrite applied and recorded on the row; document identifiers stay', () => {
    expect(byId['KB-1'].status_text).toContain('No Part 19 rule has been proposed yet.');
    expect(byId['KB-1'].notes).toMatch(/rewritten without a freshness date/);
    expect(byId['KB-11'].status_text).toContain('The services are announcing their PAEs.');
    for (const r of QUOTABLE_REWRITES) expect(MD).toContain(r.from); // the file keeps Eric's original words
    expect(byId['KB-10'].source_text).toMatch(/M-25-31/);
    expect(byId['KB-1'].caveats[0]).toMatch(/Sept 18, 2026 batch/); // a document identifier, kept
  });
});

describe('verification flags', () => {
  it('every [Not fully verified] entry is verified=false with its caveat verbatim', () => {
    const tagged = entries.filter((e) => /\[Not fully verified/.test(MD.split(`### ${e.entry_no}. `)[1]?.split('\n### ')[0] ?? ''));
    expect(tagged.map((e) => e.claim_id)).toEqual(['KB-1', 'KB-3', 'KB-4', 'KB-5', 'KB-12', 'KB-14', 'KB-15']);
    for (const e of tagged) {
      expect(e.verified).toBe(false);
      for (const c of e.caveats) expect(MD).toContain(c);
    }
    expect(byId['KB-6'].verified).toBe(true);
  });
  it('only a heading-level tag makes the whole entry unverified (KB-5)', () => {
    expect(rows.filter((r) => r.status === 'unverified').map((r) => r.claim_id)).toEqual(['KB-5']);
  });
});

describe('sources', () => {
  it('official vs secondary by host', () => {
    expect(classifySource('https://www.govinfo.gov/x')).toBe('official');
    expect(classifySource('https://www.law.cornell.edu/uscode/text/38/8127')).toBe('official');
    expect(classifySource('https://shared.govexec.com/m-25-31.pdf')).toBe('official_mirror');
    expect(classifySource('https://govconforge.com/x')).toBe('secondary');
    expect(classifySource('https://www.americanbar.org/x')).toBe('secondary');
  });
  it('every official source in the snapshot carries the rule\'s own passage; secondary are not fetched', () => {
    for (const r of rows) {
      for (const s of r.sources) {
        if (s.kind === 'secondary') expect(s.fetch_status).toBe('not_fetched_secondary');
        else {
          expect(s.fetch_status, `${r.claim_id} ${s.url}`).toBe('ok');
          expect((s.passage ?? '').length).toBeGreaterThan(100);
        }
      }
    }
  });
  it('a source missing from the snapshot is fetch_failed, and the entry is kept', () => {
    const r = buildRegisterRows(entries, { ...SNAP, passages: {} });
    expect(r).toHaveLength(16);
    expect(r[5].sources[0]).toMatchObject({ fetch_status: 'fetch_failed', fetch_error: 'not in the fetched snapshot' });
  });
  it('passages quote the rule: SAT $350,000; 38 USC 8127 restricted competition; 19.111-2 not a basis for protest', () => {
    const p = (id: string, host: RegExp) => byId[id].sources.find((s) => host.test(s.url))!.passage!;
    expect(p('KB-6', /govinfo/)).toContain('$350,000');
    expect(p('KB-4', /8127/)).toMatch(/reasonable expectation that two or more small business concerns owned and controlled by veterans/);
    expect(p('KB-3', /far-overhaul-part-19/)).toMatch(/not a basis for protest/);
    expect(p('KB-11', /publ60/)).toMatch(/PORTFOLIO ACQUISITION EXECUTIVE/);
  });
  it('KB-1: the RFO Part 19 text has no "first consider" / "order of precedence" (measured, 0 hits)', () => {
    const s = byId['KB-1'].sources.find((x) => /far-overhaul-part-19/.test(x.url))!;
    expect(s.absent_phrases).toEqual({ 'first consider': 0, 'order of precedence': 0 });
  });
});

describe('retrieval (Agent 4 acceptance queries)', () => {
  it.each([
    ['order of precedence set-aside', 'KB-1'],
    ['simplified acquisition threshold', 'KB-6'],
    ['SDVOSB sole source limit', 'KB-6'],
    ['Portfolio Acquisition Executive', 'KB-11'],
    ['VA Rule of Two Kingdomware', 'KB-4'],
  ])('"%s" → %s first, with its source and status', (q, want) => {
    const [top] = rankRuleClaims(q, rows);
    expect(top.claim_id).toBe(want);
    const r = byId[want];
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.legal_status).toBeTruthy();
    expect(r.status).toBe('current');
  });
  it.each([
    ['micro-purchase threshold', 'KB-6'],
    ['commercial solutions opening', 'KB-12'],
    ['OTA consortium prototype', 'KB-13'],
    ['8(a) follow-on release', 'KB-5'],
    ['size recertification after a merger', 'KB-7'],
    ['GSA consolidation M-25-31', 'KB-10'],
    ['broad agency announcement white paper', 'KB-14'],
    ['task order set-aside protest', 'KB-3'],
  ])('paraphrase "%s" → %s', (q, want) => {
    expect(rankRuleClaims(q, rows)[0]?.claim_id).toBe(want);
  });
  it('nothing relevant → empty, never a guess', () => {
    expect(rankRuleClaims('zebra migration patterns', rows)).toEqual([]);
  });
});

describe('pre-ship check (Fix 1B)', () => {
  it('fresh / stale by interval; unverified, superseded, unknown are reported', () => {
    const reg = rows.map((r) => ({ ...r }));
    reg.find((r) => r.claim_id === 'KB-2')!.status = 'superseded';
    reg.find((r) => r.claim_id === 'KB-2')!.superseded_by = 'KB-99';
    const out = checkClaims(['KB-1', 'KB-6', 'KB-5', 'KB-2', 'KB-404'], reg, '2027-01-30');
    expect(out[0]).toMatchObject({ claim_id: 'KB-1', state: 'stale', recheck_due: '2027-01-26' }); // class deviation, 60 days
    expect(out[0].state === 'stale' && out[0].caveats.length).toBe(1); // caveat travels with the claim
    expect(out[1]).toMatchObject({ claim_id: 'KB-6', state: 'ok', recheck_due: '2026-11-27'.replace('2026', '2027') }); // final rule, 365
    expect(out[2]).toMatchObject({ claim_id: 'KB-5', state: 'unverified' });
    expect(out[3]).toMatchObject({ claim_id: 'KB-2', state: 'superseded', superseded_by: 'KB-99' });
    expect(out[4]).toEqual({ claim_id: 'KB-404', state: 'unknown_claim' });
  });
  it('interval 0 = stale unless verified today', () => {
    const reg = [{ claim_id: 'X', verified_on: '2026-11-27', recheck_interval_days: 0, status: 'current' as const, caveats: [] }];
    expect(checkClaims(['X'], reg, '2026-11-27')[0].state).toBe('ok');
    expect(checkClaims(['X'], reg, '2026-11-28')[0].state).toBe('stale');
  });
});

describe('DB reads (rules-kb-db)', () => {
  const fakeDb = (data: unknown, error: { message: string } | null = null) => ({
    from: () => ({ select: () => ({ order: async () => ({ data, error }) }) }),
  }) as never;
  it('search over the live register returns the entry; a failed read is unavailable, never none_found', async () => {
    const { searchRuleClaims, checkClaimsLive } = await import('./rules-kb-db');
    expect((await searchRuleClaims(fakeDb(rows), 'Portfolio Acquisition Executive')).claims[0].claim_id).toBe('KB-11');
    expect(await searchRuleClaims(fakeDb(null, { message: 'boom' }), 'x')).toEqual({ status: 'unavailable', claims: [], error: 'boom' });
    expect((await searchRuleClaims(fakeDb(rows), 'zebra migration')).status).toBe('none_found');
    const c = await checkClaimsLive(fakeDb(rows), ['KB-6'], '2026-12-01');
    expect(c.ok && c.checks[0].state).toBe('ok');
  });
});
