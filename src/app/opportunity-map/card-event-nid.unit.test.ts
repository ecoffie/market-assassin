/**
 * GUARD — card telemetry must stamp a JOINABLE notice_id, and must never invent one.
 *
 * Eric 2026-08-15: "add the notice_id to the view event so recently viewed works."
 *
 * MEASURED before the fix, across 1,000 real `user_engagement` rows carrying `metadata.opp`:
 *   929 solicitation numbers (FA664826Q0009…) · 57 forecast ids (fc-…) · only 14 real notice_id hex
 * So joining card events to `sam_opportunities.notice_id` matched ~1.4% of them. `opp` was simply
 * whatever the caller happened to pass first. (Same id-shape mismatch as the paused decision-time
 * note: the map logs one id shape, the pipeline stores another.)
 *
 * THE RULE: stamp BOTH. `opp` keeps its exact meaning so every existing read is untouched (the
 * funnel dashboard, per-strand click-through), and `nid` is the join key — present ONLY when a real
 * 32-char notice_id exists. A forecast card leaves it null rather than falling back to a
 * solicitation number, so null means "no notice", never "wrong id".
 *
 * ⚠️ SEPARATELY: Recently Viewed itself reads `listing_open` (fired by openOppDrawer with a real
 * notice_id — 410 events logged, verified joining 3/4 to live titles), NOT these card events.
 * An IMPRESSION is a pin scrolling past: 966 impressions vs 18 popup_opens. Listing impressions as
 * "recently viewed" would show opportunities the user never opened.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
const TRACK_CARD = SRC.slice(SRC.indexOf('window.__trackCard=function'), SRC.indexOf('window.__trackCard=function') + 5200);

describe('__trackCard stamps a joinable notice_id', () => {
  it('read the real tracker (a vacuous pass would hide every assertion below)', () => {
    expect(TRACK_CARD).toContain('__trackCard');
    expect(TRACK_CARD.length).toBeGreaterThan(500);
  });

  it('emits `nid` alongside `opp` — never replacing it', () => {
    expect(TRACK_CARD).toMatch(/opp:\s*String\(sol\)/);   // existing reads stay valid
    expect(TRACK_CARD).toMatch(/nid:\s*nid\s*\|\|\s*null/);
  });

  it('only accepts a REAL 32-char notice_id — never a solicitation number', () => {
    // The regex is the whole guarantee: without it, `nid` would inherit the same 929/1000
    // unjoinable ids that made this broken in the first place.
    expect(TRACK_CARD).toMatch(/\/\^\[a-f0-9\]\{32\}\$\/i/);
  });

  it('leaves nid NULL for a forecast rather than falling back to the sol number', () => {
    // A fabricated id is worse than a missing one: it joins to nothing and looks like data.
    const code = TRACK_CARD.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // `nid=String(sol)` DOES appear — but only inside `else if(/^[a-f0-9]{32}$/i.test(String(sol)))`,
    // i.e. when sol IS itself a real notice_id. That is correct. The thing that must never exist is
    // an UNGUARDED fallback. (My first version of this assertion flagged the guarded branch too and
    // failed against correct code — the regex, not the code, was wrong.)
    expect(code).toContain("var nid='';");                       // starts empty
    expect(code).toMatch(/else if\(\/\^\[a-f0-9\]\{32\}\$\/i\.test\(String\(sol\)\)\)\s*nid=String\(sol\)/);
    // …and no bare assignment outside a test() guard:
    expect(code).not.toMatch(/[;{]\s*nid\s*=\s*String\(sol\)\s*;/);
  });

  it('Recently Viewed reads listing_open, which carries its own notice_id', () => {
    expect(SRC).toMatch(/__track\('tool_use','listing_open',\{notice_id:/);
  });
});
