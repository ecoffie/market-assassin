'use client';
/**
 * OpportunityMap — the full Leaflet map + list + filters, ported from Eric's
 * evc-opportunity-map prototype to live Mindy data. Pins colored by set-aside;
 * click a pin or a list card to focus; "Draft with Mindy" opens the proposal drafter
 * (or the connected agent when MCP is linked).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Opp = {
  id: string; title: string; agency: string; set: string; setLabel: string;
  naics: string; cat: string; loc: string; close: string | null; sol: string;
  uiLink: string | null; lat: number; lng: number; src: string;
};
type Group = { key: string; label: string; color: string };

const TODAY = new Date(new Date().toISOString().slice(0, 10) + 'T00:00');
function daysOut(o: Opp): number | null {
  if (!o.close) return null;
  return Math.round((new Date(o.close.slice(0, 10) + 'T00:00').getTime() - TODAY.getTime()) / 864e5);
}
function fmtDays(d: number | null): { t: string; c: string } {
  if (d == null) return { t: 'No deadline', c: 'cool' };
  if (d < 0) return { t: 'Closed', c: 'dead' };
  if (d === 0) return { t: 'Due today', c: 'hot' };
  if (d <= 3) return { t: `${d}d left`, c: 'hot' };
  if (d <= 7) return { t: `${d}d left`, c: 'warm' };
  return { t: `${d}d left`, c: 'cool' };
}
function samURL(o: Opp): string {
  return o.uiLink || 'https://sam.gov/search/?keywords=' + encodeURIComponent(o.sol || o.title);
}
// Mindy drafter deep link (prefilled) — or the connected agent's prompt when MCP is linked.
function draftURL(o: Opp, mcp: boolean): string {
  if (mcp) {
    const p = `Draft a federal bid response. Opportunity: ${o.title}. Agency: ${o.agency}. Set-aside: ${o.setLabel}. Location: ${o.loc}. NAICS ${o.naics}. Solicitation #: ${o.sol}. Pull the solicitation, build a compliance matrix, and draft the approach.`;
    return 'https://claude.ai/new?q=' + encodeURIComponent(p);
  }
  const q = new URLSearchParams({ panel: 'proposal', opp: o.id, sol: o.sol, title: o.title });
  return '/app?' + q.toString();
}

export default function OpportunityMap({ opps, setGroups, mcpConnected = false }: { opps: Opp[]; setGroups: Group[]; mcpConnected?: boolean }) {
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  const cats = useMemo(() => Array.from(new Set(opps.map((o) => o.cat))).sort(), [opps]);
  const colorFor = useMemo(() => Object.fromEntries(setGroups.map((g) => [g.key, g.color])) as Record<string, string>, [setGroups]);

  const [setF, setSetF] = useState<Set<string>>(() => new Set(setGroups.map((g) => g.key)));
  const [catF, setCatF] = useState<Set<string>>(() => new Set()); // empty = all
  const [soon, setSoon] = useState(false);
  const [sort, setSort] = useState<'deadline' | 'agency'>('deadline');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = opps.filter((o) => setF.has(o.set) && (catF.size === 0 || catF.has(o.cat)));
    if (soon) rows = rows.filter((o) => { const d = daysOut(o); return d != null && d >= 0 && d <= 7; });
    rows = [...rows].sort((a, b) =>
      sort === 'agency' ? a.agency.localeCompare(b.agency) : (daysOut(a) ?? 1e9) - (daysOut(b) ?? 1e9));
    return rows;
  }, [opps, setF, catF, soon, sort]);

  const closingThisWeek = useMemo(() => opps.filter((o) => { const d = daysOut(o); return d != null && d >= 0 && d <= 7; }).length, [opps]);
  const sdvosbCount = useMemo(() => opps.filter((o) => o.set === 'SDVOSB').length, [opps]);

  // Init map once — Leaflet is dynamically imported so it never runs during SSR.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || mapRef.current || !mapEl.current) return;
      const L = mod.default; LRef.current = L;
      const map = L.map(mapEl.current, { scrollWheelZoom: true, zoomControl: false, worldCopyJump: true, zoomSnap: 0.5 }).setView([38, -96], 4.2);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap, &copy; CARTO',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Redraw markers when the filtered set changes.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const pts: Leaflet.LatLngExpression[] = [];
    for (const o of filtered) {
      const m = L.circleMarker([o.lat, o.lng], {
        radius: selected === o.id ? 9 : 6, color: '#0b0a12', weight: 1.5,
        fillColor: colorFor[o.set] || '#94a3b8', fillOpacity: 0.9,
      });
      m.on('click', () => setSelected(o.id));
      m.bindTooltip(`${o.title.slice(0, 46)}${o.title.length > 46 ? '…' : ''}`, { direction: 'top', offset: [0, -4] });
      m.addTo(layer);
      pts.push([o.lat, o.lng]);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { animate: false, maxZoom: 6 });
  }, [filtered, selected, colorFor, ready]);

  // Scroll the selected card into view.
  useEffect(() => {
    if (selected) document.getElementById('opc-' + selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const toggle = (s: Set<string>, v: string, set: (x: Set<string>) => void) => {
    const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); set(n);
  };

  return (
    <div className="omap">
      <style>{CSS}</style>
      <aside className="side">
        <div className="sh">
          <div className="ttl">Opportunity Map</div>
          <div className="sub"><b>{filtered.length.toLocaleString()}</b> shown · <b>{sdvosbCount}</b> SDVOSB · <b>{closingThisWeek}</b> closing this week</div>
        </div>
        <div className="filters">
          <div className="legend">
            {setGroups.map((g) => {
              const on = setF.has(g.key);
              return (
                <button key={g.key} className={`chip${on ? '' : ' off'}`} onClick={() => toggle(setF, g.key, setSetF)}>
                  <span className="dot" style={{ background: g.color, opacity: on ? 1 : 0.35 }} />{g.label}
                </button>
              );
            })}
          </div>
          <div className="frow">
            <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as 'deadline' | 'agency')}>
              <option value="deadline">Deadline: soonest</option>
              <option value="agency">Agency A–Z</option>
            </select>
            <select className="sel" value={catF.size === 1 ? [...catF][0] : ''} onChange={(e) => setCatF(e.target.value ? new Set([e.target.value]) : new Set())}>
              <option value="">All service lines</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className={`tgl${soon ? ' on' : ''}`} onClick={() => setSoon((v) => !v)}>Closing ≤7d</button>
          </div>
        </div>
        <div className="list">
          {filtered.length === 0 ? <div className="empty">No opportunities match these filters.</div> : filtered.map((o) => {
            const d = fmtDays(daysOut(o));
            return (
              <div id={'opc-' + o.id} key={o.id} className={`opc${selected === o.id ? ' sel' : ''}`} onClick={() => { setSelected(o.id); mapRef.current?.setView([o.lat, o.lng], 6, { animate: true }); }}>
                <div className="opc-top"><span className="badge" style={{ color: colorFor[o.set], borderColor: colorFor[o.set] }}>{o.setLabel || o.set}</span><span className={`due ${d.c}`}>{d.t}</span></div>
                <div className="opc-ttl">{o.title}</div>
                <div className="opc-meta">{o.agency}{o.loc ? ` · ${o.loc}` : ''} · NAICS {o.naics || '—'}</div>
                <div className="opc-act"><a className="lnk" href={samURL(o)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>View on SAM.gov</a><a className="btn" href={draftURL(o, mcpConnected)} target={mcpConnected ? '_blank' : undefined} rel="noreferrer" onClick={(e) => e.stopPropagation()}>Draft with Mindy →</a></div>
              </div>
            );
          })}
        </div>
      </aside>
      <div className="mapwrap"><div ref={mapEl} className="lmap" /></div>
    </div>
  );
}

const CSS = `
.omap{--bg:#0b0a12;--surface:#17141f;--surface2:#1e1a2b;--line:#2a2438;--line2:#372f4d;--ink:#f6f4ff;--ink2:#c5bfd8;--mut:#8a8399;--violet2:#a855f7;--grad:linear-gradient(135deg,#7c3aed,#a855f7 55%,#6d28d9);
  display:grid;grid-template-columns:388px 1fr;height:100dvh;background:var(--bg);color:var(--ink);font-family:"SF Pro Text",-apple-system,system-ui,sans-serif}
.omap *{box-sizing:border-box}
@media(max-width:820px){.omap{grid-template-columns:1fr;grid-template-rows:1fr 1fr}}
.omap .side{display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0;background:var(--bg)}
.omap .sh{padding:18px 20px 12px}
.omap .ttl{font-size:19px;font-weight:850;letter-spacing:-.02em}
.omap .sub{font-size:12.5px;color:var(--mut);margin-top:4px}
.omap .sub b{color:var(--ink2)}
.omap .filters{padding:0 20px 12px;border-bottom:1px solid var(--line)}
.omap .legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.omap .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:5px 9px;border-radius:99px;background:var(--surface2);border:1px solid var(--line);color:var(--ink2);cursor:pointer}
.omap .chip.off{color:var(--mut)}
.omap .chip .dot{width:8px;height:8px;border-radius:50%}
.omap .frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.omap .sel{background:var(--surface2);color:var(--ink2);border:1px solid var(--line);border-radius:9px;padding:7px 9px;font-size:12.5px;font-family:inherit;cursor:pointer}
.omap .tgl{background:var(--surface2);color:var(--ink2);border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:12.5px;font-weight:700;cursor:pointer}
.omap .tgl.on{background:var(--grad);color:#fff;border-color:transparent}
.omap .list{flex:1;overflow-y:auto;min-height:0;padding:10px 14px 24px}
.omap .empty{color:var(--mut);font-size:13px;padding:24px 6px;text-align:center}
.omap .opc{padding:13px;border:1px solid var(--line);border-radius:13px;background:var(--surface);margin-bottom:9px;cursor:pointer}
.omap .opc:hover{border-color:var(--line2)}
.omap .opc.sel{border-color:var(--violet2);box-shadow:0 0 0 1px var(--violet2)}
.omap .opc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.omap .badge{font-size:10px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:3px 7px;border-radius:6px;border:1px solid;background:rgba(255,255,255,.03)}
.omap .due{font-size:11px;font-weight:800}
.omap .due.hot{color:#fb7185}.omap .due.warm{color:#fbbf24}.omap .due.cool{color:var(--mut)}.omap .due.dead{color:var(--mut)}
.omap .opc-ttl{font-size:13.5px;font-weight:700;line-height:1.32}
.omap .opc-meta{font-size:11.5px;color:var(--mut);margin-top:5px;line-height:1.4}
.omap .opc-act{display:flex;align-items:center;gap:10px;margin-top:11px}
.omap .opc-act .lnk{font-size:12px;font-weight:700;color:var(--ink2)}
.omap .opc-act .lnk:hover{color:var(--ink)}
.omap .opc-act .btn{margin-left:auto;font-size:12px;font-weight:800;color:#fff;background:var(--grad);padding:7px 12px;border-radius:9px;text-decoration:none}
.omap .mapwrap{position:relative;min-height:0}
.omap .lmap{position:absolute;inset:0}
.omap .leaflet-container{background:#0e1420;font-family:inherit}
.omap a{text-decoration:none}
`;
