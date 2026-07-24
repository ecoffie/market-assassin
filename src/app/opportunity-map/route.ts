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

// Filter-sheet readability: grid items default to min-width:auto, so the nowrap labels
// ("Professional & Technical", "Public Administration") overflow their 2-col cell and get
// clipped at the panel edge. Let them WRAP so every service line is fully readable, and cap
// the sheet height with scroll so long lists (19 service lines) stay contained.
const SHEET_FIX_CSS = '<style>'
  + '.opt{min-width:0;align-items:flex-start}'
  + '.opt .cbx,.opt .swatch{margin-top:2px}'
  + '.opt .lbl{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.25;word-break:break-word}'
  + '.sheet{max-height:48vh;overflow-y:auto}'
  + '</style>';

// Viewport-driven data layer (Airbnb/Google): the template ships a static SSR pin set; this
// swaps it for a live bbox fetch on every pan/zoom against /api/app/opportunity-map. Reuses
// the template's own render()/markers/list-sync verbatim — only the DATA source changes.
// OPPS is made `let` so this can replace it; render() is wrapped so the count updates on every
// draw (pan AND client-side filter). Nothing here re-implements the map.
const VIEWPORT_JS = `<script>
(function(){
  var SETMAP={SDVOSB:'SDVOSB',SB:'SB','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other',NONE:'None'};
  var HIDE_FSC=false, TOTAL=0, CAPPED=false, busy=false, t=null;
  function clean(d){ return (d||'').replace(/,?\\s*DEPARTMENT OF( THE)?/i,'').replace(/DEPARTMENT OF( THE)?\\s*/i,'').trim().replace(/\\b([A-Z])([A-Z0-9'&.\\/-]*)/g,function(_,a,b){return a+b.toLowerCase();})||d; }
  function toRow(p){ return {src:'SAM',naics:p.naics,cat:p.cat,title:p.title,agency:clean(p.agency),set:SETMAP[p.set]||'None',loc:p.loc,close:(p.close||'').slice(0,10),sol:p.sol||p.id,uiLink:p.uiLink,lat:p.lat,lng:p.lng}; }
  function bbox(){ var b=map.getBounds(); return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(n){return n.toFixed(4);}).join(','); }
  function setCount(){ if(!TOTAL)return; var el=document.getElementById('rescount'); if(!el)return;
    var shown=(typeof rows!=='undefined'&&rows)?rows.length:OPPS.length;
    el.innerHTML=shown.toLocaleString()+' <span>in view'+(CAPPED?'+':'')+' \\u00b7 '+TOTAL.toLocaleString()+' active nationwide</span>'; }
  // Wrap the template's render() so the headline count refreshes after every draw.
  var _render=render; render=function(){ _render(); setCount(); };
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
    // Viewport-driven live data + the commodity-buys toggle + sheet-readability fix (full page).
    html = html.replace('</head>', SHEET_FIX_CSS + '</head>');
    html = html.replace('<button class="clr" id="clrAll">Clear all</button>',
      FSC_TOGGLE + '<button class="clr" id="clrAll">Clear all</button>');
    html = html.replace('</body>', VIEWPORT_JS + '</body>');
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
