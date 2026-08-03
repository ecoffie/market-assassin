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

  it('has a zoom THRESHOLD gate — clusters below, individuals at/above', () => {
    expect(route).toContain('var CLUSTER_MAX_ZOOM=7;');
    // above the threshold every placed row is an individual pin (clustering off)
    expect(route).toContain("if(z>=CLUSTER_MAX_ZOOM||!map||!map.project){out.singles=placed;return out;}");
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

  it('LOW zoom collapses a dense group into ONE plural bubble', () => {
    const { clusters, singles } = H.clusterRows(dc, fakeMap(4), 64);
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(4);
    expect(singles.length).toBe(0);
  });

  it('opportunity label = "N Opportunities · $sum" (sum via NUMERIC fields = $60M)', () => {
    const { clusters } = H.clusterRows(dc, fakeMap(4), 64);
    const label = H.clusterLabel(clusters[0].members, 'opps');
    expect(label).toMatch(/^4 Opportunities · \$60M$/);
  });

  it('centroid = the members\' average lat/lng (honest, never fabricated)', () => {
    const { clusters } = H.clusterRows(dc, fakeMap(4), 64);
    const avgLat = dc.reduce((s, m) => s + m.lat, 0) / dc.length;
    expect(Math.abs(clusters[0].lat - avgLat)).toBeLessThan(1e-9);
  });

  it('HIGH zoom (>= threshold) renders every placed row as an individual — clustering OFF', () => {
    const { clusters, singles } = H.clusterRows(dc, fakeMap(10), 64);
    expect(clusters.length).toBe(0);
    expect(singles.length).toBe(dc.length);
  });

  it('mixed-horizon cluster = neutral slate; single-horizon OPEN = green', () => {
    expect(H.clusterColor(dc, 'opps')).toBe('#475569'); // OPEN + RECOMPETE mixed
    const open2 = [
      { lat: 40.3, lng: -75, src: 'OPEN', est: 1 },
      { lat: 40.3005, lng: -75.0005, src: 'OPEN', est: 2 },
    ];
    const { clusters } = H.clusterRows(open2, fakeMap(4), 64);
    expect(H.clusterColor(clusters[0].members, 'opps')).toBe('#22a06b');
  });

  it('network label = "N Contractors · M Agencies", zero-segment dropped', () => {
    const net: any[] = [];
    for (let i = 0; i < 23; i++) net.push({ lat: 38.9 + i * 1e-5, lng: -77, ctype: 'companies', won: 1_000_000 });
    for (let i = 0; i < 7; i++) net.push({ lat: 38.9 + i * 1e-5, lng: -77, ctype: 'buyers' });
    const { clusters } = H.clusterRows(net, fakeMap(4), 64);
    const label = H.clusterLabel(clusters[0].members, 'network');
    expect(label).toBe('23 Contractors · 7 Agencies');

    const compOnly = [
      { lat: 40.3, lng: -75, ctype: 'companies', won: 1 },
      { lat: 40.30001, lng: -75, ctype: 'companies', won: 1 },
    ];
    const c2 = H.clusterRows(compOnly, fakeMap(4), 64);
    expect(H.clusterLabel(c2.clusters[0].members, 'network')).toBe('2 Contractors'); // no "0 Agencies"
    expect(H.clusterColor(c2.clusters[0].members, 'network')).toBe('#7c3aed'); // companies-majority purple
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
