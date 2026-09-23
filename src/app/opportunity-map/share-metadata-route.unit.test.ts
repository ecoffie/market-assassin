/**
 * GUARD — a shared `/opportunity-map?opp=<notice_id>` serves object-specific social metadata
 * SERVER-SIDE (crawlers never run the map's JS), and every other request is byte-for-byte the
 * page it was before.
 *
 * Production before (2026-09-23, facebookexternalhit / LinkedInBot / Twitterbot / curl, all 200, no
 * redirect, no auth wall): zero og:/twitter: tags and `<title>Mindy Map</title>` — the root cause
 * of Facebook rendering "GETMINDY.AI / Mindy Map" with the purple logo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/opportunities/map-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/opportunities/map-data')>()),
  getMapOpportunities: vi.fn(async () => []),
}));

// Calls are recorded by the vi.fn; the RETURN value comes from `impl`, a plain function. (An async
// vi.fn that rejects makes tinyspy chain its own tracking promise onto the rejection, which vitest
// reports as an unhandled "boom" even though the route caught it — measured, not assumed.)
const fetchOppShareRow = vi.fn();
let impl: (id: string) => Promise<unknown> = async () => null;
vi.mock('@/lib/opportunities/share-metadata', async (orig) => ({
  ...(await orig<typeof import('@/lib/opportunities/share-metadata')>()),
  fetchOppShareRow: (id: string) => { fetchOppShareRow(id); return impl(id); },
}));

const MOWER = {
  notice_id: '0fdb5f972b2a46648adf2e2b8a6558ce', title: 'CES Hillside Mower',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', notice_type: 'Combined Synopsis/Solicitation',
  solicitation_number: 'W50S9J-26-Q-0013', response_deadline: '2099-09-29T13:00:00+00:00',
  responseDeadLine: '2099-09-29T09:00:00-04:00', active: true, pop_state: 'WV',
};

async function get(qs: string): Promise<string> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/opportunity-map${qs}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } }));
  expect(res.status).toBe(200);
  return res.text();
}
const headOf = (html: string) => html.slice(0, html.indexOf('</head>'));

beforeEach(() => { fetchOppShareRow.mockReset(); impl = async () => null; });

describe('/opportunity-map share metadata', () => {
  it('?opp=<notice_id> → the opportunity, not "Mindy Map", in server-rendered <head>', async () => {
    impl = async () => MOWER;
    const head = headOf(await get(`?opp=${MOWER.notice_id}`));
    expect(fetchOppShareRow).toHaveBeenCalledWith(MOWER.notice_id);
    expect(head).toContain('<title>CES Hillside Mower — Government Opportunity</title>');
    expect(head).not.toContain('<title>Mindy Map</title>');
    expect(head).toContain('<meta property="og:title" content="CES Hillside Mower — Government Opportunity">');
    expect(head).toContain(`<meta property="og:image" content="https://getmindy.ai/opportunity-map/og/${MOWER.notice_id}">`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain('Solicitation W50S9J-26-Q-0013');
    expect((head.match(/<title>/g) || []).length).toBe(1);
  });

  it('plain /opportunity-map is unchanged (no DB read, generic title)', async () => {
    const html = await get('');
    expect(fetchOppShareRow).not.toHaveBeenCalled();
    expect(headOf(html)).toContain('<title>Mindy Map</title>');
    expect(headOf(html)).not.toContain('og:title');
  });

  it('unknown notice → generic page, never a fabricated card', async () => {
    impl = async () => null;
    const head = headOf(await get('?opp=ffffffffffffffffffffffffffffffff'));
    expect(head).toContain('<title>Mindy Map</title>');
    expect(head).not.toContain('og:title');
  });

  it('a DB error degrades to the generic page (the map still loads)', async () => {
    impl = async () => { throw new Error('boom'); };
    const head = headOf(await get(`?opp=${MOWER.notice_id}`));
    expect(head).toContain('<title>Mindy Map</title>');
  });

  it('non-notice ids (forecast fc-…) and embed never trigger a read', async () => {
    await get('?opp=fc-12345');
    await get(`?opp=${MOWER.notice_id}&embed=1`);
    expect(fetchOppShareRow).not.toHaveBeenCalled();
  });

  it('the ?opp= drawer boot is still in the page (authenticated Maps behavior preserved)', async () => {
    impl = async () => MOWER;
    const html = await get(`?opp=${MOWER.notice_id}`);
    expect(html).toContain("_sp.get('opp')");
  });
});
