/**
 * office_viewed — Learn M3·discover's signal (repair board P0-G, 2026-09-26).
 *
 * Before this, opening a buyer drawer or a listing's Buyer tab recorded NOTHING, so "the user
 * inspected 5 buying offices" had no evidence at all. These tests EXECUTE the client source
 * extracted from route.ts:
 *   · the office key is an OFFICE (DoDAAC or office name), never an agency;
 *   · the buyer drawer fires only after a buyer RENDERS — a failed load fires nothing;
 *   · the listing's Buyer tab fires with that listing's office; other tabs fire nothing;
 *   · it rides window.__track (the Map's authenticated transport) — no second sender.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function slice(start: string, end: string) {
  const a = MAP.indexOf(start);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

const HELPERS = slice('  function officeKeyOf(sol, office){', '  // Build the sticky tab bar');
const BUILD_TABS = slice('  function buildTabs(){', '  // INTENTIONAL section order');
const OPEN_BUYER = slice('  window.openBuyerDrawer=function(id){', '})();\n</script>`;');

type Ev = [string, string, Record<string, unknown>];

function harness() {
  const events: Ev[] = [];
  const win: Record<string, unknown> = { __track: (k: string, a: string, m: Record<string, unknown>) => events.push([k, a, m]), __mapMode: 'companies' };
  return { events, win };
}

describe('officeKeyOf — an office, never an agency', () => {
  const { win } = harness();
  const officeKeyOf = new Function('window', `${HELPERS}\nreturn officeKeyOf;`)(win) as (s: string, o: string) => { key: string | null; src: string | null };
  it('DoDAAC from the solicitation prefix (dashes ignored)', () => {
    expect(officeKeyOf('W912PL-24-R-0001', 'LA District')).toEqual({ key: 'dodaac:W912PL', src: 'dodaac' });
    expect(officeKeyOf('N0017426R1003', '')).toEqual({ key: 'dodaac:N00174', src: 'dodaac' });
  });
  it('a digit-led civilian number falls back to the normalized office name', () => {
    expect(officeKeyOf('36C24226Q0857', 'Network Contracting Office 2')).toEqual({ key: 'office:network contracting office 2', src: 'office_name' });
  });
  it('no DoDAAC and no office → null (never the agency)', () => {
    expect(officeKeyOf('70RTAC26R00000007', '')).toEqual({ key: null, src: null });
  });
});

function drawerHarness(resp: { status: number; body: unknown } | 'network') {
  const h = harness();
  const el = () => ({ innerHTML: '', classList: { add() {}, remove() {} }, scrollTop: 0 });
  const ctx = { dr: el(), bd: el(), body: el() };
  const fetchFn = () => resp === 'network'
    ? Promise.reject(new TypeError('Failed to fetch'))
    : Promise.resolve({ status: resp.status, json: () => Promise.resolve(resp.body) });
  const open = new Function('window', 'localStorage', 'fetch', 'atob', 'dr', 'bd', 'body',
    'clearTaskOrderPins', 'buyerRender', 'buildTabs', 'loadBuyerEventDna', 'drawerLoadError',
    `${HELPERS}\n${OPEN_BUYER}\nreturn window.openBuyerDrawer;`)(
    h.win, { getItem: () => null }, fetchFn, (s: string) => s, ctx.dr, ctx.bd, ctx.body,
    () => {}, () => '<div>buyer</div>', () => {}, () => {}, () => '<div>error</div>') as (id: string) => void;
  return { ...h, open };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Players buyer drawer', () => {
  it('fires office_viewed once the buyer RENDERS, keyed to the ANCHOR row the user opened', async () => {
    // The person is named on notices from two offices; the most recent (sorted first) is W91QVN,
    // but the drawer was opened from their W51LL5 row. Credit W51LL5 — never the first-sorted one.
    const h = drawerHarness({ status: 200, body: { success: true, buyer: {
      id: 'c1', name: 'Pat Buyer', agency: 'Department of the Army', office: '',
      anchorSolicitation: 'W51LL526RA017', officeCount: 2,
      opportunities: [{ solicitationNumber: 'W91QVN26RA078' }, { solicitationNumber: 'W51LL526RA017' }] } } });
    h.open('c1'); await flush(); await flush();
    expect(h.events).toEqual([['tool_use', 'office_viewed',
      { office_key: 'dodaac:W51LL5', office_key_source: 'dodaac', agency: 'Department of the Army', entry: 'buyer_drawer', record_kind: 'buyer', contact_office_count: 2 }]]);
  });

  it('with no anchor DoDAAC it falls back to the office name, never to another notice', async () => {
    const h = drawerHarness({ status: 200, body: { success: true, buyer: {
      id: 'c2', name: 'Lee', agency: 'Department of State', office: 'AQM Momentum', anchorSolicitation: '19AQMM26R0001x',
      officeCount: 0, opportunities: [{ solicitationNumber: 'W91QVN26RA078' }] } } });
    h.open('c2'); await flush(); await flush();
    expect(h.events[0][2]).toMatchObject({ office_key: 'office:aqm momentum', office_key_source: 'office_name' });
  });

  it('a failed load (401 / 404 / network) is not a view', async () => {
    for (const r of [{ status: 401, body: { success: false } }, { status: 404, body: { success: false } }, 'network' as const]) {
      const h = drawerHarness(r);
      h.open('c1'); await flush(); await flush();
      expect(h.events).toHaveLength(0);
    }
  });
});

describe("listing drawer's Buyer tab", () => {
  function tabsHarness(present: string[], cur: Record<string, unknown>) {
    const h = harness();
    const buttons: { t: string; onclick: null | (() => void); classList: { toggle: () => void }; getAttribute: (k: string) => string }[] = [];
    const tabs = {
      set innerHTML(html: string) {
        buttons.length = 0;
        for (const m of html.matchAll(/data-t="([^"]+)"/g)) {
          const t = m[1];
          buttons.push({ t, onclick: null, classList: { toggle() {} }, getAttribute: () => t });
        }
      },
      querySelectorAll: () => buttons,
      classList: { toggle() {} },
    };
    const doc = { getElementById: (id: string) => (id === 'oppTabs' ? tabs : present.includes(id.replace('osec-', '')) ? { offsetTop: 500 } : null) };
    const dr = { scrollTo() {}, scrollTop: 0, onscroll: null };
    new Function('window', 'document', 'dr', 'CUR', `${HELPERS}\n${BUILD_TABS}\nbuildTabs();`)(h.win, doc, dr, cur);
    return { ...h, buttons };
  }

  it('opening Buyer fires with the listing office', () => {
    const h = tabsHarness(['overview', 'facts', 'agencyintel'], { id: 'n1', solicitation: 'FA670326Q0015', office: 'FA6703 AFSOC', department: 'DEPT OF DEFENSE' });
    const buyer = h.buttons.find((b) => b.t === 'agencyintel')!;
    buyer.onclick!();
    expect(h.events).toEqual([['tool_use', 'office_viewed',
      { office_key: 'dodaac:FA6703', office_key_source: 'dodaac', agency: 'DEPT OF DEFENSE', entry: 'buyer_tab', record_kind: 'open' }]]);
  });

  it('repeat opens are each recorded (measurable) with the same key', () => {
    const h = tabsHarness(['agencyintel'], { solicitation: 'FA670326Q0015', department: 'DOD' });
    const buyer = h.buttons.find((b) => b.t === 'agencyintel')!;
    buyer.onclick!(); buyer.onclick!();
    expect(h.events.map((e) => e[2].office_key)).toEqual(['dodaac:FA6703', 'dodaac:FA6703']);
  });

  it('other tabs fire nothing', () => {
    const h = tabsHarness(['overview', 'facts', 'agencyintel'], { solicitation: 'FA670326Q0015' });
    h.buttons.filter((b) => b.t !== 'agencyintel').forEach((b) => b.onclick!());
    expect(h.events).toHaveLength(0);
  });

  it('a company drawer tab is never an office view', () => {
    const h = tabsHarness(['agencyintel'], { kind: 'company', solicitation: 'W912PL24R0001' });
    h.buttons.forEach((b) => b.onclick!());
    expect(h.events).toHaveLength(0);
  });
});

describe('transport', () => {
  it('uses window.__track only — no sendBeacon, no new fetch', () => {
    expect(HELPERS).toMatch(/window\.__track\('tool_use','office_viewed'/);
    expect(HELPERS).not.toMatch(/sendBeacon|fetch\(/);
  });
});
