import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Zoom-aware pin CLUSTERING (de-overlap) on the Opportunity + Network maps (Eric 2026-08-03: the
// map was a wall of overlapping $-value tags across the eastern US at country/region zoom). A small
// client-side GRID cluster lives in PIN_JS (hoisted global, shared by BOTH render paths — the
// opportunity render() in template.html and the network renderContacts() in route.ts). At LOW zoom
// nearby pins collapse into ONE count bubble ("N Opportunities · $X" / "N Contractors · M Agencies");
// at/above CLUSTER_MAX_ZOOM every pin renders individually, byte-for-byte as before.
//
// ⚠️ NO regex `\b`/`\s` in the cluster helper — the template-literal → client-<script> generation
// collapses a single backslash (docs/REPAIR-LEDGER.md "NL parser \\s-collapse"). The one regex used
// (strip non-numeric) is deliberately confined to `[^0-9.\\-]`, double-backslashed in the TS source,
// and the SUM path avoids parsing formatted strings entirely (uses o.est / o.valueNum / o.won numbers).
//
// This test does two things, mirroring the parser tests: (1) SOURCE-ASSERT the helper + its
// entity-aware label branches + the zoom threshold gate + click-to-zoom exist in route.ts; (2) an
// EVAL test — extract the real PIN_JS block, run clusterRows/clusterLabel/clusterColor on fake rows
// against a fake Leaflet map, and assert real bucketing + labels + colors.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('map clustering — source assertions', () => {
  it('defines the shared grid-cluster helpers in PIN_JS (both render paths call them)', () => {
    expect(route).toContain('function clusterRows(');
    expect(route).toContain('function clusterLabel(');
    expect(route).toContain('function clusterColor(');
    expect(route).toContain('function mkClusterBubble(');
  });

  it('Zillow pin tiers: no pins below PIN_DOT_ZOOM, dots until PIN_TAG_ZOOM, clustering off', () => {
    // ⚠️ CHANGED 2026-08-15 (Eric: "make the map pins denser so it doesn't look empty").
    // The thresholds are now EMBED-AWARE. In the interactive map they stay 0 — the Zillow
    // overlapping-dots model chosen on 08-12 is untouched. In the FRONT-PAGE EMBED clustering is
    // ON, because the overlapping-dots model assumes the dots are SPREAD and here they are not:
    // measured, the embed loads 600 real opportunities that collapse onto 76 coordinates, with
    // 403 of them (67%) stacked on ONE pixel over Columbus OH — DLA parts buys that carry no
    // place-of-performance (397 of 400 sampled have pop_state NULL), so the depot coordinate is
    // the only honest one available. 600 live opportunities rendered as ~35 visible dots and the
    // market read as dead. A "403" bubble states what the stack means; an invisible pile does not.
    // REVERSED 2026-08-16 (Eric: "we agreed to remove clusters" — the embed too). The measurement
    // above is kept as the record of what that trade COSTS: without a bubble those 403 stacked
    // pins are one indistinguishable dot again. Eric chose the dots, knowing that.
    expect(route).toMatch(/var CLUSTER_MAX_ZOOM\s*=\s*0\s*;/);
    expect(route).toContain("var REGIONAL_ZOOM=0;");
    // The embed must actually set the flag, and BEFORE the pin script reads it.
    expect(route).toContain("window.__EMBED_CLUSTER__=1;");
    expect(route).toContain('var PIN_DOT_ZOOM=(_EMBCL?0:5);');
    expect(route).toContain('var PIN_TAG_ZOOM=10;');
    expect(route).toContain('function pinTooFar(');
    expect(route).toContain('function pinFace(');
    expect(route).toContain("if(z>=CLUSTER_MAX_ZOOM||!map||!map.project){out.singles=placed;return out;}");
    const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
    expect(tmpl).toContain('id="zoomHint"');
    expect(tmpl).toContain('Zoom in to see opportunities');
    expect(tmpl).toContain('pinTooFar(map)');
  });

  it('label is ENTITY-AWARE — Opportunities+$ vs Contractors/Agencies', () => {
    // opportunity branch: "N Opportunit(y/ies)" (raw TS carries escaped single quotes)
    expect(route).toContain("(n===1?\\'Opportunity\\':\\'Opportunities\\')");
    // network branch keyed on ctype → Contractors / Agencies, honest zero-drop
    expect(route).toContain("if(mode===\\'network\\')");
    expect(route).toContain('Contractor');
    expect(route).toContain('Agenc'); // Agency/Agencies
  });

  it('the $ sum uses the NUMERIC fields (est/valueNum/won), never the formatted string', () => {
    // o.value is a pre-formatted "$40M" string → the sum must read o.valueNum (the real number)
    expect(route).toContain('num=Number(o.valueNum)');
    expect(route).toContain('num=Number(o.est)');
    expect(route).toContain('num=Number(o.won)');
    expect(route).not.toContain('raw=o.value;'); // the earlier buggy path — must be gone
  });

  it('cluster bubble click DRILLS IN — flyTo centroid + zoom past the threshold', () => {
    expect(route).toContain('map.flyTo([cl.lat,cl.lng],tz)');
    expect(route).toContain('getZoom?map.getZoom():0)+3'); // zoom+3 drill-in
  });

  it('bubble is a .cl-bubble divIcon styled in VTAG_CSS', () => {
    expect(route).toContain("className:\\'cl-wrap\\'");
    expect(route).toContain('.cl-bubble{');
  });

  it('compact COUNT circle — face = count only, size scales with count, full label = hover title', () => {
    // Eric 2026-08-03: fat green text pills → compact count circle (Google/Zillow). count-only face:
    expect(route).toContain('function clusterCount(');
    expect(route).toContain('function clusterSize(');
    // the full "N Opportunities · $X" label is the title attr, not the face (route uses \' escapes)
    expect(route).toContain("title=\"\\'+t+\\'\"");
    expect(route).toContain("\\'+count+\\'</span>");
    // circle chrome (not a rounded pill): border-radius 50% + white ring
    expect(route).toContain('border-radius:50%;');
  });

  it('ONE brand color per map — no horizon/entity encoding on the bubble', () => {
    // network → purple flat; opps → green flat. The old mixed-slate / majority branches are GONE.
    expect(route).toContain("if(mode===\\'network\\')return \\'#7c3aed\\';");
    expect(route).not.toContain("return buy>comp?\\'#dc2626\\':\\'#7c3aed\\';");
  });

  it('both render paths call clusterRows + mkClusterBubble (opps + network)', () => {
    // network renderContacts()
    expect(route).toContain("clusterRows(rows,map,64)");
    expect(route).toContain("mkClusterBubble(cl,map,'network')");
    // opportunity render() lives in template.html; its generated mirror + the html carry 'opps'
    const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
    expect(tmpl).toContain("mkClusterBubble(cl,map,'opps')");
    expect(tmpl).toContain('clusterRows(rows,map,64)');
  });

  it('re-clusters on zoomend WITHOUT a refetch', () => {
    expect(route).toContain("map.on('zoomend',function(){ try{ if(typeof render==='function')render();");
  });
});

// ---- EVAL: run the real PIN_JS cluster helpers on fake rows ----
function loadClusterHelpers() {
  const start = route.indexOf('const PIN_JS =');
  const endMarker = "+ '</script>';";
  const end = route.indexOf(endMarker, start) + endMarker.length;
  const jsExprSrc = route.slice(start, end).replace(/^const PIN_JS =/, '').replace(/;$/, '');
  const pinJsHtml = vm.runInNewContext('(' + jsExprSrc + ')', {});
  const pinJs = pinJsHtml.replace(/^<script>/, '').replace(/<\/script>$/, '');
  const ctx: any = {
    console,
    cv: (v: string) => (({ '--grnd': '#22a06b', '--recomp': '#b45309', '--forecast': '#7c3aed' } as any)[v] || ''),
    L: {
      divIcon: (o: any) => ({ __icon: o }),
      marker: (ll: any, o: any) => ({ ll, o, on() { return this; }, getElement: () => null, setZIndexOffset() {} }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(pinJs, ctx);
  return ctx;
}
// Fake Leaflet map: linear lat/lng → pixel projection scaled by zoom (nearby points share a bucket
// at low zoom, split at high zoom). Coords are chosen OFF grid lines so the toy floor() is stable.
const fakeMap = (zoom: number) => ({
  getZoom: () => zoom,
  project: ([lat, lng]: number[], z: number) => ({ x: (lng + 180) * 2 ** z * 2, y: (90 - lat) * 2 ** z * 2 }),
  flyTo() {}, setView() {},
});

describe('map clustering — eval on fake rows', () => {
  const H = loadClusterHelpers();

  const dc = [
    { sol: 'a', lat: 38.9, lng: -77.03, src: 'OPEN', est: 5_000_000 },
    { sol: 'b', lat: 38.91, lng: -77.02, src: 'OPEN', est: 12_000_000 },
    { sol: 'c', lat: 38.89, lng: -77.05, src: 'OPEN', est: 3_000_000 },
    { sol: 'd', lat: 38.88, lng: -77.01, src: 'RECOMPETE', valueNum: 40_000_000, value: '$40M' },
  ];

  it('clustering is OFF at every zoom — overlapping dots, not count-bubbles (Zillow)', () => {
    const far = H.clusterRows(dc, fakeMap(4), 64);
    expect(far.clusters.length).toBe(0);
    expect(far.singles.length).toBe(dc.length);
    const mid = H.clusterRows(dc, fakeMap(6), 64);
    expect(mid.clusters.length).toBe(0);
    expect(mid.singles.length).toBe(dc.length);
  });

  it('pinTooFar hides pins at country zoom (Zillow "Zoom in to see homes")', () => {
    expect(H.PIN_DOT_ZOOM).toBe(5);
    expect(H.pinTooFar(fakeMap(4.5))).toBe(true);  // CONUS boot
    expect(H.pinTooFar(fakeMap(5))).toBe(false);   // regional → dots
  });

  it('opportunity label helper still sums NUMERIC fields = $60M (kept for a future toggle)', () => {
    const label = H.clusterLabel(dc, 'opps');
    expect(label).toMatch(/^4 Opportunities · \$60M$/);
  });

  it('pinFace is a DOT below PIN_TAG_ZOOM=10 and a $ tag only when close in', () => {
    expect(H.PIN_TAG_ZOOM).toBe(10);
    expect(H.pinFace(dc[0], fakeMap(6))).toBe('');  // regional → dot
    expect(H.pinFace(dc[0], fakeMap(9))).toBe('');  // still a dot (Zillow Midwest)
    expect(H.pinFace(dc[0], fakeMap(10))).toMatch(/^\$/); // neighborhood → value tag
  });

  it('HIGH zoom (>= threshold) renders every placed row as an individual — clustering OFF', () => {
    const { clusters, singles } = H.clusterRows(dc, fakeMap(10), 64);
    expect(clusters.length).toBe(0);
    expect(singles.length).toBe(dc.length);
  });

  it('ONE brand color per MAP — opps green regardless of horizon mix (color lives in the filter, not the bubble)', () => {
    // Eric 2026-08-03: the circle no longer encodes horizon — a mixed OPEN+RECOMPETE cluster is
    // still the opportunity-green brand hue, not a neutral "mixed" slate.
    expect(H.clusterColor(dc, 'opps')).toBe('#22a06b'); // OPEN + RECOMPETE mixed → still green
    const open2 = [
      { lat: 40.3, lng: -75, src: 'OPEN', est: 1 },
      { lat: 40.3005, lng: -75.0005, src: 'OPEN', est: 2 },
    ];
    expect(H.clusterColor(open2, 'opps')).toBe('#22a06b');
  });

  it('network label = "N Contractors · M Agencies", zero-segment dropped', () => {
    const net: any[] = [];
    for (let i = 0; i < 23; i++) net.push({ lat: 38.9 + i * 1e-5, lng: -77, ctype: 'companies', won: 1_000_000 });
    for (let i = 0; i < 7; i++) net.push({ lat: 38.9 + i * 1e-5, lng: -77, ctype: 'buyers' });
    expect(H.clusterLabel(net, 'network')).toBe('23 Contractors · 7 Agencies');

    const compOnly = [
      { lat: 40.3, lng: -75, ctype: 'companies', won: 1 },
      { lat: 40.30001, lng: -75, ctype: 'companies', won: 1 },
    ];
    expect(H.clusterLabel(compOnly, 'network')).toBe('2 Contractors'); // no "0 Agencies"
    expect(H.clusterColor(compOnly, 'network')).toBe('#7c3aed'); // network = purple brand hue
    // buyers-majority is STILL purple — one brand color per map, entity mix lives in the filter
    expect(H.clusterColor(net, 'network')).toBe('#7c3aed');
  });

  it('circle FACE shows the count only; diameter scales with count (Google/Zillow density)', () => {
    // count-only face: the full "N Opportunities · $X" string is the hover title, not the face
    expect(H.clusterCount([{}, {}, {}])).toBe('3');
    expect(H.clusterCount(new Array(27).fill({}))).toBe('27');
    // 1000+ compacts so a 4-digit count never blows out the circle
    expect(H.clusterCount(new Array(1456).fill({}))).toBe('1.5k');
    // diameter buckets: bigger cluster → bigger circle, monotonic non-decreasing
    const sizes = [5, 12, 40, 200, 800].map((n) => H.clusterSize(new Array(n).fill({})));
    expect(sizes).toEqual([28, 34, 40, 46, 54]);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });

  it('singular grammar: "1 Opportunity" when count is 1', () => {
    expect(H.clusterLabel([{ src: 'OPEN', est: 1000 }], 'opps')).toMatch(/^1 Opportunity/);
  });

  it('unplaced rows (null lat/lng) are never fabricated into pins', () => {
    const rows = [
      { sol: 'u', src: 'OPEN', est: 1 },
      { sol: 'p', lat: 40, lng: -75, src: 'OPEN', est: 1 },
    ];
    const { singles } = H.clusterRows(rows, fakeMap(10), 64);
    expect(singles.length).toBe(1);
    expect(singles[0].sol).toBe('p');
  });
});
