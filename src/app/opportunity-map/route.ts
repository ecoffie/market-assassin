/**
 * GET /opportunity-map — serves Eric's evc-opportunity-map prototype VERBATIM (its exact
 * HTML/CSS/JS from template.html), with the static OPPS array swapped for LIVE opportunities.
 * We only adapt our data into the shape the prototype's JS expects; nothing about the design
 * is rebuilt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMapOpportunities, SET_GROUPS } from '@/lib/opportunities/map-data';
import { STATE_CENTROIDS } from '@/lib/geo/state-centroids';
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

// "More filters" dropdown (Zillow's Filters catch-all) — the long-tail filters live here, off
// the top row. Starts with the Commodity-buys toggle (no self-filtering: default SHOWS all).
// Multi-select set-aside checkboxes (by GROUP) for the deep panel.
const SETASIDE_CHECKS = SET_GROUPS
  .filter((g) => g.key !== 'NONE')
  .map((g) => `<label class="mf-chk"><input type="checkbox" class="mf-set" value="${g.key}"><i style="background:${g.color}"></i>${g.label}</label>`)
  .join('');
const NOTICE_CHECKS = [
  ['Solicitation', 'Solicitation'], ['Combined Synopsis/Solicitation', 'Combined Synopsis'],
  ['Presolicitation', 'Presolicitation'], ['Sources Sought', 'Sources Sought'], ['Special Notice', 'Special Notice'],
].map(([v, l]) => `<label class="mf-chk"><input type="checkbox" class="mf-notice" value="${v}">${l}</label>`).join('');

// Deep "More filters" panel — Zillow's advanced filter drawer. The quick pills stay on the
// top bar; the long-tail + multi-select filters live here. NAICS/PSC = the "what kind"
// (property-type) axis; set-aside & notice-type are multi-select. Value-range is mode-aware
// (real data on Recompetes; hidden on Open until the doc-scan backfills estimated value).
const MORE_FILTERS = '<div class="mfwrap">'
  + '<button class="fsel fsel-btn" id="moreBtn"><svg viewBox="0 0 24 24" class="fico"><path d="M3 5h18M7 12h10M11 19h2"/></svg>Filters</button>'
  + '<div class="mfpanel mfpanel-deep" id="morePanel">'
  + '<div class="mf-sec">Show</div>'
  + '<div class="mf-grid2">'
  +   '<label class="mf-field"><span>Which opportunities</span><select class="mf-in" id="mfScope"><option value="all">All opportunities</option><option value="profile">Matched to my profile</option></select></label>'
  + '</div>'
  + '<div class="mf-sec">Codes</div>'
  + '<div class="mf-grid2">'
  +   '<label class="mf-field"><span>NAICS</span><input class="mf-in" id="mfNaics" placeholder="e.g. 236220" autocomplete="off"></label>'
  +   '<label class="mf-field"><span>PSC</span><input class="mf-in" id="mfPsc" placeholder="e.g. R408 or R" autocomplete="off"></label>'
  + '</div>'
  + '<div class="mf-sec">Buyer</div>'
  + '<div class="mf-grid2">'
  +   '<label class="mf-field"><span>Agency</span><input class="mf-in" id="mfAgency" placeholder="e.g. Navy" autocomplete="off"></label>'
  +   '<label class="mf-field"><span>Sub-agency</span><input class="mf-in" id="mfSubAgency" placeholder="e.g. Army" autocomplete="off"></label>'
  + '</div>'
  + '<div class="mf-sec">Location</div>'
  + '<div class="mf-grid2">'
  +   '<label class="mf-field"><span>State</span><input class="mf-in mf-st" id="mfState" placeholder="e.g. FL" maxlength="2" autocomplete="off"></label>'
  +   '<label class="mf-field"><span>Country</span><select class="mf-in" id="mfCountry"><option value="">Anywhere</option><option value="us">United States</option><option value="oconus">Overseas (OCONUS)</option></select></label>'
  + '</div>'
  + '<div class="mf-sec">Only show</div>'
  + '<div class="mf-checks">'
  +   '<label class="mf-chk"><input type="checkbox" id="mfHasDocs">With documents</label>'
  +   '<label class="mf-chk"><input type="checkbox" id="mfHasContact">With a contact</label>'
  + '</div>'
  + '<div class="mf-sec">Set-aside <em>(any selected)</em></div>'
  + '<div class="mf-checks">' + SETASIDE_CHECKS + '</div>'
  + '<div class="mf-sec">Notice type <em>(any selected)</em></div>'
  + '<div class="mf-checks">' + NOTICE_CHECKS + '</div>'
  + '<div class="mf-sec">Posted</div>'
  + '<select class="mf-in" id="mfPosted"><option value="">Any time</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select>'
  // Value range — real on Recompetes (USASpending ceilings); hidden on Open until scan backfills.
  + '<div class="mf-sec mf-value" id="mfValueSec" style="display:none">Contract value</div>'
  + '<select class="mf-in mf-value" id="mfValue" style="display:none">'
  +   '<option value="">Any value</option><option value="0-1000000">Under $1M</option>'
  +   '<option value="1000000-5000000">$1M–$5M</option><option value="5000000-10000000">$5M–$10M</option>'
  +   '<option value="10000000-25000000">$10M–$25M</option><option value="25000000-100000000">$25M–$100M</option>'
  +   '<option value="100000000-">$100M+</option>'
  + '</select>'
  + '<div class="mf-sec">Refine</div>'
  + '<div class="mf-row"><span>Commodity buys<br><em>parts &amp; supply micro-buys</em></span>'
  + '<button class="mf-toggle" id="fscToggle">Shown</button></div>'
  + '<div class="mf-foot"><button class="mf-clear" id="mfClear">Clear advanced</button><button class="mf-apply" id="mfApply">Apply</button></div>'
  + '</div></div>';

// Save-search anchor button (Zillow's blue CTA) — turns the current filters + viewport into
// a saved search / alert. Sits at the right end of the filter bar.
const SAVE_SEARCH_BTN = '<button class="savesearch" id="saveSearchBtn" title="Save this search & get alerts">'
  + '<svg viewBox="0 0 24 24"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>Save search</button>';

// Server-wired filter controls (the reorg). These replace the old client-side pills
// (Source / Service line / Set-aside / SDVOSB / Closing≤7d) that filtered the
// already-fetched pins in the browser and reset on every pan. Each control below sets
// a param on the viewport fetch, so filters survive panning (Zillow-style). Set-aside
// filters by GROUP (the API widens to the group's code list). Profile⇄All SAM and the
// closing-window ("urgency") are here too. Wiring lives in VIEWPORT_JS (window.__mapFilters).
const SET_GROUP_OPTS = SET_GROUPS
  .filter((g) => g.key !== 'NONE')
  .map((g) => `<option value="${g.key}">${g.label}</option>`)
  .join('');
const SERVER_FILTERS =
    // Zillow's bold "For sale ▾" pill = the DATASET toggle, mirroring Buy / Rent / Sell:
    //  Open Opportunities (SAM active → map) · Past Opportunities (USASpending awards → map) ·
    //  Bid (→ the /bid landing page, NOT a map — like Zillow's Sell page). onDatasetChange
    //  routes 'bid' to /bid and everything else to setMapMode. Contacts lives in the top nav.
    '<select class="fsel fsel-mode" id="fltDataset" title="What to explore" onchange="onDatasetChange(this.value)">'
  +   '<option value="open">Open Opportunities</option>'
  +   '<option value="recompete">Past Opportunities</option>'
  +   '<option value="bid">Bid</option>'
  + '</select>'
  + '<select class="fsel" id="fltNotice" title="Notice type">'
  +   '<option value="">Notice type</option>'
  +   '<option value="Solicitation">Solicitation</option>'
  +   '<option value="Combined Synopsis/Solicitation">Combined Synopsis</option>'
  +   '<option value="Presolicitation">Presolicitation</option>'
  +   '<option value="Sources Sought">Sources Sought</option>'
  +   '<option value="Special Notice">Special Notice</option>'
  + '</select>'
  + '<select class="fsel" id="fltSetAside" title="Set-aside">'
  +   '<option value="">Set-aside</option>' + SET_GROUP_OPTS
  + '</select>'
  + '<select class="fsel" id="fltUrgency" title="Closing window">'
  +   '<option value="">Any deadline</option>'
  +   '<option value="7">Closing ≤7 days</option>'
  +   '<option value="14">Closing ≤14 days</option>'
  +   '<option value="30">Closing ≤30 days</option>'
  + '</select>';
// Agency + State moved OFF the top row into the deep panel (Zillow keeps the bar to a
// few uniform dropdown pills; long-tail text filters live inside "Filters").

// Full-page CSS overrides (kept out of the verbatim template): (1) sheet-label readability
// — grid items default to min-width:auto so nowrap labels overflow their cell; let them wrap.
// (2) filter bar WRAPS to a 2nd row instead of hiding filters off-screen behind a scroll.
// (3) a set-aside color legend on the map.
const PAGE_CSS = '<style>'
  + '.opt{min-width:0;align-items:flex-start}'
  + '.opt .cbx,.opt .swatch{margin-top:2px}'
  + '.opt .lbl{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.25;word-break:break-word}'
  + '.sheet{max-height:48vh;overflow-y:auto}'
  // Filter pills — Zillow-exact: white, hairline border, BOLD near-black label, uniform 40px.
  + '.fsel{font-family:Inter,system-ui,sans-serif;font-size:14.5px;font-weight:700;color:#2a2a33;background:#fff;'
  + 'border:1px solid #d1d5db;border-radius:8px;padding:0 34px 0 15px;height:40px;line-height:38px;cursor:pointer;'
  + 'appearance:none;-webkit-appearance:none;transition:border-color .15s,box-shadow .15s;outline:none;'
  + 'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'11\' height=\'7\' viewBox=\'0 0 11 7\'><path d=\'M1 1l4.5 4.5L10 1\' stroke=\'%232a2a33\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/></svg>");'
  + 'background-repeat:no-repeat;background-position:right 12px center}'
  + '.fsel:hover{border-color:#9aa5b3}'
  + '.fsel:focus{border-color:#006aff;box-shadow:0 0 0 3px rgba(0,106,255,.14)}'
  + '.fsel.on{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  // "Filters" is a BUTTON not a select — same pill look, no chevron bg, with a slider icon.
  + '.fsel-btn{background-image:none;padding:0 15px;display:inline-flex;align-items:center;gap:7px}'
  + '.fsel-btn .fico{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}'
  + '.fsel-btn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  // Dataset pill = Zillow\'s bold blue "For sale ▾". Always emphasized (it\'s the primary toggle).
  + '.fsel-mode{border-color:#006aff;color:#006aff;background-color:#f0f6ff;font-weight:700;'
  + 'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'11\' height=\'7\' viewBox=\'0 0 11 7\'><path d=\'M1 1l4.5 4.5L10 1\' stroke=\'%23006aff\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/></svg>")}'
  + '.fsel-mode:hover{border-color:#006aff;background-color:#e6f0ff}'
  // Save search — Zillow's solid-blue anchor button on the bar.
  + '.savesearch{font-family:Inter,system-ui,sans-serif;font-size:14.5px;font-weight:700;color:#fff;background:#006aff;'
  + 'border:0;border-radius:8px;height:40px;padding:0 18px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:filter .15s}'
  + '.savesearch:hover{filter:brightness(.94)}.savesearch svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2}'
  // Deep "More filters" panel.
  + '.mfpanel-deep{width:320px;max-height:70vh;overflow-y:auto;padding:14px 16px}'
  + '.mfpanel-deep .mf-sec{font:700 10.5px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--sub);margin:12px 0 6px}'
  + '.mfpanel-deep .mf-sec:first-child{margin-top:0}.mfpanel-deep .mf-sec em{font-weight:500;text-transform:none;letter-spacing:0;color:var(--faint)}'
  + '.mf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
  + '.mf-field{display:flex;flex-direction:column;gap:3px}.mf-field span{font:600 11px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.mf-in{font:500 13px Inter,system-ui,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%;outline:none}'
  + '.mf-in:focus{border-color:var(--jan);box-shadow:0 0 0 3px rgba(59,130,246,.12)}'
  + '.mf-in.mf-st{text-transform:uppercase}'
  + '.mf-checks{display:flex;flex-wrap:wrap;gap:6px}'
  + '.mf-chk{display:inline-flex;align-items:center;gap:5px;font:500 12px Inter,system-ui,sans-serif;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 9px;cursor:pointer;user-select:none}'
  + '.mf-chk:hover{background:var(--wash)}.mf-chk input{margin:0;cursor:pointer}'
  + '.mf-chk i{width:8px;height:8px;border-radius:50%;display:inline-block}'
  + '.mf-chk:has(input:checked){border-color:var(--jan);background:#eff5ff;color:var(--jan)}'
  + '.mf-foot{display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--hair)}'
  + '.mf-clear{flex:1;font:600 12.5px Inter,system-ui,sans-serif;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;cursor:pointer}'
  + '.mf-apply{flex:1;font:600 12.5px Inter,system-ui,sans-serif;color:#fff;background:var(--jan);border:0;border-radius:8px;padding:8px;cursor:pointer}'
  + '.mf-clear:hover{background:var(--wash)}.mf-apply:hover{filter:brightness(.95)}'
  // Filters wrap (no more horizontal-scroll hiding Set-aside & beyond).
  + '.fscroll{flex-wrap:wrap!important;overflow-x:visible!important;row-gap:7px}'
  // Set-aside color legend, bottom-left of the map.
  + '.setlegend{position:absolute;left:12px;bottom:12px;z-index:500;background:rgba(255,255,255,.95);'
  + 'border:1px solid var(--line);border-radius:10px;padding:8px 11px;box-shadow:0 2px 12px rgba(0,0,0,.09);'
  + 'display:flex;flex-wrap:wrap;gap:4px 12px;max-width:280px;font:500 11px Inter,system-ui,sans-serif}'
  + '.setlegend .sl-t{width:100%;font-weight:700;color:var(--sub);text-transform:uppercase;letter-spacing:.05em;font-size:9.5px;margin-bottom:1px}'
  + '.setlegend span{display:inline-flex;align-items:center;gap:4px;color:var(--ink)}'
  + '.setlegend i{width:9px;height:9px;border-radius:50%;display:inline-block}'
  // "Save to pursuits" button (styled like the template's .act/.pva anchors) + demoted SAM link.
  + '.act.savep,.pva.savep{cursor:pointer;font:inherit;font-weight:600}'
  + '.savep.saved{color:#22a06b!important;border-color:#22a06b!important;background:#f0fdf7!important}'
  + '.act.samlink,.pva.samlink{color:var(--sub);font-size:11px;font-weight:500}'
  // Progress/gamification widget removed for now (Eric, 2026-07-25).
  + '.sbtoggle,.sb{display:none!important}'
  // Old list-collapse toggle (.railbtn) was pinned to the old left-panel edge (left:392px) and
  // floated in the middle of the map in the new layout — remove it (cards stay always-visible).
  + '.railbtn{display:none!important}'
  // "More filters" dropdown panel (Zillow's Filters catch-all).
  + '.mfwrap{position:relative}'
  // position:FIXED (not absolute) so the panel ESCAPES the .fscroll overflow-x:auto
  // ancestor that was CLIPPING it — the panel opened (display:block) but was hidden by
  // the scroll container. Anchored under the bar (~62px) toward the right; JS aligns it
  // to the Filters button on open. High z-index beats the map.
  + '.mfpanel{display:none;position:fixed;top:62px;right:28px;z-index:3000;background:#fff;'
  + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.18);padding:13px 15px;min-width:300px}'
  + '.mfpanel.show{display:block}'
  + '.mf-sec{font:700 10px "Inter",system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);margin-bottom:11px}'
  + '.mf-row{display:flex;align-items:center;justify-content:space-between;gap:16px;font:600 13px "Inter",system-ui,sans-serif;color:var(--ink)}'
  + '.mf-row em{font-style:normal;font-weight:400;font-size:11.5px;color:var(--sub)}'
  + '.mf-toggle{flex:none;font:600 12px "Inter",system-ui,sans-serif;padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;color:var(--ink)}'
  + '.mf-toggle.off{color:var(--sub);background:var(--wash)}'
  + '</style>';

// Loaded right after leaflet.js (before the template's map script): setColorFor(). It MUST be a
// hoisted global here because the template's render() (which we rewrite to call it) runs before
// the </body> viewport script; its body reads SETGROUPS/cv, which exist by call time. Pins now
// encode SET-ASIDE eligibility (the GovCon bid axis), not the old service-line category that
// never matched our NAICS-sector names (→ everything was gray).
const EARLY_INJECT = '<script>function setColorFor(o){if(o&&o.set===\'HUBZone\')return \'#f59e0b\';'
  + 'try{for(var i=0;i<SETGROUPS.length;i++){if(SETGROUPS[i].match(o.set))return cv(SETGROUPS[i].col);}}catch(e){}'
  + 'return (typeof cv===\'function\')?cv(\'--sec\'):\'#64748b\';}</script>';

// Zillow-style layout: top search+filters bar, thin far-left icon rail, center map, right cards.
// Achieved by re-gridding .app into areas and moving the filter bar into the top bar (JS). All
// of the template's render()/markers/filters/cards logic is untouched — only containers move.
const ZLAYOUT_CSS = '<style>'
  // Brand font: match the Mindy app (Inter) — drop the template's Space Grotesk display face.
  + ':root{--disp:"Inter",system-ui,-apple-system,sans-serif!important}'
  + '.snapt,.osec-h,.brand{font-family:"Inter",system-ui,-apple-system,sans-serif!important;letter-spacing:-.01em}'
  // Grid gains a full-width top HEADER row for the Mindy logo, above the search/filter row.
  + '.app{grid-template-columns:64px minmax(0,1fr) 460px!important;grid-template-rows:52px auto minmax(0,1fr)!important;'
  + 'grid-template-areas:"zhead zhead zhead" "zrail ztop ztop" "zrail zmap zcards"!important;transition:none!important}'
  + '.app.collapsed{grid-template-columns:64px minmax(0,1fr) 0px!important}'
  // Cards = a SINGLE wide column (real Zillow): one card per row, full-width, room to breathe.
  // flex:none on .card so flex layout can't shrink the (overflow:hidden) card to 0 height.
  + '.feed{display:flex!important;flex-direction:column!important;gap:12px!important;padding:14px 16px 28px!important}'
  + '.feed .card{flex:none!important;margin-bottom:0!important}'
  // Mindy header bar
  + '.zhead{grid-area:zhead;position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:20}'
  + '.zh-left,.zh-right{display:flex;align-items:center;gap:22px}'
  + '.zh-left a,.zh-right a{font:600 13.5px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap}'
  + '.zh-left a:hover,.zh-right a:hover{color:var(--jan)}.zh-left a.on{color:var(--jan)}'
  + '.zh-acct{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);color:var(--sub)}'
  + '.zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}'
  + '.zh-logo img{height:25px;width:auto;display:block}'
  + '.zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}'
  + '@media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-left a:nth-child(n+3),.zh-right a:first-child{display:none}}'
  // far-left icon rail — PINNED (position:fixed) so grid/overflow can never push it off-screen.
  // The 50px grid column stays as its reserved space (kept empty; the fixed rail sits over it).
  + '.zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);'
  + 'background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}'
  + '.zrail a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}'
  + '.zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}'
  + '.zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
  + '.zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}'
  // Red count badge (Zillow "Updates 56") — unseen new saved-search matches.
  + '.railbadge{position:absolute;top:3px;right:9px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;'
  + 'background:#d92d20;color:#fff;font:700 10px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;'
  + 'box-shadow:0 0 0 2px #fff;line-height:1}'
  // top bar (search + the moved filters)
  // Bar stays ONE row like Zillow — nowrap so items SHRINK instead of the search
  // wrapping onto its own line. overflow stays visible so the Filters dropdown escapes.
  // z-index MUST beat Leaflet's map panes (tile 200 … popup 700) or the Filters dropdown,
  // which is a child of this bar, renders BEHIND the map and "won't display" when clicked.
  + '.ztop{grid-area:ztop;position:relative;display:flex;flex-wrap:nowrap;align-items:center;gap:8px;padding:10px 18px;border-bottom:1px solid var(--line);background:#fff;z-index:1001;min-width:0}'
  // Pills don\'t shrink (keep their label); the search absorbs the squeeze first.
  + '.ztop .fbar,.fsel,.savesearch{flex:none}'
  + '.zsearch{flex:1 1 240px;min-width:150px;max-width:340px;display:flex;align-items:center;gap:8px;border:1px solid #d1d5db;border-radius:8px;padding:0 13px;height:40px;background:#fff}'
  + '.zsearch:focus-within{border-color:#006aff;box-shadow:0 0 0 3px rgba(0,106,255,.12)}'
  + '.zsearch svg{width:16px;height:16px;stroke:var(--sub);fill:none;stroke-width:2;flex:none}'
  + '.zsearch input{border:0;outline:0;flex:1;min-width:0;font:500 13.5px Inter,system-ui,sans-serif;background:transparent;color:var(--ink)}'
  + '.mapwrap{grid-area:zmap!important}'
  // Map controls (Fit to results / Terrain) → floated INSIDE the map top-right, like Zillow\'s
  // Schools/Draw. Was pinned top-CENTER in the dead strip between the bar and the map.
  + '.maptop{left:auto!important;right:14px!important;top:14px!important;transform:none!important}'
  // Draw button active state (drawing / area set).
  + '.mpill.on{background:#006aff!important;color:#fff!important;border-color:#006aff!important}'
  + '#drawClear{color:#006aff;border-color:#9cc4ff}'
  + '.panel{grid-area:zcards!important;border-right:0!important;border-left:1px solid var(--line)!important}'
  // the filter bar, once moved into the top bar: strip its panel chrome, keep on one row
  + '.ztop .fbar{border:0!important;padding:0!important;margin:0!important;background:transparent!important;flex:0 1 auto;min-width:0}'
  + '.ztop .fbar .fscroll{flex-wrap:nowrap!important;overflow-x:auto!important;row-gap:0;min-width:0}'
  // Hard overflow guard: the filter bar must scroll inside its area, never widen the page and
  // push the left rail off-screen. Reduced rail (Eric).
  + 'html,body{overflow-x:hidden!important}'
  + '.app{max-width:100vw!important;overflow:hidden!important}'
  // filter sheets become dropdown overlays (a top bar can't push content down like the old panel)
  + '.ztop .fbar .sheet{position:absolute!important;top:calc(100% + 6px);left:18px;z-index:900;background:#fff;'
  + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:14px 16px;'
  + 'min-width:300px;max-width:540px;margin-top:0!important;max-height:62vh;overflow-y:auto}'
  + '</style>';

// Icon rail + top search bar. The template's .fbar (filters) is appended into .ztop by JS.
// Icon-only rail (reduced — no text labels, which were wider than the rail and clipped).
// Names live in the title tooltip.
const ZRAIL_HTML = '<nav class="zrail">'
  + '<a href="/app" title="Back to Mindy"><svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg><span>Home</span></a>'
  + '<a class="on" title="Opportunity Map"><svg viewBox="0 0 24 24"><path d="M9 4L3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5 9 4z"/><path d="M9 4v14M15 6.5v14"/></svg><span>Map</span></a>'
  + '<a href="/opportunity-map/saved" title="Saved searches" style="position:relative"><svg viewBox="0 0 24 24"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>Saved</span><b class="railbadge" id="savedBadge" hidden></b></a>'
  + '<a href="/app?panel=pursuits" title="My Pursuits"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"/></svg><span>Pursuits</span></a>'
  + '<a href="/app?panel=alerts" title="Alerts"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Alerts</span></a>'
  + '</nav>';
const ZTOP_HTML = '<div class="ztop"><div class="zsearch">'
  + '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'
  + '<input id="zsearchInput" placeholder="Search opportunities, agencies, keywords…" autocomplete="off"></div></div>';
// Mindy brand header bar (top, full width) — the wordmark + product name, Zillow-style.
// Zillow-style top nav: left nav links · CENTER logo · right nav + account.
const ZHEAD_HTML = '<header class="zhead">'
  // Top nav mirrors Zillow's Buy / Rent / Sell (+ a util link), same words as the dataset pill.
  + '<nav class="zh-left">'
  + '<a class="zh-mode on" data-mode="open" onclick="setMapMode(\'open\')">Open Opportunities</a>'
  + '<a class="zh-mode" data-mode="recompete" onclick="setMapMode(\'recompete\')">Past Opportunities</a>'
  + '<a href="/bid">Bid</a>'
  + '<a class="zh-mode" data-mode="contractor" onclick="setMapMode(\'contractor\')">Contacts</a>'
  + '</nav>'
  + '<a href="/app" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>'
  + '<nav class="zh-right">'
  + '<a href="/pricing">Pricing</a>'
  + '<a href="/app?panel=pursuits">My Pursuits</a>'
  + '<a href="/app" title="Account" class="zh-acct">' + '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></a>'
  + '</nav></header>';

// Set-aside color legend overlaid on the map (so color = eligibility is self-explanatory).
const LEGEND_HTML = '<div class="setlegend"><div class="sl-t">Set-aside eligibility</div>'
  + '<span><i style="background:#22a06b"></i>SDVOSB</span>'
  + '<span><i style="background:#3b82f6"></i>Small Biz</span>'
  + '<span><i style="background:#8b5cf6"></i>8(a)</span>'
  + '<span><i style="background:#ef4444"></i>WOSB</span>'
  + '<span><i style="background:#f59e0b"></i>HUBZone</span>'
  + '<span><i style="background:#64748b"></i>Open</span>'
  + '<span style="width:100%;color:var(--sub);font-size:10px;gap:5px"><i style="background:#fff;border:1.5px solid #94a3b8"></i>hollow = buying office (place of performance not specified)</span></div>';

// Viewport-driven data layer (Airbnb/Google): the template ships a static SSR pin set; this
// swaps it for a live bbox fetch on every pan/zoom against /api/app/opportunity-map. Reuses
// the template's own render()/markers/list-sync verbatim — only the DATA source changes.
// The header is promoted to a dynamic "N of TOTAL" hero (reacts to filters + viewport, the
// Zillow/Airbnb convention); SDVOSB/closing is demoted to a small secondary line. select() is
// wrapped so clicking a card whose pin is inside a cluster zooms to reveal it first.
const VIEWPORT_JS = `<script>
(function(){
  var SETMAP={SDVOSB:'SDVOSB',SB:'SB','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other',NONE:'None'};
  // Zillow-style dataset modes (For Sale / Rent / Sold). Each = a distinct corpus + endpoint.
  var MODES={
    open:{ ep:'/api/app/opportunity-map', title:'Open Opportunities', unit:'active opportunities' },
    recompete:{ ep:'/api/app/recompete-map', title:'Recompetes', unit:'expiring contracts' },
    contractor:{ ep:'', title:'Contacts', unit:'contacts' }
  };
  var MODE='open'; window.__mapMode='open';
  var HIDE_FSC=false, TOTAL=0, CAPPED=false, busy=false, t=null, t2=null, Q='';
  // Server-wired filter state (the reorg). Every control writes here, then fetchView()
  // sends them as query params so the filter is applied by the DB for the current
  // viewport — and survives panning, instead of hiding already-fetched pins.
  var FILT={ scope:'all', noticeType:'', setAside:'', closingDays:'', agency:'', state:'',
    naics:'', psc:'', postedDays:'', setAsideMulti:'', noticeMulti:'', valueRange:'',
    subAgency:'', country:'', hasDocs:'', hasContact:'' };
  try{ var zt=document.querySelector('.ztop'), zf=document.querySelector('.fbar');
    if(zt&&zf){ zt.appendChild(zf); setTimeout(function(){try{map.invalidateSize();}catch(e){}},80); } }catch(e){}
  function clean(d){ return (d||'').replace(/,?\\s*DEPARTMENT OF( THE)?/i,'').replace(/DEPARTMENT OF( THE)?\\s*/i,'').trim().replace(/\\b([A-Z])([A-Z0-9'&.\\/-]*)/g,function(_,a,b){return a+b.toLowerCase();})||d; }
  function toRow(p){
    if(MODE==='recompete') return {src:'RECOMPETE',title:p.title,cat:p.cat,agency:clean(p.agency),naics:p.naics,set:SETMAP[p.set]||'None',value:p.value,exp:(p.exp||'').slice(0,10),loc:p.loc,sol:p.sol,nid:p.id,lat:p.lat,lng:p.lng};
    return {src:'SAM',naics:p.naics,cat:p.cat,title:p.title,agency:clean(p.agency),set:SETMAP[p.set]||'None',loc:p.loc,close:(p.close||'').slice(0,10),sol:p.sol||p.id,nid:p.id,uiLink:p.uiLink,lat:p.lat,lng:p.lng,locSrc:p.locSrc,subAgency:clean(p.subAgency||''),office:p.office||'',noticeType:p.noticeType||'',docs:!!p.docs,pocs:p.pocs||0,posted:(p.posted||'').slice(0,10)};
  }
  function bbox(){
    // When the user has drawn an area (Draw button), query THAT rectangle instead of the
    // full viewport — Zillow's draw-to-filter. window.__drawBounds is set by DRAW_JS.
    var b = (window.__drawBounds) ? window.__drawBounds : map.getBounds();
    return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(n){return n.toFixed(4);}).join(',');
  }
  window.__mapRefetch = fetchViewLater; function fetchViewLater(){ try{ fetchView(); }catch(e){} }
  function updateHeader(){
    var brand=document.querySelector('.brand'); if(brand)brand.textContent=MODES[MODE].title;
    if(!TOTAL)return;
    var shown=(typeof rows!=='undefined'&&rows)?rows.length:OPPS.length;
    var sum=document.getElementById('sumline');
    if(sum)sum.innerHTML=shown.toLocaleString()+' <span style="color:var(--sub);font-weight:400">of '+TOTAL.toLocaleString()+' '+MODES[MODE].unit+(CAPPED?' (zoom in for more)':'')+'</span>';
    var rc=document.getElementById('rescount'); if(!rc)return;
    if(MODE==='open'){ var sd=0,soon=0; for(var i=0;i<OPPS.length;i++){var o=OPPS[i];if(setKey(o.set)==='SDVOSB')sd++;var d=daysOut(o);if(d>=0&&d<=7)soon++;} rc.innerHTML='<span style="font-weight:400;color:var(--sub)">'+sd+' SDVOSB \\u00b7 '+soon+' closing this week</span>'; }
    else rc.innerHTML='';
  }
  var _render=render; render=function(){ _render(); updateHeader(); };
  function fetchView(){
    if(busy)return;
    if(MODE==='contractor'){ OPPS=[]; render(); var f=document.getElementById('feed'); if(f)f.innerHTML='<div class="empty"><h4>Contacts map — coming next</h4><p>Buyers (contracting officers &amp; POCs) and companies, mapped by location.</p></div>'; return; }
    busy=true;
    var url=MODES[MODE].ep+'?bbox='+bbox()+(MODE==='open'?('&status=active'+(HIDE_FSC?'&hideCommodity=1':'')):'')+(Q?'&q='+encodeURIComponent(Q):'');
    // Append active server filters. Top-bar single-selects and deep-panel multi-selects
    // feed the SAME comma-separated params (merged + deduped). Both endpoints accept
    // setAside/agency; the open endpoint also accepts noticeType/state/closingDays/scope/
    // naics/psc/postedDays.
    function _merge(a,b){ return [a,b].filter(Boolean).join(','); }
    var _sa=_merge(FILT.setAside, FILT.setAsideMulti);
    if(_sa)url+='&setAside='+encodeURIComponent(_sa);
    if(FILT.agency)url+='&agency='+encodeURIComponent(FILT.agency);
    if(MODE==='open'){
      if(FILT.scope==='profile'){ var _pe=_uemail(); if(_pe)url+='&scope=profile&email='+encodeURIComponent(_pe); }
      var _nt=_merge(FILT.noticeType, FILT.noticeMulti);
      if(_nt)url+='&noticeType='+encodeURIComponent(_nt);
      if(FILT.state)url+='&state='+encodeURIComponent(FILT.state);
      if(FILT.closingDays)url+='&closingDays='+encodeURIComponent(FILT.closingDays);
      if(FILT.naics)url+='&naics='+encodeURIComponent(FILT.naics);
      if(FILT.psc)url+='&psc='+encodeURIComponent(FILT.psc);
      if(FILT.postedDays)url+='&postedDays='+encodeURIComponent(FILT.postedDays);
      if(FILT.subAgency)url+='&subAgency='+encodeURIComponent(FILT.subAgency);
      if(FILT.country)url+='&country='+encodeURIComponent(FILT.country);
      if(FILT.hasDocs)url+='&hasDocs=1';
      if(FILT.hasContact)url+='&hasContact=1';
    }
    // Value range — Recompetes only for now (real USASpending ceilings). The recompete-map
    // endpoint accepts min/max; hidden on Open until the doc-scan backfills estimated value.
    if(MODE==='recompete' && FILT.valueRange){
      var _vr=FILT.valueRange.split('-'); if(_vr[0])url+='&minValue='+_vr[0]; if(_vr[1])url+='&maxValue='+_vr[1];
    }
    fetch(url).then(function(r){return r.json();}).then(function(d){ busy=false;
      if(!d||!d.success)return;
      TOTAL=d.totalForFilters||0; CAPPED=!!d.capped;
      OPPS=(d.pins||[]).map(toRow);
      render();
    }).catch(function(){busy=false;});
  }
  // Dataset pill router — like Zillow's Buy/Rent/Sell: 'bid' is NOT a map, it navigates to the
  // /bid landing page ("Bid with confidence"); everything else switches the map corpus.
  window.onDatasetChange=function(v){
    if(v==='bid'){ var ds=document.getElementById('fltDataset'); if(ds)ds.value=window.__mapMode||'open'; location.href='/bid'; return; }
    setMapMode(v);
  };
  window.setMapMode=function(mode){ if(!MODES[mode]||mode===MODE)return; MODE=mode; window.__mapMode=mode;
    var tabs=document.querySelectorAll('.zh-mode'); for(var i=0;i<tabs.length;i++)tabs[i].classList.toggle('on',tabs[i].getAttribute('data-mode')===mode);
    // Keep the Zillow-style dataset pill in sync (nav tab ↔ pill both drive setMapMode).
    var dsel=document.getElementById('fltDataset'); if(dsel&&dsel.value!==mode)dsel.value=mode;
    // More-filters panel shows on open + recompete (recompete gets value-range); hide on contractor.
    var mw=document.querySelector('.mfwrap'); if(mw)mw.style.display=(mode==='contractor')?'none':'';
    syncValueVis();
    Q=''; var zsi=document.getElementById('zsearchInput'); if(zsi)zsi.value='';
    fetchView();
  };
  map.on('moveend',function(){ clearTimeout(t); t=setTimeout(fetchView,450); });
  var zsi=document.getElementById('zsearchInput');
  if(zsi)zsi.addEventListener('input',function(){ clearTimeout(t2); t2=setTimeout(function(){ Q=zsi.value.trim(); fetchView(); },400); });
  var tg=document.getElementById('fscToggle');
  if(tg)tg.onclick=function(){ HIDE_FSC=!HIDE_FSC; tg.classList.toggle('off',HIDE_FSC); tg.textContent=HIDE_FSC?'Hidden':'Shown'; fetchView(); };
  // Server-wired filter controls → write FILT + refetch (no client-side hide). scope=profile
  // needs the signed-in email (same localStorage token the save/drawer flows read).
  function _uemail(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function bindSel(id,key){ var el=document.getElementById(id); if(!el)return; el.onchange=function(){ FILT[key]=el.value; markActive(el,el.value); fetchView(); }; }
  function bindInp(id,key,norm){ var el=document.getElementById(id); if(!el)return; el.oninput=function(){ clearTimeout(el._t); el._t=setTimeout(function(){ var v=el.value.trim(); if(norm)v=norm(v); FILT[key]=v; markActive(el,v); fetchView(); },400); }; }
  function markActive(el,v){ el.classList.toggle('on',!!v && v!=='all'); }
  bindSel('fltNotice','noticeType'); bindSel('fltSetAside','setAside'); bindSel('fltUrgency','closingDays');
  // Scope (all vs matched-to-me) moved into the More-filters panel.
  var mfScopeEl=document.getElementById('mfScope'); if(mfScopeEl)mfScopeEl.onchange=function(){ FILT.scope=mfScopeEl.value; fetchView(); };

  // ── Deep "More filters" panel ──────────────────────────────────────────
  function _checked(cls){ return Array.prototype.slice.call(document.querySelectorAll(cls)).filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','); }
  function readDeep(){
    FILT.scope=(document.getElementById('mfScope')||{}).value||'all';
    FILT.naics=(document.getElementById('mfNaics')||{}).value||'';
    FILT.psc=(document.getElementById('mfPsc')||{}).value||'';
    FILT.agency=(document.getElementById('mfAgency')||{}).value||'';
    FILT.state=((document.getElementById('mfState')||{}).value||'').toUpperCase().slice(0,2);
    FILT.postedDays=(document.getElementById('mfPosted')||{}).value||'';
    FILT.setAsideMulti=_checked('.mf-set');
    FILT.noticeMulti=_checked('.mf-notice');
    FILT.valueRange=(document.getElementById('mfValue')||{}).value||'';
    FILT.subAgency=(document.getElementById('mfSubAgency')||{}).value||'';
    FILT.country=(document.getElementById('mfCountry')||{}).value||'';
    FILT.hasDocs=(document.getElementById('mfHasDocs')||{}).checked?'1':'';
    FILT.hasContact=(document.getElementById('mfHasContact')||{}).checked?'1':'';
    var active=!!((FILT.scope&&FILT.scope!=='all')||FILT.naics||FILT.psc||FILT.agency||FILT.state||FILT.postedDays||FILT.setAsideMulti||FILT.noticeMulti||FILT.valueRange||FILT.subAgency||FILT.country||FILT.hasDocs||FILT.hasContact);
    var mbEl=document.getElementById('moreBtn'); if(mbEl)mbEl.classList.toggle('hasfilt',active);
  }
  var _apply=document.getElementById('mfApply');
  if(_apply)_apply.onclick=function(){ readDeep(); var mp2=document.getElementById('morePanel'); if(mp2)mp2.classList.remove('show'); fetchView(); };
  var _mfclr=document.getElementById('mfClear');
  if(_mfclr)_mfclr.onclick=function(){
    ['mfNaics','mfPsc','mfAgency','mfState','mfSubAgency'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
    ['mfPosted','mfValue','mfCountry'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
    ['mfHasDocs','mfHasContact'].forEach(function(id){var e=document.getElementById(id);if(e)e.checked=false;});
    var _msc=document.getElementById('mfScope'); if(_msc)_msc.value='all';
    document.querySelectorAll('.mf-set,.mf-notice').forEach(function(c){c.checked=false;});
    readDeep(); fetchView();
  };
  // Value range is meaningful only where we have real $ data → show on Recompetes, hide on Open.
  function syncValueVis(){ var show=(MODE==='recompete'); document.querySelectorAll('.mf-value').forEach(function(e){e.style.display=show?'':'none';}); }
  syncValueVis();

  // Save search — persist the FULL active filter set + viewport + mode as a named saved
  // search that alerts on new matches (Zillow's retention move). Needs a signed-in user
  // (same MI token the save-to-pursuits flow uses).
  var _ss=document.getElementById('saveSearchBtn');
  function _ssReset(){ if(_ss)_ss.innerHTML='<svg viewBox="0 0 24 24"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>Save search'; }
  function _ssMsg(t){ if(_ss)_ss.textContent=t; setTimeout(_ssReset,1900); }
  if(_ss)_ss.onclick=function(){
    var t=null; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){}
    var em=_uemail();
    if(!t||!em){ if(confirm('Sign in to save this search and get alerts?'))location.href='/app?next=%2Fopportunity-map'; return; }
    var name=window.prompt('Name this saved search (you\\'ll get alerts on new matches):',
      (FILT.setAside||FILT.naics||Q||'My opportunities')+' — '+(MODE==='recompete'?'Recompetes':'Open'));
    if(!name)return;
    // Snapshot the active filters (skip empties + scope=all) + the current viewport.
    var filters={}; for(var k in FILT){ if(FILT[k]&&FILT[k]!=='all')filters[k]=FILT[k]; }
    if(Q)filters.q=Q;
    var b=null; try{ var mb2=map.getBounds(); b={w:mb2.getWest(),s:mb2.getSouth(),e:mb2.getEast(),n:mb2.getNorth()}; }catch(e){}
    _ss.textContent='Saving…';
    fetch('/api/app/saved-searches',{method:'POST',
      headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({email:em,name:name.slice(0,80),mode:MODE,filters:filters,bbox:b})})
      .then(function(r){return r.json();}).then(function(d){
        if(d&&d.success){ _ss.textContent='✓ Saved — alerts on'; setTimeout(function(){ if(confirm('Saved! We\\'ll email you when new opportunities match. View your saved searches?'))location.href='/opportunity-map/saved'; else _ssReset(); },400); }
        else _ssMsg('Couldn\\'t save');
      }).catch(function(){ _ssMsg('Couldn\\'t save'); });
  };

  // Clear all: reset the server filters + their controls, then refetch. (Runs in
  // addition to the template's own clrAll handler, which now only clears dead client sets.)
  var _clr=document.getElementById('clrAll');
  if(_clr)_clr.addEventListener('click',function(){
    FILT={ scope:'all', noticeType:'', setAside:'', closingDays:'', agency:'', state:'',
      naics:'', psc:'', postedDays:'', setAsideMulti:'', noticeMulti:'', valueRange:'' };
    ['fltNotice','fltSetAside','fltUrgency'].forEach(function(id){
      var el=document.getElementById(id); if(!el)return; el.value=''; el.classList.remove('on');
    });
    var _ms=document.getElementById('mfScope'); if(_ms)_ms.value='all';
    if(_mfclr)_mfclr.onclick();
    fetchView();
  });
  // More-filters dropdown open/close.
  var mb=document.getElementById('moreBtn'), mp=document.getElementById('morePanel');
  if(mb&&mp){ mb.onclick=function(e){ e.stopPropagation();
      // Fixed panel → align it under the Filters button (right-edge aligned, on-screen).
      var r=mb.getBoundingClientRect(); mp.style.top=(r.bottom+8)+'px';
      var right=Math.max(12, window.innerWidth-r.right); mp.style.right=right+'px'; mp.style.left='auto';
      mp.classList.toggle('show'); };
    document.addEventListener('click',function(e){ if(mp.classList.contains('show')&&!e.target.closest('.mfwrap'))mp.classList.remove('show'); }); }
  setTimeout(fetchView,300);
})();
</script>`;

// Draw area (Zillow's "Draw") — drag a rectangle on the map to filter opportunities to
// inside it. Sets window.__drawBounds (read by bbox()) + calls window.__mapRefetch. While
// an area is active, map panning is disabled so the drawn box stays the query region.
const DRAW_JS = `<script>
(function(){
  var drawBtn=document.getElementById('drawBtn'), clearBtn=document.getElementById('drawClear');
  if(!drawBtn||typeof map==='undefined')return;
  var drawing=false, startLL=null, rect=null, active=false;
  function setPanning(on){ try{ if(on){map.dragging.enable();}else{map.dragging.disable();} }catch(e){} }
  function enterDraw(){ drawing=true; drawBtn.classList.add('on'); drawBtn.textContent='Draw a box on the map…';
    map.getContainer().style.cursor='crosshair'; setPanning(false); }
  function exitDrawMode(){ drawing=false; drawBtn.classList.remove('on');
    drawBtn.innerHTML='<svg width=\\"14\\" height=\\"14\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\" style=\\"vertical-align:-2px;margin-right:5px\\"><path d=\\"M12 19l7-7 3 3-7 7-3-3z\\"/><path d=\\"M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z\\"/><path d=\\"M2 2l7.586 7.586\\"/><circle cx=\\"11\\" cy=\\"11\\" r=\\"2\\"/></svg>Draw area';
    map.getContainer().style.cursor=''; }
  function clearArea(){
    if(rect){ try{map.removeLayer(rect);}catch(e){} rect=null; }
    window.__drawBounds=null; active=false; clearBtn.style.display='none';
    setPanning(true); exitDrawMode(); if(window.__mapRefetch)window.__mapRefetch();
  }
  drawBtn.onclick=function(){ if(active){ clearArea(); return; } if(drawing){ exitDrawMode(); setPanning(true); return; } enterDraw(); };
  clearBtn.onclick=clearArea;
  map.on('mousedown',function(e){ if(!drawing)return; startLL=e.latlng;
    if(rect){try{map.removeLayer(rect);}catch(x){}rect=null;}
    rect=L.rectangle([startLL,startLL],{color:'#006aff',weight:2,fillColor:'#006aff',fillOpacity:.08,interactive:false}).addTo(map);
  });
  map.on('mousemove',function(e){ if(!drawing||!startLL||!rect)return; rect.setBounds(L.latLngBounds(startLL,e.latlng)); });
  map.on('mouseup',function(e){ if(!drawing||!startLL)return;
    var b=L.latLngBounds(startLL,e.latlng); startLL=null;
    // Ignore tiny accidental clicks.
    if(b.getNorth()-b.getSouth()<0.02 && b.getEast()-b.getWest()<0.02){ clearArea(); return; }
    window.__drawBounds=b; active=true; exitDrawMode(); setPanning(true);
    clearBtn.style.display=''; if(window.__mapRefetch)window.__mapRefetch();
  });
})();
</script>`;

// "Save to pursuits" — capture an opp into the user's My Pursuits pipeline. The map page is
// same-origin as the app, so it reads the MI auth token from localStorage (x-mi-auth-token) and
// the token's own email (which /api/pipeline validates against) then POSTs /api/pipeline. Degrades
// to "Sign in to save" if there's no session. GOS thesis: capture the customer.
const SAVE_JS = `<script>
(function(){
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function decodeEmail(t){ try{ var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); return (j.email||'').toLowerCase().trim(); }catch(e){return '';} }
  function email(t){ var e=decodeEmail(t); if(e)return e; try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  window.savePursuit=function(btn){
    if(btn.dataset.saved==='1')return;
    var t=tok(); var em=t?email(t):'';
    if(!t||!em){ btn.textContent='Sign in to save'; return; }
    var sol=btn.dataset.sol, o=null;
    try{ o=(OPPS||[]).find(function(x){return x.sol===sol;}); }catch(e){}
    if(!o)return;
    btn.textContent='Saving\\u2026'; btn.disabled=true;
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:o.title,notice_id:o.sol,solicitation_number:o.sol,agency:o.agency,naics_code:o.naics,response_deadline:o.close,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In pursuits':'\\u2713 Saved'; btn.classList.add('saved'); btn.dataset.saved='1'; }
      else { btn.textContent='Try again'; btn.disabled=false; }
    }).catch(function(){ btn.textContent='Try again'; btn.disabled=false; });
  };
})();
</script>`;

// Opportunity detail DRAWER (Zillow card → detail page). Section #1 Snapshot for now; sections
// #2–14 (AI Pursuit Brief, Where, Contacts, Requirements, History, …) will render below it.
// Fetches /api/app/opportunity-detail?id=<notice_id>. Card click opens it (see the onclick swap).
const DRAWER_CSS = '<style>'
  + '.viewdet{color:var(--sub);font-weight:600;font-size:12px}'
  // Drawer fills the MAP area (between the 50px icon rail and the 404px cards column) and slides
  // in from the left — so the card list stays visible and clicking another card updates it.
  + '.oppbd{position:fixed;top:52px;left:64px;right:460px;bottom:0;background:rgba(17,28,38,.06);z-index:1400;opacity:0;pointer-events:none;transition:opacity .2s}'
  + '.oppbd.show{opacity:1}'
  + '.oppdrawer{position:fixed;top:52px;left:64px;right:460px;height:calc(100vh - 52px);height:calc(100dvh - 52px);background:#fff;z-index:1500;'
  + 'box-shadow:8px 0 40px rgba(0,0,0,.14);transform:translateX(-104%);transition:transform .28s cubic-bezier(.4,0,.2,1);'
  + 'overflow-y:auto;display:flex;flex-direction:column;'
  // Closed = fully hidden so nothing (esp. the sticky ✕ close button) bleeds over the
  // rail/map. visibility+pointer-events are cleared on .show.
  + 'visibility:hidden;pointer-events:none}'
  + '.oppdrawer.show{transform:none;visibility:visible;pointer-events:auto}'
  + '@media(max-width:1100px){.oppdrawer,.oppbd{left:0;right:0}}'
  + '.oppx{position:sticky;top:12px;align-self:flex-end;margin:12px 18px 0;width:34px;height:34px;border-radius:50%;'
  + 'border:1px solid var(--line);background:#fff;cursor:pointer;font-size:15px;z-index:2;display:grid;place-items:center;flex:none}'
  + '.oppbody{padding:2px 30px 44px;max-width:800px;width:100%}'
  + '.oppload{padding:70px 26px;text-align:center;color:var(--sub);font-size:14px}'
  + '.snaphero{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}'
  + '.badge-nt{display:inline-block;font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:6px;background:var(--wash);color:var(--sub)}'
  + '.badge-dl{display:inline-block;font:700 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:6px;background:#fef2f2;color:#d92d20}'
  + '.badge-dl.cool{background:#f0fdf7;color:#22a06b}'
  + '.snapt{font:700 22px/1.28 "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);margin:8px 0 5px}'
  + '.snapmeta{color:var(--sub);font-size:13.5px;margin-bottom:15px}.snapmeta b{color:var(--ink);font-weight:600}'
  + '.snapgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;border:1px solid var(--line);border-radius:12px;padding:15px 17px}'
  + '.snapgrid .k{font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}'
  + '.snapgrid .v{font-size:14px;font-weight:600;color:var(--ink);margin-top:2px}'
  + '.oppsoon{margin-top:26px;color:var(--faint);font-size:12px;border-top:1px dashed var(--line);padding-top:14px}'
  // Bid facts grid (Zillow "Facts & features").
  + '.bf-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}'
  + '.bf-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--hair)}'
  + '.bf-k{color:var(--sub);font-size:13px}.bf-v{color:var(--ink);font-size:13px;font-weight:600;text-align:right}'
  + '.bf-ul{margin:0 0 6px;padding-left:18px}.bf-ul li{font-size:13.5px;color:var(--ink);margin-bottom:4px;line-height:1.4}'
  + '.intel-load{color:var(--faint);font-size:12.5px;padding:6px 0}'
  // Similar opportunities (Zillow "Nearby homes" flywheel).
  + '.sim-list{display:flex;flex-direction:column;gap:10px}'
  + '.sim-card{display:block;width:100%;text-align:left;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;cursor:pointer;transition:box-shadow .15s,border-color .15s}'
  + '.sim-card:hover{box-shadow:0 2px 12px rgba(16,24,40,.08);border-color:#cfd6de}'
  + '.sim-t{font-weight:700;font-size:14.5px;color:var(--ink);margin-bottom:3px;line-height:1.3}'
  + '.sim-m{color:var(--sub);font-size:12.5px}'
  + '.sim-sa{display:inline-block;margin-top:8px;background:var(--hair);color:var(--sub);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600}'
  // AI Analysis (Go/No-Go).
  + '.ai-run{display:inline-flex;align-items:center;font:600 14px Inter,system-ui,sans-serif;color:#fff;background:#111c26;border:0;border-radius:9px;padding:11px 16px;cursor:pointer;transition:filter .15s}'
  + '.ai-run:hover{filter:brightness(1.15)}.ai-run.ai-loading{background:var(--wash);color:var(--sub);cursor:default}'
  + '.ai-note{color:var(--sub);font-size:12.5px;margin-top:9px}'
  + '.ai-verdict{display:flex;align-items:center;gap:12px;border:2px solid;border-radius:12px;padding:12px 16px;margin-bottom:12px}'
  + '.ai-badge{color:#fff;font-weight:800;font-size:13px;letter-spacing:.04em;padding:4px 12px;border-radius:20px}'
  + '.ai-score{color:var(--ink);font-weight:700;font-size:14px}'
  + '.ai-next{background:var(--wash);border-radius:9px;padding:11px 14px;font-size:13.5px;margin-bottom:12px}'
  + '.ai-lab{font:700 11px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--sub);margin:12px 0 5px}'
  + '.ai-ul{margin:0 0 4px;padding-left:18px}.ai-ul li{font-size:13.5px;margin-bottom:4px;line-height:1.4}'
  + '.ai-ul.pos li{color:#12805c}.ai-ul.neg li{color:#b54708}'
  + '.ai-upsell{background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;border-radius:12px;padding:18px 20px}'
  + '.ai-upsell-h{font-weight:700;font-size:15px;margin-bottom:6px}.ai-upsell p{font-size:13px;opacity:.92;margin-bottom:14px;line-height:1.45}'
  + '.ai-upgrade{display:inline-block;background:#fff;color:#1e3a8a;font-weight:700;font-size:13.5px;padding:9px 18px;border-radius:8px;text-decoration:none}'
  // detail sections
  + '.osec{margin-top:26px}'
  + '.osec-h{font:700 15px "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);margin-bottom:11px}'
  + '.osec-b{font-size:13.5px;line-height:1.6;color:#374151;white-space:pre-wrap;word-break:break-word}'
  + '.osec-empty{font-size:13px;color:var(--faint)}'
  + '.osec-sub{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--sub);margin-bottom:7px}'
  + '.osec-b.clamp{max-height:210px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 74%,transparent);mask-image:linear-gradient(#000 74%,transparent)}'
  + '.osec-more{margin-top:9px;font:600 12.5px Inter,system-ui,sans-serif;color:var(--jan);background:none;border:0;cursor:pointer;padding:0}'
  + '.ocontact{border:1px solid var(--line);border-radius:11px;padding:12px 14px;margin-top:9px}'
  + '.ocontact .nm{font-weight:700;color:var(--ink);font-size:13.5px}'
  + '.ocontact .ti{color:var(--sub);font-size:12px;margin-top:1px}'
  + '.ocontact .row{margin-top:7px;font-size:12.5px}.ocontact a{color:var(--jan);text-decoration:none}'
  + '.odoc{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:13px}'
  + '.odoc a{color:var(--jan);text-decoration:none;font-weight:600}'
  + '.oact{position:sticky;bottom:0;display:flex;gap:9px;flex-wrap:wrap;margin-top:26px;padding:14px 0 4px;background:linear-gradient(transparent,#fff 22%);border-top:1px solid var(--line)}'
  + '.oact .b{flex:1;min-width:130px;text-align:center;padding:11px 12px;border-radius:10px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;text-decoration:none;border:1px solid var(--line);background:#fff;color:var(--ink)}'
  + '.oact .b.pri{background:var(--ink);color:#fff;border-color:var(--ink)}'
  + '.oact .b.saved{color:#22a06b;border-color:#22a06b;background:#f0fdf7}'
  + '</style>';

const DRAWER_HTML = '<div class="oppbd" id="oppBd"></div>'
  + '<aside class="oppdrawer" id="oppDrawer"><button class="oppx" id="oppX" aria-label="Close">\u2715</button>'
  + '<div class="oppbody" id="oppBody"></div></aside>';

const DRAWER_JS = `<script>
(function(){
  var bd=document.getElementById('oppBd'), dr=document.getElementById('oppDrawer'), body=document.getElementById('oppBody'), xb=document.getElementById('oppX');
  var CUR=null;
  function close(){ dr.classList.remove('show'); bd.classList.remove('show'); }
  if(xb)xb.onclick=close; if(bd)bd.onclick=close;
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')close(); });
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function due(d){ if(!d)return ''; var n=Math.ceil((new Date(d)-new Date())/86400000); if(n<0)return 'closed'; if(n===0)return 'due today'; if(n===1)return '1 day left'; return n+' days left'; }
  function longDate(d){ if(!d)return '\\u2014'; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return d;} }
  function sec(title,inner){ return '<div class="osec"><div class="osec-h">'+title+'</div>'+inner+'</div>'; }
  function empty(msg){ return '<div class="osec-empty">'+msg+'</div>'; }

  function snapshot(o){
    var n=o.deadline?Math.ceil((new Date(o.deadline)-new Date())/86400000):null;
    var cls=(n!=null&&n<=7)?'badge-dl':'badge-dl cool';
    return '<div class="snaphero">'
      + (o.noticeType?'<span class="badge-nt">'+esc(o.noticeType)+'</span>':'')
      + (o.deadline?'<span class="'+cls+'">'+esc(due(o.deadline))+'</span>':'')
      + '</div>'
      + '<div class="snapt">'+esc(o.title)+'</div>'
      + '<div class="snapgrid">'
      + '<div><div class="k">Set-aside</div><div class="v">'+esc(o.setAsideLabel||'Open')+'</div></div>'
      + '<div><div class="k">NAICS</div><div class="v">'+esc(o.naics||'\\u2014')+(o.category?' \\u00b7 '+esc(o.category):'')+'</div></div>'
      + '<div><div class="k">PSC</div><div class="v">'+esc(o.psc||'\\u2014')+'</div></div>'
      + '<div><div class="k">Response due</div><div class="v">'+longDate(o.deadline)+'</div></div>'
      + '<div><div class="k">Posted</div><div class="v">'+longDate(o.posted)+'</div></div>'
      + '<div><div class="k">Solicitation</div><div class="v" style="font-family:var(--mono,monospace);font-size:12.5px">'+esc(o.solicitation||'\\u2014')+'</div></div>'
      + '</div>';
  }
  // Buying organization — the agency hierarchy + place of performance, in its OWN section
  // (SAM shows this as a prominent block; it was easy to miss as a grey line under the title).
  function orgSec(o){
    var loc=(o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'');
    var cue=o.location.source==='office'?' <span style="color:#94a3b8;font-weight:400;font-size:11px">(buying office)</span>':'';
    return sec('Buying organization','<div class="snapgrid">'
      + '<div><div class="k">Department / agency</div><div class="v">'+esc(o.department||'\\u2014')+'</div></div>'
      + '<div><div class="k">Sub-tier</div><div class="v">'+esc(o.subTier||'\\u2014')+'</div></div>'
      + (o.office?'<div><div class="k">Office</div><div class="v">'+esc(o.office)+'</div></div>':'')
      + '<div><div class="k">Place of performance</div><div class="v">'+esc(loc||'Not specified')+cue+'</div></div>'
      + '</div>');
  }
  function clamp(id,text){
    var long=text.length>620;
    return '<div class="osec-b'+(long?' clamp':'')+'" id="'+id+'">'+esc(text)+'</div>'
      + (long?'<button class="osec-more" onclick="var b=document.getElementById(\\''+id+'\\');var c=b.classList.toggle(\\'clamp\\');this.textContent=c?\\'Show more\\':\\'Show less\\';if(c)b.scrollIntoView({block:\\'nearest\\'});">Show more</button>':'');
  }
  function descSec(o){
    if(!o.synopsis)return sec('Description',empty('No description has been added to this opportunity.'));
    return sec('Description',clamp('synBody',o.synopsis));
  }
  function sowSec(o){
    if(!(o.sow&&o.sow.text))return '';
    return sec('Scope of work'+(o.sow.filename?' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">'+esc(o.sow.filename)+'</span>':''),clamp('sowBody',o.sow.text));
  }
  function pocCard(c){
    return '<div class="ocontact"><div class="nm">'+esc(c.name||'Contact')+'</div>'
      + (c.title?'<div class="ti">'+esc(c.title)+'</div>':'')
      + '<div class="row">'
      + (c.email?'\\u2709\\ufe0f <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'')
      + (c.email&&c.phone?' \\u00b7 ':'')+(c.phone?'\\u260e\\ufe0f '+esc(c.phone):'')
      + '</div></div>';
  }
  function contactsSec(o){
    var cs=o.contacts||[];
    if(!cs.length)return sec('Contact information',empty('No contact information has been added to this opportunity.'));
    var prim=cs.filter(function(c){return (c.type||'').toLowerCase()==='primary';});
    var alt=cs.filter(function(c){return (c.type||'').toLowerCase()!=='primary';});
    var inner='';
    if(prim.length)inner+='<div class="osec-sub">Primary point of contact</div>'+prim.map(pocCard).join('');
    if(alt.length)inner+='<div class="osec-sub" style="margin-top:14px">Alternative point of contact</div>'+alt.map(pocCard).join('');
    if(!prim.length&&!alt.length)inner=cs.map(pocCard).join('');
    return sec('Contact information',inner);
  }
  function docsSec(o){
    var links=[], atts=[];
    if(o.additionalInfo&&o.additionalInfo.link)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.additionalInfo.link)+'" target="_blank" rel="noopener">Additional information</a></div>');
    if(o.uiLink)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View the full notice on SAM.gov</a></div>');
    (o.attachments||[]).slice(0,20).forEach(function(a){
      var name=(a&&a.name)||'Attachment', url=(a&&a.url)||'';
      atts.push('<div class="odoc">\\ud83d\\udcc4 '+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(name)+'</a>':esc(name))+'</div>');
    });
    var inner='<div class="osec-sub">Links</div>'+(links.length?links.join(''):empty('No links have been added to this opportunity.'))
      + '<div class="osec-sub" style="margin-top:16px">Attachments</div>'+(atts.length?atts.join(''):empty('No attachments have been added to this opportunity.'));
    return sec('Attachments / links',inner);
  }
  function vendorsSec(o){
    // SAM's Interested Vendors List. We don't cache it (SAM's IVL isn't in the opportunities API
    // and is usually empty), so mirror SAM's empty state and link to the live list.
    return sec('Interested vendors',
      empty('No interested vendors have been added to this opportunity.')
      + (o.uiLink?'<div class="odoc" style="border-bottom:0;margin-top:4px">\\ud83d\\udd17 <a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">See the interested vendors list on SAM.gov</a></div>':''));
  }
  // Save to pursuits (detail) — mirrors the popup save, using the currently-open opp.
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(t){ try{ var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase():''; }catch(e2){return '';} }
  window.saveCurrentOpp=function(btn){
    if(!CUR||btn.dataset.saved==='1')return;
    var t=tok(), em=t?email(t):'';
    if(!t||!em){ btn.textContent='Sign in to save'; return; }
    btn.textContent='Saving\\u2026';
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:CUR.title,notice_id:CUR.id,solicitation_number:CUR.solicitation,agency:CUR.department,naics_code:CUR.naics,response_deadline:CUR.deadline,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In pursuits':'\\u2713 Saved'; btn.classList.add('saved'); btn.dataset.saved='1'; }
      else btn.textContent='Try again';
    }).catch(function(){ btn.textContent='Try again'; });
  };
  function actions(o){
    return '<div class="oact">'
      + '<button class="b pri" onclick="saveCurrentOpp(this)">Save to pursuits</button>'
      + '<a class="b" href="/app?panel=proposal&notice='+encodeURIComponent(o.id)+'" target="_blank" rel="noopener">Draft proposal</a>'
      + (o.uiLink?'<a class="b" href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View on SAM \\u2197</a>':'')
      + '</div>';
  }
  // Bid Facts — the Zillow "Facts & features" grid. Real columns from the detail API.
  function bidFactsSec(facts){
    if(!facts||!facts.length)return '';
    var rows=facts.map(function(f){ return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>'; }).join('');
    return sec('Bid facts','<div class="bf-grid">'+rows+'</div>');
  }
  // AI Analysis (Go/No-Go) — on-demand (it's an LLM call, Pro-gated). Reuses the existing
  // /api/analyst/bid-no-bid engine (PURSUE/WATCH/SKIP + score + why/concerns/next step).
  function aiSec(o){
    return sec('AI analysis \\u00b7 Go / No-Go',
      '<div id="aiBox"><button class="ai-run" onclick="runAI(\\''+esc(o.id)+'\\')">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M12 3l1.9 5.8H20l-4.9 3.6L17 18l-5-3.7L7 18l1.9-5.6L4 8.8h6.1z"/></svg>'
      + 'Should I bid on this? \\u2014 run AI analysis</button>'
      + '<div class="ai-note">Mindy weighs your fit vs. the requirement and gives a bid / no-bid call.</div></div>');
  }
  window.runAI=function(nid){
    var box=document.getElementById('aiBox'); if(!box)return;
    var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){}
    try{ var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    if(!t||!em){ box.innerHTML='<div class="ai-note">Please <a href="/app?next=%2Fopportunity-map" style="color:#006aff;font-weight:600">sign in</a> to run AI analysis.</div>'; return; }
    box.innerHTML='<div class="ai-run ai-loading">Analyzing this opportunity\\u2026</div>';
    fetch('/api/analyst/bid-no-bid',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},body:JSON.stringify({noticeId:nid,email:em})})
      .then(function(r){ return r.json().then(function(d){ return {status:r.status,d:d}; }); })
      .then(function(res){
        if(res.status===402||( res.d&&res.d.teaser)){
          box.innerHTML='<div class="ai-upsell"><div class="ai-upsell-h">\\ud83d\\udd12 AI Go/No-Go is a Pro feature</div><p>Get a bid/no-bid call, win-drivers, concerns, likely competitors and your next step \\u2014 per opportunity.</p><a class="ai-upgrade" href="'+((res.d&&res.d.upgrade_url)||'/market-intelligence')+'">Upgrade to Pro</a></div>'; return;
        }
        var a=res.d&&res.d.analysis; if(!a){ box.innerHTML='<div class="ai-note">Couldn\\u2019t analyze this one. Try again shortly.</div>'; return; }
        var rec=(a.recommendation||'watch').toLowerCase();
        var col=rec==='pursue'?'#12805c':rec==='skip'?'#e5484d':'#b54708';
        var label=rec==='pursue'?'PURSUE':rec==='skip'?'SKIP':'WATCH';
        function list(items,cls){ if(!items||!items.length)return ''; return '<ul class="ai-ul '+cls+'">'+items.slice(0,5).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'; }
        box.innerHTML='<div class="ai-verdict" style="border-color:'+col+'"><span class="ai-badge" style="background:'+col+'">'+label+'</span>'
          + (typeof a.score==='number'?'<span class="ai-score">Fit '+a.score+'/100</span>':'')+'</div>'
          + (a.next_step?'<div class="ai-next"><strong>Next step:</strong> '+esc(a.next_step)+'</div>':'')
          + (a.why_pursue&&a.why_pursue.length?'<div class="ai-lab">Why pursue</div>'+list(a.why_pursue,'pos'):'')
          + (a.concerns&&a.concerns.length?'<div class="ai-lab">Concerns</div>'+list(a.concerns,'neg'):'')
          + (a.competitors_likely&&a.competitors_likely.length?'<div class="ai-lab">Likely competitors</div>'+list(a.competitors_likely,''):'')
          + (a.effort_estimate?'<div class="ai-note">Effort: '+esc(a.effort_estimate)+'</div>':'');
      }).catch(function(){ box.innerHTML='<div class="ai-note">Couldn\\u2019t analyze this one. Try again shortly.</div>'; });
  };
  // Similar opportunities — the Zillow "Nearby homes" flywheel. Clicking one opens its drawer.
  function similarSec(sims){
    if(!sims||!sims.length)return '';
    var cards=sims.map(function(s){
      var meta=[s.agency,s.location,(s.deadline?'due '+s.deadline:'')].filter(Boolean).join(' \\u00b7 ');
      return '<button class="sim-card" onclick="openOppDrawer(\\''+esc(s.id)+'\\')">'
        + '<div class="sim-t">'+esc(s.title)+'</div>'
        + '<div class="sim-m">'+esc(meta)+'</div>'
        + (s.setAside?'<span class="sim-sa">'+esc(s.setAside)+'</span>':'')
        + '</button>';
    }).join('');
    return sec('Similar opportunities','<div class="sim-list">'+cards+'</div>');
  }
  // Reused-intelligence sections (predecessor history / agency intel / pricing) — filled by
  // a second on-demand fetch (?intel=1). Placeholder shows a subtle "loading intel" line.
  function ul(items){ return '<ul class="bf-ul">'+items.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'; }
  function renderIntel(intel){
    if(!intel)return '';
    var out='';
    var p=intel.predecessor;
    if(p&&(p.incumbent||p.value)){
      var facts=[];
      if(p.incumbent)facts.push({k:'Likely incumbent',v:p.incumbent+(p.incumbentState?' ('+p.incumbentState+')':'')});
      if(p.value)facts.push({k:'Prior contract value',v:p.value});
      if(p.expires)facts.push({k:'Expires',v:p.expires});
      if(p.vehicle)facts.push({k:'Vehicle / parent IDV',v:p.vehicle});
      if(p.confidence)facts.push({k:'Match confidence',v:p.confidence});
      out+=sec('Contract history \\u00b7 who holds this now','<div class="bf-grid">'+facts.map(function(f){return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>';}).join('')+'</div>');
    }
    var a=intel.agency;
    if(a&&((a.painPoints&&a.painPoints.length)||(a.priorities&&a.priorities.length))){
      var inner='';
      if(a.priorities&&a.priorities.length)inner+='<div class="ai-lab">Agency priorities</div>'+ul(a.priorities);
      if(a.painPoints&&a.painPoints.length)inner+='<div class="ai-lab">Known pain points</div>'+ul(a.painPoints);
      out+=sec('Know your buyer \\u00b7 agency intel',inner);
    }
    var pr=intel.pricing;
    if(pr&&pr.rates&&pr.rates.length){
      var rows=pr.rates.map(function(r){ var lbl=(r.labor_category||'Vendor')+(r.size?' \\u00b7 '+r.size:''); var rate=r.hourly_rate; return '<div class="bf-row"><div class="bf-k">'+esc(lbl)+'</div><div class="bf-v">'+esc(rate?('$'+rate+'/hr avg'):'')+'</div></div>'; }).join('');
      out+=sec('Pricing intel \\u00b7 what vendors charge here','<div class="bf-grid">'+rows+'</div>'+(pr.summary?'<div class="ai-note">'+esc(pr.summary)+'</div>':''));
    }
    return out;
  }
  function render(o,extra){
    CUR=o;
    extra=extra||{};
    return snapshot(o)+bidFactsSec(extra.bidFacts)+aiSec(o)
      + '<div id="intelBox"><div class="intel-load">Loading market intelligence\\u2026</div></div>'
      + orgSec(o)+descSec(o)+sowSec(o)+contactsSec(o)+docsSec(o)+vendorsSec(o)
      + similarSec(extra.similar)
      + '<div class="oppsoon">Coming next: expected value range \\u00b7 M-Win score.</div>'
      + actions(o);
  }
  window.openOppDrawer=function(nid){
    if(!nid)return;
    if(window.__mapMode&&window.__mapMode!=='open')return; // detail drawer is open-opps only for now
    body.innerHTML='<div class="oppload">Loading\\u2026</div>';
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    fetch('/api/app/opportunity-detail?id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(d){
      if(!(d&&d.success&&d.opp)){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; return; }
      body.innerHTML=render(d.opp,{bidFacts:d.bidFacts,similar:d.similar});
      // Second, on-demand fetch for the reused-intelligence sections (fail-soft).
      fetch('/api/app/opportunity-detail?intel=1&id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(x){
        var box=document.getElementById('intelBox'); if(!box)return;
        var h=(x&&x.success)?renderIntel(x.intel):'';
        box.innerHTML=h||''; // nothing found → collapse silently (no dead section)
      }).catch(function(){ var box=document.getElementById('intelBox'); if(box)box.innerHTML=''; });
    }).catch(function(){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; });
  };
})();
</script>`;

// Default map view — like Zillow opening to your city/state, NOT the whole globe.
// The template's boot fitView() fits ALL pins (incl. foreign — Sasebo, embassies), which
// zooms out to the world. Instead: center on the signed-in user's profile state (zoom 6);
// fall back to the continental US immediately so there's never a world-view flash. The
// template's fitView() boot call is neutralized (see the html.replace in GET) — moveend
// then auto-loads the region's live data. STATE_CENTROIDS is injected server-side.
const BOOT_VIEW_JS = '<script>window.__STATE_CENTROIDS=__STATE_CENTROIDS__;</script>'
  + `<script>(function(){
  var CONUS=[[38,-96],4.5];
  // The template declares 'const map' at top-level of its own <script> (shared global lexical
  // scope, but NOT on window), so reach it via a getter that tolerates it not existing yet.
  function M(){ try{ return map; }catch(e){ return null; } }
  function decodeEmail(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function setStateView(st){ var m=M(); var c=window.__STATE_CENTROIDS&&window.__STATE_CENTROIDS[st]; if(m&&c){ try{ m.setView(c,6,{animate:false}); return true; }catch(e){} } return false; }
  function conus(){ var m=M(); if(m){ try{ m.setView(CONUS[0],CONUS[1],{animate:false}); return true; }catch(e){} } return false; }
  var _done=false;
  // Called by the template's window-load handler (after resize) AND immediately below. Idempotent.
  window.__mapBootView=function(){
    if(!M()){ setTimeout(window.__mapBootView,60); return; }
    conus(); // never the world — CONUS first, instantly
    if(_done)return; _done=true;
    var em=decodeEmail();
    if(!em){ if(window.__mapRefetch)window.__mapRefetch(); return; }
    var tok=''; try{ tok=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
    var H={'x-mi-auth-token':tok,'x-user-email':em};
    fetch('/api/app/map-home?email='+encodeURIComponent(em),{headers:H})
      .then(function(r){return r.json();}).then(function(d){
        var st=(d&&d.state?String(d.state):'').toUpperCase().slice(0,2);
        if(st&&setStateView(st))return; // moveend → fetchView loads that region
        if(window.__mapRefetch)window.__mapRefetch();
      }).catch(function(){ if(window.__mapRefetch)window.__mapRefetch(); });
    // Saved-search "Updates N" badge — unseen new matches across the user's saved searches.
    fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:H})
      .then(function(r){return r.json();}).then(function(d){
        var n=(d&&d.success&&d.count)?d.count:0; var b=document.getElementById('savedBadge');
        if(b){ if(n>0){ b.textContent=n>99?'99+':String(n); b.hidden=false; } else { b.hidden=true; } }
      }).catch(function(){});
  };
  window.__mapBootView();
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
      nid: o.id,
      uiLink: o.uiLink,
      lat: o.lat,
      lng: o.lng,
      locSrc: o.locSrc,
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
    html = html.replace('</head>', PAGE_CSS + ZLAYOUT_CSS + DRAWER_CSS + '</head>');
    // Zillow layout: inject the icon rail + top search bar as the first children of .app
    // (the grid areas place them; VIEWPORT_JS moves the filter bar up into the top bar).
    html = html.replace('<div class="app">', '<div class="app">' + ZHEAD_HTML + ZRAIL_HTML + ZTOP_HTML);
    // Load setColorFor right after leaflet.js (before the template's map script).
    html = html.replace('<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + EARLY_INJECT);
    // Color pins by SET-ASIDE eligibility (fixes the all-gray category mismatch).
    html = html.split('catColor(o.cat)').join('setColorFor(o)');
    // Office-vs-PoP honesty: a pin whose location is the BUYING OFFICE (SAM omitted place of
    // performance) renders HOLLOW — white fill, colored ring — so it's not read as confirmed PoP.
    html = html.replace("color:'#ffffff',weight:2,",
      "color:o.locSrc==='office'?col:'#ffffff',weight:o.locSrc==='office'?2.5:2,");
    html = html.replace("fillColor:col,fillOpacity:o.src==='RECOMPETE'?.72:.95",
      "fillColor:o.locSrc==='office'?'#ffffff':col,fillOpacity:o.locSrc==='office'?0.9:(o.src==='RECOMPETE'?.72:.95)");
    // Honesty label in the popup + list card.
    html = html.replace('<div class="pvmeta"><b>${agency}</b> · ${o.loc}</div>',
      '<div class="pvmeta"><b>${agency}</b> · ${o.loc}${o.locSrc===\'office\'?\' <span style=\"color:#94a3b8\">· buying office (place of performance not specified)</span>\':\'\'}</div>');
    html = html.replace('<span class="loc">${o.loc}</span>',
      '<span class="loc">${o.loc}${o.locSrc===\'office\'?\' · office\':\'\'}</span>');
    // Set-aside color legend on the map.
    html = html.replace('<div id="map"></div>', '<div id="map"></div>' + LEGEND_HTML);
    // "More filters" dropdown in the filter bar; drop the redundant standalone "SDVOSB only"
    // pill (the Set-aside dropdown already covers every set-aside, SDVOSB included).
    html = html.replace('<button class="clr" id="clrAll">Clear all</button>',
      MORE_FILTERS + SAVE_SEARCH_BTN + '<button class="clr" id="clrAll">Clear all</button>');
    // Filter reorg: replace the old client-side pill row (Source / Service line /
    // Set-aside / SDVOSB / Closing≤7d) with the server-wired controls. One replace
    // spanning all five leftover buttons removes them + their throw-prone count badges.
    html = html.replace(
      '<button class="fbtn" data-sheet="src">Source <span class="cnt" id="c-src"></span> <span class="car">▼</span></button>\n'
      + '        <button class="fbtn" data-sheet="cat">Service line <span class="cnt" id="c-cat"></span> <span class="car">▼</span></button>\n'
      + '        <button class="fbtn" data-sheet="set">Set-aside <span class="cnt" id="c-set"></span> <span class="car">▼</span></button>\n'
      + '        <button class="fbtn" id="f-sd">SDVOSB only</button>\n'
      + '        <button class="fbtn" id="f-soon">Closing ≤7 days</button>',
      SERVER_FILTERS,
    );
    // The deleted pills leave orphaned template JS that null-derefs now that the
    // buttons are gone. Null-guard each throw-prone getElementById so the page's own
    // scripts don't crash before VIEWPORT_JS runs. (The .fbtn[data-sheet] loop,
    // renderSheet/closeSheet, and pass()'s F.* checks are harmless no-ops once the
    // buttons/sheets don't exist, so they need no change.)
    html = html
      .replace("document.getElementById('c-src').textContent=F.src.size===3?'':F.src.size;",
        "var _cs=document.getElementById('c-src');if(_cs)_cs.textContent=F.src.size===3?'':F.src.size;")
      .replace("document.getElementById('c-cat').textContent=F.cat.size===CATS.length?'':F.cat.size;",
        "var _cc=document.getElementById('c-cat');if(_cc)_cc.textContent=F.cat.size===CATS.length?'':F.cat.size;")
      .replace("document.getElementById('c-set').textContent=F.set.size===SETGROUPS.length?'':F.set.size;",
        "var _ce=document.getElementById('c-set');if(_ce)_ce.textContent=F.set.size===SETGROUPS.length?'':F.set.size;")
      .replace("document.getElementById('f-soon').onclick=e=>{F.soon=!F.soon;e.target.classList.toggle('active',F.soon);render();};",
        "")
      .replace("document.getElementById('f-sd').onclick=e=>{F.sdOnly=!F.sdOnly;e.target.classList.toggle('active',F.sdOnly);render();};",
        "")
      .replace("document.getElementById('f-sd').classList.remove('active');\n  document.getElementById('f-soon').classList.remove('active');",
        "");
    // Recompete cards/popups showed a "Win odds"/"Win probability" column — that's win-probability
    // scoring, which is permanently killed. Replace with the Set-aside (a real, unscored fact).
    html = html.replace('<div class="st"><div class="k">Win odds</div><div class="v ${o.prob===\'high\'?\'hi\':\'med\'}">${(o.prob||\'—\').replace(/^./,c=>c.toUpperCase())}</div></div>',
      '<div class="st"><div class="k">Set-aside</div><div class="v">${o.set===\'None\'?\'Open\':o.set}</div></div>');
    html = html.replace('<div class="fld"><div class="k">Win probability</div><div class="v ${o.prob===\'high\'?\'sd\':\'\'}">${(o.prob||\'—\').replace(/^./,c=>c.toUpperCase())}</div></div>',
      '<div class="fld"><div class="k">Set-aside</div><div class="v">${o.set===\'None\'?\'Open\':o.set}</div></div>');
    // CARD (#1 Snapshot): NO action buttons on the card face (Eric). The card is the clickable
    // snapshot; Save/Draft live in the detail drawer. Card actions → a "View details →" hint.
    html = html.replace('<a class="act" href="${samURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SAM.gov</a>',
      '<span class="viewdet">View details →</span>');
    html = html.replace('<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Start drafting</a>', '');
    // POPUP (map-pin quick peek): keep Save to pursuits + Draft proposal + a small SAM link.
    html = html.replace('<a class="pva" href="${samURL(o)}" target="_blank" rel="noopener">View on SAM.gov</a>',
      '<button class="pva savep" data-sol="${o.sol}" onclick="savePursuit(this)">Save to pursuits</button><a class="pva samlink" href="${samURL(o)}" target="_blank" rel="noopener">View on SAM ↗</a>');
    html = html.replace('<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">Start drafting</a>',
      '<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">Draft proposal</a>');
    // Card click opens the detail drawer (was: flyTo + popup). Uses the notice_id (o.nid).
    html = html.replace('c.onclick=()=>select(o.sol,true);', 'c.onclick=()=>openOppDrawer(o.nid||o.sol);');
    // Swap the map controls: drop Fit-to-results + Terrain, add a "Draw area" button
    // (Zillow's Draw — drag a rectangle on the map to filter opportunities to inside it).
    html = html.replace(
      '<button class="mpill" id="fitBtn">Fit to results</button>\n      <button class="mpill" id="basemapBtn">Terrain</button>',
      '<button class="mpill" id="drawBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>Draw area</button>'
      + '<button class="mpill" id="drawClear" style="display:none">✕ Clear area</button>');
    // We removed the fitBtn + basemapBtn buttons — null-guard the template's now-orphaned
    // handlers so `null.onclick` doesn't THROW and abort the map init script (which killed
    // ALL pin rendering). Same class of fix as the deleted filter pills.
    html = html
      .replace("document.getElementById('basemapBtn').onclick=()=>{\n  provIdx=(provIdx+1)%PROVIDERS.length;mountTiles(provIdx);\n};",
        "var _bm=document.getElementById('basemapBtn'); if(_bm)_bm.onclick=function(){ provIdx=(provIdx+1)%PROVIDERS.length; mountTiles(provIdx); };")
      .replace("document.getElementById('fitBtn').onclick=()=>fitView();",
        "var _fb=document.getElementById('fitBtn'); if(_fb)_fb.onclick=function(){ fitView(); };");
    // Neutralize BOTH boot fitView() calls (they fit ALL pins incl. foreign → world view):
    //  (1) the end-of-script render();paintScore();fitView();
    //  (2) the window 'load' handler's delayed fitView() (fires 140ms after load).
    // BOOT_VIEW_JS centers on the user's profile state / CONUS instead. The manual fitBtn stays.
    html = html.replace('render();paintScore();fitView();', 'render();paintScore();');
    html = html.replace("window.addEventListener('load',()=>{resize();setTimeout(()=>{resize();fitView();},140);});",
      "window.addEventListener('load',()=>{resize();setTimeout(()=>{resize();if(window.__mapBootView)window.__mapBootView();},160);});");
    // Viewport-driven data + dynamic header + save-to-pursuits + detail drawer + draw-area (last, after globals).
    // BOOT_VIEW_JS runs LAST so `map` + __mapRefetch already exist when it centers the view.
    // NOTE: CARD_OVERRIDE_JS intentionally NOT injected — Eric wants the ORIGINAL richer card
    // (chip row + title + agency·location + the bordered Set-aside/NAICS/Due stat grid + footer),
    // not the thinner "Zillow hook" card. The original template cardHTML renders as-is.
    html = html.replace('</body>', DRAWER_HTML + VIEWPORT_JS + DRAW_JS + SAVE_JS + DRAWER_JS + BOOT_VIEW_JS + '</body>');
    html = html.replace('__STATE_CENTROIDS__', JSON.stringify(STATE_CENTROIDS));
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
