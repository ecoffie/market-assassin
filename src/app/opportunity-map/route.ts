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
    // Dataset dropdown = the STATE selector (Zillow's "For Sale ▾"). The top nav says the plain
    // noun (Open · Past Awarded · Contacts); the dropdown says the state (Active · Awarded · Contacts).
    '<select class="fsel fsel-mode" id="fltDataset" title="What to explore" onchange="onDatasetChange(this.value)">'
  +   '<option value="open">Active</option>'
  +   '<option value="recompete">Awarded</option>'
  +   '<option value="contractor">Contacts</option>'
  + '</select>'
  + '<select class="fsel" id="fltNotice" title="Notice type">'
  +   '<option value="">Notice type</option>'
  +   '<option value="Solicitation">Solicitation</option>'
  +   '<option value="Combined Synopsis/Solicitation">Combined Synopsis</option>'
  +   '<option value="Presolicitation">Presolicitation</option>'
  +   '<option value="Sources Sought">Sources Sought</option>'
  +   '<option value="Special Notice">Special Notice</option>'
  + '</select>'
  // Set-aside = a MULTI-select checkbox dropdown (Zillow's "Property type" — pick several).
  // The "Any deadline" quick pill was removed; deadline lives in the Filters panel.
  + '<div class="saselwrap">'
  +   '<button class="fsel fsel-btn" id="saselBtn" type="button"><span id="saselLabel">Set-aside</span>'
  +   '<svg viewBox="0 0 11 7" width="11" height="7" style="margin-left:6px"><path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>'
  +   '<div class="saselpanel" id="saselPanel"><div class="sasel-hdr">Set-aside eligibility</div>' + SET_GROUPS.filter((g)=>g.key!=='NONE').map((g)=>`<label class="sasel-chk"><input type="checkbox" class="sa-set" value="${g.key}"><i style="background:${g.color}"></i>${g.label}</label>`).join('')
  +   '<div class="sasel-foot"><button type="button" class="sasel-clr" id="saselClr">Clear</button><button type="button" class="sasel-apply" id="saselApply">Apply</button></div>'
  +   '</div>'
  + '</div>'
  // NAICS / Industry pill (replaces the old "Any deadline" — the contractor's #1 filter).
  // A small dropdown with a code input; type "5415" or a keyword. Deadline is now a SORT.
  + '<div class="naicswrap">'
  +   '<button class="fsel fsel-btn" id="naicsBtn" type="button"><span id="naicsLabel">NAICS</span>'
  +   '<svg viewBox="0 0 11 7" width="11" height="7" style="margin-left:6px"><path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>'
  +   '<div class="naicspanel" id="naicsPanel">'
  +     '<div class="naics-lbl">NAICS or PSC code</div>'
  +     '<input class="naics-in" id="naicsInput" placeholder="e.g. 541512 or 5415" autocomplete="off">'
  +     '<div class="naics-hint">Tip: 3\\u20134 digits = a whole industry group.</div>'
  +     '<div class="sasel-foot"><button type="button" class="sasel-clr" id="naicsClr">Clear</button><button type="button" class="sasel-apply" id="naicsApply">Apply</button></div>'
  +   '</div>'
  + '</div>';
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
  // Set-aside multi-select dropdown (Zillow "Property type"): position:FIXED so it ESCAPES the
  // .fscroll overflow-x:auto clip (an absolute panel inside it blanked the bar). Big blue checks.
  + '.saselwrap{position:relative;flex:none}'
  + '#saselBtn{display:inline-flex;align-items:center}'
  + '#saselBtn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  + '.saselpanel{position:fixed;top:62px;z-index:3000;min-width:288px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(16,24,40,.18);padding:10px;display:none}'
  + '.saselpanel.show{display:block}'
  + '.sasel-hdr{font:800 15px Inter,system-ui,sans-serif;color:var(--ink);padding:8px 10px 10px}'
  + '.sasel-chk{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;cursor:pointer;font:600 15px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.sasel-chk:hover{background:#f0f6ff}'
  // Big Zillow-blue checkbox: solid blue + white check when selected.
  + '.sasel-chk input{appearance:none;-webkit-appearance:none;width:22px;height:22px;border:2px solid #c7d0dc;border-radius:6px;cursor:pointer;flex:none;position:relative;transition:.12s}'
  + '.sasel-chk input:checked{background:#006aff;border-color:#006aff}'
  + '.sasel-chk input:checked:after{content:"";position:absolute;left:6px;top:2px;width:6px;height:11px;border:solid #fff;border-width:0 2.5px 2.5px 0;transform:rotate(45deg)}'
  + '.sasel-chk i{width:11px;height:11px;border-radius:50%;flex:none}'
  + '.sasel-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 8px 4px;margin-top:6px;border-top:1px solid var(--line)}'
  + '.sasel-clr{background:none;border:0;color:var(--jan);font:700 14px Inter;cursor:pointer;padding:8px 10px}'
  + '.sasel-apply{background:#006aff;border:0;color:#fff;font:700 15px Inter;cursor:pointer;padding:11px 26px;border-radius:10px}'
  + '.sasel-apply:hover{filter:brightness(.94)}'
  // NAICS / Industry pill dropdown — also position:FIXED (same clip escape).
  + '.naicswrap{position:relative;flex:none}'
  + '#naicsBtn{display:inline-flex;align-items:center}'
  + '#naicsBtn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  + '.naicspanel{position:fixed;top:62px;z-index:3000;min-width:300px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(16,24,40,.18);padding:18px;display:none}'
  + '.naicspanel.show{display:block}'
  + '.naics-lbl{font:800 15px Inter;color:var(--ink);margin-bottom:9px}'
  + '.naics-in{width:100%;border:1.5px solid #c7d0dc;border-radius:10px;height:46px;padding:0 14px;font:600 16px Inter;outline:none}'
  + '.naics-in:focus{border-color:#006aff;box-shadow:0 0 0 3px rgba(0,106,255,.12)}'
  + '.naics-hint{font:500 12.5px Inter;color:var(--faint);margin-top:9px}'
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
  + '.app{grid-template-columns:64px minmax(0,1fr) 400px!important;grid-template-rows:52px auto minmax(0,1fr)!important;'
  + 'grid-template-areas:"zhead zhead zhead" "zrail ztop ztop" "zrail zmap zcards"!important;transition:none!important}'
  + '.app.collapsed{grid-template-columns:64px minmax(0,1fr) 0px!important}'
  // Cards = a SINGLE wide column (real Zillow): one card per row, full-width, room to breathe.
  // flex:none on .card so flex layout can't shrink the (overflow:hidden) card to 0 height.
  + '.feed{display:flex!important;flex-direction:column!important;gap:12px!important;padding:14px 16px 28px!important}'
  + '.feed .card{flex:none!important;margin-bottom:0!important}'
  // Mindy header bar
  + '.zhead{grid-area:zhead;position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line);background:#fff;z-index:20}'
  + '.zh-left,.zh-right{display:flex;align-items:center;gap:22px}'
  + '.zh-right a{font:700 15px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}'
  // Left nav = the dataset nouns → bigger + bolder like Zillow\'s Buy/Rent/Sell header.
  + '.zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}'
  // Highlight top-nav items ONLY on hover — the blue must NOT persist on a clicked item.
  + '.zh-left a:hover,.zh-right a:hover{color:var(--jan)}'
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
  + '.zsearch{position:relative;flex:1 1 240px;min-width:150px;max-width:340px;display:flex;align-items:center;gap:8px;border:1px solid #d1d5db;border-radius:8px;padding:0 13px;height:40px;background:#fff}'
  + '.zsearch:focus-within{border-color:#006aff;box-shadow:0 0 0 3px rgba(0,106,255,.12)}'
  + '.zsearch svg{width:16px;height:16px;stroke:var(--sub);fill:none;stroke-width:2;flex:none}'
  + '.zsearch input{border:0;outline:0;flex:1;min-width:0;font:500 13.5px Inter,system-ui,sans-serif;background:transparent;color:var(--ink)}'
  // ── Focused-search suggestions panel (Zillow-style): Ask Mindy · Near me · Recent · Saved · autocomplete
  + '.zsp{position:absolute;top:calc(100% + 8px);left:0;width:min(420px,86vw);background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 44px rgba(16,24,40,.18);z-index:1200;overflow:hidden;display:none;max-height:70vh;overflow-y:auto}'
  + '.zsp.show{display:block}'
  + '.zsp-ask{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(90deg,#f4f0fe,#eef4ff);cursor:pointer;font:600 14px Inter;color:#4f46e5}'
  + '.zsp-ask:hover{background:linear-gradient(90deg,#ece5fd,#e3edff)}'
  + '.zsp-ask .sp{width:20px;height:20px;flex:none}'
  + '.zsp-row{display:flex;align-items:center;gap:11px;padding:11px 16px;cursor:pointer;font:500 14px Inter;color:var(--ink);border:0;background:none;width:100%;text-align:left}'
  + '.zsp-row:hover{background:var(--wash)}'
  + '.zsp-row svg,.zsp-row .ic{width:17px;height:17px;flex:none;stroke:var(--sub);fill:none;stroke-width:2}'
  + '.zsp-row .sub{color:var(--faint);font-weight:400;font-size:12.5px}'
  + '.zsp-row .code{font:600 12px "IBM Plex Mono",monospace;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:5px;flex:none}'
  + '.zsp-h{padding:12px 16px 5px;font:700 11px Inter;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}'
  + '.zsp-sep{height:1px;background:var(--hair);margin:5px 0}'
  + '.zsp-empty{padding:14px 16px;color:var(--faint);font:400 13px Inter}'
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
  // ⚠️ PERMANENT RULE — NEVER put overflow:auto/hidden/scroll on .fscroll (or any filter-bar
  // ancestor of a dropdown). It CLIPS every dropdown panel (Set-aside/NAICS/sheets) and has
  // silently broken the bar THREE times. The bar is kept on one row by flex-wrap:nowrap +
  // min-width:0 (pills SHRINK; the search absorbs the squeeze) — NOT by a scroll container.
  // overflow:visible here lets absolute-positioned dropdowns render normally. Page-widening is
  // prevented one level UP, on .app/html/body below — that is the correct place, not here.
  + '.ztop .fbar .fscroll{flex-wrap:nowrap!important;overflow:visible!important;row-gap:0;min-width:0}'
  // Page-widening guard lives HERE (the page shell), not on the filter scroller: html/body clip
  // horizontal overflow and .app is capped to the viewport. This stops a wide bar from pushing
  // the rail off-screen WITHOUT clipping any dropdown inside the bar.
  + 'html,body{overflow-x:hidden!important}'
  + '.app{max-width:100vw!important;overflow:hidden!important}'
  // filter sheets become dropdown overlays (a top bar can't push content down like the old panel)
  + '.ztop .fbar .sheet{position:absolute!important;top:calc(100% + 6px);left:18px;z-index:900;background:#fff;'
  + 'border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:14px 16px;'
  + 'min-width:300px;max-width:540px;margin-top:0!important;max-height:62vh;overflow-y:auto}'
  // Sort — Zillow-style blue text link (not a bordered form select). Borderless, blue, bold,
  // rescount ("N results") sits bold on the left of the sort row.
  + '.sortrow{padding:14px 20px 12px!important;position:relative}'
  + '.sortrow .rescount{font:600 15px Inter,system-ui,sans-serif;color:var(--ink)}'
  // ── Custom Zillow sort menu: blue "Sort: X ▾" trigger + white rounded option panel. ──
  + '.sortmenu-wrap{position:relative}'
  + '.sortmenu-btn{display:inline-flex;align-items:center;gap:6px;border:0;background:none;cursor:pointer;'
  + 'font:700 14.5px Inter,system-ui,sans-serif;color:#006aff;padding:4px 2px}'
  + '.sortmenu-btn:hover{text-decoration:underline}'
  + '.sortmenu-pre{font-weight:700}'
  + '.sortmenu-car{transition:transform .15s}.sortmenu-wrap.open .sortmenu-car{transform:rotate(180deg)}'
  + '.sortmenu{position:absolute;top:calc(100% + 8px);right:0;min-width:250px;background:#fff;'
  + 'border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 40px rgba(16,24,40,.18);'
  + 'padding:8px;z-index:1200;display:none}'
  + '.sortmenu.show{display:block}'
  + '.sortmenu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;'
  + 'cursor:pointer;font:500 15px Inter,system-ui,sans-serif;color:var(--ink);padding:11px 12px;border-radius:9px}'
  + '.sortmenu-item:hover{background:#f0f6ff}'
  + '.sortmenu-item.on{color:#006aff;font-weight:700}'
  + '.sortmenu-check{width:16px;flex:none;color:#006aff;font-weight:800;visibility:hidden}'
  + '.sortmenu-item.on .sortmenu-check{visibility:visible}'
  // ── Popup card: 1-click heart (top-right) + single "Should I bid?" CTA (Zillow map card) ──
  + '.pvbody{position:relative!important}'
  + '.pv-heart{position:absolute;top:12px;right:12px;z-index:2;width:34px;height:34px;border-radius:50%;border:0;'
  + 'background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(16,24,40,.16);cursor:pointer;display:grid;place-items:center;padding:0}'
  + '.pv-heart svg{width:19px;height:19px;fill:none;stroke:#111c26;stroke-width:2}'
  + '.pv-heart:hover svg{stroke:#e5484d}'
  + '.pv-heart.on svg{fill:#e5484d;stroke:#e5484d}'
  + '.pvacts{display:block!important}'  // single full-width CTA now
  + '.pva.pri.pv-bid{width:100%;display:flex;align-items:center;justify-content:center;background:#006aff!important;border-color:#006aff!important;color:#fff!important;font:700 14px Inter,system-ui,sans-serif;padding:12px!important;border-radius:10px;cursor:pointer}'
  + '.pva.pri.pv-bid:hover{filter:brightness(.94)}'
  + '</style>';

// Icon rail + top search bar. The template's .fbar (filters) is appended into .ztop by JS.
// Icon-only rail (reduced — no text labels, which were wider than the rail and clipped).
// Names live in the title tooltip.
// Left rail mirrors Zillow's (Search · Updates · Favorites · Plan): NO Home/Map (redundant here);
// Alerts → Updates (the saved-search-change feed) which carries the red count badge.
const ZRAIL_HTML = '<nav class="zrail">'
  + '<a class="on" id="railSearch" title="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg><span>Search</span></a>'
  // Updates = saved SEARCHES (Zillow's Updates page IS SavedSearches); carries the red badge.
  + '<a href="/opportunity-map/saved" title="Updates — saved searches &amp; new matches" style="position:relative"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Updates</span><b class="railbadge" id="savedBadge" hidden></b></a>'
  // Favorites = saved OPPORTUNITIES (the hearted ones) — a DIFFERENT function than saved searches.
  + '<a href="/opportunity-map/favorites" title="Favorites — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Favorites</span></a>'
  + '</nav>';
const ZTOP_HTML = '<div class="ztop"><div class="zsearch">'
  + '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'
  + '<input id="zsearchInput" placeholder="Search opportunities, agencies, keywords…" autocomplete="off">'
  + '<div class="zsp" id="searchPanel"></div></div></div>';

// Custom Zillow-style sort menu. SORT_OPTIONS is the single source of truth (value → label).
// Rendered as: a HIDDEN native <select id="sort"> (keeps SORT_EXTRA_JS's change→render wiring) +
// a blue "Sort: <label> ▾" trigger + a white rounded menu of rows (✓ on the active one).
const SORT_OPTIONS: Array<[string, string]> = [
  ['deadline', 'Deadline (soonest)'],
  ['newest', 'Newest posted'],
  ['setaside', 'Set-aside opps first'],
  ['deadline-far', 'Deadline (latest)'],
  ['value', 'Contract value (high to low)'],
  ['az', 'Title (A-Z)'],
];
const SORT_MENU_HTML =
    '<select id="sort" style="display:none">'
  + SORT_OPTIONS.map(([v]) => `<option value="${v}"></option>`).join('')
  + '</select>'
  + '<div class="sortmenu-wrap">'
  +   '<button type="button" class="sortmenu-btn" id="sortBtn"><span class="sortmenu-pre">Sort:</span> <span id="sortBtnLabel">Deadline (soonest)</span>'
  +   '<svg viewBox="0 0 12 12" width="12" height="12" class="sortmenu-car"><path d="M3 4.5L6 8l3-3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>'
  +   '<div class="sortmenu" id="sortMenu">'
  +     SORT_OPTIONS.map(([v, l], i) => `<button type="button" class="sortmenu-item${i === 0 ? ' on' : ''}" data-sort="${v}"><span class="sortmenu-check">✓</span>${l}</button>`).join('')
  +   '</div>'
  + '</div>';

// Mindy brand header bar (top, full width) — the wordmark + product name, Zillow-style.
// Zillow-style top nav: left nav links · CENTER logo · right nav + account.
const ZHEAD_HTML = '<header class="zhead">'
  // Top nav = the plain noun for each corpus (Open · Past Awarded · Contacts). The dropdown pill
  // says the STATE (Active · Awarded · Contacts). Nav word and dropdown state are the same flow
  // (like Zillow's Buy → "For Sale"): each nav item drives setMapMode + syncs the pill.
  + '<nav class="zh-left">'
  + '<a class="zh-mode on" data-mode="open" onclick="setMapMode(\'open\')">Open</a>'
  + '<a class="zh-mode" data-mode="recompete" onclick="setMapMode(\'recompete\')">Past</a>'
  + '<a class="zh-mode" data-mode="contractor" onclick="setMapMode(\'contractor\')">Contacts</a>'
  + '<a href="/bid">Bid with confidence</a>'
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
    // Sort-row left label = a clean "N results" (Zillow's pattern), replacing the old
    // "N SDVOSB · N closing this week" noise line.
    var rc=document.getElementById('rescount'); if(!rc)return;
    rc.innerHTML='<span style="font-weight:700;color:var(--ink)">'+shown.toLocaleString()+'</span> <span style="font-weight:400;color:var(--sub)">result'+(shown===1?'':'s')+'</span>';
  }
  // After a marker rebuild (render clears+recreates all markers on every refetch), RE-OPEN the
  // popup for the currently-selected opp — otherwise a background refetch destroys the popup the
  // user just opened (the "flash"). The popup now stays until the user clicks off it / another dot.
  var _render=render; render=function(){ _render(); updateHeader();
    try{ if(typeof selected!=='undefined' && selected){ var mm=markers.get(selected); if(mm && !mm.isPopupOpen()) mm.openPopup(); } }catch(e){}
  };
  // Zillow: the popup stays through refetches (closeOnClick:false) but closes when the user
  // clicks the MAP BACKGROUND (click off it). A programmatic refetch-pan fires no map 'click',
  // so this only triggers on a real click. Clears selection so render() won't re-open it.
  try{ map.on('click', function(){ try{ selected=null; map.closePopup(); document.querySelectorAll('.card.sel').forEach(function(c){c.classList.remove('sel');}); }catch(e){} }); }catch(e){}
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
  bindSel('fltNotice','noticeType');
  // Set-aside MULTI-select dropdown (replaces the old single-select pill + the deadline pill).
  (function(){
    var btn=document.getElementById('saselBtn'), pan=document.getElementById('saselPanel'), lbl=document.getElementById('saselLabel');
    if(!btn||!pan) return;
    function checked(){ return Array.prototype.slice.call(pan.querySelectorAll('.sa-set')).filter(function(c){return c.checked;}); }
    function apply(){ var vals=checked().map(function(c){return c.value;}); FILT.setAside=vals.join(','); // reuse the setAside param (comma-joined = OR)
      var n=vals.length; lbl.textContent=n?('Set-aside \\u00b7 '+n):'Set-aside'; btn.classList.toggle('hasfilt',n>0); pan.classList.remove('show'); fetchView(); }
    function place(){ var r=btn.getBoundingClientRect(); pan.style.top=(r.bottom+8)+'px'; var left=Math.min(r.left, window.innerWidth-pan.offsetWidth-12); pan.style.left=Math.max(12,left)+'px'; }
    btn.onclick=function(e){ e.stopPropagation(); var willShow=!pan.classList.contains('show'); pan.classList.toggle('show'); if(willShow)place(); };
    var ap=document.getElementById('saselApply'); if(ap)ap.onclick=apply;
    var cl=document.getElementById('saselClr'); if(cl)cl.onclick=function(){ checked().forEach(function(c){c.checked=false;}); apply(); };
    document.addEventListener('click',function(e){ if(!e.target.closest('.saselwrap')) pan.classList.remove('show'); });
    window.__saselReset=function(){ pan.querySelectorAll('.sa-set').forEach(function(c){c.checked=false;}); lbl.textContent='Set-aside'; btn.classList.remove('hasfilt'); };
  })();
  // NAICS / Industry pill (the contractor's #1 filter, promoted to the bar).
  (function(){
    var btn=document.getElementById('naicsBtn'), pan=document.getElementById('naicsPanel'), lbl=document.getElementById('naicsLabel'), inp=document.getElementById('naicsInput');
    if(!btn||!pan||!inp) return;
    function apply(){ var v=inp.value.trim(); FILT.naics=v; lbl.textContent=v?('NAICS \\u00b7 '+v):'NAICS'; btn.classList.toggle('hasfilt',!!v); pan.classList.remove('show'); fetchView(); }
    function place(){ var r=btn.getBoundingClientRect(); pan.style.top=(r.bottom+8)+'px'; var left=Math.min(r.left, window.innerWidth-pan.offsetWidth-12); pan.style.left=Math.max(12,left)+'px'; }
    btn.onclick=function(e){ e.stopPropagation(); var willShow=!pan.classList.contains('show'); pan.classList.toggle('show'); if(willShow){ place(); setTimeout(function(){inp.focus();},30); } };
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter')apply(); });
    var ap=document.getElementById('naicsApply'); if(ap)ap.onclick=apply;
    var cl=document.getElementById('naicsClr'); if(cl)cl.onclick=function(){ inp.value=''; apply(); };
    document.addEventListener('click',function(e){ if(!e.target.closest('.naicswrap')) pan.classList.remove('show'); });
    window.__naicsReset=function(){ inp.value=''; lbl.textContent='NAICS'; btn.classList.remove('hasfilt'); };
  })();
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
    ['fltNotice'].forEach(function(id){
      var el=document.getElementById(id); if(!el)return; el.value=''; el.classList.remove('on');
    });
    if(window.__saselReset)window.__saselReset();
    if(window.__naicsReset)window.__naicsReset();
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
  // 1-click Favorites heart on the popup card → toggles /api/opportunities/save (POST/DELETE).
  var _favs={};
  window.toggleFav=function(btn){
    var t=tok(); var em=t?email(t):''; var nid=btn.getAttribute('data-nid');
    if(!t||!em){ if(confirm('Sign in to save this to your Favorites?'))location.href='/app?next=%2Fopportunity-map'; return; }
    var on=btn.classList.contains('on');
    btn.classList.toggle('on',!on); _favs[nid]=!on; // optimistic
    fetch('/api/opportunities/save',{method:on?'DELETE':'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({email:em,noticeId:nid})})
      .then(function(r){ if(!r.ok&&r.status!==409){ btn.classList.toggle('on',on); _favs[nid]=on; } })
      .catch(function(){ btn.classList.toggle('on',on); _favs[nid]=on; });
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
  + '.oppbd{position:fixed;top:52px;left:64px;right:400px;bottom:0;background:rgba(17,28,38,.06);z-index:1400;opacity:0;pointer-events:none;transition:opacity .2s}'
  + '.oppbd.show{opacity:1}'
  + '.oppdrawer{position:fixed;top:52px;left:64px;right:400px;height:calc(100vh - 52px);height:calc(100dvh - 52px);background:#fff;z-index:1500;'
  + 'box-shadow:8px 0 40px rgba(0,0,0,.14);transform:translateX(-104%);transition:transform .28s cubic-bezier(.4,0,.2,1);'
  + 'overflow-y:auto;display:flex;flex-direction:column;'
  // Closed = fully hidden so nothing (esp. the sticky ✕ close button) bleeds over the
  // rail/map. visibility+pointer-events are cleared on .show.
  + 'visibility:hidden;pointer-events:none}'
  + '.oppdrawer.show{transform:none;visibility:visible;pointer-events:auto}'
  + '@media(max-width:1100px){.oppdrawer,.oppbd{left:0;right:0}}'
  // ── Zillow-style action bar (sticky top of the drawer) ──
  + '.oppbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;'
  + 'padding:12px 26px;background:#fff;border-bottom:1px solid var(--line)}'
  + '.oppbar-back{display:inline-flex;align-items:center;gap:7px;border:0;background:none;cursor:pointer;'
  + 'font:600 14.5px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.oppbar-back:hover{color:#006aff}'
  + '.oppbar-acts{display:flex;align-items:center;gap:4px}'
  + '.oppact{display:inline-flex;align-items:center;gap:6px;border:0;background:none;cursor:pointer;padding:7px 11px;border-radius:9px;'
  + 'font:600 13.5px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.oppact:hover{background:var(--wash)}'
  + '.oppact.done{color:#12805c}.oppact.done svg{fill:#12805c;stroke:#12805c}'
  + '@media(max-width:600px){.oppact span{display:none}}'
  // ── Sticky section tabs ──
  + '.opptabs{position:sticky;top:53px;z-index:4;display:flex;gap:22px;padding:0 26px;background:#fff;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}'
  + '.opptabs::-webkit-scrollbar{display:none}'
  + '.opptabs.hidden{display:none}'
  + '.opptab{border:0;background:none;cursor:pointer;font:600 14px Inter,system-ui,sans-serif;color:var(--sub);'
  + 'padding:13px 2px;border-bottom:2.5px solid transparent;white-space:nowrap;margin-bottom:-1px}'
  + '.opptab:hover{color:var(--ink)}'
  + '.opptab.on{color:#006aff;border-bottom-color:#006aff}'
  + '.oppbody{padding:2px 30px 44px;max-width:840px;width:100%}'
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
  // detail sections — every section is a divider-separated block with a bold header (unified).
  // Stronger section separation — a thicker, slightly darker rule + more breathing room, so
  // sections read as distinct blocks (they were running together with a faint 1px line).
  + '.osec{padding:28px 0;border-top:2px solid #eaeef3}'
  + '.osec:first-child{border-top:0;padding-top:16px}'
  + '.osec-h{font:800 18px Inter,system-ui,sans-serif;letter-spacing:-.01em;color:var(--ink);margin-bottom:14px}'
  + '.osec-b{font-size:14px;line-height:1.6;color:#374151;word-break:break-word}'
  + '.osec-empty{font-size:13.5px;color:var(--faint)}'
  + '.osec-sub{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--sub);margin-bottom:7px}'
  + '.osec-b.clamp{max-height:230px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 74%,transparent);mask-image:linear-gradient(#000 74%,transparent)}'
  + '.osec-more{margin-top:11px;font:700 13.5px Inter,system-ui,sans-serif;color:#006aff;background:none;border:0;cursor:pointer;padding:0}'
  // Re-flowed document body (SOW / description): real paragraphs + bold headings.
  + '.docbody p{margin:0 0 11px;font-size:14px;line-height:1.62;color:#374151}'
  + '.docbody p.sow-h{font-weight:700;color:var(--ink);margin-top:16px;margin-bottom:6px}'
  + '.docbody p:last-child{margin-bottom:0}'
  // "What\'s special" tags.
  + '.whatspecial{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}'
  + '.ws-tag{font:700 11.5px Inter,system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase;color:#334155;background:#eef2f7;padding:6px 11px;border-radius:7px}'
  // AI fit score bar.
  + '.scorebar{height:9px;border-radius:6px;background:#e9eef5;overflow:hidden;margin:10px 0 4px}'
  + '.scorebar i{display:block;height:100%;border-radius:6px}'
  // Pricing bar chart (vendor $/hr).
  + '.ratechart{display:flex;flex-direction:column;gap:11px}'
  + '.rc-row{display:grid;grid-template-columns:1fr 44%;grid-template-areas:"lbl val" "bar bar";gap:3px 10px;align-items:center}'
  + '.rc-lbl{grid-area:lbl;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.rc-sz{color:var(--faint);font-weight:400;font-size:11.5px}'
  + '.rc-val{grid-area:val;text-align:right;font:700 13.5px Inter,system-ui,sans-serif;color:#12805c}'
  + '.rc-bar{grid-area:bar;height:8px;border-radius:5px;background:#eef2f7;overflow:hidden}'
  + '.rc-bar i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#12805c,#22a06b)}'
  // Similar opportunities — 3-column compact card grid (Zillow "Similar homes").
  + '.sim-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}'
  + '@media(max-width:640px){.sim-grid{grid-template-columns:1fr 1fr}}'
  + '.sim-card{text-align:left;border:1px solid var(--line);border-radius:12px;padding:13px 13px 14px;background:#fff;cursor:pointer;transition:box-shadow .15s,border-color .15s,transform .15s;display:flex;flex-direction:column;gap:5px}'
  + '.sim-card:hover{box-shadow:0 10px 24px -10px rgba(16,24,40,.18);border-color:#c7d2e0;transform:translateY(-2px)}'
  + '.sim-sa{align-self:flex-start;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:#137a4e;background:#e7f4ee;padding:3px 8px;border-radius:5px}'
  + '.sim-sa.open{color:#6b7787;background:#eef2f7}'
  + '.sim-t{font:700 13px Inter,system-ui,sans-serif;color:var(--ink);line-height:1.32;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px}'
  + '.sim-ag{font:600 11.5px Inter,system-ui,sans-serif;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.sim-m{font:500 11px Inter,system-ui,sans-serif;color:var(--faint)}'
  // Bid-facts documents block + agency roster (BD contacts).
  + '.bf-docs{margin-top:14px;display:flex;flex-direction:column;gap:7px}'
  + '.bf-doc{font:600 13px Inter,system-ui,sans-serif;color:#006aff;text-decoration:none}'
  + '.bf-doc:hover{text-decoration:underline}'
  + '.roster-note{font:400 13px Inter,system-ui,sans-serif;color:var(--sub);margin-bottom:12px}'
  + '.roster-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
  + '@media(max-width:640px){.roster-grid{grid-template-columns:1fr}}'
  + '.roster-card{border:1px solid var(--line);border-radius:11px;padding:12px 13px}'
  + '.roster-card .nm{font:700 13.5px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.roster-card .ti{font:500 12px Inter,system-ui,sans-serif;color:var(--sub);margin:1px 0 6px}'
  + '.roster-card .row{font:500 12px Inter,system-ui,sans-serif;color:var(--sub)}'
  + '.roster-card a{color:#006aff;text-decoration:none}'
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
  + '<aside class="oppdrawer" id="oppDrawer">'
  // Zillow-style action bar: \u2039 Back to search (closes) \u00b7 Save \u00b7 Share \u00b7 Hide \u00b7 More.
  + '<div class="oppbar">'
  +   '<button class="oppbar-back" id="oppBack"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Back to search</button>'
  +   '<div class="oppbar-acts">'
  +     '<button class="oppact" id="oppSave"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>Save</span></button>'
  +     '<button class="oppact" id="oppShare"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg><span>Share</span></button>'
  +     '<button class="oppact" id="oppHide"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></svg><span>Hide</span></button>'
  +     '<button class="oppact" id="oppMore"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg><span>More</span></button>'
  +   '</div>'
  + '</div>'
  // Sticky section tabs \u2014 appear as you scroll; jump-to + active-underline follow scroll.
  + '<nav class="opptabs" id="oppTabs"></nav>'
  + '<div class="oppbody" id="oppBody"></div></aside>';

const DRAWER_JS = `<script>
(function(){
  var bd=document.getElementById('oppBd'), dr=document.getElementById('oppDrawer'), body=document.getElementById('oppBody');
  var CUR=null;
  function close(){ dr.classList.remove('show'); bd.classList.remove('show'); }
  if(bd)bd.onclick=close;
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')close(); });
  // Action bar: Back (close) · Save (→pursuits) · Share (copy link) · Hide (dismiss + hide card) · More.
  var _back=document.getElementById('oppBack'); if(_back)_back.onclick=close;
  function _auth(){ var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){} try{ var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){} return {t:t,em:em}; }
  var _save=document.getElementById('oppSave');
  if(_save)_save.onclick=function(){ if(!CUR)return; var a=_auth(); if(!a.t||!a.em){ if(confirm('Sign in to save this to your pursuits?'))location.href='/app?next=%2Fopportunity-map'; return; }
    _save.classList.add('done'); _save.querySelector('span').textContent='Saved';
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},body:JSON.stringify({noticeId:CUR.id,email:a.em,title:CUR.title,agency:CUR.department})}).catch(function(){}); };
  var _share=document.getElementById('oppShare');
  if(_share)_share.onclick=function(){ if(!CUR)return; var url=location.origin+'/opportunity-map?opp='+encodeURIComponent(CUR.id);
    var done=function(){ _share.querySelector('span').textContent='Copied!'; setTimeout(function(){ _share.querySelector('span').textContent='Share'; },1600); };
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done,function(){ prompt('Copy this link:',url); }); } else { prompt('Copy this link:',url); } };
  var _hide=document.getElementById('oppHide');
  if(_hide)_hide.onclick=function(){ if(CUR){ try{ var c=document.querySelector('.card[data-sol="'+(window.CSS&&CSS.escape?CSS.escape(CUR.sol||CUR.id):(CUR.sol||CUR.id))+'"]'); if(c)c.style.display='none'; }catch(e){} } close(); };
  var _more=document.getElementById('oppMore');
  if(_more)_more.onclick=function(){ if(CUR&&CUR.uiLink)window.open(CUR.uiLink,'_blank','noopener'); };
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function due(d){ if(!d)return ''; var n=Math.ceil((new Date(d)-new Date())/86400000); if(n<0)return 'closed'; if(n===0)return 'due today'; if(n===1)return '1 day left'; return n+' days left'; }
  function longDate(d){ if(!d)return '\\u2014'; try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){return d;} }
  // sec() now takes an optional anchor id (3rd arg) so the sticky tabs can jump to it. Every
  // section is a divider-separated block with a bold header (unified format, Zillow-style).
  function sec(title,inner,id){ return '<section class="osec"'+(id?' id="osec-'+id+'"':'')+'><div class="osec-h">'+title+'</div>'+inner+'</section>'; }
  function empty(msg){ return '<div class="osec-empty">'+msg+'</div>'; }
  // "What's special" — grey chips of the opportunity's key traits (all real fields).
  function tagsSec(o,extra){
    var tags=[];
    if(o.setAsideLabel&&o.setAsideLabel!=='Open')tags.push(o.setAsideLabel); else tags.push('Open / unrestricted');
    if(o.category)tags.push(o.category);
    if(o.noticeType)tags.push(o.noticeType);
    var bf=(extra&&extra.bidFacts)||[];
    var docs=bf.filter(function(f){return f.k==='Documents';})[0]; if(docs&&docs.v&&docs.v!=='None posted')tags.push('Docs on file');
    var poc=bf.filter(function(f){return f.k==='Contacts';})[0]; if(poc&&poc.v&&poc.v!=='None listed')tags.push(poc.v);
    if(!tags.length)return '';
    return '<div class="whatspecial">'+tags.slice(0,8).map(function(t){return '<span class="ws-tag">'+esc(t)+'</span>';}).join('')+'</div>';
  }
  // A horizontal bar (0-100) — used for the AI fit score. label + value + colored fill.
  function scoreBar(val,color){ var v=Math.max(0,Math.min(100,val||0)); return '<div class="scorebar"><i style="width:'+v+'%;background:'+color+'"></i></div>'; }
  // Horizontal bar chart for pricing (vendor $/hr). Bars scaled to the max rate.
  function rateChart(rates){
    var vals=rates.map(function(r){return r.hourly_rate||0;}); var max=Math.max.apply(null,vals.concat([1]));
    return '<div class="ratechart">'+rates.slice(0,5).map(function(r){ var pct=Math.round((r.hourly_rate||0)/max*100);
      return '<div class="rc-row"><div class="rc-lbl">'+esc(r.labor_category||'Vendor')+(r.size?' <span class="rc-sz">'+esc(r.size)+'</span>':'')+'</div>'
        + '<div class="rc-bar"><i style="width:'+Math.max(6,pct)+'%"></i></div>'
        + '<div class="rc-val">'+(r.hourly_rate?'$'+r.hourly_rate:'\\u2014')+'</div></div>'; }).join('')+'</div>';
  }

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
      + '</div>','buyer');
  }
  function clamp(id,text){
    var long=text.length>620;
    return '<div class="osec-b'+(long?' clamp':'')+'" id="'+id+'">'+esc(text)+'</div>'
      + (long?'<button class="osec-more" onclick="var b=document.getElementById(\\''+id+'\\');var c=b.classList.toggle(\\'clamp\\');this.textContent=c?\\'Show more\\':\\'Show less\\';if(c)b.scrollIntoView({block:\\'nearest\\'});">Show more</button>':'');
  }
  // Re-flow PDF-extracted text: PDFs keep hard line-breaks mid-sentence, so the raw text reads
  // as a wall of broken lines. Join wrapped lines back into sentences, split into paragraphs on
  // blank lines, and bold short ALL-CAPS / heading-like lines (e.g. "Statement of Work",
  // "Specifications") so it reads like a document, not a dump.
  function reflow(text){
    var raw=String(text||'').replace(/\\r/g,'');
    // Split into blocks on blank lines first.
    var blocks=raw.split(/\\n\\s*\\n/);
    var out=[];
    blocks.forEach(function(blk){
      var lines=blk.split('\\n').map(function(l){return l.trim();}).filter(Boolean);
      var buf='';
      lines.forEach(function(ln){
        // Heading heuristic: a short line that is a section title — ends with ':', is a known SOW
        // header, or is a numbered clause ("3.4 ...").
        var head=(ln.length<=64 && (/:$/.test(ln) || /^(SECTION|PART|SCOPE|STATEMENT OF WORK|SPECIFICATIONS|DESCRIPTION|BACKGROUND|REQUIREMENTS|DELIVERABLES|PERIOD OF PERFORMANCE|PLACE OF PERFORMANCE)/i.test(ln) || /^[0-9]+(\\.[0-9]+)*[).]?\\s+[A-Z]/.test(ln)));
        if(head){ if(buf){ out.push('<p>'+esc(buf.trim())+'</p>'); buf=''; } out.push('<p class="sow-h">'+esc(ln)+'</p>'); return; }
        // Continuation vs new sentence: if the previous buffer ends without terminal punctuation,
        // join with a space (it was a wrapped line); otherwise keep flowing.
        buf += (buf?' ':'') + ln;
      });
      if(buf)out.push('<p>'+esc(buf.trim())+'</p>');
    });
    return out.join('');
  }
  function docBody(id,text){
    var html=reflow(text);
    var long=(text||'').length>620;
    return '<div class="osec-b docbody'+(long?' clamp':'')+'" id="'+id+'">'+html+'</div>'
      + (long?'<button class="osec-more" onclick="var b=document.getElementById(\\''+id+'\\');var c=b.classList.toggle(\\'clamp\\');this.textContent=c?\\'Show more\\':\\'Show less\\';if(c)b.scrollIntoView({block:\\'nearest\\'});">Show more</button>':'');
  }
  function descSec(o){
    if(!o.synopsis)return sec('Description',empty('No description has been added to this opportunity.'),'description');
    return sec('Description',docBody('synBody',o.synopsis),'description');
  }
  function sowSec(o){
    if(!(o.sow&&o.sow.text))return '';
    return sec('Scope of work'+(o.sow.filename?' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">'+esc(o.sow.filename)+'</span>':''),docBody('sowBody',o.sow.text),'sow');
  }
  function pocCard(c){
    return '<div class="ocontact"><div class="nm">'+esc(c.name||'Contact')+'</div>'
      + (c.title?'<div class="ti">'+esc(c.title)+'</div>':'')
      + '<div class="row">'
      + (c.email?'\\u2709\\ufe0f <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'')
      + (c.email&&c.phone?' \\u00b7 ':'')+(c.phone?'\\u260e\\ufe0f '+esc(c.phone):'')
      + '</div></div>';
  }
  // Solicitation contacts — the POCs named ON THIS notice (contract specialist / KO). Sits right
  // under the scope (the "how do I respond" cluster). Distinct from the "other agency contacts to
  // network with" roster, which lives in the market-intelligence block below.
  function solContactsSec(o){
    var cs=o.contacts||[];
    if(!cs.length)return sec('Solicitation contacts',empty('No contacts are named on this notice.'),'contacts');
    var prim=cs.filter(function(c){return (c.type||'').toLowerCase()==='primary';});
    var alt=cs.filter(function(c){return (c.type||'').toLowerCase()!=='primary';});
    var inner='';
    if(prim.length)inner+='<div class="osec-sub">Primary point of contact</div>'+prim.map(pocCard).join('');
    if(alt.length)inner+='<div class="osec-sub" style="margin-top:14px">Alternative point of contact</div>'+alt.map(pocCard).join('');
    if(!prim.length&&!alt.length)inner=cs.map(pocCard).join('');
    return sec('Solicitation contacts',inner,'contacts');
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
  // Bid facts — the full fact list. Buying-organization (agency/sub-agency/office/PoP) is folded
  // in here (no more duplicate "Buying organization" section), plus attachments/notice links.
  function bidFactsSec(facts,o){
    facts=facts||[];
    // Fold buying-org facts in (dedup: keep the richer versions here, drop any dup from facts).
    var loc=(o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'');
    var org=[];
    if(o.department)org.push({k:'Department / agency',v:o.department});
    if(o.subTier)org.push({k:'Sub-agency',v:o.subTier});
    if(o.office)org.push({k:'Office',v:o.office});
    org.push({k:'Place of performance',v:loc||'Not specified'});
    var seen={}; facts.forEach(function(f){ seen[f.k]=1; });
    var merged=facts.concat(org.filter(function(f){ return !seen[f.k]; }));
    var rows=merged.map(function(f){ return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>'; }).join('');
    // Attachments + notice links (merged in from the old separate Docs section).
    var docs=[];
    if(o.additionalInfo&&o.additionalInfo.link)docs.push('<a class="bf-doc" href="'+esc(o.additionalInfo.link)+'" target="_blank" rel="noopener">\\ud83d\\udd17 Additional information</a>');
    if(o.uiLink)docs.push('<a class="bf-doc" href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">\\ud83d\\udd17 View the full notice on SAM.gov</a>');
    (o.attachments||[]).slice(0,20).forEach(function(a){ var name=(a&&a.name)||'Attachment', url=(a&&a.url)||'';
      docs.push('<a class="bf-doc" '+(url?'href="'+esc(url)+'" target="_blank" rel="noopener"':'')+'>\\ud83d\\udcc4 '+esc(name)+'</a>'); });
    var docBlock=docs.length?'<div class="bf-docs"><div class="osec-sub">Documents &amp; links</div>'+docs.join('')+'</div>':'';
    return sec('Bid facts','<div class="bf-grid">'+rows+'</div>'+docBlock,'facts');
  }
  // AI Analysis (Go/No-Go) — on-demand (it's an LLM call, Pro-gated). Reuses the existing
  // /api/analyst/bid-no-bid engine (PURSUE/WATCH/SKIP + score + why/concerns/next step).
  function aiSec(o){
    return sec('AI analysis \\u00b7 Go / No-Go',
      '<div id="aiBox"><button class="ai-run" onclick="runAI(\\''+esc(o.id)+'\\')">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M12 3l1.9 5.8H20l-4.9 3.6L17 18l-5-3.7L7 18l1.9-5.6L4 8.8h6.1z"/></svg>'
      + 'Should I bid on this? \\u2014 run AI analysis</button>'
      + '<div class="ai-note">Mindy weighs your fit vs. the requirement and gives a bid / no-bid call.</div></div>','ai');
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
          + (typeof a.score==='number'?scoreBar(a.score,col):'')
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
    var cards=sims.slice(0,6).map(function(s){
      return '<button class="sim-card" onclick="openOppDrawer(\\''+esc(s.id)+'\\')">'
        + (s.setAside?'<span class="sim-sa">'+esc(s.setAside)+'</span>':'<span class="sim-sa open">Open</span>')
        + '<div class="sim-t">'+esc(s.title)+'</div>'
        + '<div class="sim-ag">'+esc(s.agency||'')+'</div>'
        + '<div class="sim-m">'+esc([s.location,(s.deadline?'due '+s.deadline:'')].filter(Boolean).join(' \\u00b7 '))+'</div>'
        + '</button>';
    }).join('');
    return sec('Similar opportunities','<div class="sim-grid">'+cards+'</div>','similar');
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
      out+=sec('Contract history \\u00b7 who holds this now','<div class="bf-grid">'+facts.map(function(f){return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>';}).join('')+'</div>','incumbent');
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
      out+=sec('Pricing intel \\u00b7 what vendors charge here',rateChart(pr.rates)+(pr.summary?'<div class="ai-note">'+esc(pr.summary)+'</div>':''),'pricing');
    }
    return out;
  }
  // OTHER agency contacts to network with (BD roster) — NOT the solicitation POCs. Fetches the
  // agency's people from /api/app/federal-contacts (MI-token authed) and appends to the intel block.
  function loadRoster(agency){
    if(!agency)return; var box=document.getElementById('intelBox'); if(!box)return;
    var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){}
    try{ var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    if(!t||!em)return; // roster is a signed-in feature
    fetch('/api/app/federal-contacts?agency='+encodeURIComponent(agency)+'&limit=6&email='+encodeURIComponent(em),{headers:{'x-mi-auth-token':t,'x-user-email':em}})
      .then(function(r){return r.json();}).then(function(d){
        var list=(d&&(d.contacts||d.results))||[]; if(!list.length)return;
        var cards=list.slice(0,6).map(function(c){
          var nm=c.contact_fullname||c.name||'Contact', ti=c.contact_title||c.title||'', mail=c.contact_email||c.email||'', ph=c.contact_phone||c.phone||'';
          return '<div class="roster-card"><div class="nm">'+esc(nm)+'</div>'+(ti?'<div class="ti">'+esc(ti)+'</div>':'')
            + '<div class="row">'+(mail?'\\u2709\\ufe0f <a href="mailto:'+esc(mail)+'">'+esc(mail)+'</a>':'')+(mail&&ph?' \\u00b7 ':'')+(ph?'\\u260e\\ufe0f '+esc(ph):'')+'</div></div>';
        }).join('');
        var html=sec('Other contacts at this agency \\u00b7 who to network with','<div class="roster-note">People at '+esc(agency)+' to build a relationship with (beyond this notice\\u2019s POC).</div><div class="roster-grid">'+cards+'</div>','roster');
        box.insertAdjacentHTML('beforeend',html); buildTabs();
      }).catch(function(){});
  }
  // Build the sticky tab bar from the sections that are actually present (id → label).
  function buildTabs(){
    var tabs=document.getElementById('oppTabs'); if(!tabs)return;
    // Tabs follow the intentional render order (only those actually present are shown).
    var want=[['overview','Overview'],['facts','Facts'],['description','Description'],['sow','Scope'],['contacts','Contacts'],['incumbent','Incumbent'],['pricing','Pricing'],['buyer','Buyer'],['roster','Network'],['ai','Go/No-Go'],['similar','Similar']];
    var html=''; want.forEach(function(t){ if(document.getElementById('osec-'+t[0])){ html+='<button class="opptab" data-t="'+t[0]+'">'+t[1]+'</button>'; } });
    tabs.innerHTML=html;
    Array.prototype.forEach.call(tabs.querySelectorAll('.opptab'),function(b){ b.onclick=function(){ var el=document.getElementById('osec-'+b.getAttribute('data-t')); if(el){ var top=el.offsetTop-108; dr.scrollTo({top:top,behavior:'smooth'}); } }; });
    // Scroll-spy: highlight the tab of the section currently in view.
    function spy(){ var ids=Array.prototype.map.call(tabs.querySelectorAll('.opptab'),function(b){return b.getAttribute('data-t');});
      var cur=ids[0]; for(var i=0;i<ids.length;i++){ var el=document.getElementById('osec-'+ids[i]); if(el&&el.offsetTop-140<=dr.scrollTop)cur=ids[i]; }
      Array.prototype.forEach.call(tabs.querySelectorAll('.opptab'),function(b){ b.classList.toggle('on',b.getAttribute('data-t')===cur); });
      tabs.classList.toggle('hidden', dr.scrollTop<120); }
    dr.onscroll=spy; spy();
  }
  // INTENTIONAL section order (the contractor's decision journey, mirroring Zillow's tested flow):
  //  1 Snapshot (at-a-glance)  2 What's special  3 Bid facts (+ agency/office + attachments merged)
  //  4 Description  5 Scope of work  6 Solicitation contacts & documents (POCs on THIS notice)
  //  7 MARKET INTELLIGENCE group: Who holds it now · Pricing · Know your buyer + OTHER agency contacts
  //  8 AI Go/No-Go (decision tool, near bottom)  9 Similar opportunities.
  function render(o,extra){
    CUR=o;
    extra=extra||{};
    return '<section class="osec" id="osec-overview">'+snapshot(o)+tagsSec(o,extra)+'</section>'
      + bidFactsSec(extra.bidFacts,o)          // facts + agency/office + attachments (merged)
      + descSec(o)
      + sowSec(o)
      + solContactsSec(o)                       // POCs named on this notice + notice links (moved up)
      + '<div id="intelBox"><div class="intel-load">Loading market intelligence\\u2026</div></div>'
      + aiSec(o)                                // decision tool → near the bottom
      + similarSec(extra.similar)
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
      buildTabs();
      // Second, on-demand fetch for the reused-intelligence sections (fail-soft).
      fetch('/api/app/opportunity-detail?intel=1&id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(x){
        var box=document.getElementById('intelBox'); if(!box)return;
        var h=(x&&x.success)?renderIntel(x.intel):'';
        box.innerHTML=h||''; // nothing found → collapse silently (no dead section)
        buildTabs(); // intel sections (incumbent/pricing) just appeared → rebuild the tabs
        loadRoster(d.opp.department); // OTHER agency contacts to network with (BD roster)
      }).catch(function(){ var box=document.getElementById('intelBox'); if(box)box.innerHTML=''; loadRoster(d.opp.department); });
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
        if(st){ window.__homeState=st; } // exposed for the search panel's "Near me / My state" row
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
  // Deep-link: /opportunity-map?opp=<notice_id> auto-opens that opportunity's drawer (used by
  // the Share link + the Favorites page). Retries until openOppDrawer is defined.
  (function(){ try{ var m=(location.search||'').match(/[?&]opp=([^&]+)/); if(!m)return; var nid=decodeURIComponent(m[1]);
    var tries=0; (function go(){ if(window.openOppDrawer){ window.openOppDrawer(nid); } else if(tries++<40){ setTimeout(go,150); } })(); }catch(e){} })();
})();
</script>`;

// Zillow-style focused-search suggestions panel. On focus: Ask Mindy (run the query as a
// natural-language search) · Near me / My state (recenter) · Recent searches (localStorage) ·
// Saved searches (real /api/app/saved-searches). On typing (≥2 chars): NAICS/agency autocomplete
// via /api/suggest-codes. Selecting anything runs the search (sets the input + fires its input
// event, reusing the existing keyword pipeline) or recenters the map.
// Extend the template's sortRows to handle the new sort options (Newest posted, Set-aside first).
// Reassigns sortRows (shared global lexical scope) + re-renders when the sort changes.
const SORT_EXTRA_JS = `<script>(function(){
  if(typeof sortRows!=='function') return;
  var _sr=sortRows;
  sortRows=function(a,b){
    switch(F.sort){
      case 'newest': return String((b.posted||'')).localeCompare(String(a.posted||''));
      case 'setaside': { var sa=(a.set&&a.set!=='None')?0:1, sb=(b.set&&b.set!=='None')?0:1; if(sa!==sb)return sa-sb; return dueDate(a).localeCompare(dueDate(b)); }
      default: return _sr(a,b);
    }
  };
  var sel=document.getElementById('sort'); if(sel)sel.addEventListener('change',function(){ try{ if(typeof render==='function')render(); }catch(e){} });
  // Custom Zillow-style sort menu: trigger opens a white panel; picking a row sets the hidden
  // <select> value + fires its 'change' (reusing the render wiring above), updates the label + ✓.
  var wrap=document.querySelector('.sortmenu-wrap'), btn=document.getElementById('sortBtn'),
      menu=document.getElementById('sortMenu'), lbl=document.getElementById('sortBtnLabel');
  if(wrap&&btn&&menu&&sel){
    btn.onclick=function(e){ e.stopPropagation(); var open=!menu.classList.contains('show'); menu.classList.toggle('show',open); wrap.classList.toggle('open',open); };
    Array.prototype.forEach.call(menu.querySelectorAll('.sortmenu-item'),function(it){
      it.onclick=function(){ var v=it.getAttribute('data-sort');
        sel.value=v; sel.dispatchEvent(new Event('change',{bubbles:true}));           // → F.sort + render
        // Label = the item text WITHOUT the leading ✓ check span.
        if(lbl){ var t=(it.textContent||'').replace(/^\\s*\\u2713\\s*/,'').trim(); lbl.textContent=t; }
        Array.prototype.forEach.call(menu.querySelectorAll('.sortmenu-item'),function(x){ x.classList.toggle('on', x===it); });
        menu.classList.remove('show'); wrap.classList.remove('open');
      };
    });
    document.addEventListener('click',function(e){ if(!e.target.closest('.sortmenu-wrap')){ menu.classList.remove('show'); wrap.classList.remove('open'); } });
  }
})();
</script>`;

const SEARCH_PANEL_JS = `<script>(function(){
  var input=document.getElementById('zsearchInput'), panel=document.getElementById('searchPanel');
  if(!input||!panel) return;
  // The rail's "Search" item focuses the search box (opens the suggestions panel) — Zillow parity.
  var _rs=document.getElementById('railSearch'); if(_rs)_rs.onclick=function(e){ e.preventDefault(); input.focus(); };
  var RECENT_KEY='mindy_map_recent_searches';
  function esc(x){ return (x==null?'':String(x)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function getRecents(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch(e){ return []; } }
  function pushRecent(q){ q=(q||'').trim(); if(!q) return; try{ var r=getRecents().filter(function(x){return x.toLowerCase()!==q.toLowerCase();}); r.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0,6))); }catch(e){} }
  function email(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){ return ''; } }
  function open(){ panel.classList.add('show'); }
  function close(){ panel.classList.remove('show'); }
  // Run a keyword search by setting the input + firing its existing debounced handler.
  function runSearch(q){ input.value=q; pushRecent(q); input.dispatchEvent(new Event('input',{bubbles:true})); close(); }
  function jumpState(st){ try{ var c=window.__STATE_CENTROIDS && window.__STATE_CENTROIDS[st]; if(c){ map.setView(c,6); } }catch(e){} close(); }

  var ICON={ask:'<svg class="sp" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z"/><path d="M19 14l.8 2 .2.8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>',
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.3-7-11a7 7 0 0114 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star:'<svg viewBox="0 0 24 24"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9 12 3z"/></svg>',
    bldg:'<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V5a1 1 0 011-1h8a1 1 0 011 1v16M15 21V9h3a1 1 0 011 1v11"/><path d="M8 8h1M8 12h1M11 8h1M11 12h1"/></svg>' };

  function renderDefault(){
    var q=(input.value||'').trim();
    var h='';
    h+='<div class="zsp-ask" data-act="ask">'+ICON.ask+'<span>'+(q?('Ask Mindy: \\u201c'+esc(q)+'\\u201d'):'Ask Mindy \\u2014 search in plain English')+'</span></div>';
    var st=window.__homeState;
    h+='<button class="zsp-row" data-act="state" data-st="'+esc(st||'')+'">'+ICON.pin+'<span>'+(st?('Jump to '+esc(st)+' \\u2014 your state'):'Near me / my area')+'</span></button>';
    var rec=getRecents();
    if(rec.length){ h+='<div class="zsp-sep"></div><div class="zsp-h">Recent searches</div>';
      rec.forEach(function(r){ h+='<button class="zsp-row" data-act="run" data-q="'+esc(r)+'">'+ICON.clock+'<span>'+esc(r)+'</span></button>'; }); }
    // Saved searches placeholder — filled async.
    h+='<div id="zspSaved"></div>';
    panel.innerHTML=h; open(); loadSaved();
  }
  function loadSaved(){
    var em=email(); var box=document.getElementById('zspSaved'); if(!em||!box) return;
    var tok=''; try{ tok=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
    fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:{'x-mi-auth-token':tok,'x-user-email':em}})
      .then(function(r){return r.json();}).then(function(d){
        var list=(d&&d.success&&d.searches)?d.searches:[]; if(!list.length){ box.innerHTML=''; return; }
        var h='<div class="zsp-sep"></div><div class="zsp-h">Saved searches</div>';
        list.slice(0,5).forEach(function(s){ h+='<a class="zsp-row" href="/opportunity-map/saved">'+ICON.star+'<span>'+esc(s.name||'Saved search')+'</span></a>'; });
        box.innerHTML=h;
      }).catch(function(){ box.innerHTML=''; });
  }
  var acTimer=null;
  function renderAutocomplete(q){
    clearTimeout(acTimer);
    acTimer=setTimeout(function(){
      // Codes (NAICS/PSC) + agencies in parallel, both grounded in real data.
      var pCodes=fetch('/api/suggest-codes?q='+encodeURIComponent(q)+'&type=both').then(function(r){return r.json();}).catch(function(){return null;});
      var pAg=fetch('/api/agency-hierarchy?search='+encodeURIComponent(q)+'&limit=5').then(function(r){return r.json();}).catch(function(){return null;});
      Promise.all([pCodes,pAg]).then(function(a){
        var d=a[0]||{}, ad=a[1]||{};
        var res=(d&&d.results)?d.results:[];
        var ags=(ad&&ad.results)?ad.results:[];
        var h='<div class="zsp-ask" data-act="ask">'+ICON.ask+'<span>Ask Mindy: \\u201c'+esc(q)+'\\u201d</span></div>';
        if(ags.length){ h+='<div class="zsp-h">Agencies</div>';
          ags.slice(0,4).forEach(function(g){ var nm=g.name||g.shortName||''; if(!nm)return; var abbr=(g.shortName&&g.shortName!==nm)?g.shortName:''; h+='<button class="zsp-row" data-act="run" data-q="'+esc(nm)+'">'+ICON.bldg+'<span>'+esc(nm)+'</span>'+(abbr?'<span class="sub">'+esc(abbr)+'</span>':'')+'</button>'; }); }
        if(res.length){ h+='<div class="zsp-h">Codes</div>';
          res.slice(0,6).forEach(function(x){ h+='<button class="zsp-row" data-act="run" data-q="'+esc(x.code)+'"><span class="code">'+esc(x.type.toUpperCase())+' '+esc(x.code)+'</span><span class="sub">'+esc(x.name)+'</span></button>'; }); }
        if(!ags.length && !res.length){ h+='<div class="zsp-empty">Press Enter to search \\u201c'+esc(q)+'\\u201d across titles, agencies &amp; descriptions.</div>'; }
        panel.innerHTML=h; open();
      }).catch(function(){});
    },220);
  }

  input.addEventListener('focus',function(){ var q=(input.value||'').trim(); if(q.length>=2) renderAutocomplete(q); else renderDefault(); });
  input.addEventListener('input',function(){ var q=(input.value||'').trim(); if(q.length>=2) renderAutocomplete(q); else renderDefault(); });
  input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var q=(input.value||'').trim(); if(q) pushRecent(q); close(); } if(e.key==='Escape'){ close(); input.blur(); } });
  panel.addEventListener('mousedown',function(e){ // mousedown so it fires before input blur
    var el=e.target.closest('[data-act]'); if(!el){ return; } e.preventDefault();
    var act=el.getAttribute('data-act');
    if(act==='ask'){ var q=(input.value||'').trim(); if(q) runSearch(q); else input.focus(); }
    else if(act==='state'){ var st=el.getAttribute('data-st'); if(st) jumpState(st); else close(); }
    else if(act==='run'){ runSearch(el.getAttribute('data-q')||''); }
  });
  // Close on outside click.
  document.addEventListener('mousedown',function(e){ if(!e.target.closest('.zsearch')) close(); });
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
  // ⚠️ ALL string-injection into the template MUST go through repl(), which uses a function
  // replacer so special $-patterns ($, $$, $&, $`, $', $1…) in injected scripts/CSS are inserted
  // LITERALLY. A raw String.replace(a, b) reads $' in the replacement as "text after the match",
  // which silently TRUNCATED DRAWER_JS ('$'+rate) → openOppDrawer undefined → cards wouldn't open.
  // Nearly every injected const (DRAWER_JS/VIEWPORT_JS/DRAWER_HTML/ZHEAD_HTML/…) contains a $, so
  // this is the one safe way. NEVER use a bare html.replace(x, <injected string>) here.
  const repl = (h: string, search: string, replacement: string) => h.replace(search, () => replacement);
  // Make OPPS reassignable so the viewport layer can swap it (embed stays static SSR).
  let html = repl(OPPORTUNITY_MAP_TEMPLATE, 'const OPPS = __OPPS_JSON__', 'let OPPS = __OPPS_JSON__');
  html = repl(html, '__OPPS_JSON__', JSON.stringify(opps));
  if (embed) {
    html = repl(html, '</head>', EMBED_CSS + '</head>');
    html = repl(html, '</body>', EMBED_JS + '</body>');
  } else {
    // (Removed the "← Back to Mindy" link — the top nav + icon rail already have Home/Dashboard,
    // so it was leftover noise in the right-panel header. Zillow's header is title · count · sort.)
    html = repl(html, '</head>', PAGE_CSS + ZLAYOUT_CSS + DRAWER_CSS + '</head>');
    // ROOT-CAUSE fix: neutralize the TEMPLATE's own `.fscroll{overflow-x:auto}` at the source
    // (not just override it) so the clip origin is gone entirely — dropdowns are never clipped.
    // (See filter-bar-overflow.unit.test.ts for the permanent invariant.)
    html = repl(html, '.fscroll{display:flex;gap:7px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}',
      '.fscroll{display:flex;gap:7px;overflow:visible;padding-bottom:2px;scrollbar-width:none}');
    // Zillow layout: inject the icon rail + top search bar as the first children of .app
    // (the grid areas place them; VIEWPORT_JS moves the filter bar up into the top bar).
    html = repl(html, '<div class="app">', '<div class="app">' + ZHEAD_HTML + ZRAIL_HTML + ZTOP_HTML);
    // Load setColorFor right after leaflet.js (before the template's map script).
    html = repl(html, '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + EARLY_INJECT);
    // Color pins by SET-ASIDE eligibility (fixes the all-gray category mismatch).
    html = html.split('catColor(o.cat)').join('setColorFor(o)');
    // Office-vs-PoP honesty: a pin whose location is the BUYING OFFICE (SAM omitted place of
    // performance) renders HOLLOW — white fill, colored ring — so it's not read as confirmed PoP.
    html = repl(html, "color:'#ffffff',weight:2,",
      "color:o.locSrc==='office'?col:'#ffffff',weight:o.locSrc==='office'?2.5:2,");
    html = repl(html, "fillColor:col,fillOpacity:o.src==='RECOMPETE'?.72:.95",
      "fillColor:o.locSrc==='office'?'#ffffff':col,fillOpacity:o.locSrc==='office'?0.9:(o.src==='RECOMPETE'?.72:.95)");
    // Honesty label in the popup + list card.
    html = repl(html, '<div class="pvmeta"><b>${agency}</b> · ${o.loc}</div>',
      '<div class="pvmeta"><b>${agency}</b> · ${o.loc}${o.locSrc===\'office\'?\' <span style=\"color:#94a3b8\">· buying office (place of performance not specified)</span>\':\'\'}</div>');
    html = repl(html, '<span class="loc">${o.loc}</span>',
      '<span class="loc">${o.loc}${o.locSrc===\'office\'?\' · office\':\'\'}</span>');
    // Replace the native <select> with a CUSTOM Zillow-style sort menu: a blue "Sort: <label> ▾"
    // trigger that opens a clean white rounded panel of option rows (checkmark on the active one).
    // A HIDDEN <select id="sort"> is kept so SORT_EXTRA_JS's existing change→render wiring is
    // untouched; the custom menu sets its value + fires 'change'. Options are the single source.
    html = repl(html,
      '<select class="sortsel" id="sort">\n        <option value="deadline">Deadline: soonest</option>\n        <option value="deadline-far">Deadline: latest</option>\n        <option value="value">Contract value: high to low</option>\n        <option value="az">Title: A–Z</option>\n      </select>',
      SORT_MENU_HTML);
    // Set-aside color legend on the map.
    html = repl(html, '<div id="map"></div>', '<div id="map"></div>' + LEGEND_HTML);
    // "More filters" dropdown in the filter bar; drop the redundant standalone "SDVOSB only"
    // pill (the Set-aside dropdown already covers every set-aside, SDVOSB included).
    html = repl(html, '<button class="clr" id="clrAll">Clear all</button>',
      MORE_FILTERS + SAVE_SEARCH_BTN + '<button class="clr" id="clrAll">Clear all</button>');
    // Filter reorg: replace the old client-side pill row (Source / Service line /
    // Set-aside / SDVOSB / Closing≤7d) with the server-wired controls. One replace
    // spanning all five leftover buttons removes them + their throw-prone count badges.
    html = repl(html, 
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
    html = repl(html, '<div class="st"><div class="k">Win odds</div><div class="v ${o.prob===\'high\'?\'hi\':\'med\'}">${(o.prob||\'—\').replace(/^./,c=>c.toUpperCase())}</div></div>',
      '<div class="st"><div class="k">Set-aside</div><div class="v">${o.set===\'None\'?\'Open\':o.set}</div></div>');
    html = repl(html, '<div class="fld"><div class="k">Win probability</div><div class="v ${o.prob===\'high\'?\'sd\':\'\'}">${(o.prob||\'—\').replace(/^./,c=>c.toUpperCase())}</div></div>',
      '<div class="fld"><div class="k">Set-aside</div><div class="v">${o.set===\'None\'?\'Open\':o.set}</div></div>');
    // CARD (#1 Snapshot): NO action buttons on the card face (Eric). The card is the clickable
    // snapshot; Save/Draft live in the detail drawer. Card actions → a "View details →" hint.
    html = repl(html, '<a class="act" href="${samURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SAM.gov</a>',
      '<span class="viewdet">View details →</span>');
    html = repl(html, '<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Start drafting</a>', '');
    // POPUP (map-pin quick peek): ONE in-loop CTA — "Should I bid?" — which opens the detail
    // drawer and runs the Bid/No-Go analysis. NO "View on SAM" (that leaks the user off-site =
    // breaks the flywheel). Save is now the 1-click heart added to the chip row below.
    html = repl(html, '<a class="pva" href="${samURL(o)}" target="_blank" rel="noopener">View on SAM.gov</a>', '');
    html = repl(html, '<a class="pva pri" href="${draftURL(o)}" target="_blank" rel="noopener">Start drafting</a>',
      '<button class="pva pri pv-bid" onclick="window.openOppDrawer&&openOppDrawer(\'${o.nid||o.sol}\');setTimeout(function(){window.runAI&&runAI(\'${o.nid||o.sol}\');},450)">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:-2px;margin-right:6px"><path d="M12 3l1.9 5.8H20l-4.9 3.6L17 18l-5-3.7L7 18l1.9-5.6L4 8.8h6.1z"/></svg>'
      + 'Should I bid?</button>');
    // 1-click heart (top-right of the popup) → toggles Favorites via /api/opportunities/save.
    html = repl(html, '<div class="pvchips">',
      '<button class="pv-heart" data-nid="${o.nid||o.sol}" onclick="toggleFav(this)" title="Save to Favorites" aria-label="Save to Favorites"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button><div class="pvchips">');
    // Popup facts: drop the low-value "Service line" (dups the agency header) → Notice type
    // (RFP / Sources Sought — tells the contractor if/how they can respond).
    html = repl(html, '<div class="fld"><div class="k">Service line</div><div class="v">${o.cat}</div></div>`;',
      '<div class="fld"><div class="k">Notice type</div><div class="v">${o.noticeType||o.cat}</div></div>`;');
    // Card click opens the detail drawer (was: flyTo + popup). Uses the notice_id (o.nid).
    html = repl(html, 'c.onclick=()=>select(o.sol,true);', 'c.onclick=()=>openOppDrawer(o.nid||o.sol);');
    // Zillow behavior: clicking a dot opens a popup CARD on the map that STAYS until you click
    // off it. The flash was a bug — the popup opened, then moveend→fetchView rebuilt all markers
    // and destroyed it. Fix in 3 parts:
    //  (a) popup opens stable (autoClose:false so panning/other clicks don't close it; it closes
    //      only on an explicit map/other-marker click).
    html = repl(html, '.bindPopup(popupHTML(o),{maxWidth:300,closeButton:true});',
      '.bindPopup(popupHTML(o),{maxWidth:300,closeButton:true,autoClose:false,closeOnClick:false});');
    //  (b) clicking a dot opens the popup + selects (no map flyTo that would trigger a refetch).
    //      select() already calls m.openPopup(); keep it. (unchanged — left as select(o.sol,false))
    //  (c) the marker-rebuild on refetch preserves the open popup — see the render() guard in
    //      POPUP_KEEP_JS (injected below), which re-opens the selected opp's popup after a rebuild.
    // Swap the map controls: drop Fit-to-results + Terrain, add a "Draw area" button
    // (Zillow's Draw — drag a rectangle on the map to filter opportunities to inside it).
    html = repl(html, 
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
    html = repl(html, 'render();paintScore();fitView();', 'render();paintScore();');
    html = repl(html, "window.addEventListener('load',()=>{resize();setTimeout(()=>{resize();fitView();},140);});",
      "window.addEventListener('load',()=>{resize();setTimeout(()=>{resize();if(window.__mapBootView)window.__mapBootView();},160);});");
    // Viewport-driven data + dynamic header + save-to-pursuits + detail drawer + draw-area (last, after globals).
    // BOOT_VIEW_JS runs LAST so `map` + __mapRefetch already exist when it centers the view.
    // NOTE: CARD_OVERRIDE_JS intentionally NOT injected — Eric wants the ORIGINAL richer card
    // (chip row + title + agency·location + the bordered Set-aside/NAICS/Due stat grid + footer),
    // not the thinner "Zillow hook" card. The original template cardHTML renders as-is.
    // ⚠️ Use a REPLACER FUNCTION, not a string, so special replacement patterns in the injected
    // scripts ($, $$, $&, $`, $', $1…) are inserted LITERALLY. A `'$'+rate` in DRAWER_JS was being
    // read by String.replace as $' ("everything after the match"), TRUNCATING the drawer script →
    // openOppDrawer never defined → cards didn't open. Function replacers are immune to this.
    const bodyInject = DRAWER_HTML + VIEWPORT_JS + DRAW_JS + SAVE_JS + DRAWER_JS + BOOT_VIEW_JS + SEARCH_PANEL_JS + SORT_EXTRA_JS + '</body>';
    html = html.replace('</body>', () => bodyInject);
    html = html.replace('__STATE_CENTROIDS__', () => JSON.stringify(STATE_CENTROIDS));
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
