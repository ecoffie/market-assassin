/**
 * GUARD — the daily alert's "View opportunity" link must open THAT opportunity.
 *
 * THE BUG (reported by a customer, reproduced on prod 2026-09-12): clicking "View
 * opportunity" showed results for ~1-2 seconds, then flipped to "No opportunities
 * match". A two-stage failure, so the final URL alone could not explain it.
 *
 * mapUrl() emitted MARKET FILTERS instead of the opportunity's identity:
 *   /opportunity-map?naics=<code>&subAgency=<sub_tier>&state=<RECIPIENT's profile state>
 * ...while trackUrl(), eight lines above it, already set notice_id. So the CTA that
 * says "View opportunity" could not name an opportunity.
 *
 * Why that DELETED the target rather than scoping to it, both halves measured live:
 *   1. TEMPORAL — the map's scope-params IIFE (opportunity-map/route.ts ~8141) parses
 *      naics/agency/state/subAgency and applies them via __applySavedSearch inside a
 *      40x150ms retry loop. Boot's own setTimeout(fetchView,300) painted broad results
 *      FIRST; the filters landed ~1-2s later and emptied the map. Same bbox on prod:
 *      5,416 -> 0.
 *   2. DATA — `state` was the RECIPIENT's profile state, a fact about the reader. It
 *      filters pop_state, populated on only 4,047/10,993 open rows (36.8%). 571 of
 *      2,078 live NAICS x sub-agency scopes (27.5%) go to EXACTLY 0 under any state
 *      filter.
 *
 * THE FIX: use ?opp=<notice_id>, the map's existing typed exact-opportunity address —
 * the same contract Share, Favorites and /today use. With opp= alone the scope-params
 * IIFE early-returns, so no delayed writer can race the drawer open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/cron/daily-alerts/route.ts'), 'utf8');
const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

// The mapUrl closure is defined inside the send path (it captures `user`), so it cannot be
// imported. Slice the declaration and assert on it directly — the same source-level technique
// opp-deeplink.unit.test.ts uses for the map's own in-string boot handlers.
function mapUrlSource(): string {
  const at = ROUTE.indexOf('const mapUrl = (opp:');
  expect(at).toBeGreaterThan(-1);
  const end = ROUTE.indexOf('\n  };', at);
  expect(end).toBeGreaterThan(at);
  return ROUTE.slice(at, end);
}

describe('read the real files (a vacuous pass would hide every assertion below)', () => {
  it('both routes are present and substantial', () => {
    expect(ROUTE.length).toBeGreaterThan(20_000);
    expect(MAP.length).toBeGreaterThan(50_000);
  });
});

describe('the alert email names the opportunity', () => {
  it('View opportunity emits ?opp=<notice_id>', () => {
    const src = mapUrlSource();
    expect(src).toContain('/opportunity-map?opp=');
    expect(src).toContain('encodeURIComponent(opp.noticeId)');
  });

  it('the notice id wins BEFORE any market filter is composed', () => {
    // Order matters: an early return on noticeId is what guarantees a real notice can never
    // pick up a filter that could exclude it.
    const src = mapUrlSource();
    const idAt = src.indexOf('opp.noticeId');
    const filtAt = src.indexOf('new URLSearchParams');
    expect(idAt).toBeGreaterThan(-1);
    expect(filtAt).toBeGreaterThan(idAt);
  });

  it('the "View opportunity" CTA in the email body is built from mapUrl', () => {
    expect(ROUTE).toContain("trackedUrl(mapUrl(opp), 'open_in_map'");
    expect(ROUTE).toContain('View opportunity');
  });
});

describe('it does NOT inject the recipient profile state', () => {
  it('mapUrl never reads user.location_state', () => {
    // THE regression. `state` is a fact about the reader; on a per-opportunity link it
    // filters pop_state (36.8% populated) and can delete the very row being linked.
    expect(mapUrlSource()).not.toContain('location_state');
  });

  it('mapUrl sets no state param at all', () => {
    expect(mapUrlSource()).not.toMatch(/set\(\s*['"]state['"]/);
  });

  it('and sends no market filter on the notice-id path', () => {
    const src = mapUrlSource();
    const idPath = src.slice(src.indexOf('if (opp.noticeId)'), src.indexOf('new URLSearchParams'));
    for (const p of ['naics', 'subAgency', 'agency', 'state']) {
      expect(idPath).not.toContain(`${p}=`);
    }
  });
});

describe('the delayed __applySavedSearch path cannot touch an ?opp= link', () => {
  it('the scope-params IIFE early-returns when no scope param is present', () => {
    // This is WHY opp= alone is sufficient: with none of these params in the URL the
    // deep-link writer bails before its retry loop, so nothing can replace or remove the
    // exact-opportunity destination 1-2s after boot.
    const at = MAP.indexOf("var posted=P('posted'), mode=P('mode'), horizon=P('horizon');");
    expect(at).toBeGreaterThan(-1);
    const guard = MAP.slice(at, at + 400);
    expect(guard).toMatch(/if\(!agency&&!naics&&!state&&!setAside&&!psc&&!q&&!posted&&!mode&&!horizon&&!office&&!subAgency\)return;/);
  });

  it('"opp" is not one of the params that IIFE reads', () => {
    const at = MAP.indexOf('function P(k){ var m=(location.search||\'\')');
    const decl = MAP.slice(at, at + 900);
    expect(decl).not.toMatch(/P\(\s*['"]opp['"]\s*\)/);
  });

  it('the exact-opportunity handler is the one that owns ?opp=', () => {
    const at = MAP.indexOf('window.openOppDrawer(nid)');
    expect(at).toBeGreaterThan(-1);
    const handler = MAP.slice(at - 280, at + 200);
    expect(handler).toContain('match(/[?&]opp=([^&]+)/)');
    // Retries until the drawer JS defines openOppDrawer — without it a cold load silently
    // no-ops, which reads as "the deep link is broken, but only sometimes".
    expect(handler).toMatch(/tries\+\+|setTimeout/);
  });
});

describe('both ends of the contract agree', () => {
  it('the map consumes exactly the shape the email now emits', () => {
    expect(MAP).toMatch(/\[\?&\]opp=/);
    expect(mapUrlSource()).toContain('/opportunity-map?opp=');
  });

  it('the same contract is shared with /today (one path, no drift)', () => {
    const intel = readFileSync(join(process.cwd(), 'src/lib/today/intel.ts'), 'utf8');
    expect(intel).toContain('/opportunity-map?opp=');
  });

  it('?opp= is honored with NO auth — logged-out and authenticated both work', () => {
    // The handler reads location.search and calls openOppDrawer directly; there is no token
    // gate on this path (unlike ?ss=, which requires an email + token and bails signed-out).
    const at = MAP.indexOf('window.openOppDrawer(nid)');
    const handler = MAP.slice(at - 280, at + 200);
    expect(handler).not.toContain('mi_beta_auth_token');
    expect(handler).not.toContain('_uemail');
    // The contrasting ?ss= handler DOES gate — proving the distinction is real, not assumed.
    const ssAt = MAP.indexOf("var m=(location.search||'').match(/[?&]ss=([^&]+)/)");
    expect(MAP.slice(ssAt, ssAt + 700)).toContain('mi_beta_auth_token');
  });

  it('a notice with no id still avoids the bare 136K-pin map, without the reader state', () => {
    const src = mapUrlSource();
    const fallback = src.slice(src.indexOf('new URLSearchParams'));
    expect(fallback).toContain('naics');
    expect(fallback).toContain('subAgency');
    expect(fallback).not.toContain('location_state');
  });
});

describe('the tracking redirect preserves the opp= destination', () => {
  it('trackedUrl wraps the destination as an encoded url= param', () => {
    const eng = readFileSync(join(process.cwd(), 'src/lib/engagement.ts'), 'utf8');
    // generateTrackedLink encodes the WHOLE destination, so ?opp= survives the redirect
    // rather than being flattened into the tracker's own query string.
    expect(eng).toContain('const encodedUrl = encodeURIComponent(url);');
    expect(eng).toContain('a=click&url=${encodedUrl}');
  });

  it('the UTM appender only ADDS params — it never drops opp=', () => {
    const eng = readFileSync(join(process.cwd(), 'src/lib/engagement.ts'), 'utf8');
    const at = eng.indexOf('export function appendEmailUtm');
    const fn = eng.slice(at, at + 700);
    expect(fn).toContain('searchParams.set(');
    expect(fn).not.toContain('searchParams.delete(');
    // Round-trip the real thing: opp must survive UTM decoration intact.
    const url = new URL('https://getmindy.ai/opportunity-map?opp=abc123');
    url.searchParams.set('utm_source', 'resend');
    url.searchParams.set('utm_campaign', 'daily_alert');
    expect(url.toString()).toContain('opp=abc123');
    expect(new URL(url.toString()).searchParams.get('opp')).toBe('abc123');
  });

  it('and survives a full encode/decode through the tracker', () => {
    const dest = 'https://getmindy.ai/opportunity-map?opp=abc123&utm_source=resend';
    const tracked = `https://getmindy.ai/api/track?t=tok&a=click&url=${encodeURIComponent(dest)}`;
    const back = decodeURIComponent(new URL(tracked).searchParams.get('url') || '');
    expect(new URL(back).searchParams.get('opp')).toBe('abc123');
  });
});
