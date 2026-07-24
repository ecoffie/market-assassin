/**
 * GET /opportunity-map — serves Eric's evc-opportunity-map prototype VERBATIM (its exact
 * HTML/CSS/JS from template.html), with the static OPPS array swapped for LIVE opportunities.
 * We only adapt our data into the shape the prototype's JS expects; nothing about the design
 * is rebuilt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMapOpportunities } from '@/lib/opportunities/map-data';
import { OPPORTUNITY_MAP_TEMPLATE } from './template-html';

export const dynamic = 'force-dynamic';

// ?embed=1 → map only (hide the sidebar/rail/scoreboard) so the SAME map can be dropped
// full-bleed into the /home-v5 hero box. It's the real map, not a preview.
// Embed = map only, sized to the iframe (kill the 100vh/min-height:560 chain that leaves the
// map zero-height inside a shorter iframe → blank box), controls hidden.
const EMBED_CSS = '<style>html,body{height:100%!important;min-height:0!important}'
  + '.app{grid-template-columns:0 minmax(0,1fr)!important;height:100%!important;min-height:0!important}'
  + '.mapwrap{height:100%!important;border:0}#map{height:100%!important}'
  + '.panel,.railbtn,.sbtoggle,.sb,.maptop{display:none!important}</style>';
// Force Leaflet to re-measure once the iframe has its real size (else tiles render blank).
const EMBED_JS = "<script>window.addEventListener('load',function(){[200,600,1200].forEach(function(t){setTimeout(function(){try{map.invalidateSize();fitView();}catch(e){}},t);});});</script>";

// Our set-aside group key → the token the prototype's setKey()/cardHTML expect.
const SET_TO_EVC: Record<string, string> = {
  SDVOSB: 'SDVOSB', SB: 'SB', '8A': '8(a)', WOSB: 'WOSB', HZ: 'HUBZone', OTHER: 'Other', NONE: 'None',
};

// Clean the raw department into a short, readable agency label for the card.
function cleanAgency(dept: string): string {
  const d = (dept || '').replace(/,?\s*DEPARTMENT OF( THE)?/i, '').replace(/DEPARTMENT OF( THE)?\s*/i, '').trim();
  return d.replace(/\b([A-Z])([A-Z0-9'&./-]*)/g, (_, a, b) => a + b.toLowerCase()) || dept;
}

// A "Commodity buys" toggle injected into the filter bar (no self-filtering — default SHOWS
// all; the user opts to hide FSC micro-buys). Sits alongside the template's own filters.
const FSC_TOGGLE = '<button class="fbtn" id="fscToggle" title="FSC parts/commodity micro-buys">Commodity buys: shown</button>';

// Full-page CSS overrides (kept out of the verbatim template): (1) sheet-label readability
// — grid items default to min-width:auto so nowrap labels overflow their cell; let them wrap.
// (2) filter bar WRAPS to a 2nd row instead of hiding filters off-screen behind a scroll.
// (3) a set-aside color legend on the map.
const PAGE_CSS = '<style>'
  + '.opt{min-width:0;align-items:flex-start}'
  + '.opt .cbx,.opt .swatch{margin-top:2px}'
  + '.opt .lbl{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.25;word-break:break-word}'
  + '.sheet{max-height:48vh;overflow-y:auto}'
  // Filters wrap (no more horizontal-scroll hiding Set-aside & beyond).
  + '.fscroll{flex-wrap:wrap!important;overflow-x:visible!important;row-gap:7px}'
  // Set-aside color legend, bottom-left of the map.
  + '.setlegend{position:absolute;left:12px;bottom:12px;z-index:500;background:rgba(255,255,255,.95);'
  + 'border:1px solid var(--line);border-radius:10px;padding:8px 11px;box-shadow:0 2px 12px rgba(0,0,0,.09);'
  + 'display:flex;flex-wrap:wrap;gap:4px 12px;max-width:280px;font:500 11px Inter,system-ui,sans-serif}'
  + '.setlegend .sl-t{width:100%;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.05em;font-size:9.5px;margin-bottom:1px}'
  + '.setlegend span{display:inline-flex;align-items:center;gap:4px;color:var(--ink)}'
  + '.setlegend i{width:9px;height:9px;border-radius:50%;display:inline-block}'
  + '</style>';

// Loaded right after leaflet.js (before the template's map script): setColorFor(). It MUST be a
// hoisted global here because the template's render() (which we rewrite to call it) runs before
// the </body> viewport script; its body reads SETGROUPS/cv, which exist by call time. Pins now
// encode SET-ASIDE eligibility (the GovCon bid axis), not the old service-line category that
// never matched our NAICS-sector names (→ everything was gray).
const EARLY_INJECT = '<script>function setColorFor(o){if(o&&o.set===\'HUBZone\')return \'#f59e0b\';'
  + 'try{for(var i=0;i<SETGROUPS.length;i++){if(SETGROUPS[i].match(o.set))return cv(SETGROUPS[i].col);}}catch(e){}'
  + 'return (typeof cv===\'function\')?cv(\'--sec\'):\'#64748b\';}</script>';

// Set-aside color legend overlaid on the map (so color = eligibility is self-explanatory).
const LEGEND_HTML = '<div class="setlegend"><div class="sl-t">Set-aside eligibility</div>'
  + '<span><i style="background:#22a06b"></i>SDVOSB</span>'
  + '<span><i style="background:#3b82f6"></i>Small Biz</span>'
  + '<span><i style="background:#8b5cf6"></i>8(a)</span>'
  + '<span><i style="background:#ef4444"></i>WOSB</span>'
  + '<span><i style="background:#f59e0b"></i>HUBZone</span>'
  + '<span><i style="background:#64748b"></i>Open</span></div>';

// Viewport-driven data layer (Airbnb/Google): the template ships a static SSR pin set; this
// swaps it for a live bbox fetch on every pan/zoom against /api/app/opportunity-map. Reuses
// the template's own render()/markers/list-sync verbatim — only the DATA source changes.
// The header is promoted to a dynamic "N of TOTAL" hero (reacts to filters + viewport, the
// Zillow/Airbnb convention); SDVOSB/closing is demoted to a small secondary line. select() is
// wrapped so clicking a card whose pin is inside a cluster zooms to reveal it first.
const VIEWPORT_JS = `<script>
(function(){
  var SETMAP={SDVOSB:'SDVOSB',SB:'SB','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other',NONE:'None'};
  var HIDE_FSC=false, TOTAL=0, CAPPED=false, busy=false, t=null;
  function clean(d){ return (d||'').replace(/,?\\s*DEPARTMENT OF( THE)?/i,'').replace(/DEPARTMENT OF( THE)?\\s*/i,'').trim().replace(/\\b([A-Z])([A-Z0-9'&.\\/-]*)/g,function(_,a,b){return a+b.toLowerCase();})||d; }
  function toRow(p){ return {src:'SAM',naics:p.naics,cat:p.cat,title:p.title,agency:clean(p.agency),set:SETMAP[p.set]||'None',loc:p.loc,close:(p.close||'').slice(0,10),sol:p.sol||p.id,uiLink:p.uiLink,lat:p.lat,lng:p.lng}; }
  function bbox(){ var b=map.getBounds(); return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(n){return n.toFixed(4);}).join(','); }
  function updateHeader(){
    if(!TOTAL)return;
    var shown=(typeof rows!=='undefined'&&rows)?rows.length:OPPS.length;
    var sum=document.getElementById('sumline');
    if(sum)sum.innerHTML=shown.toLocaleString()+' <span style="color:var(--sub);font-weight:400">of '+TOTAL.toLocaleString()+' active opportunities'+(CAPPED?' (zoom in for more)':'')+'</span>';
    var sd=0,soon=0;
    for(var i=0;i<OPPS.length;i++){var o=OPPS[i];if(setKey(o.set)==='SDVOSB')sd++;var d=daysOut(o);if(d>=0&&d<=7)soon++;}
    var rc=document.getElementById('rescount');
    if(rc)rc.innerHTML='<span style="font-weight:400;color:var(--sub)">'+sd+' SDVOSB \\u00b7 '+soon+' closing this week</span>';
  }
  // Wrap render() so the header refreshes after every draw (pan AND client-side filter).
  var _render=render; render=function(){ _render(); updateHeader(); };
  function fetchView(){
    if(busy)return; busy=true;
    var url='/api/app/opportunity-map?bbox='+bbox()+'&status=active'+(HIDE_FSC?'&hideCommodity=1':'');
    fetch(url).then(function(r){return r.json();}).then(function(d){ busy=false;
      if(!d||!d.success)return;
      TOTAL=d.totalForFilters||0; CAPPED=!!d.capped;
      OPPS=(d.pins||[]).map(toRow);
      render();
    }).catch(function(){busy=false;});
  }
  map.on('moveend',function(){ clearTimeout(t); t=setTimeout(fetchView,450); });
  var tg=document.getElementById('fscToggle');
  if(tg)tg.onclick=function(){ HIDE_FSC=!HIDE_FSC; tg.classList.toggle('active',HIDE_FSC); tg.textContent=HIDE_FSC?'Commodity buys: hidden':'Commodity buys: shown'; fetchView(); };
  setTimeout(fetchView,300); // first live load replaces the SSR set with the true viewport + real total
})();
</script>`;

export async function GET(request: NextRequest) {
  const embed = new URL(request.url).searchParams.get('embed');
  let opps: unknown[] = [];
  try {
    const rows = await getMapOpportunities(600);
    opps = rows.map((o) => ({
      src: 'SAM',
      naics: o.naics,
      cat: o.cat,
      title: o.title,
      agency: cleanAgency(o.agency),
      set: SET_TO_EVC[o.set] ?? 'None',
      loc: o.loc,
      close: (o.close || '').slice(0, 10),
      sol: o.sol,
      uiLink: o.uiLink,
      lat: o.lat,
      lng: o.lng,
    }));
  } catch {
    opps = [];
  }
  // Make OPPS reassignable so the viewport layer can swap it (embed stays static SSR).
  let html = OPPORTUNITY_MAP_TEMPLATE.replace('const OPPS = __OPPS_JSON__', 'let OPPS = __OPPS_JSON__');
  html = html.replace('__OPPS_JSON__', JSON.stringify(opps));
  if (embed) {
    html = html.replace('</head>', EMBED_CSS + '</head>').replace('</body>', EMBED_JS + '</body>');
  } else {
    // Full page: add a way back to the app (the standalone template has none).
    html = html.replace('<div class="phead">',
      '<div class="phead"><a href="/home-v5" style="display:inline-flex;align-items:center;gap:5px;font:600 12.5px Inter,system-ui,sans-serif;color:#6b7787;text-decoration:none;margin-bottom:9px">← Back to Mindy</a>');
    html = html.replace('</head>', PAGE_CSS + '</head>');
    // Load setColorFor right after leaflet.js (before the template's map script).
    html = html.replace('<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + EARLY_INJECT);
    // Color pins by SET-ASIDE eligibility (fixes the all-gray category mismatch).
    html = html.split('catColor(o.cat)').join('setColorFor(o)');
    // Set-aside color legend on the map.
    html = html.replace('<div id="map"></div>', '<div id="map"></div>' + LEGEND_HTML);
    // Commodity-buys toggle in the filter bar.
    html = html.replace('<button class="clr" id="clrAll">Clear all</button>',
      FSC_TOGGLE + '<button class="clr" id="clrAll">Clear all</button>');
    // Viewport-driven data + dynamic header (must be last, after template globals exist).
    html = html.replace('</body>', VIEWPORT_JS + '</body>');
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
