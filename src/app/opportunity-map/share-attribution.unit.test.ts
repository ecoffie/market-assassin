/**
 * GUARD — Opportunity Share Attribution on the Map, plus the proof that it leaves the FROZEN
 * Opportunity Share Truth (#1650) exactly as it was.
 *
 * Behavioural where it can be: the entry classifier and the first-touch writer are sliced out of
 * the HTML the route actually SERVES and executed in a sandbox with a fake location / storage /
 * cookie jar — so these assertions run the shipped code, not a paraphrase of it.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/opportunities/map-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/opportunities/map-data')>()),
  getMapOpportunities: vi.fn(async () => []),
}));
const MOWER = {
  notice_id: '0fdb5f972b2a46648adf2e2b8a6558ce', title: 'CES Hillside Mower',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', notice_type: 'Combined Synopsis/Solicitation',
  solicitation_number: 'W50S9J-26-Q-0013', response_deadline: '2099-09-29T13:00:00+00:00',
  responseDeadLine: '2099-09-29T09:00:00-04:00', active: true, pop_state: 'WV',
};
const fetchOppShareRow = vi.fn();
vi.mock('@/lib/opportunities/share-metadata', async (orig) => ({
  ...(await orig<typeof import('@/lib/opportunities/share-metadata')>()),
  fetchOppShareRow: async (id: string) => { fetchOppShareRow(id); return id === MOWER.notice_id ? MOWER : null; },
}));

const X = MOWER.notice_id;
const S = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

async function serve(qs: string, ua = 'facebookexternalhit/1.1'): Promise<string> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/opportunity-map${qs}`, { headers: { 'user-agent': ua } }));
  expect(res.status).toBe(200);
  return res.text();
}

let HTML = '';
beforeAll(async () => { HTML = await serve(''); });

function slice(from: string, to: string): string {
  const a = HTML.indexOf(from);
  const b = HTML.indexOf(to, a);
  expect(a, `anchor not served: ${from}`).toBeGreaterThan(-1);
  expect(b, `end anchor not served: ${to}`).toBeGreaterThan(a);
  return HTML.slice(a, b + to.length);
}

/** Run the served entry classifier + first-touch writer for one URL in one browser. */
function boot(url: string, jar: { ls: Record<string, string>; cookies: string[] }, referrer = '') {
  const loc = new URL(url);
  const win: Record<string, unknown> = {};
  const ctx = vm.createContext({
    window: win, location: { search: loc.search, href: loc.href, pathname: loc.pathname, hostname: loc.hostname, protocol: loc.protocol },
    document: { referrer, get cookie() { return jar.cookies.join('; '); }, set cookie(v: string) { jar.cookies.push(v.split(';')[0]); } },
    localStorage: { getItem: (k: string) => jar.ls[k] ?? null, setItem: (k: string, v: string) => { jar.ls[k] = String(v); } },
    URLSearchParams, URL, JSON, Date, Object, String, encodeURIComponent, decodeURIComponent,
  });
  const classifier = slice("try{\n    var _qs=location.search||'';", "window.__mapEntry=String(_e).slice(0,40);");
  vm.runInContext(classifier + '}catch(e){}', ctx);
  const firstTouch = slice('  (function(){\n    try{\n      var K=\'gca_attribution\'', "    }catch(e){}\n  })();");
  vm.runInContext(firstTouch, ctx);
  return win as { __mapEntry: string; __mapShare: { share_id: string; notice_id: string; kind: string } | null; __firstTouchAt: string };
}
const fresh = () => ({ ls: {} as Record<string, string>, cookies: [] as string[] });

describe('entry classification — only a well-formed shared link is labelled share', () => {
  it('?opp=X&src=share&sh=S → entry share, with the share id and the record', () => {
    const w = boot(`https://getmindy.ai/opportunity-map?opp=${X}&src=share&sh=${S}`, fresh());
    expect(w.__mapEntry).toBe('share');
    expect(w.__mapShare).toEqual({ share_id: S, notice_id: X, kind: 'opp' });
  });
  it.each([
    ['direct traffic', '', 'direct'],
    ['a plain listing link (alert / briefing / /today all emit this)', `?opp=${X}`, 'listing_link'],
    ['a daily/lens alert link', `?strategy=early&src=alert`, 'alert'],
    ['a pursuit briefing link', `?src=pursuit_brief`, 'pursuit_brief'],
    ['a saved-search link', `?ss=abc`, 'saved_search'],
    ['a saved-search ALERT link', `?ss=abc&src=saved_search_alert`, 'saved_search_alert'],
    ['a malformed sh', `?opp=${X}&src=share&sh=not-a-uuid`, 'share_invalid'],
    ['a scanner-mangled sh', `?opp=${X}&src=share&sh=6G1d2b3c-4e5f`, 'share_invalid'],
    ['src=share with no sh', `?opp=${X}&src=share`, 'share_invalid'],
    ['src=share with no record', `?src=share&sh=${S}`, 'share_invalid'],
    ['a scanner-mangled src value', `?opp=${X}&src=tibsf&sh=${S}`, 'tibsf'],
  ])('%s is not share', (_label, qs, entry) => {
    const w = boot(`https://getmindy.ai/opportunity-map${qs}`, fresh());
    expect(w.__mapEntry).toBe(entry);
    expect(w.__mapShare).toBeNull();
  });
});

describe('first touch — established by the Map, stable across later shared links', () => {
  it('a share arrival writes first_touch with share_id + notice_id, to storage AND the gca_attr cookie', () => {
    const jar = fresh();
    const w = boot(`https://getmindy.ai/opportunity-map?opp=${X}&src=share&sh=${S}`, jar);
    const st = JSON.parse(jar.ls.gca_attribution);
    expect(st.first_touch).toMatchObject({ entry: 'share', share_id: S, notice_id: X, utm_source: 'share', utm_medium: 'share' });
    expect(st.last_touch.share_id).toBe(S);
    expect(w.__firstTouchAt).toBe(st.first_touch.captured_at);
    const cookie = jar.cookies.find((c) => c.startsWith('gca_attr='))!;
    expect(JSON.parse(decodeURIComponent(cookie.slice('gca_attr='.length))).first_touch.share_id).toBe(S);
  });

  it('ANOTHER shared opportunity later does not overwrite first touch (last touch moves)', () => {
    const jar = fresh();
    boot(`https://getmindy.ai/opportunity-map?opp=${X}&src=share&sh=${S}`, jar);
    const S2 = '7f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    boot(`https://getmindy.ai/opportunity-map?opp=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&src=share&sh=${S2}`, jar);
    const st = JSON.parse(jar.ls.gca_attribution);
    expect(st.first_touch.share_id).toBe(S);
    expect(st.last_touch.share_id).toBe(S2);
    expect(st.visit_count).toBe(2);
  });

  it('an existing legitimate first touch (e.g. from AttributionTracker) is kept, extra keys preserved', () => {
    const jar = fresh();
    jar.ls.gca_attribution = JSON.stringify({ first_touch: { utm_source: 'youtube', captured_at: '2026-01-01T00:00:00Z' }, visit_count: 4, partner_code: 'p1' });
    boot(`https://getmindy.ai/opportunity-map?opp=${X}&src=share&sh=${S}`, jar);
    const st = JSON.parse(jar.ls.gca_attribution);
    expect(st.first_touch).toEqual({ utm_source: 'youtube', captured_at: '2026-01-01T00:00:00Z' });
    expect(st.partner_code).toBe('p1');
    expect(st.visit_count).toBe(5);
  });

  it('direct traffic is labelled direct, never share', () => {
    const jar = fresh();
    boot('https://getmindy.ai/opportunity-map', jar);
    expect(JSON.parse(jar.ls.gca_attribution).first_touch).toMatchObject({ entry: 'direct', utm_source: 'direct', utm_medium: 'none' });
  });

  it('an external referrer is recorded as referral', () => {
    const jar = fresh();
    boot(`https://getmindy.ai/opportunity-map?opp=${X}`, jar, 'https://www.linkedin.com/feed/');
    expect(JSON.parse(jar.ls.gca_attribution).first_touch).toMatchObject({ utm_source: 'linkedin.com', utm_medium: 'referral', entry: 'listing_link' });
  });
});

describe('Share button + arrival events (source shape)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
  it('copies ?<kind>=<id>&src=share&sh=<fresh uuid per click> — no platform UTMs', () => {
    const at = SRC.indexOf("_share.onclick=function()");
    const handler = SRC.slice(at, at + 3200);
    expect(handler).toContain("+'&src=share&sh='+_sid");
    expect(handler).toContain('crypto.randomUUID');
    expect(handler).not.toMatch(/utm_/);
  });
  it('listing_share persists share_id, notice_id, kind and method', () => {
    expect(SRC).toContain("window.__track('tool_use','listing_share',{share_id:_sid,notice_id:String(CUR.id),kind:_pk,method:_method})");
  });
  it('map_view + listing_open carry entry, share id and first-touch time; the anon id is mirrored to a cookie', () => {
    expect(SRC).toContain("if(action==='map_view'||action==='listing_open'){");
    expect(SRC).toContain('m.share_id=_sh.share_id');
    expect(SRC).toContain("if(action==='map_view') m.notice_id=_sh.notice_id");
    expect(SRC).toContain("document.cookie='mindy_anon='+encodeURIComponent(v)");
  });
});

describe('FROZEN Opportunity Share Truth — src/sh change nothing about the shared page', () => {
  it('the whole served page is byte-identical with and without src/sh (crawler)', async () => {
    const plain = await serve(`?opp=${X}`);
    const tagged = await serve(`?opp=${X}&src=share&sh=${S}`);
    expect(tagged).toBe(plain);
    expect(plain).toContain('<title>CES Hillside Mower — Government Opportunity</title>');
  });

  it('…and for a human browser UA', async () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(await serve(`?opp=${X}&src=share&sh=${S}`, ua)).toBe(await serve(`?opp=${X}`, ua));
  });

  it('the same opportunity is selected (one read, for X) and canonical/og:url stay the clean ?opp= link', async () => {
    fetchOppShareRow.mockClear();
    const html = await serve(`?opp=${X}&src=share&sh=${S}`);
    expect(fetchOppShareRow).toHaveBeenCalledTimes(1);
    expect(fetchOppShareRow).toHaveBeenCalledWith(X);
    expect(html).toContain(`<link rel="canonical" href="https://getmindy.ai/opportunity-map?opp=${X}">`);
    expect(html).toContain(`<meta property="og:url" content="https://getmindy.ai/opportunity-map?opp=${X}">`);
    expect(html).toContain(`<meta property="og:image" content="https://getmindy.ai/opportunity-map/og/${X}">`);
    expect(html).not.toContain(S);                                   // the share id never leaks into metadata
  });

  it('the 1200×630 card route keys only on the path id (query params cannot reach it)', () => {
    const og = readFileSync(join(process.cwd(), 'src/app/opportunity-map/og/[id]/route.tsx'), 'utf8');
    expect(og).not.toMatch(/searchParams/);
  });

  it('the ?opp= drawer boot reads only the opp param (src/sh cannot change which drawer opens)', () => {
    expect(HTML).toContain("var _id=_sp.get('opp')||_sp.get('forecast');");
    expect(HTML).toContain("match(/[?&]opp=([^&]+)/)");
  });
});
