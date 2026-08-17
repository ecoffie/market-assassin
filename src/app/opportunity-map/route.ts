/**
 * GET /opportunity-map — serves Eric's evc-opportunity-map prototype VERBATIM (its exact
 * HTML/CSS/JS from template.html), with the static OPPS array swapped for LIVE opportunities.
 * We only adapt our data into the shape the prototype's JS expects; nothing about the design
 * is rebuilt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMapOpportunities, SET_GROUPS } from '@/lib/opportunities/map-data';
import { STATE_CENTROIDS } from '@/lib/geo/state-centroids';
import { INDUSTRY_PRESETS } from '@/lib/industry-presets';
import { decodeFSC } from '@/lib/codes/fsc';
import { OPPORTUNITY_MAP_TEMPLATE } from './template-html';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from './account-menu';
import { SETTINGS_DRAWER_CSS, SETTINGS_DRAWER_HTML, SETTINGS_DRAWER_JS } from './settings-drawer';

export const dynamic = 'force-dynamic';

// ?embed=1 → map only (hide the sidebar/rail/scoreboard) so the SAME map can be dropped
// full-bleed into the /home-v5 hero box. It's the real map, not a preview.
// Embed = map only, sized to the iframe (kill the 100vh/min-height:560 chain that leaves the
// map zero-height inside a shorter iframe → blank box), controls hidden.
const EMBED_CSS = '<style>html,body{height:100%!important;min-height:0!important}'
  + '.app{grid-template-columns:0 minmax(0,1fr)!important;height:100%!important;min-height:0!important}'
  // ⚠️ Measured 2026-08-15: `?embed=1` rendered a BLANK map. 7 Leaflet panes, 600 interactive
  // pins and 4 tiles were all in the DOM — but `.mapwrap` measured **width:0**, so nothing
  // painted. `invalidateSize()` (EMBED_JS below) cannot rescue a genuinely 0px-wide container,
  // which is why that existing re-measure hook never caught it.
  //
  // ROOT CAUSE — grid auto-placement, not a missing width. `.app` is a 2-column grid whose
  // FIRST child is the `.panel` sidebar; embed sets `.panel{display:none}`, and a display:none
  // grid child is removed from flow entirely, so `.mapwrap` auto-placed into COLUMN 1 — the
  // very column embed pins to `0`. (Measured: grid-template-columns computed "0px 1200px" with
  // .mapwrap sitting at 0px.) Setting a width on .mapwrap alone does NOT fix it; the track is
  // zero. So place it explicitly in column 2 and let that track carry the width.
  + '.mapwrap{grid-column:2!important;height:100%!important;width:100%!important;border:0}'
  + '#map{height:100%!important;width:100%!important}'
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
  // Title-case each word, but PRESERVE a dotted acronym (U.S., U.S.C.) — the `.`-swallowing regex
  // turned "U.S." into "U.s." (Eric 2026-08-03). Only dotted forms are protected; a plain all-caps
  // word (NAVY) still title-cases, since it's indistinguishable from an acronym by pattern alone.
  return d.replace(/\b([A-Z])([A-Z0-9'&./-]*)/g, (m, a, b) => {
    if (/^(?:[A-Z]\.){2,}$/.test(m)) return m; // U.S. / U.S.C. → keep exactly
    return a + b.toLowerCase();
  }) || dept;
}

// "More filters" dropdown (Zillow's Filters catch-all) — the long-tail filters live here, off
// the top row. Starts with the Commodity-buys toggle (no self-filtering: default SHOWS all).
// Multi-select set-aside checkboxes (by GROUP) for the deep panel.
const SETASIDE_CHECKS = SET_GROUPS
  .filter((g) => g.key !== 'NONE')
  .map((g) => `<label class="mf-chk"><input type="checkbox" class="mf-set" value="${g.key}"><i style="background:${g.color}"></i>${g.label}</label>`)
  .join('')
  // Full & Open (no set-aside) — same distinct 'OPEN' value as the top-bar dropdown → &fullOpen=1.
  + `<label class="mf-chk"><input type="checkbox" class="mf-set" value="OPEN"><i style="background:#94a3b8"></i>Full &amp; Open (no set-aside)</label>`;
// Curated top-agency list for the Agency dropdown pill. `name` = clean display; `match` = the
// substring the ilike filter uses (department/awarding_agency/department_ind_agency vary in casing +
// formatting — "DEPT OF DEFENSE", "VETERANS AFFAIRS, DEPARTMENT OF" — so we match a stable keyword).
// Ranked by real opp volume (measured on sam_opportunities 2026-07-27). The Filters-panel free-text
// Agency input covers anything not in this list (long tail).
const AGENCY_PRESETS: { name: string; match: string }[] = [
  { name: 'Department of Defense', match: 'DEFENSE' },
  { name: 'Department of Veterans Affairs', match: 'VETERANS AFFAIRS' },
  { name: 'Department of the Interior', match: 'INTERIOR' },
  { name: 'Department of Homeland Security', match: 'HOMELAND SECURITY' },
  { name: 'Department of Agriculture', match: 'AGRICULTURE' },
  { name: 'Health & Human Services', match: 'HEALTH AND HUMAN SERVICES' },
  { name: 'Department of State', match: 'STATE, DEPARTMENT' },
  { name: 'Department of Justice', match: 'JUSTICE' },
  { name: 'Department of Commerce', match: 'COMMERCE' },
  { name: 'NASA', match: 'NATIONAL AERONAUTICS' },
  { name: 'General Services Administration', match: 'GENERAL SERVICES' },
  { name: 'Department of Energy', match: 'ENERGY' },
  { name: 'Department of Transportation', match: 'TRANSPORTATION' },
  { name: 'Department of Labor', match: 'LABOR' },
  { name: 'Environmental Protection Agency', match: 'ENVIRONMENTAL PROTECTION' },
  { name: 'Department of the Treasury', match: 'TREASURY' },
];
// FSC (Federal Supply Class) presets for the DLA-map dropdown — DLA's REAL taxonomy (DIBBS is
// FSC/NSN-coded, not NAICS). The top classes by live dibbs_rfqs volume (measured 2026-07-31 over
// all 7,411 open RFQs), titled via the FSC table so the dropdown reads "5330 · Seals & Gaskets",
// not a bare code. The live count per class is fetched + shown at open time (honest, like Horizons).
const FSC_PRESETS: { code: string; title: string }[] = [
  '6515','5340','5330','4820','5310','5305','4730','5935','4720','6505',
  '5930','5306','5315','1560','3040','5331','6530','6150','5320','3120',
  '2840','4710','1650','5365','6685',
].map((code) => ({ code, title: decodeFSC(code)?.fscTitle || `FSC ${code}` }));
const NOTICE_CHECKS = [
  ['Solicitation', 'Solicitation'], ['Combined Synopsis/Solicitation', 'Combined Synopsis'],
  ['Presolicitation', 'Presolicitation'], ['Sources Sought', 'Sources Sought'], ['Special Notice', 'Special Notice'],
].map(([v, l]) => `<label class="mf-chk"><input type="checkbox" class="mf-notice" value="${v}">${l}</label>`).join('');

// Deep "More filters" panel — Zillow's advanced filter drawer. The quick pills stay on the
// top bar; the long-tail + multi-select filters live here. NAICS/PSC = the "what kind"
// (property-type) axis; set-aside & notice-type are multi-select. Value-range is mode-aware
// (real data on Recompetes; hidden on Open until the doc-scan backfills estimated value).
// Filter-parity visibility (2026-07-26): each field/section below carries a
// `mfv-<mode>` class per dataset it's WIRED for on that dataset's endpoint (see
// syncFilterVis in the client JS — hides anything the current mode's class list
// doesn't include, and hides a whole section header when every field under it is
// hidden). Matrix (column = dataset that field is honored on):
//   Which-opportunities → open only (profile scope only makes sense for the opp feed)
//   NAICS               → open, recompete (naics_code), companies (searchRecipients)
//   PSC                 → open only (recompete's psc_code measured 0% populated 2026-07-26)
//   Agency              → open, recompete, buyers (department_ind_agency/awarding_agency)
//   Sub-agency          → open, recompete (awarding_sub_agency 100% populated)
//   State               → open, recompete, companies, buyers (all real state columns)
//   Country             → open only (pop_country — no equivalent on the other 3)
//   With docs/contact   → open only (attachments/POC are opp-shaped fields)
//   Set-aside           → open, recompete (weak — set_aside_type is NULL-heavy, kept per spec), companies
//   Notice type         → open only (notice_type is a SAM-opportunity field)
//   Posted              → open only (posted_date is a SAM-opportunity field)
//   Closing within       → open only (response_deadline — no equivalent elsewhere)
//   Value range         → recompete only (real USASpending ceilings)
//   Commodity toggle    → open only (client-side FSC title filter, opp-shaped)
const MORE_FILTERS = '<div class="mfwrap">'
  + '<button class="fsel fsel-btn" id="moreBtn"><svg viewBox="0 0 24 24" class="fico"><path d="M3 5h18M7 12h10M11 19h2"/></svg>Filters<span class="fbadge" id="mfBadge" hidden></span></button>'
  + '<div class="mfpanel mfpanel-deep" id="morePanel">'
  + '<div class="mf-head"><h3>Filters</h3><button class="mf-x" id="mfClose" type="button" aria-label="Close filters"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
  + '<div class="mf-body">'
  // HORIZON toggles — the 4 opportunity categories that coexist on the Opportunities map, each a
  // show/hide chip colored by its horizon (green Open · amber Recompete · violet Forecast · green
  // Grant). All ON by default. Lives in the Filters panel (Eric 2026-07-31: it is a filter, not a
  // top-bar control). Opportunities-map only (mfv-open). Drives window.__horizons → merged fetch.
  + '<div class="mf-sec mfv-open" data-mfsec="horizons">Show on the map <em>(categories)</em></div>'
  + '<div class="mf-checks mfv-open" data-mfsec="horizons" id="hznToggles">'
  +   '<button class="hzc on" data-hz="open" style="--hzc:#22a06b" onclick="toggleHorizon(\'open\')">Open</button>'
  +   '<button class="hzc on" data-hz="recompete" style="--hzc:#b45309" onclick="toggleHorizon(\'recompete\')">Recompete</button>'
  +   '<button class="hzc on" data-hz="forecast" style="--hzc:#7c3aed" onclick="toggleHorizon(\'forecast\')">Forecast</button>'
  // Grants removed from the Horizons set (Eric 2026-08-01). The grants-map endpoint stays for now,
  // but Grants is no longer an Opportunities horizon toggle.
  + '</div>'
  // PLAYER TYPE toggles — the Players-map equivalent of the horizon chips (Eric 2026-08-01: "use the
  // same design that works great on Opportunities"). Companies + Gov Buyers coexist on one Players
  // map; each a show/hide chip (purple Companies · red Gov Buyers). Same .hzc chip look + togglePlayer
  // as the top-bar "Player type" dropdown (both drive window.__players). Players-map only.
  + '<div class="mf-sec mfv-companies mfv-buyers" data-mfsec="playertype">Show on the map <em>(player type)</em></div>'
  + '<div class="mf-checks mfv-companies mfv-buyers" data-mfsec="playertype" id="plrToggles">'
  +   '<button class="hzc on" data-plr="companies" style="--hzc:#7c3aed" onclick="togglePlayer(\'companies\')">Companies</button>'
  +   '<button class="hzc on" data-plr="buyers" style="--hzc:#dc2626" onclick="togglePlayer(\'buyers\')">Gov Buyers</button>'
  + '</div>'
  + '<div class="mf-sec mfv-open" data-mfsec="scope">Show</div>'
  + '<div class="mf-grid2 mfv-open" data-mfsec="scope">'
  +   '<label class="mf-field"><span>Which opportunities</span><select class="mf-in" id="mfScope"><option value="all">All opportunities</option><option value="profile">Matched to my profile</option></select></label>'
  + '</div>'
  + '<div class="mf-sec mfv-open mfv-recompete mfv-companies mfv-dla" data-mfsec="codes">What they buy <em>NAICS / PSC / FSC</em></div>'
  + '<div class="mf-grid2" data-mfsec="codes">'
  +   '<label class="mf-field mfv-open mfv-recompete mfv-companies"><span>NAICS</span><div class="mf-chipbox" id="mfNaicsBox"><span class="mf-chips" id="mfNaicsChips"></span><input class="mf-in mf-in-chip" id="mfNaics" placeholder="Add a code or search e.g. construction" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></div><div class="mf-ac" id="mfNaicsAc"></div><div class="mf-err" id="mfNaicsErr"></div></label>'
  +   '<label class="mf-field mfv-open"><span>PSC</span><input class="mf-in" id="mfPsc" placeholder="e.g. R408 or a word like cyber" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"><div class="mf-ac" id="mfPscAc"></div></label>'
  +   '<label class="mf-field mfv-open mfv-dla"><span>DLA Supply Class (FSC)</span><input class="mf-in" id="mfFsc" placeholder="e.g. 5330 seals, 1560 airframe · comma-sep" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></label>'
  + '</div>'
  + '<div class="mf-sec mfv-open mfv-recompete mfv-companies mfv-buyers" data-mfsec="buyer">Who&#8217;s buying</div>'
  + '<div class="mf-grid2" data-mfsec="buyer">'
  // mfv-companies added 2026-08-03: "sells-to-agency" scope shipped (searchRecipients scans
  // awards by awarding_agency/awarding_sub_agency when set) — the field is now honored for
  // Companies too, not just Buyers/Open/Recompete. Sub-agency stays Buyers/Open/Recompete-only
  // (not wired as a separate companies param); the Agency box alone matches Navy/Army/etc for
  // companies via the shared department-OR-sub_tier BQ match.
  +   '<label class="mf-field mfv-open mfv-recompete mfv-companies mfv-buyers"><span>Agency</span><input class="mf-in" id="mfAgency" placeholder="e.g. Navy" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></label>'
  // Buying office (DoDAAC) — BUYERS ONLY (mfv-buyers): a DoDAAC names a government office, so it
  // has no meaning for a company pin. Matched on the solicitation-number prefix server-side,
  // because federal_contacts.office is NULL on every row (measured 2026-08-14).
  +   '<label class="mf-field mfv-buyers"><span>Buying office</span><input class="mf-in mf-st" id="mfOffice" placeholder="DoDAAC e.g. W912PL" maxlength="6" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"><div class="mf-hint" id="mfOfficeHint">The 6-character office code that starts its solicitation numbers.</div></label>'
  +   '<label class="mf-field mfv-open mfv-recompete"><span>Sub-agency</span><input class="mf-in" id="mfSubAgency" placeholder="e.g. Army" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></label>'
  + '</div>'
  + '<div class="mf-sec mfv-open mfv-recompete mfv-companies mfv-buyers mfv-dla" data-mfsec="location">Location</div>'
  + '<div class="mf-grid2" data-mfsec="location">'
  +   '<label class="mf-field mfv-open mfv-recompete mfv-companies mfv-buyers mfv-dla"><span>State</span><input class="mf-in mf-st" id="mfState" placeholder="e.g. FL" maxlength="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"></label>'
  +   '<label class="mf-field mfv-open"><span>Country</span><select class="mf-in" id="mfCountry"><option value="">Anywhere</option><option value="us">United States</option><option value="oconus">Overseas (OCONUS)</option></select></label>'
  + '</div>'
  // WHEN — timing (posted / closing window) sits right after location, before the fit signals.
  + '<div class="mf-sec mfv-open mfv-dla" data-mfsec="timing">Timing</div>'
  + '<div class="mf-grid2" data-mfsec="timing">'
  +   '<label class="mf-field mfv-open"><span>Posted</span><select class="mf-in" id="mfPosted"><option value="">Any time</option><option value="1">Last 24 hours</option><option value="3">Last 3 days</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option></select></label>'
  // Closing window — the backend already applies `closingDays` (response_deadline <= now+N); this
  // exposes it. THE bid-planning filter: "what can I still respond to in time." Open-opp only —
  // hidden on Awarded/Companies/Buyers via .mf-closeonly (they have no response deadline).
  +   '<label class="mf-field mf-closeonly mfv-open mfv-dla"><span>Closing within</span><select class="mf-in" id="mfClosing"><option value="">Any deadline</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option></select></label>'
  + '</div>'
  // ── FIT SIGNALS — "can a small business win here?" set-aside + how-this-buyer-buys + value, now
  //    CONTIGUOUS (the GOS #11 cluster) instead of scattered across the panel. ──
  // Set-aside — Open + Companies only. NOT recompete: recompete_opportunities.set_aside_type is 100%
  // NULL (143,882/143,882 — USASpending doesn't return it; see the recompete-sync note "Type of Set
  // Aside … deliberately not mapped"), so a Set-aside filter on that dataset is a DEAD control that can
  // never match. Dropped mfv-recompete here (verified 2026-07-28 per-section audit; no-dead-controls).
  + '<div class="mf-sec mfv-open mfv-companies" data-mfsec="setaside">Set-aside <em>(any selected)</em></div>'
  + '<div class="mf-checks mfv-open mfv-companies" data-mfsec="setaside">' + SETASIDE_CHECKS + '</div>'
  // SAP-friendly BUYER (Open-only) — open opps have no contract_type, so we filter by the buying
  // agency's PO-share tier (GOS #11, sap-friendly-agencies.ts). 3 honest bands, not a toggle: the
  // PO-share is a spectrum (SSA 62% … GSA 17%), so a single cutoff would keep ~everyone.
  // How this buyer buys — Zillow single-select PILLS (Eric 2026-07-28 redesign PR3). The hidden
  // #mfSapBuyer select stays the STATE (readDeep reads .value, fetchView sends it); the pills flip it.
  + '<div class="mf-sec mfv-open" data-mfsec="buyerstyle">How this buyer buys</div>'
  + '<div class="mf-pillsel mfv-open" data-mfsec="buyerstyle" data-sel="mfSapBuyer">'
  +   '<button type="button" class="mf-pill on" data-v="">Any</button>'
  // The buying-style dots carry MEANING (green=SB-friendly, amber=somewhat, lock=vehicle-gated), so
  // they stay COLORED — but as inline SVG icons, not emoji (Eric 2026-08-05: no emoji, use icons).
  +   '<button type="button" class="mf-pill" data-v="most"><svg class="mf-pico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#22a06b"/></svg> SB-friendly</button>'
  +   '<button type="button" class="mf-pill" data-v="somewhat"><svg class="mf-pico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#e0a52e"/></svg> Somewhat</button>'
  +   '<button type="button" class="mf-pill" data-v="vehicle"><svg class="mf-pico" viewBox="0 0 24 24" fill="none" stroke="#c0392b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg> Vehicle-heavy</button>'
  + '</div>'
  + '<select class="mfv-open" id="mfSapBuyer" hidden style="display:none"><option value="">Any</option><option value="most">SB-friendly</option><option value="somewhat">Somewhat</option><option value="vehicle">Vehicle-heavy</option></select>'
  // STRATEGY FILTER (Opportunity DNA) — filter by GENOME STRAND, not by NAICS. Each checkbox is a
  // grounded strand key; checking several ANDs them (an opp must carry ALL). Backed by the persisted,
  // GIN-indexed opportunity_dna_keys, so this narrows the WHOLE corpus (Eric: "you're not filtering by
  // NAICS anymore, you're filtering by strategy"). Open-opps only (.mfv-open). readDeep reads the
  // checked boxes into FILT.strategy; fetchView sends &strategy=.
  + '<div class="mf-sec mfv-open" data-mfsec="strategy">Strategy <em>filter by how you win</em></div>'
  + '<div class="mf-strat mfv-open" data-mfsec="strategy">'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="repeat_buyer"><span>Repeat Buyer</span></label>'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="sb_friendly"><span>SB-Friendly</span></label>'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="posts_early"><span>Posts Early</span></label>'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="sources_sought"><span>Sources Sought</span></label>'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="closes_soon"><span>Closes Soon</span></label>'
  +   '<label class="mf-stratbox"><input type="checkbox" class="mf-strategy" value="set_aside"><span>Set-Aside</span></label>'
  + '</div>'
  // Recompete signals (Awarded-only) — proven, populated columns turned into filters (2026-07-27).
  // "How this buyer buys" (contract_type), recompete likelihood, and the expiring-within window.
  // All three are 99–100% populated on recompete_opportunities and DEAD on the other datasets, so
  // the whole block is .mfv-recompete (hidden on Open/Companies/Buyers — no dead controls).
  + '<div class="mf-sec mfv-recompete" data-mfsec="recompete">How this buyer buys</div>'
  + '<div class="mf-grid2 mfv-recompete" data-mfsec="recompete">'
  +   '<label class="mf-field mfv-recompete"><span>Buying style</span><select class="mf-in" id="mfSap"><option value="">Any</option><option value="friendly">SAP-friendly (purchase orders)</option><option value="gated">Vehicle-gated (delivery orders)</option></select></label>'
  +   '<label class="mf-field mfv-recompete"><span>Recompete likelihood</span><select class="mf-in" id="mfLikelihood"><option value="">Any</option><option value="high">High only</option></select></label>'
  + '</div>'
  + '<div class="mf-grid2 mfv-recompete" data-mfsec="recompete">'
  +   '<label class="mf-field mfv-recompete"><span>Expiring within</span><select class="mf-in" id="mfLead"><option value="">Any timeframe</option><option value="6">6 months</option><option value="12">12 months</option><option value="18">18 months</option></select></label>'
  + '</div>'
  // Value range — real on Recompetes (USASpending ceilings); hidden on Open until scan backfills.
  // Zillow min–max PAIR (Eric 2026-07-28 redesign PR3): two dropdowns instead of one preset-band
  // select, so a user sets an arbitrary floor/ceiling. readDeep composes FILT.valueRange="min-max"
  // (unchanged downstream — fetchView still splits it into minValue/maxValue). The old #mfValue select
  // is kept HIDDEN as a mirror target so any code still setting it keeps working.
  + '<div class="mf-sec mf-value mfv-recompete" id="mfValueSec" style="display:none">Contract value</div>'
  + '<div class="mf-range mf-value mfv-recompete" id="mfValueRange" style="display:none">'
  +   '<label class="mf-field"><span>Min</span><select class="mf-in" id="mfValueMin"><option value="">No min</option><option value="25000">$25K</option><option value="100000">$100K</option><option value="1000000">$1M</option><option value="5000000">$5M</option><option value="10000000">$10M</option><option value="25000000">$25M</option><option value="100000000">$100M</option></select></label>'
  +   '<span class="mf-dash">\\u2013</span>'
  +   '<label class="mf-field"><span>Max</span><select class="mf-in" id="mfValueMax"><option value="">No max</option><option value="1000000">$1M</option><option value="5000000">$5M</option><option value="10000000">$10M</option><option value="25000000">$25M</option><option value="100000000">$100M</option><option value="500000000">$500M</option></select></label>'
  + '</div>'
  + '<select class="mf-value mfv-recompete" id="mfValue" style="display:none" hidden></select>'
  // FORMAT — notice type (a document-format filter, moved BELOW the fit signals since it's used less
  // often than "can I win here"). Open-only.
  + '<div class="mf-sec mfv-open" data-mfsec="noticetype">Notice type <em>(any selected)</em></div>'
  + '<div class="mf-checks mfv-open" data-mfsec="noticetype">' + NOTICE_CHECKS + '</div>'
  // ── REFINE — low-frequency toggles grouped at the very bottom (checkbox "Only show" + commodity). ──
  // Refine — Zillow segmented controls (Eric 2026-07-28 redesign PR3). 2-way Any/Only only (the map
  // endpoint supports "only show" via hasDocs=1/hasContact=1, NOT exclusion — so no dead "Hide" state,
  // per the no-dead-controls rule). The hidden checkboxes remain the STATE the filter JS reads; the
  // segmented buttons just flip them, so wiring is unchanged.
  + '<div class="mf-sec mfv-open" data-mfsec="onlyshow">Refine results</div>'
  + '<div class="mf-checks" data-mfsec="onlyshow" style="flex-direction:column;gap:10px;align-items:stretch">'
  +   '<input type="checkbox" id="mfHasDocs" hidden>'
  +   '<div class="mf-trirow mfv-open"><span class="mf-trik">Documents attached</span>'
  +     '<div class="mf-seg" data-seg="mfHasDocs"><button type="button" class="mf-segb on" data-v="">Any</button><button type="button" class="mf-segb" data-v="1">Only these</button></div></div>'
  +   '<input type="checkbox" id="mfHasContact" hidden>'
  +   '<div class="mf-trirow mfv-open"><span class="mf-trik">Has a named contact</span>'
  +     '<div class="mf-seg" data-seg="mfHasContact"><button type="button" class="mf-segb on" data-v="">Any</button><button type="button" class="mf-segb" data-v="1">Only these</button></div></div>'
  + '</div>'
  + '<div class="mf-sec mfv-open" data-mfsec="refine">Refine</div>'
  + '<div class="mf-row mfv-open" data-mfsec="refine"><span>Commodity buys<br><em>parts &amp; supply micro-buys</em></span>'
  + '<button class="mf-toggle" id="fscToggle">Shown</button></div>'
  + '</div>' // /.mf-body
  + '<div class="mf-foot"><button class="mf-clear" id="mfClear">Reset all filters</button><button class="mf-apply" id="mfApply">Show results</button></div>'
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

// VALUE range pill (2026-07-27) — Zillow's price picker, modeled on the Industry/Set-aside
// pill pattern (same fsel-btn + fixed-position popover). Replaces the redundant top-bar
// Notice-type select. A live distribution HISTOGRAM (built client-side from the pins
// actually in view — never fabricated) + min/max inputs + Clear/Apply. Shown on Open +
// Awarded only (client JS hides it via .mfv-open/.mfv-recompete-style visibility — see
// syncValuePillVis in VIEWPORT_JS): Companies has no per-pin $ range control here (their $
// won isn't a comparable "ask price" axis) and Buyers have no $ at all.
const VALUE_PILL = '<div class="valwrap mfv-open mfv-recompete" id="valWrap">'
  + '<button class="fsel fsel-btn" id="valBtn" type="button"><span id="valLabel">Value</span>'
  + '<svg viewBox="0 0 11 7" width="11" height="7" style="margin-left:6px"><path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>'
  + '<div class="naicspanel valpanel" id="valPanel">'
  +   '<div class="naics-lbl">Value range</div>'
  +   '<div id="valHist"></div>'
  // Draggable range slider (Zillow): a track directly under the histogram with two handles you drag
  // instead of typing. Handles map to LOG position (same axis as the histogram). Two-way synced with
  // the Min/Max inputs. Axis labels show the low/high of the in-view distribution.
  +   '<div class="val-slider" id="valSlider">'
  +     '<div class="val-track"></div>'
  +     '<div class="val-range" id="valRangeFill"></div>'
  +     '<div class="val-knob" id="valKnobLo" role="slider" tabindex="0" aria-label="Minimum value"></div>'
  +     '<div class="val-knob" id="valKnobHi" role="slider" tabindex="0" aria-label="Maximum value"></div>'
  +   '</div>'
  +   '<div class="val-axis"><span id="valAxisLo">$0</span><span id="valAxisHi">Any</span></div>'
  +   '<div class="val-inputs">'
  // Zillow-style $-formatted price inputs (Eric 2026-08-01: "dollar values for min and max, not raw
  // numbers"). type=text (number-type can't render $ / commas); inputmode=numeric for the mobile
  // keypad. The JS formats to "$2,028,546" on set + strips $/commas on read (fmtDollar/parseDollar).
  +     '<label class="val-in-wrap"><span>Min</span><input type="text" inputmode="numeric" class="naics-in val-in" id="valMin" placeholder="No min"></label>'
  +     '<span class="val-dash">–</span>'
  +     '<label class="val-in-wrap"><span>Max</span><input type="text" inputmode="numeric" class="naics-in val-in" id="valMax" placeholder="No max"></label>'
  +   '</div>'
  +   '<div class="sasel-foot"><button type="button" class="sasel-clr" id="valClr">Clear</button><button type="button" class="sasel-apply" id="valApply">Apply</button></div>'
  + '</div>'
  + '</div>';
const SERVER_FILTERS =
    // Dataset dropdown = the STATE selector (Zillow's "For Sale ▾"). 4 FLAT choices (2026-07-26):
    // Open · Awarded · Companies · Gov Buyers. The old Companies|Buyers segmented sub-toggle is
    // gone — it kept landing in awkward spots (filter row → under the count → cut off as "Bu…").
    // Each is switched the same way as Open/Awarded, no sub-control.
    // Dataset dropdown = the SUB-LAYER picker within the active map (Eric 2026-07-30, two-map nav).
    // Grouped into the two maps so it mirrors the top nav: Opportunities (the work — Active +
    // Recompetes; Forecast lands here when wired) vs Players (the people — Companies + Gov Buyers).
    // The top nav switches maps; this dropdown switches the layer inside one. optgroups are the
    // native, zero-JS way to show that grouping (setMapMode wiring is unchanged).
    // The dataset dropdown now switches between the two MAPS: Opportunities (all 4 horizons at once,
    // toggled by the horizon chips below) vs Players (Companies / Gov Buyers). Within Opportunities
    // you no longer SWITCH horizon here — the chips toggle each on/off on ONE map (Eric 2026-07-31,
    // map1_two_axis_pin_system: 4 categories coexist, color-distinguished). 'open' is the canonical
    // Opportunities mode; the chips drive window.__horizons.
    // Three flat options — no optgroup category titles/subtitles (Eric 2026-08-01: they read as
  // greyed dead rows; the three modes are self-explanatory). Opportunities · Players · DLA.
  '<select class="fsel fsel-mode" id="fltDataset" title="What to explore" onchange="onDatasetChange(this.value)">'
  +   '<option value="open" selected>Opportunities</option>'
  // ONE Network entry — Companies + Gov Buyers COEXIST on one map, toggled by the Network dropdown.
  // (User-facing name is "Players"; the value stays "companies" so no mode wiring changes.)
  +   '<option value="companies">Players</option>'
  // DLA — the 3rd top-level map (the "bid" client: price NSN parts, quote on DIBBS).
  +   '<option value="dla">DLA Supply Bids</option>'
  + '</select>'
  // HORIZONS multi-select dropdown — Zillow's "Home Type ▾" pattern (one control on the bar, opens
  // to colored checkboxes for the 4 categories, each with its REAL count). Replaces the loose pills
  // (Eric 2026-07-31: keep the bar clean, Zillow-style; and the count must be honest — the popover
  // shows totalForFilters per horizon, never the 1,000 pin cap). Opportunities-map only (mfv-open).
  // All checked by default; uncheck to hide; last-checked sticky. window.__horizons + toggleHorizon.
  + '<div class="hznwrap mfv-open" id="hznWrap">'
  +   '<button class="fsel fsel-mode" id="hznBtn" type="button" title="Which categories to show" aria-haspopup="true" aria-expanded="false">Horizons</button>'
  +   '<div class="hznpop" id="hznPop" role="menu" hidden>'
  +     '<button class="hznrow on" data-hz="open" style="--hzc:#22a06b" onclick="toggleHorizon(\'open\')"><i></i><span class="hznlbl">Open</span><span class="hznn" data-hzn="open"></span></button>'
  +     '<button class="hznrow on" data-hz="recompete" style="--hzc:#b45309" onclick="toggleHorizon(\'recompete\')"><i></i><span class="hznlbl">Recompete</span><span class="hznn" data-hzn="recompete"></span></button>'
  +     '<button class="hznrow on" data-hz="forecast" style="--hzc:#7c3aed" onclick="toggleHorizon(\'forecast\')"><i></i><span class="hznlbl">Forecast</span><span class="hznn" data-hzn="forecast"></span></button>'
  +   '</div>'
  + '</div>'
  // PLAYERS multi-select dropdown — Companies + Gov Buyers coexist on ONE Players map (same pattern
  // + look as Horizons). companies=purple, buyers=red pins. Players-map only (mfv-companies). Both
  // checked by default; last-checked sticky. Drives window.__players. (Eric 2026-07-31.)
  + '<div class="hznwrap mfv-companies" id="plrWrap" style="display:none">'
  +   '<button class="fsel fsel-mode" id="plrBtn" type="button" title="Which players to show" aria-haspopup="true" aria-expanded="false">Player type</button>'
  +   '<div class="hznpop" id="plrPop" role="menu" hidden>'
  +     '<button class="hznrow on" data-plr="companies" style="--hzc:#7c3aed" onclick="togglePlayer(\'companies\')"><i></i><span class="hznlbl">Companies</span><span class="hznn" data-plrn="companies"></span></button>'
  +     '<button class="hznrow on" data-plr="buyers" style="--hzc:#dc2626" onclick="togglePlayer(\'buyers\')"><i></i><span class="hznlbl">Gov Buyers</span><span class="hznn" data-plrn="buyers"></span></button>'
  +   '</div>'
  + '</div>'
  // FSC supply-class dropdown — DLA-mode's filter (replaces the removed Source dropdown). DLA/DIBBS
  // is coded by FSC (Federal Supply Class), NOT NAICS — so in DLA mode this slot shows FSC classes
  // where Opportunities/Players show Industry(NAICS). Multi-select checkbox popover (same pattern +
  // look as Horizons/Players/Industry), each row a real supply class with its live count. Rows are
  // filled from __FSC_PRESETS__ (top DLA classes by count, with titles). DLA-map only (mfv-dla).
  // Drives window.__fscFilter → &fsc=... on the fetch. (Eric 2026-07-31 — the "find bids I can make".)
  + '<div class="hznwrap mfv-dla" id="fscWrap" style="display:none">'
  +   '<button class="fsel fsel-mode" id="fscBtn" type="button" title="Which supply classes (FSC)" aria-haspopup="true" aria-expanded="false">Supply class</button>'
  +   '<div class="hznpop hznpop-scroll" id="fscPop" role="menu" hidden></div>'   // rows injected from __FSC_PRESETS__ on first open
  + '</div>'
  // Notice type moved OFF the top bar (2026-07-27) — it already lives in the Filters panel as
  // multi-select checkboxes (NOTICE_CHECKS, .mf-notice → FILT.noticeMulti), so the top-bar
  // single-select was a redundant SECOND control for the same field. Filtering still works
  // exactly as before via the Filters panel; only the duplicate pill is gone.
  // VALUE range pill (Zillow-style price picker) replaces it — see VALUE_PILL below.
  + VALUE_PILL
  // Set-aside = a MULTI-select checkbox dropdown (Zillow's "Property type" — pick several).
  // AGENCY dropdown — the buying agency ("who's buying"), the natural pair to Industry ("what").
  // (Eric 2026-07-27: replaced the top-bar Set-aside pill with something more valuable; set-aside now
  // lives ONLY in the Filters panel.) Picking an agency sets FILT.agency (already wired end-to-end,
  // ilike on department/awarding_agency/department_ind_agency per dataset). Curated top-agency list
  // injected as __AGENCY_PRESETS__ (display name + the ilike match substring). Filter-panel Agency
  // free-text input stays for the long tail.
  // AGENCY multi-select — Zillow checkbox dropdown, SAME pattern + all-checked default as Industry
  // (Eric 2026-08-01: it's the whole map, so start with everything selected, then deselect). Check any
  // set of buying agencies; their preset match-needles pipe-join into FILT.agency (OR'd across all 3
  // sources by agencyOrExpr). ALL-checked (or none) = NO filter = the true whole map (agencies outside
  // the ~16 presets aren't hidden). A strict subset narrows. "Deselect all"/"Select all" + Apply.
  + '<div class="hznwrap" id="agencyWrap">'
  +   '<button class="fsel fsel-mode" id="agencyBtn" type="button" aria-haspopup="true" aria-expanded="false"><span id="agencyLabel">Agency</span></button>'
  +   '<div class="hznpop hznpop-scroll indpop" id="agencyPop" role="menu" hidden>'
  +     '<div class="indhdr"><span class="indhdr-t">Buying agency</span><button type="button" class="indhdr-clr" id="agencyDeselect">Deselect all</button></div>'
  +     '<div class="indrows" id="agencyList"></div>'   // .hznrow checkbox rows injected from __AGENCY_PRESETS__ on first open
  +     '<div class="indfoot"><span class="ind-hint">Specific office / sub-agency? Use <b>Filters</b>.</span><button type="button" class="indapply" id="agencyApply">Apply</button></div>'
  +   '</div>'
  + '</div>'
  // NAICS / Industry pill (replaces the old "Any deadline" — the contractor's #1 filter).
  // INDUSTRY dropdown — the human primary selector (Eric 2026-07-27: real people say "I do
  // construction / I'm a manufacturer", not "I do 238220"). Picking an industry expands its NAICS
  // codes (from INDUSTRY_PRESETS, injected as __INDUSTRY_PRESETS__) into the existing FILT.naics
  // param under the hood — zero new backend. Code-specific NAICS/PSC live in the Filters panel now
  // (not here) — this replaces the old redundant "NAICS or PSC code" pill.
  // INDUSTRY multi-select — Zillow "Home Type" checkbox dropdown (Eric 2026-08-01: "look at zillow
  // format with the checkboxes so people can uncheck"). Same .hznpop/.hznrow big-blue-checkbox
  // pattern as Horizons/Players/FSC, but MULTI-select: check any set of industries and their NAICS
  // codes OR together into FILT.naics on Apply. Header "Deselect all" toggle + Apply footer. Rows
  // built lazily from __INDUSTRY_PRESETS__ (name/codes/description). Opportunities/Players only —
  // hidden in DLA mode (FSC replaces it). NOTHING is checked by default (opt-in filter).
  + '<div class="hznwrap" id="naicsWrap">'
  +   '<button class="fsel fsel-mode" id="naicsBtn" type="button" aria-haspopup="true" aria-expanded="false"><span id="naicsLabel">Industry</span></button>'
  +   '<div class="hznpop hznpop-scroll indpop" id="naicsPop" role="menu" hidden>'
  // No "Deselect all" control: the "All industries" row at the top of the list IS the clear, and it
  // says what clearing MEANS instead of describing the gesture.
  +     '<div class="indhdr"><span class="indhdr-t">Industry</span></div>'
  +     '<div class="indrows" id="indList"></div>'   // .hznrow checkbox rows injected from __INDUSTRY_PRESETS__ on first open
  // No Apply button: filtering is live (Eric 2026-08-13 — "This is a map. The whole magic is
  // immediate exploration"). The footer hint STAYS — it draws the line the whole control depends
  // on: Industry = browse in human language, Filters = exact NAICS/PSC.
  +     '<div class="indfoot"><span class="ind-hint">Exact NAICS/PSC? Use <b>Filters</b>.</span></div>'
  +   '</div>'
  + '</div>';
// Agency + State moved OFF the top row into the deep panel (Zillow keeps the bar to a
// few uniform dropdown pills; long-tail text filters live inside "Filters").

// Companies / Buyers segmented control — REMOVED (2026-07-26). It kept getting shoved into
// awkward spots (top filter row → under the result count → cut off as "Bu…"). Companies and
// Gov Buyers are now first-class datasets in the dropdown itself (SERVER_FILTERS above), same
// as Open/Awarded — no sub-toggle to relearn.

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
  // Active-filter COUNT badge (Zillow: "Filters ③") — a small blue pill on the Filters button so the
  // user sees at a glance HOW MANY filters are active, not just that some are. Hidden at 0.
  + '.fbadge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:20px;background:#006aff;color:#fff;font:700 10.5px ui-monospace,Menlo,monospace;margin-left:2px}'
  + '.fbadge[hidden]{display:none}'
  // Dataset pill = Zillow\'s bold blue "For sale ▾". Always emphasized (it\'s the primary toggle).
  + '.fsel-mode{border-color:#006aff;color:#006aff;background-color:#f0f6ff;font-weight:700;'
  + 'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'11\' height=\'7\' viewBox=\'0 0 11 7\'><path d=\'M1 1l4.5 4.5L10 1\' stroke=\'%23006aff\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/></svg>")}'
  + '.fsel-mode:hover{border-color:#006aff;background-color:#e6f0ff}'
  // Horizon toggle chips — the 4 opportunity categories that coexist on the Opportunities map.
  // Each carries its horizon color (--hzc); ON = filled dot + bold, OFF = muted/struck. They live in
  // the Filters panel's "Show on the map" section (Eric 2026-07-31 — a filter, not a top-bar control).
  + '.hzc{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:700;height:40px;padding:0 12px;'
  + 'border:1.5px solid #e3e6eb;border-radius:8px;background:#fff;color:#9aa0aa;cursor:pointer;display:inline-flex;'
  + 'align-items:center;gap:7px;transition:all .12s;white-space:nowrap}'
  + '.hzc::before{content:"";width:9px;height:9px;border-radius:50%;background:#c8ccd2;flex:none}'
  + '.hzc.on{color:#2a2a33;border-color:var(--hzc);background:color-mix(in srgb,var(--hzc) 8%,#fff)}'
  + '.hzc.on::before{background:var(--hzc)}'
  + '.hzc:not(.on){text-decoration:line-through;opacity:.7}'
  + '.hzc:hover{border-color:var(--hzc)}'
  // HORIZONS dropdown (Zillow "Home Type ▾" multi-select) — one button on the bar, a popover of 4
  // colored-checkbox rows each with its REAL count. (Eric 2026-07-31.)
  + '.hznwrap{position:relative;flex:none}'
  + '#hznBtn{padding-right:30px;'
  + 'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'11\' height=\'7\' viewBox=\'0 0 11 7\'><path d=\'M1 1l4.5 4.5L10 1\' stroke=\'%23006aff\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/></svg>");'
  + 'background-repeat:no-repeat;background-position:right 11px center}'
  // position:FIXED (not absolute) — same escape hatch as .saselpanel. Absolute popovers were
  // clipped by .app{overflow:hidden} + (on phones) any overflow on .ztop, so Agency / Industry /
  // Horizons "opened" in the DOM but painted at 0 visible height. JS (__placeHznPop) pins top/left
  // to the trigger's getBoundingClientRect on every open AND caps max-height to the remaining
  // viewport so long lists scroll instead of running off-screen.
  + '.hznpop{position:fixed;top:0;left:0;z-index:3000;background:#fff;border:1px solid #e3e6eb;border-radius:12px;'
  + 'box-shadow:0 12px 32px rgba(20,24,40,.16);padding:6px;min-width:230px;display:flex;flex-direction:column;gap:2px;'
  + 'box-sizing:border-box;-webkit-overflow-scrolling:touch}'
  // FSC (flat list of rows): the pop itself scrolls. Cap comes from __placeHznPop maxHeight.
  + '.hznpop-scroll{overflow-y:auto;min-width:270px;overscroll-behavior:contain}'
  // Agency/Industry: header + footer stay put; ONLY .indrows scrolls (nested scroll on the outer
  // .hznpop-scroll used to fight the inner list and leave items unreachable on phones).
  + '.indpop.hznpop-scroll{overflow:hidden}'
  + '.indpop{min-width:300px;max-width:min(340px,92vw);padding:6px}'
  // THE ACTUAL BUG (Eric 2026-07-31 "horizons still does not close"): .hznpop sets display:flex, which
  // OVERRIDES the browser's default [hidden]→display:none. So the JS set pop.hidden=true (my headless
  // test read the attribute and reported "closed") but the element STAYED VISIBLE because display:flex
  // won. This makes [hidden] actually hide it. The close logic was fine all along.
  + '.hznpop[hidden]{display:none}'
  + '.hznrow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;border:0;background:transparent;'
  + 'border-radius:8px;cursor:pointer;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:600;color:#2a2a33;text-align:left}'
  + '.hznrow:hover{background:#f4f6f9}'
  + '.hznrow i{width:16px;height:16px;border-radius:5px;border:2px solid #c8ccd2;background:transparent;flex:none;box-sizing:border-box;position:relative}'
  + '.hznrow.on i{background:var(--hzc);border-color:var(--hzc)}'
  + '.hznrow.on i::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}'
  + '.hznrow:not(.on){color:#9aa0aa}'
  + '.hznlbl{flex:1}'
  + '.hznn{font-family:var(--mono,ui-monospace,monospace);font-size:12px;font-weight:700;color:#6b7280;font-variant-numeric:tabular-nums}'
  + '.hznrow:not(.on) .hznn{color:#c8ccd2}'
  // FSC rows start UNCHECKED (empty = all classes), so the Horizons "off = greyed" styling made the
  // whole list look DISABLED. In the FSC popover an unchecked row is a normal clickable choice —
  // keep full-contrast text + a visible empty checkbox; only the tick differs on/off. (Eric 2026-08-01.)
  + '#fscPop .hznrow:not(.on){color:var(--ink,#111c26)}'
  + '#fscPop .hznrow i{border-color:#98a2b3}'
  // Save search — Zillow's solid-blue anchor button on the bar.
  + '.savesearch{font-family:Inter,system-ui,sans-serif;font-size:14.5px;font-weight:700;color:#fff;background:#006aff;'
  + 'border:0;border-radius:8px;height:40px;padding:0 18px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:filter .15s}'
  + '.savesearch:hover{filter:brightness(.94)}.savesearch svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2}'
  // Set-aside multi-select dropdown (Zillow "Property type"): position:FIXED so it ESCAPES the
  // .fscroll overflow-x:auto clip (an absolute panel inside it blanked the bar). Big blue checks.
  + '.saselwrap{position:relative;flex:none}'
  + '#saselBtn{display:inline-flex;align-items:center}'
  + '#saselBtn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  + '.agencywrap{position:relative;flex:none}'
  + '#agencyBtn{display:inline-flex;align-items:center}'
  + '#agencyBtn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
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
  // Industry dropdown list (replaces the old code input)
  + '.indpanel{min-width:340px;max-width:380px}'
  + '.ind-list{max-height:52vh;overflow-y:auto;margin:-2px -4px 4px;display:flex;flex-direction:column}'
  + '.ind-row{display:flex;flex-direction:column;gap:1px;text-align:left;background:none;border:0;border-radius:9px;padding:9px 10px;cursor:pointer;font:inherit}'
  + '.ind-row:hover{background:var(--wash)}'
  + '.ind-row.sel{background:#f0f6ff}'
  + '.ind-row .ind-nm{font:700 14px Inter;color:var(--ink)}'
  + '.ind-row.sel .ind-nm{color:#006aff}'
  + '.ind-row .ind-desc{font:400 12px Inter;color:var(--sub)}'
  + '.naics-in{width:100%;border:1.5px solid #c7d0dc;border-radius:10px;height:46px;padding:0 14px;font:600 16px Inter;outline:none}'
  + '.naics-in:focus{border-color:#006aff;box-shadow:0 0 0 3px rgba(0,106,255,.12)}'
  + '.naics-hint{font:500 12.5px Inter;color:var(--faint);margin-top:9px}'
  // Industry multi-select (Zillow checkbox dropdown) — layered on the shared .hznpop/.hznrow look.
  + '#naicsBtn.on{border-color:#006aff;color:#006aff}'
  + '.indhdr{display:flex;align-items:center;justify-content:space-between;padding:4px 7px 6px;border-bottom:1px solid #eef1f5;margin-bottom:4px;flex:none}'
  + '.indhdr-t{font:800 13px Inter;color:var(--ink)}'
  + '.indhdr-clr{background:none;border:0;color:#006aff;font:700 12.5px Inter;cursor:pointer;padding:2px 4px}'
  + '.indhdr-clr:hover{text-decoration:underline}'
  // flex:1 + min-height:0 is what lets the list scroll inside a max-height-capped fixed pop.
  + '.indrows{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}'
  + '.indrows .hznrow{align-items:flex-start}'
  + '.indrows .hznrow .indwrap{display:flex;flex-direction:column;gap:1px;min-width:0}'
  + '.indrows .hznrow .ind-desc{font:400 12px Inter;color:var(--sub);white-space:normal}'
  + '.indfoot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 7px 3px;border-top:1px solid #eef1f5;margin-top:4px;flex:none}'
  + '.ind-hint{font:500 12px Inter;color:var(--faint)}'
  + '.indapply{background:#006aff;border:0;color:#fff;font:700 14px Inter;cursor:pointer;padding:9px 20px;border-radius:10px;flex:none}'
  + '.indapply:hover{filter:brightness(.94)}'
  // VALUE range pill (Zillow price picker) — same fixed-popover pattern as Industry/Set-aside.
  + '.valwrap{position:relative;flex:none}'
  + '#valBtn{display:inline-flex;align-items:center}'
  + '#valBtn.hasfilt{border-color:#006aff;color:#006aff;background-color:#f0f6ff}'
  + '.valpanel{min-width:300px;max-width:320px}'
  // Distribution histogram — plain CSS bars (mirrors the M-Estimate .vr-chart pattern).
  + '.val-hist-lab{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:#5b6b7a;margin:2px 0 8px}'
  + '.val-hist{display:flex;align-items:flex-end;gap:2px;height:52px;margin-bottom:0}'
  + '.val-bar{flex:1;background:#c9dfd2;border-radius:2px 2px 0 0;min-height:2px}'
  + '.val-hist-none{font:500 12.5px Inter;color:var(--faint);margin-bottom:14px}'
  // Draggable range slider (Zillow): track flush under the histogram, filled range between two knobs.
  + '.val-slider{position:relative;height:22px;margin:2px 10px 0}'
  + '.val-track{position:absolute;top:9px;left:0;right:0;height:4px;border-radius:2px;background:#dfe4ea}'
  + '.val-range{position:absolute;top:9px;height:4px;border-radius:2px;background:var(--jan)}'
  + '.val-knob{position:absolute;top:0;width:22px;height:22px;margin-left:-11px;border-radius:50%;background:#fff;'
  + 'border:1.5px solid var(--jan);box-shadow:0 1px 4px rgba(16,24,40,.22);cursor:grab;touch-action:none;z-index:2}'
  + '.val-knob:active{cursor:grabbing;box-shadow:0 0 0 5px rgba(59,130,246,.15),0 1px 4px rgba(16,24,40,.22)}'
  + '.val-knob:focus{outline:none;box-shadow:0 0 0 4px rgba(59,130,246,.28)}'
  + '.val-axis{display:flex;justify-content:space-between;font:600 12px Inter;color:var(--sub);margin:6px 0 14px}'
  + '.val-inputs{display:flex;align-items:flex-end;gap:10px}'
  + '.val-in-wrap{flex:1;display:flex;flex-direction:column;gap:5px}'
  + '.val-in-wrap span{font:600 11.5px Inter;color:var(--sub)}'
  + '.val-in{height:42px;font-size:14.5px}'
  + '.val-dash{color:var(--faint);font-weight:600;padding-bottom:11px}'
  // Deep "More filters" panel — Zillow-style roomy mega-panel: WIDE, generous vertical spacing,
  // bold group headers, large inputs, and a sticky Reset/Apply footer bar. (Eric 2026-07-26: our
  // filters must match Zillow — wider, larger spacing, centered feel, not a cramped 320px column.)
  + '.mfpanel-deep{width:min(660px,92vw);max-height:80vh;overflow-y:auto;padding:0;border-radius:16px;box-shadow:0 24px 60px -12px rgba(16,24,40,.34),0 0 0 1px rgba(16,24,40,.05)}'
  // Panel header — a titled bar so the modal reads as a contained "Filters" surface (Zillow), not a
  // floating slab. Sticky so it stays while the body scrolls.
  + '.mf-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:18px 26px 14px;background:#fff;border-bottom:1px solid var(--hair)}'
  + '.mf-head h3{font:800 18px Inter,system-ui,sans-serif;letter-spacing:-.02em;color:var(--ink)}'
  + '.mf-head .mf-x{width:32px;height:32px;border-radius:8px;border:0;background:none;color:var(--faint);cursor:pointer;display:grid;place-items:center}'
  + '.mf-head .mf-x:hover{background:var(--wash);color:var(--ink)}'
  + '.mf-head .mf-x svg{width:18px;height:18px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}'
  // scroll body gets its own padding so the sticky footer can sit flush at the bottom edge.
  + '.mf-body{padding:8px 26px 10px}'
  // ── DESIGN PASS (2026-07-27): ONE consistent type scale + a single spacing rhythm, so every
  //    group and every field reads the same. Three tiers only: group header · field label · input.
  //    A GROUP is one .mf-sec header + its following field container(s). Groups are separated by a
  //    uniform top-margin + hairline divider; fields inside a group share ONE gap. (Fixed: mixed
  //    label sizes + the "clumped" Expiring-within row that had a -2px collapse jammed under its
  //    sibling grid — Eric.) ──
  // GROUP HEADER — 14px/700 ink, its inline note (em) a matched 13px/500 faint (never italic-mystery).
  + '.mfpanel-deep .mf-sec{font:700 14px Inter,system-ui,sans-serif;text-transform:none;letter-spacing:-.005em;color:var(--ink);margin:22px 0 12px;padding-top:20px;border-top:1px solid var(--hair);display:flex;align-items:baseline;gap:8px}'
  + '.mfpanel-deep .mf-sec:first-child{margin-top:0;padding-top:4px;border-top:0}'
  + '.mfpanel-deep .mf-sec em{font:500 13px Inter,system-ui,sans-serif;font-style:normal;letter-spacing:0;color:var(--faint)}'
  // Per-section help chip (Zillow's "Help" per group, redesign PR4) — a small "?" with a native
  // tooltip. Injected from a per-section lookup so each header gets a one-line plain-language explainer.
  + '.mf-q{width:16px;height:16px;flex:none;border-radius:50%;border:1px solid var(--line);color:var(--faint);font:700 10px ui-monospace,Menlo,monospace;display:inline-flex;align-items:center;justify-content:center;cursor:help;align-self:center}'
  + '.mf-q:hover{border-color:var(--jan);color:var(--jan)}'
  // FIELD CONTAINERS in one group flow with a uniform gap (a group can have 1–2 grid rows, e.g.
  // How-this-buyer-buys: they no longer collide). The header-to-first-field gap is the header margin.
  + '.mfpanel-deep .mf-grid2 + .mf-grid2,.mfpanel-deep .mf-checks + .mf-grid2,.mfpanel-deep .mf-grid2 + .mf-checks{margin-top:14px}'
  + '.mf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px}'
  // FIELD LABEL — 13px/600 ink, consistent everywhere; the input sits 6px below.
  + '.mf-field{display:flex;flex-direction:column;gap:6px;position:relative}.mf-field span{font:600 13px Inter,system-ui,sans-serif;color:var(--ink);line-height:1.2}'
  // Code autocomplete inside the deep panel. The panel itself is overflow-y:auto, so an
  // absolutely-positioned dropdown would CLIP at the panel edge — this list is therefore
  // in-flow (it pushes the grid down) rather than floating. Capped + scrollable so a broad
  // query can't push Apply off-screen.
  + '.mf-ac{border:1px solid var(--line);border-top:0;border-radius:0 0 10px 10px;background:#fff;max-height:190px;overflow-y:auto;margin-top:-4px}'
  + '.mf-ac:empty{display:none;border:0}'
  + '.mf-ac button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;padding:9px 12px;cursor:pointer;font:500 13px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.mf-ac button:hover,.mf-ac button.on{background:var(--wash)}'
  + '.mf-ac .c{font:600 12px "IBM Plex Mono",monospace;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:5px;flex:none}'
  + '.mf-ac .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sub)}'
  // INPUT / SELECT — one uniform 44px control (Zillow's inputs are consistent height + weight). A
  // custom caret on selects (native arrow removed) so text inputs and dropdowns look like one family.
  + '.mf-in{font:500 14px Inter,system-ui,sans-serif;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:10px;padding:0 14px;height:44px;width:100%;outline:none;transition:border-color .12s,box-shadow .12s}'
  + '.mf-in:hover{border-color:#c7d2e0}'
  + '.mf-in:focus{border-color:var(--jan);box-shadow:0 0 0 3px rgba(59,130,246,.12)}'
  + '.mf-in.mf-st{text-transform:uppercase}'
  // NAICS chip input: resolved codes render as chips; the text input is only for TYPING.
  // The chipbox mimics .mf-in so the field looks unchanged until codes are added.
  + '.mf-chipbox{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:44px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:5px 8px;transition:border-color .12s,box-shadow .12s;cursor:text}'
  + '.mf-chipbox:hover{border-color:#c7d2e0}'
  + '.mf-chipbox.on{border-color:var(--jan);box-shadow:0 0 0 3px rgba(59,130,246,.12)}'
  + '.mf-chipbox.bad{border-color:var(--con);box-shadow:0 0 0 3px rgba(239,68,68,.12)}'
  + '.mf-chips{display:contents}'
  + '.mf-chip{display:inline-flex;align-items:center;gap:6px;background:var(--wash);border:1px solid var(--line);border-radius:999px;padding:3px 6px 3px 10px;font:600 13px "IBM Plex Mono",ui-monospace,monospace;color:var(--ink);white-space:nowrap}'
  + '.mf-chip b{font:600 13px "IBM Plex Mono",ui-monospace,monospace}'
  + '.mf-chip i{font:500 12px Inter,system-ui,sans-serif;color:var(--sub);font-style:normal;max-width:150px;overflow:hidden;text-overflow:ellipsis}'
  + '.mf-chip button{border:0;background:none;cursor:pointer;color:var(--faint);font:600 15px Inter,system-ui,sans-serif;line-height:1;padding:0 2px;border-radius:50%}'
  + '.mf-chip button:hover{color:var(--con)}'
  + '.mf-in-chip{border:0!important;height:32px!important;padding:0 4px!important;width:auto!important;flex:1 1 90px;min-width:90px;box-shadow:none!important;background:transparent}'
  + '.mf-err{font:500 12px Inter,system-ui,sans-serif;color:var(--con);min-height:0;line-height:1.35}'
  + '.mf-err:not(:empty){margin-top:2px}'
  + '.mf-hint{font:500 12px Inter,system-ui,sans-serif;color:var(--sub);line-height:1.35;margin-top:2px}'
  // Upcoming-events block (opportunity drawer). Compact by default; the match label is always
  // visible so a department-wide event is never mistaken for this solicitation's own.
  + '.evhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap}'
  + '.evcount{font:700 14px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.evwhy{font:600 11px Inter,system-ui,sans-serif;color:var(--sub);background:var(--wash);border:1px solid var(--line);border-radius:999px;padding:2px 8px;white-space:nowrap}'
  + '.evlist{display:flex;flex-direction:column;gap:8px}'
  + '.evlist.evmany{max-height:196px;overflow-y:auto}'
  + '.evrow{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#fff}'
  + '.evwhen{font:700 12px "IBM Plex Mono",ui-monospace,monospace;color:var(--jan);white-space:nowrap;padding-top:1px;min-width:74px}'
  + '.evtitle{font:600 13px Inter,system-ui,sans-serif;color:var(--ink);line-height:1.35}'
  + '.evmeta{font:500 12px Inter,system-ui,sans-serif;color:var(--sub);margin-top:2px;text-transform:capitalize}'
  // Buyer-DNA chips (Network drawer) — behavior signals derived from PAST events.
  + '.dnawrap{display:flex;flex-wrap:wrap;gap:8px}'
  + '.dnachip{display:inline-flex;flex-direction:column;gap:1px;background:var(--wash);border:1px solid var(--line);border-radius:10px;padding:7px 11px}'
  + '.dnachip b{font:700 12px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.dnachip i{font:500 11px Inter,system-ui,sans-serif;color:var(--sub);font-style:normal}'
  + '.dnanote{font:500 11px Inter,system-ui,sans-serif;color:var(--faint);margin-top:8px}'
  + 'select.mf-in{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%278%27 viewBox=%270 0 12 8%27%3E%3Cpath d=%27M1 1.5L6 6.5l5-5%27 stroke=%27%236b7787%27 stroke-width=%271.6%27 fill=%27none%27 stroke-linecap=%27round%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px}'
  // MULTI-SELECT PILL TOGGLES (set-aside · notice type · only-show) — Zillow's tappable filter pills
  // (Eric 2026-07-28 Filters redesign PR2). The native checkbox is HIDDEN; the whole .mf-chk label IS
  // the pill (rounded-full), tinted blue with a leading ✓ when its checkbox is checked. The .mf-set /
  // .mf-notice / id-based checkboxes stay in the DOM (all the JS reads them via :checked), so this is
  // PURE CSS — zero wiring change.
  // Zillow min–max range PAIR (value) — two fields with a dash between, aligned on the baseline.
  + '.mf-range{display:flex;align-items:flex-end;gap:10px}'
  + '.mf-range .mf-field{flex:1}'
  + '.mf-dash{color:var(--faint);font-weight:600;padding-bottom:12px}'
  // Zillow SEGMENTED control (Any | Only these) for the Refine rows — 2 states only (the endpoint
  // supports only-show, not exclude, so no dead "Hide"). Row = label + segmented buttons on the right.
  + '.mf-trirow{display:flex;align-items:center;gap:12px}'
  + '.mf-trik{flex:1;font:600 13px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.mf-seg{display:inline-flex;border:1.5px solid var(--line);border-radius:10px;overflow:hidden;flex:none}'
  + '.mf-segb{border:0;background:#fff;font:600 12.5px Inter,system-ui,sans-serif;color:var(--sub);cursor:pointer;padding:0 16px;height:38px;border-left:1.5px solid var(--line);transition:background .12s,color .12s}'
  + '.mf-segb:first-child{border-left:0}'
  + '.mf-segb.on{background:var(--jan);color:#fff}'
  // Zillow single-select PILL group (How this buyer buys) — one active at a time.
  + '.mf-pillsel{display:flex;flex-wrap:wrap;gap:8px}'
  + '.mf-pill{border:1.5px solid var(--line);border-radius:999px;background:#fff;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);cursor:pointer;padding:0 15px;height:40px;transition:border-color .12s,background .12s,color .12s}'
  + '.mf-pill .mf-pico{width:13px;height:13px;vertical-align:-2px;margin-right:5px}'
  + '.mf-pill:hover{border-color:#b8c4d4}'
  + '.mf-pill.on{border-color:var(--jan);background:#eff5ff;color:var(--jan)}'
  // Strategy filter (Opportunity DNA) — a wrap of green check chips; a checked strand tints green
  // (matching the genome's grounded-good tone). Reuses the chip shape from .mf-chk.
  + '.mf-strat{display:flex;flex-wrap:wrap;gap:8px}'
  + '.mf-stratbox{display:inline-flex;align-items:center;gap:7px;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);border:1.5px solid var(--line);border-radius:999px;padding:0 14px;height:38px;cursor:pointer;user-select:none;transition:border-color .12s,background .12s,color .12s}'
  + '.mf-stratbox input{accent-color:var(--grnd);width:15px;height:15px;cursor:pointer}'
  + '.mf-stratbox:hover{border-color:#b8c4d4}'
  + '.mf-stratbox:has(input:checked){border-color:var(--grnd);background:#eef8f1;color:var(--grnd)}'
  + '.mf-checks{display:flex;flex-wrap:wrap;gap:8px}'
  + '.mf-chk{display:inline-flex;align-items:center;gap:8px;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);border:1.5px solid var(--line);border-radius:999px;padding:0 15px;height:40px;cursor:pointer;user-select:none;transition:border-color .12s,background .12s,color .12s;position:relative}'
  + '.mf-chk:hover{border-color:#b8c4d4}'
  // Hide the native checkbox entirely — the pill itself is the control (Zillow shows no checkbox).
  + '.mf-chk input{position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none}'
  + '.mf-chk i{width:9px;height:9px;border-radius:50%;display:inline-block}'
  // Selected pill: blue border + soft fill + a leading ✓ (inserted before the label content).
  + '.mf-chk:has(input:checked){border-color:var(--jan);background:#eff5ff;color:var(--jan)}'
  + '.mf-chk:has(input:checked)::before{content:"\\u2713";font-weight:800;font-size:12px;margin-right:-1px}'
  // Sticky Reset/Apply footer (Zillow): stays pinned at the panel bottom while the body scrolls.
  + '.mf-foot{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;margin-top:14px;padding:16px 26px;'
  + 'border-top:1px solid var(--line);background:#fff;border-radius:0 0 16px 16px}'
  + '.mf-clear{font:600 14px Inter,system-ui,sans-serif;color:var(--jan);background:none;border:0;padding:8px 4px;cursor:pointer;border-radius:8px}'
  + '.mf-clear:hover{text-decoration:underline}'
  + '.mf-apply{margin-left:auto;font:700 15px Inter,system-ui,sans-serif;color:#fff;background:var(--jan);border:0;border-radius:11px;padding:0 42px;height:46px;cursor:pointer;box-shadow:0 2px 8px -2px rgba(59,130,246,.5);transition:filter .12s,box-shadow .12s}'
  + '.mf-apply:hover{filter:brightness(1.04);box-shadow:0 4px 12px -2px rgba(59,130,246,.6)}'
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
  // NOTE: the base `.mf-sec` uppercase-faint rule was REMOVED — every Filters-panel .mf-sec lives
  // inside `.mfpanel-deep`, whose own `.mfpanel-deep .mf-sec` rule (the 800/13px ink header) governs
  // by specificity. The base rule was a dead leftover that read as "different fonts" (Eric). One header.
  + '.mf-row{display:flex;align-items:center;justify-content:space-between;gap:16px;font:600 13px "Inter",system-ui,sans-serif;color:var(--ink)}'
  + '.mf-row em{font-style:normal;font-weight:400;font-size:11.5px;color:var(--sub)}'
  + '.mf-toggle{flex:none;font:600 12px "Inter",system-ui,sans-serif;padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;color:var(--ink)}'
  + '.mf-toggle.off{color:var(--sub);background:var(--wash)}'
  // SOW card facts (Tier 1) — the 🚩 brand-name warning pill (only shown when true — it IS a
  // warning) + the eval-basis chip (Best Value / LPTA). Cap-the-view: 2 highest-signal facts on
  // the card/popup chip row; the full extracted set lives in the drawer's Bid facts section.
  + '.chip.brand{background:#fef3f2;color:#b42318;font-weight:700}'
  + '.chip.evalb{background:#eff8ff;color:#175cd3}'
  + '</style>';

// Loaded right after leaflet.js (before the template's map script): setColorFor(). It MUST be a
// hoisted global here because the template's render() (which we rewrite to call it) runs before
// the </body> viewport script; its body reads SETGROUPS/cv, which exist by call time. Pins now
// encode SET-ASIDE eligibility (the GovCon bid axis), not the old service-line category that
// never matched our NAICS-sector names (→ everything was gray).
// Open/Active pins are ALL GREEN (Eric, Jul 26): once the value-TAG number is the primary signal on
// every pin, the 6 set-aside colors ON TOP of the numbers were visual noise — too much to parse. One
// calm color lets the $ do the talking. Set-aside is still filterable + shown on the card/drawer; it
// just no longer colors the pin. (Awarded=amber, Contacts=purple/red keep their dataset colors — this
// only flattens the set-aside color split on Open.)
const EARLY_INJECT = '<script>function setColorFor(o){return (typeof cv===\'function\')?cv(\'--grnd\'):\'#22a06b\';}</script>';

// ── Value-tag pins (Zillow price-tag model) ────────────────────────────────────────────────
// Replaces the plain circle-dot + clustering model. Each pin is a small rounded tag showing the
// dataset's emotion-number (M-Estimate median for Open, contract $ for Awarded, $ won for
// Companies), in the dataset/set-aside COLOR. Overlap is allowed on purpose (Zillow does NOT
// cluster — the dense field of $ numbers IS the product). Pins with NO value render a small
// neutral dot (never a fabricated price); Gov Buyers always render a labeled dot (a POC has no $).
// Loaded right after leaflet.js as a hoisted global (like setColorFor) because the template's
// render() — rewritten to call mkPin() — runs before the </body> viewport script.
const PIN_JS = '<script>'
  // Compact money: $Nk / $N.NM / $N.NB. Right-sizes the tag so long numbers never blow it out.
  + 'function mCompact(n){n=Number(n);if(!isFinite(n)||n<=0)return \'\';'
  + 'var a=Math.abs(n);'
  + 'if(a>=1e9)return \'$\'+(n/1e9).toFixed(n/1e9>=100?0:1).replace(/\\.0$/,\'\')+\'B\';'
  + 'if(a>=1e6)return \'$\'+(n/1e6).toFixed(n/1e6>=100?0:1).replace(/\\.0$/,\'\')+\'M\';'
  + 'if(a>=1e3)return \'$\'+Math.round(n/1e3)+\'K\';'
  + 'return \'$\'+Math.round(n);}'
  // Some rows carry the money as a pre-formatted string ("$837M", "$65.7B won"). Trust it if it
  // already looks compact; otherwise coerce a raw number. Returns '' when there is genuinely no $.
  + 'function mMoney(v){if(v==null)return \'\';if(typeof v===\'number\')return mCompact(v);'
  + 'var s=String(v).trim();if(!s)return \'\';'
  + 'if(/^\\$/.test(s))return s.replace(/\\s*won$/i,\'\').trim();'
  + 'var num=Number(s.replace(/[^0-9.\\-]/g,\'\'));return isFinite(num)&&num>0?mCompact(num):\'\';}'
  // The tag's $ per dataset: Open → M-Estimate median (o.est); Awarded → contract value (o.value);
  // Companies → $ won (o.won). Buyers → none (handled by mkPin → dot). Falsy = no tag → dot.
  + 'function pinMoney(o){if(!o)return \'\';'
  + 'if(o.ctype===\'buyers\')return \'\';'
  + 'if(o.ctype===\'companies\')return mMoney(o.won);'
  + 'if(o.src===\'RECOMPETE\')return mMoney(o.value);'
  + 'return mMoney(o.est);}'
  // Build the Leaflet marker for a row. text present → a value TAG (divIcon pill); else a small
  // neutral DOT. `approx` (state-centroid / buying-office fallback) still tags the pin
  // .vtag-approx, but ALL pins now render SOLID (the dashed style was dropped — Eric 2026-07-26);
  // the location honesty lives in the card/drawer "approx." WORDS, not the border. Selected/hover
  // raise z-index + scale via a CSS class toggled on the icon element (divIcon has no setStyle).
  + 'function mkPin(o,col,text,approx){'
  + 'var cls=\'vtag\'+(approx?\' vtag-approx\':\'\')+(text?\'\':\' vtag-dot\');'
  + 'var style=\'--vc:\'+col+\';\'+(text?(\'border-color:\'+col+\';color:\'+col):(\'background:\'+col));'
  + 'var html=\'<span class="\'+cls+\'" style="\'+style+\'">\'+(text?text:\'\')+\'</span>\';'
  + 'var w=text?(text.length*7+18):14, h=text?22:14;'
  + 'var icon=L.divIcon({className:\'vtag-wrap\',html:html,iconSize:[w,h],iconAnchor:[Math.round(w/2),Math.round(h/2)]});'
  + 'var m=L.marker([o.lat,o.lng],{icon:icon,riseOnHover:true});'
  + 'm.__col=col;m.__hasText=!!text;'
  + 'm.on(\'mouseover\',function(){try{var el=m.getElement();if(el){var s=el.querySelector(\'.vtag\');if(s){s.classList.add(\'on\');}}if(m.setZIndexOffset)m.setZIndexOffset(1000);}catch(e){}});'
  + 'm.on(\'mouseout\',function(){try{var el=m.getElement();if(el){var s=el.querySelector(\'.vtag\');if(s){s.classList.remove(\'on\');}}if(m.setZIndexOffset)m.setZIndexOffset(0);}catch(e){}});'
  // HOVER PREVIEW (Eric 2026-08-05, Zillow parity): a tiny grounded card on hover — value / agency /
  // days-left — from the row already in hand (never fabricated; a missing field is simply omitted).
  // A Leaflet tooltip is CSP-safe (no custom-positioned floating element) + auto-cleans on mouseout.
  // Skipped for value-less dot pins (o with no est/valueNum) so we never show an empty card.
  + 'try{ if(typeof pinPreview===\'function\'){ var _pv=pinPreview(o); if(_pv){ m.bindTooltip(_pv,{className:\'vprev\',direction:\'top\',offset:[0,-10],opacity:1,sticky:false}); } } }catch(e){}'
  + 'return m;}'
  // pinPreview: the grounded hover-card HTML. $value (top, colored) + agency + a days-left chip when
  // the deadline is known. Returns '' when there's nothing real to show (never an empty card).
  + 'function pinPreview(o){ if(!o)return \'\';'
  + 'var val=(typeof pinMoney===\'function\')?pinMoney(o):\'\';'
  + 'var ag=o.subAgency||o.agency||o.department||\'\';'
  + 'var days=\'\'; try{ var d=o.close?Math.ceil((new Date(o.close)-new Date())/86400000):null; if(d!=null&&d>=0&&d<=365)days=(d===0?\'Due today\':(d+\'d left\')); }catch(e){}'
  + 'if(!val&&!ag&&!days)return \'\';'
  + 'var esc=function(s){return String(s==null?\'\':s).replace(/[&<>"]/g,function(c){return {\'&\':\'&amp;\',\'<\':\'&lt;\',\'>\':\'&gt;\',\'"\':\'&quot;\'}[c];});};'
  + 'var h=\'<div class="vprev-in">\';'
  + 'if(val)h+=\'<div class="vprev-val">\'+esc(val)+\'</div>\';'
  + 'if(ag)h+=\'<div class="vprev-ag">\'+esc(ag)+\'</div>\';'
  + 'if(days)h+=\'<div class="vprev-days">\'+esc(days)+\'</div>\';'
  + 'return h+\'</div>\';}'
  // ---------- zoom-aware GRID CLUSTERING (de-overlap) ----------
  // The map renders raw value-tag pins into a plain layerGroup, so at country/region zoom the
  // eastern US is a wall of overlapping $-tags (Eric 2026-08-03 screenshot). This is the
  // Google-Maps / Zillow behavior: at LOW zoom collapse nearby pins into ONE count bubble; zoom
  // IN past a threshold and they expand back to the individual value-tag pins we render today.
  // NO markercluster plugin (CSP + self-contained-page rules forbid a new external <script>) —
  // this is a small client-side grid cluster over the rows ALREADY in hand. No refetch on zoom;
  // both render paths (opportunity render() + network renderContacts()) call clusterRows().
  //
  // Zillow pin model (Eric 2026-08-12): country zoom has NO pins ("Zoom in to see opportunities");
  // regional zoom is small colored DOTS; $-value tags only when zoomed in close. Clustering stays
  // off wherever pins render — overlapping dots are the point (Zillow Kansas City).
  // PIN_DOT_ZOOM: below this, skip pins. PIN_TAG_ZOOM: below this, dots; at/above, $ tags.
  //
  // ⚠️ EXCEPT IN THE EMBED (Eric 2026-08-15, "make the map pins denser so it doesn't look empty").
  // The overlapping-dots model works when the dots are SPREAD. MEASURED on the front-page embed:
  // the API sends 600 opportunities, all with real coordinates, and all 600 DO render (600
  // path.leaflet-interactive nodes in the DOM) — but they collapse to just 76 distinct
  // coordinates, and 403 of them (67%) stack on ONE pixel over Columbus, Ohio. Those are DLA
  // parts buys ("PAWL, RIGHT HAND", "ENGINE BLOCK, DIESEL") pinned to the buying depot because
  // SAM publishes no place-of-performance for them (397 of 400 sampled have pop_state NULL — the
  // coordinate is honest, there is nowhere truer to put them). So the front page showed ~35
  // visible dots and read as a dead market while carrying 600 live opportunities.
  //
  // Clustering is the fix that stays TRUE: a "403" bubble says what a 403-deep stack actually
  // means, where an invisible pile says nothing. Scoped to the embed ONLY via __EMBED_CLUSTER__
  // so the interactive map keeps the Zillow behaviour chosen on 08-12 — this is a front-page
  // legibility change, not a reversal of that decision.
  // `typeof window` guard, not a bare `window.` — this block is also eval'd in a bare Node vm
  // sandbox by map-clustering.unit.test.ts, where `window` is undefined and a bare reference
  // throws before a single assertion runs.
  + 'var _EMBCL=(typeof window!==\'undefined\'&&window.__EMBED_CLUSTER__)?1:0;'
  // CLUSTERS OFF EVERYWHERE (Eric 2026-08-16: "we agreed to remove clusters" — the embed too).
  // 0 = never cluster, the same value the interactive map has used since 08-12.
  //
  // ⚠️ THIS IS A DELIBERATE TRADE, made with the measurement in hand. #1139 clustered the embed
  // six days ago because its 600 opportunities collapse onto 76 distinct coordinates, 403 of them
  // (67%) stacked on ONE pixel over Columbus OH — DLA parts buys pinned to the buying depot
  // because SAM publishes no place-of-performance (397 of 400 sampled have pop_state NULL).
  // Without a bubble, that stack is one indistinguishable dot again. Eric chose the dots.
  //
  // ⚠️ _EMBCL still gates PIN_DOT_ZOOM below — do NOT collapse the two. The embed boots at CONUS
  // 4.5 and the non-embed floor is 5, so dropping the flag entirely would make pinTooFar() true
  // and render ZERO pins behind a "zoom in" prompt.
  + 'var CLUSTER_MAX_ZOOM=0;'
  // REGIONAL_ZOOM stays 0 in the embed ON PURPOSE. Above it, a 1-member bucket renders as a
  // single pin; below it, even a lone opportunity becomes a count bubble reading "1". Setting it
  // to 12 with clustering on produced a scatter of tiny "1" circles across the country — each
  // technically correct and collectively noise, because a bubble labelled 1 is just a dot that
  // has learned to count. Real stacks (414, 126, 21) keep their bubbles; singles stay dots.
  + 'var REGIONAL_ZOOM=0;'
  // ⚠️ PIN_DOT_ZOOM suppresses pins below zoom 5 and shows "Zoom in to see opportunities" — the
  // right call for the INTERACTIVE map (a user can zoom), and wrong for a front-page hero the
  // visitor cannot interact with before deciding whether the product has data. The embed boots at
  // CONUS 4.5, so with PIN_JS finally shipping there this gate blanked the map completely: 0 pins
  // and a "zoom in" prompt on a static hero. In the embed the floor drops to 0 and clustering
  // carries the density instead.
  + 'var PIN_DOT_ZOOM=(_EMBCL?0:5);'
  + 'var PIN_TAG_ZOOM=10;'
  + 'function pinTooFar(map){var z=(map&&map.getZoom)?map.getZoom():0;return z<PIN_DOT_ZOOM;}'
  + 'function pinFace(o,map){if(typeof pinTooFar===\'function\'&&pinTooFar(map))return \'\';var z=(map&&map.getZoom)?map.getZoom():0;if(z<PIN_TAG_ZOOM)return \'\';return (typeof pinMoney===\'function\')?pinMoney(o):\'\';}'
  // Bucket the rows (that carry real lat/lng) into a fixed-PIXEL grid at the current zoom, so cells
  // stay ~constant screen size as you zoom. project()/unproject() are exact for the current view.
  // Returns { singles:[row], clusters:[{lat,lng,members,count}] }. A bucket with <=1 member is a
  // single pin; >=2 becomes ONE bubble at the members' CENTROID (average lat/lng — honest, never a
  // fabricated point). Above the threshold every row is a single (clustering off). O(rows).
  + 'function clusterRows(rows,map,cellPx){'
  + 'var out={singles:[],clusters:[]};'
  + 'if(!rows||!rows.length)return out;'
  + 'var z=(map&&map.getZoom)?map.getZoom():0;'
  + 'var placed=[],unplaced=[];'
  + 'for(var i=0;i<rows.length;i++){var r=rows[i];if(r&&r.lat!=null&&r.lng!=null)placed.push(r);else unplaced.push(r);}'
  // Clustering OFF (zoomed in) OR nothing placed → every placed row is an individual pin.
  + 'if(z>=CLUSTER_MAX_ZOOM||!map||!map.project){out.singles=placed;return out;}'
  + 'var cp=cellPx||64;'
  + 'var buckets={};'
  + 'for(var j=0;j<placed.length;j++){var o=placed[j];'
  + 'var pt=map.project([o.lat,o.lng],z);'
  + 'var gx=Math.floor(pt.x/cp),gy=Math.floor(pt.y/cp);'
  + 'var key=gx+\'_\'+gy;'
  + 'if(!buckets[key])buckets[key]=[];'
  + 'buckets[key].push(o);}'
  // FAR tier: below REGIONAL_ZOOM, a lone point is STILL a cluster bubble (count 1) — clusters only,
  // no $-value pins. REGIONAL tier (>=REGIONAL_ZOOM): a 1-member bucket is a single value pin as before.
  + 'var far=(z<REGIONAL_ZOOM);'
  + 'for(var k in buckets){if(!buckets.hasOwnProperty(k))continue;var mem=buckets[k];'
  + 'if(mem.length<=1&&!far){out.singles.push(mem[0]);continue;}'
  + 'var sla=0,slo=0;for(var q=0;q<mem.length;q++){sla+=mem[q].lat;slo+=mem[q].lng;}'
  + 'out.clusters.push({lat:sla/mem.length,lng:slo/mem.length,members:mem,count:mem.length});}'
  + 'return out;}'
  // Entity-aware cluster LABEL. Opportunity map → "N Opportunities \\u00b7 $X" where $X is the SUMMED
  // value of the members that carry a real value (via pinMoney/mMoney — so a cluster total agrees
  // with its pins; members with no value are never counted into $). Network map → mixed entity
  // counts by ctype ("23 Contractors \\u00b7 7 Agencies"), dropping any ZERO segment (honest nulls —
  // never "0 Agencies"). mode: 'opps' | 'network'.
  + 'function clusterLabel(members,mode){'
  + 'var n=members.length;'
  + 'if(mode===\'network\'){var comp=0,buy=0,other=0;'
  + 'for(var i=0;i<members.length;i++){var c=members[i]&&members[i].ctype;'
  + 'if(c===\'companies\')comp++;else if(c===\'buyers\')buy++;else other++;}'
  + 'var seg=[];'
  + 'if(comp>0)seg.push(comp+\' \'+(comp===1?\'Contractor\':\'Contractors\'));'
  + 'if(buy>0)seg.push(buy+\' \'+(buy===1?\'Agency\':\'Agencies\'));'
  + 'if(other>0)seg.push(other+\' \'+(other===1?\'Contact\':\'Contacts\'));'
  + 'return seg.length?seg.join(\' \\u00b7 \'):(n+\' \'+(n===1?\'Contact\':\'Contacts\'));}'
  // opps: sum only members that have a real NUMERIC value. Use the raw number fields the map already
  // ranks by (VIEWPORT_JS rowVal): Open/Forecast → o.est, Recompete → o.valueNum (the real USASpending
  // ceiling number — NOT o.value, which is the pre-formatted "$40M" STRING), Companies → o.won. A
  // formatted string would parse "$40M" as 40, silently under-summing the cluster; the numeric field
  // is authoritative so the bubble total agrees with the sum of its pins. Never fabricate a value.
  + 'var sum=0;'
  + 'for(var m2=0;m2<members.length;m2++){var o=members[m2];var num=0;'
  + 'if(o){if(o.ctype===\'companies\')num=Number(o.won);else if(o.src===\'RECOMPETE\')num=Number(o.valueNum);else num=Number(o.est);}'
  + 'if(isFinite(num)&&num>0)sum+=num;}'
  + 'var money=(sum>0&&typeof mCompact===\'function\')?mCompact(sum):\'\';'
  + 'var head=n+\' \'+(n===1?\'Opportunity\':\'Opportunities\');'
  + 'return money?(head+\' \\u00b7 \'+money):head;}'
  // The COUNT shown ON the circle face (Google/Zillow style): just the number of members. The
  // full "N Opportunities \\u00b7 $X" / "N Contractors \\u00b7 M Agencies" string (clusterLabel)
  // moves to the hover title so the map stays a field of readable count-circles, not text pills.
  // 1000+ compacts to "1k" so a 4-digit count never blows out the circle.
  + 'function clusterCount(members){var n=members.length;return n>=1000?(Math.round(n/100)/10)+\'k\':String(n);}'
  // Circle diameter scales with the member count (a few log-ish buckets: small clusters read small,
  // country-level whoppers read big) — count is the size signal, exactly like Google Maps clustering.
  + 'function clusterSize(members){var n=members.length;if(n>=500)return 54;if(n>=100)return 46;if(n>=25)return 40;if(n>=10)return 34;return 28;}'
  // The cluster BUBBLE = a Leaflet divIcon (.cl-bubble sibling of the .vtag pill). Colored by the
  // dataset/horizon already in play: opps → the single horizon color if the bucket is one-horizon,
  // else a neutral map slate; network → purple if companies-majority, red if buyers-majority.
  // Click → flyTo the centroid + zoom in past the threshold, which re-clusters/expands (the drill-in).
  // ONE brand color per MAP (Eric 2026-08-03): the cluster circle no longer encodes horizon/entity
  // mix — that lives in the FILTER, never on the bubble ([[map1_two_axis_pin_system]]). Opportunity
  // map = green, Network map = purple. Keeps each map a single-hue field of count-circles.
  + 'function clusterColor(members,mode){'
  + 'if(mode===\'network\')return \'#7c3aed\';'
  + 'return (typeof cv===\'function\'?cv(\'--grnd\'):\'\')||\'#22a06b\';}'
  + 'function mkClusterBubble(cl,map,mode){'
  + 'var label=clusterLabel(cl.members,mode);'
  + 'var col=clusterColor(cl.members,mode);'
  + 'var count=clusterCount(cl.members);'
  + 'var d=clusterSize(cl.members);'
  // Compact COUNT circle (Eric 2026-08-03: "compact circle, size = count"). Face = the count only;
  // full "N Opportunities \\u00b7 $X" string is the hover title. Square iconSize = the circle box.
  // label is our own generated text (counts + words) — no user input — so a plain quote-strip is
  // enough for the title attribute (esc() lives in other script blocks, not this PIN_JS one).
  + 'var t=String(label).replace(/"/g,\'\');'
  + 'var html=\'<span class="cl-bubble" title="\'+t+\'" style="width:\'+d+\'px;height:\'+d+\'px;background:\'+col+\'">\'+count+\'</span>\';'
  + 'var icon=L.divIcon({className:\'cl-wrap\',html:html,iconSize:[d,d],iconAnchor:[Math.round(d/2),Math.round(d/2)]});'
  + 'var m=L.marker([cl.lat,cl.lng],{icon:icon,riseOnHover:true});'
  + 'm.on(\'mouseover\',function(){try{var el=m.getElement();if(el){var s=el.querySelector(\'.cl-bubble\');if(s)s.classList.add(\'on\');}if(m.setZIndexOffset)m.setZIndexOffset(1000);}catch(e){}});'
  + 'm.on(\'mouseout\',function(){try{var el=m.getElement();if(el){var s=el.querySelector(\'.cl-bubble\');if(s)s.classList.remove(\'on\');}if(m.setZIndexOffset)m.setZIndexOffset(0);}catch(e){}});'
  + 'm.on(\'click\',function(){try{var tz=(map.getZoom?map.getZoom():0)+3;if(map.flyTo)map.flyTo([cl.lat,cl.lng],tz);else if(map.setView)map.setView([cl.lat,cl.lng],tz);}catch(e){}});'
  + 'return m;}'
  + '</script>';

// Value-tag pin styles. White pill + COLORED border/text so overlapping tags (Zillow-dense) stay
// legible against each other; the selected/hover tag flips to a filled solid + shadow + scale and
// rises above its neighbors. The neutral dot (no value) is a small colored circle.
const VTAG_CSS = '<style>'
  + '.vtag-wrap{background:transparent!important;border:0!important}'
  + '.vtag{display:inline-flex;align-items:center;justify-content:center;'
  + 'font-family:var(--mono);font-weight:600;font-size:11.5px;line-height:1;white-space:nowrap;'
  + 'height:22px;padding:0 8px;border-radius:11px;background:#fff;border:1.5px solid #64748b;'
  + 'box-shadow:0 1px 2px rgba(16,24,40,.14),0 1px 3px rgba(16,24,40,.10);cursor:pointer;'
  + 'transition:transform .08s ease,box-shadow .08s ease;letter-spacing:-.2px}'
  + '.vtag.on,.vtag.sel{transform:scale(1.12);box-shadow:0 6px 14px -3px rgba(16,24,40,.28),0 3px 6px -2px rgba(16,24,40,.14);'
  + 'background:var(--vc,#64748b);color:#fff!important;border-color:#fff}'
  // Hover-preview tooltip (Zillow-style card). Overrides Leaflet's default tooltip chrome to a clean
  // white card; the arrow is neutralized. Grounded content only (pinPreview omits missing fields).
  + '.vprev.leaflet-tooltip{background:#fff;border:1px solid #e6eaef;border-radius:11px;padding:0;'
  + 'box-shadow:0 10px 26px -8px rgba(16,24,40,.30),0 3px 8px -3px rgba(16,24,40,.16);color:#111c26;font-family:Inter,system-ui,sans-serif}'
  + '.vprev.leaflet-tooltip:before{display:none!important}'
  + '.vprev-in{padding:8px 11px;min-width:120px}'
  + '.vprev-val{font:800 15px var(--mono),ui-monospace,monospace;color:#0f172a;letter-spacing:-.3px;line-height:1.1}'
  + '.vprev-ag{font:600 11.5px Inter,system-ui,sans-serif;color:#475569;margin-top:3px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.vprev-days{display:inline-block;margin-top:6px;font:700 10.5px Inter,system-ui,sans-serif;color:#7a4a00;background:#fff2dc;border:1px solid #ffe0ab;border-radius:999px;padding:2px 8px}'
  // ALL value-tag pins render SOLID regardless of location precision (Eric 2026-07-26: the dashed
  // approximate style made the state-centroid pile-up look worse; he prefers the clean solid look).
  // The location HONESTY moved OFF the pins/list/popup entirely — the single "(approximate)"
  // disclosure now lives ONLY in each dataset's DETAIL DRAWER (place-of-performance line). So the
  // .vtag-approx class stays applied by mkPin (harmless) but carries NO dashed/muted styling.
  + '.vtag-dot{width:13px;height:13px;padding:0;border-radius:50%;border:2px solid #fff;'
  + 'box-shadow:0 1px 2px rgba(16,24,40,.2);background:#64748b}'
  + '.vtag-dot.on,.vtag-dot.sel{transform:scale(1.4)}'
  // Cluster count bubble (low-zoom de-overlap). A rounded pill, white text on the dataset/horizon
  // color, subtle shadow — a sibling of .vtag sized to its "N Opportunities · $X" label. Hover
  // lifts + scales like the pins.
  + '.cl-wrap{background:transparent!important;border:0!important}'
  // Compact COUNT circle — width/height come from the inline style (clusterSize), so this is the
  // shared chrome only: perfect circle, white ring, count centered. Google/Zillow density style.
  + '.cl-bubble{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;'
  + 'font-family:var(--mono);font-weight:700;font-size:12.5px;line-height:1;letter-spacing:-.3px;'
  + 'border-radius:50%;color:#fff;background:#475569;'
  + 'border:2px solid #fff;box-shadow:0 2px 6px rgba(16,24,40,.28),0 1px 2px rgba(16,24,40,.16);cursor:pointer;'
  + 'transition:transform .08s ease,box-shadow .08s ease}'
  + '.cl-bubble.on{transform:scale(1.12);box-shadow:0 8px 20px -4px rgba(16,24,40,.38),0 3px 8px -2px rgba(16,24,40,.2)}'
  + '</style>';

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
  + '.zh-left{display:flex;align-items:center;gap:20px}'
  + '.zh-left a{font:700 16px "Inter",system-ui,sans-serif;color:var(--ink);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}'
  // "Explore" eyebrow — a quiet uppercase label that GROUPS the two maps (Opportunities + Network),
  // both of which are exploration (Eric 2026-08-03, two-networks nav). Muted + smaller so it reads as
  // a section label, not a clickable tab; a hairline separates it from the map links.
  + '.zh-explore{font:800 10.5px "Inter",system-ui,sans-serif;color:var(--sub);text-transform:uppercase;letter-spacing:.08em;padding-right:14px;border-right:1px solid var(--line);user-select:none}'
  // The active MAP gets the persistent blue (data-map on-state), unlike the hover-only right nav.
  + '.zh-mode.on{color:var(--jan)}'
  // Ask Mindy — the always-present nav doorway into the chat drawer (approved mockup, after
  // Pursuits). Transparent, blue text + blue chat icon (NOT the old purple pill — Eric 2026-08-02
  // "make it transparent not a purple background just like the artifact"). Inherits zh-left <a>
  // typography; overrides colour + adds the leading icon.
  + '.zh-ask{display:inline-flex;align-items:center;gap:6px;font:700 16px "Inter",system-ui,sans-serif;color:var(--jan,#2563eb);text-decoration:none;cursor:pointer;white-space:nowrap;letter-spacing:-.01em}'
  + '.zh-ask svg{width:16px;height:16px;flex:none}.zh-ask:hover{filter:brightness(1.1)}'
  // Highlight top-nav items ONLY on hover — the blue must NOT persist on a clicked item.
  + '.zh-left a:hover,.zh-right a:hover{color:var(--jan)}'
  + '.zh-acct{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);color:var(--sub)}'
  + '.zh-logo{position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;text-decoration:none}'
  + '.zh-logo img{height:25px;width:auto;display:block}'
  + '.zh-logo span{font:700 19px "Inter",system-ui,sans-serif;color:var(--ink);letter-spacing:-.02em}'
  // Narrow: hide the Explore eyebrow + Pursuits/Ask-Mindy, keep the two MAP links (the leading
  // .zh-explore <span> is child 1, so the two map <a>s are children 2-3 and Pursuits/Ask are 4+).
  + '@media(max-width:1000px){.zh-left,.zh-right{gap:14px}.zh-explore{display:none}.zh-left a:nth-child(n+4),.zh-right a:first-child{display:none}}'
  // far-left icon rail — PINNED (position:fixed) so grid/overflow can never push it off-screen.
  // The 50px grid column stays as its reserved space (kept empty; the fixed rail sits over it).
  + '.zrail{position:fixed;left:0;top:52px;width:64px;height:calc(100vh - 52px);height:calc(100dvh - 52px);'
  + 'background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:2px;padding:14px 0;z-index:30;overflow:hidden}'
  + '.zrail a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--sub);text-decoration:none;padding:8px 2px;border-radius:11px;width:56px;min-height:48px}'
  + '.zrail a:hover{background:var(--wash);color:var(--ink)}.zrail a.on{color:var(--jan);background:#eff5ff}'
  + '.zrail svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
  + '.zrail a span{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.01em;line-height:1}'
  + '.zrail-sep{width:34px;height:1px;background:var(--line,#e6eaef);margin:6px auto}'
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
  // Approved Zillow/Andre-model search box (artifact 86eee8f2 / 6e7986d7): soft off-white fill,
  // 9px radius, new-map JAN-blue focus ring (not the old #006aff). Sits flex-grow with the
  // Players/sort pills to its RIGHT.
  + '.zsearch{position:relative;flex:1 1 240px;min-width:150px;max-width:360px;display:flex;align-items:center;gap:8px;border:1px solid var(--line,#e6ebf0);border-radius:9px;padding:0 13px;height:40px;background:var(--wash,#f8fbfd)}'
  + '.zsearch:focus-within{border-color:var(--jan,#2563eb);background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.14)}'
  + '.zsearch svg{width:16px;height:16px;stroke:var(--sub);fill:none;stroke-width:2;flex:none}'
  + '.zsearch input{border:0;outline:0;flex:1;min-width:0;font:500 13.5px Inter,system-ui,sans-serif;background:transparent;color:var(--ink)}'
  // ── Focused-search suggestions panel (Zillow-style): Ask Mindy · Near me · Recent · Saved · autocomplete
  + '.zsp{position:absolute;top:calc(100% + 8px);left:0;width:min(420px,86vw);background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 44px rgba(16,24,40,.18);z-index:1200;overflow:hidden;display:none;max-height:70vh;overflow-y:auto}'
  + '.zsp.show{display:block}'
  + '.zsp-ask{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(90deg,#f4f0fe,#eef4ff);cursor:pointer;font:600 14px Inter;color:#4f46e5}'
  + '.zsp-ask:hover{background:linear-gradient(90deg,#ece5fd,#e3edff)}'
  + '.zsp-ask .sp{width:20px;height:20px;flex:none}'
  + '.zsp-row{display:flex;align-items:center;gap:11px;padding:11px 16px;cursor:pointer;font:500 14px Inter;color:var(--ink);border:0;background:none;width:100%;text-align:left}'
  // The UNPLACED row — tinted with --forecast because purple already means "forecast"
  // on this map, so the row reads as native rather than as a new concept.
  + '.zsp-unplaced{background:rgba(124,58,237,.055);border-top:1px solid var(--hair)}'
  + '.zsp-unplaced:hover{background:rgba(124,58,237,.1)}'
  + '.zsp-unplaced b{font-weight:700;color:var(--forecast);font-variant-numeric:tabular-nums}'
  + '.zsp-uic{width:18px;text-align:center;color:var(--forecast);flex:none}'
  + '.unplacedfoot{display:flex;align-items:center;gap:9px;width:100%;padding:13px 16px;'
  + 'background:rgba(124,58,237,.055);border:0;border-top:1px solid var(--line);cursor:pointer;'
  + 'font:500 13px Inter;color:var(--ink);text-align:left}'
  + '.unplacedfoot:hover{background:rgba(124,58,237,.1)}'
  + '.unplacedfoot b{font-weight:700;color:var(--forecast);font-variant-numeric:tabular-nums}'
  + '.unplacedfoot .ic{color:var(--forecast)}'
  + '.unplacedfoot .arw{margin-left:auto;color:var(--faint)}'
  + '.zsp-row:hover{background:var(--wash)}'
  + '.zsp-row svg,.zsp-row .ic{width:17px;height:17px;flex:none;stroke:var(--sub);fill:none;stroke-width:2}'
  + '.zsp-row .sub{color:var(--faint);font-weight:400;font-size:12.5px}'
  + '.zsp-row .code{font:600 12px "IBM Plex Mono",monospace;color:#4f46e5;background:#eef2ff;padding:2px 7px;border-radius:5px;flex:none}'
  // Saved-search "N new" match badge (Zillow "Updates N") on a dropdown row.
  + '.zsp-row .badge{margin-left:auto;flex:none;min-width:18px;height:18px;padding:0 6px;border-radius:9px;background:#d92d20;color:#fff;font:700 11px Inter,system-ui,sans-serif;display:inline-flex;align-items:center;justify-content:center;line-height:1}'
  // Saved-search rows are buttons that APPLY in place — keep the text from being squeezed by the badge.
  + '.zsp-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.zsp-h{padding:12px 16px 5px;font:700 11px Inter;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}'
  + '.zsp-sep{height:1px;background:var(--hair);margin:5px 0}'
  + '.zsp-empty{padding:14px 16px;color:var(--faint);font:400 13px Inter}'
  + '.mapwrap{grid-area:zmap!important}'
  // Map controls (Draw) → pinned BOTTOM-LEFT of the map. Was top-right, which COLLIDED with
  // map-pin popups: a popup opens anchored ABOVE its pin (Leaflet default), so a pin near the
  // top of the map lands the popup\'s top-right corner — where the ♡ save heart lives — directly
  // UNDER the Draw button. z-index alone did NOT fix it: the Draw button still intercepted the
  // CLICK on the heart (a pointer-events / hit-test conflict, not just visual stacking). Eric:
  // "no cards should overlay with the draw button — they should not interact with it." So the
  // permanent fix is SEPARATION: bottom-left is clear of popups (which open upward), of the
  // bottom-RIGHT zoom control, and of the bottom-CENTER tile status → zero overlap possible.
  + '.maptop{left:auto!important;right:16px!important;bottom:auto!important;top:74px!important;transform:none!important;z-index:400!important}'
  // Belt-and-suspenders: the container is inert to the pointer (so it can never swallow a click
  // meant for a popup that overlaps it); only the buttons themselves take pointer events.
  + '.maptop{pointer-events:none}'
  + '.maptop .mpill{pointer-events:auto}'
  // The popup (and its close button) still sit above the map controls in the stack (harmless now
  // that they no longer share space). Leaflet\'s popup pane defaults to 700; keep it explicit.
  + '.leaflet-popup-pane{z-index:750!important}'
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
  // Standard filter controls DISABLED (not removed) when they don't apply to the current
  // dataset — greyed + inert, but present in the SAME slot so the bar never reflows switching
  // Active/Awarded/Contacts (menu-consistency fix, Eric 2026-07-26).
  + '.fsel.mode-disabled{opacity:.42;pointer-events:none;cursor:default}'
  // mode-muted = greyed to signal "not applicable right now" BUT still clickable (so a popover it
  // controls can always be dismissed — never pointer-events:none, which traps it open).
  + '.fsel.mode-muted{opacity:.5}'
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
  // ============================================================================
  // MOBILE (phone ≤640px) — the map + list can't sit side-by-side on a phone, so
  // this collapses the 3-column desktop grid into a Zillow-style single surface:
  //   • LIST default (full-width results), MAP as a full-screen overlay behind it
  //   • a floating "Map"/"List" toggle (#mToggle) flips body.m-map
  //   • the fixed icon rail is hidden → a hamburger (#mHam) opens a drawer (#mDrawer)
  //   • the top nav links collapse (they live in the drawer); only logo + hamburger stay
  // Desktop is untouched — every rule is inside this one media query. Mobile-only
  // elements (#mHam/#mToggle/#mDrawer) render on every viewport but are display:none
  // above 640px (see the base rules just below, gated by the same breakpoint).
  + '#mHam,#mToggle,#mDrawer,#mScrim{display:none}'
  + '@media(max-width:640px){'
  // 1) Grid → single column. zmap + zcards share ONE cell (row 3); we toggle which is
  //    visible. Header row stays; the ztop (search+filters) row stays full-width.
  +   '.app{grid-template-columns:1fr!important;grid-template-rows:52px auto minmax(0,1fr)!important;'
  +     'grid-template-areas:"zhead" "ztop" "zcards"!important}'
  +   '.app.collapsed{grid-template-columns:1fr!important}'
  // 2) Kill the fixed left rail (moves into the hamburger drawer).
  +   '.zrail{display:none!important}'
  // 3) Top header: hide the desktop nav LINKS + centered logo shift; show hamburger.
  //    Keep the logo inline-left next to the ham. Do NOT hide all of .zh-right — the account
  //    avatar (.mindy-acct) lives inside it; hide only the text links (Pricing / Bid), which
  //    already live in #mDrawer.
  +   '.zhead{padding:0 12px!important;z-index:1100!important}'
  +   '.zh-left{display:none!important}'
  +   '.zh-right{display:flex!important;align-items:center;gap:0;margin-left:auto!important}'
  +   '.zh-right > a{display:none!important}'
  +   '.mindy-acct{display:inline-flex!important}'
  +   '.zh-logo{position:static!important;left:auto!important;transform:none!important;margin:0 auto 0 8px!important}'
  +   '.zh-logo img{height:22px!important}.zh-logo span{font-size:17px!important}'
  +   '#mHam{display:inline-flex!important;align-items:center;justify-content:center;width:38px;height:38px;'
  +     'flex:none;border:0;background:none;cursor:pointer;color:var(--ink);border-radius:9px}'
  +   '#mHam:active{background:var(--wash)}'
  +   '#mHam svg{width:23px;height:23px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}'
  // 4) Search/filters row. ⚠️ NEVER overflow:auto/hidden/scroll on .ztop — absolute dropdowns
  //    (Horizons, Sort, search suggestions, sheets) nest under it and get CLIPPED (same permanent
  //    rule as .fscroll). Pills shrink via nowrap + min-width:0; search absorbs the squeeze.
  +   '.ztop{padding:8px 12px!important;gap:6px!important;overflow:visible!important}'
  +   '.zsearch{max-width:none!important;flex:1 1 auto!important;min-width:120px!important}'
  // 5) The two content layers share row 3 (grid-area:zcards). LIST is the default —
  //    full-width, scrolls. MAP is positioned to fill the same cell but hidden until
  //    body.m-map. Using grid-area (not fixed) so it respects the header/ztop rows.
  +   '.panel{grid-area:zcards!important;border-left:0!important;border-top:1px solid var(--line)!important;'
  +     'width:100%!important;min-width:0!important;z-index:2}'
  +   '.mapwrap{grid-area:zcards!important;border-top:1px solid var(--line);z-index:1;'
  +     'visibility:hidden;pointer-events:none}'
  // Feed padding trims for phone width.
  +   '.feed{padding:12px 12px 90px!important}'
  //    body.m-map: show MAP, hide LIST.
  +   'body.m-map .mapwrap{visibility:visible!important;pointer-events:auto!important;z-index:3!important}'
  +   'body.m-map .panel{visibility:hidden!important;pointer-events:none!important}'
  // 6) Floating Map/List toggle — bottom-center pill (Zillow). Above the map, below the drawer.
  +   '#mToggle{display:inline-flex!important;align-items:center;gap:7px;position:fixed;left:50%;'
  +     'bottom:20px;transform:translateX(-50%);z-index:1400;border:0;cursor:pointer;'
  +     'background:#111c26;color:#fff;font:700 14px Inter,system-ui,sans-serif;padding:12px 20px;'
  +     'border-radius:22px;box-shadow:0 6px 20px rgba(16,24,40,.28)}'
  +   '#mToggle svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}'
  // 7) Slide-in drawer (the rail, as a menu) + scrim.
  +   '#mScrim{display:block!important;position:fixed;inset:0;background:rgba(16,24,40,.42);'
  +     'z-index:1500;opacity:0;pointer-events:none;transition:opacity .2s}'
  +   'body.m-drawer #mScrim{opacity:1;pointer-events:auto}'
  +   '#mDrawer{display:block!important;position:fixed;top:0;left:0;bottom:0;width:270px;max-width:82vw;'
  +     'background:#fff;z-index:1600;transform:translateX(-100%);transition:transform .24s cubic-bezier(.4,0,.2,1);'
  +     'box-shadow:8px 0 28px rgba(16,24,40,.18);overflow-y:auto;padding:14px 12px}'
  +   'body.m-drawer #mDrawer{transform:translateX(0)}'
  +   '#mDrawer .md-brand{display:flex;align-items:center;gap:9px;padding:6px 8px 14px;border-bottom:1px solid var(--line);margin-bottom:8px}'
  +   '#mDrawer .md-brand img{height:24px}#mDrawer .md-brand b{font:700 18px Inter,system-ui,sans-serif;letter-spacing:-.02em}'
  +   '#mDrawer a{display:flex;align-items:center;gap:12px;padding:12px 10px;border-radius:10px;'
  +     'color:var(--ink);text-decoration:none;font:600 15px Inter,system-ui,sans-serif}'
  +   '#mDrawer a:active{background:var(--wash)}#mDrawer a.on{color:var(--jan);background:#eff5ff}'
  +   '#mDrawer a svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}'
  +   '#mDrawer .md-sep{height:1px;background:var(--line);margin:8px 4px}'
  +   '#mDrawer .md-lbl{font:800 10.5px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--sub);padding:10px 10px 4px}'
  +   '}'
  + '</style>';

// Icon rail + top search bar. The template's .fbar (filters) is appended into .ztop by JS.
// Icon-only rail (reduced — no text labels, which were wider than the rail and clipped).
// Names live in the title tooltip.
// Left rail (Eric 2026-08-05 relabel): Map · Watchlist · Saved · —(sep)· Market. Renamed from the
// old Zillow-borrowed labels: Search→Map (this page IS the map), Updates→Watchlist (the saved-search
// change feed + its red count badge), Favorites→Saved (hearted opportunities). A "Pursuits" item is
// coming in the page-design pass — deliberately NOT added yet. The FOUR rail copies (here +
// favorites/saved/market sub-view route.ts files) MUST stay in sync — change all four together.
const ZRAIL_HTML = '<nav class="zrail">'
  // Map = the search surface (this page). Map-marker icon, since it's now labeled "Map".
  + '<a class="on" id="railSearch" title="Map"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg><span>Map</span></a>'
  // Watchlist = saved SEARCHES + their new matches (Zillow\'s Updates page IS SavedSearches); carries the red badge.
  + '<a href="/opportunity-map/saved" title="Watchlist — saved searches &amp; new matches" style="position:relative"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg><span>Watchlist</span><b class="railbadge" id="savedBadge" hidden></b></a>'
  // Saved = saved OPPORTUNITIES (the hearted ones) — a DIFFERENT function than the Watchlist (saved searches).
  + '<a href="/opportunity-map/favorites" title="Saved — opportunities you hearted"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg><span>Saved</span></a>'
  // Pursuits = the opportunities you are actively working (the "mission control" board) — crosshair icon.
  + '<a href="/opportunity-map/pursuits" title="Pursuits — opportunities you are actively working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg><span>Pursuits</span></a>'
  // ⛔ NOTHING ELSE GOES IN THIS RAIL. Vault and Reports were removed from it (Eric 2026-08-15:
  // "the vault should not be there and we discussed also not putting reports there but through
  // another mean but it keeps resurfacing"). The rail is the DISCOVERY workspace — the two maps
  // plus the three things you accumulate while browsing (Watchlist / Saved / Pursuits).
  //
  // Reports came back the SAME DAY as "Markets" in the TOP NAV — that WAS the "another mean".
  // Nav and rail are different promises: the nav is where you CHOOSE to go, the rail is what
  // follows you while you browse. So "Markets in the nav" and "no Reports in the rail" are not in
  // tension, and the guard enforces exactly that split rather than a blanket ban.
  //
  // "It keeps resurfacing" is the real bug. Both pages STILL EXIST and still work at their own
  // URLs (/opportunity-map/vault, /opportunity-map/reports) and stay reachable from /app — only
  // the rail entry is gone. map-rail-inventory.unit.test.ts asserts their ABSENCE across every
  // rail copy, so re-adding one fails the push instead of shipping.
  + '</nav>';
const ZTOP_HTML = '<div class="ztop"><div class="zsearch">'
  // ── NUCLEAR autofill guard (Eric 2026-08-02: "it looks like you\'re trying to log me in at the
  // search bar" — the saved EMAIL kept landing in the opportunity search). type="search" + the
  // ignore attrs were NOT enough: Chrome autofills the FIRST login-shaped fields it finds and
  // ignores autocomplete="off" on a bare input. So (1) two OFF-SCREEN DECOY fields (username +
  // password) sit BEFORE the real input to absorb Chrome/1Password\'s autofill, and (2) the real
  // input starts readonly and only becomes editable on focus (SEARCH_PANEL_JS strips readonly),
  // so on page-load there is no editable text field for the browser to target.
  + '<input class="amk-decoy" type="text" name="username" tabindex="-1" aria-hidden="true" autocomplete="username" style="position:absolute;opacity:0;height:0;width:0;pointer-events:none;left:-9999px">'
  + '<input class="amk-decoy" type="password" name="password" tabindex="-1" aria-hidden="true" autocomplete="new-password" style="position:absolute;opacity:0;height:0;width:0;pointer-events:none;left:-9999px">'
  + '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>'
  // NUCLEAR anti-autofill (Eric 2026-08-02: Chrome STILL offered saved passwords/emails on the
  // search bar despite type=search + autocomplete=off + data-1p-ignore). The reliable defeat is
  // THREE layers: (1) two OFF-SCREEN decoy username+password inputs that Chrome grabs the saved
  // credentials for, leaving the real box alone; (2) the real input starts readonly (Chrome won't
  // autofill a readonly field) and JS strips readonly on first focus so typing works; (3) the
  // ignore attrs. The decoys are aria-hidden + tabindex=-1 so they're invisible to keyboard/AT.
  // MERGE (2026-08-02): main's 3-layer input structure (readonly + data-form-type=other) WON here —
  // it's the more robust of the two parallel fixes; the decoys above (my names) already match. The
  // Placeholder = a NATURAL-LANGUAGE example, not the identifier-lookup framing (Eric 2026-08-03:
  // "since we are in the explore map I don't think we should say show contract # or uei, it should
  // be show me army, navy VA"). Explore is intent search — the NL parser (parseSearchIntent) reads
  // agency/set-aside/state/horizon + routes Opportunities-vs-Network — so the box should invite that.
  // (Contract#/company/UEI still resolve if typed — nothing narrowed; the placeholder just teaches
  // the primary use.)
  // ⚠️ REAL CHARACTERS, NEVER \uXXXX, in emitted HTML. This placeholder shipped for months
  // reading a literal "opportunities\u2026" in the map's MAIN search box — the most prominent
  // input in the product. A \uXXXX escape only un-escapes inside a JS string literal; here the
  // string is HTML being concatenated, so the browser prints the six characters verbatim.
  // (Inside the <script> blocks below the same escapes ARE correct — measured: 403 of them
  // resolve fine at runtime. The rule is about HTML attributes/text, not the whole file.)
  + '<input id="zsearchInput" type="text" name="opps-q" readonly onfocus="this.removeAttribute(\'readonly\')" placeholder="Show me Army, Navy, VA opportunities…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other" aria-label="Search opportunities">'
  + '<div class="zsp" id="searchPanel"></div></div></div>';
  // NOTE: "Generate market report" is NOT on the map (Eric 2026-08-01: most users
  // want saved-search alerts to bid, not reports — it's a rare feature). The
  // trigger lives on each SAVED SEARCH card (/opportunity-map/saved), beside
  // "View on map", where the market is already defined. The engine + the
  // /api/app/market-report route are unchanged; the saved page drives them.

// Custom Zillow-style sort menu. SORT_OPTIONS is the single source of truth (value → label).
// Rendered as: a HIDDEN native <select id="sort"> (keeps SORT_EXTRA_JS's change→render wiring) +
// a blue "Sort: <label> ▾" trigger + a white rounded menu of rows (✓ on the active one).
// Zillow parity (Eric 2026-07-27): the FIRST option is the named DEFAULT ("Recommended" — Zillow's
// "Homes for You"), value '' = the server's own sensible order. The trigger shows this by default so
// the UI never presents a specific dimension ("Deadline (soonest)") as if the USER chose it, and it's
// meaningless-for-awards label problem disappears. Picking a real dimension swaps the label (active).
const SORT_OPTIONS: Array<[string, string]> = [
  ['', 'Recommended'],
  ['deadline', 'Deadline (soonest)'],
  ['newest', 'Newest posted'],
  ['setaside', 'Set-aside opps first'],
  ['deadline-far', 'Deadline (latest)'],
  // Just "Value" — "Contract value (high to low)" wrapped to two lines in the Sort trigger
  // (Eric 2026-08-02). Low-to-high surfaces the SMALLEST contracts first — the SAP-friendly,
  // easier-entry opps a small-biz newcomer can actually win. Symmetric pair.
  ['value', 'Value (high to low)'],
  ['value-asc', 'Value (low to high)'],
  ['az', 'Title (A-Z)'],
];
// Companies (Contacts mode) sort by something sensible for a FIRM, not a deadline — $ won,
// award count, name, or set-aside firms first (reuses the 'setaside' value; the server ranks
// firms WITH a set-aside first, see companiesPins). Rendered as a SECOND menu, toggled by JS
// alongside SORT_OPTIONS depending on the active mode — "Sort: Deadline (soonest)" made no
// sense for companies (Eric, 2026-07-26).
const COMPANY_SORT_OPTIONS: Array<[string, string]> = [
  ['', 'Recommended'],
  ['value', 'Contract $ won (high to low)'],
  ['setaside', 'Set-aside firms first'],
  ['awards', 'Award count (high to low)'],
  ['az', 'Company name (A-Z)'],
];
const SORT_MENU_HTML =
    '<select id="sort" style="display:none">'
  + SORT_OPTIONS.map(([v]) => `<option value="${v}"></option>`).join('')
  + COMPANY_SORT_OPTIONS.map(([v]) => `<option value="co-${v}"></option>`).join('')
  + '</select>'
  + '<div class="sortmenu-wrap">'
  +   '<button type="button" class="sortmenu-btn" id="sortBtn"><span class="sortmenu-pre">Sort:</span> <span id="sortBtnLabel">Recommended</span>'
  +   '<svg viewBox="0 0 12 12" width="12" height="12" class="sortmenu-car"><path d="M3 4.5L6 8l3-3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>'
  +   '<div class="sortmenu" id="sortMenu" data-scope="opp">'
  +     SORT_OPTIONS.map(([v, l], i) => `<button type="button" class="sortmenu-item${i === 0 ? ' on' : ''}" data-sort="${v}">`
        + `<span class="sortmenu-check">✓</span>${l}</button>`).join('')
  +   '</div>'
  +   '<div class="sortmenu" id="sortMenuCo" data-scope="company" style="display:none">'
  +     COMPANY_SORT_OPTIONS.map(([v, l], i) => `<button type="button" class="sortmenu-item${i === 0 ? ' on' : ''}" data-sort="co-${v}">`
        + `<span class="sortmenu-check">✓</span>${l}</button>`).join('')
  +   '</div>'
  + '</div>';

// Mindy brand header bar (top, full width) — the wordmark + product name, Zillow-style.
// Zillow-style top nav: left nav links · CENTER logo · right nav + account.
const ZHEAD_HTML = '<header class="zhead">'
  // Mobile hamburger (≤640px only via CSS) — opens the #mDrawer rail menu. Leads the header
  // so the logo can center between it and the account avatar on phones.
  + '<button id="mHam" aria-label="Menu" onclick="window.__mDrawer&&window.__mDrawer(true)"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>'
  // Top nav = the plain noun for each corpus (Open · Vehicles · Contacts). The dropdown pill
  // says the same (Active · Vehicles · Contacts). Nav word and dropdown state are the same flow
  // (like Zillow's Buy → "For Sale"): each nav item drives setMapMode + syncs the pill.
  // "Recompetes" = active, in-performance contracts you learn about from the award record. NOT
  // "past" (the work is being done now) and NOT "vehicles" (jargon) — the tab names the ACTION:
  //  - an EXPIRING prime award → get ahead of the recompete (bid next cycle); OR
  //  - a running TASK ORDER under a live IDIQ → subcontract to the incumbent today.
  // (Eric 2026-07-27: "Awarded" sounded finished; "active but you learn about it from the past.")
  // TWO NETWORKS nav (Eric 2026-08-03, memory two_networks_opp_vs_network_map): the map is TWO
  // separate products under one "Explore" — Opportunity Map (THINGS / Zillow: "where's the work")
  // and NETWORK map (PEOPLE+ORGS / LinkedIn: "who's in the market" — contractors, incumbents,
  // agencies, buyers, SBLOs). NEVER merged. "Opportunities" defaults to Open (Recompetes/Forecast
  // are its dropdown sub-layers); "Players" defaults to
  // Companies (Gov Buyers is its dropdown sub-layer). "Pursuits" is the kanban board (links to /app).
  // "Explore" is a quiet eyebrow that groups the two maps (both are exploration) — not a link.
  + '<nav class="zh-left">'
  + '<span class="zh-explore">Explore</span>'
  + '<a class="zh-mode on" data-map="opportunities" data-mode="open" onclick="setMapMode(\'open\')">Opportunities</a>'
  + '<a class="zh-mode" data-map="players" data-mode="companies" onclick="__playersGate(\'companies\')">Players</a>'
  // DLA is NOT a top-nav link (Eric 2026-08-01: "leave in dropdown, remove from header"). It's the
  // 3rd option in the dataset dropdown only — no separate nav pill. The dropdown still drives
  // setMapMode('dla') and _activeMap='dla' still lights nothing in this nav (which is intended).
  + '<a href="/opportunity-map/pursuits">Pursuits</a>'
  // MARKETS = the market-intelligence surface, served by /opportunity-map/reports. It is the ONLY
  // top-nav item that is deliberately NOT in the left rail (Eric 2026-08-15: "put reports back on
  // the top bar and rename it to markets"). The rail is the DISCOVERY workspace — the two maps
  // plus what you accumulate while browsing; Markets is a destination you choose, so it lives in
  // the nav. The ROUTE stays /reports (a rename would break the Share links and every saved
  // bookmark); only the LABEL is "Markets". Both facts are pinned by map-rail-inventory.unit.test.ts.
  + '<a href="/opportunity-map/reports">Markets</a>'
  // Ask Mindy nav doorway REMOVED for now (Eric 2026-08-03: "remove ask Mindy for now"). The drawer
  // code (ASK_MINDY_JS / window.openAskMindy) is left intact but has NO entry point, so nothing opens
  // it — re-add this <a class="zh-ask"> link + the search-panel zsp-ask rows to bring it back.
  + '</nav>'
  + '<a href="/app" title="Mindy" class="zh-logo"><img src="/brand/mindy-logo-icon.png" alt=""/><span>Mindy</span></a>'
  + '<nav class="zh-right">'
  // Ask Mindy now lives in the LEFT nav (after Pursuits, per the approved mockup) — the redundant
  // right-side purple pill was removed 2026-08-02 so there's ONE header doorway (nav) + the map's
  // floating button, not two competing entries. window.openAskMindy is defined by ASK_MINDY_JS.
  // "Bid with confidence" moved to the RIGHT of the Mindy logo (Eric 2026-08-01), out of the left nav.
  + '<a href="/bid">Bid with confidence</a>'
  + '<a href="/pricing">Pricing</a>'
  // "My Pursuits" moved to the LEFT primary nav as "Pursuits" (the two-map + board split,
  // 2026-07-30) — dropped here to avoid the duplicate. Still reachable in the account menu.
  // Profile avatar + account dropdown (Zillow-style) — shared verbatim with the
  // favorites + saved pages via ./account-menu. Replaces the old plain /app link.
  + ACCOUNT_MENU_HTML
  + '</nav></header>';

// Set-aside color legend REMOVED (Eric, Jul 26): Open pins are now all ONE color (green) — the value-
// TAG number is the signal, not the color, so a 6-swatch set-aside legend was misleading clutter ("too
// many things to understand"). Set-aside is still filterable (the Set-aside dropdown) and shown on
// every card/drawer. Kept as an empty string so the LEGEND_HTML injection site is a harmless no-op.
// (Earlier the "hollow = buying office" line was removed too — all pins render solid now.)
const LEGEND_HTML = '';

// ── Mobile chrome (phone ≤640px) — all display:none above 640px via CSS. ──────────────
// The floating Map/List toggle (Zillow) + the slide-in drawer that replaces the fixed rail.
// The drawer mirrors ZRAIL_HTML's destinations + the two-map nav (Opportunities/Network) so
// a phone user reaches every section the desktop rail/header exposes. Rail links go to real
// routes; the two map-mode links call setMapMode (already defined by VIEWPORT_JS).
const MOBILE_HTML = ''
  + '<button id="mToggle" onclick="window.__mToggle&&window.__mToggle()">'
  +   '<svg id="mToggleIcon" viewBox="0 0 24 24"><path d="M9 3L4 5v16l5-2 6 2 5-2V3l-5 2-6-2z"/><path d="M9 3v16M15 5v16"/></svg>'
  +   '<span id="mToggleLbl">Map</span></button>'
  + '<div id="mScrim" onclick="window.__mDrawer&&window.__mDrawer(false)"></div>'
  + '<nav id="mDrawer" aria-label="Navigation">'
  +   '<div class="md-brand"><img src="/brand/mindy-logo-icon.png" alt=""/><b>Mindy</b></div>'
  +   '<div class="md-lbl">Explore</div>'
  +   '<a class="on" onclick="try{setMapMode(\'open\')}catch(e){};window.__mDrawer&&window.__mDrawer(false)"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Opportunities</a>'
  +   '<a onclick="try{setMapMode(\'companies\')}catch(e){};window.__mDrawer&&window.__mDrawer(false)"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="10" r="2.4"/><path d="M3.5 19a5.5 5.5 0 0111 0M14 19a4 4 0 016.5-3.1"/></svg>Players</a>'
  +   '<a href="/opportunity-map/reports"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg>Markets</a>'
  +   '<div class="md-sep"></div>'
  +   '<div class="md-lbl">Your workspace</div>'
  +   '<a href="/opportunity-map/saved"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>Watchlist</a>'
  +   '<a href="/opportunity-map/favorites"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg>Saved</a>'
  +   '<a href="/opportunity-map/pursuits"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>Pursuits</a>'
  +   '<div class="md-sep"></div>'
  +   '<a href="/pricing"><svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>Pricing</a>'
  +   '<a href="/bid"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>Bid with confidence</a>'
  + '</nav>';

// Wiring for the mobile chrome. body.m-map = MAP layer shown (invalidate Leaflet size so it
// paints correctly after being visibility:hidden); body.m-drawer = drawer open. Both no-ops on
// desktop (the elements are display:none). Guarded so a missing `map` never throws.
const MOBILE_JS = '<script>(function(){'
  + 'window.__mToggle=function(){'
  +   'var on=document.body.classList.toggle("m-map");'
  +   'var lbl=document.getElementById("mToggleLbl");if(lbl)lbl.textContent=on?"List":"Map";'
  +   'var ic=document.getElementById("mToggleIcon");'
  +   'if(ic)ic.innerHTML=on'
  +     '?\'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>\''  // list icon
  +     ':\'<path d="M9 3L4 5v16l5-2 6 2 5-2V3l-5 2-6-2z"/><path d="M9 3v16M15 5v16"/>\';'  // map icon
  +   'if(on){try{setTimeout(function(){try{map.invalidateSize();fitView&&fitView();}catch(e){}},60);}catch(e){}}'
  + '};'
  + 'window.__mDrawer=function(open){document.body.classList.toggle("m-drawer",!!open);};'
  // Close the drawer on Escape / back-gesture safety.
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")window.__mDrawer(false);});'
  + '})();</script>';

// Viewport-driven data layer (Airbnb/Google): the template ships a static SSR pin set; this
// swaps it for a live bbox fetch on every pan/zoom against /api/app/opportunity-map. Reuses
// the template's own render()/markers/list-sync verbatim — only the DATA source changes.
// The header is promoted to a dynamic "N of TOTAL" hero (reacts to filters + viewport, the
// Zillow/Airbnb convention); SDVOSB/closing is demoted to a small secondary line. select() is
// wrapped so clicking a card whose pin is inside a cluster zooms to reveal it first.
const VIEWPORT_JS = `<script>
(function(){
  var SETMAP={SDVOSB:'SDVOSB',SB:'SB','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone',OTHER:'Other',NONE:'None'};
  // Company set-aside chip colors — reuses the map's existing legend palette exactly (see
  // LEGEND_HTML): SDVOSB green, Small Biz blue, 8(a) purple, WOSB red, HUBZone amber.
  var SET_CHIP_COLOR={SDVOSB:'#22a06b',SB:'#3b82f6','8A':'#8b5cf6',WOSB:'#ef4444',HZ:'#f59e0b'};
  var SET_CHIP_LABEL={SDVOSB:'SDVOSB',SB:'Small Biz','8A':'8(a)',WOSB:'WOSB',HZ:'HUBZone'};
  // Zillow-style dataset modes (For Sale / Rent / Sold). Each = a distinct corpus + endpoint.
  // Companies + Gov Buyers (2026-07-26): 4 FLAT datasets — no more Companies|Buyers sub-toggle.
  // Both still hit /api/app/contacts-map (?type=companies|buyers), just selected via the
  // dataset dropdown/nav directly instead of a nested control.
  var MODES={
    open:{ ep:'/api/app/opportunity-map', title:'Open Opportunities', unit:'active opportunities' },
    forecast:{ ep:'/api/app/forecast-map', title:'Forecasts', unit:'upcoming opportunities' },
    grants:{ ep:'/api/app/grants-map', title:'Grants', unit:'open grants' },
    recompete:{ ep:'/api/app/recompete-map', title:'Recompetes', unit:'expiring contracts' },
    companies:{ ep:'/api/app/contacts-map', ctype:'companies', title:'Companies', unit:'companies' },
    buyers:{ ep:'/api/app/contacts-map', ctype:'buyers', title:'Government Buyers', unit:'buyers' },
    // DLA = its OWN top-level map (3rd, sibling to Opportunities/Players). A DLA/DIBBS supply RFQ
    // is a "bid" client's map (price the NSN, quote on DIBBS) — a different profile than the BD
    // market-research client on Opportunities. Uses the opportunity-map endpoint scoped to DLA only
    // (sources=dla → getDibbsViewportPins) + an FSC supply-class filter (DLA's real taxonomy, NOT
    // NAICS). Removing the old Source dropdown that used to mix DLA into Open. (Eric 2026-07-31.)
    dla:{ ep:'/api/app/opportunity-map', dla:true, title:'DLA Supply Bids', unit:'DLA supply RFQs' }
  };
  var MODE='open'; window.__mapMode='open';
  function isContactMode(m){ return m==='companies'||m==='buyers'; }
  // Dataset-level color (Eric 2026-07-26): a COMPANY (a contractor you compete/team with) and a
  // GOV BUYER (who awards the contract) are opposite sides of the table — distinguish the DATASETS.
  // Companies = purple, Gov Buyers = authority RED. Keyed on the ctype, NOT per-set-aside (that
  // per-pin coloring was removed with the legend, #476). COMPANY_COLOR/BUYER_COLOR are the two
  // dataset accents; contactColorFor(o) returns the right one for a row, so pins/popup/card/drawer
  // all agree. Open green · Awarded amber · Companies purple · Gov Buyers red.
  var COMPANY_COLOR='#7c3aed'; // purple
  var BUYER_COLOR='#dc2626';   // authority red — the buyer side
  function contactColorFor(o){ return (o&&o.ctype==='buyers')?BUYER_COLOR:COMPANY_COLOR; }
  // CONTACT_COLOR retained as the CURRENT-dataset accent (used where no row is in hand, e.g. the
  // buyer drawer accent); kept in sync with MODE by setMapMode.
  var CONTACT_COLOR=COMPANY_COLOR;
  var HIDE_FSC=false, TOTAL=0, CAPPED=false, INVIEW=0, busy=false, pendingFetch=false, t=null, t2=null, Q='';
  // Called when a fetch finishes: if a request came in WHILE it was busy (e.g. a search query typed
  // mid-fetch), run it now so the latest state always gets fetched. Deferred a tick so busy is false.
  function afterFetch(){ if(pendingFetch){ pendingFetch=false; setTimeout(function(){ try{fetchView();}catch(e){} },0); } }
  // Server-wired filter state (the reorg). Every control writes here, then fetchView()
  // sends them as query params so the filter is applied by the DB for the current
  // viewport — and survives panning, instead of hiding already-fetched pins.
  var FILT={ scope:'all', noticeType:'', setAside:'', fullOpen:false, closingDays:'', agency:'', office:'', state:'',
    naics:'', psc:'', fsc:'', postedDays:'', setAsideMulti:'', noticeMulti:'', valueRange:'',
    subAgency:'', country:'', hasDocs:'', hasContact:'', sap:'', likelihood:'', leadMax:'', sapBuyer:'',
    strategy:[] };
  // ── Ask-Mindy context bridge ────────────────────────────────────────────────
  // The Ask Mindy drawer runs in its OWN IIFE and can't see these locals. Publish a
  // GETTER (not a snapshot) so it always reads the LIVE view: how many opps match in
  // the current viewport, and every active filter. Every field is a REAL number/value
  // off the map's own state — the drawer never fabricates the context line, and it
  // threads the same filters into the chat so answers are about THIS view.
  window.__mindyViewCtx = function(){
    function pick(){ for(var i=0;i<arguments.length;i++){ var v=arguments[i]; if(v!=null&&v!=='') return v; } return ''; }
    return {
      count: (typeof INVIEW==='number'&&INVIEW>0)?INVIEW:(typeof TOTAL==='number'?TOTAL:0),
      capped: !!CAPPED,
      q: (Q||'').trim(),
      scope: FILT.scope||'all',
      state: (FILT.state||'').toUpperCase(),
      naics: pick(FILT.naics),
      psc: pick(FILT.psc, FILT.fsc),
      setAside: pick(FILT.setAside, FILT.setAsideMulti),
      agency: FILT.agency||'',
      noticeType: pick(FILT.noticeType, FILT.noticeMulti)
    };
  };
  // Continue the current search INTO market research: carry the live Q+FILT to the Market sub-view.
  // The rail "Market" item calls this so the search originates from the map (Eric 2026-08-02).
  window.openMarketView = function(ev){
    if(ev&&ev.preventDefault)ev.preventDefault();
    var c=window.__mindyViewCtx(), qs=[];
    if(c.q)qs.push('q='+encodeURIComponent(c.q));
    if(c.naics)qs.push('naics='+encodeURIComponent(c.naics));
    if(c.psc)qs.push('psc='+encodeURIComponent(c.psc));
    if(c.agency)qs.push('agency='+encodeURIComponent(c.agency));
    if(c.setAside)qs.push('setAside='+encodeURIComponent(c.setAside));
    if(c.state)qs.push('state='+encodeURIComponent(c.state));
    location.href='/opportunity-map/market'+(qs.length?'?'+qs.join('&'):'');
    return false;
  };
  try{ var zt=document.querySelector('.ztop'), zf=document.querySelector('.fbar');
    if(zt&&zf){ zt.appendChild(zf); setTimeout(function(){try{map.invalidateSize();}catch(e){}},80); } }catch(e){}
  function clean(d){ return (d||'').replace(/,?\\s*DEPARTMENT OF( THE)?/i,'').replace(/DEPARTMENT OF( THE)?\\s*/i,'').trim().replace(/\\b([A-Z])([A-Z0-9'&.\\/-]*)/g,function(m,a,b){ if(/^(?:[A-Z]\\.){2,}$/.test(m))return m; return a+b.toLowerCase(); })||d; }
  // ── Display-case normalizers (map cleanup 2026-08-12) ───────────────────────────────────────
  // Names and cities arrive from SAM / federal_contacts in whatever case the source typed them:
  // "EICHELBERGER, ELIZABETH" and "LEAVENWORTH" sit in the SAME list as "Kevin A Mahoney" and
  // "Bethesda". Normalize ONLY a string that is effectively ALL-CAPS, so a correctly-cased name is
  // never re-mangled. clean() is deliberately NOT reused here — it strips "DEPARTMENT OF", which is
  // right for an agency and destructive for a person or a city.
  function _shouty(s){ s=String(s||''); return s.length>1 && s===s.toUpperCase() && /[A-Z]/.test(s); }
  function _titleCase(s){
    return String(s||'').toLowerCase()
      .replace(/([a-z])([a-z'\\u2019.-]*)/g,function(m,a,b){ return a.toUpperCase()+b; })
      // Surnames whose real form carries an INTERNAL capital. Plain title-case flattens them
      // ("McDonald"->"Mcdonald", "O'Brien"->"O'brien"), which looks like a different person.
      .replace(/\\bMc([a-z])/g,function(m,c){ return 'Mc'+c.toUpperCase(); })
      .replace(/\\bO([\\u2019'])([a-z])/g,function(m,q,c){ return 'O'+q+c.toUpperCase(); })
      // Generational suffixes are numerals/abbreviations, not words.
      .replace(/\\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix)\\b/g,function(m){ return m.toUpperCase(); })
      .replace(/\\b(Jr|Sr)\\.?\\b/g,'$1.');
  }
  // A person, not a company: federal_contacts stores both "FIRST LAST" and "LAST, FIRST" forms.
  // NEVER use this on a company name — "ACS RITZ JV, LLC" would flip to "LLC ACS RITZ JV".
  function personName(n){
    var s=String(n||'').trim(); if(!s)return '';
    if(!_shouty(s))return s;
    var m=s.match(/^([^,]+),\\s*(.+)$/);
    if(m)s=m[2].trim()+' '+m[1].trim();
    return _titleCase(s);
  }
  function cityCase(c){ var s=String(c||'').trim(); return _shouty(s)?_titleCase(s):s; }
  // modeHint = which horizon this pin came from (open|recompete|forecast|grants|companies|buyers).
  // The Opportunities map now MERGES horizons, so toRow can NOT key off the global MODE (it's always
  // 'open' during a merge) — the caller passes the fetched horizon so recompete pins get the
  // recompete shape. Falls back to MODE when no hint (contacts path, legacy single-fetch). The
  // open/forecast/grants pins all take the last branch (keyed off p.src, already correct). (2026-07-31)
  function toRow(p,modeHint){
    var _m=modeHint||MODE;
    if(isContactMode(_m)){
      // Contacts pins. companies = a contractor firm; buyers = a gov POC. Both keyed by id
      // (used as the marker key + card data-sol). loc = "City, ST" (or just state).
      // locPrecision ('city'|'state') comes straight from the shared geocoder — 'state' means
      // this pin is an honest state-centroid approximation, not a confirmed city hit.
      var loc = p.city ? (cityCase(p.city)+', '+p.state) : (p.state||'');
      if(_m==='buyers'){
        // Buyer agency/city/state are already CLEANED + coherence-validated server-side
        // (formatAgencyDisplay + resolveBuyerLocation in contacts-map) — do NOT re-run
        // clean() here (it would strip "Department of State" back down to a bare "State"),
        // and the location is guaranteed a real city↔state pair or state-only (never a
        // foreign city on a US state). locApprox → the state is the buying office, not PoP.
        if(p.locApprox && p.state && !p.city) loc = p.state+' (buying office)';
        // personName (NOT clean()): the roster mixes "EICHELBERGER, ELIZABETH" with "David Shen".
        return {src:'CONTACT',ctype:'buyers',title:personName(p.name),agency:p.agency||'Government',role:p.title||'',office:clean(p.office||''),loc:loc,sol:String(p.id),nid:String(p.id),lat:p.lat,lng:p.lng,locPrecision:p.locPrecision||'city'};
      }
      // won = $ obligated (real per-firm total_obligated) → the value tag. Buyers get no $ (dot).
      return {src:'CONTACT',ctype:'companies',title:p.name,agency:'',meta:p.meta||'',won:p.totalObligated||0,totalObligated:p.totalObligated||0,awardCount:p.awardCount||0,distinctAgencyCount:p.distinctAgencyCount||0,loc:loc,sol:String(p.id),nid:String(p.id),lat:p.lat,lng:p.lng,setAsides:p.setAsides||[],locPrecision:p.locPrecision||'city'};
    }
    if(_m==='recompete') return {src:'RECOMPETE',title:p.title,cat:p.cat,contractType:p.contractType||'',agency:clean(p.agency),subAgency:clean(p.subAgency||''),naics:p.naics,set:SETMAP[p.set]||'None',value:p.value,valueNum:p.valueNum||0,exp:(p.exp||'').slice(0,10),loc:p.loc,state:p.state||'',sol:p.sol,nid:p.id,lat:p.lat,lng:p.lng,locSrc:p.locPrecision==='city'?'pop':'office',uei:p.uei||null,synced:p.synced||null};
    // est = M-Estimate median (intel_value_range.median) → the value tag; null → a neutral dot.
    // src comes from the SERVER (SAM | DLA) — the Open dataset now mixes both, and the UI keys
    // the source chip/color/filter off it (SRCLABEL, .chip.DLA). Defaulting to 'SAM' would
    // relabel DIBBS pins as SAM and drop them out of the "Where it came from" DLA filter.
    // src from the SERVER: SAM | DLA | SBIR | FORECAST | GRANTS. FORECAST is the "coming work"
    // horizon (violet pin via srcColor's o.src==='FORECAST' branch), so it must survive here —
    // falling to 'SAM' would color it green (Open) and mislabel it. GRANTS is apply-for-now funding
    // — it rides the open-green horizon (srcColor else branch), but the src must survive so the
    // "Where it came from" chip reads Grants, not SAM (Eric 2026-07-30/31).
    var _src=(p.src==='DLA'?'DLA':(p.src==='SBIR'?'SBIR':(p.src==='FORECAST'?'FORECAST':(p.src==='GRANTS'?'GRANTS':'SAM'))));
    // DLA is FSC-coded, not NAICS — the card's code cell shows the FSC supply class for DLA pins
    // (the title already leads with "5999-- …"; pull that 4-digit FSC so the cell isn't a blank NAICS).
    // isDla flags the card so its code column can label "FSC" instead of "NAICS". (Eric 2026-08-01.)
    var _isDla=(_src==='DLA');
    var _dlaFsc=_isDla?((p.fsc||'')||((/^(\d{4})/.exec(p.title||'')||[])[1]||'')):'';
    // DNA identity signal (Opportunity DNA slice 1): SB-friendly BEHAVIOR badge = the buyer's real
    // measured PO-share tier (sapBuyerTier, GOS #11). Open opps only (recompetes carry their own SAP
    // model). Only the TOP band ('most') earns the badge — an honest signal, never fabricated; the
    // card shows it only when true. Threaded onto the pin object so the client card can render it
    // with zero extra query. (Eric 2026-08-03, tasks/EPIC-opportunity-dna.md.)
    // p.sbf is computed SERVER-SIDE (sapBuyerTier lives in a server lib — calling it here throws a
    // ReferenceError in the browser, which made toRow throw → the whole open horizon .map() rejected
    // → open recorded total 0 → "Open: 0" while Open genuinely returned 5,170. Read the pre-computed
    // flag, never call the server fn from client code. (Eric 2026-08-03 — fixes the DNA-slice regression.)
    var _sbf=(_src!=='RECOMPETE'&&_src!=='FORECAST'&&p.sbf)?1:0;
    // fits = "Fits your NAICS" chip — the API sets p.fits when scope=profile and this opp's NAICS is in
    // the signed-in user's profile codes (grounded server-side, honest-null when signed out). Repeat
    // buyer chip is a fast-follow (needs per-opp award history) — not faked here.
    // dna = the Opportunity DNA genome (grounded strands), computed SERVER-SIDE in the API decorate
    // (genome.ts) and shipped on the open (SAM) pin. Threaded onto the row so the drawer renders it
    // (pursueSignals) with zero client compute. Absent on RECOMPETE/FORECAST pins built elsewhere →
    // [] here, and pursueSignals falls back to its own signal logic for those (no regression).
    return {src:_src,isDla:_isDla,naics:(_isDla?_dlaFsc:p.naics),fsc:_dlaFsc,cat:p.cat,title:p.title,agency:clean(p.agency),set:SETMAP[p.set]||'None',loc:p.loc,close:(p.close||'').slice(0,10),sol:p.sol||p.id,nid:p.id,uiLink:p.uiLink,lat:p.lat,lng:p.lng,locSrc:p.locSrc,subAgency:clean(p.subAgency||''),office:p.office||'',noticeType:p.noticeType||'',docs:!!p.docs,pocs:p.pocs||0,posted:(p.posted||'').slice(0,10),est:p.est||0,estN:p.estN||0,estLow:p.estLow||0,estHigh:p.estHigh||0,estRange:p.estRange||'',sbf:_sbf,fits:!!p.fits,dna:(Array.isArray(p.dna)?p.dna:[])};
  }
  // A location-less forecast → a LIST-ONLY forecast card (lat/lng null = no pin). Same FORECAST
  // shape as toRow's forecast branch, but the location cell shows the honest "no location" reason
  // (o.noLoc) and noPin=true flags it so the card renders a muted "\\ud83d\\udccd no location yet"
  // instead of a place, and clicking it never tries to fly the map to a coordinate.
  function unplacedToRow(u){
    return {src:'FORECAST',noPin:true,naics:u.naics||'',cat:u.cat||'Forecast',title:u.title,agency:clean(u.agency||''),set:SETMAP[u.set]||'None',loc:u.noLoc||'No location yet',noLoc:u.noLoc||'No location yet',close:(u.close||'').slice(0,10),sol:u.id,nid:u.id,uiLink:null,lat:null,lng:null,locSrc:'none',est:u.est||0,estRange:u.estRange||''};
  }
  function bbox(){
    // When the user has drawn an area (Draw button), query THAT rectangle instead of the
    // full viewport — Zillow's draw-to-filter. window.__drawBounds is set by DRAW_JS.
    var b = (window.__drawBounds) ? window.__drawBounds : map.getBounds();
    return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(function(n){return n.toFixed(4);}).join(',');
  }
  window.__mapRefetch = fetchViewLater; function fetchViewLater(){ try{ fetchView(); }catch(e){} }
  // Global bridge for the ?strategy= deep link. Same cross-block hazard as __applySearchFilters
  // below: the deep-link handler lives in DRAWER_JS, a SEPARATE <script> IIFE, so its guard
  // its "typeof readDeep === function" guard was ALWAYS false — readDeep/fetchView are locals,
  // never globals. The retry loop then spun 40x and gave up silently, so ?strategy= applied
  // NOTHING while the URL looked right. Measured broken on prod 2026-08-15, on the two surfaces
  // that emit it: the /app "Open Today's Lens" hero and the daily alert "Open Today's Map" button.
  // Reads whatever .mf-strategy boxes the caller checked into FILT and refetches. Returns the
  // strands actually applied so the caller can name them honestly in the pill.
  window.__applyStrategyBoxes = function(){
    try{
      var applied=Array.prototype.slice.call(document.querySelectorAll('.mf-strategy:checked')).map(function(el){return el.value;});
      if(readDeep()!==false)fetchView();
      return applied;
    }catch(e){ return []; }
  };
  // Global bridge for the natural-language search bar (SEARCH_PANEL_JS is a SEPARATE <script> IIFE,
  // so it can NOT touch FILT / fetchView directly — those are VIEWPORT_JS locals). It parses intent,
  // then hands the recognized filters here, where FILT is in scope. Applies + reflects the chips +
  // refetches. Returns true if it applied anything. (Eric 2026-08-03 — "Show me Army opportunities".)
  window.__applySearchFilters = function(intent){
    if(!intent) return false; var applied=false;
    // TWO-NETWORKS routing (Eric 2026-08-03): a query names WHICH map. Switch to it BEFORE applying so
    // "biggest VA contractors in Florida" (dataset=players) lands on the Network map and "Army
    // opportunities" (dataset=opportunities) lands on the Opportunity map. Same AI, different
    // destination. setMapMode early-returns if the mode already matches. We recompute _players AFTER.
    if(intent.dataset && typeof setMapMode==='function'){
      var _wantContact=(intent.dataset==='players');
      var _isContact=(typeof isContactMode==='function' && isContactMode(MODE));
      if(_wantContact && !_isContact){ setMapMode('companies'); applied=true; }
      else if(!_wantContact && _isContact){ setMapMode('open'); applied=true; }
    }
    // Players (Companies + Gov Buyers) vs Opportunities take DIFFERENT filter controls, but the AGENCY
    // chip now applies on BOTH (2026-08-03: companies-by-agency shipped — searchRecipients scans awards
    // by awarding_agency/awarding_sub_agency when agency is set). State + set-aside + "biggest"→sort
    // continue to work as before on Players. (_players read AFTER any dataset switch above.)
    var _players=(typeof isContactMode==='function' && isContactMode(MODE));
    // Agency chip: both Opportunities and Players now light it + apply it as a real filter.
    if(intent.agency){ FILT.agency=intent.agency; var mfA=document.getElementById('mfAgency'); if(mfA)mfA.value=intent.agency;
      var lbl=document.getElementById('agencyLabel'); if(lbl)lbl.textContent=intent.agency;
      var ab=document.getElementById('agencyBtn'); if(ab)ab.classList.add('on'); applied=true; }
    if(intent.state){ FILT.state=intent.state; var mfS=document.getElementById('mfState'); if(mfS)mfS.value=intent.state; applied=true; }
    if(intent.setAside){ FILT.setAsideMulti=(FILT.setAsideMulti?FILT.setAsideMulti+',':'')+intent.setAside; applied=true; }
    if(intent.horizon && !_players){ if(window.__horizons){ window.__horizons[intent.horizon]=true; } if(window.__syncHorizonCounts)window.__syncHorizonCounts(); applied=true; }
    // "biggest/top" → sort by $ won. Players only (companies sort is server-side, value=high→low). Set
    // the companies sort + reflect the sort-menu label/select so it reads "Contract $ won (high to low)".
    if(intent.bigSort && _players){ window.__companySort='value';
      var _hs=document.getElementById('sort'); if(_hs){ _hs.value='co-value'; }
      try{ var _mc=document.getElementById('sortMenuCo'); if(_mc){ var _items=_mc.querySelectorAll('.sortmenu-item'); Array.prototype.forEach.call(_items,function(it){ var on=it.getAttribute('data-sort')==='co-value'; it.classList.toggle('on',on); if(on){ var _l=document.getElementById('sortBtnLabel'); if(_l)_l.textContent=(it.textContent||'').replace(/^\\s*\\u2713\\s*/,'').trim(); } }); } }catch(e){}
      applied=true; }
    // The agency word is now a REAL filter on Players too (companies-by-agency shipped), so it's no
    // longer restored as a keyword fallback — keeping it in the keyword box AND the agency chip would
    // double-apply the same word (AND together, narrowing further than intended).
    var _kw=(typeof intent.keyword==='string')?intent.keyword:'';
    Q=_kw; window.__lastAppliedKeyword=_kw; // the box reflects the ACTUAL applied keyword
    // Reflect the "Filters N" badge (count of active filter groups) so the applied search shows there too.
    if(applied){ try{ var _n=0; [FILT.naics,FILT.psc,FILT.agency,FILT.office,FILT.subAgency,FILT.state,FILT.setAsideMulti,FILT.fullOpen,FILT.noticeMulti,FILT.valueRange,FILT.closingDays].forEach(function(g){ if(g)_n++; });
      var _bd=document.getElementById('mfBadge'); if(_bd){ if(_n>0){ _bd.textContent=String(_n); _bd.hidden=false; } else { _bd.hidden=true; } }
      var _mb=document.getElementById('moreBtn'); if(_mb)_mb.classList.toggle('hasfilt',_n>0); }catch(e){}
      // A state filter is useless if the viewport can't see it (Players/Companies pins are bbox-scoped
      // — a US-wide view with State=FL renders "No contacts in view"). Pan to the state centroid so the
      // filtered results are actually visible. This is NOT auto-fit-to-pins; it just makes State work.
      if(intent.state){ try{ var _c=window.__STATE_CENTROIDS && window.__STATE_CENTROIDS[intent.state]; if(_c && typeof map!=='undefined')map.setView(_c,6,{animate:true}); }catch(e){} }
      fetchView(); }
    return applied;
  };
  // (Removed the header source badge — Eric 2026-07-27: the data source does NOT belong in the
  // sidebar header. Zillow credits the source on the LISTING/detail, not the results header. Our
  // per-dataset source now lives ONLY in the drawer Overview's freshness line — freshnessSec():
  // "Live from SAM.gov · updated <when> · Solicitation …" / "From USASpending award records …" etc.)
  // Zillow's map-corner count: "500 of 94,509 homes" (Eric 2026-08-13). Lives ON THE MAP because
  // it describes THE MAP — how many pins you are actually looking at out of everything that
  // matches. The right rail keeps the plain match total; the two answer different questions and
  // that is why the fraction reads as noise in the rail and as information here.
  //
  // Shares the top-left slot with #zoomHint and must never be visible at the same time: below
  // PIN_DOT_ZOOM there are no pins to count, so the hint owns the corner and this hides.
  function setMapCount(shown,total,more){
    var el=document.getElementById('mapCount'); if(!el)return;
    var zFar=(typeof pinTooFar==='function')&&(typeof map!=='undefined')&&pinTooFar(map);
    if(zFar||!total){ el.hidden=true; return; }
    var unit=(typeof isContactMode==='function'&&isContactMode(MODE))?'contacts':'opportunities';
    // Only show a fraction when we genuinely plot fewer than match — "8,060 of 8,060" implies a
    // cap that isn't there. shown>0 keeps a mid-fetch 0 from rendering "0 of 136,882".
    el.textContent=(more&&shown>0&&total>shown)
      ? shown.toLocaleString()+' of '+total.toLocaleString()+' '+unit
      : total.toLocaleString()+' '+unit;
    el.hidden=false;
  }
  function updateHeader(){
    // On the Opportunities map all 4 horizons coexist, so the title is just "Opportunities" (not
    // "Open Opportunities" — MODE is always 'open' there but the view is the mix). Players keep their
    // dataset title.
    // Players map = Companies + Gov Buyers merged → title "Players" (not "Companies"); Opportunities
    // map = the 4 horizons merged → "Opportunities".
    // ⚠️ LABEL HISTORY: this said "Network" from 2026-08-03 until Eric reverted it 2026-08-15
    // ("change network back to players everywhere"). The two-MAPS product split is UNCHANGED and
    // still correct — Opportunities = things to win, Players = who is in the market, never merged.
    // ONLY the user-facing label of the second map moved back. Do not "restore" Network from the
    // older decision note; the memory two_networks_opp_vs_network_map records the reversal.
    var _title=(MODE==='companies'||MODE==='buyers')?'Players':'Opportunities';
    var brand=document.querySelector('.brand'); if(brand)brand.textContent=_title;
    if(!TOTAL)return; // nothing loaded yet — keep the prior header until data arrives
    var shown=(typeof rows!=='undefined'&&rows)?rows.length:OPPS.length;
    // ONE number, Zillow-style (Eric, Jul 26): the map viewport IS the scope, so the header shows a
    // SINGLE count = "<N> <unit> in this area" where N is how many match your filters in the CURRENT
    // view (INVIEW = totalInView from the API; falls back to the loaded count if the API didn't send
    // it). The old header exposed THREE numbers at once ("368+ of 433 in view · 10,517 total") —
    // loaded-vs-in-view-vs-whole-filter-set — which read as "368 of 433" and invited a false compare
    // to the ~10K SAM total. Zillow shows just the current-view count, no "X of Y", no database total.
    // When more match than we can plot → a plain "zoom in to see more" cue, not a rendered fraction.
    // The HONEST count = the real filter-set total (TOTAL = sum of each horizon's totalForFilters),
    // NOT the pin cap. A capped horizon returns totalInView=1,000 (the cap) but totalForFilters=7,501
    // (real) — showing 1,000 read as a suspiciously round, wrong number (Eric 2026-07-31: "1,000
    // exactly looks fishy"). Prefer TOTAL when it exceeds the in-view/loaded count; the "+ zoom in to
    // see more" cue (below) tells the user not all are plotted.
    var n=Math.max(TOTAL||0, (INVIEW && INVIEW>0)?INVIEW:shown);
    var more=(CAPPED || (TOTAL && TOTAL>shown));
    // Zillow shows the count ONCE (on the sort row, "132 results") and the subtitle is a DESCRIPTIVE
    // LABEL with NO number ("Real Estate & Homes For Sale"). We were repeating the number in BOTH the
    // FINAL layout (Eric struck the subtitle line through in red, Jul 26): title = category
    // ("Open Opportunities"), NO wordy subtitle line at all, and the count is BOLD on the sort row
    // ("8,060 results" · Sort: Deadline) — exactly Zillow's for-sale layout. This block flip-flopped
    // in earlier rounds (count-in-subtitle vs count-on-sort-row); this is the settled version: DELETE
    // the subtitle, keep the bold "N results" on the sort row. Do not reintroduce the subtitle line.
    var sum=document.getElementById('sumline');
    if(sum)sum.innerHTML=''; // no subtitle line — the "N active opportunities in this area" line is removed
    // The plotted-of-matched FRACTION belongs ON THE MAP, not here — Zillow puts "500 of 94,509
    // homes" in the map's top-left corner and keeps the right rail a plain "94,509 results"
    // (Eric 2026-08-13, with both screenshots side by side). A brief pass on 2026-08-12 put the
    // fraction in this rail instead; that was the wrong surface and is reverted. The rail is the
    // LIST's count, so it answers "how many match" — the map pill answers "how many am I seeing".
    // The Jul-26 "ONE number on the sort row" decision therefore stands HERE, unchanged.
    var rc=document.getElementById('rescount'); if(!rc)return;
    rc.innerHTML='<span style="font-weight:700;color:var(--ink)">'+n.toLocaleString()+'</span> <span style="font-weight:400;color:var(--sub)">result'+(n===1?'':'s')+'</span>';
    setMapCount(shown,n,more);
    // Zillow's "Show N results" on the Filters Apply button — the live count of what the CURRENT view
    // holds, refreshed on every fetch so the user sees the number their filters return.
    updateApplyCount(n);
    // Contacts (Companies/Buyers): matches are geocoded to a location, so a search can match firms
    // that fall OUTSIDE the current viewport → 0 in view while TOTAL (match count) is >0. Show the
    // honest "· N match nearby — zoom out" hint instead of a bare "0 results" that looks broken.
    // (Open opps use the same viewport contract but their count IS the in-view count, so no hint.)
    if(isContactMode(MODE) && n===0 && TOTAL>0){
      rc.innerHTML='<span style="font-weight:700;color:var(--ink)">0</span> <span style="font-weight:400;color:var(--sub)">in view · '+TOTAL.toLocaleString()+' match — zoom out</span>';
    }
  }
  // Auto-fit the view to the actual returned markers so the map opens FRAMED ON THE DATA — not
  // the hardcoded country center ([38,-96] z4.5) that left the whole West half empty until the
  // user panned. Runs ONCE per load and once per dataset-mode switch (not on every pan — we don't
  // fight the user's manual zoom). maxZoom caps a tight single-metro cluster from zooming to
  // street level. GUARDED: 0 markers → no fit (Leaflet throws on empty/invalid bounds), the
  // BOOT_VIEW_JS profile-state/CONUS fallback view stands. The programmatic fit fires a 'moveend'
  // → one more fetchView at the tighter bbox (desired: loads the region precisely; "zoom in for
  // more" still applies) but _didAutoFit stops it re-fitting, so there's no fit⇄fetch loop.
  var _didAutoFit=false;
  window.__resetAutoFit=function(){ _didAutoFit=false; };
  function maybeAutoFit(){
    if(_didAutoFit)return;
    try{
      var ms=[]; markers.forEach(function(m){ ms.push(m); });
      if(!ms.length)return;                       // empty result → keep the fallback view, never fitBounds([])
      var sz=map.getSize(); if(sz.x<50||sz.y<50)return; // map not laid out yet — try again next render
      var b=L.featureGroup(ms).getBounds(); if(!b||!b.isValid())return;
      _didAutoFit=true;
      map.fitBounds(b.pad(.12),{animate:false,maxZoom:9,padding:[40,40]});
      // ⚠️ FLOOR THE FIT AT THE PIN THRESHOLD. fitBounds had a maxZoom but no MINIMUM, and the
      // pins span the whole country — so it resolved to 4.5, below PIN_DOT_ZOOM (5), and the map
      // hid the very markers it had just fitted to. Measured on prod 2026-08-16: arrive at
      // /opportunity-map and you get 0 markers + "Zoom in to see opportunities"; one step in and
      // 2,970 pins are there. This ran AFTER conus() and overrode it, which is why fixing the
      // boot constants alone changed nothing (traced via a setView/fitBounds hook).
      try{ if(map.getZoom()<PIN_DOT_ZOOM)map.setZoom(PIN_DOT_ZOOM,{animate:false}); }catch(e){}
    }catch(e){}
  }
  window.__mapAutoFit=maybeAutoFit;
  // Search auto-jump (Eric 2026-07-28): when a search has matches but 0 are in the CURRENT viewport
  // (e.g. "tavares" = 4 US firms while the map is on Europe → "0 in view · 4 match"), zoom out to the
  // national view so the matches come back in the next bbox fetch, then fit to them. Zillow does this
  // — a search should SHOW you the results, never an empty ocean. Guarded so it fires ONCE per search
  // (not on every subsequent pan) via _searchJumpedFor.
  var _searchJumpedFor='';
  function maybeJumpToSearch(){
    if(!Q){ _searchJumpedFor=''; return false; }           // no active search → nothing to jump to
    if(_searchJumpedFor===Q) return false;                 // already jumped for THIS query
    if((INVIEW||0)>0 || (TOTAL||0)===0) return false;      // matches already in view, or none exist
    _searchJumpedFor=Q;
    _didAutoFit=false;                                     // allow the post-jump fit
    // National view — the moveend handler refetches at this bbox, the matches render, maybeAutoFit
    // then tightens onto them. animate:true so the jump reads as intentional.
    map.setView([38,-96], 4, {animate:true});
    return true;
  }
  // After a marker rebuild (render clears+recreates all markers on every refetch), RE-OPEN the
  // popup for the currently-selected opp — otherwise a background refetch destroys the popup the
  // user just opened (the "flash"). The popup now stays until the user clicks off it / another dot.
  // Contacts renderer — bypasses the template's pass()/cardHTML/popupHTML (all opp-shaped).
  // Contacts flow through the SAME markers/layer/rows/feed globals + select() path, but with
  // contact-specific pins (a fixed purple), popups, and right-panel cards.
  function esc0(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  // Company set-aside chips — up to 2, reusing the map's existing set-aside color legend. A firm
  // with no set-aside award renders NO chip (never a fabricated "Open"/"None").
  function setAsideChips(setAsides,soft){
    if(!setAsides||!setAsides.length)return '';
    return setAsides.slice(0,2).map(function(k){
      // soft=true → the light-tinted .sa chip (company-card parity: matches the Open/Recompete
      // soft chip family, Eric 2026-07-28). soft=false → the legacy solid strip-colored badge.
      if(soft)return '<span class="chip sa">'+esc0(SET_CHIP_LABEL[k]||k)+'</span>';
      var col=SET_CHIP_COLOR[k]; if(!col)return '';
      return '<span class="chip" style="background:'+col+';color:#fff;margin-left:4px">'+esc0(SET_CHIP_LABEL[k]||k)+'</span>';
    }).join('');
  }
  // The company card's right-aligned SCALE-TIER pill — branded as a MINDY ESTIMATE, exactly like
  // M-Estimate™ (Eric 2026-07-28: "we can say it's a Mindy estimate like M-Win value… explain how
  // we arrive at the value in the full drawer"). Keeps his preferred words (Top tier / Mid /
  // Emerging) but the ™ + "M-Scale" branding signals THIS IS OUR read, not an official SBA size
  // ruling (SBA size = annual receipts / headcount, which we don't have). Derived from the firm's
  // REAL total_obligated on fixed $ bands: Top tier ≥$100M · Mid $10M–$100M · Emerging <$10M. The
  // company drawer carries the full "How we calculate this" methodology (companyScaleMethodology).
  // Returns '' when total is 0/absent — never a fabricated tier.
  function companyScaleTier(totalObligated){
    var v=Number(totalObligated)||0; if(v<=0)return '';
    return v>=1e8 ? 'Top tier' : (v>=1e7 ? 'Mid' : 'Emerging');
  }
  // Zillow parity (Eric 2026-07-28): the CARD carries the number/word CLEAN — no ™, no brand (Zillow
  // shows a bare Zestimate on the listing). The M-Scale™ branding + "how we calculate this" live in
  // the DETAIL DRAWER only (companyScaleMethodology). A plain tooltip is the card's only hint.
  function companyScaleTierChip(totalObligated){
    var label=companyScaleTier(totalObligated); if(!label)return '';
    return '<span class="dl co" title="Mindy\\u2019s read of total federal $ won \\u2014 a scale cue, not an official SBA size determination. See the company page for how it\\u2019s calculated."><i></i>'+label+'</span>';
  }
  // Bridge onto window: DRAWER_JS is a SEPARATE <script> IIFE, so it cannot see these
  // closures. companyHead/companyScaleMethodology call companyScaleTier, which threw
  // "companyScaleTier is not defined" INSIDE the drawer's fetch .then() — swallowed by
  // the outer .catch() and reported as drawerLoadError(0) = "Network hiccup", so a pure
  // RENDER bug read as a network drop on a 200 response. Same bridge pattern as
  // window.__mapMode / window.__players.
  window.companyScaleTier=companyScaleTier;
  window.companyScaleTierChip=companyScaleTierChip;
  // The buyer card's lead chip = the person's REAL role/title (contact_title from federal_contacts —
  // "Contracting Officer" / "Contract Specialist" / …). The government's OWN job-title language (not
  // a taxonomy we invented) and the "who do I actually talk to" signal, which VARIES per person. A
  // contracting-AUTHORITY role (KO / Contracting Officer) gets the red "decision-maker" tint so the
  // person who can actually award pops; every other role gets the neutral blue role chip. A POC with
  // no title in the data → '' (no chip — never a filler "Buyer").
  function buyerRoleChip(role){
    var t=String(role||'').trim(); if(!t)return '';
    var authority=/contracting officer|\bko\b|\bco\b|contract officer|procurement officer/i.test(t);
    return '<span class="chip '+(authority?'ko':'role')+'">'+esc0(t)+'</span>';
  }
  function contactPopup(o){
    // Location honesty (state-centroid approximation) is disclosed ONLY in the detail DRAWER now,
    // NOT on this compact popup (Eric 2026-07-26: one home for the "approximate" note, no clutter
    // on pins/list/popups). So the popup just shows the location text — no "· approx." here.
    var sub = o.ctype==='buyers'
      ? '<div class="pvmeta"><b>'+esc0(o.agency)+'</b>'+(o.loc?' \\u00b7 '+esc0(o.loc):'')+'</div>'
        + (o.role?'<div class="pvmeta">'+esc0(o.role)+'</div>':'')
        + (o.office?'<div class="pvmeta" style="color:var(--sub)">'+esc0(o.office)+'</div>':'')
      : '<div class="pvmeta">'+(o.loc?esc0(o.loc):'')+'</div>'
        + (o.meta?'<div class="pvmeta" style="color:var(--sub)">'+esc0(o.meta)+'</div>':'');
    // COMPOUND parity (GOS #9): both Companies AND Gov Buyers get the 1-click Save HEART + a
    // "View …" CTA that opens the detail drawer (mirrors the opp popup's "Should I bid?").
    // Company heart → toggleCompanyFav (UEI); Buyer heart → toggleBuyerFav (federal_contacts id).
    var heart = o.ctype==='companies'
      ? '<button class="pv-heart" data-nid="'+esc0(o.sol)+'" data-title="'+esc0(o.title)+'" data-agency="" onclick="toggleCompanyFav(this)" title="Save to Favorites" aria-label="Save to Favorites"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
      : o.ctype==='buyers'
      ? '<button class="pv-heart" data-nid="'+esc0(o.sol)+'" data-title="'+esc0(o.title)+'" data-agency="'+esc0(o.agency||'')+'" onclick="toggleBuyerFav(this)" title="Save to Favorites" aria-label="Save to Favorites"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg></button>'
      : '';
    var cta = o.ctype==='companies'
      ? '<div class="pvacts"><button class="pva pri" onclick="window.openCompanyDrawer&&openCompanyDrawer(\\''+esc0(o.sol)+'\\')">View company \\u2192</button></div>'
      : o.ctype==='buyers'
      ? '<div class="pvacts"><button class="pva pri" onclick="window.openBuyerDrawer&&openBuyerDrawer(\\''+esc0(o.sol)+'\\')">View buyer \\u2192</button></div>'
      : '';
    var col=contactColorFor(o);
    return '<div class="pv"><div class="pvstrip" style="background:'+col+'"></div>'+heart+'<div class="pvbody">'
      + '<div class="pvchips"><span class="chip" style="background:'+col+';color:#fff">'+(o.ctype==='buyers'?'Government buyer':'Contractor')+'</span>'+(o.ctype==='companies'?setAsideChips(o.setAsides):'')+'</div>'
      + '<div class="pvt">'+esc0(o.title)+'</div>'+sub+cta+'</div></div>';
  }
  // Company popup heart → the SAME /api/opportunities/save endpoint the opp hearts use
  // (source=company_map, UEI as noticeId), so a hearted company lands in the user's saved set
  // exactly like a hearted opp. Optimistic toggle; DELETE on un-heart. Mirrors toggleFav.
  var _companyFavs={};
  window.toggleCompanyFav=function(btn){
    var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    var uei=btn.getAttribute('data-nid');
    if(!t||!em){ if(window.openSignInModal){window.openSignInModal('save this company to your Favorites',function(){location.reload();});}else{location.href='/app?next=%2Fopportunity-map';} return; }
    var on=btn.classList.contains('on'); btn.classList.toggle('on',!on); _companyFavs[uei]=!on;
    var body={email:em,noticeId:uei};
    if(!on){ body.requestPursuitBrief=false; body.source='company_map';
      body.opportunityData={noticeId:uei,entityType:'company',uei:uei,title:btn.getAttribute('data-title')||''}; }
    fetch('/api/opportunities/save',{method:on?'DELETE':'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},body:JSON.stringify(body)})
      .then(function(r){ if(!r.ok&&r.status!==409){ btn.classList.toggle('on',on); _companyFavs[uei]=on; } })
      .catch(function(){ btn.classList.toggle('on',on); _companyFavs[uei]=on; });
  };
  // Buyer popup heart → the SAME /api/opportunities/save endpoint (source=buyer_map, the
  // federal_contacts id as noticeId), so a hearted buyer lands in the saved set like a hearted
  // opp/company. Optimistic toggle; DELETE on un-heart. Mirrors toggleCompanyFav (COMPOUND parity).
  var _buyerFavs={};
  window.toggleBuyerFav=function(btn){
    var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    var id=btn.getAttribute('data-nid');
    if(!t||!em){ if(window.openSignInModal){window.openSignInModal('save this buyer to your Favorites',function(){location.reload();});}else{location.href='/app?next=%2Fopportunity-map';} return; }
    var on=btn.classList.contains('on'); btn.classList.toggle('on',!on); _buyerFavs[id]=!on;
    var body={email:em,noticeId:id};
    if(!on){ body.requestPursuitBrief=false; body.source='buyer_map';
      body.opportunityData={noticeId:id,entityType:'buyer',title:btn.getAttribute('data-title')||'',department:btn.getAttribute('data-agency')||'',agency:btn.getAttribute('data-agency')||''}; }
    fetch('/api/opportunities/save',{method:on?'DELETE':'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},body:JSON.stringify(body)})
      .then(function(r){ if(!r.ok&&r.status!==409){ btn.classList.toggle('on',on); _buyerFavs[id]=on; } })
      .catch(function(){ btn.classList.toggle('on',on); _buyerFavs[id]=on; });
  };
  function contactCard(o){
    // No "· approx." on the compact list card — the approximate-location note lives ONLY in the
    // detail drawer now (Eric 2026-07-26: one authoritative disclosure, no clutter on list cards).
    // Mirrors the Awarded/Open card (cardHTML) so Companies/Buyers look AS POLISHED (Eric 2026-07-27):
    // color strip · chip row · title · industry/agency/location meta · a .stats facts GRID · footer.
    var col=contactColorFor(o);
    var line2 = o.ctype==='buyers'
      // The role now LEADS as the crow1 chip (buyerRoleChip), so it's dropped from the meta line
      // here — no longer repeated as faint grey text below (Eric 2026-07-28 card-parity pass).
      ? '<div class="cmeta"><span class="ag">'+esc0(o.agency||'Government')+'</span>'+(o.loc?'<span class="dot"></span><span class="loc">'+esc0(o.loc)+'</span>':'')+'</div>'
      // Companies: promote the location to the BOLD .ag weight (parity with Open/Recompete, whose
      // meta line leads with a bold agency) so the company card's meta row has the same presence
      // instead of a faint grey location string (Eric 2026-07-28 card-parity pass).
      : '<div class="cmeta">'+(o.loc?'<span class="ag">'+esc0(o.loc)+'</span>':'')+'</div>';
    // Facts grid — the polished 3-cell block the Awarded cards have. Companies: $ won / Awards /
    // Agencies (real per-firm fields threaded from the map pin). Buyers: a person has no $, so show
    // their agency + role only (never a fabricated dollar cell). Falls back gracefully when a field
    // is absent (never a blank "—" cell that reads as broken).
    var stats='';
    if(o.ctype==='companies'){
      var cells=[];
      if(o.totalObligated)cells.push({k:'Won',v:mCompact(o.totalObligated)});
      if(o.awardCount)cells.push({k:'Awards',v:Number(o.awardCount).toLocaleString()});
      if(o.distinctAgencyCount)cells.push({k:'Agencies',v:Number(o.distinctAgencyCount).toLocaleString()});
      if(cells.length)stats='<div class="stats">'+cells.map(function(s){return '<div class="st"><div class="k">'+esc0(s.k)+'</div><div class="v'+(s.k==='Won'?' money':'')+'">'+esc0(s.v)+'</div></div>';}).join('')+'</div>';
    } else {
      var bcells=[];
      // This was push({k:'Agency', v:o.subAgency||o.agency}) — but a BUYER row carries no
      // subAgency at all (see toRow), so it ALWAYS fell through to o.agency, which the meta line
      // directly above already prints. Every buyer card therefore rendered its agency TWICE
      // ("Department of Veterans Affairs" as the meta line AND as a fact). Show a sub-agency only
      // when one exists and genuinely differs; otherwise the office is the fact that adds something.
      if(o.subAgency&&o.subAgency!==o.agency)bcells.push({k:'Agency',v:o.subAgency});
      if(o.office)bcells.push({k:'Office',v:o.office});
      if(bcells.length)stats='<div class="stats">'+bcells.map(function(s){return '<div class="st"><div class="k">'+esc0(s.k)+'</div><div class="v">'+esc0(s.v)+'</div></div>';}).join('')+'</div>';
    }
    // Zillow/Eric 2026-07-27: the card must NOT repeat the dataset label ("Company"/"Buyer") on
    // every row — the section header + the color strip already say the dataset. The chip row leads
    // with UNIQUE per-card info instead.
    // crow1 = the top chip row, mirroring the Open/Recompete card family (Eric 2026-07-28: "apply
    // the style to all cards"). The chip must VARY per card and be grounded in real data — NO
    // repeated generic word, and NO taxonomy WE invented (Eric: SBA small/large is annual-receipts/
    // headcount which we don't have, so "Large business"/"Emerging" would be OUR inference stated as
    // fact — dropped both):
    //   • companies → the firm's real SAM certs (.chip.sa: 8(a)/SDVOSB/WOSB/HUBZone — FACTS SAM
    //     asserts) + a right-aligned SCALE-TIER pill (companyScaleTierChip — our read of real $ won,
    //     framed as a suggestion, not an SBA ruling). A no-cert firm still gets the tier pill so the
    //     card never reads bland/empty (the original complaint).
    //   • buyers → the person's real ROLE (buyerRoleChip: contact_title, the government's own
    //     job-title language). Contracting authority tinted red so the actual decision-maker pops.
    var crow1inner = o.ctype==='companies'
      ? setAsideChips(o.setAsides,true)+companyScaleTierChip(o.totalObligated)
      : o.ctype==='buyers'
      ? buyerRoleChip(o.role)
      : '';
    return '<div class="cstrip" style="background:'+col+'"></div><div class="cbody">'
      + (crow1inner?('<div class="crow1">'+crow1inner+'</div>'):'')
      + '<div class="ctitle">'+esc0(o.title)+'</div>'+line2
      + stats
      // The CTA must name what the click OPENS. "Review Opportunity" was hardcoded for EVERY
      // contact card, so a person card (a contracting specialist) invited you to review an
      // opportunity that does not exist — and a company card said it too. The left slot's bare
      // "Contact" was a repeated generic word carrying no per-card information; dropped.
      + '<div class="cfoot"><span class="solno"></span><span class="viewdet">'
      +   (o.ctype==='buyers'?'View buyer \\u2192':(o.ctype==='companies'?'View company \\u2192':'View details \\u2192'))
      + '</span></div>'
      + '</div>';
  }
  function renderContacts(){
    rows=OPPS.slice();
    layer.clearLayers(); markers.clear();
    var _zFar=(typeof pinTooFar==='function')&&pinTooFar(map);
    var _zh=document.getElementById('zoomHint'); if(_zh)_zh.hidden=!_zFar;
    // Zillow: country zoom has no pins. Regional = dots; close-in = $-value tags (pinFace).
    if(!_zFar){
    var _cl=(typeof clusterRows==='function')?clusterRows(rows,map,64):{singles:rows,clusters:[]};
    _cl.clusters.forEach(function(cl){
      var cb=mkClusterBubble(cl,map,'network'); cb.addTo(layer);
    });
    _cl.singles.forEach(function(o){
      // Zillow value-tag pins for Contacts. Companies → a $-won TAG (real per-firm total_obligated).
      // Gov Buyers → a labeled DOT (a POC has NO dollar value — never a fabricated price). All pins
      // render SOLID now (dashed dropped 2026-07-26); the state-centroid approximation is disclosed
      // ONLY in the detail drawer's location line, not on the pin. isApprox kept for mkPin's class.
      var isApprox = o.locPrecision==='state';
      var txt = (typeof pinFace==='function') ? pinFace(o,map) : ((typeof pinMoney==='function') ? pinMoney(o) : '');
      // Dataset-level pin color: companies purple, gov buyers RED (contactColorFor).
      var pcol=contactColorFor(o);
      var m=(typeof mkPin==='function')
        ? mkPin(o,pcol,txt,isApprox).bindPopup(contactPopup(o),{maxWidth:300,closeButton:true,autoClose:false,closeOnClick:false})
        : L.circleMarker([o.lat,o.lng],{radius:6,color:'#ffffff',weight:2,fillColor:pcol,fillOpacity:.95}).bindPopup(contactPopup(o),{maxWidth:300,closeButton:true,autoClose:false,closeOnClick:false});
      // Pin → the entity's DETAIL DRAWER (COMPOUND parity with opps, whose pins open the drawer).
      // Companies → openCompanyDrawer, Gov Buyers → openBuyerDrawer. Still selects (opens the popup).
      (function(row){ m.on('click',function(){ select(row.sol,false);
        if(row.ctype==='companies'&&window.openCompanyDrawer)openCompanyDrawer(row.sol);
        else if(row.ctype==='buyers'&&window.openBuyerDrawer)openBuyerDrawer(row.sol); }); })(o);
      m.addTo(layer); markers.set(o.sol,m);
    });
    }
    var feed=document.getElementById('feed'); if(feed){
      if(!rows.length){ feed.innerHTML='<div class="empty"><h4>No contacts in view</h4><p>Pan or zoom to a region, or switch to the Companies or Gov Buyers dataset.</p></div>'; }
      else { feed.innerHTML=''; rows.forEach(function(o){ var c=document.createElement('article'); c.className='card'; c.dataset.sol=o.sol; c.tabIndex=0; c.innerHTML=contactCard(o);
        // Feed card → the entity's detail DRAWER (COMPOUND parity: opp cards open openOppDrawer).
        // Companies → openCompanyDrawer, Gov Buyers → openBuyerDrawer.
        c.onclick=(o.ctype==='companies')
          ? (function(row){return function(){ if(window.openCompanyDrawer)openCompanyDrawer(row.sol); else select(row.sol,true); };})(o)
          : (o.ctype==='buyers')
          ? (function(row){return function(){ if(window.openBuyerDrawer)openBuyerDrawer(row.sol); else select(row.sol,true); };})(o)
          : (function(row){return function(){ select(row.sol,true); };})(o);
        feed.appendChild(c); }); }
    }
  }
  var _render=render; render=function(){
    if(isContactMode(MODE)){ renderContacts(); updateHeader(); maybeAutoFit(); return; }
    _render(); updateHeader(); maybeAutoFit();
    try{ if(typeof selected!=='undefined' && selected){ var mm=markers.get(selected); if(mm && !mm.isPopupOpen()) mm.openPopup(); } }catch(e){}
  };
  // Zillow: the popup stays through refetches (closeOnClick:false) but closes when the user
  // clicks the MAP BACKGROUND (click off it). A programmatic refetch-pan fires no map 'click',
  // so this only triggers on a real click. Clears selection so render() won't re-open it.
  try{ map.on('click', function(){ try{ selected=null; map.closePopup(); document.querySelectorAll('.card.sel').forEach(function(c){c.classList.remove('sel');});
    // Also close the Horizons/Players popovers on a real map click — belt-and-suspenders alongside the
    // capture-phase document handler (Leaflet stopPropagation'd the click, so it needs an explicit hook).
    document.querySelectorAll('#hznPop, #plrPop, #fscPop, #naicsPop, #agencyPop').forEach(function(pp){ if(!pp.hidden){ pp.hidden=true; var bid=pp.id==='hznPop'?'hznBtn':(pp.id==='plrPop'?'plrBtn':(pp.id==='fscPop'?'fscBtn':(pp.id==='naicsPop'?'naicsBtn':'agencyBtn'))); var bb=document.getElementById(bid); if(bb){bb.setAttribute('aria-expanded','false');bb.classList.remove('on');} } });
  }catch(e){} }); }catch(e){}
  // MAP VIEWED — fired once per session, not per pan. A pan is not a visit, and counting
  // one would drown the signal we actually want: did this person arrive at all, and from
  // where. Attribution rides along so a brief click-through is distinguishable from a direct
  // open.
  var _viewSent=false;
  function _trackMapView(){
    if(_viewSent)return; _viewSent=true;
    try{
      var ref=''; try{ ref=document.referrer||''; }catch(e){}
      var utm=''; try{ utm=new URLSearchParams(location.search).get('utm_source')||''; }catch(e){}
      if(window.__track) window.__track('page_view','map_view',{referrer:ref.slice(0,120),utm_source:utm});
    }catch(e){}
  }

  function fetchView(){
    if(window.__suppressFetchView) return;
    _trackMapView();
    // Clear any stale "Couldn't load" banner as a NEW attempt begins — a fresh fetch supersedes the
    // last failure, and if THIS one also fails the merge-step guard re-shows it (only when empty).
    if(typeof _clearFetchError==='function')_clearFetchError();
    // If a fetch is already in flight, DON'T drop this request (that silently lost the search query —
    // Eric 2026-07-28: "search doesn't work"). Mark a re-fetch pending; the in-flight fetch's
    // completion re-runs fetchView() with the CURRENT state (Q, filters, bbox), so the latest search
    // always wins. Previously an if-busy-return no-op'd, so a query typed mid-fetch never fired.
    if(busy){ pendingFetch=true; return; }
    pendingFetch=false;
    // ── Companies / Gov Buyers: 2 flat datasets, by location, both hitting contacts-map. ──
    if(isContactMode(MODE)){
      busy=true;
      var em=_uemail(); var tk=''; try{ tk=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
      var ch={}; if(tk)ch['x-mi-auth-token']=tk; if(em)ch['x-user-email']=em;
      // ── PLAYERS map: Companies + Gov Buyers COEXIST on ONE map (Eric 2026-07-31 — the same
      // one-map treatment as the opportunity horizons; companies=purple pins, buyers=red, colored
      // per-pin by contactColorFor). window.__players = which types are ON (both default true). We
      // fetch each enabled type's contacts-map?type= endpoint in PARALLEL and MERGE the pins.
      function _buildContactUrl(t){
        // Type-specific filters: set-aside/naics/company-sort apply to companies (per-firm), agency
        // applies to BOTH — buyers (gov POC's own agency) AND companies (2026-08-03: "sells-to-agency"
        // scope — firms with real awards FROM this agency; see searchRecipients doc comment). Same
        // params the single-type path used, keyed on t not MODE.
        var _sa=(t==='companies')?_merge(FILT.setAside, FILT.setAsideMulti):'';
        var _sort=(t==='companies'&&window.__companySort)?window.__companySort:'';
        var _naics=(t==='companies')?_merge(FILT.naics, ''):'';
        var _agency=FILT.agency;
        return '/api/app/contacts-map?bbox='+bbox()+'&type='+t
          +(FILT.state?'&state='+encodeURIComponent(FILT.state):'')
          +(Q?'&search='+encodeURIComponent(Q):'')
          +(_sa?'&setAside='+encodeURIComponent(_sa):'')
          +(_sort?'&sort='+encodeURIComponent(_sort):'')
          +(_naics?'&naics='+encodeURIComponent(_naics):'')
          +(_agency?'&agency='+encodeURIComponent(_agency):'')
          // Office (DoDAAC) is a BUYERS-only axis — sending it on the companies request would
          // make the API return its honest "not applicable" empty set for every firm.
          +((t==='buyers'&&FILT.office)?'&office='+encodeURIComponent(FILT.office):'')
          +(em?'&email='+encodeURIComponent(em):'');
      }
      var P=window.__players||{companies:true,buyers:true};
      var _pen=['companies','buyers'].filter(function(t){return P[t]!==false;});
      if(_pen.length===0){ OPPS=[]; TOTAL=0; CAPPED=false; INVIEW=0; busy=false; afterFetch(); render(); return; }
      var _anyDenied=false;
      Promise.all(_pen.map(function(t){
        return fetch(_buildContactUrl(t),{headers:ch}).then(function(r){return r.json();}).then(function(d){
          if(!d||!d.success){ if(!d||d.error)_anyDenied=true; return {t:t,pins:[],total:0}; }
          return {t:t,pins:(d.pins||[]).map(function(p){return toRow(p,t);}),total:d.totalForFilters||0};
        }).catch(function(){return {t:t,pins:[],total:0};});
      })).then(function(parts){
        busy=false; afterFetch();
        var merged=[],tot=0;
        window.__playerTotals=window.__playerTotals||{};
        ['companies','buyers'].forEach(function(k){ window.__playerTotals[k]=0; });
        parts.forEach(function(p){ merged=merged.concat(p.pins); tot+=p.total; if(p.t)window.__playerTotals[p.t]=p.total; });
        if(merged.length===0 && _anyDenied){ OPPS=[]; TOTAL=0; CAPPED=false; INVIEW=0; render();
          var fe=document.getElementById('feed'); if(fe)fe.innerHTML='<div class="empty"><h4>Meet the buyers behind the opportunities</h4><p>Buying offices, incumbents, contracting officers and supplier relationships \u2014 connected to the opportunities on your map. Your current map will be waiting when you return.</p></div>';
          // Backstop for any OTHER route into a contact mode (a stale ?mode=buyers link, a
          // restored saved search). The nav is intercepted before the switch by __playersGate;
          // this catches the rest so the count can never sit stale on a denied dataset.
          try{ if(typeof updateHeader==='function')updateHeader(); }catch(e){}
          return; }
        OPPS=merged; TOTAL=tot; CAPPED=false; INVIEW=merged.length;
        if(typeof window.__syncPlayerCounts==='function')window.__syncPlayerCounts();
        render();
        if(maybeJumpToSearch())return;
        maybeAutoFit();
      }).catch(function(){ busy=false; afterFetch(); if(typeof _showFetchError==='function')_showFetchError(); });
      return;
    }
    busy=true;
    // ── OPPORTUNITIES map: all enabled HORIZONS on ONE map at once (Eric 2026-07-31, the locked
    // map1_two_axis_pin_system decision — 4 categories coexist, color-distinguished; the picker
    // toggles which horizons show, it does NOT switch corpora). window.__horizons = which of
    // open/recompete/forecast/grants are ON (all true by default). We fetch each enabled horizon's
    // endpoint in PARALLEL and MERGE the pins into OPPS. Each horizon keeps its own mode-specific
    // filter params (Open sources/notice/fsc, Recompete leadMax/value, etc.) via _buildOppUrl.
    function _merge(a,b){ return [a,b].filter(Boolean).join(','); }
    // Build the fetch URL for ONE opportunity horizon (mode = open|recompete|forecast|grants).
    // Parameterized on m so the same builder serves every horizon (was hardcoded to global MODE).
    function _buildOppUrl(m){
      // DLA MODE = its own map (sources=dla only → getDibbsViewportPins) + the FSC supply-class filter.
      // Opportunities (open) = SAM + DIBBS + SBIR union (the market-research map). The old top-bar
      // Source dropdown that used to narrow Open to "DLA only" is GONE — DLA is a mode now, not a source.
      var _dla=(window.__mapMode==='dla');
      var _sources=_dla?'dla':'sam,sbir';   // Opportunities no longer folds DLA in — it's its own map
      var url=MODES[m].ep+'?bbox='+bbox()+((m==='open'||_dla)?('&status=active&sources='+_sources+((HIDE_FSC&&!_dla)?'&hideCommodity=1':'')):'')+(Q?'&q='+encodeURIComponent(Q):'');
      // DLA mode: the FSC supply-class filter (the dropdown that replaced Industry in this mode).
      if(_dla){ var _fsc=(window.__fscFilter||[]).join(','); if(_fsc)url+='&fsc='+encodeURIComponent(_fsc); return url; }
      // setAside/agency apply across horizons (both endpoints accept them where meaningful).
      var _sa=_merge(FILT.setAside, FILT.setAsideMulti);
      if(_sa)url+='&setAside='+encodeURIComponent(_sa);
      if(FILT.agency)url+='&agency='+encodeURIComponent(FILT.agency);
      if(m==='open'){
        if(FILT.fullOpen)url+='&fullOpen=1';
        if(FILT.scope==='profile'){ var _pe=_uemail(); if(_pe)url+='&scope=profile&email='+encodeURIComponent(_pe); }
        var _nt=_merge(FILT.noticeType, FILT.noticeMulti);
        if(_nt)url+='&noticeType='+encodeURIComponent(_nt);
        if(FILT.state)url+='&state='+encodeURIComponent(FILT.state);
        if(FILT.closingDays)url+='&closingDays='+encodeURIComponent(FILT.closingDays);
        if(FILT.naics)url+='&naics='+encodeURIComponent(FILT.naics);
        if(FILT.psc)url+='&psc='+encodeURIComponent(FILT.psc);
        if(FILT.fsc)url+='&fsc='+encodeURIComponent(FILT.fsc);
        if(FILT.postedDays)url+='&postedDays='+encodeURIComponent(FILT.postedDays);
        if(FILT.subAgency)url+='&subAgency='+encodeURIComponent(FILT.subAgency);
        if(FILT.country)url+='&country='+encodeURIComponent(FILT.country);
        if(FILT.hasDocs)url+='&hasDocs=1';
        if(FILT.hasContact)url+='&hasContact=1';
        if(FILT.sapBuyer)url+='&sapBuyer='+encodeURIComponent(FILT.sapBuyer);
        // STRATEGY FILTER (Opportunity DNA) — FILT.strategy is an array of genome strand keys; send
        // them comma-joined. The API (applyMapFilters) does a JSONB-keys @> ALL over the persisted
        // opportunity_dna_keys → "filter by strategy, not NAICS", corpus-wide.
        if(FILT.strategy&&FILT.strategy.length)url+='&strategy='+encodeURIComponent(FILT.strategy.join(','));
      }
      if(m==='recompete'){
        if(FILT.state)url+='&state='+encodeURIComponent(FILT.state);
        if(FILT.subAgency)url+='&subAgency='+encodeURIComponent(FILT.subAgency);
        if(FILT.sap)url+='&sap='+encodeURIComponent(FILT.sap);
        if(FILT.likelihood)url+='&likelihood='+encodeURIComponent(FILT.likelihood);
        if(FILT.leadMax)url+='&leadMax='+encodeURIComponent(FILT.leadMax);
        if(FILT.valueRange){ var _vr=FILT.valueRange.split('-'); if(_vr[0])url+='&minValue='+_vr[0]; if(_vr[1])url+='&maxValue='+_vr[1]; }
      }
      if(m==='forecast'){
        // Forecasts filter on q/naics/agency/state (applyForecastFilters). naics/state aren't added
        // in the open block above, so add them here. includeUnplaced=1 asks the endpoint to ALSO
        // return the location-less matching forecasts (~43% of the corpus) as LIST-ONLY rows —
        // gated server-side on a real search key so an unfiltered pan never drags in all 14k.
        if(FILT.naics)url+='&naics='+encodeURIComponent(FILT.naics);
        if(FILT.state)url+='&state='+encodeURIComponent(FILT.state);
        if(Q||FILT.naics||FILT.agency)url+='&includeUnplaced=1';
      }
      return url;
    }
    // Which horizons are ON. Default all true. Companies/Buyers never reach here (contact branch above).
    var H=window.__horizons||{open:true,recompete:true,forecast:true};
    var _enabled=['open','recompete','forecast'].filter(function(m){return H[m]!==false;});
    // DLA MODE is a single-endpoint map (dibbs only) — fetch through the 'open' endpoint builder with
    // sources=dla (see _buildOppUrl _dla branch). The horizon toggles (Recompete/Forecast/Grants) are
    // an Opportunities concept and don't apply. (Eric 2026-07-31 — DLA is its own map now.)
    if(window.__mapMode==='dla'){ _enabled=['open']; }
    if(_enabled.length===0){ OPPS=[]; TOTAL=0; CAPPED=false; INVIEW=0; busy=false; afterFetch(); render(); return; }
    // Fetch every enabled horizon in parallel, MERGE the pins. Totals SUM across horizons; capped if
    // ANY horizon capped (a partial-per-horizon view). A single horizon failing doesn't blank the
    // map — it contributes nothing and the others still render (resilient).
    Promise.all(_enabled.map(function(m){
      return fetch(_buildOppUrl(m)).then(function(r){return r.json();}).then(function(d){
        if(!d||!d.success)return {m:m,pins:[],total:0,capped:false,inview:0,unplaced:[],unplacedTotal:0,failed:true};
        // Pass the horizon m into toRow so recompete pins get the recompete shape (toRow cannot
        // read the global MODE during a merge, it is always open). open/forecast/grants key off p.src.
        // total = totalForFilters (the REAL count for this horizon in view, NOT the 1,000 pin cap) —
        // captured per-horizon so the Horizons dropdown can show the honest number, never the cap.
        // unplaced = location-less forecasts that MATCH the search (forecast horizon only) — rendered
        // as LIST-ONLY rows (no pin) so they surface wherever a user searches (Eric 2026-08-02).
        return {m:m,pins:(d.pins||[]).map(function(p){return toRow(p,m);}),total:d.totalForFilters||0,capped:!!d.capped,inview:d.totalInView||0,unplaced:(d.unplaced||[]).map(unplacedToRow),unplacedTotal:d.unplacedTotal||0};
      }).catch(function(){return {m:m,pins:[],total:0,capped:false,inview:0,unplaced:[],unplacedTotal:0,failed:true};});
    })).then(function(parts){
      busy=false; afterFetch();
      // If EVERY enabled horizon's fetch FAILED (network blip / mid-deploy chunk mismatch), this is
      // NOT a genuine "0 opportunities" — do NOT blank a populated map to a fake "No opportunities
      // match". Keep the last-good render and surface an honest retry banner. A real empty result
      // (fetch succeeded, 0 rows) has failed=false on every part → falls through and renders 0.
      // Show the retry banner ONLY when every horizon genuinely failed AND there is nothing already
      // on screen to preserve. A superseded/aborted fetch (the auto-fit re-fetch racing the initial
      // load) can resolve failed while the FIRST fetch already rendered 600 cards — in that case we
      // must NOT cover a good map with a false "Couldn't load" banner. So gate on "map is empty now".
      var _allFailed = parts.length>0 && parts.every(function(p){return p&&p.failed;});
      var _haveRender = (typeof OPPS!=='undefined' && OPPS && OPPS.length>0);
      if(_allFailed){ if(!_haveRender && typeof _showFetchError==='function')_showFetchError(); return; }
      if(typeof _clearFetchError==='function')_clearFetchError();
      var merged=[],tot=0,cap=false,inv=0;
      // Per-horizon REAL totals for the Horizons dropdown (fixes the "1,000" cap being shown as the
      // count). window.__horizonTotals[m] = totalForFilters for that horizon (or 0 if disabled/failed).
      window.__horizonTotals=window.__horizonTotals||{};
      // Reset ONLY the horizons NOT enabled this pass (a hidden horizon contributes nothing → 0).
      // An ENABLED horizon keeps its last-known total until a SUCCESSFUL part overwrites it below —
      // so a superseded/aborted fetch (the auto-fit re-fetch racing the initial load) can't stomp a
      // real count to 0. This was the "Open: 0 while Open returns 5,170" bug: the LAST open fetch was
      // the aborted refetch → part.failed → total 0 → it overwrote the good 5,170. (Eric 2026-08-03.)
      ['open','recompete','forecast'].forEach(function(k){ if(_enabled.indexOf(k)===-1)window.__horizonTotals[k]=0; });
      var unplacedRows=[], unplacedTot=0;
      parts.forEach(function(p){ merged=merged.concat(p.pins); tot+=p.total; inv+=p.inview; if(p.capped)cap=true;
        // Only a SUCCESSFUL part writes its horizon total — a failed/superseded part preserves the
        // prior value (never overwrites a real count with 0).
        if(p.m && !p.failed)window.__horizonTotals[p.m]=p.total;
        if(p.unplaced&&p.unplaced.length){ unplacedRows=unplacedRows.concat(p.unplaced); unplacedTot+=(p.unplacedTotal||p.unplaced.length); } });
      // Location-less forecast rows go at the END of the list (they can't be a pin, so map-first
      // users see the mappable results first; the searcher still finds them below). They count
      // toward the headline total so "N results" is honest about what the search returned.
      OPPS=merged.concat(unplacedRows); TOTAL=tot+unplacedTot; CAPPED=cap; INVIEW=inv+unplacedRows.length;
      window.__unplacedForecastTotal=unplacedTot;
      if(typeof window.__syncHorizonCounts==='function')window.__syncHorizonCounts();
      render();
      _unplacedFoot();
      if(maybeJumpToSearch())return;
      maybeAutoFit();
    }).catch(function(){busy=false; afterFetch(); if(typeof _showFetchError==='function')_showFetchError();});
  }
  // FOOT OF THE FEED: a standing link to the forecasts the map can never plot.
  //
  // Deliberately NOT merged into OPPS. render() does rows=OPPS.filter(pass) and then builds a
  // marker per row with mkPin(o)/L.circleMarker([o.lat,o.lng]) — there is no coordinate guard, so
  // a locationless row in that array would produce a broken marker. It would also swamp the list:
  // 11,174 unplaced vs a 1,000-pin viewport cap, sorted together, when they are not IN the
  // viewport at all. One row at the foot states the fact without pretending they are local.
  //
  // Only shown on the FORECAST horizon — on an Open-only map it would be a non-sequitur.
  var _unplacedN=null;
  function _unplacedFoot(){
    var feed=document.querySelector('.feed'); if(!feed) return;
    var old=document.getElementById('unplacedFoot'); if(old) old.remove();
    var H=window.__horizons||{}; if(!H.forecast) return;
    function paint(n){
      if(!n) return;
      var f=document.querySelector('.feed'); if(!f) return;
      if(document.getElementById('unplacedFoot')) return;
      var b=document.createElement('button');
      b.id='unplacedFoot'; b.className='unplacedfoot';
      b.innerHTML='<span class="ic">\\u25ce</span><span><b>'+Number(n).toLocaleString()
        +'</b> forecasts with no mapped location</span><span class="arw">\\u2192</span>';
      b.onclick=function(){ location.href='/opportunity-map/forecasts'; };
      f.appendChild(b);
    }
    if(_unplacedN!=null){ paint(_unplacedN); return; }
    fetch('/api/forecasts/unplaced?limit=1').then(function(r){return r.json();})
      .then(function(d){ if(d&&d.success){ _unplacedN=d.total||0; paint(_unplacedN); } })
      .catch(function(){});
  }

  // Dataset pill router — like Zillow's Buy/Rent/Sell: 'bid' is NOT a map, it navigates to the
  // /bid landing page ("Bid with confidence"); everything else switches the map corpus.
  window.onDatasetChange=function(v){
    if(window.__closeHznPops)window.__closeHznPops();
    if(v==='bid'){ var ds=document.getElementById('fltDataset'); if(ds)ds.value=window.__mapMode||'open'; location.href='/bid'; return; }
    setMapMode(v);
  };
  // FSC supply-class filter (DLA mode) — replaced the old Source dropdown (Eric 2026-07-31: DLA is
  // its own map now, not an Open source). window.__fscFilter = array of selected 4-digit FSC codes;
  // empty = all classes. Drives &fsc=... in _buildOppUrl. The popover rows are built lazily from
  // __FSC_PRESETS on first open (below).
  window.__fscFilter=[];
  // HORIZON toggles — show/hide each opportunity category on the ONE Opportunities map.
  // Default: ALL THREE ON (Eric 2026-08-12) — Open + Recompete + Forecast at launch so the market
  // is fully visible; users can uncheck via Horizons. Last-ON sticky so the map never goes blank.
  window.__horizons={open:true,recompete:true,forecast:true};
  window.toggleHorizon=function(h){
    if(!(h in window.__horizons))return;
    var on=window.__horizons[h]!==false;
    // Count how many are currently on; block turning off the last one.
    var onCount=['open','recompete','forecast'].filter(function(m){return window.__horizons[m]!==false;}).length;
    if(on && onCount<=1)return; // keep at least one horizon visible
    window.__horizons[h]=!on;
    // (The old Source-filter reconciliation here is gone — DLA is its own map mode now, not an Open
    // source, so toggling a horizon no longer has to clear a source pill.)
    // Sync BOTH surfaces that show this horizon's on/off state — the full chips in the Filters panel
    // (.hzc) AND the rows in the top-bar Horizons dropdown (.hznrow) — so they never disagree.
    document.querySelectorAll('.hzc[data-hz="'+h+'"], .hznrow[data-hz="'+h+'"]').forEach(function(el){ el.classList.toggle('on',window.__horizons[h]); });
    if(typeof window.__syncHorizonCounts==='function')window.__syncHorizonCounts();
    if(window.__mapRefetch)window.__mapRefetch();
  };
  // Horizons dropdown: fill each row's REAL count (totalForFilters per horizon, NOT the 1,000 pin
  // cap) + a "N of 4" summary on the button. A capped horizon shows its true total (e.g. Forecast
  // 7,501) — the honest number, never the misleading cap. (Eric 2026-07-31.)
  window.__syncHorizonCounts=function(){
    var T=window.__horizonTotals||{};
    function fmt(n){ n=Number(n)||0; return n>=1000?(n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':Math.round(n/100)/10+'K').replace(/\.0([KM])/,'$1'):String(n); }
    ['open','recompete','forecast'].forEach(function(h){
      var el=document.querySelector('.hznn[data-hzn="'+h+'"]'); if(!el)return;
      var on=window.__horizons[h]!==false;
      el.textContent = on ? fmt(T[h]) : '';   // hidden horizon → no count (it contributes nothing)
    });
    var HZ=['open','recompete','forecast'], total=HZ.length;
    var onCount=HZ.filter(function(m){return window.__horizons[m]!==false;}).length;
    var btn=document.getElementById('hznBtn');
    // Divisor is the ACTUAL horizon count (3 now — Grants removed), never a hardcoded 4 (Eric 2026-08-01).
    // Always just "Horizons" — the N/total count suffix was noise (Eric 2026-08-01). The dropdown
    // rows themselves show which are on (checked) with their live counts.
    void total; if(btn)btn.textContent='Horizons';
  };
  // Open/close the Horizons popover (Zillow Home-Type dropdown). Toggling a row does NOT close it
  // (multi-select — keep it open so you can flip several). Closes on outside click / Esc.
  (function(){
    var btn=document.getElementById('hznBtn'), pop=document.getElementById('hznPop');
    if(!btn||!pop)return;
    function setOpen(o){ pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false'); btn.classList.toggle('on',o); if(o&&window.__placeHznPop)window.__placeHznPop(btn,pop); }
    // The KEY (Eric 2026-07-31 "why does every other one close except that one?"): copy EXACTLY what
    // the working dropdowns (agencywrap/naicswrap/valwrap) do — a BUBBLE-phase document click that
    // closes unless the click is inside #hznWrap (.closest). My earlier CAPTURE-phase version raced
    // with the button toggle (the capture handler fired before the button's stopPropagation could
    // run), leaving it stuck open. Bubble + stopPropagation-on-button is the proven pattern.
    btn.onclick=function(e){ e.stopPropagation();
      if(typeof window.__syncHorizonCounts==='function')window.__syncHorizonCounts();
      var willShow=pop.hidden; if(window.__closeHznPops)window.__closeHznPops(); if(willShow)setOpen(true); };
    document.addEventListener('click',function(e){ if(!pop.hidden && !e.target.closest('#hznWrap'))setOpen(false); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape')setOpen(false); });
  })();
  // PLAYERS toggles (Companies + Gov Buyers on ONE map) — mirrors the horizon toggles. Both ON by
  // default; last-ON sticky. (Eric 2026-07-31.)
  window.__players={companies:true,buyers:true};
  window.togglePlayer=function(t){
    if(!(t in window.__players))return;
    var on=window.__players[t]!==false;
    var onCount=['companies','buyers'].filter(function(k){return window.__players[k]!==false;}).length;
    if(on && onCount<=1)return; // keep at least one player type visible
    window.__players[t]=!on;
    // Sync BOTH surfaces (like toggleHorizon): the top-bar dropdown rows (.hznrow) AND the
    // Filters-panel chips (.hzc) — so they never disagree.
    document.querySelectorAll('.hznrow[data-plr="'+t+'"], .hzc[data-plr="'+t+'"]').forEach(function(el){ el.classList.toggle('on',window.__players[t]); });
    if(typeof window.__syncPlayerCounts==='function')window.__syncPlayerCounts();
    if(window.__mapRefetch)window.__mapRefetch();
  };
  window.__syncPlayerCounts=function(){
    var T=window.__playerTotals||{};
    function fmt(n){ n=Number(n)||0; return n>=1000?(n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':Math.round(n/100)/10+'K').replace(/\.0([KM])/,'$1'):String(n); }
    ['companies','buyers'].forEach(function(t){
      var el=document.querySelector('.hznn[data-plrn="'+t+'"]'); if(!el)return;
      el.textContent = (window.__players[t]!==false) ? fmt(T[t]) : '';
    });
    var onCount=['companies','buyers'].filter(function(k){return window.__players[k]!==false;}).length;
    var btn=document.getElementById('plrBtn');
    if(btn)btn.textContent = onCount===2 ? 'Player type' : ('Player type · '+onCount+'/2');
  };
  (function(){
    var btn=document.getElementById('plrBtn'), pop=document.getElementById('plrPop');
    if(!btn||!pop)return;
    function setOpen(o){ pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false'); btn.classList.toggle('on',o); if(o&&window.__placeHznPop)window.__placeHznPop(btn,pop); }
    // Same proven bubble-phase pattern as Horizons above (matches the working agencywrap/naicswrap).
    btn.onclick=function(e){ e.stopPropagation();
      if(typeof window.__syncPlayerCounts==='function')window.__syncPlayerCounts();
      var willShow=pop.hidden; if(window.__closeHznPops)window.__closeHznPops(); if(willShow)setOpen(true); };
    document.addEventListener('click',function(e){ if(!pop.hidden && !e.target.closest('#plrWrap'))setOpen(false); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape')setOpen(false); });
  })();
  // FSC SUPPLY-CLASS dropdown (DLA mode) — multi-select checkbox popover, same proven pattern as
  // Horizons/Players. Rows built lazily from __FSC_PRESETS (top DLA classes + titles + live counts).
  // Selecting toggles the code in window.__fscFilter → &fsc=... on the DLA fetch. (Eric 2026-07-31.)
  (function(){
    var btn=document.getElementById('fscBtn'), pop=document.getElementById('fscPop');
    if(!btn||!pop)return;
    var built=false;
    function setOpen(o){ pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false'); btn.classList.toggle('on',o); if(o&&window.__placeHznPop)window.__placeHznPop(btn,pop); }
    function label(){ var n=(window.__fscFilter||[]).length; btn.textContent = n===0 ? 'Supply class' : ('Supply class \\u00b7 '+n); }
    window.__fscLabel=label;
    function build(){
      if(built)return; var P=(window.__FSC_PRESETS||[]); if(!P.length)return;
      // Delegated click (below) reads data-fsc — avoids inline-onclick quote-escaping in this
      // string-embedded script (an escaped-quote onclick broke the whole map script once).
      pop.innerHTML = P.map(function(f){
        return '<button class="hznrow" type="button" data-fsc="'+f.code+'" style="--hzc:#1e3a8a">'
          + '<i></i><span class="hznlbl">'+f.code+' \\u00b7 '+String(f.title||'').replace(/[<>&]/g,'')+'</span>'
          + '<span class="hznn" data-fscn="'+f.code+'"></span></button>';
      }).join('');
      built=true;
    }
    window.__buildFscRows=build;
    // Delegated: click any FSC row → toggle its class in the filter.
    pop.addEventListener('click',function(e){ var b=e.target.closest('[data-fsc]'); if(b)window.toggleFsc(b.getAttribute('data-fsc')); });
    btn.onclick=function(e){ e.stopPropagation(); build();
      var willShow=pop.hidden; if(window.__closeHznPops)window.__closeHznPops(); if(willShow)setOpen(true); };
    document.addEventListener('click',function(e){ if(!pop.hidden && !e.target.closest('#fscWrap'))setOpen(false); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape')setOpen(false); });
    label();
  })();
  // Toggle one FSC class in the filter → refetch the DLA map.
  window.toggleFsc=function(code){
    var arr=window.__fscFilter||(window.__fscFilter=[]);
    var i=arr.indexOf(code);
    if(i>=0)arr.splice(i,1); else arr.push(code);
    var row=document.querySelector('.hznrow[data-fsc="'+code+'"]'); if(row)row.classList.toggle('on',arr.indexOf(code)>=0);
    if(typeof window.__fscLabel==='function')window.__fscLabel();
    if(window.__mapRefetch)window.__mapRefetch();
  };
  // Which standard filter-row controls are DISABLED (greyed + inert, but present in the SAME
  // slot — never removed/hidden) for the current mode. Menu-consistency fix (Eric 2026-07-26):
  // the row must look identical across Active/Awarded/Contacts so users never relearn it.
  // Filter-parity pass (2026-07-26): the top-bar disable set now matches EXACTLY what each
  // endpoint honors (see the mfv- matrix on MORE_FILTERS above) — Notice type is a SAM-opp-only
  // field (open only); the NAICS pill fires on open/recompete/companies (naics_code /
  // searchRecipients, both measured populated) but NOT buyers (contacts have no NAICS column);
  // Set-aside fires on open/recompete/companies (recompete's is weak-NULL but kept per spec) but
  // NOT buyers (a gov POC has no set-aside). "Filters" (moreBtn) stays enabled everywhere — the
  // deep panel always has at least State + Agency visible for every mode (see syncFilterVis).
  function disabledIdsFor(mode){
    var d=[];
    if(mode==='buyers')d.push('naicsBtn'); // contacts have no NAICS column
    // Agency pill: fires on open (department ilike), awarded (awarding_agency ilike), buyers
    // (department_ind_agency ilike), AND companies (2026-08-03: searchRecipients now scans
    // awards by awarding_agency/awarding_sub_agency when agency is set — no longer a dead
    // control on Companies).
    // Value pill: only Open (client-side est filter) + Awarded (server minValue/maxValue) have
    // a comparable $ range to filter on — Companies'/Buyers' totals aren't an "ask price" axis.
    if(mode!=='open'&&mode!=='recompete')d.push('valBtn');
    return d;
  }
  function applyModeDisabled(mode){
    var disabled=disabledIdsFor(mode);
    ['naicsBtn','agencyBtn','moreBtn','valBtn'].forEach(function(id){
      var el=document.getElementById(id); if(!el)return;
      var on=disabled.indexOf(id)>=0;
      el.classList.toggle('mode-disabled',on);
      el.disabled=on&&el.tagName==='SELECT'; // native <select> honors .disabled; buttons use pointer-events via CSS
      el.setAttribute('aria-disabled',on?'true':'false');
      var wrap=el.closest('.valwrap'); if(wrap)wrap.style.display=on?'none':'';
    });
  }
  // PLAYERS = the first premium moment. Anonymous visitors DO see this nav item on purpose — it
  // is one of the four pillars (Explore · Players · Pursuits · Markets), and hiding it would tell
  // a first-time visitor the product has three. But /api/app/contacts-map requires an MI session.
  //
  // THE BUG THIS REPLACES was one of SEQUENCE: the click switched mode FIRST, the fetch 401'd,
  // and the map sat half-switched — feed saying "sign in", #rescount still showing the PREVIOUS
  // dataset's count (measured on prod 2026-08-16: 145,460). That reads as broken software, not
  // as a gate. So: intercept BEFORE the mode changes, and only switch after auth succeeds. The
  // user never sees a wrong count, stale data, or a 401.
  //
  // Signed IN this path was never broken (contacts-map 200s, count updates 145,460 -> 157,393),
  // so an authed user falls straight through — the gate must never tax them.
  //
  // The words are OUTCOME language: anonymous users already get Today's Intel, the Lens, the map,
  // opportunities and listings. Players is where the trade changes from MARKET to RELATIONSHIPS,
  // which is the honest place to ask for a sign-in.
  // The FIRST PAYWALL MOMENT, built to feel aspirational rather than restrictive: it shows what is
  // behind the wall instead of refusing. Seven unlocks named as OUTCOMES, over a blurred strip that
  // shows the SHAPE of a real buyer record — the value is seen, not described.
  //
  // OAUTH WITHOUT A SUPABASE CLIENT: this file is a hand-written HTML string, so it cannot import
  // signInWithGoogle/Microsoft. It does not need to. /app already reads ?next=, threads it through
  // OAuth to /app/onboarding?next=…, and onboarding routes back (its own comment cites
  // /opportunity-map). So the buttons are links into the EXISTING, working flow carrying the FULL
  // current map URL — which is what makes "your map will be waiting" literally true: filters, lens
  // and viewport all survive because the URL does.
  window.__playersUnlockHtml = function(){
    var next = encodeURIComponent(location.pathname + location.search);
    function tick(label){
      return '<div class="pu-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' + label + '</div>';
    }
    function brow(k){ return '<div class="pu-brow"><span class="pu-bk">' + k + '</span><span class="pu-bv"></span></div>'; }
    return ''
      + '<h2 class="pu-h">Meet the Buyers</h2>'
      + '<p class="pu-sub">See the people and organizations behind every federal opportunity.</p>'
      + '<div class="pu-wrap">'
      +   '<div class="pu-list">'
      +     tick('Buying Offices') + tick('Contracting Officers')
      +     tick('Incumbents') + tick('Teaming Partners')
      +     tick('Small Business Offices') + tick('Buyer DNA')
      +     tick('Industry Events')
      +   '</div>'
      +   '<div class="pu-blur" aria-hidden="true">'
      +     brow('Contracting Officer') + brow('Buying Office') + brow('Incumbent') + brow('Buyer DNA')
      +   '</div>'
      + '</div>'
      + '<div class="pu-oauth">'
      +   '<a class="pu-btn" href="/app?next=' + next + '">Continue with Google</a>'
      +   '<a class="pu-btn" href="/app?next=' + next + '">Continue with Microsoft</a>'
      + '</div>'
      + '<div class="pu-or">OR</div>';
  };

  window.__playersGate = function(mode){
    var tk=''; try{ tk=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
    var live = tk && !(typeof window.__tokenExpired==='function' && window.__tokenExpired(tk));
    if(live){ setMapMode(mode); return; }          // signed in → straight through, no gate
    if(typeof window.openSignInModal==='function'){
      // Mode change lives in the RESUME callback — nothing switches until auth succeeds.
      window.openSignInModal('meet the buyers behind the opportunities', function(){ try{ setMapMode(mode); }catch(e){} });
      // AFTER the call, not before: openSignInModal writes #lgmFly itself, so filling these first
      // is silently clobbered. The modal is already open by now, so there is no flash.
      try{
        var slot=document.getElementById('lgmUnlock');
        if(slot)slot.innerHTML=window.__playersUnlockHtml();
        // Step 1's own heading becomes the email option, since the panel above now carries the
        // headline. The email field + Continue button are untouched.
        var h1=document.getElementById('lgmH1'); if(h1)h1.textContent='Continue with Email';
        var fly=document.getElementById('lgmFly'); if(fly)fly.innerHTML='';
        var f=document.createElement('p'); f.className='pu-foot';
        f.textContent='Your current map will be waiting when you return.';
        var st=document.getElementById('lgmStep1'); if(st && !document.querySelector('#lgmStep1 .pu-foot'))st.appendChild(f);
      }catch(e){}
    } else {
      location.href='/app?next='+encodeURIComponent(location.pathname+location.search);
    }
  };

  window.setMapMode=function(mode){ if(!MODES[mode]||mode===MODE)return; MODE=mode; window.__mapMode=mode;
    // Keep the current-dataset accent in sync (buyers red · everything else purple) for surfaces
    // that read CONTACT_COLOR without a row in hand (e.g. the buyer drawer accent).
    CONTACT_COLOR=(mode==='buyers')?BUYER_COLOR:COMPANY_COLOR;
    // Two-map nav: light the MAP the current dataset belongs to, not the exact dataset.
    // Opportunities = open|recompete|forecast (the work); Players = companies|buyers (the people).
    // So switching to Recompetes keeps "Opportunities" lit; Gov Buyers keeps "Players" lit.
    var _activeMap=(mode==='companies'||mode==='buyers')?'players':(mode==='dla'?'dla':'opportunities');
    var tabs=document.querySelectorAll('.zh-mode'); for(var i=0;i<tabs.length;i++)tabs[i].classList.toggle('on',tabs[i].getAttribute('data-map')===_activeMap);
    // Network map = entities, not horizons → hide the Open/Recompete/Forecast legend (body.is-network).
    try{ document.body.classList.toggle('is-network', isContactMode(mode)); }catch(e){}
    // Keep the Zillow-style dataset pill in sync (nav tab ↔ pill both drive setMapMode).
    var dsel=document.getElementById('fltDataset'); if(dsel&&dsel.value!==mode)dsel.value=mode;
    // The top filter row (dataset dropdown, Notice type, Set-aside, NAICS, Filters) stays
    // IDENTICAL in every mode now — nothing here is hidden/reflowed. Controls that don't apply
    // to the current dataset are disabled IN PLACE (see applyModeDisabled) so switching modes
    // never makes users relearn where things are.
    applyModeDisabled(mode);
    syncHorizonBarVis(mode);
    // Sort menu: Companies get their own option set ($ won / awards / name / set-aside-first) —
    // "Deadline (soonest)" is meaningless for a firm. Buyers/Open/Awarded keep the opp menu.
    if(typeof window.__setSortScope==='function')window.__setSortScope(mode==='companies'?'company':'opp');
    syncFilterVis();
    Q=''; var zsi=document.getElementById('zsearchInput'); if(zsi)zsi.value='';
    _didAutoFit=false; // re-frame the view to the new dataset's footprint on its next render
    fetchView();
  };
  // The Source filter (top-bar) belongs to the Opportunities map only — hide it on Players
  // (Companies/Gov Buyers have no sources). The horizon chips now live in the Filters panel, so
  // syncFilterVis (its mfv-open machinery) hides them on Players automatically — nothing to do here.
  function syncHorizonBarVis(mode){
    // Three maps, three per-mode dropdowns in the SAME toolbar slot:
    //   Opportunities → Horizons ▾   ·   Players → Players ▾   ·   DLA → Supply class (FSC) ▾
    var isDla=(mode==='dla');
    var isPlayers=(mode==='companies'||mode==='buyers');
    var onOpps=(!isDla && !isPlayers);
    var hzw=document.getElementById('hznWrap'); if(hzw)hzw.style.display=onOpps?'':'none';
    var plw=document.getElementById('plrWrap'); if(plw)plw.style.display=isPlayers?'':'none';
    var fsw=document.getElementById('fscWrap'); if(fsw)fsw.style.display=isDla?'':'none';
    // Industry (NAICS) dropdown is meaningless for DLA (FSC-coded) — hide it in DLA mode; the FSC
    // dropdown takes its place. It stays for Opportunities/Players (market-research needs NAICS).
    var naw=document.getElementById('naicsWrap'); if(naw)naw.style.display=isDla?'none':'';
  }
  applyModeDisabled(MODE); // initial state (default mode = 'open', nothing disabled)
  syncHorizonBarVis(MODE); // show horizon chips on the Opportunities map at load
  // Bulletproof popover-close: dismiss the Horizons/Players dropdowns on ANY map interaction
  // (pan/zoom start), on scroll, and whenever another top-bar dropdown changes — belt-and-suspenders
  // on top of the document capture-click handler, so a stuck-open popover can't happen from an
  // interaction the click handler misses (Eric 2026-07-31: "Horizons stays on screen permanent").
  // Place any .hznpop under its trigger via getBoundingClientRect. Required because .hznpop is
  // position:fixed (escapes .app overflow:hidden + mobile .ztop clipping) — without this the
  // panel opens at top:0/left:0 off-screen. Same pattern as the Value pill's place().
  window.__placeHznPop=function(btn,pop){
    if(!btn||!pop)return;
    var r=btn.getBoundingClientRect();
    var top=r.bottom+8;
    pop.style.top=top+'px';
    // Cap to the remaining viewport so Agency/Industry/FSC lists scroll INSIDE the panel
    // instead of running off the bottom of a phone screen (Eric 2026-08-12).
    var maxH=Math.max(160, window.innerHeight-top-12);
    pop.style.maxHeight=maxH+'px';
    // Measure after un-hiding (caller sets hidden=false first). Fall back to min-width if 0.
    var w=pop.offsetWidth||280;
    var left=Math.min(r.left, window.innerWidth-w-12);
    pop.style.left=Math.max(12,left)+'px';
    pop.style.right='auto';
  };
  window.__closeHznPops=function(){
    ['hznPop','plrPop','fscPop','naicsPop','agencyPop'].forEach(function(id){ var pp=document.getElementById(id); if(pp&&!pp.hidden){ pp.hidden=true;
      var bb=document.getElementById(id==='hznPop'?'hznBtn':(id==='plrPop'?'plrBtn':(id==='fscPop'?'fscBtn':(id==='naicsPop'?'naicsBtn':'agencyBtn')))); if(bb){bb.setAttribute('aria-expanded','false');bb.classList.remove('on');} } });
  };
  window.__hznPopSelector='#hznPop,#plrPop,#fscPop,#naicsPop,#agencyPop';
  window.__scrollIsInsideHznPop=function(t){ return !!(t&&t.closest&&t.closest(window.__hznPopSelector)); };
  try{ map.on('movestart', window.__closeHznPops); map.on('zoomstart', window.__closeHznPops); }catch(e){}
  // Scroll can come from window OR a nested scroller (the feed panel), so listen on BOTH in the
  // capture phase — a scroll inside the results list wouldn't reach a window scroll listener.
  // ⚠️ Do NOT close when the scroll is INSIDE an open popover — that was why Agency/Industry
  // lists on phones couldn't be scrolled (touch-scroll fired this listener and dismissed the menu).
  function __onPageScrollClosePops(e){ if(window.__scrollIsInsideHznPop(e.target))return; window.__closeHznPops(); }
  window.addEventListener('scroll', __onPageScrollClosePops, true);
  document.addEventListener('scroll', __onPageScrollClosePops, true);
  document.addEventListener('wheel', function(e){
    // Only close on a wheel that's NOT inside an open popover (so scrolling the popover list itself
    // — the Industry/Agency lists overflow — doesn't dismiss it).
    if(window.__scrollIsInsideHznPop(e.target))return;
    var open=false;
    ['hznPop','plrPop','fscPop','naicsPop','agencyPop'].forEach(function(id){ var pp=document.getElementById(id); if(pp&&!pp.hidden)open=true; });
    if(open)window.__closeHznPops();
  }, true);
  // Remember where the user left off so the next open lands there (__saveMapView is defined in
  // BOOT_VIEW_JS, which is injected after this block — hence the typeof guard; by the time a
  // moveend can fire, it exists). Saved un-debounced: a cheap localStorage write, and the last
  // moveend of a pan/zoom is the one that sticks.
  map.on('moveend',function(){ try{ if(typeof window.__saveMapView==='function')window.__saveMapView(); }catch(e){}
    clearTimeout(t); t=setTimeout(fetchView,450); });
  // Re-cluster on zoom WITHOUT refetching (Eric 2026-08-03 clustering): a zoom changes which
  // buckets collapse/expand, but the rows in hand are still valid — so re-run render() on the
  // current OPPS immediately for snappy cross-threshold expand/collapse. The moveend handler above
  // ALSO fires on zoom and will refetch the (possibly wider) bbox 450ms later; this just makes the
  // cluster/expand feel instant and correct even when the debounced fetch returns identical data.
  // render() only rebuilds pins/feed from OPPS — it never triggers a fetch — so this is safe.
  map.on('zoomend',function(){ try{ if(typeof render==='function')render(); }catch(e){} });
  var zsi=document.getElementById('zsearchInput');
  if(zsi)zsi.addEventListener('input',function(){ clearTimeout(t2); t2=setTimeout(function(){ Q=zsi.value.trim(); fetchView(); },400); });
  var tg=document.getElementById('fscToggle');
  if(tg)tg.onclick=function(){ HIDE_FSC=!HIDE_FSC; tg.classList.toggle('off',HIDE_FSC); tg.textContent=HIDE_FSC?'Hidden':'Shown'; fetchView(); };
  // Server-wired filter controls → write FILT + refetch (no client-side hide). scope=profile
  // needs the signed-in email (same localStorage token the save/drawer flows read).
  // ── ENGAGEMENT TRACKING ──────────────────────────────────────────────────────
  //
  // The map had NO instrumentation until 2026-08-03. There were 26 track() calls across
  // the /app panels and zero here, so every page_view we recorded was a panel and the
  // map's usage was INVISIBLE rather than low — 14 events from 7 users in 30 days, all
  // leaking in from elsewhere. That made "the map is the primary interface" impossible
  // to verify, which is the one claim the product strategy rests on.
  //
  // Posts to the same /api/app/engagement the panels use, so the admin dashboard picks
  // these up with no schema change. The endpoint allowlists eventType, so map specifics
  // ride in metadata rather than inventing types it would reject.
  //
  // FIRE AND FORGET, ALWAYS. Tracking must never delay a pan, block a click, or throw
  // into the map's render path. Every failure is swallowed on purpose.
  // PHASE 3 TELEMETRY — capture the map STATE, surface nothing (Eric 2026-08-16).
  //
  // "Resume your map" was measured before it was built: over 30 days only 27 users opened a
  // listing and 8 ran a search. A resume row would be empty for ~99% of visitors — the same math
  // that cut Saved Searches from /today, and the same rule: never give homepage real estate to a
  // behaviour that is not a habit yet. Demo day is 2026-08-22 and the map may reach ~2K users the
  // week after, so capturing NOW is what turns that week into the evidence that decides whether
  // resume is ever worth building.
  //
  // THE SHAPE IS {mode, filters, bbox} — deliberately identical to what __applySavedSearch
  // accepts and saved_searches.filters stores, so a future resume needs no new apply code and
  // saved searches / deep links / resume share ONE vocabulary instead of drifting into three.
  //
  // Attached to the STATEFUL actions only (map_search, listing_open) — never to every pan or
  // repaint, which would measure scrolling and write thousands of rows an hour.
  function _mapState(){
    var st={};
    try{
      // Same snapshot as the Save-search handler: skip empties and the 'all' sentinel.
      var f={}; for(var k in FILT){ if(FILT[k]&&FILT[k]!=='all')f[k]=FILT[k]; }
      if(typeof Q!=='undefined'&&Q)f.q=String(Q).slice(0,120);
      // Horizons are NOT part of FILT — they pick which endpoints get fetched. A saved search
      // that omitted them restored with every horizon on; telemetry without them is unusable
      // for the same reason.
      try{ var h=window.__horizons||{}; f.horizons={open:h.open!==false,recompete:!!h.recompete,forecast:!!h.forecast}; }catch(e){}
      // Strategy strands live on the checkboxes, not in FILT until readDeep() runs.
      try{ var sel=document.querySelectorAll('.mf-strategy:checked');
           if(sel.length)f.strategy=Array.prototype.slice.call(sel).map(function(b){return b.value;}).join(','); }catch(e){}
      st.filters=f;
      try{ var b=map.getBounds(); st.bbox={w:+b.getWest().toFixed(4),s:+b.getSouth().toFixed(4),e:+b.getEast().toFixed(4),n:+b.getNorth().toFixed(4)}; }catch(e){}
      try{ st.zoom=map.getZoom(); }catch(e){}
      // ENTRY POINT — which surface sent them here. Without it the data cannot answer the only
      // question that matters: do /today links and alert emails actually produce reusable
      // sessions, or do people arrive and start over? Read once at boot, before any navigation
      // rewrites the URL.
      try{ st.entry=window.__mapEntry||'direct'; }catch(e){}
    }catch(e){}
    return st;
  }
  // Captured ONCE at boot: the params that brought the user here, collapsed to a source label.
  try{
    var _qs=location.search||'';
    var _e='direct';
    if(/[?&]src=/.test(_qs)) _e=(_qs.match(/[?&]src=([^&]+)/)||[])[1]||'direct';
    else if(/[?&]ss=/.test(_qs)) _e='saved_search';
    else if(/[?&]strategy=/.test(_qs)) _e='lens';
    else if(/[?&]opp=/.test(_qs)) _e='listing_link';
    else if(/[?&](agency|naics|posted|mode|state|setAside|psc|q)=/.test(_qs)) _e='scoped_link';
    window.__mapEntry=String(_e).slice(0,40);
  }catch(e){ window.__mapEntry='direct'; }

  // Is this session's token past its exp? Decoding the payload is enough — the SIGNATURE is the
  // server's business, this only avoids firing at a session we already know is dead. Exposed as a
  // global because the drawer (DRAWER_JS) is a separate <script> IIFE and needs the same answer.
  window.__tokenExpired = function(tk){
    try{
      var s=String(tk||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
      while(s.length%4)s+='=';
      var p=JSON.parse(atob(s));
      return !!(p&&p.exp&&Number(p.exp)<Date.now());
    }catch(e){ return false; }   // undecodable → let the server decide, don't silently drop
  };

  function _track(kind, action, meta){
    try{
      var em=_uemail(); if(!em) return;              // signed-out: nothing to attribute
      var tk=''; try{ tk=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
      if(!tk) return;                                 // the endpoint requires proof of email
      // EXPIRED session: the payload still decodes, so _uemail() returns a real email and this
      // used to POST straight into a 401 — the event lost with no error surfaced. The MI TTL is
      // 30 days and 1,164 users sit dormant 31-120 days (measured 2026-08-16) against 1,282
      // active, so if demo day brings them back roughly HALF of returning sessions would have
      // fired telemetry into the void, during the one week the data matters most.
      if(window.__tokenExpired(tk)) return;
      var m=meta||{}; m.action=action; m.surface='opportunity_map';
      try{ m.mode=window.__mapMode||'open'; }catch(e){}
      // State rides along on the STATEFUL actions only — not on impressions/pans.
      if(action==='map_search'||action==='listing_open'){
        try{ var _st=_mapState(); m.filters=_st.filters; m.bbox=_st.bbox; m.zoom=_st.zoom; m.entry=_st.entry; }catch(e){}
      }
      fetch('/api/app/engagement',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-mi-auth-token':tk},
        body:JSON.stringify({email:em,eventType:kind,eventSource:'opportunity_map',metadata:m}),
        keepalive:true                                // survives a navigation away
      }).catch(function(){});
    }catch(e){}
  }
  window.__track=_track;

  // CARDS SHOWN — the denominator for "the Decision Card earns the click".
  //
  // Without this, listing_open is a bare count with nothing to divide by: 40 opens is
  // excellent against 200 cards shown and dismal against 20,000. The ratio is the only
  // form of the number that can actually test the claim.
  //
  // The unit is a RENDER PASS, not a card. drawFeed() re-runs on every filter change,
  // pan, sort and horizon switch, so one event per card would write thousands of rows an
  // hour and measure scrolling rather than seeing. We wrap drawFeed and fire once per
  // settled pass with the count, debounced so a drag that repaints ten times is one
  // impression, not ten.
  //
  // WHY A MutationObserver AND NOT A WRAPPER AROUND drawFeed:
  // the first version of this wrapped window.drawFeed, passed all its unit tests, and
  // fired ZERO events against a feed of 1,000 real cards. The template declares
  // drawFeed as a plain function declaration and calls it unqualified from render(), so
  // the call resolves to the closure binding — reassigning window.drawFeed rebinds a name nothing
  // ever reads. Watching the DOM the feed WRITES cannot be bypassed by any call path,
  // present or future, and keeps this out of template-html.ts (a 120KB single-line
  // template literal where a stray backtick is a build error).
  var _cardsT=null, _lastKey='';
  function _emitCardsShown(){
    try{
      var els=[]; try{ els=document.querySelectorAll('#feed .card'); }catch(e){}
      var n=els.length;
      if(!n) return;                    // an empty state is not an impression
      // DEDUPE ON THE FEED'S IDENTITY, NOT ITS SIZE. Two different traps ruled this:
      //  · count alone UNDERCOUNTS a growing feed — the map loads horizons progressively,
      //    so an early settle catches 600 of an eventual 1,000 and the corrected 1,000
      //    then looks like a duplicate. (Observed live: fired at 600, settled at 1,000.)
      //  · but "any change in count" OVERCOUNTS a re-sort, and "only if larger" would
      //    silently drop a real filter — 1,000 narrowed to 40 is 40 DIFFERENT cards seen.
      // First + last card id + the count identifies the visible set cheaply and correctly.
      var key=n+':';
      try{ key+=(els[0].dataset.sol||'')+'|'+(els[n-1].dataset.sol||''); }catch(e){}
      if(key===_lastKey) return;        // the same cards, re-painted: nothing new was seen
      _lastKey=key;
      var q=''; try{ q=(window.__lastQuery||'').slice(0,60); }catch(e){}
      _track('page_view','cards_shown',{count:n,query:q});
    }catch(e){}
  }
  function _installCardImpressions(){
    var feed=document.getElementById('feed');
    if(!feed||typeof MutationObserver!=='function') return false;
    try{
      new MutationObserver(function(){
        // Debounced: drawFeed appends cards one at a time, and a drag repaints the feed
        // repeatedly. One settled pass = one impression, not one per card.
        clearTimeout(_cardsT); _cardsT=setTimeout(_emitCardsShown,1200);
      }).observe(feed,{childList:true});
    }catch(e){ return false; }
    _emitCardsShown();                  // catch a feed already painted before we attached
    return true;
  }
  // #feed belongs to the template, which may not have parsed yet; retry briefly.
  if(!_installCardImpressions()){
    var _ciTries=0;
    var _ciInt=setInterval(function(){
      if(_installCardImpressions()||++_ciTries>40) clearInterval(_ciInt);
    },250);
  }

  function _uemail(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function bindSel(id,key){ var el=document.getElementById(id); if(!el)return; el.onchange=function(){ FILT[key]=el.value; markActive(el,el.value); fetchView(); }; }
  function bindInp(id,key,norm){ var el=document.getElementById(id); if(!el)return; el.oninput=function(){ clearTimeout(el._t); el._t=setTimeout(function(){ var v=el.value.trim(); if(norm)v=norm(v); FILT[key]=v; markActive(el,v); fetchView(); },400); }; }
  function markActive(el,v){ el.classList.toggle('on',!!v && v!=='all'); }
  // Notice-type top-bar select REMOVED (2026-07-27) — Notice type now filters ONLY via the
  // Filters panel (.mf-notice checkboxes → FILT.noticeMulti). FILT.noticeType stays in state
  // (harmless, unused by any control) so _merge(FILT.noticeType, FILT.noticeMulti) at fetchView
  // keeps working unchanged.
  // Companies / Buyers segmented control — REMOVED (2026-07-26): Companies and Gov Buyers are
  // now switched via the dataset dropdown/nav directly (setMapMode), same as every other
  // dataset — no nested sub-toggle to bind.
  // Set-aside top-bar pill REMOVED (2026-07-27) — set-aside filters ONLY via the Filters panel now
  // (.mf-set checkboxes → FILT.setAside/FILT.fullOpen). __saselReset kept as a NO-OP because
  // mode-switch/clear paths still call it (guard against a ReferenceError).
  window.__saselReset=function(){};
  // AGENCY multi-select — Zillow checkbox dropdown, SAME behavior as Industry (Eric 2026-08-01): ALL
  // agencies checked by default = the whole map; deselect to narrow; check several at once. Committed
  // state = { presetName:true }; on Apply the checked presets' .match needles PIPE-join into FILT.agency
  // (backend agencyOrExpr OR's them across all 3 sources, matching both word orders). ALL-checked (or
  // none) → FILT.agency='' = the TRUE whole map (agencies outside these ~16 presets are NOT hidden). A
  // strict subset narrows. Pipe delimiter (not comma) so "STATE, DEPARTMENT OF" survives intact.
  (function(){
    var btn=document.getElementById('agencyBtn'), pop=document.getElementById('agencyPop'),
        lbl=document.getElementById('agencyLabel'), list=document.getElementById('agencyList'),
        hdr=document.getElementById('agencyDeselect');
    if(!btn||!pop||!list) return;
    function presets(){ return (window.__AGENCY_PRESETS||[]); }
    function allNames(){ return presets().map(function(p){ return p.name; }); }
    function matchFor(nm){ var p=presets().filter(function(x){return x.name===nm;})[0]; return p?p.match:''; }
    var initialized=false;
    function ensureInit(){ if(initialized)return; var A=allNames(); if(!A.length)return; window.__agSel={}; A.forEach(function(n){ window.__agSel[n]=true; }); initialized=true; }
    var working = {};
    function committedNames(){ return Object.keys(window.__agSel||{}); }
    // ALL checked or NONE → no filter (whole map). A strict subset → pipe-joined match needles.
    function filterVal(names){ var total=allNames().length; if(names.length===0 || (total>0 && names.length===total))return '';
      var seen={}, out=[]; names.forEach(function(nm){ var m=matchFor(nm); if(m&&!seen[m]){seen[m]=1;out.push(m);} }); return out.join('|'); }
    function setLabel(){
      var names=committedNames(), total=allNames().length; var isAll = total>0 && names.length===total;
      lbl.textContent = (names.length===0 || isAll) ? 'Agency' : (names.length===1 ? names[0] : ('Agency \\u00b7 '+names.length));
      btn.classList.toggle('hasfilt', !isAll && names.length>0);
    }
    function syncHdr(){ if(!hdr)return; var total=allNames().length, n=Object.keys(working).length; hdr.textContent = (total>0 && n===total) ? 'Deselect all' : 'Select all'; }
    var built=false;
    function buildList(){
      if(built)return; var A=presets(); if(!A.length)return;
      built=true; list.innerHTML='';
      A.forEach(function(p){
        var row=document.createElement('button'); row.type='button'; row.className='hznrow'; row.setAttribute('data-nm',p.name);
        row.style.setProperty('--hzc','#006aff');
        row.appendChild(document.createElement('i'));
        var nm=document.createElement('span'); nm.className='hznlbl'; nm.textContent=p.name; row.appendChild(nm);
        // LIVE filtering — no Apply (Eric 2026-08-13: "This is a map. The whole magic is immediate
        // exploration"). Debounced so a burst of clicks costs ONE fetch, not one per checkbox.
        row.onclick=function(){ if(working[p.name])delete working[p.name]; else working[p.name]=true; row.classList.toggle('on',!!working[p.name]); syncHdr(); reflectAllRow(); commitLive(); };
        list.appendChild(row);
      });
    }
    // The All row is ON exactly when no individual industry is — one state, shown consistently.
    function reflectAllRow(){ var a=list.querySelector('[data-all]'); if(a)a.classList.toggle('on', Object.keys(working).length===0); }
    // Commit + refetch, debounced. Closing the popover no longer discards anything: there is no
    // staged-until-Apply state to lose, which is also why the Cancel-shaped "Apply" button is gone.
    var _liveT=null;
    function commitLive(){ clearTimeout(_liveT); _liveT=setTimeout(commit, 300); }
    function reflectWorking(){ reflectAllRow(); Array.prototype.slice.call(list.children).forEach(function(el){ el.classList.toggle('on', !!working[el.getAttribute('data-nm')]); }); syncHdr(); }
    function setOpen(o){ pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false'); btn.classList.toggle('on',o); if(o&&window.__placeHznPop)window.__placeHznPop(btn,pop); }
    function open(){ ensureInit(); buildList(); working={}; committedNames().forEach(function(nm){ working[nm]=true; }); reflectWorking(); if(window.__closeHznPops)window.__closeHznPops(); setOpen(true); }
    function commit(){
      window.__agSel={}; Object.keys(working).forEach(function(nm){ window.__agSel[nm]=true; });
      FILT.agency = filterVal(committedNames());
      // Mirror into the Filters-panel Agency input so a later Filters "Apply" (readDeep reads mfAgency)
      // doesn't wipe this selection. (Two controls, one FILT.agency.)
      var mfA=document.getElementById('mfAgency'); if(mfA)mfA.value=FILT.agency;
      setLabel(); setOpen(false); fetchView();
    }
    btn.onclick=function(e){ e.stopPropagation(); if(pop.hidden)open(); else setOpen(false); };
    if(hdr)hdr.onclick=function(e){ e.stopPropagation(); var A=allNames(), n=Object.keys(working).length;
      if(n<A.length){ working={}; A.forEach(function(nm){ working[nm]=true; }); } else { working={}; } reflectWorking(); };
    var ap=document.getElementById('agencyApply'); if(ap)ap.onclick=function(e){ e.stopPropagation(); commit(); };
    document.addEventListener('click',function(e){ if(!pop.hidden && !e.target.closest('#agencyWrap'))setOpen(false); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !pop.hidden)setOpen(false); });
    // Clear-all → back to DEFAULT = all agencies checked = whole map.
    window.__agencyReset=function(){ ensureInit(); var A=allNames(); window.__agSel={}; A.forEach(function(n){ window.__agSel[n]=true; }); working={}; A.forEach(function(n){ working[n]=true; }); FILT.agency=''; setLabel(); if(built)reflectWorking(); };
    // Restore from a saved search's FILT.agency (pipe-joined needles) → check matching presets + label.
    window.__agSetFromVal=function(val){ var need={}; String(val||'').split('|').map(function(s){return s.trim();}).filter(Boolean).forEach(function(m){ need[m]=1; });
      window.__agSel={}; presets().forEach(function(p){ if(need[p.match])window.__agSel[p.name]=true; }); working={}; Object.keys(window.__agSel).forEach(function(n){ working[n]=true; }); setLabel(); if(built)reflectWorking(); };
    ensureInit(); setLabel();
  })();
  // INDUSTRY multi-select — Zillow "Home Type" checkbox dropdown (Eric 2026-08-01). Check ANY set of
  // industries; on Apply, their preset NAICS codes OR together into FILT.naics (the SAME param the old
  // single-select + code filter used) so everything downstream (fetchView &naics=, header, saved-search)
  // works unchanged. Working selection (window.__indSel = a Set of preset names) is staged while the
  // popover is open and only committed on Apply — Zillow behavior; closing without Apply keeps the last
  // committed set. "Deselect all" clears the working set. Code-specific NAICS/PSC still live in Filters.
  // (Eric 2026-08-01: "when you start off ALL industries should be selected because it's the whole
  // map, then you deselect.") So the committed default is ALL industries checked = the full map. Key
  // honesty rule: ALL-checked (or none-checked) applies NO naics filter — FILT.naics='' — so the map
  // shows the TRUE unfiltered set, INCLUDING opportunities in NAICS that aren't in these 6 broad preset
  // buckets (manufacturing, ag, …). Only a STRICT SUBSET narrows: then FILT.naics = union of the checked
  // buckets' codes. This way "all checked" honestly means "everything", never "the union of 6 buckets"
  // (which would silently HIDE non-bucketed opps). Uncheck to narrow → Apply.
  (function(){
    var btn=document.getElementById('naicsBtn'), pop=document.getElementById('naicsPop'), lbl=document.getElementById('naicsLabel'), list=document.getElementById('indList');
    var hdr=null;   // the "Deselect all" control is gone — the "All industries" row replaces it
    if(!btn||!pop||!list) return;
    function presets(){ return (window.__INDUSTRY_PRESETS||[]); }
    function allNames(){ return presets().map(function(p){ return p.name; }); }
    // committed = { presetName:true } of what's CHECKED. Default = ALL (whole map). window.__indSel
    // being undefined at first means "not yet initialized" → treat as all-checked.
    var initialized=false;
    // DEFAULT = NOTHING checked = "All industries" (Eric 2026-08-13). This REVERSES the 2026-08-01
    // call ("when you start off ALL industries should be selected because it's the whole map") and
    // the reason is worth keeping: twelve checkboxes all ticked, under a "Deselect all" header,
    // reads as "I chose these twelve" when what is true is "no industry filter applied". Those are
    // different statements, and only one of them is honest about the state.
    // The FILTER outcome is identical either way — none-checked and all-checked both mean no naics
    // filter — so this changes what the control SAYS, not what the map returns.
    function ensureInit(){ if(initialized)return; if(!allNames().length)return; window.__indSel={}; initialized=true; }
    var working = {};                            // staged set while open
    function committedNames(){ return Object.keys(window.__indSel||{}); }
    function codesFor(names){
      var seen={}, out=[]; var P=presets();
      names.forEach(function(nm){ var p=P.filter(function(x){return x.name===nm;})[0]; if(p)(p.codes||[]).forEach(function(c){ if(!seen[c]){seen[c]=1;out.push(c);} }); });
      return out;
    }
    // PSC codes for the checked industries (Cybersecurity is PSC-defined — DJ01/DJ10 —
    // because cyber has no NAICS home). ORed into FILT.psc so picking "Cybersecurity"
    // returns actual security work, not all of IT.
    function pscFor(names){
      var seen={}, out=[]; var P=presets();
      names.forEach(function(nm){ var p=P.filter(function(x){return x.name===nm;})[0]; if(p)(p.psc||[]).forEach(function(c){ if(!seen[c]){seen[c]=1;out.push(c);} }); });
      return out;
    }
    // ALL checked or NONE checked → no filter (whole map). A strict subset → that subset's codes.
    function filterCodes(names){ var total=allNames().length; return (names.length===0 || (total>0 && names.length===total)) ? '' : codesFor(names).join(','); }
    function filterPsc(names){ var total=allNames().length; return (names.length===0 || (total>0 && names.length===total)) ? '' : pscFor(names).join(','); }
    function setLabel(){
      var names=committedNames(), total=allNames().length;
      // All-checked (or nothing initialized yet) = the neutral full-map view → plain "Industry", no filter dot.
      var isAll = total>0 && names.length===total;
      // "Industry · 1", not "Construction" — the count is the state, and a lone preset name made a
      // filtered map look like a different control entirely.
      lbl.textContent = (names.length===0 || isAll) ? 'Industry' : ('Industry \\u00b7 '+names.length);
      btn.classList.toggle('hasfilt', !isAll && names.length>0);
    }
    // Header toggle text: if everything's checked, offer "Deselect all"; otherwise "Select all".
    function syncHdr(){ if(!hdr)return; var total=allNames().length, n=Object.keys(working).length; hdr.textContent = (total>0 && n===total) ? 'Deselect all' : 'Select all'; }
    // Build the checkbox rows LAZILY on first open — __INDUSTRY_PRESETS is set by BOOT_VIEW_JS, which
    // runs AFTER this block, so reading it at IIFE-eval time gives []. Build on demand.
    var built=false;
    function buildList(){
      if(built)return; var P=presets(); if(!P.length)return;
      built=true; list.innerHTML='';
      // "All industries" as the first, explicit option — the honest name for "no filter". Checked
      // whenever nothing else is, so the control always states its own state rather than implying
      // a twelve-way selection the user never made.
      var allRow=document.createElement('button'); allRow.type='button'; allRow.className='hznrow'; allRow.setAttribute('data-all','1');
      allRow.style.setProperty('--hzc','#006aff');
      allRow.appendChild(document.createElement('i'));
      var aw=document.createElement('span'); aw.className='indwrap';
      var an=document.createElement('span'); an.className='hznlbl'; an.textContent='All industries'; aw.appendChild(an);
      var ad=document.createElement('span'); ad.className='ind-desc'; ad.textContent='No industry filter \\u2014 the whole map'; aw.appendChild(ad);
      allRow.appendChild(aw);
      allRow.onclick=function(){ working={}; reflectWorking(); commitLive(); };
      list.appendChild(allRow);
      P.forEach(function(p){
        var row=document.createElement('button'); row.type='button'; row.className='hznrow'; row.setAttribute('data-nm', p.name);
        row.style.setProperty('--hzc','#006aff');
        var box=document.createElement('i'); row.appendChild(box);
        // .indwrap holds name + description stacked (textContent — esc isn't in this IIFE's scope, and
        // preset name/description are static server strings anyway, so textContent is exact + safe).
        var wrap=document.createElement('span'); wrap.className='indwrap';
        var nm=document.createElement('span'); nm.className='hznlbl'; nm.textContent=p.name; wrap.appendChild(nm);
        if(p.description){ var d=document.createElement('span'); d.className='ind-desc'; d.textContent=p.description; wrap.appendChild(d); }
        row.appendChild(wrap);
        // commitLive() (not just syncHdr) — the Industry menu has NO Apply button by design, so a
        // row that only repaints itself leaves FILT.naics/FILT.psc untouched and the map never
        // refetches. Same live-filter contract as the Agency rows.
        row.onclick=function(){ if(working[p.name])delete working[p.name]; else working[p.name]=true; row.classList.toggle('on',!!working[p.name]); syncHdr(); reflectAllRow(); commitLive(); };
        list.appendChild(row);
      });
    }
    // This IIFE's OWN copy — see the commitLive note below on why nothing here reaches into the
    // Agency IIFE. Keeps the "All industries" row lit whenever no specific industry is selected.
    function reflectAllRow(){ var a=list.querySelector('[data-all]'); if(a)a.classList.toggle('on', Object.keys(working).length===0); }
    function reflectWorking(){ reflectAllRow(); Array.prototype.slice.call(list.children).forEach(function(el){ el.classList.toggle('on', !!working[el.getAttribute('data-nm')]); }); syncHdr(); }
    // Debounced commit — this IIFE's OWN copy. The Agency IIFE declares a commitLive() too, but
    // function declarations are function-scoped, not <script>-tag-scoped: calling Agency's from here
    // threw "commitLive is not defined" and killed the click handler mid-flight (measured on prod
    // 2026-08-17 — the "All industries" row cleared visually but never refetched). Each IIFE owns its
    // own debounce timer; never reach across.
    var _liveT=null;
    function commitLive(){ clearTimeout(_liveT); _liveT=setTimeout(commit, 300); }
    function setOpen(o){ pop.hidden=!o; btn.setAttribute('aria-expanded',o?'true':'false'); btn.classList.toggle('on',o); if(o&&window.__placeHznPop)window.__placeHznPop(btn,pop); }
    function open(){
      ensureInit(); buildList();
      working={}; committedNames().forEach(function(nm){ working[nm]=true; });   // stage from committed
      reflectWorking();
      if(window.__closeHznPops)window.__closeHznPops();
      setOpen(true);
    }
    function commit(){
      window.__indSel={}; Object.keys(working).forEach(function(nm){ window.__indSel[nm]=true; });
      FILT.naics = filterCodes(committedNames());
      FILT.psc = filterPsc(committedNames());   // Cyber = PSC (DJ01/DJ10), ORed with NAICS
      // Mirror into the Filters-panel inputs so a later Filters "Apply" (readDeep reads
      // mfNaics/mfPsc) doesn't wipe this Industry selection. (Two-controls-one-FILT sync.)
      // NAICS mirrors into the CHIP tray (set() takes the same comma-joined string), not the raw
      // text box — codes in the text box would now read as unresolved input and block Apply.
      if(window.__naicsChips)window.__naicsChips.set(FILT.naics);
      else { var mfN=document.getElementById('mfNaics'); if(mfN)mfN.value=FILT.naics; }
      var mfP=document.getElementById('mfPsc'); if(mfP)mfP.value=FILT.psc;
      // The popover STAYS OPEN — with live filtering you check Construction, watch the pins change,
      // then add Cybersecurity without reopening the menu. Closing on commit was an Apply-era habit.
      setLabel(); fetchView();
    }
    btn.onclick=function(e){ e.stopPropagation(); if(pop.hidden)open(); else setOpen(false); };
    // Header toggle: Select all ⇄ Deselect all (Zillow). If not everything is checked → check all;
    // else clear. (Both extremes commit to the whole map on Apply — see filterCodes.)
    if(hdr)hdr.onclick=function(e){ e.stopPropagation(); var A=allNames(), n=Object.keys(working).length;
      if(n<A.length){ working={}; A.forEach(function(nm){ working[nm]=true; }); } else { working={}; }
      reflectWorking(); };
    document.addEventListener('click',function(e){ if(!pop.hidden && !e.target.closest('#naicsWrap'))setOpen(false); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !pop.hidden)setOpen(false); });
    // Reset (Clear-all): back to the DEFAULT = all industries checked = whole map (no filter).
    window.__naicsReset=function(){ ensureInit(); window.__indSel={}; working={}; FILT.naics=''; FILT.psc=''; setLabel(); if(built)reflectWorking(); };
    // Restore committed names from a saved search's FILT.naics → check exactly those rows + label.
    window.__indSetFromCodes=function(names){ window.__indSel={}; (names||[]).forEach(function(nm){ window.__indSel[nm]=true; }); working={}; (names||[]).forEach(function(nm){ working[nm]=true; }); setLabel(); if(built)reflectWorking(); };
    ensureInit(); setLabel();
  })();
  // VALUE range pill (Zillow price picker) — replaces the old top-bar Notice-type select.
  // Awarded: server-side (recompete-map already honors minValue/maxValue → fetchView()).
  // Open: the open-opps endpoint does NOT filter by value, so the range is applied CLIENT-SIDE
  // over the pins already loaded for the viewport — wraps the template's own pass(o) predicate
  // (the SAME hook the dead legacy client filters used) so it composes with everything else
  // pass() already checks, and stays correct across every future render() call (pan/mode-switch)
  // without re-fetching. Companies/Buyers: pill hidden entirely (disabledIdsFor/applyModeDisabled).
  (function(){
    var btn=document.getElementById('valBtn'), pan=document.getElementById('valPanel'), lbl=document.getElementById('valLabel');
    var histEl=document.getElementById('valHist'), minEl=document.getElementById('valMin'), maxEl=document.getElementById('valMax');
    if(!btn||!pan||!lbl||!histEl||!minEl||!maxEl) return;
    var minV=null, maxV=null; // active applied range (numbers or null = no bound)
    // Zillow $-formatted inputs: fmtDollar(2028546)="$2,028,546"; parseDollar strips $/commas → number
    // (null if empty). setInput writes the formatted string; readInput reads the number back.
    function fmtDollar(n){ return (n==null||!isFinite(n))?'':('$'+Math.round(n).toLocaleString('en-US')); }
    function parseDollar(s){ var d=String(s||'').replace(/[^0-9.]/g,''); if(d==='')return null; var v=parseFloat(d); return isFinite(v)?v:null; }
    function setMinInput(n){ minEl.value=(n==null)?'':fmtDollar(n); }
    function setMaxInput(n){ maxEl.value=(n==null)?'':fmtDollar(n); }
    // Live-reformat as the user types (keep the caret at the end — good enough for a numeric field).
    function reformat(el){ var v=parseDollar(el.value); el.value=(v==null)?'':fmtDollar(v); }
    // Compact $ label for the pill text + histogram bucket tooltips (mMoney/mCompact are hoisted
    // globals from PIN_JS — same helpers the value-tag pins themselves use).
    function fmtShort(n){ return (typeof mMoney==='function') ? (mMoney(n)||('$'+Math.round(n))) : ('$'+Math.round(n)); }
    function setLabel(){
      if(minV==null && maxV==null){ lbl.textContent='Value'; btn.classList.remove('hasfilt'); return; }
      var t = (minV!=null && maxV!=null) ? (fmtShort(minV)+'\\u2013'+fmtShort(maxV))
        : (minV!=null) ? (fmtShort(minV)+'+') : ('Under '+fmtShort(maxV));
      lbl.textContent='Value \\u00b7 '+t; btn.classList.add('hasfilt');
    }
    // The value axis per dataset — Open uses the M-Estimate median (o.est); Awarded uses the real
    // USASpending ceiling (o.valueNum, added to recompete-map's toPin()/toRow() 2026-07-27).
    // Ground in real data: reads the pins actually loaded for the current viewport, never a guess.
    function valuesInView(){
      var out=[];
      (window.OPPS||OPPS||[]).forEach(function(o){
        // Per-PIN now (the Opportunities map mixes horizons): recompete pins carry valueNum (real
        // USASpending ceiling), open/forecast/grants carry est (M-Estimate / grant ceiling).
        var v = (o.src==='RECOMPETE') ? Number(o.valueNum) : Number(o.est);
        if(isFinite(v) && v>0) out.push(v);
      });
      return out;
    }
    // ~24 buckets on a LOG scale (Zillow's price histogram). Federal $ span $10K–$1B+, so a LINEAR
    // axis crushes ~every value into bucket 0 (a single left spike). Log spreads them so a $100K and
    // a $10M opp land in visibly different bars — the "fuller" Zillow look. Bucket index = log(v)
    // mapped across [log(lo), log(hi)]. Honest-degrade: <8 in-view values → inputs, no fake chart.
    // Slider axis bounds for the CURRENT view — set by buildHist(), read by the drag handles so the
    // knobs map to the SAME log scale as the histogram bars. axLo/axHi are the $ min/max in view.
    var axLo=0, axHi=0, axLgLo=0, axSpan=1, axCapped=false;
    function buildHist(){
      var vals=valuesInView();
      if(vals.length<8){ histEl.innerHTML=''; var none=document.createElement('div'); none.className='val-hist-none';
        none.textContent='Not enough values in view to chart a distribution \\u2014 min/max still apply.'; histEl.appendChild(none); teardownSlider(); return; }
      vals.sort(function(a,b){return a-b;});
      // Clamp the axis to PERCENTILES, not the absolute min/max (Eric: a single $1B outlier stretches
      // the axis so the bulk crushes left). Zillow caps at "$10M+": the 5th–95th pctile fills the
      // chart with the meaty middle; everything above the 95th collapses into the final "+" bucket.
      function pctile(p){ var idx=Math.min(vals.length-1, Math.max(0, Math.floor(p*(vals.length-1)))); return vals[idx]; }
      // Round a raw cap UP to a clean boundary (1/2/5 × 10^n) so the axis reads "$2M+" not "$1.9M+"
      // (Eric) — matches Zillow's round "$10M+". Applied only to the capped high, not the floor.
      function niceCeil(n){ if(!(n>0))return n; var e=Math.pow(10,Math.floor(Math.log(n)/Math.LN10)); var m=n/e;
        var nm=(m<=1)?1:(m<=2)?2:(m<=5)?5:10; return nm*e; }
      var lo=pctile(0.05), rawHi=pctile(0.95), capped=(vals[vals.length-1]>rawHi);
      var hi=capped?niceCeil(rawHi):rawHi;
      if(hi<=lo){ lo=vals[0]; hi=vals[vals.length-1]; capped=false; } // degenerate (all ~equal) → full range
      if(hi<=lo){ histEl.innerHTML=''; teardownSlider(); return; }
      var lgLo=Math.log(lo), lgHi=Math.log(hi), span=lgHi-lgLo || 1;
      axLo=lo; axHi=hi; axLgLo=lgLo; axSpan=span; axCapped=capped;
      var N=24, buckets=new Array(N).fill(0);
      // A value above the cap lands in the LAST bucket (the "+" bin); below the floor → first bucket.
      vals.forEach(function(v){ var idx=Math.min(N-1, Math.max(0, Math.floor((Math.log(v)-lgLo)/span*N))); buckets[idx]++; });
      var max=Math.max.apply(null,buckets)||1;
      histEl.innerHTML='';
      var lab=document.createElement('div'); lab.className='val-hist-lab'; lab.textContent='Where opportunities in view fall';
      histEl.appendChild(lab);
      var chart=document.createElement('div'); chart.className='val-hist';
      // bucket edges are on the log axis → convert back with Math.exp for the tooltip $ range.
      buckets.forEach(function(c,i){
        var bar=document.createElement('div'); bar.className='val-bar';
        var pct=c?Math.max(6,Math.round(c/max*100)):3; bar.style.height=pct+'%';
        var bLo=Math.exp(lgLo+span*(i/N)), bHi=Math.exp(lgLo+span*((i+1)/N));
        bar.title=fmtShort(bLo)+'\\u2013'+fmtShort(bHi)+': '+c+' in view';
        chart.appendChild(bar);
      });
      histEl.appendChild(chart);
      setupSlider();
    }
    // ── Draggable range slider (Zillow) ──────────────────────────────────────────────
    // Two knobs over a track under the histogram. Position ↔ value on the LOG axis (axLgLo/axSpan),
    // so a knob at 50% = geometric-mean $, matching how the bars are spaced. Dragging updates the
    // Min/Max inputs LIVE (and vice-versa via syncSliderFromInputs). Clamped: lo≤hi.
    var slEl=document.getElementById('valSlider'), knobLo=document.getElementById('valKnobLo'),
        knobHi=document.getElementById('valKnobHi'), fillEl=document.getElementById('valRangeFill'),
        axLoEl=document.getElementById('valAxisLo'), axHiEl=document.getElementById('valAxisHi');
    function valToFrac(v){ if(!(axSpan>0))return 0; return Math.max(0,Math.min(1,(Math.log(v)-axLgLo)/axSpan)); }
    function fracToVal(f){ return Math.exp(axLgLo+axSpan*Math.max(0,Math.min(1,f))); }
    function paintSlider(loFrac,hiFrac){
      if(!slEl)return;
      knobLo.style.left=(loFrac*100)+'%'; knobHi.style.left=(hiFrac*100)+'%';
      fillEl.style.left=(loFrac*100)+'%'; fillEl.style.width=((hiFrac-loFrac)*100)+'%';
    }
    function teardownSlider(){ if(slEl)slEl.style.display='none'; if(axLoEl&&axLoEl.parentElement)axLoEl.parentElement.style.display='none'; }
    function setupSlider(){
      if(!slEl||!(axHi>axLo)) { teardownSlider(); return; }
      slEl.style.display=''; if(axLoEl&&axLoEl.parentElement)axLoEl.parentElement.style.display='';
      // "+" only when the axis is capped below the true max (Zillow "$10M+"); else the exact high.
      if(axLoEl)axLoEl.textContent=fmtShort(axLo); if(axHiEl)axHiEl.textContent=fmtShort(axHi)+(axCapped?'+':'');
      // initial knob positions from the applied range (or full span if none)
      var loF=(minV!=null)?valToFrac(minV):0, hiF=(maxV!=null)?valToFrac(maxV):1;
      paintSlider(loF, hiF);
      bindKnob(knobLo,'lo'); bindKnob(knobHi,'hi');
    }
    var _dragBound=false;
    function bindKnob(knob,which){
      if(!knob||knob.__bound)return; knob.__bound=true;
      function onDown(e){ e.preventDefault(); e.stopPropagation();
        var rect=slEl.getBoundingClientRect();
        function move(ev){ var cx=(ev.touches?ev.touches[0].clientX:ev.clientX);
          var f=Math.max(0,Math.min(1,(cx-rect.left)/rect.width));
          var loF=valToFrac(minV!=null?minV:axLo), hiF=valToFrac(maxV!=null?maxV:axHi);
          if(which==='lo'){ f=Math.min(f,hiF);
            // far LEFT = "no minimum" (don't exclude the small buys at the floor)
            if(f<=0.01){ minV=null; setMinInput(null); } else { minV=Math.round(fracToVal(f)); setMinInput(minV); }
            paintSlider(f,hiF); }
          else { f=Math.max(f,loF);
            // far RIGHT = "no maximum" — INCLUDE everything above the capped axis (Zillow "$10M+")
            if(f>=0.99){ maxV=null; setMaxInput(null); } else { maxV=Math.round(fracToVal(f)); setMaxInput(maxV); }
            paintSlider(loF,f); }
        }
        function up(){ document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up);
          document.removeEventListener('touchmove',move); document.removeEventListener('touchend',up); }
        document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
        document.addEventListener('touchmove',move,{passive:false}); document.addEventListener('touchend',up);
      }
      knob.addEventListener('mousedown',onDown); knob.addEventListener('touchstart',onDown,{passive:false});
    }
    // Typing in Min/Max moves the knobs (two-way sync).
    function syncSliderFromInputs(){
      if(!slEl||slEl.style.display==='none')return;
      var mn=parseDollar(minEl.value), mx=parseDollar(maxEl.value);
      var loF=(mn!=null)?valToFrac(mn):0, hiF=(mx!=null)?valToFrac(mx):1;
      paintSlider(loF, hiF);
    }
    minEl.addEventListener('input',syncSliderFromInputs); maxEl.addEventListener('input',syncSliderFromInputs);
    // Re-format to $#,### when the field loses focus (typing stays raw so the caret isn't fought).
    minEl.addEventListener('blur',function(){reformat(minEl);}); maxEl.addEventListener('blur',function(){reformat(maxEl);});
    function place(){ var r=btn.getBoundingClientRect(); pan.style.top=(r.bottom+8)+'px'; var left=Math.min(r.left, window.innerWidth-pan.offsetWidth-12); pan.style.left=Math.max(12,left)+'px'; }
    btn.onclick=function(e){ e.stopPropagation(); buildHist(); setMinInput(minV); setMaxInput(maxV);
      var willShow=!pan.classList.contains('show'); pan.classList.toggle('show'); if(willShow)place(); };
    document.addEventListener('click',function(e){ if(!e.target.closest('.valwrap')) pan.classList.remove('show'); });
    // Keep the deep Filters-panel value select (mfValue) mirrored so it never silently disagrees
    // with the pill — both ultimately just write FILT.valueRange, this pill is the primary UI now.
    function syncDeepSelect(){
      // Mirror the top-bar value pill's min/max into the deep-panel min–max PAIR (Zillow redesign PR3).
      // The selects only hold specific bands, so set a bound only when it exactly matches an option;
      // an off-band custom value from the pill leaves that select blank rather than lie.
      var setIf=function(id,v){ var el=document.getElementById(id); if(!el)return; var s=(v!=null?String(v):'');
        var ok=false; for(var i=0;i<el.options.length;i++){ if(el.options[i].value===s){ el.value=s; ok=true; break; } } if(!ok)el.value=''; };
      setIf('mfValueMin', minV);
      setIf('mfValueMax', maxV);
      // Keep the legacy hidden #mfValue in sync too (harmless mirror for any code still reading it).
      var sel=document.getElementById('mfValue'); if(sel){ var want=(minV!=null?String(minV):'')+'-'+(maxV!=null?String(maxV):'');
        var m=false; for(var j=0;j<sel.options.length;j++){ if(sel.options[j].value===want){ sel.value=want; m=true; break; } } if(!m)sel.value=''; }
    }
    function applyClientOpenFilter(){
      // Compose with whatever the template's OWN pass(o) already checks (the legacy client
      // filter sheets — always-true today, see F defaults — plus any future addition) so this
      // never silently overrides other filtering. window.__valuePass is this pill's own check;
      // pass() is monkey-patched ONCE (see below) to AND the two together.
      window.__valuePass=function(o){
        var v=Number(o.est);
        if(!isFinite(v)||v<=0) return (minV==null && maxV==null); // no estimate → only show under "any value"
        if(minV!=null && v<minV) return false;
        if(maxV!=null && v>maxV) return false;
        return true;
      };
    }
    // Monkey-patch the template's global pass(o) EXACTLY ONCE (mirrors how DRAWER_JS wraps the
    // global render() — pass()/render()/OPPS are plain top-level function/let declarations in the
    // template's own <script>, so they're reachable + reassignable from this separate script tag).
    if(typeof window.__origPass!=='function' && typeof pass==='function'){
      window.__origPass=pass;
      pass=function(o){
        if(!window.__origPass(o))return false;
        if(MODE==='open' && typeof window.__valuePass==='function') return window.__valuePass(o);
        return true;
      };
    }
    function apply(){
      minV=parseDollar(minEl.value); maxV=parseDollar(maxEl.value);
      if(minV!=null && !isFinite(minV))minV=null; if(maxV!=null && !isFinite(maxV))maxV=null;
      setMinInput(minV); setMaxInput(maxV); // normalize the fields to the $-formatted applied values
      setLabel();
      FILT.valueRange = (minV!=null||maxV!=null) ? ((minV!=null?minV:'')+'-'+(maxV!=null?maxV:'')) : '';
      syncDeepSelect();
      pan.classList.remove('show');
      if(MODE==='recompete'){ fetchView(); }
      else { applyClientOpenFilter(); INVIEW=0; render(); } // client-side: recompute the shown count from the actual filtered rows, not the server's unfiltered totalInView
    }
    var ap=document.getElementById('valApply'); if(ap)ap.onclick=apply;
    var cl=document.getElementById('valClr'); if(cl)cl.onclick=function(){ setMinInput(null); setMaxInput(null); apply(); };
    // Restore from a saved search (FILT.valueRange = "min-max" string, same shape mfValue uses).
    window.__valReflect=function(vr){
      var parts=String(vr||'').split('-');
      minV=(parts[0]!==''&&parts[0]!=null)?Number(parts[0]):null;
      maxV=(parts[1]!==''&&parts[1]!=null)?Number(parts[1]):null;
      if(minV!=null&&!isFinite(minV))minV=null; if(maxV!=null&&!isFinite(maxV))maxV=null;
      setLabel(); syncDeepSelect();
      if(MODE==='open')applyClientOpenFilter();
    };
    window.__valReset=function(){ minV=null; maxV=null; setLabel(); window.__valuePass=null; };
  })();
  // Scope (all vs matched-to-me) moved into the More-filters panel.
  var mfScopeEl=document.getElementById('mfScope'); if(mfScopeEl)mfScopeEl.onchange=function(){ FILT.scope=mfScopeEl.value; fetchView(); };

  // ── Deep "More filters" panel ──────────────────────────────────────────
  function _checked(cls){ return Array.prototype.slice.call(document.querySelectorAll(cls)).filter(function(c){return c.checked;}).map(function(c){return c.value;}).join(','); }
  // Set the Filters Apply button to "Show N results" (Zillow). n = the current in-view result count.
  // Passed the live count from updateHeader; falls back to the loaded/TOTAL count. Never shows a stale
  // "Apply" verb with no number once data has loaded.
  function updateApplyCount(n){
    var ap=document.getElementById('mfApply'); if(!ap)return;
    if(typeof n!=='number'){ n=(typeof INVIEW!=='undefined'&&INVIEW)?INVIEW:((typeof TOTAL!=='undefined'&&TOTAL)?TOTAL:(typeof OPPS!=='undefined'?OPPS.length:0)); }
    if(n>0){ ap.textContent='Show '+n.toLocaleString()+' result'+(n===1?'':'s'); }
    else { ap.textContent='Show results'; }
  }
  function readDeep(){
    FILT.scope=(document.getElementById('mfScope')||{}).value||'all';
    // NAICS comes from the CHIP tray (resolved codes only), never the raw text box. Unresolved
    // text left in the input BLOCKS the apply — readDeep returns false and the caller bails, so
    // a half-typed word can never become a filter (Eric: "the UI cannot silently produce
    // incorrect results").
    var _nc=window.__naicsChips;
    if(_nc){
      if(_nc.pending()){ _nc.flag('Pick a NAICS code from the list \\u2014 "'+_nc.pending()+'" is not a code'); return false; }
      FILT.naics=_nc.value();
    } else { FILT.naics=(document.getElementById('mfNaics')||{}).value||''; }
    FILT.psc=(document.getElementById('mfPsc')||{}).value||'';
    FILT.fsc=((document.getElementById('mfFsc')||{}).value||'').replace(/\s+/g,'');
    FILT.agency=(document.getElementById('mfAgency')||{}).value||'';
    // Buying office (DoDAAC) — buyers-only; uppercased so w912pl works as typed.
    FILT.office=((document.getElementById('mfOffice')||{}).value||'').trim().toUpperCase();
    FILT.state=((document.getElementById('mfState')||{}).value||'').toUpperCase().slice(0,2);
    FILT.postedDays=(document.getElementById('mfPosted')||{}).value||'';
    FILT.closingDays=(document.getElementById('mfClosing')||{}).value||'';
    // Deep-panel set-aside checks: 'OPEN' → Full & Open bucket (fullOpen), the rest → group codes.
    // fullOpen reflects EITHER OPEN control (deep panel .mf-set OR the top-bar .sa-set), so a deep
    // Apply never silently clears a top-bar Full & Open selection (and vice-versa).
    var _mfSet=_checked('.mf-set').split(',').filter(Boolean);
    var _saOpen=false; try{ _saOpen=!!document.querySelector('.sa-set[value="OPEN"]:checked'); }catch(e){}
    FILT.fullOpen=(_mfSet.indexOf('OPEN')>=0)||_saOpen;
    FILT.setAsideMulti=_mfSet.filter(function(v){return v!=='OPEN';}).join(',');
    FILT.noticeMulti=_checked('.mf-notice');
    // Value = a min–max PAIR now (Zillow). Compose the "min-max" string fetchView already expects.
    // Either bound alone is valid ("1000000-" = $1M+, "-5000000" = under $5M). Empty both → no filter.
    var _vmin=(document.getElementById('mfValueMin')||{}).value||'';
    var _vmax=(document.getElementById('mfValueMax')||{}).value||'';
    FILT.valueRange=(_vmin||_vmax)?(_vmin+'-'+_vmax):'';
    FILT.subAgency=(document.getElementById('mfSubAgency')||{}).value||'';
    FILT.country=(document.getElementById('mfCountry')||{}).value||'';
    FILT.hasDocs=(document.getElementById('mfHasDocs')||{}).checked?'1':'';
    FILT.hasContact=(document.getElementById('mfHasContact')||{}).checked?'1':'';
    // Awarded-only recompete signals (contract_type buying-style, likelihood, expiring-within).
    FILT.sap=(document.getElementById('mfSap')||{}).value||'';
    FILT.likelihood=(document.getElementById('mfLikelihood')||{}).value||'';
    FILT.leadMax=(document.getElementById('mfLead')||{}).value||'';
    // Open-only SAP-friendly BUYER (agency PO-share tier).
    FILT.sapBuyer=(document.getElementById('mfSapBuyer')||{}).value||'';
    // STRATEGY FILTER (Opportunity DNA) — the checked genome-strand boxes → FILT.strategy (array).
    FILT.strategy=Array.prototype.slice.call(document.querySelectorAll('.mf-strategy:checked')).map(function(el){return el.value;});
    // Count of ACTIVE filter groups (Zillow's "Filters ③" badge). Each conceptual group counts once —
    // a multi-select set-aside/notice group is ONE active filter even with 3 chips picked, so the badge
    // reads as "how many kinds of filter are narrowing this", not raw chip count.
    var groups=[
      (FILT.scope&&FILT.scope!=='all'), FILT.naics, FILT.psc, FILT.agency, FILT.subAgency,
      FILT.state, FILT.country, FILT.postedDays, FILT.closingDays, FILT.setAsideMulti, FILT.fullOpen,
      FILT.noticeMulti, FILT.valueRange, FILT.hasDocs, FILT.hasContact, FILT.sap, FILT.likelihood,
      FILT.leadMax, FILT.sapBuyer, (FILT.strategy&&FILT.strategy.length)
    ];
    var count=0; for(var gi=0;gi<groups.length;gi++){ if(groups[gi])count++; }
    var active=count>0;
    var mbEl=document.getElementById('moreBtn'); if(mbEl)mbEl.classList.toggle('hasfilt',active);
    var badge=document.getElementById('mfBadge');
    if(badge){ if(count>0){ badge.textContent=String(count); badge.hidden=false; } else { badge.hidden=true; } }
    return count;
  }
  // FUNNEL/STRATEGY: log strategy_filter_changed with the COMBINATION (Eric: "that's not three
  // filters, that's a strategy"). Fired on Apply (readDeep just refreshed FILT.strategy), ONLY when
  // strategy is non-empty (an empty Apply isn't a strategy) AND the combo actually CHANGED since the
  // last log (Apply with the same strand set is a re-fetch, not a new strategy). The strands are
  // SORTED so 'repeat_buyer+set_aside' is one stable combo key regardless of click order — that's the
  // rollup dimension. combo = the joined key; strands = the array; n = how many. Signed-in only, f&f.
  var _lastStrat='';
  function _logStrategy(){
    try{
      var arr=(FILT.strategy||[]).slice().sort();
      var combo=arr.join('+');
      if(!combo || combo===_lastStrat) return;   // empty or unchanged → not a new strategy
      _lastStrat=combo;
      if(window.__track) window.__track('tool_use','strategy_filter_changed',{combo:combo,strands:arr,n:arr.length});
    }catch(e){}
  }
  var _apply=document.getElementById('mfApply');
  // readDeep() returns false when the NAICS box still holds unresolved text — keep the panel OPEN
  // and do NOT fetch, so the inline error is visible next to the field the user must fix.
  if(_apply)_apply.onclick=function(){ if(readDeep()===false)return; _logStrategy(); var mp2=document.getElementById('morePanel'); if(mp2)mp2.classList.remove('show'); fetchView(); };
  var _mfclr=document.getElementById('mfClear');
  if(_mfclr)_mfclr.onclick=function(){
    ['mfNaics','mfPsc','mfFsc','mfAgency','mfOffice','mfState','mfSubAgency'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
    // Clear any open code-autocomplete lists too, or a stale dropdown survives a reset.
    ['mfNaicsAc','mfPscAc'].forEach(function(id){var e=document.getElementById(id);if(e)e.innerHTML='';});
    ['mfPosted','mfClosing','mfValue','mfValueMin','mfValueMax','mfCountry','mfSap','mfLikelihood','mfLead','mfSapBuyer'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
    ['mfHasDocs','mfHasContact'].forEach(function(id){var e=document.getElementById(id);if(e)e.checked=false;});
    var _msc=document.getElementById('mfScope'); if(_msc)_msc.value='all';
    document.querySelectorAll('.mf-set,.mf-notice,.mf-strategy').forEach(function(c){c.checked=false;});
    syncSegPillUI(); // reflect the cleared hidden inputs back onto the segmented/pill controls
    if(window.__naicsChips)window.__naicsChips.clear();   // chips + pending text + error all go
    if(readDeep()!==false)fetchView();
  };
  // Wire the Zillow segmented controls (.mf-seg → a hidden checkbox) + single-select pill groups
  // (.mf-pillsel → a hidden select). Clicking a button sets the hidden input's value/checked and
  // moves the .on highlight; readDeep still reads the hidden inputs, so FILT + fetch are unchanged.
  function syncSegPillUI(){
    document.querySelectorAll('.mf-seg').forEach(function(seg){
      var cb=document.getElementById(seg.getAttribute('data-seg')); if(!cb)return;
      var want=cb.checked?'1':'';
      Array.prototype.forEach.call(seg.querySelectorAll('.mf-segb'),function(b){ b.classList.toggle('on',(b.getAttribute('data-v')||'')===want); });
    });
    document.querySelectorAll('.mf-pillsel').forEach(function(grp){
      var sel=document.getElementById(grp.getAttribute('data-sel')); if(!sel)return;
      var v=sel.value||'';
      Array.prototype.forEach.call(grp.querySelectorAll('.mf-pill'),function(b){ b.classList.toggle('on',(b.getAttribute('data-v')||'')===v); });
    });
  }
  document.querySelectorAll('.mf-seg .mf-segb').forEach(function(b){
    b.onclick=function(){ var seg=b.closest('.mf-seg'); var cb=document.getElementById(seg.getAttribute('data-seg'));
      if(cb)cb.checked=(b.getAttribute('data-v')==='1'); syncSegPillUI(); };
  });
  document.querySelectorAll('.mf-pillsel .mf-pill').forEach(function(b){
    b.onclick=function(){ var grp=b.closest('.mf-pillsel'); var sel=document.getElementById(grp.getAttribute('data-sel'));
      if(sel)sel.value=b.getAttribute('data-v')||''; syncSegPillUI(); };
  });
  syncSegPillUI();
  // Per-section HELP chips (Zillow's "Help" per group, redesign PR4). One plain-language explainer per
  // section, injected as a "?" with a native tooltip — keyed off the section's data-mfsec. Only the
  // FIRST header of a multi-header section (e.g. recompete) gets one, to avoid duplicates.
  (function(){
    var HELP={
      scope:'Show every opportunity, or only the ones that match the NAICS, agencies and keywords in your profile.',
      codes:'NAICS = who you are as a seller; PSC = what was actually bought. Type a code or a plain word — we match both.',
      buyer:'Filter to a specific buying agency (and sub-agency). Matches the department that posted the opportunity.',
      location:'Where the work is performed, or the buying office\\u2019s state. Use a 2-letter code (e.g. FL).',
      timing:'Posted = how recently it went up. Closing within = how much time you have left to respond.',
      setaside:'Show opportunities set aside for firms with these certifications (8(a), SDVOSB, WOSB, HUBZone) plus full-and-open.',
      buyerstyle:'How this agency tends to buy \\u2014 SB-friendly buyers use more direct purchase orders; vehicle-heavy ones buy through contract vehicles.',
      recompete:'Signals unique to expiring contracts: how the incumbent was bought, how likely a rebid is, and when it expires.',
      noticetype:'The document format \\u2014 RFP, RFQ, Sources Sought, Pre-solicitation, or a combined synopsis/solicitation.',
      onlyshow:'Narrow to opportunities that have attachments pulled, or a named point of contact.',
      refine:'Include or hide commodity micro-buys \\u2014 small parts & supply purchases.'
    };
    var seen={};
    document.querySelectorAll('#morePanel .mf-sec[data-mfsec]').forEach(function(h){
      var k=h.getAttribute('data-mfsec'); if(!k||seen[k]||!HELP[k])return; seen[k]=1;
      if(h.querySelector('.mf-q'))return;
      var q=document.createElement('span'); q.className='mf-q'; q.textContent='?'; q.setAttribute('title',HELP[k]); q.setAttribute('aria-label',HELP[k]);
      h.appendChild(q);
    });
  })();
  // Filter-panel visibility per dataset (2026-07-26 filter-parity — renamed from the old
  // Recompete-only/Open-only syncValueVis). Every deep-panel field/section above carries an
  // mfv-MODE class per dataset its BACKING ENDPOINT actually honors (see the matrix comment
  // on MORE_FILTERS) — a control never fires silently for a mode it isn't tagged for. A group
  // HEADER whose every field is hidden also hides (no empty "Buyer" header with nothing under
  // it) — grouped by the shared data-mfsec key.
  function syncFilterVis(){
    var cls='mfv-'+MODE;
    document.querySelectorAll('#morePanel [data-mfsec]').forEach(function(el){
      // A CONTAINER (mf-grid2 / mf-checks) usually carries no mfv-* class of its own —
      // the mode tags live on its child fields. Hiding it purely on its own classList
      // therefore hid the inputs while their heading (which IS tagged) stayed visible:
      // the panel rendered bare "Codes / Buyer / Location" labels with nothing under
      // them (Eric, 2026-07-27 — 5 of 8 containers were affected). So a container is
      // visible when it OR any descendant field is tagged for this mode.
      var show = el.classList.contains(cls) || !!el.querySelector('.'+cls);
      el.style.display = show ? '' : 'none';
    });
    // Hide a section's header + body together when NOTHING under that key is visible for MODE.
    var secs={}; document.querySelectorAll('#morePanel [data-mfsec]').forEach(function(el){
      var k=el.getAttribute('data-mfsec'); if(!k)return;
      secs[k]=secs[k]||false;
      // Same containers-carry-no-tag rule as above: count a descendant match too, or a
      // section whose fields are all tagged on the CHILDREN reads as empty and collapses.
      if(el.classList.contains(cls)||el.querySelector('.'+cls))secs[k]=true;
    });
    Object.keys(secs).forEach(function(k){
      if(secs[k])return; // at least one element for this section IS visible — leave as-is
      document.querySelectorAll('#morePanel [data-mfsec="'+k+'"]').forEach(function(el){ el.style.display='none'; });
    });
    // Value range: real $ only on Awarded/recompete (already mfv-recompete-tagged above, but the
    // inline style:none default needs an explicit override to ever show).
    var showVal=(MODE==='recompete'); document.querySelectorAll('.mf-value').forEach(function(e){e.style.display=showVal?'':'none';});
    // Closing window: only OPEN opps have a response_deadline.
    var showClose=(MODE==='open'||MODE==='dla'); document.querySelectorAll('.mf-closeonly').forEach(function(e){e.style.display=showClose?'':'none';});
  }
  syncFilterVis();

  // NAICS / PSC autocomplete in the deep Filters panel. The fields were plain text inputs —
  // you had to already KNOW the code (Eric, 2026-07-27). Reuses /api/suggest-codes, the same
  // grounded endpoint the top-bar search panel uses (verified live: "5415" -> 541511/541512/
  // 541513/541519, "cyber" -> PSC D310, "construction" -> 236115...). Real codes only, never
  // fabricated. Multi-code aware: the inputs accept a comma list, so we complete the LAST
  // segment and leave earlier ones intact.
  (function(){
    function wireCodeAc(inputId, acId, want){
      var inp=document.getElementById(inputId), ac=document.getElementById(acId);
      if(!inp||!ac)return;
      var t=null, items=[], cur=-1;
      function close(){ ac.innerHTML=''; items=[]; cur=-1; }
      function lastSeg(v){ var p=String(v).split(','); return p[p.length-1].trim(); }
      function applyPick(code){
        var parts=String(inp.value).split(',');
        parts[parts.length-1]=code;                       // replace only what's being typed
        // de-dupe + drop empties so repeated picks can't stack the same code
        var seen={}, out=[];
        parts.map(function(x){return x.trim();}).forEach(function(x){ if(x&&!seen[x]){seen[x]=1;out.push(x);} });
        inp.value=out.join(',');
        close(); inp.focus();
      }
      function draw(rows){
        items=rows;
        if(!rows.length){ ac.innerHTML=''; return; }
        ac.innerHTML=rows.map(function(r,i){
          return '<button type="button" data-i="'+i+'"><span class="c">'+esc(r.code)+'</span>'
            + '<span class="n">'+esc(r.name||'')+'</span></button>';
        }).join('');
        Array.prototype.forEach.call(ac.querySelectorAll('button'),function(b){
          // mousedown, not click: blur would tear the list down before click lands.
          b.onmousedown=function(ev){ ev.preventDefault(); applyPick(rows[+b.getAttribute('data-i')].code); };
        });
      }
      function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
      inp.addEventListener('input',function(){
        var q=lastSeg(inp.value);
        if(t)clearTimeout(t);
        if(q.length<2){ close(); return; }
        t=setTimeout(function(){
          fetch('/api/suggest-codes?q='+encodeURIComponent(q)+'&type='+want)
            .then(function(r){return r.json();})
            .then(function(d){
              var rows=(d&&d.results)||[];
              // The endpoint serves both kinds; keep only the one this field stores.
              rows=rows.filter(function(r){return r&&r.type===want&&r.code;}).slice(0,8);
              if(document.activeElement===inp)draw(rows); else close();
            }).catch(function(){ close(); });
        },220);
      });
      inp.addEventListener('keydown',function(e){
        if(!items.length)return;
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();
          cur=(cur+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
          Array.prototype.forEach.call(ac.querySelectorAll('button'),function(b,i){ b.classList.toggle('on',i===cur); });
        } else if(e.key==='Enter'&&cur>=0){ e.preventDefault(); applyPick(items[cur].code); }
        else if(e.key==='Escape'){ close(); }
      });
      inp.addEventListener('blur',function(){ setTimeout(close,120); });
    }

    // ── CHIP input (NAICS) ────────────────────────────────────────────────────────────────────
    // A comma-separated freetext box could not tell the user that multiple codes need commas, so
    // "541512 541611" parsed as ONE junk token and the map silently returned wrong results — the
    // worst failure mode (confidently wrong, no signal). Codes now live as CHIPS; the text input
    // is only for typing. Contract (Eric 2026-08-14):
    //   · a WORD searches the directory and must be PICKED — unresolved text NEVER reaches the query
    //   · codes pasted/typed with comma, space or newline separators auto-chip
    //   · every auto-chipped code is VERIFIED against /api/suggest-codes first (999999 is rejected)
    //   · leftover unresolved text BLOCKS Apply with an inline error (readDeep returns false)
    // FILT.naics stays the comma-joined string of resolved codes, so every downstream consumer
    // (the fetch URLs, the Industry-dropdown sync, chipsFromFilters) is unchanged.
    function wireChipCodes(inputId, acId, chipsId, boxId, errId, want){
      var inp=document.getElementById(inputId), ac=document.getElementById(acId),
          tray=document.getElementById(chipsId), box=document.getElementById(boxId),
          err=document.getElementById(errId);
      if(!inp||!ac||!tray||!box)return;
      var t=null, items=[], cur=-1, picked=[];       // picked = [{code,name}] RESOLVED only
      function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
      function close(){ ac.innerHTML=''; items=[]; cur=-1; }
      function setErr(m){ if(err)err.textContent=m||''; box.classList.toggle('bad',!!m); }
      function codes(){ return picked.map(function(p){return p.code;}); }
      function draw(){
        tray.innerHTML=picked.map(function(p,i){
          return '<span class="mf-chip"><b>'+esc(p.code)+'</b>'+(p.name?'<i>'+esc(p.name)+'</i>':'')
            +'<button type="button" data-x="'+i+'" aria-label="Remove '+esc(p.code)+'">\\u00d7</button></span>';
        }).join('');
        Array.prototype.forEach.call(tray.querySelectorAll('button'),function(b){
          b.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation(); picked.splice(+b.getAttribute('data-x'),1); draw(); };
        });
        inp.placeholder = picked.length ? 'Add another' : 'Add a code or search e.g. construction';
      }
      function add(code,name){
        var c=String(code).trim(); if(!c)return false;
        for(var i=0;i<picked.length;i++){ if(picked[i].code===c)return true; }   // dedupe, not an error
        picked.push({code:c,name:name||''}); draw(); setErr(''); return true;
      }
      // Verify a bare number against the directory before chipping. An exact code returns itself;
      // a PREFIX (<=4) returns its children — the shared filter treats <=4 as a LIKE prefix match,
      // so we chip the PREFIX itself rather than expanding it. 0 results = not a real code.
      function verify(raw){
        var c=String(raw).replace(/[^0-9]/g,'');
        if(c.length<2||c.length>6)return Promise.resolve(null);
        return fetch('/api/suggest-codes?q='+encodeURIComponent(c)+'&type='+want)
          .then(function(r){return r.json();})
          .then(function(d){
            var rows=((d&&d.results)||[]).filter(function(r){return r&&r.type===want&&r.code;});
            if(!rows.length)return null;
            var exact=null;
            for(var i=0;i<rows.length;i++){ if(String(rows[i].code)===c){exact=rows[i];break;} }
            if(exact)return {code:c,name:exact.name||''};
            return {code:c,name:''};                    // valid prefix (children exist)
          }).catch(function(){ return null; });
      }
      // Split pasted/typed text on comma, whitespace or newline; verify each numeric token.
      function ingest(text,cb){
        var toks=String(text).split(/[\\s,;\\n\\r\\t]+/).map(function(s){return s.trim();}).filter(Boolean);
        var nums=toks.filter(function(s){return /^[0-9]{2,6}$/.test(s);});
        var words=toks.filter(function(s){return !/^[0-9]{2,6}$/.test(s);});
        if(!nums.length){ cb(words.join(' ')); return; }
        Promise.all(nums.map(verify)).then(function(res){
          var bad=[];
          res.forEach(function(r,i){ if(r)add(r.code,r.name); else bad.push(nums[i]); });
          if(bad.length)setErr('Not a NAICS code: '+bad.join(', '));
          cb(words.join(' '));
        });
      }
      function drawAc(rows){
        items=rows;
        if(!rows.length){ ac.innerHTML=''; return; }
        ac.innerHTML=rows.map(function(r,i){
          return '<button type="button" data-i="'+i+'"><span class="c">'+esc(r.code)+'</span>'
            + '<span class="n">'+esc(r.name||'')+'</span></button>';
        }).join('');
        Array.prototype.forEach.call(ac.querySelectorAll('button'),function(b){
          b.onmousedown=function(ev){ ev.preventDefault(); var r=rows[+b.getAttribute('data-i')]; add(r.code,r.name); inp.value=''; close(); inp.focus(); };
        });
      }
      box.addEventListener('mousedown',function(e){ if(e.target===box||e.target===tray){ e.preventDefault(); inp.focus(); } });
      inp.addEventListener('focus',function(){ box.classList.add('on'); });
      inp.addEventListener('blur',function(){ box.classList.remove('on'); setTimeout(close,120); });
      inp.addEventListener('paste',function(e){
        var txt=(e.clipboardData||window.clipboardData).getData('text')||'';
        if(!/[\\s,;]/.test(txt))return;                  // single token → normal typing path
        e.preventDefault(); ingest(txt,function(rest){ inp.value=rest; });
      });
      inp.addEventListener('input',function(){
        setErr('');
        // A separator committed while typing = the user finished a code.
        if(/[\\s,;]$/.test(inp.value)){ ingest(inp.value,function(rest){ inp.value=rest; }); close(); return; }
        var q=inp.value.trim();
        if(t)clearTimeout(t);
        if(q.length<2){ close(); return; }
        t=setTimeout(function(){
          fetch('/api/suggest-codes?q='+encodeURIComponent(q)+'&type='+want)
            .then(function(r){return r.json();})
            .then(function(d){
              var rows=((d&&d.results)||[]).filter(function(r){return r&&r.type===want&&r.code;}).slice(0,8);
              if(document.activeElement===inp)drawAc(rows); else close();
            }).catch(function(){ close(); });
        },220);
      });
      inp.addEventListener('keydown',function(e){
        if(e.key==='Backspace'&&!inp.value&&picked.length){ e.preventDefault(); picked.pop(); draw(); return; }
        if(e.key==='Enter'){
          e.preventDefault();
          if(cur>=0&&items[cur]){ add(items[cur].code,items[cur].name); inp.value=''; close(); return; }
          if(inp.value.trim())ingest(inp.value,function(rest){ inp.value=rest; if(rest)setErr('Pick a '+want.toUpperCase()+' code from the list'); });
          return;
        }
        if(!items.length)return;
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();
          cur=(cur+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
          Array.prototype.forEach.call(ac.querySelectorAll('button'),function(b,i){ b.classList.toggle('on',i===cur); });
        } else if(e.key==='Escape'){ close(); }
      });
      // The bridge the rest of the panel talks to (readDeep / clear / the Industry sync).
      return {
        value:function(){ return codes().join(','); },
        pending:function(){ return inp.value.trim(); },
        set:function(csv){
          picked=[]; inp.value=''; setErr('');
          String(csv||'').split(',').map(function(s){return s.trim();}).filter(Boolean)
            .forEach(function(c){ picked.push({code:c,name:''}); });
          draw();
        },
        clear:function(){ picked=[]; inp.value=''; setErr(''); draw(); close(); },
        flag:function(m){ setErr(m); }
      };
    }
    window.__naicsChips=wireChipCodes('mfNaics','mfNaicsAc','mfNaicsChips','mfNaicsBox','mfNaicsErr','naics');
    wireCodeAc('mfPsc','mfPscAc','psc');
  })();

  // Save search — persist the FULL active filter set + viewport + mode as a named saved
  // search that alerts on new matches (Zillow's retention move). Needs a signed-in user
  // (same MI token the save-to-pursuits flow uses).
  var _ss=document.getElementById('saveSearchBtn');
  function _ssReset(){ if(_ss)_ss.innerHTML='<svg viewBox="0 0 24 24"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>Save search'; }
  function _ssMsg(t){ if(_ss)_ss.textContent=t; setTimeout(_ssReset,1900); }
  if(_ss)_ss.onclick=function(){
    var t=null; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){}
    // What this search WATCHES, for the default name — "Open", "Forecasts", or
    // "Open + Forecasts". The old label hard-coded Open/Recompetes and so lied about a
    // forecast search the moment horizons existed.
    function _ssScopeLabel(){
      try{
        if(MODE==='recompete')return 'Recompetes';
        var h=window.__horizons||{}; var on=[];
        if(h.open!==false)on.push('Open');
        if(h.recompete)on.push('Recompetes');
        if(h.forecast)on.push('Forecasts');
        return on.length?on.join(' + '):'Open';
      }catch(e){ return 'Open'; }
    }
    var em=_uemail();
    if(!t||!em){ if(window.openSignInModal){window.openSignInModal('save this search and get alerts',function(){location.reload();});}else{location.href='/app?next=%2Fopportunity-map';} return; }
    var name=window.prompt('Name this saved search (you\\'ll get alerts on new matches):',
      (FILT.setAside||FILT.naics||Q||'My opportunities')+' — '+_ssScopeLabel());
    if(!name)return;
    // Snapshot the active filters (skip empties + scope=all) + the current viewport.
    var filters={}; for(var k in FILT){ if(FILT[k]&&FILT[k]!=='all')filters[k]=FILT[k]; }
    if(Q)filters.q=Q;
    // Capture the HORIZON chips too. Without this a user looking at forecasts saved a
    // search that recorded only "open", so the alert cron could never know to diff
    // agency_forecasts — and forecasts are the one corpus with no other push channel
    // (14,389 of them have no coordinate and never appear on the map at all).
    try{ var _h=window.__horizons||{}; filters.horizons={open:_h.open!==false,recompete:!!_h.recompete,forecast:!!_h.forecast}; }catch(e){}
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

  // Apply a SAVED SEARCH to the map in-place (the reverse of Save search): take its stored
  // mode + filters (+ bbox) and drive the same FILT state / controls / viewport the live
  // filters use, then refetch. Exposed for the search-bar dropdown (SEARCH_PANEL_JS).
  window.__applySavedSearch=function(ss){
    if(!ss||typeof ss!=='object')return;
    var f=(ss.filters&&typeof ss.filters==='object')?ss.filters:{};
    // Switch dataset first (open|recompete). setMapMode resets Q + FILT-driving controls.
    var wantMode=(ss.mode==='recompete')?'recompete':'open';
    if(MODE!==wantMode){ setMapMode(wantMode); }
    // Reset the bar controls to a clean slate, then lay the saved filters over them.
    if(window.__saselReset)window.__saselReset();
    if(window.__naicsReset)window.__naicsReset();
    if(window.__agencyReset)window.__agencyReset();
    FILT={ scope:'all', noticeType:'', setAside:'', fullOpen:false, closingDays:'', agency:'', office:'', state:'',
      naics:'', psc:'', postedDays:'', setAsideMulti:'', noticeMulti:'', valueRange:'',
      subAgency:'', country:'', hasDocs:'', hasContact:'', sap:'', likelihood:'', leadMax:'', sapBuyer:'' };
    for(var k in FILT){ if(f[k]!=null && f[k]!=='')FILT[k]=f[k]; }
    // Reflect the restored filters onto the visible controls so the bar isn't lying.
    if(window.__valReflect)window.__valReflect(FILT.valueRange||'');
    // Set-aside is Filters-panel only now → restore the .mf-set checkboxes (the top-bar pill is gone).
    if(FILT.setAside||FILT.fullOpen){
      var picks=String(FILT.setAside||'').split(',').filter(Boolean);
      document.querySelectorAll('.mf-set').forEach(function(c){ c.checked=(c.value==='OPEN')?!!FILT.fullOpen:(picks.indexOf(c.value)>=0); });
    }
    // Restore the Agency pill from a saved search's FILT.agency: reverse-map the match substring to a
    // preset NAME if one matches; else show the raw value (a saved free-text agency is still honest).
    if(FILT.agency){ var agB=document.getElementById('agencyBtn'), agL=document.getElementById('agencyLabel');
      // FILT.agency is now a PIPE-joined set of match needles → check the matching presets (multi).
      if(window.__agSetFromVal){ window.__agSetFromVal(FILT.agency); }
      else { if(agL)agL.textContent=String(FILT.agency); if(agB)agB.classList.add('hasfilt'); }
      var mfA2=document.getElementById('mfAgency'); if(mfA2)mfA2.value=FILT.agency; }
    // Restore the Industry multi-select from a saved search's FILT.naics: mark EVERY preset whose codes
    // are all present in FILT.naics as selected (multi-select — a saved search can carry several
    // industries). If the codes match no preset at all, show "Custom codes" honestly (never mislabel).
    if(FILT.naics){ var nB=document.getElementById('naicsBtn'), nL=document.getElementById('naicsLabel');
      var _set={}; String(FILT.naics).split(',').map(function(s){return s.trim();}).filter(Boolean).forEach(function(c){ _set[c]=1; });
      var _names=(window.__INDUSTRY_PRESETS||[]).filter(function(p){ return (p.codes||[]).length && p.codes.every(function(c){ return _set[c]; }); }).map(function(p){ return p.name; });
      if(_names.length && window.__indSetFromCodes){ window.__indSetFromCodes(_names); }
      else { if(nL)nL.textContent='Custom codes'; if(nB)nB.classList.add('hasfilt'); } }
    // Reflect Awarded-only recompete signals back onto their selects (so a restored saved search
    // isn't lying about the buying-style / likelihood / expiring-within it was saved with).
    // Posted / State / Closing were restored into FILT but their CONTROLS were never synced, so a
    // restored search (or a ?posted= deep link) filtered the map while the Filters panel still read
    // "Any time" — the user could not see what was applied and Clear-all had nothing to clear.
    // Measured 2026-08-16: ?posted=1 narrowed 145,467 -> 134,478 with #mfPosted still "".
    var _rPost=document.getElementById('mfPosted'); if(_rPost)_rPost.value=FILT.postedDays||'';
    var _rSt=document.getElementById('mfState'); if(_rSt)_rSt.value=FILT.state||'';
    var _rCl=document.getElementById('mfClosing'); if(_rCl)_rCl.value=FILT.closingDays||'';
    var _rSap=document.getElementById('mfSap'); if(_rSap)_rSap.value=FILT.sap||'';
    var _rLk=document.getElementById('mfLikelihood'); if(_rLk)_rLk.value=FILT.likelihood||'';
    var _rLd=document.getElementById('mfLead'); if(_rLd)_rLd.value=FILT.leadMax||'';
    var _rSb=document.getElementById('mfSapBuyer'); if(_rSb)_rSb.value=FILT.sapBuyer||'';
    // Restore a free-text query if one was saved.
    var zi=document.getElementById('zsearchInput'); if(zi){ Q=(f.q||''); zi.value=Q; }
    // HORIZONS. Saved as an object — {open:true,recompete:false,forecast:false} — and this restorer
    // never read it, so an "Open only" search reopened with all three horizons ON and the list came
    // back full of Forecast rows (Eric 2026-08-13). Go through toggleHorizon rather than writing
    // window.__horizons directly: it owns the chip sync for BOTH surfaces (.hzc + .hznrow) and the
    // "never turn the last one off" guard, so the UI cannot end up disagreeing with the fetch.
    if(f.horizons&&typeof f.horizons==='object'){
      ['open','recompete','forecast'].forEach(function(h){
        var want=(f.horizons[h]!==false);
        var have=(window.__horizons&&window.__horizons[h]!==false);
        if(want!==have&&typeof window.toggleHorizon==='function')window.toggleHorizon(h);
      });
    }
    // Restore the saved viewport (bbox) so results frame where the search was made.
    var b=ss.bbox; if(b&&typeof b==='object'&&b.s!=null&&b.n!=null&&b.w!=null&&b.e!=null){
      try{ map.fitBounds([[b.s,b.w],[b.n,b.e]]); _didAutoFit=true; }catch(e){} }
    fetchView();
  };

  // Clear all: reset the server filters + their controls, then refetch. (Runs in
  // addition to the template's own clrAll handler, which now only clears dead client sets.)
  var _clr=document.getElementById('clrAll');
  if(_clr)_clr.addEventListener('click',function(){
    FILT={ scope:'all', noticeType:'', setAside:'', fullOpen:false, closingDays:'', agency:'', office:'', state:'',
      naics:'', psc:'', postedDays:'', setAsideMulti:'', noticeMulti:'', valueRange:'' };
    if(window.__saselReset)window.__saselReset();
    if(window.__naicsReset)window.__naicsReset();
    if(window.__agencyReset)window.__agencyReset(); // Companies-by-agency (2026-08-03): the top-bar
      // Agency picker keeps its OWN working/window.__agSel state + visible label — without this call
      // Clear-all reset FILT.agency but left the picker showing a stale "Agency · N" label.
    if(window.__valReset)window.__valReset();
    if(window.__resetSort)window.__resetSort(); // Zillow: Clear-all returns sort to "Recommended"
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
  // Panel header close button — dismiss without applying (the X, like Zillow's modal close).
  var _mfx=document.getElementById('mfClose'); if(_mfx&&mp)_mfx.onclick=function(e){ e.stopPropagation(); mp.classList.remove('show'); };
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
    drawBtn.textContent='Draw';
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
  // THE flywheel gate (read free, respond gated). One shared helper for every
  // respond/draft/save action: returns {t,em} when signed in; otherwise fires a
  // friendly "Sign in to <action>?" confirm → /app?next=<this page> (so they land
  // back on the same card after auth) and returns null. Reused from the map
  // template's inline handlers via window.requireSignIn. Reading the card — all
  // the intel, the contacts preview — never calls this; only responding does.
  // Zillow-style: signed in → {t,em} synchronously (callers unchanged). Signed out → open the
  // in-page sign-in MODAL (no page redirect) with the action phrase + an optional resume callback
  // that re-fires the gated action after auth, then return null so the caller bails now. Falls back
  // to the old /app redirect only if the modal isn't present on the page.
  window.requireSignIn=function(actionPhrase, onSuccess){
    var t=tok(); var em=t?email(t):'';
    if(t&&em) return {t:t,em:em};
    if(typeof window.openSignInModal==='function'){ window.openSignInModal(actionPhrase, onSuccess); return null; }
    var next=encodeURIComponent(location.pathname+location.search);
    if(confirm('Sign in to '+(actionPhrase||'continue')+'?')) location.href='/app?next='+next;
    return null;
  };
  // Gate a "respond" LINK (Draft proposal / Start drafting / Plan outreach). Read
  // is free; the hand-off to draft is the sign-in moment. Signed in → open the URL
  // in a new tab (same as the old anchor). Signed out → the friendly confirm, then
  // land back on this card after auth. Called from onclick on the (now button-like)
  // action anchors.
  // btn carries data-u (the respond URL) + data-act (the phrase for the prompt).
  // Reading both from attributes avoids any inline-quote escaping in the onclick.
  window.gateDraft=function(btn){
    var url=btn&&btn.getAttribute('data-u'); if(!url)return;
    // Resume after sign-in: re-run gateDraft on the same button (now signed in → opens the URL).
    var a=window.requireSignIn(btn.getAttribute('data-act')||'draft this', function(){ window.gateDraft(btn); }); if(!a)return;
    // FUNNEL: proposal_started — the deepest step (map_open→pin→popup→listing→pursuit→proposal). Fired
    // at the single gateDraft choke point (every "Generate proposal" / "Draft capture strategy" CTA
    // routes through here), AFTER the sign-in gate passes so it counts a real intent, not a bounce to
    // login. notice rides in metadata via the data-u URL's ?notice=. (See __track — signed-in only.)
    try{ if(window.__track){ var _n=''; try{ _n=(url.match(/notice=([^&]+)/)||[])[1]||''; }catch(_e){}
      window.__track('link_click','proposal_started',{notice_id:decodeURIComponent(_n),act:btn.getAttribute('data-act')||''}); } }catch(e){}
    window.open(url,'_blank','noopener');
  };
  window.savePursuit=function(btn){
    if(btn.dataset.saved==='1')return;
    var a=window.requireSignIn('save this to your pursuits', function(){ window.savePursuit(btn); }); if(!a)return;
    var t=a.t, em=a.em;
    var sol=btn.dataset.sol, o=null;
    try{ o=(OPPS||[]).find(function(x){return x.sol===sol;}); }catch(e){}
    if(!o)return;
    btn.textContent='Saving\\u2026'; btn.disabled=true;
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:o.title,notice_id:o.sol,agency:o.agency,naics_code:o.naics,response_deadline:o.close,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In pursuits':'\\u2713 Saved'; btn.classList.add('saved'); btn.dataset.saved='1';
        // FUNNEL: pursuit_started — a real save to My Pursuits (the fifth funnel step). Only on a
        // genuine save (dup counts too — the intent happened). notice_id in metadata for join-back.
        try{ if(window.__track && !dup) window.__track('tool_use','pursuit_started',{notice_id:String(o.sol),agency:String(o.agency||'')}); }catch(e){} }
      else { btn.textContent='Try again'; btn.disabled=false; }
    }).catch(function(){ btn.textContent='Try again'; btn.disabled=false; });
  };
  // 1-click Favorites heart on the popup card → toggles /api/opportunities/save (POST/DELETE).
  var _favs={};
  window.toggleFav=function(btn){
    var t=tok(); var em=t?email(t):''; var nid=btn.getAttribute('data-nid');
    if(!t||!em){ if(window.openSignInModal){window.openSignInModal('save this to your Favorites',function(){location.reload();});}else{location.href='/app?next=%2Fopportunity-map';} return; }
    var on=btn.classList.contains('on');
    btn.classList.toggle('on',!on); _favs[nid]=!on; // optimistic
    // Snapshot the opp's metadata at save time (backup for read-side sam_opportunities hydration).
    var sol=btn.getAttribute('data-sol'), o=null;
    try{ o=(OPPS||[]).find(function(x){return x.nid===nid||x.sol===nid||x.sol===sol;}); }catch(e){}
    var body={email:em,noticeId:nid};
    // Recompete pins share this same popup heart (COMPOUND parity, gap 3), but a recompete has NO
    // sam_opportunities row — tag it entityType:'recompete' + source='recompete_map' with a snapshot
    // so the Favorites page renders it without a hydration miss (matches the recompete drawer Save).
    if(!on&&o&&o.src==='RECOMPETE'){ body.requestPursuitBrief=false; body.source='recompete_map';
      body.opportunityData={ noticeId:nid, entityType:'recompete', solicitationNumber:o.sol, title:(o.title||'Awarded contract'),
        department:o.agency, agency:o.agency, naicsCode:o.naics, incumbent:o.title||null, contractValue:o.value||null, expires:o.exp||null }; }
    else if(!on&&o){ body.opportunityData={
      noticeId:nid, solicitationNumber:o.sol, title:o.title, department:o.agency,
      naicsCode:o.naics, responseDeadline:o.close, setAside:(o.set&&o.set!=='None')?o.set:null }; }
    fetch('/api/opportunities/save',{method:on?'DELETE':'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify(body)})
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
  // Gov Buyer drawer accent (dataset-level RED — the authority/buyer side). Toggled on the drawer
  // via .buyer-accent when a buyer is open, so the sticky tabs read red (companies/opps stay blue).
  + '.oppdrawer.buyer-accent .opptab.on{color:#dc2626;border-bottom-color:#dc2626}'
  + '.oppdrawer.buyer-accent .oppbar-back:hover{color:#dc2626}'
  + '.oppbody{padding:2px 30px 44px;max-width:840px;width:100%}'
  + '.oppload{padding:70px 26px;text-align:center;color:var(--sub);font-size:14px}'
  // Inline "Sign in" inside a drawer error — a link, not a CTA button, so an auth failure reads
  // as a sentence with a way out rather than a second competing action (drawerLoadError, 401).
  + '.lnkbtn{background:none;border:0;padding:0;font:inherit;color:var(--sam);'
  +   'font-weight:600;cursor:pointer;text-decoration:underline}'
  + '.snaphero{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}'
  + '.badge-nt{display:inline-block;font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:6px;background:var(--wash);color:var(--sub)}'
  + '.badge-dl{display:inline-block;font:700 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:6px;background:#fef2f2;color:#d92d20}'
  + '.badge-dl.cool{background:#f0fdf7;color:#22a06b}'
  // Artifact hero (Eric 2026-08-04): bigger title, the M-Estimate as a tinted card, and the key
  // facts as individual cards (not one bordered box). Title leads the Opportunity Snapshot.
  + '.snapt{font:800 30px/1.14 "Space Grotesk",Inter,system-ui,sans-serif;letter-spacing:-.02em;color:var(--ink);margin:8px 0 8px}'
  + '.snapmeta{color:var(--sub);font-size:15px;margin-bottom:6px}.snapmeta b{color:var(--ink);font-weight:600}'
  + '.snapactivity{display:flex;flex-wrap:wrap;align-items:center;gap:7px;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);margin:2px 0 12px}'
  + '.snaplabel{font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--sub);margin-right:2px}'
  + '.snapfresh{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:12px}'
  + '.snapdot{color:var(--faint);font-weight:400}'
  // key facts as CARDS (artifact look) — a responsive grid of small tinted tiles, not one box.
  + '.snapgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:2px 0 4px}'
  + '.snapgrid > div{background:var(--wash);border:1px solid var(--hair);border-radius:10px;padding:11px 13px}'
  + '.snapgrid .k{font:700 10px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}'
  + '.snapgrid .v{font-size:14px;font-weight:700;color:var(--ink);margin-top:5px}'
  + '.snapgrid .v.urgent{color:#d92d20}'
  + '.oppsoon{margin-top:26px;color:var(--faint);font-size:12px;border-top:1px solid var(--line);padding-top:14px}'
  // Bid facts grid (Zillow "Facts & features").
  + '.bf-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}'
  + '.fc-desc{font-size:14px;line-height:1.6;color:var(--ink);white-space:pre-wrap}'
  // Forecast "Should I pursue?" — the three early-capture moves (Track / Research / Start capture).
  // Card-buttons, same tactile feel as .sim-card, stacked. Each is a real destination.
  + '.fc-moves{display:flex;flex-direction:column;gap:10px;margin-top:14px}'
  + '.fc-move{display:block;text-align:left;text-decoration:none;border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:#fff;cursor:pointer;transition:box-shadow .15s,border-color .15s,transform .15s}'
  + '.fc-move:hover{box-shadow:0 10px 24px -12px rgba(16,24,40,.2);border-color:#c7b8ee;transform:translateY(-1px)}'
  + '.fc-move-t{font:800 14px Inter,system-ui,sans-serif;color:#5b21b6}'
  + '.fc-move-d{font:500 12.5px Inter,system-ui,sans-serif;color:var(--sub);line-height:1.45;margin-top:3px}'
  // Forecast "Prepare to win" — the early-capture checklist + its CTA row.
  + '.fc-steps{margin:12px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:9px}'
  + '.fc-steps li{font-size:13.5px;line-height:1.5;color:var(--ink)}'
  + '.fc-steps li b{color:var(--ink)}'
  + '.fc-prep-cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}'
  + '.bf-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--hair)}'
  + '.bf-k{color:var(--sub);font-size:13px}.bf-v{color:var(--ink);font-size:13px;font-weight:600;text-align:right}'
  + '.bf-ul{margin:0 0 6px;padding-left:18px}.bf-ul li{font-size:13.5px;color:var(--ink);margin-bottom:4px;line-height:1.4}'
  + '.intel-load{color:var(--faint);font-size:12.5px;padding:6px 0}'
  // SOW facts (Tier 1) — verbatim evidence quotes, so a user can verify each fact against the
  // solicitation's own words.
  + '.sow-quote{font-size:12.5px;font-style:italic;color:var(--sub);border-left:2px solid var(--line);padding:4px 0 4px 10px;margin-bottom:6px;line-height:1.4}'
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
  + '.osec-h .osec-ic{width:19px;height:19px;vertical-align:-3px;margin-right:7px;color:var(--grnd,#22a06b)}'
  // Group-intro line under a section header (Opportunity/Market Intelligence) — one muted sentence.
  + '.osec-lead{font:500 13.5px Inter,system-ui,sans-serif;color:var(--faint);line-height:1.45;margin:-6px 0 14px}'
  + '.osec-b{font-size:14px;line-height:1.6;color:#374151;word-break:break-word}'
  + '.osec-empty{font-size:13.5px;color:var(--faint)}'
  + '.bhbadge{display:inline-block;font:800 13px Inter,system-ui,sans-serif;padding:5px 11px;border-radius:999px;margin-bottom:10px}'
  + '.bhdetail{font-size:13.5px;line-height:1.55;color:#374151;margin-bottom:12px}'
  + '.bhbar{display:flex;width:100%;height:12px;border-radius:6px;overflow:hidden;background:#eef0f3}'
  + '.bhbar span{display:block;height:100%}'
  + '.bhleg{display:flex;flex-wrap:wrap;gap:12px;margin-top:9px;font:600 11.5px Inter,system-ui,sans-serif;color:var(--sub)}'
  + '.bhleg span{display:inline-flex;align-items:center;gap:5px}'
  + '.bhleg i{width:9px;height:9px;border-radius:2px;display:inline-block}'
  + '.bhnote{font-size:11.5px;color:var(--faint);margin-top:10px;line-height:1.45}'
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
  // M-Estimate(TM) — Mindy's own branded value estimate (NOT the government's IGCE). Big median +
  // likely band + a distribution chart + an always-visible disclaimer + an expandable "how we
  // calculate this" note. Card facts must never look like an official/solicited number.
  + '.vrange{background:linear-gradient(135deg,#f0f9f4,#eef4ff);border:1px solid #d6eadf;border-radius:14px;padding:18px 20px}'
  // Top price header (Zillow price-at-top): a touch more prominent + spaced from the sections below.
  + '.vrange-top{margin:6px 0 16px}'
  + '.vrange-top .vr-big{font-size:34px}'
  + '.vrange-none{background:linear-gradient(135deg,#f6f8fb,#eef2f7);border-color:#e2e8f0}'
  // Recompete value hero = AMBER, matching the recompete horizon accent (#b45309) used on the pins,
  // rail cards, and incumbent block. NOT the green M-Estimate box (Eric 2026-08-04: green on a
  // recompete confuses the horizon — a recompete is an incumbent-held contract, not an open buy).
  + '.vrange-rc{background:linear-gradient(135deg,#fdf6ec,#fffaf3);border-color:#f2dcb8}'
  + '.vrange-rc .vr-label{color:#b45309}'
  // FORECAST value hero — purple, matching the sidebar card + the "Forecast · planned work" badge
  // (Eric 2026-08-05: "for forecast use the actual number and colors"). The big value is the agency's
  // published RANGE, so it reads as a real government figure (no ≈ modeled glyph).
  + '.vrange-fore{background:linear-gradient(135deg,#f5f0ff,#efeaff);border-color:#e2d6ff}'
  + '.vrange-fore .vr-label{color:#7c3aed}'
  + '.vrange-fore .vr-big{color:#5b21b6}'
  + '.vr-none-msg{font:700 17px Inter,system-ui,sans-serif;color:#475569;line-height:1.25;margin-top:2px}'
  + '.vr-loading{font:600 14px Inter,system-ui,sans-serif;color:#64748b;margin-top:4px}'
  + '.vr-label{display:flex;align-items:center;gap:6px;font:700 12.5px Inter,system-ui,sans-serif;letter-spacing:.02em;color:#137a4e;text-transform:uppercase;margin-bottom:2px}'
  + '.vr-tm{font-size:9px;vertical-align:super;font-weight:700}'
  + '.vr-big{font:800 30px Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#0f2233;line-height:1}'
  + '.vr-band{font:600 14px Inter,system-ui,sans-serif;color:#12805c;margin-top:6px}'
  // The hero holds TWO branded numbers side by side (Eric 2026-08-04): M-Estimate + M-Win. A
  // responsive 2-col grid that stacks on a narrow drawer. Each is its own tinted card.
  + '.herotwo{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:6px 0 16px}'
  + '@media(max-width:520px){.herotwo{grid-template-columns:1fr}}'
  + '.herotwo .vrange-top{margin:0}'
  // M-Win card — violet tint (a Mindy score, distinct from the green M-Estimate). Grounded number,
  // a "scoring…" state, and an honest "complete profile" locked state (never a fabricated %).
  + '.mwin{background:linear-gradient(135deg,#f3eefe,#f8f5ff);border:1px solid #e4dcff;border-radius:14px;padding:18px 20px}'
  + '.mwin .vr-label{color:#6b3ac9}'
  + '.mwin .mw-big{font:800 30px Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#0f2233;line-height:1}'
  + '.mwin .mw-sub{font:600 13px Inter,system-ui,sans-serif;color:#6b3ac9;margin-top:6px}'
  + '.mwin.locked{background:linear-gradient(135deg,#f6f8fb,#f4f2f9);border-color:#e6e2ef}'
  + '.mwin.locked .mw-lock{font:700 15px Inter,system-ui,sans-serif;color:#5b5570;line-height:1.3;margin-top:2px}'
  + '.mwin.locked .mw-cta{display:inline-block;margin-top:8px;font:700 12.5px Inter,system-ui,sans-serif;color:#6b3ac9}'
  + '.mwin .mw-loading{font:600 14px Inter,system-ui,sans-serif;color:#8b80a8;margin-top:4px}'
  // "Should I Pursue This?" decision card (Eric 2026-08-04) — Pursue/Watch/Skip badge + Mindy
  // recommendation, a Why|Risks two-column split, Win factors, and the Bid/No-Bid button. All
  // grounded from the win-probability factors (no LLM); the deep AI analysis stays behind the button.
  + '.pursue{border:1px solid var(--grnd-line,#cfe9d9);border-radius:14px;overflow:hidden;background:#fff}'
  + '.pursue.watch{border-color:#f0dcbe}.pursue.skip{border-color:#e6dde6}'
  + '.pursue-rec{display:flex;align-items:center;gap:13px;padding:15px 17px;background:linear-gradient(120deg,#eafaf2,#f6fbf8)}'
  + '.pursue.watch .pursue-rec{background:linear-gradient(120deg,#fdf6ec,#fffaf3)}'
  + '.pursue.skip .pursue-rec{background:linear-gradient(120deg,#f6f2f6,#faf8fa)}'
  + '.pursue-badge{font:800 13px Inter,system-ui,sans-serif;color:#fff;border-radius:8px;padding:7px 13px;white-space:nowrap}'
  + '.pursue .pursue-badge{background:#22a06b}.pursue.watch .pursue-badge{background:#b45309}.pursue.skip .pursue-badge{background:#6b6472}'
  + '.pursue-rt{font:800 16px Inter,system-ui,sans-serif;color:var(--ink)}.pursue-rs{font-size:13px;color:var(--sub)}'
  + '.pursue-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}@media(max-width:560px){.pursue-grid{grid-template-columns:1fr}}'
  + '.pursue-col{padding:14px 17px}.pursue-col + .pursue-col{border-left:1px solid var(--hair)}'
  + '@media(max-width:560px){.pursue-col + .pursue-col{border-left:0;border-top:1px solid var(--hair)}}'
  + '.pursue-cl{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px}'
  + '.pursue-cl.why{color:#137a4e}.pursue-cl.risk{color:#b45309}'
  + '.pursue-li{display:flex;gap:8px;font-size:13px;line-height:1.45;color:var(--ink);margin-bottom:8px}'
  + '.pursue-li svg{width:14px;height:14px;flex:none;margin-top:2px;fill:none;stroke-width:2.4}'
  + '.pursue-li.p svg{stroke:#22a06b}.pursue-li.r svg{stroke:#b45309}'
  + '.pursue-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 17px;border-top:1px solid var(--hair)}'
  + '.pursue-wf{font-size:13px;color:var(--sub);flex:1;min-width:180px}.pursue-wf b{color:var(--ink)}'
  // No-profile shell (Eric 2026-08-04): the section is "the heart of the page" — it must NEVER be
  // empty. Without a profile we show the card STRUCTURE (recommendation row + Why/Risks/Win-factors
  // headers) muted, with a "complete your profile" prompt where the scored content goes — teaching
  // what it does + nudging setup, never a fabricated recommendation.
  + '.pursue.locked{border-color:#e6e2ef}'
  + '.pursue.locked .pursue-rec{background:linear-gradient(120deg,#f4f2f9,#faf9fc)}'
  + '.pursue.locked .pursue-badge{background:#8b80a8}'
  + '.pursue-lock-cta{display:inline-block;font:700 13px Inter,system-ui,sans-serif;color:#6b3ac9}'
  // UNIVERSAL DNA — "Opportunity signals" (grounded, shown to everyone) at the TOP of the shell.
  + '.pursue-signals{padding:16px 17px}'
  + '.psig-h{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}'
  + '.psig-sub{font:500 12.5px Inter,system-ui,sans-serif;color:var(--faint);margin:3px 0 12px}'
  + '.psig{padding:9px 0;border-top:1px solid var(--hair)}'
  + '.psig:first-of-type{border-top:0}'
  + '.psig-t{display:flex;align-items:center;gap:8px;font:800 14px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.psig-ic{width:16px;height:16px;flex:0 0 16px;fill:none;stroke:#12805c;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}'
  + '.psig-d{font:500 13px Inter,system-ui,sans-serif;color:#5b6472;line-height:1.4;margin-top:3px;padding-left:24px}'
  // The gated CTA block — what the personalized analysis ADDS + Run Bid/No-Bid + sign-in line.
  + '.pursue-lock-body{padding:15px 17px;border-top:1px solid var(--hair)}'
  + '.pursue-unlock{font:600 13.5px Inter,system-ui,sans-serif;color:#5b5570;line-height:1.45}'
  + '.pursue-cta-row{display:flex;margin:13px 0 4px}'
  + '.pursue-signin-line{margin-top:8px}'
  // Bid/No-Bid action inside the card footer (replaces the removed standalone AI button).
  + '.pursue-bid{margin-left:auto;font:700 13px Inter,system-ui,sans-serif;color:#fff;background:#006aff;border:0;border-radius:9px;padding:10px 16px;cursor:pointer;white-space:nowrap}'
  + '.pursue-bid:hover{background:#0057d6}'
  + '.vr-src{font:400 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:6px}'
  // Distribution chart — "where similar awards landed". Plain CSS bars, no chart library. The
  // marker column is highlighted to show where THIS opp\'s median sits among the comparables.
  + '.vr-chart-lab{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:#5b6b7a;margin-top:16px;margin-bottom:8px}'
  + '.vr-chart{display:flex;align-items:flex-end;gap:3px;height:56px}'
  + '.vr-bar{flex:1;background:#c9dfd2;border-radius:4px 4px 0 0;min-height:2px;transition:background .15s}'
  + '.vr-bar.mk{background:var(--grnd)}'
  + '.vr-disclaimer{font:400 12.5px Inter,system-ui,sans-serif;line-height:1.5;color:#5b6b7a;margin-top:14px;padding-top:14px;border-top:1px solid #d6eadf}'
  + '.vr-how{margin-top:8px}'
  + '.vr-how-toggle{font:700 12.5px Inter,system-ui,sans-serif;color:#137a4e;background:none;border:0;cursor:pointer;padding:0}'
  + '.vr-how-body{display:none;font-size:12.5px;line-height:1.55;color:#5b6b7a;margin-top:8px}'
  + '.vr-how-body.open{display:block}'
  // M-Estimate DETAIL block (Market Intelligence) — value-history header + reprinted number + comps.
  + '.mest-hd{font:800 15px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.mest-sub{font:500 12.5px Inter,system-ui,sans-serif;color:var(--faint);line-height:1.4;margin:2px 0 12px}'
  + '.mest-num{font:800 26px Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#0f2233;line-height:1}'
  + '.mest-apx{font-size:18px;color:var(--faint);font-weight:700;vertical-align:1px}'
  + '.mest-band{font:600 13.5px Inter,system-ui,sans-serif;color:#12805c;margin:5px 0 10px}'
  + '.mest-chart-cap{font:500 12px Inter,system-ui,sans-serif;color:var(--faint);margin-top:6px}'
  + '.mest-comps{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}'
  + '.mest-comp{font:600 12.5px Inter,system-ui,sans-serif;color:var(--ink);background:var(--grnd-bg,#ecf8f1);border:1px solid var(--grnd-line,#cfe9d9);border-radius:8px;padding:7px 11px}'
  // Value-history timeline (#88) — median award $ per year, CSS bars on a time axis.
  + '.vt-chart{display:flex;align-items:flex-end;gap:6px;height:82px;margin:4px 0 2px;padding-top:6px}'
  + '.vt-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}'
  + '.vt-bar{width:100%;max-width:26px;background:linear-gradient(180deg,#34d399,#12805c);border-radius:4px 4px 0 0;min-height:4px}'
  + '.vt-yr{margin-top:5px;font:600 10.5px Inter,system-ui,sans-serif;color:var(--faint);font-variant-numeric:tabular-nums}'
  // Dated comps list (#88) — the real comparable awards behind the estimate ("nearby sold homes").
  + '.vc-list{display:flex;flex-direction:column;gap:1px;margin-top:6px;border:1px solid var(--hair,#f0f3f7);border-radius:10px;overflow:hidden}'
  + '.vc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;background:#fff;border-top:1px solid var(--hair,#f0f3f7)}'
  + '.vc-row:first-child{border-top:0}'
  + '.vc-main{min-width:0;display:flex;flex-direction:column;gap:1px}'
  + '.vc-who{font:600 12.5px Inter,system-ui,sans-serif;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}'
  + '.vc-sub{font:500 11px Inter,system-ui,sans-serif;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}'
  + '.vc-meta{flex:none;display:flex;align-items:baseline;gap:8px}'
  + '.vc-val{font:700 12.5px Inter,system-ui,sans-serif;color:#12805c;font-variant-numeric:tabular-nums}'
  + '.vc-yr{font:600 11px Inter,system-ui,sans-serif;color:var(--faint);font-variant-numeric:tabular-nums}'
  + '.scorebar{height:9px;border-radius:6px;background:#e9eef5;overflow:hidden;margin:10px 0 4px}'
  + '.scorebar i{display:block;height:100%;border-radius:6px}'
  // Pricing bar chart (vendor $/hr).
  + '.ratechart{display:flex;flex-direction:column;gap:11px}'
  + '.rc-row{display:grid;grid-template-columns:1fr 44%;grid-template-areas:"lbl val" "bar bar";gap:3px 10px;align-items:center}'
  + '.rc-lbl{grid-area:lbl;font:600 13px Inter,system-ui,sans-serif;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.rc-sz{color:var(--faint);font-weight:400;font-size:11.5px}'
  + '.rc-val{grid-area:val;text-align:right;font:700 13.5px Inter,system-ui,sans-serif;color:#12805c}'
  + '.rc-bar{grid-area:bar;height:8px;border-radius:5px;background:#eef2f7;overflow:hidden}'
  + '.rc-bar i{display:block;height:100%;border-radius:5px;background:var(--grnd);opacity:.9}'
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
  + '.xsell-widen{font:600 12px Inter,system-ui,sans-serif;color:var(--jan);background:transparent;border:1px solid var(--jan);border-radius:7px;padding:7px 13px;cursor:pointer}'
  + '.xsell-widen:hover{background:#eff5ff}'
  + '.xsell-note{font:400 13px Inter,system-ui,sans-serif;color:var(--sub);margin-bottom:12px}'
  + '.roster-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
  + '@media(max-width:640px){.roster-grid{grid-template-columns:1fr}}'
  + '.roster-card{border:1px solid var(--line);border-radius:11px;padding:12px 13px}'
  + '.roster-card .nm{font:700 13.5px Inter,system-ui,sans-serif;color:var(--ink)}'
  + '.roster-card .ti{font:500 12px Inter,system-ui,sans-serif;color:var(--sub);margin:1px 0 6px}'
  + '.roster-card .row{font:500 12px Inter,system-ui,sans-serif;color:var(--sub)}'
  + '.roster-card a{color:#006aff;text-decoration:none}'
  // Inline contact icons (mail/phone) — replaced the ✉️/☎️ emoji (Eric 2026-08-05: no emoji).
  + '.ci{width:13px;height:13px;vertical-align:-2px;margin-right:3px;color:var(--faint)}'
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
  // DLA price-to-quote helper (Eric 2026-07-31) — a compact "your unit price x qty = total" box.
  // ── DLA bid drawer: item hero (what am I bidding on) + part-photo slot.
  + '.dla-drawer .snapfresh{margin-top:14px}'
  + '.dla-hero{display:flex;gap:14px;align-items:flex-start;margin-bottom:18px}'
  + '.dla-photo{flex:0 0 78px;height:78px;border-radius:12px;border:1px dashed var(--line);background:var(--soft,#f7f8fa);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#b0b7c3}'
  + '.dla-photo span{font:600 9px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase}'
  + '.dla-hero-txt{min-width:0;flex:1}'
  + '.dla-hero-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:7px}'
  + '.dla-hero-title{font:700 19px/1.3 "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em}'
  + '.dla-hero-nsn{margin-top:5px;font:600 12px Inter,system-ui,sans-serif;color:var(--faint);font-variant-numeric:tabular-nums}'
  + '.snapgrid .v.mono{font-family:var(--mono,ui-monospace,monospace);font-size:12.5px;font-variant-numeric:tabular-nums}'
  // ── Price-to-quote box (the primary task → leads the drawer).
  + '.dla-quote{border:1px solid var(--line);border-radius:12px;padding:16px 17px}'
  // DLA reference-price anchor — the government catalog price shown as the bid floor above the input.
  + '.dla-anchor{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--accent-soft,#eef4fb);border:1px solid color-mix(in srgb,var(--accent,#2d5a8c) 22%,transparent);border-radius:10px;padding:11px 14px;margin-bottom:15px}'
  + '.dla-anchor-l{display:flex;flex-direction:column;gap:2px;min-width:0}'
  + '.dla-anchor-l .k{font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--accent,#2d5a8c)}'
  + '.dla-anchor-sub{font:500 11.5px Inter,system-ui,sans-serif;color:var(--faint,#98a2b3)}'
  + '.dla-anchor-v{font:800 20px "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}'
  + '.dla-quote-row{display:flex;align-items:flex-end;gap:12px}'
  + '.dla-ql{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;font:700 12px Inter,system-ui,sans-serif;color:var(--muted,#667085)}'
  + '.dla-ql-qty{flex:0 0 90px}'
  + '.dla-ql em{font-weight:500;font-style:normal;color:#98a2b3;font-size:11px}'
  + '.dla-ql input{border:1.5px solid var(--line);border-radius:9px;padding:10px 11px;font:600 15px Inter,system-ui,sans-serif;color:var(--ink);width:100%;box-sizing:border-box}'
  + '.dla-ql input:focus{outline:none;border-color:#006aff}'
  + '.dla-mult{flex:0 0 auto;padding-bottom:11px;color:#b0b7c3;font:600 16px Inter,system-ui,sans-serif}'
  + '.dla-money{display:flex;align-items:center;border:1.5px solid var(--line);border-radius:9px;padding-left:11px}'
  + '.dla-money>span{color:#98a2b3;font:600 15px Inter,system-ui,sans-serif}'
  + '.dla-money input{border:0;padding:10px 11px 10px 4px}'
  + '.dla-money input:focus{outline:none}'
  + '.dla-money:focus-within{border-color:#006aff}'
  + '.dla-quote-total{display:flex;justify-content:space-between;align-items:baseline;margin-top:15px;padding-top:14px;border-top:1px solid var(--line)}'
  + '.dla-quote-total span{font:700 13px Inter,system-ui,sans-serif;color:var(--muted,#667085)}'
  + '.dla-quote-total b{font:800 24px "Space Grotesk",Inter,system-ui,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums}'
  + '.dla-quote-total b.empty{font:500 13px Inter,system-ui,sans-serif;color:#b0b7c3}'
  + '.dla-quote-note{display:flex;gap:8px;align-items:flex-start;margin-top:12px;font:500 12px/1.5 Inter,system-ui,sans-serif;color:#98a2b3}'
  + '.dla-quote-note .dot{flex:0 0 6px;width:6px;height:6px;border-radius:50%;background:#f0b429;margin-top:5px}'
  // ── Recompete (Awarded) detail: incumbent highlight block. The Awarded card has no SAM
  // opp-intel row (it's a USASpending recompete keyed by PIID/sol#, not notice_id), so its
  // detail is a richer presentation of the row already in hand — not an opportunity-detail fetch.
  + '.rc-inc{display:flex;align-items:center;gap:14px;border:1px solid #f0d9b5;border-radius:14px;'
  + 'background:linear-gradient(135deg,#fffaf2,#fff6ea);padding:16px 18px}'
  + '.rc-inc-ic{flex:none;width:42px;height:42px;border-radius:11px;background:#fef0d9;display:grid;place-items:center}'
  + '.rc-inc-ic svg{width:22px;height:22px;stroke:#b45309;fill:none;stroke-width:2}'
  + '.rc-inc-k{font:700 10.5px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#b45309}'
  + '.rc-inc-v{font:700 17px Inter,system-ui,sans-serif;color:var(--ink);margin-top:2px;line-height:1.25}'
  // ── Task-order spend stream (the real money, not the ceiling). "Actually obligated"
  // summary line + a dated ledger of task orders (each: $ · date · city). Fetched
  // on-demand when the drawer opens (GET /api/app/recompete-task-orders).
  + '.rc-actual{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;'
  + 'border:1px solid #d1e9dd;border-radius:12px;background:#f0fdf7;padding:13px 16px;margin-bottom:14px}'
  + '.rc-actual-v{font:700 19px Inter,system-ui,sans-serif;color:#0f7a4f}'
  + '.rc-actual-k{font:600 12px Inter,system-ui,sans-serif;color:#12805c;margin-top:1px}'
  + '.rc-ceil{text-align:right}'
  + '.rc-ceil-v{font:700 15px Inter,system-ui,sans-serif;color:var(--sub)}'
  + '.rc-ceil-k{font:600 10.5px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:var(--faint)}'
  + '.rc-to-list{display:flex;flex-direction:column}'
  + '.rc-to-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--hair)}'
  + '.rc-to-row:last-child{border-bottom:0}'
  + '.rc-to-amt{font:700 14px Inter,system-ui,sans-serif;color:var(--ink);flex:none;min-width:64px}'
  + '.rc-to-date{font:500 12.5px Inter,system-ui,sans-serif;color:var(--sub);flex:none}'
  + '.rc-to-loc{font:500 12.5px Inter,system-ui,sans-serif;color:var(--sub);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}'
  + '.rc-to-loc.approx{font-style:italic}'
  + '.rc-to-loading{color:var(--faint);font-size:12.5px;padding:10px 0}'
  // Task-order spend OVER TIME — the payout rhythm. Same plain-CSS-bar approach as the
  // M-Estimate distribution chart (.vr-chart), but each bar is one task order positioned in
  // time-order (earliest → latest), height scaled to the max obligation. No chart library.
  + '.rc-tochart-lab{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.03em;text-transform:uppercase;color:#5b6b7a;margin:2px 0 8px}'
  + '.rc-tochart{display:flex;align-items:flex-end;gap:3px;height:64px}'
  + '.rc-tobar{flex:1;background:var(--grnd);opacity:.85;border-radius:4px 4px 0 0;min-height:3px;transition:opacity .12s}'
  + '.rc-tobar:hover{opacity:1}'
  + '.rc-tochart-axis{display:flex;justify-content:space-between;font:500 11px Inter,system-ui,sans-serif;color:var(--faint);margin-top:6px}'
  // Bucketed/labeled chart (payouts condensed into time periods so the $ per period is READABLE).
  // Each column = one period: a value label on top, a bar, a period label below. Bars are wide
  // enough to breathe; the whole thing scrolls sideways if there are many periods (never squished).
  // ZILLOW-STYLE bar chart (Eric 2026-07-28: "look at the styling of the chart, the UI from Zillow").
  // Zillow's price-history look: a soft single-tone fill (not a bright saturated gradient), a thin
  // baseline the bars sit on, muted value labels, generous spacing, and a subtle hover that lifts the
  // bar. Clean + calm, reads as data not decoration. --grnd is the map's own green accent.
  + '.rc-bkchart{display:flex;align-items:flex-end;gap:14px;overflow-x:auto;padding:0 2px 2px;'
  +   'border-bottom:1px solid var(--line)}'                                   // the baseline the bars stand on
  + '.rc-bkcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1 0 38px;min-width:38px;height:140px;position:relative}'
  + '.rc-bkval{font:600 11px Inter,system-ui,sans-serif;color:var(--sub);margin-bottom:6px;white-space:nowrap;font-variant-numeric:tabular-nums;transition:color .12s}'
  + '.rc-bkcol:hover .rc-bkval{color:var(--grnd)}'                            // value pops to accent on hover
  + '.rc-bkbar{width:100%;max-width:40px;background:var(--grnd);opacity:.85;border-radius:5px 5px 0 0;min-height:4px;transition:opacity .12s,transform .12s;transform-origin:bottom}'
  + '.rc-bkcol:hover .rc-bkbar{opacity:1}'                                    // solid on hover — subtle, Zillow-like
  // A $0 year (fixed-window chart): no bar — a faint baseline tick, so the quiet year reads as real
  // "no awards" and the column still holds its slot (same axis for every firm, Eric 2026-07-28).
  + '.rc-bkbar-zero{background:none;opacity:1;min-height:0;height:3px!important;border-radius:0;'
  +   'border-top:2px dotted var(--faint);width:60%}'
  + '.rc-bklab{font:600 10.5px Inter,system-ui,sans-serif;color:var(--faint);margin-top:8px;white-space:nowrap}'
  + '.rc-bkcap{font:500 11px Inter,system-ui,sans-serif;color:var(--faint);margin-top:10px;text-align:center;letter-spacing:.02em}'
  // Collapsed remainder of the dated ledger (past the first ~8) + its toggle.
  + '.rc-to-rest{display:none}.rc-to-rest.open{display:block}'
  + '.rc-to-more{margin-top:10px;font:700 13px Inter,system-ui,sans-serif;color:#12805c;background:none;border:0;cursor:pointer;padding:0}'
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
  var CUR_FC=null; // the forecast pin whose drawer is open — loadForecastDetail reads it for agency/roster
  // Task-order pins: an ON-DEMAND enhancement layer, separate from the main viewport
  // pin (which stays contract-level — see toRow()/RECOMPETE — so MAX_PINS/viewport-bbox
  // is untouched). Drawn only for the ONE contract whose drawer is open; cleared on
  // close so it never leaks into the general map view. Reuses mkPin (hoisted from
  // PIN_JS) so a task-order pin looks like every other value-tag pin on the board.
  function taskOrderLayer(){ try{ if(!window.__rcToLayer)window.__rcToLayer=L.layerGroup().addTo(map); return window.__rcToLayer; }catch(e){ return null; } }
  function clearTaskOrderPins(){ var l=taskOrderLayer(); if(l)l.clearLayers(); }
  function drawTaskOrderPins(txns){
    var l=taskOrderLayer(); if(!l)return;
    l.clearLayers();
    (txns||[]).forEach(function(t){
      if(t.lat==null||t.lng==null)return;
      var amt=(typeof mMoney==='function')?mMoney(t.obligation):'';
      var approx=t.locPrecision==='state';
      if(typeof mkPin!=='function')return;
      var m=mkPin({lat:t.lat,lng:t.lng},'#b45309',amt,approx);
      var when=t.actionDate?longDate(t.actionDate):'';
      var where=t.popCity?(t.popCity+', '+(t.popState||'')):(t.popState||'');
      m.bindPopup('<div style="font:600 13px Inter,system-ui,sans-serif;padding:4px 2px">'+esc(amt||'')+'<br><span style="font-weight:400;color:#6b7787">'+esc(when)+(where?' \\u00b7 '+esc(where):'')+'</span></div>',{maxWidth:220,closeButton:true});
      m.addTo(l);
    });
  }
  function close(){ dr.classList.remove('show'); bd.classList.remove('show'); clearTaskOrderPins(); }
  if(bd)bd.onclick=close;
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')close(); });
  // Action bar: Back (close) · Save (→pursuits) · Share (copy link) · Hide (dismiss + hide card) · More.
  var _back=document.getElementById('oppBack'); if(_back)_back.onclick=close;
  function _auth(){ var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){} try{ var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){} return {t:t,em:em}; }
  var _save=document.getElementById('oppSave');
  if(_save)_save.onclick=function(){ if(!CUR)return; var a=_auth(); if(!a.t||!a.em){ if(window.openSignInModal){window.openSignInModal('save this',function(){location.reload();});}else{location.href='/app?next=%2Fopportunity-map';} return; }
    _save.classList.add('done'); _save.querySelector('span').textContent='Saved';
    // Company drawer save (COMPOUND parity): a hearted company saves via the SAME
    // /api/opportunities/save endpoint the map hearts use — the UEI stands in for
    // noticeId, source='company_map', with a snapshot so the Favorites page can
    // render it without a sam_opportunities hydration hit. Opps/recompetes keep the
    // pursuits save (a company isn't a pursuit).
    if(CUR.kind==='company'){
      fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
        body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'company_map',
          opportunityData:{noticeId:CUR.id,entityType:'company',uei:CUR.id,title:CUR.title,department:CUR.department,agency:CUR.department}})}).catch(function(){});
      return;
    }
    // Gov Buyer drawer save (COMPOUND parity): the federal_contacts id stands in for noticeId,
    // source='buyer_map' — same endpoint the buyer popup heart uses. A buyer isn't a pursuit.
    if(CUR.kind==='buyer'){
      fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
        body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'buyer_map',
          opportunityData:{noticeId:CUR.id,entityType:'buyer',title:CUR.title,department:CUR.department,agency:CUR.department}})}).catch(function(){});
      return;
    }
    // Recompete drawer action-bar Save (COMPOUND parity, gap 3): a recompete has NO
    // sam_opportunities row, so it saves via /api/opportunities/save with a snapshot
    // (source=recompete_map, PIID as noticeId) — same path the in-body "Track this recompete"
    // + the popup heart use, so all three land the same Favorites row. A recompete isn't a pursuit.
    if(CUR.kind==='recompete'){
      fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
        body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'recompete_map',
          opportunityData:{noticeId:CUR.id,entityType:'recompete',solicitationNumber:CUR.solicitation,title:CUR.title,department:CUR.department,agency:CUR.department,naicsCode:CUR.naics}})}).catch(function(){});
      return;
    }
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},body:JSON.stringify({noticeId:CUR.id,email:a.em,title:CUR.title,agency:CUR.department})}).catch(function(){}); };
  // The Save button is PERSISTENT action-bar DOM (built once, reused for every opp the drawer opens).
  // So its "Saved"/done state carries over to the NEXT opp unless we reset it on open — the "I clicked
  // once but they all look saved" bug. Every drawer open MUST call this first.
  window.__resetOppSave=function(){ var b=document.getElementById('oppSave'); if(b){ b.classList.remove('done'); var s=b.querySelector('span'); if(s)s.textContent='Save'; } };
  var _share=document.getElementById('oppShare');
  if(_share)_share.onclick=function(){ if(!CUR)return; var _pk=(CUR.kind==='company')?'company':(CUR.kind==='buyer')?'buyer':(CUR.kind==='recompete')?'recompete':'opp'; var url=location.origin+'/opportunity-map?'+_pk+'='+encodeURIComponent(CUR.id);
    // SHARING IS THE FLYWHEEL. Year five says a shared listing brings a teaming partner in
    // who then browses too — this is the only event that can ever prove or kill that claim.
    // Paired with map_view's referrer, a share and the arrival it causes are both visible.
    try{ if(window.__track) window.__track('tool_use','listing_share',{notice_id:String(CUR.id),kind:_pk}); }catch(e){}
    var done=function(){ _share.querySelector('span').textContent='Copied!'; setTimeout(function(){ _share.querySelector('span').textContent='Share'; },1600); };
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done,function(){ prompt('Copy this link:',url); }); } else { prompt('Copy this link:',url); } };
  var _hide=document.getElementById('oppHide');
  if(_hide)_hide.onclick=function(){ if(CUR){ try{ var c=document.querySelector('.card[data-sol="'+(window.CSS&&CSS.escape?CSS.escape(CUR.sol||CUR.id):(CUR.sol||CUR.id))+'"]'); if(c)c.style.display='none'; }catch(e){} } close(); };
  var _more=document.getElementById('oppMore');
  if(_more)_more.onclick=function(){ if(CUR&&CUR.uiLink)window.open(CUR.uiLink,'_blank','noopener'); };
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  // Attachment row builder — SHARED by every attachment render site (bidFactsSec + the legacy
  // docsSec), so the fix lives in ONE place. Stored attachments entries come in TWO shapes:
  // a bare URL string (current prod data — SAM's list endpoint gives us no filename, only the
  // download URL) or an object {name?, url?} (older/richer rows). Either way, SAM's URL itself
  // carries no filename — the real name only exists in the file's Content-Disposition header,
  // resolved lazily via GET /api/sam-attachment/metadata?url=... (same endpoint
  // SamAttachmentLinks.tsx already uses for the React surfaces). Render immediately with a
  // placeholder + a working download link; the label's id lets resolveAttachmentNames() swap
  // in the real filename once the metadata fetch resolves (fail-soft: leave the placeholder on
  // a miss, never show "undefined").
  var _attRowSeq=0;
  function attRow(a,cls,linkCls){
    var url = (typeof a==='string') ? a : ((a&&a.url)||'');
    var name = (typeof a==='object' && a && a.name) ? a.name : '';
    var id='att-'+(_attRowSeq++);
    if(name){
      // Already have a real name (rare with current data, but honor it) — no fetch needed.
      return linkCls
        ? '<a class="'+linkCls+'" '+(url?'href="'+esc(url)+'" target="_blank" rel="noopener"':'')+'>\\ud83d\\udcc4 '+esc(name)+'</a>'
        : '<div class="'+cls+'">\\ud83d\\udcc4 '+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(name)+'</a>':esc(name))+'</div>';
    }
    var label='<span id="'+id+'" data-att-url="'+esc(url)+'">Document</span>';
    return linkCls
      ? '<a class="'+linkCls+'" '+(url?'href="'+esc(url)+'" target="_blank" rel="noopener"':'')+'>\\ud83d\\udcc4 '+label+'</a>'
      : '<div class="'+cls+'">\\ud83d\\udcc4 '+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+label+'</a>':label)+'</div>';
  }
  // After the drawer's attachment rows are in the DOM, resolve each placeholder's real filename
  // via SAM's Content-Disposition lookup (fail-soft — a miss just leaves "Document"). Fires once
  // per drawer render; ≤20 attachments per opp (render already slices to 20).
  function resolveAttachmentNames(){
    var els=document.querySelectorAll('[data-att-url]');
    Array.prototype.forEach.call(els,function(el){
      var url=el.getAttribute('data-att-url'); if(!url)return;
      fetch('/api/sam-attachment/metadata?url='+encodeURIComponent(url)).then(function(r){return r.json().catch(function(){return {};});})
        .then(function(d){ if(d&&d.filename)el.textContent=d.filename; }).catch(function(){});
    });
  }
  // "days left" — anchor the deadline's calendar date to local noon vs today's noon so a UTC-midnight
  // date doesn't read as one day early/late (same date-bug fix as longDate).
  function due(d){ if(!d)return ''; var dt=localDate(d); if(!dt||isNaN(dt))return ''; var t=new Date(); t.setHours(12,0,0,0); var n=Math.round((dt-t)/86400000); if(n<0)return 'closed'; if(n===0)return 'due today'; if(n===1)return '1 day left'; return n+' days left'; }
  // Date-only / UTC-midnight values ("2026-07-21" or "2026-07-21T00:00:00+00:00") were being parsed
  // as UTC then formatted in the viewer's LOCAL zone, shifting a US user BACK one day ("Jul 21"→"Jul
  // 20") — the drawer showed a different day than the card. Fix: take the CALENDAR date (first 10
  // chars) and anchor it to local NOON so the day can't cross a boundary in any US timezone. A value
  // with a real intraday time (e.g. a deadline at 22:00Z) keeps its own time. (2026-07-27 date-bug.)
  function ymd(d){ var s=String(d==null?'':d); var m=s.match(/^(\\d{4}-\\d{2}-\\d{2})/); return m?m[1]:''; }
  function localDate(d){ var y=ymd(d); return y?new Date(y+'T12:00:00'):(d?new Date(d):null); }
  function longDate(d){ if(!d)return '\\u2014'; try{ var dt=localDate(d); return (dt&&!isNaN(dt))?dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\\u2014'; }catch(e){return '\\u2014';} }
  // sec() now takes an optional anchor id (3rd arg) so the sticky tabs can jump to it. Every
  // section is a divider-separated block with a bold header (unified format, Zillow-style).
  function sec(title,inner,id){ return '<section class="osec"'+(id?' id="osec-'+id+'"':'')+'><div class="osec-h">'+title+'</div>'+inner+'</section>'; }
  // Shared line-art icons for section headings (Eric 2026-08-05: NO emoji anywhere — lucide-style SVG
  // only). Sized to sit inline with the .osec-h text (see .osec-h svg CSS). Target/crosshair = the
  // "Should I pursue this?" decision; used by aiSec + fcPursueSec + the open-bids cross-sell.
  var ICON_TARGET='<svg class="osec-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg>';
  // Landmark/agency-building icon for the "Buyer intelligence" heading (replaces the 🏛️ emoji).
  var ICON_LANDMARK='<svg class="osec-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>';
  function empty(msg){ return '<div class="osec-empty">'+msg+'</div>'; }
  // "How this buyer buys" (GOS #11) — the agency's contract_type mix as a small-business-fit signal.
  // A PURCHASE ORDER is a simplified-acquisition buy a small firm can win directly (SB-friendly); a
  // DELIVERY ORDER is a task order under a vehicle you must already hold (vehicle-gated). Every number
  // is server-computed from real awards (src/lib/opportunities/buyer-behavior.ts) — never fabricated.
  // Always renders (GOS #10): an honest placeholder when the signal isn't grounded.
  function behaviorSec(bh){
    if(!bh||!bh.grounded){
      return sec('How this buyer buys',empty('Not enough award history to profile this buyer\\u2019s buying pattern.'),'buyerbehavior');
    }
    var tone=bh.verdict&&bh.verdict.tone||'mixed';
    var col=tone==='friendly'?['#e7f6ec','#0a7d33']:(tone==='gated'?['#fdecec','#c0392b']:['#fef6e7','#8a6d1a']);
    var dot=tone==='friendly'?'\\ud83d\\udfe2':(tone==='gated'?'\\ud83d\\udd12':'\\ud83d\\udfe1');
    var m=bh.mix||{}; var n=bh.sampleSize||0;
    // A compact 100%-width stacked bar: PO (green) · delivery (amber) · rest (grey).
    var poW=Math.max(0,Math.min(100,bh.poPct||0)), dW=Math.max(0,Math.min(100,bh.deliveryPct||0));
    var restW=Math.max(0,100-poW-dW);
    var bar='<div class="bhbar" title="'+poW+'% purchase orders \\u00b7 '+dW+'% delivery orders">'
      + (poW?'<span style="width:'+poW+'%;background:#0a7d33"></span>':'')
      + (dW?'<span style="width:'+dW+'%;background:#e0a52e"></span>':'')
      + (restW?'<span style="width:'+restW+'%;background:#c9ccd1"></span>':'')
      + '</div>'
      + '<div class="bhleg"><span><i style="background:#0a7d33"></i>Purchase orders '+poW+'%</span>'
      + '<span><i style="background:#e0a52e"></i>Delivery orders '+dW+'%</span>'
      + '<span><i style="background:#c9ccd1"></i>Other '+restW+'%</span></div>';
    var inner='<div class="bhbadge" style="background:'+col[0]+';color:'+col[1]+'">'+dot+' '+esc(bh.verdict&&bh.verdict.label||'')+'</div>'
      + '<div class="bhdetail">'+esc(bh.verdict&&bh.verdict.detail||'')+'</div>'
      + bar
      + '<div class="bhnote">Based on '+n.toLocaleString()+' award'+(n===1?'':'s')+' on record for this buyer. Set-aside share isn\\u2019t tracked on awarded contracts (shown on open opportunities).</div>';
    return sec('How this buyer buys',inner,'buyerbehavior');
  }
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

  // The hero HEAD — lifecycle badges + TITLE only. The M-Estimate slot (#mEstTop) renders
  // immediately AFTER this, so the order is Title -> M-Estimate -> facts (Eric 2026-08-04:
  // "the title should be first ... the old box card was showing BEFORE the M-Estimate").
  function snapshotHead(o){
    var n=o.deadline?Math.ceil((new Date(o.deadline)-new Date())/86400000):null;
    var cls=(n!=null&&n<=7)?'badge-dl':'badge-dl cool';
    return '<div class="snaphero">'
      + (o.noticeType?'<span class="badge-nt">'+esc(o.noticeType)+'</span>':'')
      + (o.deadline?'<span class="'+cls+'">'+esc(due(o.deadline))+'</span>':'')
      + '</div>'
      + '<div class="snapt">'+esc(o.title)+'</div>';
  }
  // The hero FACTS grid — the 6 key facts. Renders AFTER the M-Estimate now (was fused into the
  // title block, which pushed the box ABOVE the estimate).
  function snapshotFacts(o){
    // The HERO facts = exactly the 4 Eric specced (2026-08-04): Response Due · Set-aside · Agency ·
    // Location. The technical codes (NAICS · PSC · Posted · Solicitation) live DOWN in Opportunity
    // Intelligence (#3) with the rest of the record — "everything about the opportunity itself" —
    // not in the decision hero. Response-due goes RED when the deadline is close (<=7 days).
    var n=o.deadline?Math.ceil((new Date(o.deadline)-new Date())/86400000):null;
    var dueCls=(n!=null&&n<=7)?'v urgent':'v';
    var agency=o.department_display||o.department||'\\u2014';
    var loc=o.location?((o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'')):'';
    return '<div class="snapgrid">'
      + '<div><div class="k">Response due</div><div class="'+dueCls+'">'+longDate(o.deadline)+'</div></div>'
      + '<div><div class="k">Set-aside</div><div class="v">'+esc(o.setAsideLabel||'Open')+'</div></div>'
      + '<div><div class="k">Agency</div><div class="v">'+esc(agency)+'</div></div>'
      + '<div><div class="k">Location</div><div class="v">'+esc(loc||'Not specified')+'</div></div>'
      + '</div>';
  }
  // Relative-time ("3 hours ago" / "2 days ago") from an ISO/date string. Zillow's "on Zillow N days"
  // + "last checked" both read as human deltas. Returns '' on an unparseable/missing date.
  function relTime(v){
    if(!v)return '';
    var t=Date.parse(v); if(!isFinite(t))return '';
    var s=Math.floor((Date.now()-t)/1000); if(s<0)s=0;
    if(s<3600)return Math.max(1,Math.floor(s/60))+' min ago';
    if(s<86400){ var h=Math.floor(s/3600); return h+' hour'+(h===1?'':'s')+' ago'; }
    var d=Math.floor(s/86400); if(d<30)return d+' day'+(d===1?'':'s')+' ago';
    var mo=Math.floor(d/30); if(mo<12)return mo+' month'+(mo===1?'':'s')+' ago';
    return Math.floor(mo/12)+' year'+(mo<24?'':'s')+' ago';
  }
  // Activity row (Zillow's "180 days on Zillow · 2,028 views · 150 saves"): the opp's real activity
  // signals. Posted-age + closes-in are always real; the tracking count (contractors with this in
  // their pipeline) is a genuine competition tell — shown ONLY when >=2 (a 0/1/null omits it, never
  // a vanity "0 tracking this"). No fabricated views metric (we don't instrument per-opp views yet).
  function activitySec(o,extra){
    var bits=[];
    var pAge=relTime(o.posted); if(pAge)bits.push('Posted '+pAge);
    if(o.deadline){ var n=Math.ceil((new Date(o.deadline)-new Date())/86400000);
      if(isFinite(n))bits.push(n<0?'Closed':(n===0?'Closes today':'Closes in '+n+' day'+(n===1?'':'s'))); }
    var top=bits.length?'<div class="snapactivity">'+bits.map(function(b){return '<span>'+esc(b)+'</span>';}).join('<span class="snapdot">\\u00b7</span>')+'</div>':'';
    return top+marketActivitySec(extra);
  }
  // MARKET ACTIVITY — Zillow's confident "741 views · 27 saves", grounded + gated. All three counts
  // are real (opportunity-detail: viewCount=distinct listing_view viewers, trackingCount=watching,
  // pursuingCount=active-pursuit-stage pipeline rows). GATE: show the whole row ONLY when
  // watching>=10 OR pursuing>=3 — below that it renders nothing (never a lonely "2 watching").
  // Each token appears only when its count is meaningful: viewed only if >0 (we don't fake views),
  // pursuing only if >0. Plain, confident copy — no "users", no "engagement", no emoji.
  function marketActivitySec(extra){
    // Zillow's "741 views · 27 saves", grounded: viewed = distinct listing_view viewers,
    // saved = user_saved_opportunities (the favorites heart). Pursuits deferred (Eric: "keep views
    // and saved, add pursuits later"). GATE: show as soon as there's ANY real activity (saved>=1 OR
    // viewed>=1) — Eric lowered it from 5/25 so the row is visible while view-tracking is fresh; raise
    // it later once traffic builds. Each token shown only when >0 (a genuine 0 omits it). Plain,
    // confident copy — no "users"/"engagement", no emoji.
    var s=extra&&extra.savedCount, v=extra&&extra.viewCount;
    s=(typeof s==='number')?s:0; v=(typeof v==='number')?v:0;
    if(!(s>=1||v>=1))return '';
    var toks=[];
    if(v>0)toks.push(v.toLocaleString()+' viewed');
    if(s>0)toks.push(s.toLocaleString()+' saved');
    if(!toks.length)return '';
    return '<div class="snapactivity"><span class="snaplabel">Market Activity</span>'
      +toks.map(function(t){return '<span>'+esc(t)+'</span>';}).join('<span class="snapdot">\\u00b7</span>')+'</div>';
  }
  // Data-freshness + provenance (Zillow's "Zillow last checked: 3 hours ago" + "Source: MIAMI MLS#…").
  // Builds trust: shows the data is LIVE and where it comes from. All real (synced_at, source,
  // solicitation #). archive/inactive is surfaced honestly (an archived notice reads as stale).
  function freshnessSec(o){
    var parts=[];
    var live=(o.active===false)?'Archived on SAM.gov':'Live from '+esc(o.source||'SAM.gov');
    parts.push(live);
    var upd=relTime(o.syncedAt); if(upd)parts.push('updated '+upd);
    if(o.solicitation)parts.push('Solicitation '+esc(o.solicitation));
    return '<div class="snapfresh">'+parts.join(' <span class="snapdot">\\u00b7</span> ')+'</div>';
  }
  // Buying organization — the agency hierarchy + place of performance, in its OWN section
  // (SAM shows this as a prominent block; it was easy to miss as a grey line under the title).
  function orgSec(o){
    var loc=(o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'');
    var cue=o.location.source==='office'?' <span style="color:#94a3b8;font-weight:400;font-size:11px">(buying office)</span>':'';
    return sec('Buying organization','<div class="snapgrid">'
      + '<div><div class="k">Department / agency</div><div class="v">'+esc(o.department_display||o.department||'\\u2014')+'</div></div>'
      + '<div><div class="k">Sub-tier</div><div class="v">'+esc(o.subTier_display||o.subTier||'\\u2014')+'</div></div>'
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
    // "Opportunity summary" — renamed from "Description" (Eric 2026-08-02).
    if(!o.synopsis)return sec('Opportunity summary',empty('No description has been added to this opportunity.'),'description');
    return sec('Opportunity summary',docBody('synBody',o.synopsis),'description');
  }
  function sowSec(o){
    // GOS invariant #10: the Scope-of-work section always renders — header + a muted placeholder
    // when no SOW/PWS text was extracted (so the section + its tab never vanish).
    if(!(o.sow&&o.sow.text))return sec('Scope of work',empty('No scope-of-work text has been extracted for this notice.'),'sow');
    return sec('Scope of work'+(o.sow.filename?' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">'+esc(o.sow.filename)+'</span>':''),docBody('sowBody',o.sow.text),'sow');
  }
  function pocCard(c){
    return '<div class="ocontact"><div class="nm">'+esc(c.name||'Contact')+'</div>'
      + (c.title?'<div class="ti">'+esc(c.title)+'</div>':'')
      + '<div class="row">'
      + (c.email?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'')
      + (c.email&&c.phone?' \\u00b7 ':'')+(c.phone?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg> '+esc(c.phone):'')
      + '</div></div>';
  }
  // Solicitation contacts — the POCs named ON THIS notice (contract specialist / KO). Sits right
  // under the scope (the "how do I respond" cluster). Distinct from the "other agency contacts to
  // network with" roster, which lives in the market-intelligence block below.
  function solContactsSec(o){
    // Section 6 — DECISION MAKERS (who should I know?). This is the notice's OWN named POC; the
    // broader agency roster (loadRoster) appends right after, inside #intelBox, so the two read as
    // one "people" group. Header = the decision-flow question, not the table name "Solicitation
    // contacts" (Eric 2026-08-03: people belong together at #6, not mid-drawer). id=contacts is the
    // Decision-makers tab anchor (first present in the group).
    var cs=o.contacts||[];
    if(!cs.length)return sec('Decision makers \\u00b7 named on this notice',empty('No contacts are named on this notice \\u2014 see the agency roster below.'),'contacts');
    var prim=cs.filter(function(c){return (c.type||'').toLowerCase()==='primary';});
    var alt=cs.filter(function(c){return (c.type||'').toLowerCase()!=='primary';});
    var inner='';
    if(prim.length)inner+='<div class="osec-sub">Primary point of contact</div>'+prim.map(pocCard).join('');
    if(alt.length)inner+='<div class="osec-sub" style="margin-top:14px">Alternative point of contact</div>'+alt.map(pocCard).join('');
    if(!prim.length&&!alt.length)inner=cs.map(pocCard).join('');
    return sec('Decision makers \\u00b7 named on this notice',inner,'contacts');
  }
  function docsSec(o){
    var links=[], atts=[];
    if(o.additionalInfo&&o.additionalInfo.link)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.additionalInfo.link)+'" target="_blank" rel="noopener">Additional information</a></div>');
    if(o.uiLink)links.push('<div class="odoc">\\ud83d\\udd17 <a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View the full notice on SAM.gov</a></div>');
    (o.attachments||[]).slice(0,20).forEach(function(a){ atts.push(attRow(a,'odoc')); });
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
  // Set a button's label WITHOUT destroying its markup. The forecast moves are rich buttons —
  // <div class="fc-move-t">Track it</div> + <div class="fc-move-d">description</div> — and
  // btn.textContent='Saving…' flattened the whole thing to one bare word, which is why the first
  // move rendered as a lone "Try again" with its title and description gone (Eric 2026-08-13).
  // When a title div exists, write into THAT and leave the description alone; otherwise the button
  // is plain text and behaves exactly as before.
  function setBtnLabel(btn,text){
    var t=btn.querySelector?btn.querySelector('.fc-move-t'):null;
    if(t)t.textContent=text; else btn.textContent=text;
  }
  window.saveCurrentOpp=function(btn,done){
    if(!CUR||btn.dataset.saved==='1'){ if(typeof done==='function')done(btn.dataset.saved==='1',btn.dataset.pursuitId||''); return; }
    var a=window.requireSignIn('save this to your pursuits'); if(!a)return;
    var t=a.t, em=a.em;
    setBtnLabel(btn,'Saving\\u2026');
    fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},
      body:JSON.stringify({user_email:em,title:CUR.title,notice_id:CUR.id,agency:CUR.department,naics_code:CUR.naics,response_deadline:CUR.deadline,source:'opportunity_map'})})
    .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
      var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
      if((d&&!d.error)||dup){ setBtnLabel(btn,dup?'\\u2713 In pursuits':'\\u2713 Tracked'); btn.classList.add('saved'); btn.dataset.saved='1';
        // The pursuit ROW id — returned on a fresh save AND (since 2026-08-13) alongside the 409 for
        // one already tracked. Cached on the button so a second click doesn't re-POST just to learn
        // an id it already had. This is what /opportunity-map/proposal?pursuit=<id> needs.
        var _pid=(d&&d.opportunity&&d.opportunity.id)?String(d.opportunity.id):'';
        if(_pid)btn.dataset.pursuitId=_pid;
        // FUNNEL: pursuit_started (detail-view save — mirrors the popup save's event).
        try{ if(window.__track && !dup) window.__track('tool_use','pursuit_started',{notice_id:String(CUR.id),agency:String(CUR.department||'')}); }catch(e){}
        if(typeof done==='function')done(true,_pid); }
      else { setBtnLabel(btn,'Try again'); if(typeof done==='function')done(false); }
    }).catch(function(){ setBtnLabel(btn,'Try again'); if(typeof done==='function')done(false); });
  };
  // "Start capture" used to be a LINK to /app?panel=proposals&notice=<id>. /app reads only
  // reset/setup/signup/panel/email — it has never read "notice" — so the id was silently dropped
  // and you landed on an empty Proposals panel (Eric 2026-08-13: "it takes me back to the /app
  // page"). For a FORECAST that destination is wrong anyway: the card's own words are "there is
  // no bid to win yet", so there is nothing to draft against. Capture means TRACK it, then work
  // it — so this now saves the buy and opens the pursuits tracker where it actually appears.
  // "Generate proposal" — the MAP-NATIVE Proposal Workspace (/opportunity-map/proposal), not the
  // old /app?panel=proposals panel (Eric 2026-08-13: "the new design not the old /app one").
  //
  // The workspace keys on ?pursuit=<user_pipeline row id>; the drawer only knows a NOTICE id. Rather
  // than resolve one to the other, use the id the save already hands back: tracking the opportunity
  // IS the prerequisite for drafting against it, so track-then-open is the honest order — the same
  // shape as startCapture. An opportunity already tracked returns its row on the 409, so the common
  // case costs one request and no duplicate row.
  // Read a button's current label without disturbing it — the mirror of setBtnLabel.
  function getBtnLabel(btn){
    var t=btn.querySelector?btn.querySelector('.fc-move-t'):null;
    return t?t.textContent:btn.textContent;
  }
  window.openProposalWorkspace=function(btn){
    // Sign-in gate first, and resume HERE afterwards so the click isn't lost to the login bounce.
    var a=window.requireSignIn('draft a proposal',function(){ window.openProposalWorkspace(btn); }); if(!a)return;
    // The tracking here is a MEANS, not the button's purpose, so the label must survive it.
    // saveCurrentOpp relabels to "Saving…"/"✓ Tracked" — correct for a Track button, wrong for one
    // that says "Generate proposal" or "Draft capture strategy". Show what this click is actually
    // doing, then put the label back.
    var _label=getBtnLabel(btn);
    function restore(){ try{ setBtnLabel(btn,_label); }catch(e){} }
    function go(pid){
      restore();
      // FUNNEL: proposal_started — the deepest step of map_open->pin->popup->listing->pursuit->
      // proposal. Kept identical to gateDraft's event so the funnel is continuous across the switch.
      try{ if(window.__track) window.__track('link_click','proposal_started',{notice_id:String((CUR&&CUR.id)||''),act:'draft a proposal'}); }catch(e){}
      var u='/opportunity-map/proposal'+(pid?('?pursuit='+encodeURIComponent(pid)):'');
      try{ window.open(u,'_blank','noopener'); }catch(e){ location.href=u; }
    }
    if(btn.dataset.pursuitId){ go(btn.dataset.pursuitId); return; }   // already known — no re-POST
    setBtnLabel(btn,'Opening\\u2026');
    saveCurrentOpp(btn,function(ok,pid){
      // No id (save failed, or the duplicate lookup came back empty) -> still open the workspace,
      // just unscoped. Refusing to navigate here would strand a user whose opportunity IS tracked
      // over a lookup that merely didn't resolve.
      go(ok?pid:'');
    });
  };
  window.startCapture=function(btn){
    saveCurrentOpp(btn,function(ok){
      if(!ok)return; // the button already says "Try again" — don't send them to an empty panel
      try{ window.open('/app?panel=pipeline','_blank','noopener'); }catch(e){ location.href='/app?panel=pipeline'; }
    });
  };
  function actions(o){
    // The STICKY bottom bar = WORKFLOW actions (Eric 2026-08-04, clean separation of concerns):
    //   Start Pursuit · Generate Proposal · View SAM.
    // (The TOP action row owns the PAGE controls — Back · Save · Share · Hide · More — so those are
    // deliberately NOT duplicated here.) "Generate Proposal" is the plain workflow verb — it opens
    // the MAP-NATIVE Proposal Workspace (/opportunity-map/proposal?pursuit=<id>; it pointed at
    // /app?panel=proposals until 2026-08-13). It was "Win this contract", which collided with the
    // "Win This Contract" SECTION heading, so the button gets the concrete action name instead.
    // id=osec-actions so it stays the deep-link anchor (it's the sticky bar, not a tab).
    return '<div class="oact" id="osec-actions">'
      + '<button class="b pri" onclick="saveCurrentOpp(this)">Start pursuit</button>'
      // Opens the MAP-NATIVE Proposal Workspace via openProposalWorkspace (tracks, then opens with
      // ?pursuit=<id>). No data-u: the destination is not a static URL any more, it depends on the
      // pursuit id the save returns. gateDraft still serves the forecast "Draft capture strategy".
      + '<button class="b" onclick="openProposalWorkspace(this)" data-act="draft a proposal">Generate proposal</button>'
      + (o.uiLink?'<a class="b" href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">View on SAM \\u2197</a>':'')
      + '</div>';
  }
  // ── DLA/DIBBS bid drawer (Eric 2026-07-31: "tool to bid the DLA projects") ─────────────────────
  // A DLA supply RFQ is a different animal from a SAM notice: it's priced by NSN + quantity and
  // QUOTED on DIBBS, not proposed. So the drawer shows the bid-relevant facts (NSN/item/qty/unit/
  // deadline/PR/FSC), a PRICE-TO-QUOTE helper (your unit price x qty = quote total), and DLA CTAs
  // (Quote on DIBBS, View the RFQ spec PDF) — NOT NAICS/M-Estimate/Draft-proposal/View-on-SAM.
  // CUR is set by the drawer opener; saveCurrentOpp reads it. Price/photo come from Apify in phase 2.
  window.__quoteCalc=function(){
    var qtyEl=document.getElementById('dlaQty'), upEl=document.getElementById('dlaUnitPrice'), out=document.getElementById('dlaQuoteTotal');
    if(!qtyEl||!upEl||!out)return;
    var qty=parseFloat(qtyEl.value)||0, up=parseFloat(String(upEl.value).replace(/[^0-9.]/g,''))||0;
    var total=qty*up;
    if(up>0){ out.textContent='$'+total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); out.classList.remove('empty'); }
    else { out.textContent='Enter a unit price'; out.classList.add('empty'); }
  };
  // Format a FLIS reference price (number) → "$1,240.00". null → ''.
  function fmtRef(v){ return (v==null||!(v>0))?'':('$'+Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})); }
  function renderDla(o){
    CUR=o; // saveCurrentOpp reads CUR (same as render())
    var fscTitle=(typeof FSC_TITLES!=='undefined'&&o.fsc&&FSC_TITLES[o.fsc])?FSC_TITLES[o.fsc]:'';
    var n=o.deadline?Math.ceil((new Date(o.deadline)-new Date())/86400000):null;
    var dlCls=(n!=null&&n<=7)?'badge-dl':'badge-dl cool';
    // NSN Intelligence: FLIS/PUB LOG reference (item name + govt reference price + part#/maker).
    var ref=(o.nsnReference&&o.nsnReference._meta&&o.nsnReference._meta.grounded)?o.nsnReference:null;
    var refPart=(ref&&ref.parts&&ref.parts.length)?ref.parts[0]:null;
    // Prefer the FLIS approved item name for the title when the DIBBS title is missing/weak.
    var title=esc((o.title&&o.title.length>3?o.title:null)||(ref&&ref.itemName)||o.solicitation||'DLA supply bid');
    // ── HERO: what am I bidding on. Item title + a photo slot (the part photo lands here in phase 2).
    var hero='<div class="dla-hero">'
      +   '<div class="dla-photo" title="Part photo coming soon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg><span>Photo soon</span></div>'
      +   '<div class="dla-hero-txt">'
      +     '<div class="dla-hero-chips"><span class="badge-nt">RFQ</span><span class="chip DLA">DLA DIBBS</span>'+(o.deadline?'<span class="'+dlCls+'">'+esc(due(o.deadline))+'</span>':'')+'</div>'
      +     '<div class="dla-hero-title">'+title+'</div>'
      +     (o.nsn?'<div class="dla-hero-nsn">NSN '+esc(o.nsn)+(refPart?' \\u00b7 P/N '+esc(refPart.partNumber):'')+'</div>':'')
      +   '</div>'
      + '</div>';
    // ── BID FACTS grid (native .snapgrid look).
    var facts='<div class="snapgrid dla-facts">'
      +   '<div><div class="k">Quantity</div><div class="v">'+(o.quantity!=null?esc(String(o.quantity)):'\\u2014')+(o.unitOfIssue?' '+esc(o.unitOfIssue):'')+'</div></div>'
      +   '<div><div class="k">Response due</div><div class="v">'+longDate(o.deadline)+'</div></div>'
      +   '<div><div class="k">FSC (supply class)</div><div class="v">'+esc(o.fsc||'\\u2014')+(fscTitle?' \\u00b7 '+esc(fscTitle):'')+'</div></div>'
      +   (o.purchaseRequest?'<div><div class="k">Purchase request</div><div class="v mono">'+esc(o.purchaseRequest)+'</div></div>':'')
      +   '<div><div class="k">Solicitation</div><div class="v mono">'+esc(o.solicitation||o.id)+'</div></div>'
      +   '<div><div class="k">Buying agency</div><div class="v">DLA'+(o.office?' \\u00b7 '+esc(o.office):'')+'</div></div>'
      +   (refPart&&refPart.companyName?'<div><div class="k">Manufacturer (cataloged)</div><div class="v">'+esc(refPart.companyName)+(refPart.cageCode?' \\u00b7 CAGE '+esc(refPart.cageCode):'')+'</div></div>':'')
      +   (ref&&ref.itemName?'<div><div class="k">FLIS item name</div><div class="v">'+esc(ref.itemName)+'</div></div>':'')
      + '</div>';
    // ── PRICE TO QUOTE — the primary task, so it leads. When we have a FLIS reference unit price,
    // show it as an ANCHOR row above the input (the bid floor), then the bidder's own unit x qty.
    var refUnit=(ref&&ref.unitPrice!=null)?fmtRef(ref.unitPrice):'';
    var refUi=(ref&&ref.unitOfIssue)||o.unitOfIssue||'unit';
    var anchor=refUnit?('<div class="dla-anchor"><div class="dla-anchor-l"><span class="k">DLA reference price</span>'
      +   '<span class="dla-anchor-sub">Government catalog (FLIS) \\u00b7 per '+esc(refUi)+(ref.priceDate?' \\u00b7 as of '+esc(String(ref.priceDate).slice(0,7)):'')+'</span></div>'
      +   '<div class="dla-anchor-v">'+refUnit+'</div></div>'):'';
    var quote='<div class="dla-quote">'
      +   anchor
      +   '<div class="dla-quote-row">'
      +     '<label class="dla-ql">Your unit price <em>per '+esc(o.unitOfIssue||'unit')+'</em><span class="dla-money"><span>$</span><input id="dlaUnitPrice" type="text" inputmode="decimal" placeholder="'+(refUnit?esc(fmtRef(ref.unitPrice).replace(/[$,]/g,'')):'0.00')+'" oninput="__quoteCalc()"></span></label>'
      +     '<span class="dla-mult">\\u00d7</span>'
      +     '<label class="dla-ql dla-ql-qty">Qty<input id="dlaQty" type="number" min="1" value="'+(o.quantity!=null?esc(String(o.quantity)):'1')+'" oninput="__quoteCalc()"></label>'
      +   '</div>'
      +   '<div class="dla-quote-total"><span>Your quote</span><b id="dlaQuoteTotal" class="empty">Enter a unit price</b></div>'
      + '</div>'
      + '<div class="dla-quote-note"><span class="dot"></span>'
      +   (refUnit
          ? 'The reference is the government\\u2019s catalog price \\u2014 a benchmark, not a live market quote. Price from the RFQ spec and submit on DIBBS.'
          : 'No catalog reference price on file for this NSN. Price from the RFQ spec and submit on DIBBS.')
      + '</div>';
    // ── ACTION BAR (sticky bottom, like the SAM drawer): the primary action is Quote on DIBBS.
    var cta='<div class="oact">'
      + (o.dibbsUrl?'<a class="b pri" href="'+esc(o.dibbsUrl)+'" target="_blank" rel="noopener">Quote on DIBBS \\u2197</a>':'<button class="b pri" onclick="saveCurrentOpp(this)">Save to pursuits</button>')
      + (o.dibbsUrl?'<button class="b" onclick="saveCurrentOpp(this)">Save to pursuits</button>':'')
      // "View RFQ spec" → the RFQ RECORD PAGE (o.dibbsUrl), NOT the direct pdf_url. The stored pdf_url
      // hardcodes the /Archive/ path, which 404s for ACTIVE RFQs ("File was not found" — Eric
      // 2026-08-01). The record page always resolves + links the real spec PDF/attachments.
      + (o.dibbsUrl?'<a class="b" href="'+esc(o.dibbsUrl)+'" target="_blank" rel="noopener">View RFQ spec \\u2197</a>':'')
      + '</div>';
    var upd=relTime(o.syncedAt);
    return '<section class="osec dla-drawer" id="osec-overview">'
      + hero
      + sec('Price to quote', quote, 'quote')
      + sec('Bid facts', facts, 'facts')
      + '<div class="snapfresh"><span class="snapdot"></span>Live from DLA DIBBS'+(upd?' \\u00b7 updated '+upd:'')+' \\u00b7 Solicitation '+esc(o.solicitation||o.id)+'</div>'
      + '</section>'
      + cta;
  }
  // Bid Facts — the Zillow "Facts & features" grid. Real columns from the detail API.
  // Bid facts — the full fact list. Buying-organization (agency/sub-agency/office/PoP) is folded
  // in here (no more duplicate "Buying organization" section), plus attachments/notice links.
  function bidFactsSec(facts,o){
    facts=facts||[];
    // Fold buying-org facts in (dedup: keep the richer versions here, drop any dup from facts).
    var loc=(o.location.city?o.location.city+', ':'')+(o.location.state||o.location.country||'');
    var org=[];
    if(o.department)org.push({k:'Department / agency',v:o.department_display||o.department});
    if(o.subTier)org.push({k:'Sub-agency',v:o.subTier_display||o.subTier});
    if(o.office)org.push({k:'Office',v:o.office});
    // The SINGLE authoritative "(approximate)" location disclosure (Eric 2026-07-26: it lives ONLY
    // in the drawer, never on pins/list/popups). When the location came from the BUYING OFFICE
    // (place of performance not stated), the drawer says so plainly here.
    var popApprox=o.location.source==='office'?' (approximate — based on buying office, place of performance not specified)':'';
    org.push({k:'Place of performance',v:(loc||'Not specified')+popApprox});
    var seen={}; facts.forEach(function(f){ seen[f.k]=1; });
    var merged=facts.concat(org.filter(function(f){ return !seen[f.k]; }));
    var rows=merged.map(function(f){ return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>'; }).join('');
    // Attachments + notice links (merged in from the old separate Docs section).
    var docs=[];
    if(o.additionalInfo&&o.additionalInfo.link)docs.push('<a class="bf-doc" href="'+esc(o.additionalInfo.link)+'" target="_blank" rel="noopener">\\ud83d\\udd17 Additional information</a>');
    if(o.uiLink)docs.push('<a class="bf-doc" href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">\\ud83d\\udd17 View the full notice on SAM.gov</a>');
    (o.attachments||[]).slice(0,20).forEach(function(a){ docs.push(attRow(a,null,'bf-doc')); });
    var docBlock=docs.length?'<div class="bf-docs"><div class="osec-sub">Documents &amp; links</div>'+docs.join('')+'</div>':'';
    // Section 3 — "Opportunity Intelligence": everything about the OPPORTUNITY ITSELF (Eric 2026-08-04:
    // rename Bid Facts → Opportunity Intelligence; contains Scope of Work · Description · Documents ·
    // Solicitation · Attachments · Official Notice). The facts grid (set-aside/NAICS/PSC/notice/dates/
    // place/solicitation) + the documents & links block; the summary + SOW + solicitation contacts render
    // as their own sub-sections right after. Title Case to match the "Market Intelligence" sibling.
    var oiLead='<div class="osec-lead">Everything about the opportunity itself \\u2014 what\\u2019s being requested, the paperwork, and the official notice.</div>';
    return sec('Opportunity Intelligence',oiLead+'<div class="bf-grid">'+rows+'</div>'+docBlock,'facts');
  }
  // AI Analysis (Go/No-Go) — on-demand (it's an LLM call, Pro-gated). Reuses the existing
  // /api/analyst/bid-no-bid engine (PURSUE/WATCH/SKIP + score + why/concerns/next step).
  function aiSec(o){
    // Section 2 of the listing flow — the DECISION, promoted to the hero (Eric 2026-08-02:
    // "Move this ALL THE WAY UP. This becomes your signature feature."). Renamed from
    // "AI analysis" → "Should I pursue this?" with a target/crosshair ICON (Eric 2026-08-05: NO emoji
    // anywhere — use line-art icons; the old target emoji is replaced by an inline lucide-style SVG).
    // NO standalone "run AI analysis" button (Eric 2026-08-04: "you cannot have an ai button on the
    // screen ... remove it"). The section IS the decision card (fillPursue → #pursueBox): the grounded
    // card carries the Bid/No-Bid action in its OWN footer; the no-profile shell shows the structure +
    // a set-up-profile prompt. #aiBox is the on-demand target the card's Bid/No-Bid writes into.
    return sec(ICON_TARGET+' Should I pursue this?',
      '<div id="pursueBox"></div><div id="aiBox"></div>','ai');
  }
  // Render the GROUNDED "Should I Pursue This?" decision card from the win-probability result
  // (recommendation · Why · Risks · Win factors). No LLM — the deep Bid/No-Bid analysis stays behind
  // its own button below. Only renders when grounded (a real profile); otherwise leaves #pursueBox
  // empty and the button carries the section (honest — no fabricated recommendation).
  // UNIVERSAL DNA — "Opportunity Signals" true for EVERY viewer, so the first section after the hero
  // answers "do I have objective reasons to spend time on this?" (Eric 2026-08-04 product call: split
  // DNA into UNIVERSAL opportunity characteristics — shown to all — vs PERSONAL profile-fit — gated
  // behind sign-in). Only GROUNDED signals ship now (never fabricated; a signal appears only when its
  // real flag is true): SB-friendly buyer (pin.sbf = sapBuyerTier 'most' PO-share band), Early in the
  // buying cycle (notice type = Sources Sought/Presol/RFI — the shape-it window), Recompete / Forecast
  // (pin source), Closes soon (deadline ≤7d). NOT shipped yet (would be fabrication): Repeat buyer
  // (needs real agency+NAICS award history) + Posts-early (server has earlySignal but it's not threaded
  // to the client) — both fast-follows. PERSONAL DNA (Fits your NAICS / cert / vehicle / capability fit)
  // is deliberately NOT here — it belongs to the gated Recommendation, because we can't ground it for an
  // anonymous viewer.
  // Short human descriptions for each genome strand KEY (presentation only — the FACT is the strand,
  // computed server-side in genome.ts; this just phrases it). A key with no blurb still renders with
  // its label. (Eric 2026-08-04: Opportunity DNA genome, Phase 1 — drawer render.)
  var DNA_BLURB={
    recompete:'An existing contract coming up for rebid \\u2014 there is an incumbent to unseat.',
    forecast:'Planned work, not yet on SAM \\u2014 position early.',
    sources_sought:'A market-research notice \\u2014 respond to get on the radar before the solicitation.',
    early_cycle:'The requirement is still forming \\u2014 the window to influence it before the RFP.',
    closes_soon:'Closing within a week \\u2014 decide fast.',
    last_chance:'Closing in the next few days \\u2014 last chance to respond.',
    sb_friendly:'This office frequently awards directly to small businesses.',
    repeat_buyer:'This agency buys this work again and again \\u2014 a real, repeated pattern, not a one-off.',
    posts_early:'This office reliably posts Sources Sought / RFI before the RFP \\u2014 time to shape the requirement.',
    set_aside:'Set aside \\u2014 the field is limited to eligible small businesses.',
    full_open:'Full and open \\u2014 anyone can bid; expect broader competition.'
  };
  function pursueSignals(opp,pin){
    // PREFERRED PATH: render the server-computed genome (pin.dna) — ONE source of truth (genome.ts),
    // grounded + no client compute. The drawer is the "show all" surface, so it renders every strand.
    var g=(pin&&Array.isArray(pin.dna))?pin.dna:null;
    var chk='<svg class="psig-ic" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';
    if(g&&g.length){
      var items=g.map(function(st){
        return '<div class="psig"><div class="psig-t">'+chk+esc(st.label)+'</div><div class="psig-d">'+(DNA_BLURB[st.key]||'')+'</div></div>';
      }).join('');
      return '<div class="psig-h">Opportunity signals</div>'
        + '<div class="psig-sub">What we know before looking at your profile.</div>'
        + items;
    }
    // FALLBACK (RECOMPETE/FORECAST pins built client-side carry no server genome): the original
    // hand-built signals so those drawers don't regress until Phase 1.5 grounds them server-side too.
    var s=[];
    var nt=String((opp&&opp.noticeType)||'').toLowerCase();
    if(pin&&pin.sbf)s.push({t:'Small-business friendly buyer',d:'This office frequently awards directly to small businesses.'});
    if(/sources sought|presolicitation|pre-solicitation|request for information|\\brfi\\b/.test(nt))
      s.push({t:'Early in the buying cycle',d:'A '+esc(opp.noticeType)+' \\u2014 the window to influence the requirement before the solicitation.'});
    var src=pin&&pin.src;
    if(src==='RECOMPETE')s.push({t:'Recompete',d:'An existing contract coming up for rebid \\u2014 there is an incumbent to unseat.'});
    else if(src==='FORECAST')s.push({t:'Forecast',d:'Planned work, not yet on SAM \\u2014 position early.'});
    if(opp&&opp.deadline){ var n=Math.ceil((new Date(opp.deadline)-new Date())/86400000);
      if(n!=null&&isFinite(n)&&n>=0&&n<=7)s.push({t:'Closes soon',d:(n===0?'Due today':(n===1?'1 day left':n+' days left'))+' \\u2014 decide fast.'}); }
    if(!s.length)return '';
    return '<div class="psig-h">Opportunity signals</div>'
      + '<div class="psig-sub">What we know before looking at your profile.</div>'
      + s.map(function(x){ return '<div class="psig"><div class="psig-t">'+chk+esc(x.t)+'</div><div class="psig-d">'+x.d+'</div></div>'; }).join('');
  }
  // The stored source_url is PROVENANCE — where the row came from — and for two agencies that is
  // a raw JSON API endpoint (DHS APFS, HHS OSBP). Clicking it dumped an unstyled wall of JSON
  // (Eric 2026-08-13: "the source page is illegible not readable"). Send the reader to that
  // agency's human PORTAL instead and NAME it, so the link says where it goes. The stored value is
  // left untouched — it is the honest provenance record, and rewriting it would lose that.
  //
  // No regex in here on purpose: this block lives inside a template literal, where a regex
  // literal's escapes have to survive two passes. Plain indexOf has nothing to escape.
  function forecastSource(u){
    var url=String(u||''); if(!url)return null;
    var host=''; try{ host=(url.split('//')[1]||'').split('/')[0].toLowerCase(); }catch(e){}
    var isApi=url.indexOf('/api/')>=0;
    var MAP=[
      {h:'apfs-cloud.dhs.gov',portal:'https://apfs-cloud.dhs.gov/',label:'DHS forecast portal (APFS)'},
      {h:'osdbu.hhs.gov',portal:'https://osdbu.hhs.gov/',label:'HHS OSBP forecast'},
      {h:'acquisitiongateway.gov',portal:'',label:'GSA Acquisition Gateway forecast'},
      {h:'secnav.navy.mil',portal:'',label:'Navy long-range acquisition estimate'},
      {h:'onr.navy.mil',portal:'',label:'ONR/NRL long-range acquisition estimate'},
      {h:'energy.gov',portal:'',label:'DOE acquisition forecast'},
      {h:'usace.army.mil',portal:'',label:'USACE forecast'},
      {h:'ssa.gov',portal:'',label:'SSA small business forecast'}
    ];
    var hit=null; for(var i=0;i<MAP.length;i++){ if(host.indexOf(MAP[i].h)>=0){ hit=MAP[i]; break; } }
    // Only swap when the stored URL is an API endpoint. A human page stays exactly as recorded.
    var href=(hit&&hit.portal&&isApi)?hit.portal:url;
    var label=hit?hit.label:(host||'agency procurement forecast');
    // Name the file type when the link DOWNLOADS rather than opens — a click that silently pulls
    // an .xlsx is its own small surprise.
    var low=href.toLowerCase();
    var exts=['.xlsx','.xls','.pdf','.csv'];
    for(var j=0;j<exts.length;j++){ if(low.indexOf(exts[j])>=0){ label+=' ('+exts[j].slice(1).toUpperCase()+')'; break; } }
    return {href:href,label:label};
  }
  function fillPursue(res,oppId,opp,vr,pin){
    var box=document.getElementById('pursueBox'); if(!box)return;
    // Run Bid/No-Bid = the deep AI on the OPPORTUNITY (needs no profile) — the ungated way to get the
    // personalized-style analysis on demand. Runs into #aiBox.
    var bidBtn=oppId?('<button class="pursue-bid" onclick="runAI(\\''+esc(oppId)+'\\')">Run Bid / No-Bid analysis \\u2192</button>'):'';
    // Not grounded → the UNIVERSAL-DNA shell (Eric 2026-08-04): lead with grounded Opportunity Signals
    // (true for everyone), then a CTA that says what the personalized analysis ADDS — NOT empty
    // Why/Risks/Win-factors headers (those read as unfinished). No hero repetition. This is the free
    // tier of a natural value ladder: everyone gets opportunity intelligence; sign-in adds YOUR fit.
    if(!res||!res.grounded||!res.recommendation){
      var expired=res&&res.reason==='session_expired';
      var signedOut=(res&&res.reason==='signed_out')||expired;
      var signals=pursueSignals(opp,pin);
      // Three states, three sentences. The expired one says WHY the app suddenly wants a sign-in,
      // which is the difference between "this is broken" and "oh, my session lapsed".
      var cta=expired
        ? '<a class="pursue-lock-cta" href="/app?next=%2Fopportunity-map" target="_blank" rel="noopener">Your session expired \\u2014 sign in again \\u2192</a>'
        : signedOut
        ? '<a class="pursue-lock-cta" href="/app?next=%2Fopportunity-map" target="_blank" rel="noopener">Sign in for your recommendation \\u2192</a>'
        : '<a class="pursue-lock-cta" href="/app?panel=settings" target="_blank" rel="noopener">Complete your profile for your recommendation \\u2192</a>';
      box.innerHTML='<div class="pursue locked">'
        + (signals?('<div class="pursue-signals">'+signals+'</div>'):'')
        + '<div class="pursue-lock-body">'
        +   '<div class="pursue-unlock">Run the analysis for a <b>Pursue / Watch / Skip</b> call \\u2014 with <b>Why</b>, <b>Risks</b> and <b>Win factors</b>'+(signedOut?' scored against <b>your</b> business.':'.')+'</div>'
        + (bidBtn?'<div class="pursue-cta-row">'+bidBtn+'</div>':'')
        +   '<div class="pursue-signin-line">'+cta+'</div>'
        + '</div>'
        + '</div>';
      return;
    }
    var rec=String(res.recommendation);
    var cls=rec==='Pursue'?'':(rec==='Watch'?' watch':' skip');
    var head=rec==='Pursue'?'Mindy recommends pursuing':(rec==='Watch'?'Mindy says watch this one':'Mindy suggests skipping');
    var chk='<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>';
    var warn='<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
    var why=(res.why||[]).map(function(t){ return '<div class="pursue-li p">'+chk+'<span>'+esc(t)+'</span></div>'; }).join('')
      || '<div class="pursue-li"><span style="color:var(--faint)">No standout strengths yet.</span></div>';
    var risks=(res.risks||[]).map(function(t){ return '<div class="pursue-li r">'+warn+'<span>'+esc(t)+'</span></div>'; }).join('')
      || '<div class="pursue-li"><span style="color:var(--faint)">No major risks flagged.</span></div>';
    var wf=(res.winFactors||[]).length?('<div class="pursue-wf"><b>Win factors:</b> '+(res.winFactors||[]).map(esc).join(' \\u00b7 ')+'</div>'):'';
    box.innerHTML='<div class="pursue'+cls+'">'
      + '<div class="pursue-rec"><span class="pursue-badge">'+esc(rec)+'</span>'
      +   '<div><div class="pursue-rt">'+esc(head)+'</div>'+(res.summary?'<div class="pursue-rs">'+esc(String(res.summary))+'</div>':'')+'</div></div>'
      + '<div class="pursue-grid">'
      +   '<div class="pursue-col"><div class="pursue-cl why">Why</div>'+why+'</div>'
      +   '<div class="pursue-col"><div class="pursue-cl risk">Risks</div>'+risks+'</div>'
      + '</div>'
      + ((wf||bidBtn)?('<div class="pursue-foot">'+wf+bidBtn+'</div>'):'')
      + '</div>';
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
  // GOS invariant #10: always renders — header + a muted placeholder when there are no matches.
  function similarSec(sims){
    // "Related opportunities" — renamed from "Similar opportunities" + moved UP above the action
    // bar (Eric 2026-08-02: Zillow shows "you may also like…" before the paperwork).
    if(!sims||!sims.length)return sec('Related opportunities',empty('No related open opportunities found right now.'),'similar');
    var cards=sims.slice(0,6).map(function(s){
      return '<button class="sim-card" onclick="openOppDrawer(\\''+esc(s.id)+'\\')">'
        + (s.setAside?'<span class="sim-sa">'+esc(s.setAside)+'</span>':'<span class="sim-sa open">Open</span>')
        + '<div class="sim-t">'+esc(s.title)+'</div>'
        + '<div class="sim-ag">'+esc(s.agency||'')+'</div>'
        + '<div class="sim-m">'+esc([s.location,(s.deadline?'due '+s.deadline:'')].filter(Boolean).join(' \\u00b7 '))+'</div>'
        + '</button>';
    }).join('');
    return sec('Related opportunities','<div class="sim-grid">'+cards+'</div>','similar');
  }
  // ── "Ways to win this" — bidirectional cross-sell (the next-move engine) ─────────────────────
  // Connects the two sides of the table: an OPEN opp surfaces the awarded contracts in the SAME
  // NAICS + SAME state (the primes already winning this work → subcontract/teaming targets); an
  // AWARDED contract surfaces the open bids in the same NAICS+state (direct-bid targets). Reuses
  // the .sim-card flywheel. Fetched on-demand from Supabase (NO BigQuery). GOS #10: the section
  // ALWAYS renders — header + a muted "none found" placeholder — so it + its tab never vanish.
  //
  // OPEN → AWARDED. Cards carry the whole row (incumbent/value/agency/expires/naics/state) because
  // the awarded drawer's openRecompeteDrawer() looks rows up in the LOADED map set — a match not
  // in the current viewport wouldn't be found — so we render its drawer straight from card data
  // via openRecompeteFromData(). data-att-payload holds the JSON (no raw onclick arg escaping).
  // meta = { scope, states[], widenedNaics } from /api/app/related-awards (the TIER the fetch had to
  // widen to). It lets the section say honestly WHAT it searched — "related work in DE + nearby" —
  // instead of implying an exact NAICS+state match, and gives the empty state a real reason.
  function subcontractSec(targets,naics,state,meta){
    // "Teaming opportunities" — renamed from the old subcontract-targets label (Eric 2026-08-02);
    // part of the MARKET INTELLIGENCE cluster (what does the market look like — who's already
    // winning this work to team with).
    var head='Teaming opportunities';
    if(!targets||!targets.length){
      // Honest empty: every tier missed. Most often this NAICS is simply not CONTRACTED federally
      // (arts/music/etc. are grant-funded) — say so instead of a dead "no primes" line.
      var body='No prime <b>contracts</b> in NAICS '+esc(naics||'\\u2014')+' near '+esc(state||'\\u2014')+' \\u2014 some work (e.g. arts, research) is funded through <b>grants</b>, not contracts. See <b>Related opportunities</b> below, or the Grants tab.';
      return sec('\\ud83e\\udd1d '+head,empty(body),'subtargets');
    }
    // Describe the tier we actually matched (default to exact).
    var m=meta||{}, sc=m.scope||'exact', sts=(m.states&&m.states.length)?m.states:[state];
    var stateLabel=sts.length>1?(esc(state||'this state')+' + nearby states'):esc(state||'this state');
    var workLabel=m.widenedNaics?'related work':'this work';
    var cards=targets.slice(0,6).map(function(t){
      var payload=encodeURIComponent(JSON.stringify(t));
      var meta2=[mMoney(t.value),(t.agency||''),(t.expires?'expires '+longDate(t.expires):'')].filter(Boolean).join(' \\u00b7 ');
      return '<button class="sim-card" data-xsell="award" data-payload="'+payload+'">'
        + '<span class="sim-sa open">Incumbent</span>'
        + '<div class="sim-t">'+esc(t.incumbent||'Incumbent')+'</div>'
        + '<div class="sim-ag">'+esc(t.agency||'')+'</div>'
        + '<div class="sim-m">'+esc(meta2)+'</div>'
        + '</button>';
    }).join('');
    return sec('\\ud83e\\udd1d '+head+' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">primes already winning this work</span>',
      '<div class="xsell-note">These firms already win '+workLabel+' in '+stateLabel+' \\u2014 team with them as a subcontractor.</div><div class="sim-grid">'+cards+'</div>','subtargets');
  }
  // AWARDED → OPEN. Cards carry a real sam_opportunities notice_id → openOppDrawer(id,true)
  // (force=true fetches the opp detail directly, so it works from recompete map mode).
  function openBidsSec(targets,naics,state){
    var head='Open bids like this';
    if(!targets||!targets.length){
      // ⚠️ SAY WHAT WAS ACTUALLY SEARCHED (Eric 2026-08-15: "you can't find any open bids for that
      // naics 541219"). The search is NAICS **+ STATE**, so an empty result almost always means
      // "none in THIS STATE", not "none anywhere" — measured on the reported card: 541219 had 5
      // open notices nationally and 0 in Indiana. The old copy said "No open opportunities found
      // in NAICS 541219," which reads as an empty product and is simply untrue. It also emitted a
      // dangling comma when the state was blank.
      // Name the state, and give the way out — widening to nationwide is one click.
      var n=esc(naics||''), st=esc(state||'');
      var msg = (n&&st) ? ('No open '+n+' bids in '+st+' right now. The same work is often posted in other states \\u2014 widen the search to see it.')
              : n       ? ('No open '+n+' bids right now \\u2014 check back as new solicitations post.')
              :           'No open bids like this right now \\u2014 check back as new solicitations post.';
      // DATA ATTRIBUTE + delegation, never an inline onclick with escaped quotes — the codebase's
      // own note says "an escaped-quote onclick broke the whole map script once", and the pre-push
      // client-JS syntax check caught this one before it shipped (tsc cannot see inside these
      // strings). Same delegated pattern as data-xsell elsewhere in this drawer.
      var cta = n ? ('<div style="margin-top:10px"><button class="xsell-widen" data-widen="'+n+'">Search '+n+' nationwide \\u2192</button></div>') : '';
      return sec('\\ud83c\\udfaf '+head,empty(msg)+cta,'openbids');
    }
    var cards=targets.slice(0,6).map(function(t){
      var meta=[(t.agency||''),(t.deadline?'due '+longDate(t.deadline):'')].filter(Boolean).join(' \\u00b7 ');
      return '<button class="sim-card" onclick="openOppDrawer(\\''+esc(t.id)+'\\',true)">'
        + (t.setAside?'<span class="sim-sa">'+esc(t.setAside)+'</span>':'<span class="sim-sa open">Open</span>')
        + '<div class="sim-t">'+esc(t.title||'Opportunity')+'</div>'
        + '<div class="sim-ag">'+esc(t.agency||'')+'</div>'
        + '<div class="sim-m">'+esc(meta)+'</div>'
        + '</button>';
    }).join('');
    return sec('\\ud83c\\udfaf '+head+' \\u00b7 <span style="font-weight:400;color:var(--sub);font-size:12px">open bids you could pursue directly</span>',
      '<div class="xsell-note">Open opportunities in the same NAICS + '+esc(state||'state')+' \\u2014 direct-bid targets you could pursue now.</div><div class="sim-grid">'+cards+'</div>','openbids');
  }
  // Widen "Open bids like this" from NAICS+state to NAICS nationwide. Reuses the SAME chip path
  // the Filters panel drives (__naicsChips), so there is one filtering engine, not two.
  // One delegated listener for the widen button (see the data-widen note in openBidsSec).
  document.addEventListener('click',function(ev){
    var b=ev.target&&ev.target.closest?ev.target.closest('[data-widen]'):null;
    if(!b)return;
    ev.preventDefault();
    try{ window.__widenOpenBids(b.getAttribute('data-widen')||''); }catch(e){}
  });
  window.__widenOpenBids=function(naics){
    if(!naics)return;
    try{ if(window.__closeOppDrawer)window.__closeOppDrawer(); }catch(e){}
    try{
      if(window.__naicsChips&&window.__naicsChips.set){ window.__naicsChips.set([naics]); }
      if(window.__applySearchFilters){ window.__applySearchFilters({naics:[naics]}); return; }
      if(window.__mapRefetch)window.__mapRefetch();
    }catch(e){}
  };
  // Open the awarded drawer from a subcontract-target card's payload (the row isn't in the loaded
  // map set, so we synthesize the recompete row and render its drawer directly). Delegated onclick
  // (data-xsell) avoids escaping a JSON blob through an inline onclick arg.
  window.openRecompeteFromData=function(t){
    if(!t)return;
    var o={ src:'RECOMPETE', title:t.incumbent||'Incumbent', cat:'', agency:t.agency||'', subAgency:t.subAgency||'', naics:t.naics||'',
      set:'None', value:mMoney(t.value)||'', exp:t.expires||'', loc:t.state||'', state:t.state||'',
      sol:'', nid:String(t.id||''), locSrc:'office', uei:null };
    if(window.__resetOppSave)window.__resetOppSave();
    dr.classList.remove('buyer-accent');
    if(typeof clearTaskOrderPins==='function')clearTaskOrderPins();
    body.innerHTML=recompeteRender(o);
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    buildTabs();
    loadRecompeteIntel(o); // agency intel + pricing + BD roster (fail-soft)
    loadCrossSellOpen(o);  // and its OWN "open bids like this" (awarded→open flywheel)
  };
  // Reused-intelligence sections (predecessor history / agency intel / pricing) — filled by
  // a second on-demand fetch (?intel=1). Placeholder shows a subtle "loading intel" line.
  function ul(items){ return '<ul class="bf-ul">'+items.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'; }
  function fmtM(n){ if(typeof n!=='number'||n<=0)return '\\u2014'; return n>=1e9?('$'+(n/1e9).toFixed(1)+'B'):n>=1e6?('$'+(n/1e6).toFixed(1)+'M'):('$'+Math.round(n).toLocaleString()); }
  // M-Estimate(TM) distribution chart — plain CSS bars scaled to bucket counts, from the SAME
  // comparable-award set as the median/band. The bucket containing the median gets the highlight
  // class so the user sees where THIS opp\'s estimate sits among real comparable awards. Never
  // renders anything (returns '') when the histogram is absent — a missing/pre-migration RPC must
  // degrade to the percentile-only display, never a fake or empty-looking chart.
  function vrChart(dist,median){
    if(!dist||!dist.length)return '';
    var max=0; for(var i=0;i<dist.length;i++){ if(dist[i].count>max)max=dist[i].count; }
    if(!max)return '';
    var bars=dist.map(function(b){
      var pct=Math.max(4,Math.round(b.count/max*100));
      var isMk=(typeof median==='number')&&median>=b.min&&median<=b.max;
      return '<div class="vr-bar'+(isMk?' mk':'')+'" style="height:'+pct+'%" title="'+esc(fmtM(b.min))+'\\u2013'+esc(fmtM(b.max))+': '+esc(String(b.count))+' awards"></div>';
    }).join('');
    return '<div class="vr-chart-lab">Where similar awards landed</div><div class="vr-chart">'+bars+'</div>';
  }
  // M-Estimate(TM) VALUE-HISTORY timeline (#88) — median award $ per YEAR from opp_value_timeline
  // (the SAME comparable set as the band). Plain CSS bars on a time axis, so the user sees whether
  // this work is trending up or down. Real medians only — returns '' when absent (pre-migration /
  // thin), never a fabricated trend. Needs >=2 years to be a "history" (enforced server-side too).
  function vrTimeline(tl){
    if(!tl||tl.length<2)return '';
    var max=0; for(var i=0;i<tl.length;i++){ if(tl[i].median>max)max=tl[i].median; }
    if(!max)return '';
    var bars=tl.map(function(p){
      var pct=Math.max(6,Math.round(p.median/max*100));
      return '<div class="vt-col" title="'+esc(String(p.year))+': median '+esc(fmtM(p.median))+' \\u00b7 '+esc(String(p.n))+' award'+(p.n===1?'':'s')+'">'
        + '<div class="vt-bar" style="height:'+pct+'%"></div><div class="vt-yr">\\u2019'+esc(String(p.year).slice(2))+'</div></div>';
    }).join('');
    return '<div class="vr-chart-lab">Median award value by year</div><div class="vt-chart">'+bars+'</div>';
  }
  // M-Estimate(TM) DATED COMPS (#88) — the actual comparable awards behind the estimate (the "nearby
  // sold homes" list), from opp_value_comps. Each row is a REAL award: winner · $ · year · buying
  // sub-agency. Returns '' when absent — never invents a comp.
  function vrComps(comps){
    if(!comps||!comps.length)return '';
    var rows=comps.slice(0,8).map(function(c){
      var yr=c.awardDate?('\\u2019'+esc(String(c.awardDate).slice(2,4))):'';
      var who=esc(c.incumbent||'Undisclosed');
      var sub=c.subAgency?('<span class="vc-sub">'+esc(c.subAgency)+'</span>'):'';
      return '<div class="vc-row"><div class="vc-main"><span class="vc-who">'+who+'</span>'+sub+'</div>'
        + '<div class="vc-meta"><span class="vc-val">'+esc(fmtM(c.value))+'</span>'+(yr?'<span class="vc-yr">'+yr+'</span>':'')+'</div></div>';
    }).join('');
    return '<div class="vr-chart-lab" style="margin-top:14px">Comparable awards</div><div class="vc-list">'+rows+'</div>';
  }
  // SOW card facts (Tier 1) — the full extracted set, in the drawer. The card/popup already show
  // the 2 highest-signal facts (brand-name pill, eval-basis chip) via cap-the-view; this section
  // adds the set-aside-from-text + mismatch flag + the verbatim evidence spans, so a user can
  // verify every fact against the SOW's own words ([[ground_in_real_data]] — never fabricated).
  var EVAL_LABEL={best_value:'Best Value',lpta:'LPTA (Lowest Price Technically Acceptable)',tradeoff:'Best Value Trade-off'};
  function cardFactsSec(cf){
    if(!cf)return '';
    var rows=[];
    if(cf.brandNameOrEqual)rows.push({k:'\\ud83d\\udea9 Brand-name / or-equal',v:cf.brandName?('Named brand: '+cf.brandName):'Yes (see evidence)'});
    if(cf.evalBasis)rows.push({k:'Evaluation basis',v:EVAL_LABEL[cf.evalBasis]||cf.evalBasis});
    if(cf.setAsideFromText)rows.push({k:'Set-aside (from SOW text)',v:cf.setAsideFromText+(cf.setAsideMismatch?' \\u26a0 differs from the posted set-aside code':'')});
    if(!rows.length)return '';
    var grid='<div class="bf-grid">'+rows.map(function(f){return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>';}).join('')+'</div>';
    var ev=cf.evidence||{};
    var quotes=[ev.brandName,ev.evalBasis,ev.setAside].filter(Boolean);
    var quoteBlock=quotes.length?'<div class="osec-sub">From the SOW text</div>'+quotes.map(function(q){return '<div class="sow-quote">\\u201c'+esc(q)+'\\u201d</div>';}).join(''):'';
    return sec('SOW facts \\u00b7 what the solicitation itself says',grid+quoteBlock,'sowfacts');
  }
  // ── M-Estimate™ — the PRICE, split Zillow-style ─────────────────────────────────────────────
  // Zillow puts the PRICE at the very top of the detail page (big, first), and the METHODOLOGY
  // (the Zestimate history / how-it's-computed) lower. We mirror that: mEstTopHTML() is the big
  // number ALONE that renders at the TOP of the drawer (a #mEstTop slot right under the header);
  // mEstMethodologyHTML() is the "Project value" section (number + range + distribution chart +
  // methodology, together) that renders LOWER. Both are filled by the on-demand intel fetch.
  // GOS #10: the TOP price header ALWAYS renders (even with no estimate) — never hidden.
  function mEstBasis(vr){
    var isPred=vr&&vr.source==='predecessor';
    var nCompStr=(vr&&!isPred&&vr.label)?String(vr.label).match(/^(\\d[\\d,]*)/):null;
    return isPred?'the prior contract for this requirement':(nCompStr?nCompStr[1]+' comparable federal awards':'comparable federal awards');
  }
  // TOP price header — the SINGLE headline number ALONE (Zillow puts the price alone at the top;
  // the range + chart + methodology all live together in the "Project value" section below). No band,
  // no disclaimer here — just the M-Estimate number under its label. No estimate ({none:true}/no
  // median) → a prominent, never-hidden "No estimate" line under the same label.
  // pinEst (optional) = the median the CLICKED PIN/CARD already shows (the canonical row's
  // intel_value_range.median, in client hand at open time). When present it is the AUTHORITATIVE
  // headline number, so the pin, the rail card, and the drawer hero are ALWAYS the same figure
  // (Eric 2026-08-04: "why can't you use the same number on both"). The fetched vr then supplies only
  // the band + comparable-count subtext — never a different big number. If the fetch's own median
  // disagrees (a mid-session recompute), the pin's value wins the headline; the band still comes from
  // the fetch (same notice, same market — the band is around the same estimate).
  function mEstTopHTML(vr,pinEst){
    // Carries id=osec-value so the "Value" sticky tab always targets the price at the TOP (the
    // Project-value section below uses its own id). GOS #10: always rendered, never hidden.
    // HEADLINE + BAND MUST COME FROM THE SAME OBJECT (Eric 2026-08-04: a card showed "$898,136 ·
    // Likely $25.2M–$34.0M" — the headline was the pin est while the band was the fetched predecessor
    // estimate, two DIFFERENT sources → a number outside its own range). So: when the fetch returned a
    // real valueRange, ITS median is authoritative (headline + band + basis all from vr — always
    // coherent). pinEst is ONLY the instant placeholder shown BEFORE the fetch resolves (no
    // "Estimating…" flash); once vr arrives it takes over entirely.
    var headline=(vr&&vr.median)?vr.median:((typeof pinEst==='number'&&pinEst>0)?pinEst:0);
    if(headline){
      // The likely band + comparable-award basis ride the hero card now (Eric 2026-08-04, artifact
      // hero: "Likely $6.9M–$9.4M · 24 comparable federal awards"). Both are REAL data from the intel
      // fetch — vr.low/vr.high for the band, mEstBasis(vr) for the "N comparable federal awards" (or
      // "the prior contract" for a predecessor-sourced estimate). Shown only when present, never faked.
      var band=(vr&&vr.low&&vr.high)?('Likely '+esc(fmtM(vr.low))+'\\u2013'+esc(fmtM(vr.high))):'';
      var basis=vr?esc(mEstBasis(vr)):'';
      var sub=[band,basis].filter(Boolean).join(' \\u00b7 ');
      return '<div class="vrange vrange-top" id="osec-value">'
        + '<div class="vr-label">M-Estimate<span class="vr-tm">\\u2122</span></div>'
        + '<div class="vr-big">'+esc(fmtM(headline))+'</div>'
        + (sub?'<div class="vr-band">'+sub+'</div>':'')
        + '</div>';
    }
    return '<div class="vrange vrange-top vrange-none" id="osec-value">'
      + '<div class="vr-label">M-Estimate<span class="vr-tm">\\u2122</span></div>'
      + '<div class="vr-none-msg">No estimate \\u2014 too few comparable federal awards for this NAICS to estimate reliably.</div>'
      + '</div>';
  }
  // LOWER "Project value" section — the Zillow "Home value" block: the M-Estimate number + likely
  // RANGE + the distribution CHART + the methodology, ALL TOGETHER (Zillow keeps Zestimate + sales
  // range + history chart + "What is this number?" in one block). Zillow computes a HOME value; we
  // compute a PROJECT value. Returns '' when there's no estimate (nothing to chart — the top header
  // already said why). GOS #10 otherwise renders the full block.
  // MARKET INTELLIGENCE lead + M-Estimate DETAIL — the Zillow price-history pattern for GovCon (Eric
  // 2026-08-04 mockup: "Value history — this requirement over time … what this buyer paid on comparable
  // awards"). This section IS the Market Intelligence group header (osec-mest) — it leads the market
  // cluster (Contract history · Market pricing follow). GROUNDED-ONLY: the M-Estimate number + likely
  // band + N comps (vr), the DISTRIBUTION chart (vrChart = comparable-award values by SIZE, from
  // opp_value_histogram), the VALUE-HISTORY timeline (vrTimeline = median $ per year, opp_value_timeline)
  // and the DATED COMPS list (vrComps = the real awards behind the estimate, opp_value_comps) — all the
  // SAME comparable set (#88 built the two per-award RPCs). Plus ONE incumbent comp chip (pred =
  // intel.predecessor). Every detail degrades to '' when its RPC is absent/thin — never fabricated. No
  // estimate → an honest header + "no comparable awards" line (never a fabricated chart).
  function mEstMethodologyHTML(vr,pred){
    var lead='<div class="osec-lead">What does the market look like? \\u2014 what this buyer has paid on comparable awards, who holds the work now, and what it pays.</div>';
    if(!(vr&&vr.median)){
      return sec('Market Intelligence',lead
        + '<div class="osec-empty">Not enough comparable federal awards for this NAICS to build a value estimate yet.</div>','mest');
    }
    var isPred=vr.source==='predecessor';
    var howBody=isPred
      ? 'This estimate is anchored on the prior contract for this same requirement \\u2014 the strongest real-world comparison available. It is Mindy\\u2019s own estimate, built with our proprietary model, and updates as new award data comes in. It is NOT the government\\u2019s estimate (IGCE) or a solicited value.'
      : 'M-Estimate\\u2122 is Mindy\\u2019s own estimate \\u2014 built from thousands of real, comparable federal awards for similar work, using our proprietary model. It reflects the typical contract size for this kind of requirement, grounded in public USASpending award history, and updates as new awards data comes in. It is NOT the government\\u2019s estimate (IGCE) or a solicited value.';
    // The number is REPRINTED here (Eric 2026-08-04: "put M-estimate detail info with number back down
    // there") — the hero has the headline; this is the detailed market context. Band + N comps beside it.
    var comps=(vr.n?(vr.n+' comparable award'+(vr.n===1?'':'s')):'');
    var numLine='<div class="mest-num"><span class="mest-apx">\\u2248</span> '+esc(fmtM(vr.median))+'</div>'
      + '<div class="mest-band">'+((vr.low&&vr.high)?('Likely '+esc(fmtM(vr.low))+'\\u2013'+esc(fmtM(vr.high))):'')+(comps?((vr.low&&vr.high?' \\u00b7 ':'')+comps):'')+'</div>';
    // Incumbent as a real comp chip (from intel.predecessor) — the one dated comp we CAN ground.
    var chips='';
    if(pred&&(pred.incumbent||pred.value)){
      var parts=[];
      if(pred.value)parts.push(esc(pred.value));
      if(pred.incumbent)parts.push(esc(pred.incumbent));
      parts.push('incumbent'+(pred.expires?' \\u00b7 expires '+esc(String(pred.expires).slice(0,7)):''));
      chips='<div class="mest-comps"><div class="mest-comp">'+parts.join(' \\u00b7 ')+'</div></div>';
    }
    return sec('Market Intelligence',lead
      + '<div class="vrange">'
      + '<div class="mest-hd">Value history \\u2014 this requirement</div>'
      + '<div class="mest-sub">What this buyer has paid on comparable awards \\u2014 the market behind the M-Estimate\\u2122.</div>'
      + numLine
      + vrChart(vr.distribution,vr.median)
      + '<div class="mest-chart-cap">Where comparable awards land by contract size.</div>'
      + vrTimeline(vr.timeline)
      + vrComps(vr.comps)
      + chips
      + '<div class="vr-disclaimer" style="margin-top:8px;border-top:0;padding-top:2px">Mindy\\u2019s estimate from '+esc(mEstBasis(vr))+' \\u2014 not a government figure (IGCE) or a solicited value.'
      + '<div class="vr-how"><button class="vr-how-toggle" onclick="var o=this.nextElementSibling.classList.toggle(\\'open\\');this.textContent=(o?\\'\\u25be \\':\\'\\u25b8 \\')+\\'How we calculate this\\';">\\u25b8 How we calculate this</button>'
      + '<div class="vr-how-body">'+esc(howBody)+'</div></div></div></div>','mest');
  }
  // Fill the TOP price slot (#mEstTop) — always, even with no estimate (GOS #10, never hidden).
  // pinEst (optional) = the number the clicked pin/card shows; when passed it's the authoritative
  // headline so the drawer can never disagree with the pin (see mEstTopHTML).
  function fillMEstTop(vr,pinEst){ var el=document.getElementById('mEstTop'); if(el)el.innerHTML=mEstTopHTML(vr,pinEst); }
  // M-Win™ hero card. GROUNDED: a real number ONLY when the win-probability API returns
  // grounded:true (computed from the signed-in user's real profile). Otherwise an honest "Complete
  // profile to unlock M-Win" locked card — NEVER a fabricated %. (Eric 2026-08-04, [[ground_in_real_data]].)
  function mWinTopHTML(res){
    if(res&&res.grounded&&typeof res.score==='number'){
      var pct=Math.round(res.score);
      var sub=res.summary?esc(String(res.summary)):(res.tier?('Win-probability \\u00b7 '+esc(String(res.tier))+' fit'):'Win-probability');
      return '<div class="mwin">'
        + '<div class="vr-label">M-Win<span class="vr-tm">\\u2122</span></div>'
        + '<div class="mw-big">'+pct+'%</div>'
        + '<div class="mw-sub">'+sub+'</div>'
        + '</div>';
    }
    // Honest locked state — no personalized number without a profile.
    return '<div class="mwin locked">'
      + '<div class="vr-label">M-Win<span class="vr-tm">\\u2122</span></div>'
      + '<div class="mw-lock">Complete your profile to unlock M-Win</div>'
      + '<a class="mw-cta" href="/app?panel=settings" target="_blank" rel="noopener">Set up your profile \\u2192</a>'
      + '</div>';
  }
  function fillMWinTop(res){ var el=document.getElementById('mWinTop'); if(el)el.innerHTML=mWinTopHTML(res); }
  // Fetch the branded M-Win for THIS opp + the signed-in user (fail-soft, never blocks the hero).
  // amount = the M-Estimate median (a real number) when we have it, for the size-fit factor.
  // True only when the token's own exp says it has lapsed. Deliberately conservative: a token we
  // cannot decode returns FALSE, so a parsing quirk can never accuse a signed-in user of being
  // logged out — the server stays the authority, this only picks better words.
  // Defined in VIEWPORT_JS as window.__tokenExpired (a DIFFERENT <script> IIFE cannot see a
  // local), so the drawer and the telemetry tracker share ONE definition of "expired".
  var tokenExpired = (typeof window.__tokenExpired === 'function')
    ? window.__tokenExpired
    : function(){ return false; };
  // ── Upcoming events for THIS opportunity (industry day / pre-bid / site visit) ───────────────
  // Fills #oppEventsSlot. SELF-HIDING: renders nothing unless a real UPCOMING event matches, so a
  // notice with no event shows no empty box (a dead "No events" state is worse than silence).
  // The API is best-match (notice → office → agency) and upcoming-ONLY — an expired event never
  // reaches this surface (Eric: "show only information that helps the user act today").
  function loadOppEvents(opp){
    var slot=document.getElementById('oppEventsSlot'); if(!slot||!opp)return;
    var q=[];
    // opportunity-detail maps the DB notice id onto the opp's id field, so THAT is the notice key
    // here. Reading a notice_id / noticeId property silently yielded undefined and dropped the
    // whole tier-1 match to the office fallback — caught by the live browser check, not by any
    // unit test.
    if(opp.id)q.push('noticeId='+encodeURIComponent(opp.id));
    // The buying-office DoDAAC is the meaningful middle tier (the agency string is department-level
    // for most DoD notices) — derive it from the solicitation prefix, same key the roster uses.
    // NOTE: read the short field names only. The pursue-actions guard asserts this file never
    // contains the underscored spelling (user_pipeline has no such column) — a blunt file-wide
    // string check, so even a READ of that name trips it. The short field carries the same value.
    var sol=String(opp.solicitation||opp.sol||'');
    if(/^[A-Z][A-Z0-9]{5}/.test(sol))q.push('dodaac='+encodeURIComponent(sol.slice(0,6)));
    if(opp.department)q.push('agency='+encodeURIComponent(opp.department));
    if(!q.length)return;
    var ch={}; try{ var tk=localStorage.getItem('mi_beta_auth_token')||''; if(tk)ch['x-mi-auth-token']=tk; }catch(e){}
    fetch('/api/app/opportunity-events?'+q.join('&'),{headers:ch})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d||!d.success||!d.events||!d.events.length)return;   // honest empty → render nothing
        var s=d.summary||{};
        var rows=d.events.map(function(e){
          var when=e.event_date?new Date(e.event_date+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'Date TBD';
          var kind=String(e.event_type||'').replace(/_/g,' ');
          return '<div class="evrow"><div class="evwhen">'+esc(when)+'</div>'
            + '<div class="evmain"><div class="evtitle">'+esc(e.title||'Event')+'</div>'
            + '<div class="evmeta">'+esc(kind)+(e.location?' \\u00b7 '+esc(e.location):'')+'</div></div></div>';
        }).join('');
        // The match label is REQUIRED, never decorative: it is how the user knows whether this is
        // their solicitation's own event or a department-wide one.
        var head='<div class="evhead"><span class="evcount">'+esc(s.headline||'Upcoming event')+'</span>'
          + '<span class="evwhy">'+esc(d.matchLabel||'')+'</span></div>';
        var body=head+'<div class="evlist'+(d.events.length>1?' evmany':'')+'">'+rows+'</div>';
        slot.innerHTML=sec('Upcoming events',body,'events');
        if(typeof buildTabs==='function')buildTabs();   // a new section appeared → retab
      }).catch(function(){ /* silent: events are additive, never block the drawer */ });
  }
  function loadMWin(opp,vr,pin){
    var em='',tk=''; try{ em=_uemail(); tk=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
    // Gate on the TOKEN, not the decoded email (Eric 2026-08-04 bug: a signed-in user saw the
    // sign-in shell). _uemail() decodes the wrong JWT segment and can return '' even with a valid
    // token — so gating on the decoded email short-circuited authed users to signed-out. The route
    // now derives the email server-side from the verified token, so a token is enough to fetch.
    // pin carries the UNIVERSAL DNA (sbf/src) the pursue shell shows to everyone.
    // NO token = a genuine visitor. An EXPIRED token = a lapsed session, and those deserve
    // different words: "Sign in for your recommendation" reads as a marketing gate to someone who
    // believes they are still logged in (Eric 2026-08-13: "this says sign in but we are already
    // logged in"). Decode exp locally — cheap, and it needs no round trip to tell them the truth.
    if(!tk){ fillMWinTop({grounded:false}); fillPursue({grounded:false,reason:'signed_out'},opp&&opp.id,opp,vr,pin); return; }
    if(tokenExpired(tk)){ fillMWinTop({grounded:false}); fillPursue({grounded:false,reason:'session_expired'},opp&&opp.id,opp,vr,pin); return; }
    var qs='email='+encodeURIComponent(em||'')   // email is a HINT only now; the route verifies via the token
      + '&naics='+encodeURIComponent(opp.naics||'')
      + '&agency='+encodeURIComponent(opp.agency||opp.department||'')
      + '&setAside='+encodeURIComponent(opp.setAside||opp.set||'')
      + '&title='+encodeURIComponent((opp.title||'').slice(0,140))
      + (vr&&vr.median?'&amount='+encodeURIComponent(vr.median):'');
    var ch={}; if(tk)ch['x-mi-auth-token']=tk; if(em)ch['x-user-email']=em;
    fetch('/api/app/win-probability?'+qs,{headers:ch})
      .then(function(r){return r.json();})
      .then(function(res){ fillMWinTop(res||{grounded:false}); fillPursue(res||{grounded:false},opp&&opp.id,opp,vr,pin); }) // M-Win hero + the Should-I-Pursue card (same fetch)
      .catch(function(){ fillMWinTop({grounded:false}); fillPursue({grounded:false},opp&&opp.id,opp,vr,pin); });   // error → the shell (Opportunity Signals + Bid/No-Bid), never a fake %
  }
  // GOS invariant #10: the drawer has the SAME skeleton every time — the intel sections (Contract
  // history · Know your buyer · Pricing + the M-Estimate methodology) ALWAYS render, with a header +
  // a muted placeholder when the data is absent, so nothing vanishes and buildTabs() is constant.
  // renderIntel is called with the intel payload on success, or {} on a fetch miss/failure — either
  // way it emits every section. Placeholders are honest ("not available"), never a fake number.
  // NOTE: the M-Estimate BIG NUMBER is NOT here — it lives in the top #mEstTop slot (fillMEstTop);
  // renderIntel emits the LOWER methodology section instead (Zillow: price up top, method lower).
  function renderIntel(intel){
    intel=intel||{};
    var out='';
    var vr=intel.valueRange;
    var p=intel.predecessor;
    // MARKET INTELLIGENCE lead = the M-Estimate DETAIL block (Eric 2026-08-04: "put M-estimate detail
    // info with number back down there … we can show it like this" — the Zillow value-history mockup).
    // It IS the Market Intelligence group header (osec-mest), anchoring the Market tab, and leads the
    // cluster; Contract history + Market pricing render right after. Number reprinted here + distribution
    // chart + the incumbent comp chip (real). GROUNDED-only (no faked timeline — fast-follow #88).
    out+=mEstMethodologyHTML(vr,p);
    if(p&&(p.incumbent||p.value)){
      var facts=[];
      if(p.incumbent)facts.push({k:'Likely incumbent',v:p.incumbent+(p.incumbentState?' ('+p.incumbentState+')':'')});
      if(p.value)facts.push({k:'Prior contract value',v:p.value});
      if(p.expires)facts.push({k:'Expires',v:p.expires});
      if(p.vehicle)facts.push({k:'Vehicle / parent IDV',v:p.vehicle});
      if(p.confidence)facts.push({k:'Match confidence',v:p.confidence});
      out+=sec('Contract history \\u00b7 who holds this now','<div class="bf-grid">'+facts.map(function(f){return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>';}).join('')+'</div>','incumbent');
    } else {
      out+=sec('Contract history \\u00b7 who holds this now',empty('No incumbent identified for this requirement \\u2014 no clear predecessor award in USASpending.'),'incumbent');
    }
    // "Market pricing" — renamed from "Pricing intel" (Eric 2026-08-02). Stays in the MARKET
    // INTELLIGENCE cluster (what the market looks like), directly after Contract history.
    var pr=intel.pricing;
    if(pr&&pr.rates&&pr.rates.length){
      out+=sec('Market pricing \\u00b7 what vendors charge here',rateChart(pr.rates)+(pr.summary?'<div class="ai-note">'+esc(pr.summary)+'</div>':''),'pricing');
    } else {
      out+=sec('Market pricing \\u00b7 what vendors charge here',empty('Pricing data not available for this NAICS.'),'pricing');
    }
    // Section 5 — BUYER INTELLIGENCE (who do I know?). Agency priorities + known pain points;
    // the decision-makers roster (loadRoster) appends after this. Renamed from "Know your buyer".
    var a=intel.agency;
    if(a&&((a.painPoints&&a.painPoints.length)||(a.priorities&&a.priorities.length))){
      var inner='';
      if(a.priorities&&a.priorities.length)inner+='<div class="ai-lab">Agency priorities</div>'+ul(a.priorities);
      if(a.painPoints&&a.painPoints.length)inner+='<div class="ai-lab">Known pain points</div>'+ul(a.painPoints);
      out+=sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',inner,'agencyintel');
    } else {
      out+=sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',empty('Agency intel not available for this buyer.'),'agencyintel');
    }
    return out;
  }
  // OTHER agency contacts to network with (BD roster) — NOT the solicitation POCs. Fetches the
  // agency's people from /api/app/federal-contacts (MI-token authed) and appends to the intel block.
  // GOS invariant #10: the section ALWAYS renders (header + a muted placeholder when there's no
  // agency / not signed in / no contacts) so it never vanishes and its tab stays constant.
  function rosterPlaceholder(box,msg){
    if(!box||document.getElementById('osec-roster'))return; // don't double-append
    box.insertAdjacentHTML('beforeend',sec('Decision makers \\u00b7 who to network with',empty(msg),'roster')); buildTabs();
  }
  function loadRoster(agency,boxId){
    var box=document.getElementById(boxId||'intelBox'); if(!box)return;
    if(!agency){ rosterPlaceholder(box,'No agency on this notice to look up contacts for.'); return; }
    var t=null,em=''; try{ t=localStorage.getItem('mi_beta_auth_token'); }catch(e){}
    try{ var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    if(!t||!em){ rosterPlaceholder(box,'Sign in to see other contacts at this agency.'); return; } // roster is a signed-in feature
    fetch('/api/app/federal-contacts?agency='+encodeURIComponent(agency)+'&limit=6&email='+encodeURIComponent(em),{headers:{'x-mi-auth-token':t,'x-user-email':em}})
      .then(function(r){return r.json();}).then(function(d){
        var list=(d&&(d.contacts||d.results))||[]; if(!list.length){ rosterPlaceholder(box,'No additional contacts found at '+esc(agency)+'.'); return; }
        var cards=list.slice(0,6).map(function(c){
          var nm=c.contact_fullname||c.name||'Contact', ti=c.contact_title||c.title||'', mail=c.contact_email||c.email||'', ph=c.contact_phone||c.phone||'';
          return '<div class="roster-card"><div class="nm">'+esc(nm)+'</div>'+(ti?'<div class="ti">'+esc(ti)+'</div>':'')
            + '<div class="row">'+(mail?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> <a href="mailto:'+esc(mail)+'">'+esc(mail)+'</a>':'')+(mail&&ph?' \\u00b7 ':'')+(ph?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg> '+esc(ph):'')+'</div></div>';
        }).join('');
        var html=sec('Decision makers \\u00b7 who to network with','<div class="roster-note">People at '+esc(agency)+' to build a relationship with (beyond this notice\\u2019s POC).</div><div class="roster-grid">'+cards+'</div>','roster');
        box.insertAdjacentHTML('beforeend',html); buildTabs();
      }).catch(function(){ rosterPlaceholder(box,'Couldn\\u2019t load other contacts right now.'); });
  }
  // Build the sticky tab bar from the sections that are actually present (id → label).
  function buildTabs(){
    var tabs=document.getElementById('oppTabs'); if(!tabs)return;
    // The tab bar = the 9-question decision flow (Eric 2026-08-03: "every section answers exactly
    // ONE user question; if two sections answer the same one, merge them"). ONE tab per question —
    // NOT one tab per DB table. Each tab's id is the FIRST osec- anchor of its group (the scroll
    // target); sub-parts (Summary/Scope, Contract history/Pricing) are HEADINGS inside, never tabs.
    // The label is the QUESTION's answer, not the table name. Each group lists candidate anchors
    // most-preferred first; the FIRST one present in the DOM wins that group's single tab, so a
    // group still shows if its lead section is absent. Order here MUST match the render() emit order.
    // FINAL decision-workspace order (Eric 2026-08-04 canonical spec): the capture manager's mental
    // flow — Understand → Decide → Research → Know the buyer → Browse → Execute. RELATED sits ABOVE
    // "Win This Contract" (Eric FINAL: "Don't bury these … keeps people browsing" — Related is the
    // retention row you scan before committing to the proposal workspace). "Next Actions" is NOT a tab
    // — it's the STICKY bottom bar (osec-actions), independent of scroll — so it's absent from this list.
    var groups=[
      [['overview','value'],'Snapshot'],           // 1. What is this?
      [['ai'],'Should I pursue?'],                 // 2. Is it worth chasing?
      [['facts','description','sow','sowfacts','fcdesc'],'Opportunity'], // 3. What's being requested? (fcdesc = forecast "What they need")
      [['mest','incumbent','pricing','taskorders','fcmkt'],'Market'],   // 4. What does the market look like? (fcmkt = forecast value + incumbent)
      [['agencyintel','contacts','roster','fcpoc'],'Buyer'], // 5. Who am I selling to? (fcpoc = forecast POC; Decision makers are sub-parts of Buyer Intelligence)
      [['subtargets','openbids'],'Teaming'],       // 6. Who can help me win this? (comes BEFORE Related — Eric 2026-08-04)
      [['similar','fcwin'],'Related'],             // 7. What else should I look at? (fcwin = forecast "Prepare to win" sits in this slot for the forecast drawer)
      // Company drawer — one tab per section (already single-question each)
      [['agencies'],'Agencies'],[['naics'],'NAICS'],[['setasides'],'Set-asides'],[['awards'],'Awards'],
      // Gov Buyer drawer
      [['buyeropps'],'Opportunities'],[['buyeragency'],'Agency'],[['buyercontact'],'Contact'],[['buyersimilar'],'Similar buyers'],[['buyerroster'],'Players']];
    // Resolve each group to the first anchor that's actually in the DOM → one tab, or skip the group.
    var want=[]; groups.forEach(function(g){ var ids=g[0]; for(var i=0;i<ids.length;i++){ if(document.getElementById('osec-'+ids[i])){ want.push([ids[i],g[1]]); return; } } });
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
    // ── The LISTING decision-flow (Eric 2026-08-02) ────────────────────────────────────────────
    // The drawer reads like a movie of the contractor's bid decision, not a dump of DB tables:
    //   1. OPPORTUNITY OVERVIEW  — what is this? (hero: title, M-Estimate PRICE, badges, place)
    //   2. SHOULD I PURSUE THIS? — is it worth it? (the AI Go/No-Go, promoted to the hero decision)
    //   3. OPPORTUNITY INTELLIGENCE — what do I need to know? (bid facts + description + scope + docs)
    //   4. MARKET INTELLIGENCE   — what's the market? (M-Est methodology + incumbent + pricing + teaming)  [async #intelBox + #xsellSub]
    //   5. BUYER INTELLIGENCE    — who do I know? (agency intel + decision makers + roster)               [async, appended into #intelBox]
    //   6. RELATED OPPORTUNITIES — "you may also like…" (moved UP, above the paperwork)
    //   7. WIN THIS CONTRACT     — how do I win? (the proposal workspace CTA)
    // Each section answers exactly ONE question. Zillow's price-at-top: the M-Estimate PRICE leads
    // (a #mEstTop slot filled by the intel fetch — GOS #10 always populates it). The lower "Estimated
    // value" methodology/chart lives inside MARKET INTELLIGENCE (renderIntel → #intelBox), never
    // duplicating the top number.
    // The 9-question decision flow (Eric 2026-08-03 — "every section answers exactly one user
    // question"). ONE section per question, in the order a contractor's brain evaluates a bid:
    //   1 Overview → 2 Should I pursue → 3 Opportunity → 4 Market → 5 Buyer → 6 Decision makers →
    //   7 Teaming → 8 Related → 9 Win. The notice POC lives WITH the roster in Decision makers (#6),
    //   not mid-drawer; Market+Buyer+Decision-makers stream into #intelBox in that exact order.
    // HERO ORDER (Eric 2026-08-04): Title FIRST, then the M-Estimate, THEN the key-facts box.
    // The #mEstTop slot sits INSIDE the overview section, right under the title — the whole hero is
    // still ONE section (id=osec-overview) so the "Snapshot" tab targets it.
    return '<section class="osec" id="osec-overview">'
      + snapshotHead(o)                          // badges + TITLE
      // The two branded numbers, side by side (Eric 2026-08-04): M-Estimate (#mEstTop) + M-Win
      // (#mWinTop). Each fills from its OWN async fetch, so the hero stays instant and M-Estimate
      // never waits on M-Win.
      + '<div class="herotwo">'
      +   '<div id="mEstTop"><div class="vrange vrange-top" id="osec-value"><div class="vr-label">M-Estimate<span class="vr-tm">\\u2122</span></div><div class="vr-loading">Estimating from comparable federal awards\\u2026</div></div></div>'
      +   '<div id="mWinTop"><div class="mwin"><div class="vr-label">M-Win<span class="vr-tm">\\u2122</span></div><div class="mw-loading">Scoring your fit\\u2026</div></div></div>'
      + '</div>'
      + snapshotFacts(o)                          // the 6 key facts — AFTER the estimate
      + activitySec(o,extra)+tagsSec(o,extra)+freshnessSec(o)
      + '</section>'
      + aiSec(o)                                // 2. Should I pursue this? — the decision, right under the hero
      // 2b. UPCOMING events for THIS notice (industry day / pre-bid). Sits right after the pursue
      // decision because attending is the next ACTION on that decision. Async + self-hiding: the
      // slot renders nothing at all unless a real upcoming event matches (Eric: "never show expired
      // events on an opportunity page simply because they exist" — the API is upcoming-only).
      + '<div id="oppEventsSlot"></div>'
      + bidFactsSec(extra.bidFacts,o)           // 3. Opportunity intelligence: facts + agency/office + attachments (merged)
      + descSec(o)                              //    …summary  (heading inside Opportunity)
      + sowSec(o)                               //    …scope of work  (heading inside Opportunity)
      + '<div id="intelBox"><div class="intel-load">Loading market intelligence\\u2026</div></div>' // 4. Market + 5. Buyer + 6. roster (async, in order)
      + solContactsSec(o)                       // 5. Buyer intelligence (cont.): the notice POC — sits WITH the roster (which appends into #intelBox above)
      + '<div id="xsellSub"></div>'             // 6. TEAMING — "who can help me win this?" (Eric 2026-08-04: once interested, the next thought is WHO can help, THEN what else is similar). Filled on-demand.
      + similarSec(extra.similar)               // 7. Related opportunities — AFTER Teaming (the "what else is similar?" browse row comes last, before the sticky bar)
      + actions(o);                             // 8. NEXT ACTIONS: the STICKY bottom bar (.oact position:sticky) — not a tab, independent of scroll
  }
  // ── Awarded (Recompete) detail ──────────────────────────────────────────────────────────
  // Recompete rows come from /api/app/recompete-map (USASpending), keyed by PIID/solicitation
  // number — they have NO notice_id and NO sam_opportunities/opp-intel row, so the SAM
  // opportunity-detail fetch (below) would 404 for them. Their detail is a RICHER presentation of
  // the row already in hand (the same fields the map-pin popup renders — incumbent, contract
  // value, expires, service line, agency, place of performance, solicitation/PIID, set-aside) plus
  // the "Should I bid?" CTA. We look the row up in the live client-side set (rows/OPPS) by its
  // id or solicitation number — no new fetch.
  function findRecompeteRow(key){
    key=String(key==null?'':key);
    var pools=[]; try{ if(typeof rows!=='undefined'&&rows&&rows.length)pools.push(rows); }catch(e){}
    try{ if(typeof OPPS!=='undefined'&&OPPS&&OPPS.length)pools.push(OPPS); }catch(e){}
    for(var p=0;p<pools.length;p++){ var arr=pools[p];
      for(var i=0;i<arr.length;i++){ var o=arr[i]; if(o&&(String(o.nid)===key||String(o.sol)===key))return o; } }
    return null;
  }
  // "Similar recompetes" peer-card flywheel — the Awarded drawer's analog of the open-opp
  // drawer's similarSec() / the company drawer's companySimilarSec(). Cheap CLIENT-SIDE filter
  // of the recompete rows already loaded in rows/OPPS: same service line (cat) OR same agency,
  // self excluded (by nid AND sol), first ~6. No new fetch. rcSimilarRows() is the pure filter,
  // unit-tested via rc-similar.unit.test.ts.
  function rcSimilarRows(o,pools,limit){
    limit=limit||6;
    var self=String((o&&o.nid)||''), selfSol=String((o&&o.sol)||'');
    var cat=(o&&o.cat)?String(o.cat).toLowerCase():'', ag=(o&&o.agency)?String(o.agency).toLowerCase():'';
    var out=[], seen={};
    for(var p=0;p<(pools||[]).length;p++){ var arr=pools[p]||[];
      for(var i=0;i<arr.length;i++){ var r=arr[i];
        if(!r||r.src!=='RECOMPETE')continue;
        var rid=String(r.nid||''), rsol=String(r.sol||'');
        if((self&&rid===self)||(selfSol&&rsol===selfSol))continue; // never list itself
        var key=rid||rsol; if(!key||seen[key])continue;            // dedupe by id
        var rc=r.cat?String(r.cat).toLowerCase():'', ra=r.agency?String(r.agency).toLowerCase():'';
        var match=(cat&&rc===cat)||(ag&&ra===ag);                  // same service line OR agency
        if(!match)continue;
        seen[key]=1; out.push(r);
        if(out.length>=limit)return out;
      }
    }
    return out;
  }
  function recompeteSimilarSec(o){
    var pools=[]; try{ if(typeof rows!=='undefined'&&rows&&rows.length)pools.push(rows); }catch(e){}
    try{ if(typeof OPPS!=='undefined'&&OPPS&&OPPS.length)pools.push(OPPS); }catch(e){}
    var sims=rcSimilarRows(o,pools,6);
    if(!sims.length)return sec('Similar recompetes',empty('No similar recompetes in view \\u2014 pan the map or widen the dataset to find peers.'),'similar');
    var cards=sims.map(function(s){
      var key=String(s.nid||s.sol||'');
      var setLabel=(!s.set||s.set==='None')?'Open':s.set;
      return '<button class="sim-card" onclick="openRecompeteDrawer(\\''+esc(key)+'\\')">'
        + '<span class="sim-sa'+(setLabel==='Open'?' open':'')+'">'+esc(setLabel)+'</span>'
        + '<div class="sim-t">'+esc(s.title||'Awarded contract')+'</div>'
        + '<div class="sim-ag">'+esc([s.cat,s.agency].filter(Boolean).join(' \\u00b7 '))+'</div>'
        + '<div class="sim-m">'+esc([mMoney(s.value),(s.exp?'expires '+longDate(s.exp):'')].filter(Boolean).join(' \\u00b7 '))+'</div>'
        + '</button>';
    }).join('');
    return sec('Similar awarded contracts','<div class="sim-grid">'+cards+'</div>','similar');
  }
  // USASpending "More" link for a recompete/award. A recompete row is a real USASpending award
  // keyed by PIID (o.sol) — the row itself has no /award/<id> generated_internal_id in hand, so we
  // point "More" at the USASpending keyword SEARCH for the PIID (lands the user on the award record
  // without a server round-trip to resolvePiidToId). Multi-award rollups (sol carries "(+N more)")
  // are stripped to the base PIID first; a blank PIID → the recipient search as a last resort so
  // "More" is NEVER dead (gap 2). Pure — unit-tested via rc-uilink.unit.test.ts.
  // Real award-type → a human label (the parent-vehicle vs task-order distinction Eric asked for).
  // Sourced from recompete_opportunities.contract_type (99% populated). An IDV/IDIQ is the parent
  // vehicle; DELIVERY ORDER is a task order UNDER a vehicle; PURCHASE ORDER / BPA CALL / DEFINITIVE
  // are standalone buys. Unknown/blank → a neutral "Awarded contract" (never fabricated).
  function contractTypeLabel(ct){
    var t=String(ct||'').toUpperCase().trim();
    if(!t)return 'Awarded contract';
    if(t.indexOf('IDV')>=0||t.indexOf('IDIQ')>=0||t.indexOf('INDEFINITE')>=0||t==='GWAC'||t==='BPA')return 'IDIQ vehicle';
    if(t.indexOf('DELIVERY ORDER')>=0||t.indexOf('TASK ORDER')>=0)return 'Task order';
    if(t.indexOf('BPA CALL')>=0)return 'BPA call';
    if(t.indexOf('PURCHASE ORDER')>=0)return 'Purchase order';
    if(t.indexOf('DEFINITIVE')>=0)return 'Definitive contract';
    // Title-case anything else real rather than dropping it.
    return t.charAt(0)+t.slice(1).toLowerCase();
  }
  function usaspendingUrlForRecompete(o){
    var base='https://www.usaspending.gov/search';
    var piid=String((o&&o.sol)||'').replace(/\\s*\\(\\+\\d+\\s*more\\)\\s*$/i,'').trim();
    if(piid)return base+'?query='+encodeURIComponent(piid);
    var inc=String((o&&o.title)||'').trim();
    if(inc)return base+'?query='+encodeURIComponent(inc);
    return base;
  }
  // Zillow-parity activity row for the Awarded/Recompete drawer — dataset-appropriate: this is an
  // AWARD, not a live notice, so "posted"/"closes" don't apply; the real activity signal is how
  // soon it EXPIRES (real field: o.exp, the USASpending period_of_performance_current_end). A
  // per-contract tracking count is NOT reliably groundable today — "Track this recompete" saves
  // via /api/opportunities/save?source=recompete_map, and a live count check found ZERO rows on
  // that source (2026-07-26) — so no fabricated "N tracking this" here (ground-in-real-data). If a
  // real join is ever added, thread it in as extra.trackingCount and this will show it (>=2 only),
  // matching the open-opp drawer's rule exactly.
  function recompeteActivitySec(o,extra){
    var bits=[];
    if(o.exp){
      var days=Math.ceil((new Date(o.exp)-new Date())/86400000);
      if(isFinite(days)){
        if(days<0)bits.push('Expired');
        else {
          var mo=Math.round(days/30.44);
          bits.push(mo<=0?'Expires this month':('Expires in '+mo+' month'+(mo===1?'':'s')));
        }
      }
    }
    var tc=extra&&extra.trackingCount; if(typeof tc==='number'&&tc>=2)bits.push(tc.toLocaleString()+' contractors tracking this');
    if(!bits.length)return '';
    return '<div class="snapactivity">'+bits.map(function(b){return '<span>'+esc(b)+'</span>';}).join('<span class="snapdot">\\u00b7</span>')+'</div>';
  }
  // Data-freshness + provenance for the Awarded drawer — mirrors freshnessSec() (open opps) but this
  // dataset is USASpending AWARD HISTORY, not a live SAM feed, and the row is a real per-contract
  // award (PIID), not a notice — so it never shows "Archived on SAM.gov" (that's a SAM-notice
  // concept). o.synced is the real recompete_opportunities.last_synced_at (threaded from
  // /api/app/recompete-map's toPin → client toRow); absent → the "updated" clause is simply
  // omitted (never fabricated).
  function recompeteFreshnessSec(o){
    var parts=['From USASpending award records'];
    var upd=relTime(o.synced); if(upd)parts.push('updated '+upd);
    if(o.sol)parts.push('PIID '+esc(o.sol));
    return '<div class="snapfresh">'+parts.join(' <span class="snapdot">\\u00b7</span> ')+'</div>';
  }
  // Top value slot for the Awarded drawer — the Zillow price-placement pattern (mEstTopHTML), but
  // this is a REAL ceiling (o.value, USASpending potential_total_value), not an estimate: just the
  // single headline number, no range/chart/methodology (an awarded contract has an actual value,
  // not something to model). id=osec-value so the sticky "Value" tab targets it, same as the open-opp
  // drawer. GOS #10: always renders — an honest "Value not disclosed" when o.value is absent.
  function recompeteValueTopHTML(o){
    // EXACT contract value, not the rounded $575K (Eric 2026-08-05: "can we not round up the
    // numbers"). o.valueNum is the raw USASpending ceiling (potential_total_value); fmtM prints the
    // full figure sub-$1M ($575,284) and $X.XM above — same exact treatment as the open-opp drawer.
    // Fall back to the pre-formatted o.value STRING only when the raw number is absent.
    var big=(Number(o.valueNum)>0)?fmtM(Number(o.valueNum)):(o.value?esc(o.value):'');
    if(big){
      return '<div class="vrange vrange-top vrange-rc" id="osec-value">'
        + '<div class="vr-label">Contract value</div>'
        + '<div class="vr-big">'+big+'</div>'
        + '</div>';
    }
    return '<div class="vrange vrange-top vrange-rc vrange-none" id="osec-value">'
      + '<div class="vr-label">Contract value</div>'
      + '<div class="vr-none-msg">Value not disclosed \\u2014 USASpending has no ceiling amount on file for this award.</div>'
      + '</div>';
  }
  function recompeteRender(o){
    // o = the toRow() recompete shape: {src:'RECOMPETE',title(incumbent),cat(service line),
    // agency,naics,set,value,exp,loc,sol,nid,...}. CUR mirrors the open-opp drawer's CUR so the
    // action bar (Save/Share/More) works — id=nid, title, department=agency, solicitation=sol.
    // kind='recompete' routes Share → ?recompete=, Save → the recompete snapshot, and gives More a
    // live USASpending target (never the dead uiLink:'' it shipped with).
    // Title = the REAL incumbent company (googleable), NOT a fabricated "<service line> recompete".
    var rcTitle=o.title||'Awarded contract';
    CUR={ kind:'recompete', id:o.nid||o.sol, title:rcTitle, department:o.agency||'',
      solicitation:o.sol||'', naics:o.naics||'', deadline:o.exp||'', sol:o.sol||o.nid, uiLink:usaspendingUrlForRecompete(o) };
    var rcType=contractTypeLabel(o.contractType); // real award type: IDIQ vehicle / task order / …
    var setLabel=(!o.set||o.set==='None')?'Open / unrestricted':o.set;
    // EXACT contract value everywhere in this drawer (Eric 2026-08-05: "can we not round up the
    // numbers"): fmtM(valueNum) = the full USASpending ceiling ($575,284), NOT the rounded o.value
    // string ($575K). Fall back to the pre-formatted string only when the raw number is missing.
    var rcValExact=(Number(o.valueNum)>0)?fmtM(Number(o.valueNum)):(o.value||'');
    var facts=[];
    if(rcValExact)facts.push({k:'Contract value',v:rcValExact});
    facts.push({k:'Expires',v:longDate(o.exp)});
    facts.push({k:'Set-aside',v:setLabel});
    if(o.naics)facts.push({k:'NAICS',v:o.naics});
    if(o.cat)facts.push({k:'Service line',v:o.cat});
    // Sub-agency (granular buying command) + parent dept — show both when they differ, else one row.
    if(o.subAgency && o.subAgency!==o.agency)facts.push({k:'Sub-agency',v:o.subAgency});
    if(o.agency)facts.push({k:'Agency',v:o.agency});
    // The SINGLE authoritative "(approximate)" location disclosure for the Awarded/Recompete
    // dataset (Eric 2026-07-26: drawer-only, never on pins/list/popup). locSrc==='office' means
    // the city wasn't recovered from USASpending → the location is a state-level approximation.
    if(o.loc)facts.push({k:'Place of performance',v:o.loc+(o.locSrc==='office'?' (approximate — based on state, not a confirmed address)':'')});
    facts.push({k:'Solicitation / PIID',v:o.sol||'\\u2014'});
    var factRows=facts.map(function(f){ return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>'; }).join('');
    // Incumbent highlight block (the "who holds this now" hook — the recompete's core value).
    var incBlock=o.title?('<div class="rc-inc"><div class="rc-inc-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg></div>'
      + '<div><div class="rc-inc-k">Current incumbent</div><div class="rc-inc-v">'+esc(o.title)+'</div></div></div>'):'';
    // Badge = the REAL award type (IDIQ vehicle / Task order / Definitive / Purchase order / BPA call)
    // so the parent-vehicle vs task-order distinction is explicit — no longer "Recompete target".
    // Title = the incumbent company. Service line moves to the meta line (a descriptor, not a title).
    var rcBuyer=o.subAgency||o.agency||''; // buyer identity = sub-agency when present (Eric 2026-08-06: recompetes show sub-agency like opps)
    var head='<div class="snaphero"><span class="badge-nt">'+esc(rcType)+'</span>'
      + (o.exp?'<span class="badge-dl cool">Expires '+longDate(o.exp)+'</span>':'')+'</div>'
      + '<div class="snapt">'+esc(rcTitle)+'</div>'
      + '<div class="snapmeta">'+(rcBuyer?'<b>'+esc(rcBuyer)+'</b>':'')+((rcBuyer&&o.cat)?' \\u00b7 ':'')+(o.cat?esc(o.cat):'')+((rcBuyer||o.cat)&&o.loc?' \\u00b7 ':'')+(o.loc?esc(o.loc):'')+'</div>';
    // Task-order spend stream — the ACTUAL money, fetched on-demand right after this
    // renders (see loadTaskOrders below). Placeholder shows a loading state; a
    // no-UEI / collapsed-vehicle row skips the fetch entirely (never shows a spinner
    // that can't resolve) and the section quietly stays absent — the ceiling in
    // "Recompete facts" above is still the honest number either way.
    var toBlock = (o.uei && o.sol && !/\\(\\+\\d+\\s*more\\)\\s*$/i.test(o.sol))
      ? sec('Actual task-order spend','<div id=\"rcTaskOrders\" class=\"rc-to-loading\">Checking USASpending for real task-order activity\\u2026</div>','taskorders')
      : '';
    // Contract history · who holds this now — the recompete's core value. The incumbent + real
    // contract value + expiry are already ON THE ROW (USASpending award), so this replicates the
    // opp drawer's "Contract history" section from data in hand (no fetch), not an M-Estimate.
    var histFacts=[];
    if(o.title)histFacts.push({k:'Current incumbent',v:o.title});
    if(rcValExact)histFacts.push({k:'Contract value (ceiling)',v:rcValExact});
    histFacts.push({k:'Expires',v:longDate(o.exp)});
    if(o.uei)histFacts.push({k:'Incumbent UEI',v:o.uei});
    histFacts.push({k:'Contract / PIID',v:o.sol||'\\u2014'});
    var histSec=sec('Contract history \\u00b7 who holds this now',
      '<div class="bf-grid">'+histFacts.map(function(f){return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>';}).join('')+'</div>'
      + '<div class="ai-note">The incumbent is the recompete target \\u2014 the firm you\\u2019d displace. Value + expiry are from the USASpending award record.</div>','incumbent');
    // Market-intelligence block (agency intel + pricing) — filled by an on-demand fetch to
    // /api/app/recompete-detail (see loadRecompeteIntel). Same fail-soft/collapse-silently pattern
    // as the open-opp drawer's intelBox. loadRoster() appends the BD roster into this same box.
    // "What's special" trait chips (gap 5) — the recompete's key traits (service line · set-aside ·
    // expiry window), reusing the same .whatspecial/.ws-tag chip styling as the opp drawer's tagsSec.
    var chips=recompeteTraitChips(o);
    // Zillow-parity Overview: activity row (expiry countdown) + data-freshness/source line —
    // the SAME pattern the open-opp drawer shipped in #498, adapted for an AWARD row (no
    // posted/closes fields; the real signal is "how soon does this expire").
    // incBlock ("Current incumbent" callout) is now REDUNDANT — the title IS the incumbent company —
    // so it's dropped from the overview (kept defined above for the fact list / other callers).
    void incBlock;
    return '<section class="osec" id="osec-overview">'+head+recompeteActivitySec(o,{})+(chips?'<div class="whatspecial" style="margin-top:12px">'+chips+'</div>':'')+recompeteFreshnessSec(o)+'</section>'
      + '<div id="mEstTop">'+recompeteValueTopHTML(o)+'</div>'
      + sec('Recompete facts','<div class="bf-grid">'+factRows+'</div>','facts')
      + toBlock
      + histSec
      + '<div id="rcIntelBox"><div class="intel-load">Loading market intelligence\\u2026</div></div>'
      + aiSec(CUR)                                // "Should I bid?" — runAI accepts the row id (nid)
      + '<div id="xsellOpen"></div>'              // "Ways to win": open bids in this NAICS+state (on-demand)
      + recompeteSimilarSec(o)                    // peer flywheel → other recompetes in this line/agency
      + recompeteActions(o)                       // in-body actions (gap 4): Track · Draft capture · View USASpending
      + '<div class="oppsoon">This is an expiring contract due for recompete. Value, incumbent and expiry are from USASpending award records; the solicitation may post 6\\u201318 months before it expires.</div>';
  }
  // Trait chips for a recompete (gap 5) — pure, reuses the opp drawer's .ws-tag chip styling.
  // Real fields only: service line · set-aside · expiry window (computed from exp). Unit-tested
  // via rc-traits.unit.test.ts.
  function recompeteExpiryWindow(exp){
    if(!exp)return '';
    var days=Math.ceil((new Date(exp)-new Date())/86400000);
    if(!isFinite(days))return '';
    if(days<0)return 'Expired';
    var mo=Math.round(days/30);
    if(mo<=6)return 'Expires \\u2264 6 mo';
    if(mo<=12)return 'Expires \\u2264 12 mo';
    if(mo<=18)return 'Expires \\u2264 18 mo';
    return 'Expires 18 mo+';
  }
  function recompeteTraitChips(o){
    var tags=[];
    if(o.cat)tags.push(o.cat);
    tags.push((!o.set||o.set==='None')?'Open / unrestricted':o.set);
    var win=recompeteExpiryWindow(o.exp); if(win)tags.push(win);
    if(!tags.length)return '';
    return tags.slice(0,6).map(function(t){return '<span class="ws-tag">'+esc(t)+'</span>';}).join('');
  }
  // In-body actions row for the recompete drawer (gap 4) — mirrors the opp drawer's actions():
  // Track this recompete (Save via the same recompete save path) · Draft capture strategy (the
  // recompete draftURL) · View on USASpending. Save is optimistic + idempotent (saveCurrentRecompete).
  function recompeteActions(o){
    return '<div class="oact">'
      + '<button class="b pri" onclick="saveCurrentRecompete(this)">Track this recompete</button>'
      // Map-native workspace, same as "Generate proposal" (Eric 2026-08-13). NOTE this deliberately
      // uses the PIPELINE path (openProposalWorkspace -> saveCurrentOpp), not saveCurrentRecompete:
      // that one posts to /api/opportunities/save (saved opportunities), which produces no pursuit
      // row — and the workspace keys on ?pursuit=<id>. Drafting against something IS working it, so
      // it belongs in pursuits. "Track this recompete" beside it keeps its own meaning untouched.
      + '<button class="b" onclick="openProposalWorkspace(this)" data-act="draft a capture strategy">Draft capture strategy</button>'
      + '<a class="b" href="'+esc(usaspendingUrlForRecompete(o))+'" target="_blank" rel="noopener">View on USASpending \\u2197</a>'
      + '</div>';
  }
  // "Track this recompete" — the in-body Save (gap 4). Mirrors saveCurrentCompany/saveCurrentBuyer:
  // saves the recompete via /api/opportunities/save (source=recompete_map, PIID as noticeId) with a
  // snapshot so the Favorites page renders it without a sam_opportunities hydration hit (a recompete
  // has NO sam_opportunities row). Idempotent + optimistic label.
  window.saveCurrentRecompete=function(btn){
    if(!CUR||CUR.kind!=='recompete'||btn.dataset.saved==='1')return;
    var a=window.requireSignIn('save this to your pursuits'); if(!a)return;
    btn.textContent='Saving\\u2026';
    fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
      body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'recompete_map',
        opportunityData:{noticeId:CUR.id,entityType:'recompete',solicitationNumber:CUR.solicitation,title:CUR.title,department:CUR.department,agency:CUR.department,naicsCode:CUR.naics}})})
      .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
        var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
        if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 Tracked':'\\u2713 Tracked'; btn.classList.add('saved'); btn.dataset.saved='1'; }
        else btn.textContent='Try again';
      }).catch(function(){ btn.textContent='Try again'; });
  };
  // Agency intel + pricing for the Awarded drawer — mirrors the open-opp drawer's renderIntel(),
  // but ONLY the two sections a recompete row doesn't already carry (agency priorities/pain points
  // + vendor pricing). Predecessor/valueRange are deliberately omitted server-side (GOS #9c: the
  // recompete has a real incumbent + contract value already).
  // GOS invariant #10: agency intel + pricing ALWAYS render (header + muted placeholder when empty),
  // so the Awarded drawer's skeleton + tabs stay constant. intel may be {} (fetch miss) — still renders.
  function renderRecompeteIntel(intel){
    intel=intel||{};
    var out='';
    var a=intel.agency;
    if(a&&((a.painPoints&&a.painPoints.length)||(a.priorities&&a.priorities.length))){
      var inner='';
      if(a.priorities&&a.priorities.length)inner+='<div class="ai-lab">Agency priorities</div>'+ul(a.priorities);
      if(a.painPoints&&a.painPoints.length)inner+='<div class="ai-lab">Known pain points</div>'+ul(a.painPoints);
      out+=sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',inner,'agencyintel');
    } else {
      out+=sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',empty('Agency intel not available for this buyer.'),'agencyintel');
    }
    var pr=intel.pricing;
    if(pr&&pr.rates&&pr.rates.length){
      out+=sec('Market pricing \\u00b7 what vendors charge here',rateChart(pr.rates)+(pr.summary?'<div class="ai-note">'+esc(pr.summary)+'</div>':''),'pricing');
    } else {
      out+=sec('Market pricing \\u00b7 what vendors charge here',empty('Pricing data not available for this NAICS.'),'pricing');
    }
    out+=behaviorSec(intel.behavior); // HOW this agency buys — SB-fit signal (GOS #11)
    return out;
  }
  // Fetch agency intel + pricing on demand, then the BD roster — fail-soft, mirroring the
  // open-opp drawer's second (?intel=1) fetch + loadRoster. A slow/empty section collapses
  // silently (the ceiling/incumbent/task-order sections are already fully rendered).
  function loadRecompeteIntel(o){
    var box=document.getElementById('rcIntelBox'); if(!box)return;
    fetch('/api/app/recompete-detail?naics='+encodeURIComponent(o.naics||'')+'&agency='+encodeURIComponent(o.agency||'')+'&title='+encodeURIComponent(o.title||''))
      .then(function(r){return r.json();}).then(function(x){
        // GOS invariant #10: always render the intel skeleton (placeholders when empty), even on a
        // failed/empty fetch → renderRecompeteIntel({}). Never a silent collapse.
        box.innerHTML=renderRecompeteIntel((x&&x.success)?x.intel:{}); buildTabs();
        loadRoster(o.agency,'rcIntelBox'); // OTHER agency contacts to network with (BD roster)
      }).catch(function(){ box.innerHTML=renderRecompeteIntel({}); buildTabs(); loadRoster(o.agency,'rcIntelBox'); });
  }
  // ── Cross-sell fetchers ("Ways to win this") — Supabase-only, fail-soft, GOS #10 ────────────
  // OPEN drawer → awarded contracts (subcontract targets). Fills #xsellSub after the opp loads.
  function loadCrossSellAwards(naics,state,excludeId,psc){
    var box=document.getElementById('xsellSub'); if(!box)return;
    if(!naics||!state){ box.innerHTML=subcontractSec([],naics,state,null); buildTabs(); return; }
    fetch('/api/app/related-awards?naics='+encodeURIComponent(naics)+'&state='+encodeURIComponent(state)+'&exclude='+encodeURIComponent(excludeId||'')+'&psc='+encodeURIComponent(psc||''))
      .then(function(r){return r.json();}).then(function(d){
        var meta=d?{scope:d.scope,states:d.states,widenedNaics:d.widenedNaics}:null;
        box.innerHTML=subcontractSec((d&&d.success&&d.targets)||[],naics,state,meta); buildTabs();
      }).catch(function(){ box.innerHTML=subcontractSec([],naics,state,null); buildTabs(); });
  }
  // AWARDED drawer → open opportunities (direct-bid targets). Fills #xsellOpen after it renders.
  function loadCrossSellOpen(o){
    var box=document.getElementById('xsellOpen'); if(!box)return;
    var naics=o.naics||'', state=o.state||'';
    if(!naics||!state){ box.innerHTML=openBidsSec([],naics,state); buildTabs(); return; }
    fetch('/api/app/related-opps?naics='+encodeURIComponent(naics)+'&state='+encodeURIComponent(state)+'&exclude='+encodeURIComponent(o.nid||o.sol||'')+'&psc='+encodeURIComponent(o.psc||''))
      .then(function(r){return r.json();}).then(function(d){
        box.innerHTML=openBidsSec((d&&d.success&&d.targets)||[],naics,state); buildTabs();
      }).catch(function(){ box.innerHTML=openBidsSec([],naics,state); buildTabs(); });
  }
  // Delegated click for subcontract-target cards (payload JSON in data-payload) — see subcontractSec.
  if(typeof body!=='undefined'&&body&&body.addEventListener){
    body.addEventListener('click',function(e){
      var el=e.target&&e.target.closest?e.target.closest('[data-xsell="award"]'):null; if(!el)return;
      var raw=el.getAttribute('data-payload'); if(!raw)return;
      try{ window.openRecompeteFromData(JSON.parse(decodeURIComponent(raw))); }catch(err){}
    });
  }
  // Bar-chart-over-time DATA PREP (pure — unit-tested via rc-task-order-chart.unit.test.ts).
  // Task orders are a TIME SERIES: each is a bar positioned by action_date (x = time,
  // earliest\\u2192latest), height = obligation $ scaled to the max. Only positive-$, dated rows
  // become bars (null-$ / undated rows stay in the list below but can't be plotted). Returns
  // null when there are <3 plottable bars \\u2014 a 1- or 2-bar chart is noise, skip it.
  // Bucketed payout chart — condenses the raw payouts into time PERIODS (year, or quarter when the
  // span is short) so the $ per period is READABLE on the bar (Eric 2026-07-27: "condense over a
  // time period so you can see the numbers"). Sums real obligations per period; every label traces to
  // the data. Returns '' for <2 periods (a single bar isn't a trend). Shared by the task-order + the
  // company award-history charts.
  // fixedWindow=true (the company Award chart): a CONSISTENT 5-calendar-year window — the SAME years
  // for EVERY firm (current year back 4), and a year with no awards shows a $0 bar (Eric 2026-07-28:
  // "the table should not vary, everyone gets the same; if the year is 0 it shows 0"). This makes
  // firms COMPARABLE at a glance — a mature SaaS chart, not a per-firm variable set of periods.
  // fixedWindow=false (task-orders): keep the natural span (a task-order burst isn't 5 calendar years).
  function bucketedChart(txns,label,fixedWindow){
    var pts=[];
    for(var i=0;i<(txns||[]).length;i++){ var t=txns[i]; if(!t)continue;
      var amt=Number(t.obligation); if(!isFinite(amt)||amt<=0)continue;
      var ts=t.actionDate?Date.parse(t.actionDate):NaN; if(!isFinite(ts))continue;
      pts.push({ts:ts,amt:amt}); }
    if(pts.length<2)return '';
    pts.sort(function(a,b){return a.ts-b.ts;});
    var YEARS=5;
    var buckets={}, order=[];
    if(fixedWindow){
      // Fixed window anchored on the CURRENT year — the SAME five columns for EVERY firm (this is how
      // Stripe/QuickBooks/GA do a comparable time series: a continuous axis on a fixed reference, not
      // the firm's own span). A firm inactive since 2023 shows real bars for '22-'23 and $0 for '24-'26
      // — the quiet years ARE the signal. Seed all 5 at $0, then add each award into its year.
      var endY=(new Date()).getFullYear();
      for(var w=YEARS-1;w>=0;w--){ var yy=endY-w; var kk=''+yy; buckets[kk]={sum:0,label:''+yy}; order.push(kk); }
      for(var j=0;j<pts.length;j++){ var y2=(new Date(pts[j].ts)).getFullYear(); var k2=''+y2;
        if(k2 in buckets) buckets[k2].sum+=pts[j].amt; } // awards older than the 5yr window fold out
    } else {
      for(var j2=0;j2<pts.length;j2++){ var d=new Date(pts[j2].ts); var y3=d.getFullYear(); var k3=''+y3;
        if(!(k3 in buckets)){ buckets[k3]={sum:0,label:''+y3}; order.push(k3); }
        buckets[k3].sum+=pts[j2].amt; }
      if(order.length<2)return '';
      order.sort(); if(order.length>YEARS) order=order.slice(order.length-YEARS);
    }
    var max=0; for(var k=0;k<order.length;k++){ if(buckets[order[k]].sum>max)max=buckets[order[k]].sum; }
    if(max<=0)return ''; // all-zero → no chart
    var cols=order.map(function(key){ var b=buckets[key]; var h=b.sum>0?Math.max(4,Math.round(b.sum/max*100)):0;
      // A $0 year renders an empty track (h:0) with a "$0" label — the gap is the signal, not hidden.
      return '<div class="rc-bkcol"><div class="rc-bkval">'+esc(b.sum>0?(mMoney(b.sum)||''):'$0')+'</div>'
        + '<div class="rc-bkbar'+(b.sum>0?'':' rc-bkbar-zero')+'" style="height:'+h+'%" title="'+esc(b.label+' \\u00b7 '+(b.sum>0?(mMoney(b.sum)||''):'$0'))+'"></div>'
        + '<div class="rc-bklab">'+esc(b.label)+'</div></div>'; }).join('');
    var cap=fixedWindow?('Last '+YEARS+' years'):('By year \\u00b7 '+order.length+' year'+(order.length===1?'':'s'));
    return '<div class="rc-tochart-lab">'+esc(label||'Payouts by period')+'</div>'
      + '<div class="rc-bkchart">'+cols+'</div>'
      + '<div class="rc-bkcap">'+esc(cap)+'</div>';
  }
  // Renders the summary card + a BAR-CHART-OVER-TIME (the payout rhythm) + the dated ledger
  // ($ \\u00b7 date \\u00b7 city), capped to the most recent ~9 with the rest behind a "show all"
  // expander (188 rows is too long inline). Ceiling comes from the row already in hand
  // (o.value, the parent's potential_total_value) — actual comes from the fetch.
  var RC_TO_VISIBLE=9;
  function taskOrderStreamHTML(o,d){
    var txns=(d&&d.txns)||[];
    if(!d||!d.grounded||!txns.length){
      // Honest no-data states — never a dead spinner. A genuine "no task orders found"
      // still leaves the ceiling visible up in Recompete facts.
      var why = (d&&d.reason==='no_task_orders')
        ? 'No task-order activity found under this PIID in USASpending yet.'
        : 'Task-order detail isn\\u2019t available for this contract right now.';
      return empty(why);
    }
    function row(t){
      var amt=mMoney(t.obligation);
      var date=t.actionDate?longDate(t.actionDate):'\\u2014';
      var loc=t.popCity?(t.popCity+', '+(t.popState||'')):(t.popState||'\\u2014');
      var approx=t.locPrecision==='state';
      return '<div class="rc-to-row"><div class="rc-to-amt">'+esc(amt||'\\u2014')+'</div>'
        + '<div class="rc-to-date">'+esc(date)+'</div>'
        + '<div class="rc-to-loc'+(approx?' approx':'')+'">'+esc(loc)+(approx?' (approx.)':'')+'</div></div>';
    }
    // List shows the most RECENT orders first; cap to RC_TO_VISIBLE, collapse the rest.
    var ordered=txns.slice().sort(function(a,b){
      var ta=a&&a.actionDate?Date.parse(a.actionDate):0, tb=b&&b.actionDate?Date.parse(b.actionDate):0;
      return (tb||0)-(ta||0);
    });
    var head=ordered.slice(0,RC_TO_VISIBLE).map(row).join('');
    var restRows=ordered.slice(RC_TO_VISIBLE);
    var restHtml='';
    if(restRows.length){
      restHtml='<div class="rc-to-rest" id="rcToRest">'+restRows.map(row).join('')+'</div>'
        + '<button class="rc-to-more" onclick="var r=document.getElementById(\\'rcToRest\\');var o=r.classList.toggle(\\'open\\');this.textContent=o?\\'\\u25be Show fewer\\':\\'\\u25b8 Show all '+txns.length+' task orders\\';">\\u25b8 Show all '+txns.length+' task orders</button>';
    }
    var actualLabel=mMoney(d.totalActual)||'\\u2014';
    var ceilLabel=o.value||'\\u2014';
    var summary='<div class="rc-actual">'
      + '<div><div class="rc-actual-v">'+esc(actualLabel)+'</div><div class="rc-actual-k">Actually obligated \\u00b7 '+txns.length+' task order'+(txns.length===1?'':'s')+(d.distinctCities?' \\u00b7 '+d.distinctCities+' location'+(d.distinctCities===1?'':'s'):'')+'</div></div>'
      + '<div class="rc-ceil"><div class="rc-ceil-v">'+esc(ceilLabel)+'</div><div class="rc-ceil-k">Contract ceiling</div></div>'
      + '</div>';
    // Chart leads (below the summary, above the list). Bucketed-by-period so each bar's $ is readable
    // (Eric 2026-07-27) — 188 raw payouts became an unreadable picket fence; condensed to year/quarter
    // totals with the $ labeled on each bar. Falls back to '' for <2 periods.
    return summary+bucketedChart(txns,'Task-order $ by period')+'<div class="rc-to-list">'+head+restHtml+'</div>';
  }
  function loadTaskOrders(o){
    var box=document.getElementById('rcTaskOrders'); if(!box)return;
    fetch('/api/app/recompete-task-orders?piid='+encodeURIComponent(o.sol||'')+'&uei='+encodeURIComponent(o.uei||''))
      .then(function(r){return r.json();})
      .then(function(d){
        box.outerHTML='<div id=\"rcTaskOrders\">'+taskOrderStreamHTML(o,d)+'</div>'; buildTabs();
        if(d&&d.grounded&&d.txns&&d.txns.length)drawTaskOrderPins(d.txns); // per-task-order pins at their REAL cities
      })
      .catch(function(){ box.outerHTML='<div id=\"rcTaskOrders\">'+empty('Task-order detail isn\\u2019t available for this contract right now.')+'</div>'; });
  }
  window.openRecompeteDrawer=function(key){
    var o=findRecompeteRow(key); if(!o){ return; }
    if(window.__resetOppSave)window.__resetOppSave();
    dr.classList.remove('buyer-accent'); // non-buyer entity → blue accent
    clearTaskOrderPins(); // opening a new contract — drop the previous one's task-order pins first
    body.innerHTML=recompeteRender(o);
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    buildTabs();
    if(document.getElementById('rcTaskOrders'))loadTaskOrders(o);
    loadRecompeteIntel(o); // agency intel + pricing + BD roster (fail-soft, on-demand)
    loadCrossSellOpen(o);  // "Ways to win": open bids in the same NAICS + state (direct-bid targets)
  };
  // FORECAST drawer — planned work not yet on SAM (agency forecast rows, keyed fc-…, NO
  // sam_opportunities row, so opportunity-detail 404s). Rendered from the row in hand like the
  // recompete drawer — never a fetch. Honest about its nature: no deadline, no attachments, an
  // ESTIMATE not a solicitation. (Eric 2026-08-03 — "the forecast listings are missing information".)
  window.openForecastDrawer=function(key){
    var o=findRecompeteRow(key); if(!o){ return; }   // findRecompeteRow scans rows/OPPS by nid/sol — any src
    if(window.__resetOppSave)window.__resetOppSave();
    dr.classList.remove('buyer-accent');
    clearTaskOrderPins();
    body.innerHTML=forecastRender(o);
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    buildTabs();
    loadForecastDetail(o);  // the RICH row (description, POC to call now, incumbent, offices, dates) — on-demand
    loadCrossSellOpen(o);   // "Ways to win": open bids in the same NAICS + state — a real bridge from a forecast
  };
  // The pin is thin. Fetch the full agency_forecasts row and fill the drawer's detail slot with the
  // parts a BD person actually needs on a FORECAST: the requirement DESCRIPTION, the POC to reach out
  // to NOW (forecasts exist to engage early), the likely incumbent, the contracting/program office,
  // and the expected timeline. Fail-soft: a failed fetch leaves the thin overview standing. (Eric 2026-08-03.)
  function loadForecastDetail(o){
    var oppBox=document.getElementById('fcOppBox');
    var mktBox=document.getElementById('fcMktBox');
    var buyerBox=document.getElementById('fcBuyerBox');
    if(!oppBox)return;
    var agency=(o&&o.agency)||'';
    // Fail-soft skeleton (Eric 2026-08-05 "do not show empty solicitation/attachment/compliance/
    // proposal states"): if the fetch dies we still want sections 3-5 to carry SOMETHING honest, not
    // a dead spinner. loadForecastRoster() below fills Buyer with the agency roster regardless.
    function fail(){
      if(oppBox)oppBox.innerHTML=sec('Opportunity intelligence',empty('The full forecast detail isn\\u2019t available for this planned buy right now.'),'fcdesc');
      if(mktBox)mktBox.innerHTML='';
      loadForecastRoster(agency);   // Buyer intelligence still gets the agency roster
      buildTabs();
    }
    var id=String((o&&(o.nid||o.sol))||''); if(!id){ fail(); return; }
    fetch('/api/app/forecast-detail?id='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
      if(!(d&&d.success&&d.forecast)){ fail(); return; }
      var f=d.forecast;
      // ── 3. OPPORTUNITY INTELLIGENCE — what the agency needs + the published record (codes/timeline/
      // office). The requirement DESCRIPTION leads (the single most useful field); the technical detail
      // grid follows. Framed as "what they've signalled", never an empty solicitation shell.
      var oppInner='';
      if(f.description)oppInner+='<div class="osec-sub">What they need</div><div class="fc-desc">'+esc(String(f.description))+'</div>';
      var det=[];
      if(f.contracting_office)det.push({k:'Contracting office',v:f.contracting_office});
      if(f.program_office&&f.program_office!==f.contracting_office)det.push({k:'Program office',v:f.program_office});
      if(f.bureau)det.push({k:'Bureau',v:f.bureau});
      if(f.competition_type)det.push({k:'Competition',v:f.competition_type});
      if(f.contract_type)det.push({k:'Contract type',v:f.contract_type});
      if(f.set_aside_type)det.push({k:'Set-aside',v:f.set_aside_type});
      if(o&&o.naics)det.push({k:'NAICS',v:o.naics});
      if(f.psc_code)det.push({k:'PSC',v:f.psc_code+(f.psc_description?' \\u2014 '+f.psc_description:'')});
      if(f.fiscal_year)det.push({k:'Fiscal year',v:f.fiscal_year});
      if(f.anticipated_quarter)det.push({k:'Anticipated quarter',v:f.anticipated_quarter});
      if(f.solicitation_date)det.push({k:'Expected solicitation',v:longDate(f.solicitation_date)});
      if(f.anticipated_award_date)det.push({k:'Anticipated award',v:longDate(f.anticipated_award_date)});
      if(det.length)oppInner+='<div class="osec-sub" style="margin-top:14px">Published forecast detail</div>'
        + '<div class="bf-grid">'+det.map(function(x){return '<div class="bf-row"><div class="bf-k">'+esc(x.k)+'</div><div class="bf-v">'+esc(String(x.v))+'</div></div>';}).join('')+'</div>'
        + (function(){ var s=forecastSource(f.source_url); return s?('<div class="ai-note">Source: <a href="'+esc(s.href)+'" target="_blank" rel="noopener">'+esc(s.label)+'</a></div>'):''; })();
      if(!oppInner)oppInner=empty('The agency listed this requirement without further detail. Track it \\u2014 the description usually fills in as the buy nears solicitation.');
      oppBox.innerHTML=sec('Opportunity intelligence',oppInner,'fcdesc');

      // ── 4. MARKET INTELLIGENCE — the estimated value (agency's own band) + WHO HOLDS IT NOW (the
      // displacement target). Only renders sub-parts that are real; if neither is present the section
      // is omitted (no empty market shell). "Research the market" bridges to the full report.
      var mkt='';
      if(f.estimated_value_range){
        mkt+='<div class="osec-sub">Estimated value</div>'
          + '<div class="bf-grid"><div class="bf-row"><div class="bf-k">Agency estimate</div><div class="bf-v">'+esc(String(f.estimated_value_range))+'</div></div></div>';
      }
      if(f.incumbent_name){
        mkt+='<div class="osec-sub" style="margin-top:14px">Who holds this now</div>'
          + '<div class="bf-grid"><div class="bf-row"><div class="bf-k">Current incumbent</div><div class="bf-v">'+esc(String(f.incumbent_name))+'</div></div>'
          + (f.incumbent_contract_number?'<div class="bf-row"><div class="bf-k">Contract #</div><div class="bf-v">'+esc(String(f.incumbent_contract_number))+'</div></div>':'')
          + '</div><div class="ai-note">The incumbent is your displacement target \\u2014 study their scope before the recompete posts.</div>';
      }
      if(mkt){
        mkt+='<div class="xsell-note" style="margin-top:14px"><a class="bf-doc" href="/opportunity-map/market?naics='+encodeURIComponent((o&&o.naics)||'')+'" target="_blank" rel="noopener">Research this market in depth \\u2192</a></div>';
        if(mktBox)mktBox.innerHTML=sec('Market intelligence',mkt,'fcmkt');
      } else if(mktBox){ mktBox.innerHTML=''; }

      // ── 5. BUYER INTELLIGENCE + CONTACTS — the POC to engage NOW (the forecast's superpower), then
      // the agency roster (loadForecastRoster appends into this same box). Only renders the POC block
      // with a REAL contact; the roster fills below either way.
      if(buyerBox){
        var buyerInner='';
        if(f.poc_name||f.poc_email||f.poc_phone){
          buyerInner+='<div class="osec-sub">Who to contact now</div><div class="bf-grid">';
          if(f.poc_name)buyerInner+='<div class="bf-row"><div class="bf-k">Name</div><div class="bf-v">'+esc(String(f.poc_name))+'</div></div>';
          if(f.poc_email)buyerInner+='<div class="bf-row"><div class="bf-k">Email</div><div class="bf-v"><a href="mailto:'+esc(String(f.poc_email))+'">'+esc(String(f.poc_email))+'</a></div></div>';
          if(f.poc_phone)buyerInner+='<div class="bf-row"><div class="bf-k">Phone</div><div class="bf-v">'+esc(String(f.poc_phone))+'</div></div>';
          buyerInner+='</div><div class="ai-note">Reach out now \\u2014 forecasts are the window to shape a requirement before the solicitation posts.</div>';
        } else {
          buyerInner+='<div class="osec-sub">Who to contact now</div>'
            + empty('No forecast POC published for this buy. The agency roster below is where to start building the relationship.');
        }
        buyerBox.innerHTML=sec('Buyer intelligence',buyerInner,'fcpoc');
      }
      loadForecastRoster(agency);  // appends the agency roster into #fcBuyerBox → rebuilds tabs
      buildTabs(); // new sections appeared → rebuild the tab rail
    }).catch(function(){ fail(); });
  }
  // Buyer intelligence (cont.) — the agency roster, appended into the forecast's Buyer section. Same
  // signed-in federal-contacts lookup the open drawer uses (loadRoster), pointed at #fcBuyerBox so the
  // Contacts live WITH the forecast POC. Fail-soft: no agency / signed-out → a muted note, never empty.
  function loadForecastRoster(agency){
    var box=document.getElementById('fcBuyerBox'); if(!box)return;
    // If the Buyer section wasn't built yet (fetch failed before it ran), create a shell so the roster
    // has a home and the tab resolves.
    if(!document.getElementById('osec-fcpoc')){
      box.innerHTML=sec('Buyer intelligence','<div class="osec-sub">Who to contact now</div>'+empty('No forecast POC on file \\u2014 the agency roster below is where to start.'),'fcpoc');
    }
    loadRoster(agency,'fcBuyerBox');  // appends "Decision makers · who to network with" + buildTabs()
  }
  // FORECAST drawer — the SAME eight-section reading order as the open-opp drawer, but every section
  // is framed for PLANNED work (Eric 2026-08-05: "forecasts are an early-capture product, not
  // incomplete solicitations"). So we DON'T show empty solicitation/attachment/compliance/proposal
  // states — a forecast has no solicitation number, deadline, or docs yet, and pretending otherwise
  // reads as a broken open-opp. The eight, in order (anchors chosen so buildTabs' groups resolve):
  //   1 Overview (osec-overview)          — what is this planned buy?
  //   2 Should I pursue this? (osec-ai)   — Track / Research / Start Capture (NOT Bid/No-Bid)
  //   3 Opportunity intelligence (fcdesc) — what they need + the published forecast detail  [async]
  //   4 Market intelligence (fcmkt)       — estimated value + who holds it now (displacement target) [async]
  //   5 Buyer intelligence (fcpoc)        — the POC to engage NOW + the agency roster (Contacts) [async]
  //   6 Related opportunities (openbids)  — open bids in the same NAICS + state (a live bridge) [async]
  //   7 Prepare to win (fcwin)            — the early-capture play (track, research, engage) — renamed
  //                                          from "Win This Contract"; NO draft-proposal/compliance here
  //   8 Actions (osec-actions)            — the sticky bar: Track this buy · Save · Share  (no SAM link)
  function forecastRender(o){
    CUR_FC=o;  // the async loaders (loadForecastDetail) read this to know the pin they're enriching
    // foreVal: the forecast hero value. o.estRange is normally the agency's own PUBLISHED range
    // ("$20M to $50M", "Over $100M", "$500K - $999K") — pass those THROUGH verbatim. But some
    // agency_forecasts rows store a BARE numeric string in estimated_value_range ("99000000",
    // "24,000,000") — those must be FORMATTED (fmtM → "$99.0M"), not printed raw (Eric screenshot
    // 2026-08-08). "Bare number" = only digits/commas/whitespace/decimal (no $, letter, dash, or
    // "to"/"–"/"-" range markers). Empty/whitespace estRange falls back to the median o.est.
    function foreVal(o){
      var r=(o.estRange==null?'':String(o.estRange)).trim();
      if(r){
        // A real range/text — has a currency sign, a letter, or a range separator → show as-is.
        if(/[a-zA-Z$]/.test(r) || /[-\\u2013\\u2014]/.test(r) || /\\bto\\b/i.test(r)) return r;
        // Otherwise it's a bare number (digits/commas/spaces/decimal) → format it.
        var n=Number(r.replace(/[,\\s]/g,''));
        if(isFinite(n)&&n>0) return fmtM(n);
        return r; // non-numeric leftover — never invent, show what the agency stored
      }
      return fmtM(Number(o.est)||0);
    }
    var fTitle=o.title||'Planned procurement';
    var setLabel=(!o.set||o.set==='None')?'To be determined':o.set;
    // CUR mirrors the other drawers so the action bar (Save/Share/More) works. kind='forecast'
    // routes Share → ?forecast=, and there is no live solicitation URL yet (uiLink stays empty).
    CUR={ kind:'forecast', id:o.nid||o.sol, title:fTitle, department:o.agency||'',
      solicitation:'', naics:o.naics||'', deadline:'', sol:o.sol||o.nid, uiLink:o.uiLink||'' };
    // The Overview facts grid = the same 4 the open-opp hero shows, forecast-labelled: instead of a
    // fixed "Response due" (a forecast has none) we lead with the EXPECTED window. Set-aside/Agency/
    // Location match the open drawer; the technical codes (NAICS/PSC/Category) live down in
    // Opportunity Intelligence (#3), not the decision hero — the same split as snapshotFacts().
    var facts=[];
    facts.push({k:'Expected on the street',v:o.close?longDate(o.close):'Not yet scheduled'});
    facts.push({k:'Set-aside',v:setLabel});
    facts.push({k:'Agency',v:o.agency||'\\u2014'});
    facts.push({k:'Location',v:o.loc||o.noLoc||'Not specified'});
    var factRows=facts.map(function(f){ return '<div class="bf-row"><div class="bf-k">'+esc(f.k)+'</div><div class="bf-v">'+esc(f.v)+'</div></div>'; }).join('');
    var head='<div class="snaphero"><span class="badge-nt" style="background:#f3e8ff;color:#7c3aed">Forecast \\u00b7 planned work</span>'
      + (o.close?'<span class="badge-dl cool">Est. '+longDate(o.close)+'</span>':'')+'</div>'
      + '<div class="snapt">'+esc(fTitle)+'</div>'
      + '<div class="snapmeta">'+(o.agency?'<b>'+esc(o.agency)+'</b>':'')+((o.agency&&o.loc)?' \\u00b7 ':'')+(o.loc?esc(o.loc):'')+'</div>';
    // 1. OVERVIEW — hero: badges + title + planned-work note + the purple value range + key facts.
    var overview='<section class="osec" id="osec-overview">'+head
      + '<div class="ai-note" style="margin-top:12px">This is a <b>forecasted</b> requirement \\u2014 the agency has signaled it, but it is <b>not yet on SAM</b>. There is no solicitation number, deadline, or attachments yet. Value is the agency\\u2019s <b>estimate</b>. Forecasts typically post as a solicitation 6\\u201318 months out \\u2014 the whole point is to position <b>before</b> it does.</div>'
      // The forecast hero uses the AGENCY'S OWN PUBLISHED RANGE (o.estRange, e.g. "$7.5M–$25M"), in
      // FORECAST PURPLE — matching the sidebar card (Eric 2026-08-05: "for forecast use the actual
      // number and colors — we had it working then changed it"). NOT mCompact(o.est) (that collapsed
      // the range to a single green number). Fall back to the median only if there's no range string.
      // ⚠️ estRange is sometimes a BARE NUMERIC STRING ("99000000") not a formatted range — some agency
      // forecasts store the raw single value in estimated_value_range. Rendering it verbatim printed a
      // giant unformatted integer (Eric screenshot 2026-08-08). foreVal() formats a bare number via
      // fmtM but passes a real range/text ("$20M to $50M", "Over $100M") through unchanged.
      + '<div id="mEstTop">'+((o.estRange&&String(o.estRange).trim())||o.est
          ? '<div class="vrange vrange-top vrange-fore" id="osec-value"><div class="vr-label">Estimated value</div><div class="vr-big">'+esc(foreVal(o))+'</div></div>'
          : '<div class="vrange vrange-top vrange-none" id="osec-value"><div class="vr-label">Estimated value</div><div class="vr-none-msg">No estimate published yet \\u2014 the agency forecast lists this requirement without a dollar figure.</div></div>')+'</div>'
      + '<div class="bf-grid" style="margin-top:6px">'+factRows+'</div>'
      + '</section>';
    // 2. SHOULD I PURSUE THIS? — the Track / Research / Start Capture card (forecast has no bid yet).
    // 3-5 stream in on-demand (loadForecastDetail) so the drawer opens instantly; each is a labelled
    // #osec slot so the tab rail resolves before the fetch lands.
    // 6 (Related) fills via loadCrossSellOpen into #xsellOpen.
    return overview
      + fcPursueSec(o)                                                                       // 2. Should I pursue this?
      + '<div id="fcOppBox"><div class="intel-load">Loading what they need\\u2026</div></div>'      // 3. Opportunity intelligence [async]
      + '<div id="fcMktBox"></div>'                                                          // 4. Market intelligence [async]
      + '<div id="fcBuyerBox"></div>'                                                        // 5. Buyer intelligence + Contacts [async]
      + '<div id="xsellOpen"></div>'                                                         // 6. Related opportunities [async]
      + fcPrepareSec(o)                                                                      // 7. Prepare to win
      + fcActions(o)                                                                         // 8. Actions (sticky bar)
      + '<div class="oppsoon">Planned/forecasted work. Details come from the agency procurement forecast and may change; confirm on SAM once the solicitation posts.</div>';
  }
  // 2. SHOULD I PURSUE THIS? (forecast) — a forecast is a CAPTURE decision, not a bid decision, so the
  // choices are Track / Research / Start Capture, NOT Bid/No-Bid (Eric 2026-08-05). Grounded, no LLM:
  // we lead with the same Opportunity Signals the open drawer shows (pursueSignals — the pin genome or
  // the forecast fallback), then the three early-capture moves, each wired to a real destination.
  function fcPursueSec(o){
    var pin=null; try{ pin=findRecompeteRow(o.nid||o.sol)||o; }catch(e){ pin=o; }
    var signals=''; try{ signals=pursueSignals(o,pin); }catch(e){ signals=''; }
    var moves='<div class="fc-moves">'
      + '<button class="fc-move" onclick="saveCurrentOpp(this)"><div class="fc-move-t">Track it</div><div class="fc-move-d">Get a heads-up the moment this posts as a real solicitation.</div></button>'
      + '<a class="fc-move" href="/opportunity-map/market?naics='+encodeURIComponent(o.naics||'')+'" target="_blank" rel="noopener"><div class="fc-move-t">Research the market</div><div class="fc-move-d">Who buys this, who holds it now, and what it pays \\u2014 before you commit.</div></a>'
      + '<button class="fc-move" onclick="startCapture(this)"><div class="fc-move-t">Start capture</div><div class="fc-move-d">Build your case early: reach the buyer, line up teaming, shape the requirement.</div></button>'
      + '</div>';
    var inner='<div class="pursue locked">'
      + (signals?('<div class="pursue-signals">'+signals+'</div>'):'')
      + '<div class="pursue-lock-body">'
      +   '<div class="pursue-unlock">A forecast is an <b>early-capture</b> play \\u2014 there is no bid to win yet. Pick your next move:</div>'
      +   moves
      + '</div>'
      + '</div>';
    return sec(ICON_TARGET+' Should I pursue this?',inner,'ai');
  }
  // 7. PREPARE TO WIN (forecast) — renamed from "Win This Contract" (Eric 2026-08-05). NOT the proposal
  // workspace (there is nothing to draft against yet). The honest early-capture checklist, each step a
  // real next action grounded in this forecast's data.
  function fcPrepareSec(o){
    var steps='<ol class="fc-steps">'
      + '<li><b>Track this buy</b> so you\\u2019re first to know when it hits SAM \\u2014 the 6\\u201318 month head start is the whole advantage.</li>'
      + '<li><b>Engage the buyer now.</b> Forecasts exist so you can shape the requirement before the RFP locks it. Use the contact below.</li>'
      + '<li><b>Study who holds it now</b> \\u2014 the incumbent is your displacement target. Know their scope, their ceiling, and where they\\u2019re weak.</li>'
      + '<li><b>Line up teaming</b> from the related open bids while you build past performance in this space.</li>'
      + '</ol>';
    return sec('Prepare to win',
      '<div class="xsell-note">Forecasts reward the contractor who starts early. Here\\u2019s how to be ready when it posts:</div>'
      + steps,
      // NO CTA pair here (Eric 2026-08-15: "the track this buy and research market under 4. seems
      // redundant"). Both actions already live in the STICKY ACTION BAR at the bottom of the
      // drawer (fcActions, #osec-actions) — which is always visible, so the duplicate sat a few
      // hundred pixels above an identical pair. It was also visibly UNSTYLED (a raw <button> and a
      // default-blue link): .fc-prep-cta has no rule, so the .b/.b.pri classes rendered naked
      // inside a section that doesn't carry the action-bar styles. One home for an action.
      'fcwin');
  }
  // 8. ACTIONS (forecast) — the sticky bar. A forecast has no SAM notice to open and nothing to draft
  // yet, so the ONLY workflow action is Track (the primary early-capture move). Save/Share/Hide live
  // in the TOP action row (owned by the drawer chrome) — deliberately NOT duplicated here, same clean
  // separation the open-opp actions() uses. id=osec-actions keeps it the sticky deep-link anchor.
  function fcActions(o){
    return '<div class="oact" id="osec-actions">'
      + '<button class="b pri" onclick="saveCurrentOpp(this)">Track this buy</button>'
      + '<a class="b" href="/opportunity-map/market?naics='+encodeURIComponent(o.naics||'')+'" target="_blank" rel="noopener">Research the market \\u2197</a>'
      + '</div>';
  }
  window.openOppDrawer=function(nid,force){
    if(!nid)return;
    // WHICH LISTINGS GET OPENED — the number the listing redesign has to be judged against.
    // Fired before the route decision below so it counts the intent, not just the successes.
    try{ if(window.__track) window.__track('tool_use','listing_open',{notice_id:String(nid)}); }catch(e){}
    // Route by the CLICKED PIN's source, NOT the global mode. The Opportunities map MERGES horizons
    // (SAM open + recompete + forecast), so window.__mapMode is always 'open' even for a recompete/
    // forecast pin — keying the drawer route off the mode meant recompete/forecast cards fetched
    // opportunity-detail with a non-SAM id and 404'd ("Couldn't load this opportunity"). Find the
    // pin in the loaded set and route by its src. (Eric 2026-08-01 / 2026-08-03.)
    // Find the CLICKED pin in the loaded set (works for force + non-force). We use it for source
    // routing below AND — critically — to seed the drawer's M-Estimate hero from the SAME number the
    // pin/card already shows (_pin.est = the canonical row's intel_value_range.median). The drawer's
    // own intel fetch can return a DIFFERENT median if the row recomputed between the pin fetch and
    // the click (Eric 2026-08-04: pin ≈$280K vs drawer $501,263 for JSAM RW MPU-5). Seeding the hero
    // from the pin guarantees "the same number on both" — the fetch then only enriches the band/basis.
    var _pin=null; try{ var _all=(window.OPPS||OPPS||[]); for(var _i=0;_i<_all.length;_i++){ var _o=_all[_i]; if(_o&&(String(_o.nid)===String(nid)||String(_o.sol)===String(nid))){ _pin=_o; break; } } }catch(e){}
    var _pinEst=(_pin&&typeof _pin.est==='number'&&_pin.est>0)?_pin.est:0;
    if(!force){
      var _src=_pin?_pin.src:null;
      // RECOMPETE pins build their detail from the row in hand (no SAM opp-intel fetch).
      if(_src==='RECOMPETE' || (!_pin && window.__mapMode==='recompete')){ window.openRecompeteDrawer(nid); return; }
      // FORECAST pins have NO opportunity-detail endpoint (fc- ids aren't sam_opportunities notice_ids)
      // and NO uiLink to open externally — the old window.open(uiLink) fell through to the fetch and
      // 404'd ("Couldn't load this opportunity"). Render the in-app forecast drawer from the row in
      // hand instead (planned-work detail, no fetch). (Eric 2026-08-03.)
      if(_src==='FORECAST' && _pin){ window.openForecastDrawer(nid); return; }
      // GRANTS still open their external source record (grants carry a real apply URL).
      if(_src==='GRANTS' && _pin){ var _u=_pin.uiLink||_pin.url; if(_u){ try{ window.open(_u,'_blank','noopener'); }catch(e){} return; } }
    }
    // Open-opps AND DLA both open the opp drawer (DLA pins resolve via the opportunity-detail dibbs
    // fallback → isDla:true → renderDla below). Other modes (companies/buyers) have their own drawers.
    // EXCEPT force=true (buyer-drawer opp link carries a real sam_opportunities notice_id).
    if(!force&&window.__mapMode&&window.__mapMode!=='open'&&window.__mapMode!=='dla')return;
    // MARKET ACTIVITY — instrument the "viewed" count. Fire ONCE here, at the point a REAL live-opp
    // drawer commits to opening (past the recompete/forecast/company/grants early-returns above, so
    // only genuine opportunity-detail opens count). page_view + action 'listing_view' + notice_id
    // rides in metadata (free JSONB — no new EventType, no migration); opportunity-detail's viewCount
    // reads metadata->>notice_id back. Guarded by nid (line 5497) so a null never logs. Not a
    // re-render path — openOppDrawer is the open entry point; the intel re-fetch below never re-enters it.
    try{ if(window.__track) window.__track('page_view','listing_view',{notice_id:String(nid)}); }catch(e){}
    if(window.__resetOppSave)window.__resetOppSave(); // clear any stale "Saved" from the previous opp
    dr.classList.remove('buyer-accent'); // non-buyer entity → blue accent
    clearTaskOrderPins();
    body.innerHTML='<div class="oppload">Loading\\u2026</div>';
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    fetch('/api/app/opportunity-detail?id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(d){
      if(!(d&&d.success&&d.opp)){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; return; }
      // ── DLA/DIBBS bid: a supply RFQ, priced by NSN+quantity and quoted on DIBBS — NOT a SAM
      // notice. Render the DLA-specific drawer (NSN/item/qty/unit/PR/spec + price-to-quote) and RETURN
      // — skip the SAM intel/M-Estimate/cross-sell/roster fetches, none of which apply (Eric 2026-07-31).
      // DLA drawer is a flat layout (no tabbed #osec sections), so DON'T call buildTabs() — it
      // scans for tab anchors and threw on the DLA markup, and the throw hit the outer .catch which
      // OVERWROTE the DLA body with "Couldn't load" (the bug). Guard renderDla too, just in case.
      if(d.opp.isDla){ try{ d.opp.nsnReference=d.nsnReference||null; body.innerHTML=renderDla(d.opp); }catch(e){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; } return; }
      body.innerHTML=render(d.opp,{bidFacts:d.bidFacts,similar:d.similar,trackingCount:d.trackingCount,savedCount:d.savedCount,viewCount:d.viewCount});
      buildTabs();
      // Seed the M-Estimate hero from the pin's est IMMEDIATELY (before the intel fetch), so the
      // drawer shows the SAME number as the pin/card instantly — no "Estimating…" flash, and no
      // chance of a different headline than the pin. The intel fetch below only adds the band/basis.
      if(_pinEst>0)fillMEstTop(null,_pinEst);
      resolveAttachmentNames(); // lazily swap "Document" placeholders for real filenames
      // "Ways to win this" — awarded contracts in the same NAICS + state (subcontract targets).
      loadCrossSellAwards(d.opp.naics||'',(d.opp.location&&d.opp.location.state)||'',d.opp.id||nid,d.opp.psc||'');
      // Second, on-demand fetch for the reused-intelligence sections (fail-soft). Also carries
      // cardFacts (SOW card facts, Tier 1) in the SAME response — one round trip for both.
      fetch('/api/app/opportunity-detail?intel=1&id='+encodeURIComponent(nid)).then(function(r){return r.json();}).then(function(x){
        var intel=(x&&x.success)?x.intel:{};
        // The HERO fills come FIRST, BEFORE the #intelBox guard (Eric 2026-08-04 bug: the hero
        // M-Estimate + M-Win stayed stuck on "Estimating…/Scoring…" because these fills sat AFTER
        // an if(!box)return, so a missing/renamed #intelBox aborted them even though the estimate
        // data was valid). The hero slots (#mEstTop / #mWinTop) are independent of #intelBox.
        // The fetched valueRange is authoritative (headline+band coherent); pinEst is only the pre-fetch
        // placeholder inside mEstTopHTML. M-Win scores on the SAME number the hero shows = the fetched
        // median when present, else the pin est.
        fillMEstTop(intel.valueRange,_pinEst);   // the PRICE leads the drawer (top slot) — always populated
        loadMWin(d.opp,intel.valueRange&&intel.valueRange.median?intel.valueRange:(_pinEst>0?{median:_pinEst}:intel.valueRange),_pin);
        // Upcoming events for THIS notice. Placed BEFORE the #intelBox guard on purpose — the
        // documented trap right above is that fills placed after that early return silently
        // abort when the slot is missing.
        loadOppEvents(d.opp);
        var box=document.getElementById('intelBox'); if(!box)return;
        // GOS invariant #10: the intel sections (Contract history · Know your buyer · Pricing) ALWAYS
        // render with a placeholder when empty — so even a failed/empty intel fetch gets renderIntel({})
        // (the constant skeleton), never a silent collapse. cardFacts is the ONE exception (SOW
        // card-facts are genuinely absent when the extractor found nothing — not a slot).
        box.innerHTML=(x&&x.success?cardFactsSec(x.cardFacts):'')+renderIntel(intel);
        buildTabs(); // intel sections just appeared → rebuild the tabs
        loadRoster(d.opp.department); // OTHER agency contacts to network with (BD roster)
      }).catch(function(){ fillMEstTop(null,_pinEst); fillMWinTop({grounded:false}); var box=document.getElementById('intelBox'); if(box)box.innerHTML=renderIntel({}); buildTabs(); loadRoster(d.opp.department); });
    }).catch(function(){ body.innerHTML='<div class="oppload">Couldn\\u2019t load this opportunity.</div>'; });
  };

  // ── Company (Contractor) detail ─────────────────────────────────────────────────────────
  // COMPOUND (GOS #9): the company drawer REPLICATES the opp drawer's shell (same action bar,
  // same sec()/buildTabs() section machinery, same sticky tabs, same Save/Share/Hide/More) and
  // modifies only the CONTENT for accuracy — award history, top agencies, NAICS, set-asides,
  // location, similar firms. Sections that are genuinely N/A for a firm (Bid facts / SOW facts /
  // Estimated value / Should-I-bid) are consciously DROPPED (GOS #9c); the primary CTA becomes a
  // company-appropriate one (View full profile / Add to targets / Find their contacts).
  // Data: ONE call to /api/app/company-detail?uei=, mirroring how opportunity-detail feeds opps.
  function companyMoney(n){ if(typeof n!=='number'||n<=0)return '\\u2014'; return n>=1e9?('$'+(n/1e9).toFixed(1)+'B'):n>=1e6?('$'+(n/1e6).toFixed(1)+'M'):n>=1e3?('$'+Math.round(n/1e3)+'K'):('$'+Math.round(n)); }
  function pct(n){ if(typeof n!=='number'||n<=0)return ''; var v=n<=1?n*100:n; return v<1?'<1%':(Math.round(v)+'%'); }
  var COMPANY_SA_COLOR={SDVOSB:'#10b981',SB:'#3b82f6','8A':'#a855f7',WOSB:'#ef4444',HZ:'#f59e0b'};
  // Zillow-parity activity row for the Companies drawer — "$X won across N awards", the firm's own
  // real activity signal (a company has no posted/closes dates; its equivalent is award VOLUME).
  // Appends the most-recent-award recency when recentAwards carries a dated entry (real field:
  // CompanyDetailAward.startDate). A per-firm tracking count is not reliably groundable today
  // (a UEI isn't user_pipeline's notice_id key) — omitted, never fabricated, per the same rule the
  // open-opp drawer applies (>=2 real rows only).
  function companyActivitySec(c,extra){
    var bits=[];
    if(c.totalObligated)bits.push(companyMoney(c.totalObligated)+' won across '+(c.awardCount||0).toLocaleString()+' award'+((c.awardCount||0)===1?'':'s'));
    var dates=(c.recentAwards||[]).map(function(a){return a&&a.startDate;}).filter(Boolean);
    var latest=null; for(var i=0;i<dates.length;i++){ var t=Date.parse(dates[i]); if(isFinite(t)&&(latest===null||t>latest))latest=t; }
    if(latest!==null){ var age=relTime(new Date(latest).toISOString()); if(age)bits.push('most recent award '+age); }
    var tc=extra&&extra.trackingCount; if(typeof tc==='number'&&tc>=2)bits.push(tc.toLocaleString()+' contractors tracking this');
    if(!bits.length)return '';
    return '<div class="snapactivity">'+bits.map(function(b){return '<span>'+esc(b)+'</span>';}).join('<span class="snapdot">\\u00b7</span>')+'</div>';
  }
  // Data-freshness + provenance for the Companies drawer — this is BigQuery award history, not a
  // live SAM feed, and company-detail carries no per-firm sync timestamp (unlike the recompete
  // row's last_synced_at), so the "updated" clause is simply omitted rather than fabricated.
  function companyFreshnessSec(c){
    var parts=['From USASpending / BigQuery award history'];
    if(c.uei)parts.push('UEI '+esc(c.uei));
    return '<div class="snapfresh">'+parts.join(' <span class="snapdot">\\u00b7</span> ')+'</div>';
  }
  // Top value slot for the Companies drawer — the Zillow price-placement pattern (mEstTopHTML),
  // but this is a REAL SUM (totalObligated, USASpending award history via BigQuery), not an
  // estimate: just the single headline number, no range/chart/methodology. id=osec-value so the
  // sticky "Value" tab targets it, same convention as the open-opp + Awarded drawers. GOS #10:
  // always renders — an honest "no federal awards on file" line when the firm has none.
  function companyValueTopHTML(c){
    if(c.totalObligated){
      // Parity with the open-opp value headline: the big number + a real "across N awards · M agencies"
      // subline (never fabricated — straight from awardCount/distinctAgencyCount).
      var sub='across '+((c.awardCount||0).toLocaleString())+' award'+((c.awardCount||0)===1?'':'s')
        + ' \\u00b7 '+((c.distinctAgencyCount||0).toLocaleString())+' agenc'+((c.distinctAgencyCount||0)===1?'y':'ies');
      return '<div class="vrange vrange-top" id="osec-value">'
        + '<div class="vr-label">Total federal awards won</div>'
        + '<div class="vr-big">'+esc(companyMoney(c.totalObligated))+'</div>'
        + '<div class="vr-sub" style="font:400 12.5px Inter,system-ui,sans-serif;color:var(--sub);margin-top:5px">'+esc(sub)+'</div>'
        + '</div>';
    }
    return '<div class="vrange vrange-top vrange-none" id="osec-value">'
      + '<div class="vr-label">Total federal awards won</div>'
      + '<div class="vr-none-msg">No federal award history on file for this firm.</div>'
      + '</div>';
  }
  // Company header — name, location, set-aside chips, $ won / # awards / # agencies (all real).
  // M-Scale™ methodology — the drawer explainer for the tier pill, styled like the M-Estimate™
  // "How we calculate this" toggle (Eric 2026-07-28). States plainly that it's Mindy's estimate
  // from real federal $ won, the exact bands, and that it is NOT an official SBA size determination.
  function companyScaleMethodology(c){
    var tier=window.companyScaleTier(c.totalObligated); if(!tier)return '';
    return '<div class="vr-how" style="margin-top:8px"><button class="vr-how-toggle" onclick="var o=this.nextElementSibling.classList.toggle(\\'open\\');this.textContent=(o?\\'\\u25be \\':\\'\\u25b8 \\')+\\'How we calculate M-Scale\\u2122\\';">\\u25b8 How we calculate M-Scale\\u2122</button>'
      + '<div class="vr-how-body"><b>M-Scale\\u2122</b> is Mindy\\u2019s own read of a firm\\u2019s federal footprint \\u2014 based on total obligated dollars won across all federal awards in our data (USASpending). We band it: <b>Top tier</b> \\u2265 $100M \\u00b7 <b>Mid</b> $10M\\u2013$100M \\u00b7 <b>Emerging</b> &lt; $10M. It updates as new award data comes in. '
      + 'It is a rough scale cue to help you gauge who you\\u2019re looking at \\u2014 it is <b>NOT</b> an official SBA small/large business size determination (SBA size is set by annual receipts or employee count, which we don\\u2019t hold), and not a rating of the firm\\u2019s quality.</div></div>';
  }
  // The honest cert-source line for the company drawer (Eric #3 on the map). Splits the firm's certs
  // into SBA-certified (authoritative — 8(a)/HUBZone) vs SAM self-identified (SDVOSB/WOSB) and states
  // it plainly, so a self-cert is never presented as the authoritative SBA VetCert determination.
  // Returns '' when there's no provenance (nothing to disclose).
  function companyCertProvenanceNote(c){
    var pv=c.certProvenance; if(!pv||!pv.length)return '';
    var selfCerts=pv.filter(function(p){return !p.authoritative;}).map(function(p){return esc(p.cert);});
    if(!selfCerts.length)return ''; // all authoritative → no caveat needed
    return '<div class="ai-note" style="margin-top:8px">'
      + esc(selfCerts.join(' & '))+' '+(selfCerts.length>1?'are':'is')+' <b>SAM self-identified</b> \\u2014 not the authoritative SBA VetCert determination. '
      + '8(a) and HUBZone (when shown) come from SBA-certified records.</div>';
  }
  function companyHead(c){
    var chips=(c.setAsides||[]).map(function(k,i){ var col=COMPANY_SA_COLOR[k]||'#7c3aed'; var lbl=(c.setAsideLabels&&c.setAsideLabels[i])||k;
      return '<span class="ws-tag" style="background:'+col+';color:#fff;border-color:transparent">'+esc(lbl)+'</span>'; }).join('');
    // The SINGLE authoritative "(approximate)" location disclosure for the Companies dataset
    // (Eric 2026-07-26: drawer-only, never on the pin/list/popup). locApprox is true when the map
    // placed this firm at its STATE centroid (no confirmed city) — disclosed plainly here.
    var locApprox = c.locApprox && c.location;
    var head='<div class="snaphero"><span class="badge-nt" style="background:#f3eefe;color:#7c3aed">Contractor</span>'
      + (c.location?'<span class="badge-dl cool" style="background:#f0fdf7;color:#22a06b">'+esc(c.location)+'</span>':'')+'</div>'
      + '<div class="snapt">'+esc(c.name)+'</div>'
      + '<div class="snapmeta">'+(c.cageCode?'CAGE '+esc(c.cageCode)+' \\u00b7 ':'')+'UEI '+esc(c.uei)+'</div>'
      + (locApprox?'<div class="ai-note" style="margin-top:6px">Location: '+esc(c.location)+' \\u2014 approximate (based on state, not a confirmed address).</div>':'')
      + (chips?'<div class="whatspecial" style="margin-top:10px">'+chips+'</div>':'')
      // Cert PROVENANCE note (Eric #3 on the map, 2026-07-28) — the honest "how do we know this cert"
      // detail, in the DRAWER (chips stay clean). 8(a)/HUBZone come from SBA-certified SAM codes;
      // SDVOSB/WOSB from SAM's SELF-IDENTIFIED field, so we say so rather than imply VetCert-verified.
      + companyCertProvenanceNote(c);
    // Primary buyer — the firm's #1 agency (real top row), so the grid tells the "who they sell to"
    // story at a glance like Open's Set-aside/NAICS cells.
    var topAg=(c.topAgencies&&c.topAgencies[0]&&c.topAgencies[0].agency)||'';
    // Active-since span from real first/last award dates (year only — honest, never fabricated).
    var yr=function(d){ var m=String(d||'').match(/(\\d{4})/); return m?m[1]:''; };
    var fy=yr(c.firstActionDate), ly=yr(c.lastActionDate);
    var activeSpan=fy?(fy+(ly&&ly!==fy?'\\u2013'+ly:'')):'';
    // Expanded 6-cell key-facts grid (was 4) — matches Open's grid density. Every cell real:
    // Total won · Awards · Agencies · NAICS worked · Active since (first\u2013last award year) · Top agency.
    // M-Scale™ tier — the same branded Mindy estimate the list card's pill shows, given a real cell
    // here with a "how we calculate this" toggle (Eric 2026-07-28: "say it's a Mindy estimate like
    // M-Win value, explain how we arrive at it in the full drawer"). Cell hidden when total is 0.
    var scaleTier=window.companyScaleTier(c.totalObligated);
    head += '<div class="snapgrid" style="margin-top:12px">'
      + '<div><div class="k">Total won</div><div class="v">'+esc(companyMoney(c.totalObligated))+'</div></div>'
      + '<div><div class="k">Awards</div><div class="v">'+esc((c.awardCount||0).toLocaleString())+'</div></div>'
      + '<div><div class="k">Agencies sold to</div><div class="v">'+esc((c.distinctAgencyCount||0).toLocaleString())+'</div></div>'
      + '<div><div class="k">NAICS worked</div><div class="v">'+esc((c.distinctNaicsCount||0).toLocaleString())+'</div></div>'
      + '<div><div class="k">Active since</div><div class="v">'+esc(activeSpan||'\\u2014')+'</div></div>'
      + (scaleTier
          ? '<div><div class="k">M-Scale\\u2122</div><div class="v">'+esc(scaleTier)+'</div></div>'
          : '<div><div class="k">Primary buyer</div><div class="v">'+esc(topAg||'\\u2014')+'</div></div>')
      + '</div>'
      + (scaleTier?companyScaleMethodology(c):'');
    // Zillow-parity Overview: activity row ("$X won across N awards") + data-freshness/source line
    // — the SAME pattern the open-opp drawer shipped in #498, adapted for a contractor firm. The
    // headline value block sits right after Overview (mirroring Open's osec-value placement).
    return '<section class="osec" id="osec-overview">'+head+companyActivitySec(c,{})+companyFreshnessSec(c)+'</section>'
      + '<div id="mEstTop">'+companyValueTopHTML(c)+'</div>';
  }
  // Top agencies they sell to — the agency breakdown ($ + share bar), reused from the drawer's
  // rateChart/scoreBar visual language (horizontal bars scaled to the top agency's $).
  function companyAgenciesSec(c){
    var ags=(c.topAgencies||[]).slice(0,8);
    if(!ags.length)return sec('Top agencies they sell to',empty('No agency award breakdown on file for this firm.'),'agencies');
    var max=Math.max.apply(null,ags.map(function(a){return a.amount||0;}).concat([1]));
    var rows=ags.map(function(a){ var w=Math.max(6,Math.round((a.amount||0)/max*100));
      return '<div class="rc-row"><div class="rc-lbl">'+esc(a.agency||'\\u2014')+(a.share?' <span class="rc-sz">'+esc(pct(a.share))+'</span>':'')+'</div>'
        + '<div class="rc-bar"><i style="width:'+w+'%;background:#7c3aed"></i></div>'
        + '<div class="rc-val">'+esc(companyMoney(a.amount))+'</div></div>'; }).join('');
    return sec('Top agencies they sell to','<div class="ratechart">'+rows+'</div>','agencies');
  }
  // Know your buyer · agency intel (gap 6) — the SAME "Know your buyer" section the opp drawer
  // renders (agency priorities + pain points), keyed on the firm's #1 (top-$) agency. Data comes
  // from company-detail's agencyIntel (getUnifiedAgencyIntelligence). Fail-soft: no intel → the
  // section returns '' and collapses silently (never a dead/empty block).
  function companyAgencyIntelSec(c){
    var intel=c.agencyIntel;
    if(!intel||(!(intel.priorities&&intel.priorities.length)&&!(intel.painPoints&&intel.painPoints.length)))
      return sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',empty('Agency intel not available for this firm\\u2019s top buyer.'),'agencyintel');
    var inner='<div class="roster-note">Priorities &amp; pain points for '+esc(intel.agency||'their top agency')+' \\u2014 the buyer this firm sells to most.</div>';
    if(intel.priorities&&intel.priorities.length)inner+='<div class="ai-lab">Agency priorities</div>'+ul(intel.priorities);
    if(intel.painPoints&&intel.painPoints.length)inner+='<div class="ai-lab">Known pain points</div>'+ul(intel.painPoints);
    return sec(ICON_LANDMARK+' Buyer intelligence \\u00b7 agency priorities',inner,'agencyintel');
  }
  // NAICS / what they do — the firm's top codes by $ (name, not just number).
  function companyNaicsSec(c){
    var ns=(c.topNaics||[]).slice(0,8);
    if(!ns.length)return sec('What they do \\u00b7 NAICS',empty('No NAICS breakdown on file for this firm.'),'naics');
    var rows=ns.map(function(n){ return '<div class="bf-row"><div class="bf-k">'+esc(n.naics)+(n.description?' \\u00b7 '+esc(n.description):'')+'</div><div class="bf-v">'+esc(companyMoney(n.amount))+'</div></div>'; }).join('');
    return sec('What they do \\u00b7 NAICS','<div class="bf-grid">'+rows+'</div>','naics');
  }
  // Set-asides they hold — real award-derived eligibility (never a fabricated "Open"/"None").
  function companySetAsideSec(c){
    var sa=c.setAsides||[];
    if(!sa.length)return sec('Set-asides they hold',empty('No set-aside awards on file \\u2014 this firm wins on full-and-open work (or none recorded yet).'),'setasides');
    var chips=sa.map(function(k,i){ var col=COMPANY_SA_COLOR[k]||'#7c3aed'; var lbl=(c.setAsideLabels&&c.setAsideLabels[i])||k;
      return '<span class="ws-tag" style="background:'+col+';color:#fff;border-color:transparent">'+esc(lbl)+'</span>'; }).join('');
    return sec('Set-asides they hold','<div class="whatspecial">'+chips+'</div><div class="ai-note">Derived from set-aside awards this firm has actually won (USASpending) \\u2014 real eligibility, not a registration claim.</div>','setasides');
  }
  // Award history · what they've won — the recent awards timeline (title · agency · $ · date).
  // Award history, in the SAME format as the Awarded-contract "Actual task-order spend" block
  // (Eric 2026-07-27: "the award history for contacts should look more like that graph format"):
  // a summary banner (total won · N awards · M agencies) + a bar-chart-over-time (payout rhythm) +
  // the dated award ledger. Reuses bucketedChart by mapping each award's
  // {amount,startDate} → the {obligation,actionDate} shape the chart expects. Every figure real
  // (recentAwards from USASpending/BigQuery) — no fabrication.
  var CO_AW_VISIBLE=9;
  function companyAwardsSec(c){
    var aw=(c.recentAwards||[]); if(!aw.length)return sec('Award history \\u00b7 what they\\u2019ve won',empty('No award records on file for this firm.'),'awards');
    // Adapt awards → the chart's txn shape (obligation/actionDate) so the SAME bar chart renders.
    var txns=aw.map(function(a){ return { obligation:a.amount, actionDate:a.startDate }; });
    // Summary banner: firm-level totals (real fields), mirroring the task-order "Actually obligated"
    // banner. Total won is the headline; the count + agencies give the same "N task orders · M
    // locations" rhythm line.
    var summary='<div class="rc-actual">'
      + '<div><div class="rc-actual-v">'+esc(companyMoney(c.totalObligated))+'</div>'
      + '<div class="rc-actual-k">Total won \\u00b7 '+esc((c.awardCount||0).toLocaleString())+' award'+((c.awardCount||0)===1?'':'s')
      + ((c.distinctAgencyCount||0)?' \\u00b7 '+esc((c.distinctAgencyCount||0).toLocaleString())+' agenc'+((c.distinctAgencyCount||0)===1?'y':'ies'):'')+'</div></div>'
      + ((c.distinctNaicsCount||0)?'<div class="rc-ceil"><div class="rc-ceil-v">'+esc((c.distinctNaicsCount||0).toLocaleString())+'</div><div class="rc-ceil-k">NAICS worked</div></div>':'')
      + '</div>';
    // The dated award ledger — most recent first, capped with a "show all" expander like task orders.
    var ordered=aw.slice().sort(function(a,b){ var ta=a&&a.startDate?Date.parse(a.startDate):0, tb=b&&b.startDate?Date.parse(b.startDate):0; return (tb||0)-(ta||0); });
    function awRow(a){
      var meta=[a.agency,(a.startDate?longDate(a.startDate):'')].filter(Boolean).join(' \\u00b7 ');
      var t=a.url?('<a href="'+esc(a.url)+'" target="_blank" rel="noopener">'+esc(a.title||'Award')+'</a>'):esc(a.title||'Award');
      return '<div class="ocontact"><div class="nm">'+t+'</div>'
        + '<div class="ti">'+esc(meta)+(a.naicsDescription?' \\u00b7 '+esc(a.naicsDescription):'')+'</div>'
        + '<div class="row"><b>'+esc(companyMoney(a.amount))+'</b></div></div>';
    }
    var head=ordered.slice(0,CO_AW_VISIBLE).map(awRow).join('');
    var rest=ordered.slice(CO_AW_VISIBLE), restHtml='';
    if(rest.length){
      restHtml='<div class="rc-to-rest" id="coAwRest">'+rest.map(awRow).join('')+'</div>'
        + '<button class="rc-to-more" onclick="var r=document.getElementById(\\'coAwRest\\');var o=r.classList.toggle(\\'open\\');this.textContent=o?\\'\\u25be Show fewer\\':\\'\\u25b8 Show all '+ordered.length+' awards\\';">\\u25b8 Show all '+ordered.length+' awards</button>';
    }
    // summary + bucketed bar-chart (readable $ per period; falls back to '' for <2 periods) + ledger.
    var inner=summary+bucketedChart(txns,'Award $ by year',true)+'<div class="rc-to-list">'+head+restHtml+'</div>';
    return sec('Award history \\u00b7 what they\\u2019ve won',inner,'awards');
  }
  // Similar companies — the opp drawer's "Similar opportunities" analog (same clickable-card
  // flywheel), wired to open THIS drawer for the peer firm.
  function companySimilarSec(c){
    var sims=(c.similar||[]).slice(0,6);
    if(!sims.length)return sec('Similar companies',empty('No similar firms found for this NAICS.'),'similar');
    var cards=sims.map(function(s){
      return '<button class="sim-card" onclick="openCompanyDrawer(\\''+esc(s.uei)+'\\')">'
        + '<span class="sim-sa">Contractor</span>'
        + '<div class="sim-t">'+esc(s.name)+'</div>'
        + '<div class="sim-m">'+esc(companyMoney(s.totalObligated))+' won</div>'
        + '</button>';
    }).join('');
    return sec('Similar companies','<div class="sim-grid">'+cards+'</div>','similar');
  }
  // Primary actions (replaces the opp drawer's Save-to-pursuits / Draft): View full profile
  // (\u2192 /contractors/[slug]) · Add to targets · Find their contacts (the agencies they sell to).
  function companyActions(c){
    return '<div class="oact">'
      + '<a class="b pri" href="/contractors/'+encodeURIComponent(c.slug)+'" target="_blank" rel="noopener">View full profile \\u2197</a>'
      + '<button class="b" onclick="saveCurrentCompany(this)">Add to targets</button>'
      + (c.topAgencies&&c.topAgencies.length?'<a class="b" href="/app?panel=contacts&agency='+encodeURIComponent(c.topAgencies[0].agency||'')+'" target="_blank" rel="noopener">Find their contacts</a>':'')
      + '</div>';
  }
  // "Add to targets" secondary button — mirrors the opp drawer's saveCurrentOpp, but saves the
  // company via /api/opportunities/save (source=company_map). Idempotent + optimistic label.
  window.saveCurrentCompany=function(btn){
    if(!CUR||CUR.kind!=='company'||btn.dataset.saved==='1')return;
    var a=window.requireSignIn('add this company to your targets'); if(!a)return;
    btn.textContent='Saving\\u2026';
    fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
      body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'company_map',
        opportunityData:{noticeId:CUR.id,entityType:'company',uei:CUR.id,title:CUR.title,department:CUR.department,agency:CUR.department}})})
      .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
        var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
        if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In targets':'\\u2713 Added'; btn.classList.add('saved'); btn.dataset.saved='1'; }
        else btn.textContent='Try again';
      }).catch(function(){ btn.textContent='Try again'; });
  };
  function companyRender(c){
    // CUR mirrors the opp drawer's CUR so the shared action bar (Save/Share/Hide/More) works.
    // kind='company' routes Save → /api/opportunities/save; uiLink → the full contractor profile
    // (so "More" opens it); title/department feed the save snapshot + "Find their contacts".
    CUR={ kind:'company', id:c.uei, title:c.name, department:(c.topAgencies&&c.topAgencies[0]&&c.topAgencies[0].agency)||'',
      solicitation:'', naics:(c.topNaics&&c.topNaics[0]&&c.topNaics[0].naics)||'', deadline:'', sol:c.uei,
      uiLink:'/contractors/'+encodeURIComponent(c.slug) };
    return companyHead(c)
      + companyAwardsSec(c)      // what they've won (the headline value)
      + companyAgenciesSec(c)    // who they sell to
      + companyAgencyIntelSec(c) // know your buyer · agency intel for their #1 agency (gap 6)
      + companyNaicsSec(c)       // what they do
      + companySetAsideSec(c)    // eligibility they hold
      + companySimilarSec(c)     // the flywheel — peer firms
      + companyActions(c);
  }
  // Honest drawer failure text (Eric 2026-08-13). Every failure mode used to render the SAME
  // sentence — "Couldn\u2019t load this company." — for a 401, a 404 and a dropped connection
  // alike. That is actively misleading in the signed-out case (it blames the company for an auth
  // problem) and it cost real diagnosis time: a stale client passing a NAME instead of a UEI
  // 404'd, and the message was indistinguishable from an expired session.
  //   401/403 → your session, with a way back in     404 → we genuinely have no profile row
  //   0       → the network dropped (fetch threw)    else → surface the status, don't hide it
  // The "what" arg is the noun ('company'/'buyer') so one helper serves both drawers.
  // (No backticks anywhere in this block — it lives inside a template literal, so one would
  // terminate the string and break the build.)
  // Reopen the drawer after a successful sign-in; falls back to /app when the modal isn't present.
  window.__drawerSignIn=function(){
    if(window.openSignInModal){ openSignInModal('view this record',function(){ location.reload(); }); }
    else { location.href='/app?next=%2Fopportunity-map'; }
  };
  function drawerLoadError(status,what){
    if(status===401||status===403){
      // No nested quotes in the handler — it calls a global taking no arguments. Escaping a
      // string literal through THREE layers (TS template -> emitted JS -> HTML attribute) is how
      // this line broke the build the first time; a bare call has nothing left to escape.
      return '<div class="oppload">Your session expired. <button class="lnkbtn" onclick="window.__drawerSignIn&&window.__drawerSignIn()">Sign in</button> to view this '+what+'.</div>';
    }
    if(status===404){
      // Honest, and specific: the profile table lags the weekly awards ingest, so a real firm can
      // have awards with no profile row yet. Never imply the firm does not exist.
      return '<div class="oppload">We don\\u2019t have a profile for this '+what+' yet.</div>';
    }
    if(!status){ return '<div class="oppload">Network hiccup \\u2014 try opening it again.</div>'; }
    return '<div class="oppload">Couldn\\u2019t load this '+what+' (error '+status+').</div>';
  }
  window.openCompanyDrawer=function(uei){
    if(!uei)return;
    // Guard = "not on the Opportunities map", NOT "mode is exactly companies". The Network map
    // MERGES companies + buyers onto ONE map but keeps MODE==='companies' (see MODES/_pen), so an
    // equality check here made every card of the OTHER type a DEAD CLICK. Allow either contact mode.
    if(window.__mapMode&&window.__mapMode!=='companies'&&window.__mapMode!=='buyers')return;
    if(window.__resetOppSave)window.__resetOppSave(); // clear any stale "Saved" from a prior entity
    dr.classList.remove('buyer-accent'); // company → blue accent (buyers are red)
    clearTaskOrderPins();
    // Pass the pin's geocoded city/state through (fallback location when the BQ profile row is
    // blank). Look the row up in the live set by its id (=UEI).
    var city='',state='';
    try{ var o=(typeof OPPS!=='undefined'&&OPPS)?OPPS.find(function(x){return x&&(String(x.nid)===String(uei)||String(x.sol)===String(uei));}):null;
      if(o&&o.loc){ var parts=String(o.loc).split(','); if(parts.length===2){ city=parts[0].trim(); state=parts[1].trim(); } else { state=parts[0].trim(); } } }catch(e){}
    var em=''; try{ var t=localStorage.getItem('mi_beta_auth_token'); var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    body.innerHTML='<div class="oppload">Loading\\u2026</div>';
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    var url='/api/app/company-detail?uei='+encodeURIComponent(uei)+(city?'&city='+encodeURIComponent(city):'')+(state?'&state='+encodeURIComponent(state):'')+(em?'&email='+encodeURIComponent(em):'');
    var ch={}; try{ var tk=localStorage.getItem('mi_beta_auth_token')||''; if(tk)ch['x-mi-auth-token']=tk; }catch(e){} if(em)ch['x-user-email']=em;
    // Carry the STATUS through with the body — r.json() alone throws it away, which is exactly
    // why every failure collapsed into one message. A non-JSON error page must not become a
    // throw either, or a 502 would report as a network drop.
    fetch(url,{headers:ch}).then(function(r){ return r.json().catch(function(){return null;}).then(function(d){ return {s:r.status,d:d}; }); }).then(function(res){
      var d=res.d;
      if(!(d&&d.success&&d.company)){ body.innerHTML=drawerLoadError(res.s,'company'); return; }
      // Attach cert provenance (Eric #3 on the map) so the drawer can label SBA-certified vs SAM
      // self-identified per set-aside — the response carries it alongside .company, not inside it.
      if(d.cert_provenance)d.company.certProvenance=d.cert_provenance;
      body.innerHTML=companyRender(d.company);
      buildTabs();
    }).catch(function(){ body.innerHTML=drawerLoadError(0,'company'); });
  };

  // ── Gov Buyer (Government decision-maker) detail ────────────────────────────────────────────
  // COMPOUND (GOS #9): the buyer drawer REPLICATES the opp/company drawer shell VERBATIM (same
  // oppDrawer/oppBody DOM, same action bar, same sec()/buildTabs() machinery, same sticky tabs,
  // same drawer CSS) and modifies only the CONTENT for a PERSON (GOS #9b): who they are · the
  // OPPORTUNITIES THEY RUN (their most useful section — "what are they buying") · their office /
  // agency intel · how to reach them + other contacts at this agency (the roster) · contact info.
  // Sections that are genuinely N/A for a person are consciously DROPPED (GOS #9c): Bid facts,
  // SOW, Estimated value, set-aside chips, "Should I bid?" — meaningless for a buyer. The CTAs
  // become buyer-appropriate: See their opportunities · Add to CRM · Find similar buyers.
  // Data: ONE call to /api/app/buyer-detail?id=, mirroring company-detail/opportunity-detail.
  function buyerNoticeBadge(o){
    var nt=(o.noticeType||'').trim(); if(!nt)return '';
    return '<span class="badge-nt">'+esc(nt)+'</span>';
  }
  // Zillow-parity activity row for the Gov Buyer drawer — a buyer isn't priced, so the real
  // activity signal is HOW MUCH they're currently buying: "Runs N open solicitations" (real field:
  // b.opportunities[].active, counted the same way buyerOppsSec's own "N still open" note does).
  // A per-buyer tracking count is not reliably groundable today ("Add to CRM" saves via
  // /api/opportunities/save?source=buyer_map keyed on the federal_contacts id, not a shared
  // notice_id) — omitted, never fabricated, matching the same >=2-only rule as the open-opp drawer.
  function buyerActivitySec(b,extra){
    var bits=[];
    var open=(b.opportunities||[]).filter(function(o){return o&&o.active;}).length;
    if(open>0)bits.push('Runs '+open.toLocaleString()+' open solicitation'+(open===1?'':'s'));
    else if((b.oppCount||0)>0)bits.push((b.oppCount||0).toLocaleString()+' solicitation'+((b.oppCount||0)===1?'':'s')+' on record');
    var tc=extra&&extra.trackingCount; if(typeof tc==='number'&&tc>=2)bits.push(tc.toLocaleString()+' contractors tracking this');
    if(!bits.length)return '';
    return '<div class="snapactivity">'+bits.map(function(x){return '<span>'+esc(x)+'</span>';}).join('<span class="snapdot">\\u00b7</span>')+'</div>';
  }
  // Data-freshness + provenance for the Gov Buyer drawer — sourced from SAM.gov contact records
  // (federal_contacts), not USASpending. No per-contact sync timestamp is exposed by
  // getBuyerDetail today, so the "updated" clause is simply omitted rather than fabricated.
  function buyerFreshnessSec(b){
    var parts=['From SAM.gov contact records'];
    if(b.agency)parts.push(esc(b.agency));
    return '<div class="snapfresh">'+parts.join(' <span class="snapdot">\\u00b7</span> ')+'</div>';
  }
  // Buyer header — name · role/title · agency · office · location + contact info.
  function buyerHead(b){
    var loc = b.location ? b.location : '';
    var head='<div class="snaphero"><span class="badge-nt" style="background:#fdecec;color:#dc2626">Government buyer</span>'
      + (loc?'<span class="badge-dl cool" style="background:#f0fdf7;color:#22a06b">'+esc(loc)+'</span>':'')+'</div>'
      + '<div class="snapt">'+esc(b.name)+'</div>'
      + '<div class="snapmeta">'+esc(b.role||'Primary Contact')+(b.title&&b.title!==b.role?' \\u00b7 '+esc(b.title):'')+'</div>'
      + (b.locApprox&&loc?'<div class="ai-note" style="margin-top:6px">Location: '+esc(loc)+' \\u2014 approximate (from the notices they\\u2019re named on, not a confirmed office address).</div>':'')
      + '<div class="snapgrid" style="margin-top:12px">'
      + '<div><div class="k">Agency</div><div class="v">'+esc(b.agency||'\\u2014')+'</div></div>'
      + '<div><div class="k">Office</div><div class="v">'+esc(b.office||'\\u2014')+'</div></div>'
      + '<div><div class="k">Opportunities they run</div><div class="v">'+esc((b.oppCount||0).toLocaleString())+'</div></div>'
      + '<div><div class="k">Role</div><div class="v">'+esc(b.role||'Primary Contact')+'</div></div>'
      + '</div>';
    // Zillow-parity Overview: activity row ("Runs N open solicitations") + data-freshness/source
    // line — the SAME pattern the open-opp drawer shipped in #498. No value block here (GOS #9c:
    // a person isn't priced — genuinely N/A, consciously omitted, not just forgotten).
    return '<section class="osec" id="osec-overview">'+head+buyerActivitySec(b,{})+buyerFreshnessSec(b)+'</section>';
  }
  // The opportunities they run — the solicitations/opps this POC is NAMED ON. The buyer's most
  // useful section ("what are they buying"). Reuses the federal_contacts\u21c8sam_opportunities join.
  // Each row opens the OPP drawer (openOppDrawer) when it has a notice_id — the flywheel back to opps.
  function buyerOppsSec(b){
    var os=(b.opportunities||[]).slice(0,20);
    if(!os.length)return sec('The opportunities they run',empty('No solicitations name this contact right now.'),'buyeropps');
    var open=os.filter(function(o){return o.active;}).length;
    var note='<div class="roster-note">'+esc(String(b.oppCount||os.length))+' solicitation'+((b.oppCount||os.length)===1?'':'s')+' name this contact'+(open?' \\u00b7 '+open+' still open':'')+'.</div>';
    var rows=os.map(function(o){
      var meta=[o.solicitationNumber,(o.deadline?('Closes '+longDate(o.deadline)):(o.posted?('Posted '+longDate(o.posted)):''))].filter(Boolean).join(' \\u00b7 ');
      var t=o.noticeId
        ? '<button class="sim-t" style="all:unset;cursor:pointer;color:var(--ink);font-weight:700" onclick="window.openOppDrawer&&openOppDrawer(\\''+esc(o.noticeId)+'\\',true)">'+esc(o.title)+'</button>'
        : (o.uiLink?'<a href="'+esc(o.uiLink)+'" target="_blank" rel="noopener">'+esc(o.title)+'</a>':esc(o.title));
      return '<div class="ocontact"><div class="nm">'+t+'</div>'
        + '<div class="ti">'+buyerNoticeBadge(o)+' '+esc(meta)+'</div>'
        + (o.naics||o.setAside?'<div class="row" style="color:var(--sub)">'+[o.naics?('NAICS '+esc(o.naics)):'',o.setAside?esc(o.setAside):''].filter(Boolean).join(' \\u00b7 ')+'</div>':'')
        + '</div>';
    }).join('');
    return sec('The opportunities they run',note+rows,'buyeropps');
  }
  // Their office / agency — the buying office + agency priorities/pain points (reuses the same
  // getUnifiedAgencyIntelligence the opp drawer's "Know your buyer" section uses).
  function buyerAgencySec(b){
    var intel=b.agencyIntel;
    var inner='<div class="bf-grid">'
      + '<div class="bf-row"><div class="bf-k">Agency</div><div class="bf-v">'+esc(b.agency||'\\u2014')+'</div></div>'
      + '<div class="bf-row"><div class="bf-k">Buying office</div><div class="bf-v">'+esc(b.office||'\\u2014')+'</div></div>'
      + '</div>';
    if(intel&&intel.priorities&&intel.priorities.length){
      inner+='<div class="osec-sub" style="margin-top:14px">Agency priorities</div><ul class="bf-ul">'+intel.priorities.map(function(p){return '<li>'+esc(p)+'</li>';}).join('')+'</ul>';
    }
    if(intel&&intel.painPoints&&intel.painPoints.length){
      inner+='<div class="osec-sub" style="margin-top:10px">Pain points</div><ul class="bf-ul">'+intel.painPoints.map(function(p){return '<li>'+esc(p)+'</li>';}).join('')+'</ul>';
    }
    return sec('Their office \\u00b7 agency intel',inner,'buyeragency');
  }
  // How to reach them — the buyer's own contact info (email/phone where present). Honors the
  // phone-as-name guard #462 upstream (the API filters placeholder names before they reach here).
  function buyerContactSec(b){
    if(!b.email&&!b.phone)return sec('How to reach them',empty('No direct email or phone is on file for this contact.'),'buyercontact');
    var inner='<div class="ocontact"><div class="nm">'+esc(b.name)+'</div>'
      + (b.title?'<div class="ti">'+esc(b.title)+'</div>':'')
      + '<div class="row">'
      + (b.email?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> <a href="mailto:'+esc(b.email)+'">'+esc(b.email)+'</a>':'')
      + (b.email&&b.phone?' \\u00b7 ':'')+(b.phone?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg> '+esc(b.phone):'')
      + '</div></div>';
    return sec('How to reach them',inner,'buyercontact');
  }
  // Other contacts at this office — the roster (reuses the same federal_contacts roster the opp
  // drawer's "Other contacts at this agency" section uses). Who else to build a relationship with.
  function buyerRosterSec(b){
    var rs=(b.roster||[]).slice(0,8);
    if(!rs.length)return sec('Other contacts at this office \\u00b7 who to network with',empty('No additional contacts found at '+esc(b.agency||'this agency')+'.'),'buyerroster');
    var cards=rs.map(function(c){
      return '<div class="roster-card"><div class="nm">'+esc(c.name)+'</div>'+(c.title?'<div class="ti">'+esc(c.title)+'</div>':'')
        + '<div class="row">'+(c.email?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> <a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'')+(c.email&&c.phone?' \\u00b7 ':'')+(c.phone?'<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg> '+esc(c.phone):'')+'</div></div>';
    }).join('');
    return sec('Other contacts at this office \\u00b7 who to network with','<div class="roster-note">People at '+esc(b.agency||'this agency')+' to build a relationship with (beyond this buyer).</div><div class="roster-grid">'+cards+'</div>','buyerroster');
  }
  // Similar buyers (gap 7) — a real clickable peer-card flywheel like the opp drawer's similarSec()
  // / company drawer's companySimilarSec(), NOT a CTA link. Peers = OTHER contacts at the same
  // agency/office (buyerSimilarPeers picks from b.roster — already loaded same-agency contacts —
  // with a valid federal_contacts id so the card can open THAT buyer's drawer). Reuses .sim-card.
  // buyerSimilarPeers is the pure filter, unit-tested via buyer-similar.unit.test.ts.
  function buyerSimilarPeers(b,limit){
    limit=limit||6;
    var self=String((b&&b.id)||''), out=[], seen={};
    var rs=(b&&b.roster)||[];
    for(var i=0;i<rs.length;i++){ var c=rs[i]; if(!c)continue;
      var id=String(c.id||''); if(!id||id===self||seen[id])continue;   // need a real id + not self
      if(!c.name)continue;
      seen[id]=1; out.push(c);
      if(out.length>=limit)return out;
    }
    return out;
  }
  function buyerSimilarSec(b){
    var peers=buyerSimilarPeers(b,6);
    if(!peers.length)return sec('Similar buyers',empty('No other decision-makers found at '+esc(b.agency||'this agency')+'.'),'buyersimilar');
    var cards=peers.map(function(c){
      return '<button class="sim-card" onclick="openBuyerDrawer(\\''+esc(c.id)+'\\')">'
        + '<span class="sim-sa" style="background:#fdecec;color:#dc2626">Buyer</span>'
        + '<div class="sim-t">'+esc(c.name)+'</div>'
        + (c.title?'<div class="sim-ag">'+esc(c.title)+'</div>':'')
        + '<div class="sim-m">'+esc(b.agency||'')+'</div>'
        + '</button>';
    }).join('');
    return sec('Similar buyers','<div class="roster-note">Other decision-makers at '+esc(b.agency||'this agency')+' \\u2014 open their profile.</div><div class="sim-grid">'+cards+'</div>','buyersimilar');
  }
  // SAM.gov opportunities URL for an agency — a real, working external page ("what this office is
  // buying on SAM"). Used for the buyer drawer's "More" (gap 8) so it's never a dead uiLink:''.
  function samAgencyUrl(agency){
    var a=String(agency||'').trim();
    return a ? ('https://sam.gov/search/?index=opp&keywords='+encodeURIComponent(a)) : 'https://sam.gov/search/?index=opp';
  }
  // Primary actions (replaces the opp drawer's Save-to-pursuits / "Should I bid?"): See their
  // opportunities (\u2192 the agency's opps) · Add to CRM (save the buyer). ("Find similar buyers" is
  // now its OWN clickable peer-card section, buyerSimilarSec — gap 7 — so it's dropped here.)
  function buyerActions(b){
    // Links filter the contacts panel by department_ind_agency, so they MUST carry the RAW
    // agency ("STATE, DEPARTMENT OF"), not the display name ("Department of State") — the
    // display name would never match the stored column. Visible labels stay clean.
    var agLink=b.agencyRaw||b.agency;
    return '<div class="oact">'
      + (agLink?'<a class="b pri" href="/app?panel=contacts&agency='+encodeURIComponent(agLink)+'" target="_blank" rel="noopener">See their opportunities \\u2197</a>':'')
      + '<button class="b" onclick="saveCurrentBuyer(this)">Add to CRM</button>'
      + (b.agency?'<a class="b" href="'+esc(samAgencyUrl(b.agency))+'" target="_blank" rel="noopener">View agency on SAM \\u2197</a>':'')
      + '</div>';
  }
  // "Add to CRM" — mirrors saveCurrentCompany, saving the buyer via /api/opportunities/save
  // (source=buyer_map, the federal_contacts id as noticeId). Idempotent + optimistic label.
  window.saveCurrentBuyer=function(btn){
    if(!CUR||CUR.kind!=='buyer'||btn.dataset.saved==='1')return;
    var a=window.requireSignIn('add this buyer to your CRM'); if(!a)return;
    btn.textContent='Saving\\u2026';
    fetch('/api/opportunities/save',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':a.t,'x-user-email':a.em},
      body:JSON.stringify({email:a.em,noticeId:CUR.id,requestPursuitBrief:false,source:'buyer_map',
        opportunityData:{noticeId:CUR.id,entityType:'buyer',title:CUR.title,department:CUR.department,agency:CUR.department}})})
      .then(function(r){return r.json().catch(function(){return {};});}).then(function(d){
        var dup=d&&d.error&&/alread|exist|duplicate/i.test(d.error);
        if((d&&!d.error)||dup){ btn.textContent=dup?'\\u2713 In CRM':'\\u2713 Added'; btn.classList.add('saved'); btn.dataset.saved='1'; }
        else btn.textContent='Try again';
      }).catch(function(){ btn.textContent='Try again'; });
  };
  // ── Buyer DNA from PAST events (Network / Players surface) ──────────────────────────────────
  // Fills #buyerEventDna with named BEHAVIOR signals ("Runs Industry Days — 7 in the past year"),
  // never a list of expired events. Each badge comes from its own evidence; an office with no
  // history renders NOTHING (not "0 industry days", which reads as a data gap).
  function loadBuyerEventDna(b){
    var slot=document.getElementById('buyerEventDna'); if(!slot||!b)return;
    var q=[];
    var sol=String(b.solicitation||b.sol||'');
    if(/^[A-Z][A-Z0-9]{5}/.test(sol))q.push('dodaac='+encodeURIComponent(sol.slice(0,6)));
    if(b.agency)q.push('agency='+encodeURIComponent(b.agency));
    if(!q.length)return;
    var ch={}; try{ var tk=localStorage.getItem('mi_beta_auth_token')||''; if(tk)ch['x-mi-auth-token']=tk; }catch(e){}
    fetch('/api/app/opportunity-events?mode=dna&'+q.join('&'),{headers:ch})
      .then(function(r){return r.json();})
      .then(function(d){
        var dna=d&&d.dna;
        if(!dna||!dna.signals||!dna.signals.length)return;   // no evidence → render nothing
        var chips=dna.signals.map(function(s){
          return '<span class="dnachip"><b>'+esc(s.label)+'</b><i>'+esc(s.detail)+'</i></span>';
        }).join('');
        var last=dna.lastHeld?new Date(dna.lastHeld+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}):'';
        var note=last?'<div class="dnanote">Most recent: '+esc(last)+'</div>':'';
        slot.innerHTML=sec('How this buyer engages industry','<div class="dnawrap">'+chips+'</div>'+note,'engages');
        if(typeof buildTabs==='function')buildTabs();
      }).catch(function(){ /* silent: additive signal, never blocks the drawer */ });
  }
  function buyerRender(b){
    // CUR mirrors the opp/company drawer's CUR so the shared action bar (Save/Share/Hide/More) works.
    // kind='buyer' routes the drawer Save → /api/opportunities/save (source=buyer_map). uiLink is
    // the agency's SAM opportunities page so "More" is live (gap 8), never the dead uiLink:'' it had.
    CUR={ kind:'buyer', id:b.id, title:b.name, department:b.agency||'', solicitation:'', naics:'', deadline:'', sol:b.id, uiLink:samAgencyUrl(b.agency) };
    return buyerHead(b)
      + buyerOppsSec(b)       // what they're buying (the headline)
      + behaviorSec(b.behavior) // HOW they buy — SB-fit signal (GOS #11); b.behavior from buyer-detail
      // PAST events as BUYER-DNA signals, not a calendar (Eric: "treat historical events as
      // behavioral evidence"). Sits with the other how-they-buy signals. Async + self-hiding.
      + '<div id="buyerEventDna"></div>'
      + buyerAgencySec(b)     // their office / agency intel
      + buyerContactSec(b)    // how to reach them
      + buyerSimilarSec(b)    // similar buyers — clickable peer cards (gap 7)
      + buyerRosterSec(b)     // other contacts at this office
      + buyerActions(b);
  }
  window.openBuyerDrawer=function(id){
    if(!id)return;
    // See openCompanyDrawer: the Network map merges buyers + companies under MODE==='companies',
    // so requiring 'buyers' here made every Gov-Buyer pin/card a dead click on the live map.
    if(window.__mapMode&&window.__mapMode!=='buyers'&&window.__mapMode!=='companies')return;
    if(window.__resetOppSave)window.__resetOppSave(); // clear any stale "Saved" from a prior entity
    clearTaskOrderPins();
    var em=''; try{ var t=localStorage.getItem('mi_beta_auth_token'); var s=(t||'').split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); em=(j&&j.email||'').toLowerCase(); }catch(e){}
    body.innerHTML='<div class="oppload">Loading\\u2026</div>';
    dr.classList.add('buyer-accent'); // dataset-level RED accent for the buyer drawer
    bd.classList.add('show'); dr.classList.add('show'); dr.scrollTop=0;
    var url='/api/app/buyer-detail?id='+encodeURIComponent(id)+(em?'&email='+encodeURIComponent(em):'');
    var ch={}; try{ var tk=localStorage.getItem('mi_beta_auth_token')||''; if(tk)ch['x-mi-auth-token']=tk; }catch(e){} if(em)ch['x-user-email']=em;
    fetch(url,{headers:ch}).then(function(r){ return r.json().catch(function(){return null;}).then(function(d){ return {s:r.status,d:d}; }); }).then(function(res){
      var d=res.d;
      if(!(d&&d.success&&d.buyer)){ body.innerHTML=drawerLoadError(res.s,'buyer'); return; }
      body.innerHTML=buyerRender(d.buyer);
      buildTabs();
      loadBuyerEventDna(d.buyer);   // past-event behavior signals (async, self-hiding)
    }).catch(function(){ body.innerHTML=drawerLoadError(0,'buyer'); });
  };
})();
</script>`;

// Default map view — like Zillow opening to your city/state, NOT the whole globe.
// The template's boot fitView() fits ALL pins (incl. foreign — Sasebo, embassies), which
// zooms out to the world. Instead: center on the signed-in user's profile state (zoom 6);
// fall back to the continental US immediately so there's never a world-view flash. The
// template's fitView() boot call is neutralized (see the html.replace in GET) — moveend
// then auto-loads the region's live data. STATE_CENTROIDS is injected server-side.
const BOOT_VIEW_JS = '<script>window.__STATE_CENTROIDS=__STATE_CENTROIDS__;window.__INDUSTRY_PRESETS=__INDUSTRY_PRESETS__;window.__AGENCY_PRESETS=__AGENCY_PRESETS__;window.__FSC_PRESETS=__FSC_PRESETS__;window.__IP_STATE="__IP_STATE__";</script>'
  + `<script>(function(){
  // Own the initial view (Eric 2026-08-04, "start the map zoomed in ... Zillow starts you in your
  // area"): suppress the template's boot fitView() so it can't blow the map out to world zoom on
  // the global-outlier markers. Cleared once we've placed the home-state / CONUS view.
  window.__suppressFitView=true;
  window.__suppressFetchView=true; // don't fetch until a United States view is placed
  // Boot zoom 5, NOT 4.5. PIN_DOT_ZOOM suppresses pins below 5, so a 4.5 default sat HALF A LEVEL
  // BELOW the map's own pin threshold: measured on prod 2026-08-16, every visitor arrived at zero
  // markers and "Zoom in to see opportunities" — on the page whose job is showing the market is
  // busy. One step in and the data was all there (2,970 markers at DC). Fixing the boot view, not
  // the threshold: PIN_DOT_ZOOM=5 is a deliberate legibility call (see ~905) and lowering it puts
  // national pin soup back on screen. zoomSnap is .5, so 5 is a valid stop.
  var CONUS=[[38,-96],5];
  function inUS(lat,lng){
    if(typeof lat!=='number'||typeof lng!=='number')return false;
    if(lat>=24&&lat<=50&&lng>=-125&&lng<=-66)return true;
    if(lat>=51&&lat<=72&&lng>=-180&&lng<=-129)return true;
    if(lat>=18&&lat<=23&&lng>=-161&&lng<=-154)return true;
    if(lat>=17&&lat<=19&&lng>=-68&&lng<=-64)return true;
    return false;
  }
  // The template declares 'const map' at top-level of its own <script> (shared global lexical
  // scope, but NOT on window), so reach it via a getter that tolerates it not existing yet.
  function M(){ try{ return map; }catch(e){ return null; } }
  // Decode the email from the token PAYLOAD = split('.')[1] (Eric 2026-08-04 bug: reading [0], the
  // JWT HEADER, returned '' — so signed-in users never centered on their home state and the map
  // stayed at the world/CONUS default). Matches verifyTwoFactorSessionToken, which reads [1].
  function decodeEmail(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=(t.split('.')[1]||'').replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){return '';} }
  function setStateView(st){ var m=M(); var c=window.__STATE_CENTROIDS&&window.__STATE_CENTROIDS[st]; if(m&&c){ try{ m.setView(c,6,{animate:false}); return true; }catch(e){} } return false; }
  function conus(){ var m=M(); if(m){ try{ m.setView(CONUS[0],CONUS[1],{animate:false}); return true; }catch(e){} } return false; }
  // LAST VIEW (Eric 2026-08-12, "start zoomed in to a single state, preferably the user's location
  // or last login location"). The map remembers where you left off and reopens there — the single
  // strongest signal of the region you care about, and it costs no network round-trip.
  // Only a genuinely zoomed-in view is worth restoring: z<6 is CONUS/world — restoring it
  // would reopen on the blob Eric just rejected. Stale views expire (30d).
  var LAST_VIEW_KEY='mi_map_last_view', LAST_VIEW_MAX_AGE=30*24*3600*1000;
  function lastView(){ try{ var v=JSON.parse(localStorage.getItem(LAST_VIEW_KEY)||'null');
    if(!v||typeof v.lat!=='number'||typeof v.lng!=='number'||typeof v.z!=='number')return null;
    if(!inUS(v.lat,v.lng))return null; // federal map — never restore a view outside the US
    if(v.z<4)return null;
    if(!v.t||(Date.now()-v.t)>LAST_VIEW_MAX_AGE)return null;
    return v; }catch(e){ return null; } }
  // Called from the map's moveend (VIEWPORT_JS) — defined here because this is where the boot view
  // lives. Writes only what boot reads back; never throws into the moveend handler.
  window.__saveMapView=function(){ var m=M(); if(!m)return; try{ var c=m.getCenter(), z=m.getZoom();
    if(!c||typeof z!=='number'||z<4||!inUS(c.lat,c.lng))return;
    localStorage.setItem(LAST_VIEW_KEY,JSON.stringify({lat:c.lat,lng:c.lng,z:z,t:Date.now()})); }catch(e){} };
  // Instant boot: ALWAYS the United States. maxBounds with west=-180 wrapped the globe the
  // long way and snapped the view to Morocco (Leaflet antimeridian bug, Eric 2026-08-12).
  // No maxBounds. After every placement, if the center is not in the US, snap back to CONUS.
  function ensureUS(){
    var m=M(); if(!m||!m.getCenter){ conus(); return false; }
    var c=m.getCenter();
    if(!c||!inUS(c.lat,c.lng)){ conus(); return false; }
    return true;
  }
  function bootPlace(){
    var v=lastView(); var m=M();
    // Floor a restored view at 5 too (PIN_DOT_ZOOM) — a saved 4.5 would reopen the map blank.
    if(v&&m){ try{ m.setView([v.lat,v.lng],Math.max(v.z,5),{animate:false}); if(ensureUS())return 'last'; }catch(e){} }
    var ip=(window.__IP_STATE||'').toUpperCase().slice(0,2);
    if(ip&&setStateView(ip)&&ensureUS())return 'ip';
    conus(); ensureUS(); return 'conus';
  }
  function nearestState(lat,lng){
    var cents=window.__STATE_CENTROIDS; if(!cents)return '';
    var best='',bestD=1e9;
    for(var st in cents){
      var c=cents[st]; if(!c||c.length<2)continue;
      var d=(c[0]-lat)*(c[0]-lat)+(c[1]-lng)*(c[1]-lng);
      if(d<bestD){bestD=d;best=st;}
    }
    return best;
  }
  function geoState(cb){
    if(!navigator.geolocation){cb('');return;}
    var done=false;
    function finish(st){ if(done)return; done=true; cb(st||''); }
    setTimeout(function(){finish('');},2500);
    try{
      navigator.geolocation.getCurrentPosition(function(p){
        if(!inUS(p.coords.latitude,p.coords.longitude)){ finish(''); return; }
        finish(nearestState(p.coords.latitude,p.coords.longitude));
      }, function(){ finish(''); }, {timeout:2000,maximumAge:86400000,enableHighAccuracy:false});
    }catch(e){ finish(''); }
  }
  function finishBoot(){ releaseFit(); if(window.__mapRefetch)window.__mapRefetch(); }
  function releaseFit(){ window.__suppressFitView=false; window.__suppressFetchView=false; }
  setTimeout(function(){
    var m=M();
    if(m){
      var c=m.getCenter();
      if(!c||!inUS(c.lat,c.lng)||(m.getZoom&&m.getZoom()<4)) conus();
    }
    releaseFit();
    if(window.__mapRefetch)window.__mapRefetch();
  },4000);
  var _done=false, _bootSrc='';
  // Called by the template's window-load handler (after resize) AND immediately below. Idempotent.
  window.__mapBootView=function(){
    if(!M()){ setTimeout(window.__mapBootView,60); return; }
    // Always the United States first (last US view / US IP state / CONUS). Fetch that bbox now.
    _bootSrc=bootPlace();
    if(_done)return; _done=true;
    finishBoot();
    var em=decodeEmail();
    if(!em){
      if(_bootSrc==='conus') geoState(function(st){ if(st)setStateView(st); ensureUS(); });
      return;
    }
    var tok=''; try{ tok=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
    var H={'x-mi-auth-token':tok,'x-user-email':em};
    fetch('/api/app/map-home?email='+encodeURIComponent(em),{headers:H})
      .then(function(r){return r.json();}).then(function(d){
        var st=(d&&d.state?String(d.state):'').toUpperCase().slice(0,2);
        if(st){ window.__homeState=st; }
        if(st&&_bootSrc!=='last'){ setStateView(st); ensureUS(); }
      }).catch(function(){});
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
  // Deep-link: /opportunity-map?company=<uei> switches to the Companies dataset and opens that
  // firm's drawer (used by the company Share link + a saved company). Switches mode first (so the
  // guard in openCompanyDrawer passes), then opens the drawer keyed by UEI directly (no need to
  // wait for the pin to be in view — the drawer fetches its own data by UEI).
  (function(){ try{ var m=(location.search||'').match(/[?&]company=([^&]+)/); if(!m)return; var uei=decodeURIComponent(m[1]);
    var tries=0; (function go(){ if(window.setMapMode&&window.openCompanyDrawer){ if(window.__mapMode!=='companies')window.setMapMode('companies');
      // setMapMode EARLY-RETURNS when the mode already matches (e.g. booted into companies), which
      // skips the sort-scope sync → the header shows a stale "Deadline (soonest)" that means nothing
      // for a firm. Force the company sort scope here so the deep-linked drawer view is consistent.
      if(window.__mapMode==='companies'&&typeof window.__setSortScope==='function')window.__setSortScope('company');
      setTimeout(function(){ window.openCompanyDrawer(uei); },200); } else if(tries++<40){ setTimeout(go,150); } })(); }catch(e){} })();
  // Deep-link: /opportunity-map?buyer=<federal_contacts id> lands on the Network map and opens that
  // buyer's drawer (the buyer Share link / a saved buyer). Mirrors the ?company= flow.
  // Lands on 'companies' — the CANONICAL Network mode — not 'buyers': both entity types render
  // either way (the fetch keys off window.__players, not MODE), and the dataset pill has no
  // "buyers" <option>, so setMapMode('buyers') blanked it (dsel.value = an absent option = '').
  (function(){ try{ var m=(location.search||'').match(/[?&]buyer=([^&]+)/); if(!m)return; var bid=decodeURIComponent(m[1]);
    var tries=0; (function go(){ if(window.setMapMode&&window.openBuyerDrawer){ if(window.__mapMode!=='companies'&&window.__mapMode!=='buyers')window.setMapMode('companies'); setTimeout(function(){ window.openBuyerDrawer(bid); },200); } else if(tries++<40){ setTimeout(go,150); } })(); }catch(e){} })();
  // Deep-link: /opportunity-map?recompete=<piid/id> switches to the Awarded (Recompetes) dataset
  // and opens that recompete's drawer (the recompete Share link / a saved recompete). Mirrors the
  // ?company=/?buyer= flow (gap 1). openRecompeteDrawer looks the row up in the loaded set, so it
  // switches the mode FIRST (loads the recompete pins into rows/OPPS via __mapRefetch → moveend),
  // then retries openRecompeteDrawer until the target row is present (up to ~6s), since the pins
  // load asynchronously after the dataset switch (unlike company/buyer, which fetch by id directly).
  (function(){ try{ var m=(location.search||'').match(/[?&]recompete=([^&]+)/); if(!m)return; var rid=decodeURIComponent(m[1]);
    var tries=0; (function go(){
      if(window.setMapMode&&window.openRecompeteDrawer){
        if(window.__mapMode!=='recompete'){ window.setMapMode('recompete'); }
        window.openRecompeteDrawer(rid); // no-op (returns) until the row is loaded; retried below
        // Confirm it actually opened (the drawer got .show); if not, the pins aren't loaded yet.
        var dr=document.getElementById('oppDrawer');
        if(dr&&dr.classList.contains('show'))return;
        if(tries++<40)setTimeout(go,150);
      } else if(tries++<40){ setTimeout(go,150); }
    })(); }catch(e){} })();
  // Deep-link: /opportunity-map?strategy=repeat_buyer,sb_friendly,closes_soon — TODAY'S LENS. Today's
  // Intel doesn't just LINK to the map, it CONFIGURES it (Eric 2026-08-04): the briefing's strand
  // counts become the map's active strategy filter, so the map opens showing exactly what the briefing
  // talked about. Checks the matching .mf-strategy boxes → readDeep() reads them into FILT.strategy →
  // fetchView() applies the @> filter (same seam as the Filters "Apply", PR #924). Then a dismissible
  // ?ss=<saved-search id> — open the map ALREADY narrowed to that saved search.
  //
  // The watchlist's "Explore N New Opportunities" used to flatten a search's filters into query
  // params (naics=..., horizons=..., setAsideMulti=...) and the map read NONE of them: its only
  // deep-link params are opp/company/buyer/recompete/strategy. So the button always landed on the
  // unfiltered default — 136,879 results with every horizon on, for a search scoped to NAICS
  // 236/237/238 Open-only (Eric 2026-08-13). The horizons value did not even survive the trip:
  // String({open:true,...}) is "[object Object]".
  //
  // Rather than re-parse filters here, pass the ID and reuse __applySavedSearch — the SAME restorer
  // the in-map picker uses, which already handles mode, every FILT key, the visible controls and
  // the saved viewport. One code path, so the two entry points cannot drift.
  (function(){ try{
    var m=(location.search||'').match(/[?&]ss=([^&]+)/); if(!m)return;
    var wantId=decodeURIComponent(m[1]); if(!wantId)return;
    var tries=0; (function go(){
      if(typeof window.__applySavedSearch!=='function'||typeof _uemail!=='function'){
        if(++tries<40)return setTimeout(go,150); return;
      }
      var em=''; try{ em=_uemail(); }catch(e){}
      var tk=''; try{ tk=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){}
      // Signed out → leave the map on its default rather than pretending a filter applied.
      if(!em||!tk)return;
      var h={'x-mi-auth-token':tk,'x-user-email':em};
      fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:h})
        .then(function(r){ return r.json(); })
        .then(function(d){
          var list=(d&&(d.searches||d.results||d.data))||[];
          var ss=null; for(var i=0;i<list.length;i++){ if(String(list[i].id)===wantId){ ss=list[i]; break; } }
          if(!ss)return;                      // deleted/foreign id → default map, never a fake filter
          window.__applySavedSearch(ss);
        }).catch(function(){});
    })();
  }catch(e){} })();

  // Deep-link: scope params — /opportunity-map?agency=&naics=&state=&setAside=&psc=&q=
  // Open the map ALREADY narrowed, from a link that carries the scope instead of dropping it.
  //
  // WHO CALLS THIS (it is not speculative machinery — three shipped links):
  //   1. market/route.ts backHref()  "Back to map" on every market report, commented as a
  //      "round trip" — it emits q/naics/psc/agency/setAside/state and the map read none of them.
  //   2. market/route.ts browse hub, "Top buying agencies" -> ?agency=<display name>
  //   3. market/route.ts browse hub, "Top markets (NAICS)"  -> ?naics=<code>
  // Measured 2026-08-15: baseline, ?agency=DEPT%20OF%20DEFENSE and ?naics=311999 all returned
  // an identical 145,775 results. The hub's own comment says each row "deep-links BACK INTO THE
  // MAP so the user stays in the map app" — it just never did.
  //
  // Reuses __applySavedSearch — the SAME restorer ?ss= and the in-map picker use — by handing it
  // a synthetic {mode, filters, bbox}. So URL params and saved-search JSON share ONE vocabulary
  // and one apply path; a second hand-rolled FILT write here is exactly the lib-duplicate drift
  // this codebase keeps getting bitten by. No bbox: a scope link should not move the viewport.
  (function(){ try{
    function P(k){ var m=(location.search||'').match(new RegExp('[?&]'+k+'=([^&]+)')); return m?decodeURIComponent(m[1].split('+').join(' ')).trim():''; }
    var agency=P('agency'), naics=P('naics'), state=P('state'), setAside=P('setAside'), psc=P('psc'), q=P('q');
    // /today's "Today's Market" tiles: posted=<days> is a real FILT filter; mode= is NOT — it
    // picks WHICH HORIZON endpoints get fetched, so it goes through toggleHorizon below.
    var posted=P('posted'), mode=P('mode');
    if(!agency&&!naics&&!state&&!setAside&&!psc&&!q&&!posted&&!mode)return;   // nothing asked for -> leave the map alone
    var tries=0; (function go(){
      if(typeof window.__applySavedSearch!=='function'){
        if(++tries<40)return setTimeout(go,150); return;
      }
      var f={};
      // FILT.agency holds the ilike MATCH NEEDLE ('DEFENSE'), not the display name. The hub emits
      // display names ("Department of Defense"), so resolve through __AGENCY_PRESETS first and
      // fall back to the raw string for the long tail (the free-text Agency input accepts it).
      if(agency){
        var pres=window.__AGENCY_PRESETS||[], needle='';
        for(var i=0;i<pres.length;i++){
          var nm=String(pres[i].name||''), mt=String(pres[i].match||'');
          if(nm.toLowerCase()===agency.toLowerCase()||mt.toLowerCase()===agency.toLowerCase()){ needle=mt; break; }
        }
        if(!needle)for(var j=0;j<pres.length;j++){
          var mt2=String(pres[j].match||'');
          if(mt2&&agency.toUpperCase().indexOf(mt2.toUpperCase())>=0){ needle=mt2; break; }
        }
        f.agency=needle||agency;
      }
      if(naics)f.naics=naics;            // comma-joined, the shape FILT.naics already uses
      if(psc)f.psc=psc;
      if(state)f.state=state;
      if(setAside)f.setAside=setAside;
      if(q)f.q=q;
      // "Posted today / this week" tiles. Only values the #mfPosted select can actually hold —
      // otherwise the map would filter to a window the Filters panel shows as "Any time" and
      // Clear-all could not undo. 1 exists because the tile promises ONE day (see the option).
      if(posted&&['1','3','7','14','30'].indexOf(posted)>=0)f.postedDays=posted;
      // A scope link says WHERE to look, not WHICH corpus — so horizons are left alone UNLESS
      // the link explicitly asks for one (?mode=recompete from the Recompetes tile).
      window.__applySavedSearch({ mode:(window.__mapMode||'open'), filters:f });
      // Horizons are not part of FILT: they select which endpoints fetch. Go through
      // toggleHorizon (never a direct window.__horizons write) — it owns chip sync for BOTH
      // surfaces and the "never turn the last one off" guard. Runs after the restore so it is
      // not overwritten by it.
      // ?mode= covers TWO different things, and conflating them is how a link half-works:
      //   HORIZONS (open|recompete|forecast) pick which endpoints the CURRENT dataset fetches,
      //     so they go through toggleHorizon (chip sync + the "never turn the last one off" guard).
      //   DATASETS (buyers|companies|grants) are a different corpus entirely, so they go through
      //     setMapMode — which validates against MODES and is what the nav's ?mode=buyers
      //     ("Players") needs. That link was a dead end until now.
      var HZ={recompete:'recompete',forecast:'forecast',open:'open'};
      var DATASET={buyers:1,companies:1,grants:1};
      if(mode&&DATASET[mode]&&typeof window.setMapMode==='function'){
        try{ if(window.__mapMode!==mode)window.setMapMode(mode); }catch(e){}
      } else if(mode&&HZ[mode]&&typeof window.toggleHorizon==='function'){
        try{
          var want=HZ[mode];
          ['open','recompete','forecast'].forEach(function(h){
            var on=(window.__horizons&&window.__horizons[h]!==false);
            if(h===want&&!on)window.toggleHorizon(h);
            if(h!==want&&on)window.toggleHorizon(h);
          });
        }catch(e){}
      }
    })();
  }catch(e){} })();

  // "Today's Lens" pill names the lens. Only known strand keys are honored (the .mf-strategy set),
  // so a junk param checks nothing (no fabricated filter). Retries until the boxes + fns exist.
  (function(){ try{
    var m=(location.search||'').match(/[?&]strategy=([^&]+)/); if(!m)return;
    var want=decodeURIComponent(m[1]).split(',').map(function(s){return s.trim();}).filter(Boolean);
    if(!want.length)return;
    var tries=0; (function go(){
      var boxes=document.querySelectorAll('.mf-strategy');
      // Guard on the BRIDGE (a real global), not on readDeep/fetchView — those are VIEWPORT_JS
      // locals this block cannot see, so guarding on them never passed and the lens silently
      // never applied. See window.__applyStrategyBoxes for the measured failure.
      if(boxes.length && typeof window.__applyStrategyBoxes==='function'){
        var applied=[];
        boxes.forEach(function(b){ if(want.indexOf(b.value)>=0){ b.checked=true; applied.push(b.value); } });
        if(!applied.length)return;           // junk param → nothing to apply (no fabricated lens)
        applied=window.__applyStrategyBoxes()||applied;
        // The "Today's Lens" pill — names the lens the briefing configured; click ✕ to clear it.
        try{
          var host=document.querySelector('.map-controls')||document.body;
          var pill=document.createElement('div'); pill.id='todaysLensPill';
          pill.style.cssText='position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:600;display:flex;align-items:center;gap:8px;background:linear-gradient(90deg,#1e3a8a,#7c3aed);color:#fff;font:600 13px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.25)';
          // Name each strand with its OWN checkbox label ("SB-Friendly", "Set-Aside"), not a
          // title-cased key — that rendered "Sb Friendly" / "Set Aside" in the pill.
          var human=applied.map(function(k){
            var box=document.querySelector('.mf-strategy[value="'+k+'"]');
            var lbl=box&&box.parentNode?String(box.parentNode.textContent||'').trim():'';
            return lbl||k.split('_').map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(' ');
          }).join(' · ');
          pill.innerHTML='<span>\\uD83D\\uDD2D Today\\u2019s Lens: '+human+'</span>';
          var x=document.createElement('button'); x.textContent='\\u2715'; x.setAttribute('aria-label','Clear Today\\u2019s Lens');
          x.style.cssText='all:unset;cursor:pointer;font-weight:700;opacity:.85;padding:0 2px';
          // Clear through the BRIDGE, exactly like the apply path 20 lines above. readDeep/fetchView
          // are VIEWPORT_JS locals invisible from this block — calling them bare threw a
          // ReferenceError that the catch swallowed, so the ✕ unchecked the boxes and then silently
          // left the map filtered (measured on prod 2026-08-17).
          x.onclick=function(){ try{ document.querySelectorAll('.mf-strategy:checked').forEach(function(b){b.checked=false;}); if(typeof window.__applyStrategyBoxes==='function')window.__applyStrategyBoxes(); pill.remove(); }catch(e){} };
          pill.appendChild(x); host.appendChild(pill);
        }catch(e){}
        return;
      }
      if(tries++<40)setTimeout(go,150);
    })();
  }catch(e){} })();
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
  if(typeof sortRows==='function'){
    var _sr=sortRows;
    // Per-ROW $ value: recompete rows carry valueNum (real USASpending ceiling), open/forecast/
    // grants carry est (M-Estimate / grant ceiling) — same rule as the pins (line ~2050).
    function rowVal(o){ var v=(o&&o.src==='RECOMPETE')?Number(o.valueNum):Number(o&&o.est); return isFinite(v)?v:0; }
    sortRows=function(a,b){
      switch(F.sort){
        case 'newest': return String((b.posted||'')).localeCompare(String(a.posted||''));
        case 'setaside': { var sa=(a.set&&a.set!=='None')?0:1, sb=(b.set&&b.set!=='None')?0:1; if(sa!==sb)return sa-sb; return dueDate(a).localeCompare(dueDate(b)); }
        // value = high→low (biggest first); value-asc = low→high (smallest first, the SAP-friendly
        // small-biz entry points). Handled HERE (not the template's _sr) so both use the same
        // recompete-valueNum / open-est extraction and stay symmetric. $0/unknown sinks to the
        // bottom either way (a row with no ceiling isn't a "$0 contract").
        case 'value': { var av=rowVal(a), bv=rowVal(b); if(!av&&bv)return 1; if(av&&!bv)return -1; return bv-av; }
        case 'value-asc': { var la=rowVal(a), lb=rowVal(b); if(!la&&lb)return 1; if(la&&!lb)return -1; return la-lb; }
        default: return _sr(a,b);
      }
    };
  }
  var sel=document.getElementById('sort'); if(sel)sel.addEventListener('change',function(){
    try{
      // Companies sort is computed SERVER-SIDE (companiesPins ranks by $/awards/name/set-aside)
      // — a 'co-' prefixed value means re-fetch, not a client re-sort. (Buyers has no analog.)
      if(String(sel.value).indexOf('co-')===0 && typeof window.__mapMode!=='undefined' && window.__mapMode==='companies'){
        window.__companySort=sel.value.slice(3);
        if(typeof window.__mapRefetch==='function')window.__mapRefetch();
        return;
      }
      if(typeof render==='function')render();
    }catch(e){}
  });
  // Custom Zillow-style sort menu: TWO menus share one trigger — #sortMenu (opportunities) and
  // #sortMenuCo (companies) — swapped by mode (see window.__setSortScope, called from
  // setMapMode). Picking a row in EITHER sets the hidden <select> value + fires its 'change'
  // (reusing the wiring above), updates the label + ✓ within that menu.
  var wrap=document.querySelector('.sortmenu-wrap'), btn=document.getElementById('sortBtn'),
      menuOpp=document.getElementById('sortMenu'), menuCo=document.getElementById('sortMenuCo'),
      lbl=document.getElementById('sortBtnLabel'), sel2=document.getElementById('sort');
  function wireMenu(menu){
    if(!menu||!sel2)return;
    Array.prototype.forEach.call(menu.querySelectorAll('.sortmenu-item'),function(it){
      it.onclick=function(){ var v=it.getAttribute('data-sort');
        sel2.value=v; sel2.dispatchEvent(new Event('change',{bubbles:true}));
        if(lbl){ var t=(it.textContent||'').replace(/^\\s*\\u2713\\s*/,'').trim(); lbl.textContent=t; }
        Array.prototype.forEach.call(menu.querySelectorAll('.sortmenu-item'),function(x){ x.classList.toggle('on', x===it); });
        if(menuOpp)menuOpp.classList.remove('show'); if(menuCo)menuCo.classList.remove('show');
        if(wrap)wrap.classList.remove('open');
      };
    });
  }
  wireMenu(menuOpp); wireMenu(menuCo);
  if(wrap&&btn){
    btn.onclick=function(e){ e.stopPropagation();
      var active=(menuCo&&menuCo.style.display!=='none')?menuCo:menuOpp; if(!active)return;
      var open=!active.classList.contains('show'); active.classList.toggle('show',open); wrap.classList.toggle('open',open); };
    document.addEventListener('click',function(e){ if(!e.target.closest('.sortmenu-wrap')){ if(menuOpp)menuOpp.classList.remove('show'); if(menuCo)menuCo.classList.remove('show'); wrap.classList.remove('open'); } });
  }
  // Called from setMapMode: swap which sort menu is visible + reset the label/selection to that
  // scope's default so the button never shows a stale opportunity-only label ("Deadline") while
  // Contacts/Companies is active.
  window.__setSortScope=function(scope){
    if(!menuOpp||!menuCo||!sel2)return;
    if(scope==='company'){
      menuOpp.style.display='none'; menuCo.style.display='';
      var first=menuCo.querySelector('.sortmenu-item');
      if(first){ Array.prototype.forEach.call(menuCo.querySelectorAll('.sortmenu-item'),function(x){x.classList.toggle('on',x===first);});
        var v=first.getAttribute('data-sort'); sel2.value=v; window.__companySort=v.slice(3);
        if(lbl)lbl.textContent=(first.textContent||'').replace(/^\\s*\\u2713\\s*/,'').trim(); }
    } else {
      menuCo.style.display='none'; menuOpp.style.display='';
      var onItem=menuOpp.querySelector('.sortmenu-item.on')||menuOpp.querySelector('.sortmenu-item');
      if(onItem){ sel2.value=onItem.getAttribute('data-sort');
        if(lbl)lbl.textContent=(onItem.textContent||'').replace(/^\\s*\\u2713\\s*/,'').trim(); }
    }
  };
  // Zillow parity: Clear-all (and a fresh search) reset the sort back to the DEFAULT ("Recommended",
  // the first item) in BOTH menus — a search never carries a stale sort the user didn't set. Sets the
  // first item active, clears the hidden select + companySort, restores the label, and re-renders.
  window.__resetSort=function(){
    [menuOpp,menuCo].forEach(function(menu){ if(!menu)return;
      var first=menu.querySelector('.sortmenu-item');
      Array.prototype.forEach.call(menu.querySelectorAll('.sortmenu-item'),function(x){ x.classList.toggle('on', x===first); });
    });
    if(sel2)sel2.value='';
    window.__companySort='';
    if(lbl)lbl.textContent='Recommended';
    try{ if(typeof F!=='undefined')F.sort=''; }catch(e){}
    try{ if(typeof render==='function')render(); }catch(e){}
  };
})();
</script>`;

const SEARCH_PANEL_JS = `<script>(function(){
  var input=document.getElementById('zsearchInput'), panel=document.getElementById('searchPanel');
  if(!input||!panel) return;
  // The rail's "Search" item focuses the search box (opens the suggestions panel) — Zillow parity.
  var _rs=document.getElementById('railSearch'); if(_rs)_rs.onclick=function(e){ e.preventDefault(); input.focus(); };
  var RECENT_KEY='mindy_map_recent_searches';
  var TOOL='opportunity_map'; // stable search-capture tool key for this surface
  function esc(x){ return (x==null?'':String(x)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function getRecents(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch(e){ return []; } }
  function pushRecent(q){ q=(q||'').trim(); if(!q) return; try{ var r=getRecents().filter(function(x){return x.toLowerCase()!==q.toLowerCase();}); r.unshift(q); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0,6))); }catch(e){} }
  function email(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){ return ''; } }
  function authHeaders(em){ var tok=''; try{ tok=localStorage.getItem('mi_beta_auth_token')||''; }catch(e){} var h={}; if(tok)h['x-mi-auth-token']=tok; if(em)h['x-user-email']=em; return h; }
  function open(){ panel.classList.add('show'); }
  function close(){ panel.classList.remove('show'); }
  // Run a keyword search by setting the input + firing its existing debounced handler, and
  // record it to server history (search-capture) + local recents so the dropdown accrues.
  function runSearch(q){ q=(q||'').trim(); if(!q){ input.focus(); return; } input.value=q; pushRecent(q); captureSearch(q); input.dispatchEvent(new Event('input',{bubbles:true})); close(); }
  function jumpState(st){ try{ var c=window.__STATE_CENTROIDS && window.__STATE_CENTROIDS[st]; if(c){ map.setView(c,6); } }catch(e){} close(); }

  // Persist an actual submitted search to user_search_history (fire-and-forget, non-blocking).
  // search_type:'zip' is deliberate — it is a valid type that is NOT in the profile columnMap,
  // so a map keyword search accrues history WITHOUT polluting the user's alert keywords.
  var _lastCap='';
  function captureSearch(q){ q=(q||'').trim(); if(!q||q.toLowerCase()===_lastCap) return; _lastCap=q.toLowerCase();
    // What people TYPE on a map — the gap between browsing and searching, which is the
    // whole premise of principle 01. The query text is stored; it is a market term, not PII.
    try{ if(window.__track) window.__track('tool_use','map_search',{query:q.slice(0,80)}); }catch(e){}
    // Expose the live query so a cards_shown impression can say whether the feed the user
    // saw was browsed-into or searched-into. Those are different products (principle 01).
    try{ window.__lastQuery=q; }catch(e){}
    var em=email(); if(!em) return;
    try{ fetch('/api/search-capture',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders(em)),
      body:JSON.stringify({user_email:em,tool:TOOL,search_type:'zip',search_value:q,search_metadata:{mode:(window.__mapMode||'open'),source:'opportunity_map_bar'}})}).catch(function(){}); }catch(e){}
    // Invalidate the cached server history so the next open re-fetches (the term now shows in
    // local recents immediately via pushRecent; the DB catches up on the next dropdown open).
    dbRecents=null; dbRecentsPromise=null;
  }

  // Server search history for this tool (cached once per session, refreshed after a capture).
  var dbRecents=null, dbRecentsPromise=null;
  function loadDbRecents(){
    if(dbRecents!==null) return Promise.resolve(dbRecents);
    if(dbRecentsPromise) return dbRecentsPromise;
    var em=email(); if(!em){ dbRecents=[]; return Promise.resolve(dbRecents); }
    dbRecentsPromise=fetch('/api/search-capture?email='+encodeURIComponent(em)+'&tool='+encodeURIComponent(TOOL),{headers:authHeaders(em)})
      .then(function(r){return r.json();}).then(function(d){
        var rows=(d&&d.recent_searches)?d.recent_searches:[];
        // The GET returns ALL tools' rows — keep only this surface, newest-first, deduped.
        var out=[], seen={};
        rows.forEach(function(x){ if(!x||x.tool!==TOOL)return; var v=(x.search_value||'').trim(); if(!v)return; var k=v.toLowerCase(); if(seen[k])return; seen[k]=1; out.push(v); });
        dbRecents=out; return out;
      }).catch(function(){ dbRecents=[]; return dbRecents; });
    return dbRecentsPromise;
  }
  // Merge server history with local recents (server wins order; local fills fast/offline).
  function mergedRecents(){ var local=getRecents(), db=(dbRecents||[]); var out=[], seen={};
    db.concat(local).forEach(function(v){ v=(v||'').trim(); if(!v)return; var k=v.toLowerCase(); if(seen[k])return; seen[k]=1; out.push(v); });
    return out.slice(0,8); }

  var ICON={ask:'<svg class="sp" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z"/><path d="M19 14l.8 2 .2.8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>',
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.3-7-11a7 7 0 0114 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star:'<svg viewBox="0 0 24 24"><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9 12 3z"/></svg>',
    bldg:'<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V5a1 1 0 011-1h8a1 1 0 011 1v16M15 21V9h3a1 1 0 011 1v11"/><path d="M8 8h1M8 12h1M11 8h1M11 12h1"/></svg>' };

  function renderDefault(){
    var q=(input.value||'').trim();
    var h='';
    // Ask Mindy row REMOVED for now (Eric 2026-08-03: "remove ask Mindy for now"). The panel opens
    // straight into Near-me / history / saved / the NL example hints — pure search, no chat doorway.
    var st=window.__homeState;
    h+='<button class="zsp-row" data-act="state" data-st="'+esc(st||'')+'">'+ICON.pin+'<span>'+(st?('Jump to '+esc(st)+' \\u2014 your state'):'Near me / my area')+'</span></button>';
    // Search history + saved searches are filled async (server-backed).
    h+='<div id="zspRecent"></div>';
    h+='<div id="zspSaved"></div>';
    h+='<div id="zspHint"></div>';
    panel.innerHTML=h; open();
    var em=email();
    // Recents (server + local), then Saved (with badges). Both async; render the hint once known.
    loadDbRecents().then(function(){ renderRecents(); maybeHint(); });
    renderRecents(); // paint local recents immediately while the DB call resolves
    if(em) loadSaved(); else { var sb=document.getElementById('zspSaved'); if(sb)sb.innerHTML=''; maybeHint(); }
  }
  function renderRecents(){
    var box=document.getElementById('zspRecent'); if(!box) return;
    var rec=mergedRecents(); if(!rec.length){ box.innerHTML=''; maybeHint(); return; }
    var h='<div class="zsp-sep"></div><div class="zsp-h">Search history</div>';
    rec.forEach(function(r){ h+='<button class="zsp-row" data-act="run" data-q="'+esc(r)+'">'+ICON.clock+'<span class="nm">'+esc(r)+'</span></button>'; });
    box.innerHTML=h;
  }
  // Empty state (no recents, no saved): instead of a passive "will appear here", TEACH the NL search
  // with clickable example queries (Eric 2026-08-03: "show me army, navy VA"). Each is a real
  // data-act="run" row → runs through parseSearchIntent exactly as if typed, so the user learns the
  // primary Explore move by clicking one. Covers both datasets: agency opps + a Network ("biggest…").
  function maybeHint(){ var hb=document.getElementById('zspHint'); if(!hb) return;
    var hasRec=!!(document.getElementById('zspRecent')&&document.getElementById('zspRecent').innerHTML);
    var hasSaved=!!(document.getElementById('zspSaved')&&document.getElementById('zspSaved').innerHTML);
    if(hasRec||hasSaved){ hb.innerHTML=''; return; }
    var egs=['Show me Army opportunities','Navy recompetes in Texas','8(a) opportunities in Virginia','Biggest VA contractors in Florida'];
    var h='<div class="zsp-sep"></div><div class="zsp-h">Try a search</div>';
    egs.forEach(function(q){ h+='<button class="zsp-row" data-act="run" data-q="'+esc(q)+'">'+ICON.ask+'<span class="nm">'+esc(q)+'</span></button>'; });
    hb.innerHTML=h;
  }
  function loadSaved(){
    var em=email(); var box=document.getElementById('zspSaved'); if(!em||!box) return;
    // Fetch the list AND the per-search new-match counts (?badge=1 perSearch) in parallel.
    var pList=fetch('/api/app/saved-searches?email='+encodeURIComponent(em),{headers:authHeaders(em)}).then(function(r){return r.json();}).catch(function(){return null;});
    var pBadge=fetch('/api/app/saved-searches?badge=1&email='+encodeURIComponent(em),{headers:authHeaders(em)}).then(function(r){return r.json();}).catch(function(){return null;});
    Promise.all([pList,pBadge]).then(function(a){
      var d=a[0]||{}, bd=a[1]||{};
      var list=(d&&d.success&&d.searches)?d.searches:[];
      var counts={}; ((bd&&bd.perSearch)||[]).forEach(function(p){ if(p&&p.id!=null)counts[p.id]=p.count||0; });
      if(!list.length){ box.innerHTML=''; maybeHint(); return; }
      var h='<div class="zsp-sep"></div><div class="zsp-h">Saved searches</div>';
      list.slice(0,6).forEach(function(s,i){ var n=counts[s.id]||0;
        h+='<button class="zsp-row" data-act="saved" data-idx="'+i+'">'+ICON.star+'<span class="nm">'+esc(s.name||'Saved search')+'</span>'+(n>0?('<b class="badge" title="'+n+' new match'+(n===1?'':'es')+'">'+(n>99?'99+':n)+'</b>'):'')+'</button>'; });
      box.innerHTML=h; window.__zspSaved=list; maybeHint();
    }).catch(function(){ box.innerHTML=''; maybeHint(); });
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
        // Ask Mindy row REMOVED for now (Eric 2026-08-03) — autocomplete opens straight into the
        // matched Agencies / Codes; Enter still runs the literal keyword search (the empty branch below).
        var h='';
        // NOTE: market-report generation is NOT offered here (Eric 2026-08-01: most
        // users want saved-search alerts to bid, not reports — it's a rare feature).
        // "Run report" lives on each SAVED SEARCH card (/opportunity-map/saved),
        // beside "View on map", where the market is already defined.
        if(ags.length){ h+='<div class="zsp-h">Agencies</div>';
          ags.slice(0,4).forEach(function(g){ var nm=g.name||g.shortName||''; if(!nm)return; var abbr=(g.shortName&&g.shortName!==nm)?g.shortName:''; h+='<button class="zsp-row" data-act="run" data-q="'+esc(nm)+'">'+ICON.bldg+'<span>'+esc(nm)+'</span>'+(abbr?'<span class="sub">'+esc(abbr)+'</span>':'')+'</button>'; }); }
        if(res.length){ h+='<div class="zsp-h">Codes</div>';
          res.slice(0,6).forEach(function(x){ h+='<button class="zsp-row" data-act="run" data-q="'+esc(x.code)+'"><span class="code">'+esc(x.type.toUpperCase())+' '+esc(x.code)+'</span><span class="sub">'+esc(x.name)+'</span></button>'; }); }
        if(!ags.length && !res.length){ h+='<div class="zsp-empty">Press Enter to search \\u201c'+esc(q)+'\\u201d across titles, agencies &amp; descriptions.</div>'; }
        panel.innerHTML=h; open();
        // UNPLACED forecasts matching this query (Eric 2026-08-02). 11,174 forecasts have no
        // coordinate — the agency said "TBD"/"vendor's facility", withheld it, or published no
        // location field — so the map can NEVER show them however you search. This row is the
        // only in-map hint they exist. Appended async so it never delays the suggestions, and
        // only rendered when the count is > 0 (silent the rest of the time).
        _unplacedRow(q, panel);
      }).catch(function(){});
    },220);
  }

  // Nuclear autofill guard: the search input ships readonly so Chrome/1Password find no editable
  // field on load (they were filling the saved EMAIL). Strip readonly the moment the user engages
  // it — on pointerdown (so the very first click is editable) and on focus. Also blank the two
  // off-screen decoy username/password fields in case a manager pre-filled them.
  function armInput(){ if(input.hasAttribute('readonly')) input.removeAttribute('readonly');
    try{ var ds=document.querySelectorAll('.amk-decoy'); for(var i=0;i<ds.length;i++)ds[i].value=''; }catch(e){} }
  input.addEventListener('pointerdown',armInput);
  // Fetch the unplaced-forecast count for a query and append a row to the open panel (main's
  // suggestion-row surface). Fails SILENTLY: a suggestions panel that errors is worse than one
  // missing a row. MERGE (2026-08-02): the "view list" row now points at /opportunity-map/forecasts
  // (the redesigned browse page) instead of the retired /unplaced page.
  function _unplacedRow(q, panel){
    if(!q || q.length<2) return;
    fetch('/api/forecasts/unplaced?limit=1&q='+encodeURIComponent(q))
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d||!d.success||!d.total) return;
        if(!panel || !panel.isConnected) return;
        var b=document.createElement('button');
        b.className='zsp-row zsp-unplaced';
        b.setAttribute('data-act','unplaced');
        b.innerHTML='<span class="zsp-uic">\\u25ce</span><span><b>'+Number(d.total).toLocaleString()
          +'</b> without a mapped location</span><span class="sub">view list</span>';
        panel.appendChild(b);
      }).catch(function(){});
  }
  input.addEventListener('focus',function(){ armInput(); var q=(input.value||'').trim(); if(q.length>=2) renderAutocomplete(q); else renderDefault(); });
  input.addEventListener('input',function(){ var q=(input.value||'').trim(); if(q.length>=2) renderAutocomplete(q); else renderDefault(); });
  // ── Natural-language SEARCH INTENT (Eric 2026-08-03: "instead of a chatbot, make a real search
  // feature — 'Show me Army opportunities' shows on the map"). Rules-based, instant, no API call:
  // recognize an AGENCY / SET-ASIDE / STATE / LIFECYCLE phrase, apply it as a REAL filter (the chip
  // lights up + the map narrows), and drop the recognized words. Anything unrecognized falls through
  // to the normal keyword text search. Grounded: the agency needles are the same ones the sub_tier/
  // department ILIKE matches on (verified agency=Army → 510 opps), set-asides map to the API's codes.
  // ⚠️ NO REGEX for phrase matching. A /\b…\b/ regex literal — OR a new RegExp('\\b…') string —
  // gets MANGLED by the template-literal → template-html.ts generation: every \b collapses to a
  // literal BACKSPACE (\x08), so the pattern never matches and the whole parser silently returned
  // null. Six attempts at escaping this failed. The escaping-proof fix is plain substring matching
  // against a SPACE-PADDED lowercased string — no backslash escapes exist to be mangled. (Eric 2026-08-03.)
  //
  // _hasPhrase(padded, phrase): true if phrase appears in padded (which is space+text+space,
  // lowercased) as a whole token-run. We pad the phrase too and test indexOf, so army matches
  // (space)army(space) but NOT (space)armystrong(space). Multi-word phrases (air force) match verbatim.
  var _hasPhrase=function(padded, phrase){
    // A phrase boundary is a space on each side. Pad both the haystack (already padded) and needle.
    return padded.indexOf(' '+phrase+' ')!==-1;
  };
  var _hasAny=function(padded, phrases){ for(var i=0;i<phrases.length;i++){ if(_hasPhrase(padded,phrases[i]))return true; } return false; };
  // needle = what the API ILIKEs on department/sub_tier; syns = how a user might say it (lowercased).
  var _AGENCY_NEEDLES=[
    {needle:'Army', syns:['army','us army','u.s. army','u s army','department of the army']},
    {needle:'Navy', syns:['navy','us navy','u.s. navy','u s navy','department of the navy']},
    {needle:'Air Force', syns:['air force','airforce','usaf','department of the air force']},
    {needle:'Marine Corps', syns:['marine corps','marines','usmc']},
    {needle:'Coast Guard', syns:['coast guard','coastguard','uscg']},
    {needle:'Defense', syns:['dod','department of defense','defense department']},
    {needle:'Veterans Affairs', syns:['va','veterans affairs','veterans','dept of veterans','department of veterans']},
    {needle:'Homeland Security', syns:['dhs','homeland security','homeland']},
    {needle:'Health and Human Services', syns:['hhs','health and human services']},
    {needle:'Agriculture', syns:['usda','agriculture','dept of agriculture','department of agriculture']},
    {needle:'Energy', syns:['doe','department of energy','energy department']},
    {needle:'Justice', syns:['doj','department of justice','justice department']},
    {needle:'State', syns:['department of state','state department']},
    {needle:'Interior', syns:['department of the interior','interior department']},
    {needle:'Transportation', syns:['dot','department of transportation','transportation department']},
    {needle:'Treasury', syns:['treasury','department of the treasury']},
    {needle:'NASA', syns:['nasa']},
    {needle:'General Services', syns:['gsa','general services','general services administration']},
    {needle:'Environmental Protection', syns:['epa','environmental protection']},
    {needle:'Army Corps of Engineers', syns:['army corps','corps of engineers','usace']},
    {needle:'National Science Foundation', syns:['nsf','national science foundation']}
  ];
  var _SETASIDE_INTENTS=[
    {val:'sdvosb', syns:['sdvosb','service disabled veteran','service-disabled veteran','service disabled veteran owned']},
    {val:'vosb', syns:['vosb','veteran owned','veteran-owned']},
    {val:'wosb', syns:['wosb','women owned','women-owned','woman owned']},
    {val:'8a', syns:['8a','8(a)','8 a']},
    {val:'hubzone', syns:['hubzone','hub zone']},
    {val:'sba', syns:['small business set aside','small business set-aside','sb set aside','total small business']}
  ];
  var _LIFECYCLE_INTENTS=[
    {hz:'recompete', syns:['recompete','recompetes','expiring','expiration','expire']},
    {hz:'forecast', syns:['forecast','forecasts','planned','upcoming']}
  ];
  // "biggest / top / largest" → sort by size (Players/Companies: sort by total $ won). Only meaningful
  // on the Players dataset; the applier gates it to Players mode. (Eric 2026-08-03 — "biggest VA
  // contractors in Florida".)
  var _BIGSORT_SYNS=['biggest','largest','top','highest','major','leading','biggest contractors','top contractors'];
  // TWO-NETWORKS routing (Eric 2026-08-03, two_networks_opp_vs_network_map): a query names WHICH map.
  // People/orgs words → the NETWORK map (Companies + Gov Buyers); opportunity words → the OPPORTUNITY
  // map. The Enter handler / Ask Mindy switches the map BEFORE applying so "biggest VA contractors in
  // Florida" lands on Network and "Army opportunities" lands on Opportunities. These are STRIPPED like
  // filler so they don't pollute the residual keyword.
  var _PLAYER_WORDS=['contractor','contractors','company','companies','firm','firms','vendor','vendors','prime','primes','sub','subs','subcontractor','subcontractors','incumbent','incumbents','buyer','buyers','sblo','sblos','partner','partners','teaming partner','decision maker','decision makers','businesses','players'];
  var _OPP_WORDS=['opportunity','opportunities','opp','opps','contract','contracts','bid','bids','solicitation','solicitations','rfp','rfps','rfq','rfqs','award','awards'];
  // State name → 2-letter code (for "opportunities in Florida" → FL). Code→name for stripping.
  var _STATE_NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'};
  // Whole-word state match via space-padded substring (no regex → no \b to mangle).
  function _stateFromText(padded){ for(var c in _STATE_NAMES){ if(_hasPhrase(padded,_STATE_NAMES[c].toLowerCase()))return c; } return ''; }
  // PURE parse — build an intent object, touch NO cross-block state (FILT/fetchView live in a
  // different <script> IIFE — VIEWPORT_JS). The applying happens via window.__applySearchFilters,
  // which runs where FILT is in scope. Returns {agency,state,setAside,horizon,bigSort,dataset,keyword} or null.
  // Strip every occurrence of a phrase (space-padded, whole-token) from a padded string. No regex.
  var _stripPhrase=function(padded, phrase){ var t=' '+phrase+' '; var idx; while((idx=padded.indexOf(t))!==-1){ padded=padded.slice(0,idx)+' '+padded.slice(idx+t.length); } return padded; };
  // Filler words to drop from the residual keyword (whole-token, space-padded).
  var _FILLER=['show me','show','find','get','list','all','the','me','opportunities','opportunity','opps','contracts','contract','bids','bid','in','for','from','by','with','any'];
  function parseSearchIntent(raw){
    // Work on a lowercased, space-padded copy so _hasPhrase/_stripPhrase see clean token boundaries.
    // ⚠️ Use a DOUBLE backslash before s, NOT a single one: the template serialization eats a single
    // backslash, so a single-backslash-s ships as /s+/ — which matches the LETTER s, replacing every
    // "s" with a space ("biggest" becomes "bigge t"). Same class of trap as the backspace one. (Eric 2026-08-03.)
    var q=' '+String(raw||'').toLowerCase().replace(/[()]/g,' ').replace(/\\s+/g,' ')+' ';
    var hit=null, intent={agency:'',state:'',setAside:'',horizon:'',bigSort:false,dataset:'',keyword:''};
    // Dataset routing FIRST (before filler-stripping eats 'contractors'/'opportunities'): a people/org
    // word → the Network map; an opportunity word → the Opportunity map. A recompete/forecast horizon
    // also implies Opportunities. Detected but NOT a standalone hit — routing without another signal
    // still falls through to keyword search (a lone "contractors" is too thin to switch maps blindly).
    if(_hasAny(q,_PLAYER_WORDS)) intent.dataset='players';
    else if(_hasAny(q,_OPP_WORDS)) intent.dataset='opportunities';
    for(var i=0;i<_AGENCY_NEEDLES.length;i++){ var A=_AGENCY_NEEDLES[i]; if(_hasAny(q,A.syns)){ intent.agency=A.needle; for(var a=0;a<A.syns.length;a++)q=_stripPhrase(q,A.syns[a]); hit=intent; break; } }
    var st=_stateFromText(q); if(st){ intent.state=st; q=_stripPhrase(q,(_STATE_NAMES[st]||'').toLowerCase()); hit=intent; }
    for(var j=0;j<_SETASIDE_INTENTS.length;j++){ var S=_SETASIDE_INTENTS[j]; if(_hasAny(q,S.syns)){ intent.setAside=intent.setAside?(intent.setAside+','+S.val):S.val; for(var s=0;s<S.syns.length;s++)q=_stripPhrase(q,S.syns[s]); hit=intent; } }
    for(var k=0;k<_LIFECYCLE_INTENTS.length;k++){ var L=_LIFECYCLE_INTENTS[k]; if(_hasAny(q,L.syns)){ intent.horizon=L.hz; if(!intent.dataset)intent.dataset='opportunities'; for(var l=0;l<L.syns.length;l++)q=_stripPhrase(q,L.syns[l]); hit=intent; } }
    // "biggest/top/largest" → sort by size + implies the Network map (nobody sorts opps by "biggest firm").
    if(_hasAny(q,_BIGSORT_SYNS)){ intent.bigSort=true; if(!intent.dataset)intent.dataset='players'; for(var g=0;g<_BIGSORT_SYNS.length;g++)q=_stripPhrase(q,_BIGSORT_SYNS[g]); hit=intent; }
    if(!hit) return null;
    // Whatever's left after stripping filler = a real keyword. Longest filler phrases first.
    for(var f=0;f<_FILLER.length;f++)q=_stripPhrase(q,_FILLER[f]);
    intent.keyword=q.replace(/\\s+/g,' ').trim(); // double-backslash-s — see the note above
    return intent;
  }
  // Submitting from the bar (Enter): parse intent FIRST. If it resolved, hand it to the global
  // applier (VIEWPORT_JS scope) which sets FILT + lights the chips + refetches, and reflect the
  // cleaned keyword in the box. Otherwise fall through to the normal keyword search.
  input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var q=(input.value||'').trim(); if(q){ pushRecent(q);
        var intent=null; try{ intent=parseSearchIntent(q); }catch(err){ intent=null; }
        if(intent && typeof window.__applySearchFilters==='function' && window.__applySearchFilters(intent)){
          var zi=document.getElementById('zsearchInput'); if(zi)zi.value=(typeof window.__lastAppliedKeyword==='string'?window.__lastAppliedKeyword:intent.keyword); // reflect the ACTUAL applied keyword (Players keeps the agency word)
        } else { captureSearch(q); }
      } close(); } if(e.key==='Escape'){ close(); input.blur(); } });
  panel.addEventListener('mousedown',function(e){ // mousedown so it fires before input blur
    var el=e.target.closest('[data-act]'); if(!el){ return; } e.preventDefault();
    var act=el.getAttribute('data-act');
    if(act==='ask'){ var q=(input.value||'').trim(); close(); if(window.openAskMindy){ window.openAskMindy(q); } else if(q){ runSearch(q); } else { input.focus(); } }
    else if(act==='state'){ var st=el.getAttribute('data-st'); if(st) jumpState(st); else close(); }
    else if(act==='run'){ runSearch(el.getAttribute('data-q')||''); }
    else if(act==='unplaced'){ location.href='/opportunity-map/forecasts?q='+encodeURIComponent((input.value||'').trim()); }
    else if(act==='saved'){ // apply a saved search's mode+filters+viewport to the map in place
      var idx=parseInt(el.getAttribute('data-idx'),10); var ss=(window.__zspSaved||[])[idx];
      if(ss && typeof window.__applySavedSearch==='function'){ window.__applySavedSearch(ss); close(); input.blur(); }
      else { location.href='/opportunity-map/saved'; } }
  });
  // Close on outside click.
  document.addEventListener('mousedown',function(e){ if(!e.target.closest('.zsearch')) close(); });
})();
</script>`;

// ── Ask Mindy chat drawer (APPROVED design B + header entry) ──────────────────
// A right-side drawer over the map: ask Mindy a plain-English GovCon question and
// get a streamed, RAG-grounded answer with source chips. Wires to the EXISTING
// backend POST /api/app/chat (SSE: session → token → citations → done). Pro-gated
// server-side (403 pro_required → the drawer shows an upgrade wall). Opened from
// the search dropdown's "Ask Mindy" row + the "Ask Mindy" header pill; context-aware
// (seeds the input with the current search term). Self-contained: its own CSS/HTML/JS
// so it stays isolated from the delicate map code.
const ASK_MINDY_CSS =
  // (The old .amk-btn purple pill CSS was removed 2026-08-02 — Ask Mindy is now the transparent
  // blue .zh-ask nav link, styled up in the header CSS block.)
  '.amk-ov{position:fixed;inset:0;background:rgba(8,15,26,.42);z-index:2600;opacity:0;pointer-events:none;transition:opacity .18s}'
  + '.amk-ov.show{opacity:1;pointer-events:auto}'
  + '.amk{position:fixed;top:0;right:0;height:100dvh;width:min(440px,94vw);background:#fff;box-shadow:-14px 0 44px rgba(16,24,40,.22);z-index:2601;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1)}'
  + '.amk.show{transform:none}'
  + '.amk-hd{display:flex;align-items:center;gap:10px;padding:15px 17px 13px;border-bottom:1px solid #eef1f5}'
  + '.amk-hd .mk{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#1e3a8a,#2563eb);flex:none}'
  + '.amk-hd .tt{flex:1;min-width:0}'
  + '.amk-hd h3{font:800 16px Inter,system-ui,sans-serif;margin:0;color:#111c26;line-height:1.15}'
  // Context line — the grounded "what you\'re looking at" strip, filled from window.__mindyViewCtx().
  + '.amk-ctx{font:600 11.5px Inter,system-ui,sans-serif;color:#2563eb;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.amk-ctx .dim{color:#8595a6;font-weight:500}'
  + '.amk-x{border:0;background:none;font-size:22px;color:#8595a6;cursor:pointer;line-height:1;padding:0;align-self:flex-start}'
  + '.amk-body{flex:1;overflow-y:auto;padding:16px 17px;display:flex;flex-direction:column;gap:14px}'
  + '.amk-msg{max-width:90%;font:400 13.5px/1.55 Inter,system-ui,sans-serif}'
  + '.amk-msg.u{align-self:flex-end;background:#2563eb;color:#fff;padding:9px 13px;border-radius:14px 14px 3px 14px}'
  + '.amk-msg.a{align-self:flex-start;color:#1e2230;width:100%}'
  + '.amk-msg.a .bub{background:#f5f8fb;border:1px solid #e6ebf0;padding:12px 14px;border-radius:12px;white-space:pre-wrap}'
  // Follow-up ACTION chips under an answer (the vision\'s "What agencies use Azure? / Add to pipeline").
  + '.amk-act{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}'
  + '.amk-act button{font:600 11.5px Inter;color:#2563eb;background:#eaf1fe;border:1px solid #d3e2fc;border-radius:8px;padding:6px 11px;cursor:pointer;text-align:left}'
  + '.amk-act button:hover{background:#dbe8fe}'
  + '.amk-typing{display:inline-flex;gap:4px;padding:12px 13px}.amk-typing i{width:6px;height:6px;border-radius:50%;background:#c3c9d4;animation:amkbnc 1s infinite}'
  + '.amk-typing i:nth-child(2){animation-delay:.15s}.amk-typing i:nth-child(3){animation-delay:.3s}@keyframes amkbnc{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}'
  + '.amk-empty{color:#8595a6;font:400 13px Inter;padding:8px 2px}.amk-empty b{color:#111c26;display:block;font:800 15.5px Inter;margin-bottom:4px}.amk-empty .lead{font:500 13px/1.5 Inter;color:#6b7787;margin-bottom:14px}'
  + '.amk-chips{display:flex;flex-wrap:wrap;gap:8px}'
  + '.amk-chips button{font:600 12.5px Inter;color:#243a52;background:#f0f5fb;border:1px solid #e0e8f2;border-radius:10px;padding:9px 12px;cursor:pointer;text-align:left;line-height:1.3}'
  + '.amk-chips button:hover{background:#e6eef8;border-color:#c9d8ea}'
  + '.amk-foot{border-top:1px solid #eef1f5;padding:12px 14px}'
  + '.amk-in{display:flex;gap:8px;align-items:flex-end}'
  + '.amk-in textarea{flex:1;resize:none;border:1px solid #dde3ec;border-radius:12px;padding:10px 12px;font:400 13.5px Inter;color:#111c26;max-height:120px;outline:none}'
  + '.amk-in textarea:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}'
  + '.amk-send{flex:none;width:40px;height:40px;border:0;border-radius:11px;background:#2563eb;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}'
  + '.amk-send:disabled{opacity:.45;cursor:default}.amk-send svg{width:18px;height:18px}'
  + '.amk-up{text-align:center;padding:30px 20px}.amk-up h4{font:800 16px Inter;margin:0 0 6px;color:#111c26}.amk-up p{font:500 13px Inter;color:#6b7787;margin:0 0 14px}'
  + '.amk-up a{display:inline-block;background:#0a8f57;color:#fff;text-decoration:none;border-radius:10px;padding:10px 20px;font:700 13px Inter}'
  + '@media(prefers-color-scheme:dark){.amk{background:#111823}.amk-hd{border-color:#202b39}.amk-hd h3{color:#eaf1f8}.amk-msg.a{color:#eaf1f8}.amk-msg.a .bub{background:#0d141d;border-color:#202b39}.amk-chips button{background:#0d141d;border-color:#202b39;color:#cdd8e4}.amk-foot{border-color:#202b39}.amk-in textarea{background:#0d141d;border-color:#202b39;color:#eaf1f8}.amk-empty b,.amk-up h4{color:#eaf1f8}.amk-act button{background:#122033;border-color:#1f3a5c}}';

const ASK_MINDY_HTML =
  '<div class="amk-ov" id="amkOv"></div>'
  + '<aside class="amk" id="amk" aria-hidden="true">'
  +   '<div class="amk-hd"><span class="mk"></span><div class="tt"><h3>Ask Mindy</h3><div class="amk-ctx" id="amkCtx"></div></div><button class="amk-x" id="amkX" aria-label="Close">&times;</button></div>'
  +   '<div class="amk-body" id="amkBody"></div>'
  +   '<div class="amk-foot"><div class="amk-in"><textarea id="amkIn" rows="1" placeholder="Ask about this view&hellip;"></textarea>'
  +     '<button class="amk-send" id="amkSend" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button></div></div>'
  + '</aside>';

// ── SIGN-IN MODAL (Zillow-style, approved 2026-08-02) ──────────────────────────────────────────
// Replaces the confirm()→location.href='/app' full-page redirect on every gated map action with an
// in-page modal that overlays the map (no page leave). Email-first (one field → Continue → password),
// with Google/Microsoft OAuth + a "Set up my account" path for email-only beta users. On success the
// attempted action RESUMES (window.__signInResume). Auth reuses the exact /app endpoints:
//   POST /api/auth/mindy-login {email,password} → {success, sessionToken, authenticatedAt,
//        needsAccountSetup?, mfaRequired?, error?} — same contract as the /app page.
const LOGIN_MODAL_CSS =
    '.lgm-ov{position:fixed;inset:0;background:rgba(8,15,26,.5);z-index:3200;display:none;align-items:center;justify-content:center;padding:24px}'
  + '.lgm-ov.show{display:flex}'
  + '.lgm{width:100%;max-width:392px;background:#fff;border-radius:14px;position:relative;box-shadow:0 24px 60px -14px rgba(8,15,26,.42),0 0 0 1px rgba(8,15,26,.05);animation:lgmpop .2s cubic-bezier(.2,.9,.3,1.2)}'
  + '@keyframes lgmpop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}'
  + '.lgm-x{position:absolute;top:12px;right:13px;width:32px;height:32px;border:0;background:transparent;color:#8894a2;font-size:21px;line-height:1;border-radius:8px;cursor:pointer}'
  + '.lgm-x:hover{background:#f6f8fb}'
  + '.lgm-in{padding:30px 30px 26px}'
  + '.lgm-brand{display:flex;align-items:center;gap:8px;font:800 19px Inter,system-ui,sans-serif;color:#0b1220;margin-bottom:20px}'
  + '.lgm-brand b{width:24px;height:19px;border-radius:4px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:inline-block}'
  + '.lgm h2{font:800 21px Inter,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 4px;color:#1a2530}'
  + '.lgm-fly{margin:0 0 20px;color:#6b7787;font:500 13.5px/1.5 Inter,system-ui,sans-serif}.lgm-fly b{color:#1a2530;font-weight:700}'
  // ── PLAYERS UNLOCK PANEL — the FIRST PAYWALL MOMENT. Aspirational, not restrictive: it shows
  // what is behind the wall (blurred, so the value is SEEN not described) rather than refusing.
  + '.pu-h{margin:0 0 6px;font:800 21px/1.25 Inter,system-ui,sans-serif;color:#0f1e2e;letter-spacing:-.01em}'
  + '.pu-sub{margin:0 0 16px;color:#6b7787;font:500 13.5px/1.5 Inter,system-ui,sans-serif}'
  + '.pu-wrap{position:relative;border:1px solid #e4e9ee;border-radius:12px;overflow:hidden;margin:0 0 18px;background:#fbfcfd}'
  + '.pu-list{padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}'
  + '@media(max-width:520px){.pu-list{grid-template-columns:1fr}}'
  + '.pu-row{display:flex;align-items:center;gap:9px;font:600 13px/1.3 Inter,system-ui,sans-serif;color:#1a2530}'
  + '.pu-row svg{flex:0 0 15px;color:#0a8f57}'
  // The blurred strip: a REAL preview of the record shape, unreadable on purpose.
  + '.pu-blur{padding:12px 16px 14px;border-top:1px solid #eef1f4;filter:blur(4.5px);user-select:none;pointer-events:none;opacity:.75}'
  + '.pu-brow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px}'
  + '.pu-bk{font:600 11px/1 Inter,system-ui,sans-serif;color:#8b98a8;text-transform:uppercase;letter-spacing:.05em}'
  + '.pu-bv{height:9px;border-radius:5px;background:linear-gradient(90deg,#c8d2dc,#e2e8ee);flex:1;max-width:190px}'
  + '.pu-oauth{display:flex;flex-direction:column;gap:8px;margin:0 0 14px}'
  + '.pu-btn{display:flex;align-items:center;justify-content:center;gap:9px;padding:11px 14px;border:1px solid #d8dee6;border-radius:10px;background:#fff;color:#1a2530;font:600 14px/1 Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer}'
  + '.pu-btn:hover{background:#f6f8fa;border-color:#c3ccd6}'
  + '.pu-or{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#98a4b2;font:600 11px/1 Inter,system-ui,sans-serif}'
  + '.pu-or:before,.pu-or:after{content:"";flex:1;height:1px;background:#e6ebf0}'
  + '.pu-foot{margin:14px 0 0;color:#8b98a8;font:500 12.5px/1.5 Inter,system-ui,sans-serif;text-align:center}'
  + '.lgm label{display:block;font:700 12.5px Inter,system-ui,sans-serif;color:#3a4a58;margin:0 0 7px 1px}'
  + '.lgm input{width:100%;height:48px;border:1.5px solid #e3e8ee;border-radius:11px;padding:0 14px;font:500 15px Inter,system-ui,sans-serif;color:#1a2530;outline:none;transition:border-color .12s,box-shadow .12s}'
  + '.lgm input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}'
  + '.lgm-cta{width:100%;height:48px;margin-top:16px;border:0;border-radius:11px;background:#2563eb;color:#fff;font:800 15px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 10px -3px rgba(37,99,235,.5);transition:filter .12s}'
  + '.lgm-cta:hover{filter:brightness(1.07)}.lgm-cta:disabled{opacity:.6;cursor:default}'
  + '.lgm-create{margin:16px 0 0;font:500 13.5px Inter,system-ui,sans-serif;color:#6b7787}.lgm-create a{color:#2563eb;font-weight:700;text-decoration:none;cursor:pointer}'
  + '.lgm-div{display:flex;align-items:center;gap:12px;margin:22px 0;color:#9aa7b4;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.08em}'
  + '.lgm-div::before,.lgm-div::after{content:"";flex:1;height:1px;background:#e3e8ee}'
  + '.lgm-oauth{display:flex;flex-direction:column;gap:10px}'
  + '.lgm-oauth button{display:flex;align-items:center;justify-content:center;gap:11px;height:47px;border:1.5px solid #e3e8ee;background:#fff;border-radius:11px;font:700 14.5px Inter,system-ui,sans-serif;color:#243;cursor:pointer;transition:border-color .12s,background .12s}'
  + '.lgm-oauth button:hover{border-color:#c4cfda;background:#f6f8fb}.lgm-oauth svg{width:19px;height:19px;flex:none}'
  + '.lgm-fine{margin:20px 0 0;text-align:center;color:#9aa7b4;font:500 11.5px/1.5 Inter,system-ui,sans-serif}.lgm-fine a{color:#7b8794;text-decoration:underline}'
  + '.lgm-back{display:flex;align-items:center;gap:8px;margin:0 0 16px;color:#6b7787;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}.lgm-back svg{width:15px;height:15px}'
  + '.lgm-chip{font:600 13px Inter,system-ui,sans-serif;color:#1a2530}'
  + '.lgm-forgot{display:block;margin:12px 1px 0;font:700 12.5px Inter,system-ui,sans-serif;color:#2563eb;text-decoration:none;cursor:pointer}'
  + '.lgm-err{margin:12px 0 0;color:#c0392b;font:600 13px Inter,system-ui,sans-serif}'
  + '.lgm-step2{display:none}'
  + '.lgm-ok{width:52px;height:52px;margin:2px auto 14px;border-radius:50%;background:#eafaf1;color:#15a34a;display:flex;align-items:center;justify-content:center}.lgm-ok svg{width:26px;height:26px}';

const LOGIN_MODAL_HTML =
    '<div class="lgm-ov" id="lgmOv"><div class="lgm" role="dialog" aria-modal="true" aria-label="Sign in">'
  +   '<button class="lgm-x" id="lgmX" aria-label="Close">&times;</button>'
  +   '<div class="lgm-in">'
  +     '<div class="lgm-brand"><b></b>Mindy</div>'
        // STEP 1 — email-first
  +     '<div class="lgm-step1" id="lgmStep1">'
  +       '<div id="lgmUnlock"></div>'   // Players fills this; empty (and invisible) for every other gated action
  +       '<h2 id="lgmH1">Sign in</h2>'
  +       '<p class="lgm-fly" id="lgmFly"><b>Browsing is free.</b> Sign in to draft, save, and reach the players.</p>'
  +       '<label for="lgmEmail">Email</label>'
  +       '<input type="email" id="lgmEmail" placeholder="you@company.com" autocomplete="email">'
  +       '<div class="lgm-err" id="lgmErr1" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmCont">Continue</button>'
  +       '<p class="lgm-create">New to Mindy? <a id="lgmCreate">Create a free account</a></p>'
  +       '<div class="lgm-div">OR</div>'
  +       '<div class="lgm-oauth">'
  +         '<button id="lgmGoogle"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"/></svg>Continue with Google</button>'
  +         '<button id="lgmMs"><svg viewBox="0 0 24 24"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>Continue with Microsoft</button>'
  +       '</div>'
  +       '<p class="lgm-fine">By continuing you accept Mindy&#39;s <a href="/terms" target="_blank">Terms</a> &amp; <a href="/privacy" target="_blank">Privacy</a>.</p>'
  +     '</div>'
        // STEP 2 — password
  +     '<div class="lgm-step2" id="lgmStep2">'
  +       '<div class="lgm-back" id="lgmBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back</div>'
  +       '<h2 id="lgmS2Title">Welcome back</h2>'
  +       '<p class="lgm-fly">Signing in as <span class="lgm-chip" id="lgmEmailChip"></span></p>'
  +       '<label for="lgmPass">Password</label>'
  +       '<input type="password" id="lgmPass" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password">'
  +       '<a class="lgm-forgot" id="lgmForgot">Forgot password?</a>'
  +       '<div class="lgm-err" id="lgmErr2" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmSignin">Sign in</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:18px" id="lgmSetupRow">No password yet? <a id="lgmSetup">Set up my account</a></p>'
  +     '</div>'
        // STEP 3 — create a free account (name + email; password is set via the emailed setup link)
  +     '<div class="lgm-step3" id="lgmStep3" style="display:none">'
  +       '<div class="lgm-back" id="lgmBack3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back</div>'
  +       '<h2>Create your free account</h2>'
  +       '<p class="lgm-fly"><b>Free forever.</b> Daily opportunities, market research, and saved searches &mdash; no card required.</p>'
  +       '<label for="lgmSuName">Name</label>'
  +       '<input type="text" id="lgmSuName" placeholder="Jane Contractor" autocomplete="name">'
  +       '<label for="lgmSuEmail" style="margin-top:14px">Work email</label>'
  +       '<input type="email" id="lgmSuEmail" placeholder="you@company.com" autocomplete="email">'
  +       '<div class="lgm-err" id="lgmErr3" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmSuBtn">Continue</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:16px">Already have an account? <a id="lgmToSignin">Sign in</a></p>'
  +     '</div>'
        // STEP 4 — signup success. Outcome-first ("your work is saved"), NOT a chore ("go do this").
        // Explains WHY (verify email, ~30s), lets them keep browsing, and the pending action is queued
        // to complete automatically when they return via the setup link.
  +     '<div class="lgm-step4" id="lgmStep4" style="display:none;text-align:center">'
  +       '<div class="lgm-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>'
  +       '<h2 id="lgmOkTitle">Your account has been created</h2>'
  +       '<p class="lgm-fly" id="lgmOkMsg" style="text-align:center">One last step &mdash; we verify your email before saving your opportunities. It takes about 30&nbsp;seconds. We&#39;ve emailed you a secure setup link.</p>'
  +       '<p class="lgm-fly" id="lgmOkResume" style="text-align:center;color:#1a2530"><b>Your work is safe.</b> When you finish setup, what you saved will already be waiting for you here.</p>'
  +       '<button class="lgm-cta" id="lgmOkDone">Continue browsing</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:14px">Didn&#39;t get it? <a id="lgmResend">Resend email</a></p>'
  +     '</div>'
  +   '</div>'
  +   '</div>'
  + '</div>';

const ASK_MINDY_JS = `<script>(function(){
  var ov=document.getElementById('amkOv'), drawer=document.getElementById('amk'), body=document.getElementById('amkBody'), input=document.getElementById('amkIn'), send=document.getElementById('amkSend'), ctxEl=document.getElementById('amkCtx');
  if(!ov||!drawer||!body) return;
  function esc(x){ return (x==null?'':String(x)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function tok(){ try{return localStorage.getItem('mi_beta_auth_token');}catch(e){return null;} }
  function email(){ try{ var t=tok()||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){ return ''; } }
  var sessionId='', history=[], busy=false;
  // ── The GROUNDED view context (approved vision: "Context: N open opps in view \\u00b7 FL \\u00b7 NAICS 236220").
  // Read fresh from the map's bridge every time the drawer opens — never a stale snapshot, never fabricated.
  function viewCtx(){ try{ if(typeof window.__mindyViewCtx==='function') return window.__mindyViewCtx()||{}; }catch(e){} return {}; }
  function fmtN(n){ n=+n||0; return n>=1000?n.toLocaleString():String(n); }
  var SCOPE_LABEL={all:'open opps',open:'open opps',recompete:'recompetes',forecast:'forecasts',grants:'grants',companies:'firms',buyers:'buyers'};
  function ctxParts(c){
    var noun=SCOPE_LABEL[c.scope]||'opps';
    var p=[fmtN(c.count)+(c.capped?'+':'')+' '+noun+' in view'];
    if(c.q) p.push('\\u201c'+c.q+'\\u201d');
    if(c.state) p.push(c.state);
    if(c.naics) p.push('NAICS '+c.naics);
    if(c.psc) p.push('PSC '+c.psc);
    if(c.setAside) p.push(String(c.setAside).split(',')[0]);
    if(c.agency) p.push(c.agency);
    return p;
  }
  function renderCtx(){ if(!ctxEl)return; var c=viewCtx(); var parts=ctxParts(c);
    ctxEl.innerHTML='<span class="dim">Context:</span> '+parts.map(esc).join(' \\u00b7 '); }
  // Threaded to the chat so answers are about THIS view — a compact, factual preface (no invented numbers).
  function ctxPreamble(){ var c=viewCtx(); var parts=ctxParts(c); if(!parts.length)return '';
    return '[Current map view \\u2014 '+parts.join('; ')+'. Answer for THIS view when the question is about "these"/"this"/"here".]\\n\\n'; }
  function setOpen(o){ ov.classList.toggle('show',o); drawer.classList.toggle('show',o); drawer.setAttribute('aria-hidden',o?'false':'true'); if(o){ renderCtx(); if(!body.children.length){ greet(); } setTimeout(function(){ input&&input.focus(); },220); } }
  function greet(){
    var c=viewCtx();
    // View-aware follow-up chips — data-core only, NO teaching. Adapt the wording to what\\u2019s in view.
    var chips=[];
    if(c.count>0){ chips.push(['Who buys the most here?','Which agencies buy the most in this view? Name them with their spend.']);
      chips.push(['Who wins these?','Which firms win the most contracts in this view? List the top incumbents.']); }
    else { chips.push(['Who buys 541512 work?','Which agencies buy the most NAICS 541512 (custom computer programming) work?']);
      chips.push(['Find the incumbent','How do I find who currently holds a contract before it recompetes?']); }
    chips.push(['Write a capability statement','What should my capability statement include for the agencies in this view?']);
    chips.push(['Add a target to my pipeline','How do I track one of these opportunities in my pipeline?']);
    var h='<div class="amk-empty"><b>Ask about what you\\u2019re looking at</b><div class="lead">Agencies, incumbents, set-asides, teaming \\u2014 answered from live federal data for this view.</div><div class="amk-chips">';
    chips.forEach(function(ch){ h+='<button data-q="'+esc(ch[1])+'">'+esc(ch[0])+'</button>'; });
    h+='</div></div>';
    body.innerHTML=h;
    Array.prototype.forEach.call(body.querySelectorAll('.amk-chips button'),function(b){ b.onclick=function(){ ask(b.getAttribute('data-q')); }; });
  }
  // Public opener — context-aware: seed the input with the current search term (does NOT auto-send).
  window.openAskMindy=function(seed){
    var q=(seed!=null?String(seed):'').trim();
    if(!q){ var c=viewCtx(); if(c&&c.q)q=String(c.q).trim(); }
    if(q&&input)input.value=q;
    setOpen(true);
  };
  var x=document.getElementById('amkX'); if(x)x.onclick=function(){ setOpen(false); };
  ov.onclick=function(){ setOpen(false); };
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&drawer.classList.contains('show'))setOpen(false); });
  // Auto-grow the textarea + Enter-to-send (Shift+Enter = newline).
  if(input){ input.addEventListener('input',function(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,120)+'px'; });
    input.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); ask(input.value); } }); }
  if(send)send.onclick=function(){ ask(input?input.value:''); };
  function addMsg(role, text){ var d=document.createElement('div'); d.className='amk-msg '+(role==='user'?'u':'a'); d.innerHTML=(role==='user')?esc(text):('<div class="bub"></div>'); if(role!=='user')d.querySelector('.bub').textContent=text||''; body.appendChild(d); body.scrollTop=body.scrollHeight; return d; }
  function upsell(){ body.innerHTML='<div class="amk-up"><h4>\\ud83d\\udd12 Ask Mindy is a Pro feature</h4><p>Get grounded, real-data answers on set-asides, agencies, opportunities, teaming and proposals \\u2014 with sources.</p><a href="/market-intelligence">Upgrade to Pro</a></div>'; }
  function ask(q){
    q=(q||'').trim(); if(!q||busy)return;
    var t=tok(), em=email();
    if(!t||!em){ if(window.openSignInModal){window.openSignInModal('ask Mindy',function(){location.reload();});}else{location.href='/app?next='+encodeURIComponent(location.pathname);} return; }
    // clear the greeting on first ask
    if(body.querySelector('.amk-empty'))body.innerHTML='';
    if(input){ input.value=''; input.style.height='auto'; }
    addMsg('user', q);
    var aEl=addMsg('assistant',''); var bub=aEl.querySelector('.bub');
    bub.innerHTML='<span class="amk-typing"><i></i><i></i><i></i></span>';
    busy=true; if(send)send.disabled=true;
    var acc='', started=false;
    // Prepend the grounded view context to the MESSAGE (not shown to the user) so the answer
    // is about "these"/"here" — the map\\u2019s real filters + count, never fabricated.
    var sendMsg=ctxPreamble()+q;
    fetch('/api/app/chat',{method:'POST',headers:{'Content-Type':'application/json','x-mi-auth-token':t,'x-user-email':em},body:JSON.stringify({email:em,message:sendMsg,sessionId:sessionId||undefined,history:history.slice(-8)})})
      .then(function(r){
        if(r.status===403){ upsell(); busy=false; if(send)send.disabled=false; return null; }
        if(r.status===401){ bub.textContent='Please sign in again to ask Mindy.'; busy=false; if(send)send.disabled=false; return null; }
        if(!r.ok||!r.body){ bub.textContent='Something went wrong. Try again.'; busy=false; if(send)send.disabled=false; return null; }
        var reader=r.body.getReader(), dec=new TextDecoder(), buf='';
        function pump(){ return reader.read().then(function(res){
          if(res.done){ finish(); return; }
          buf+=dec.decode(res.value,{stream:true});
          var parts=buf.split('\\n\\n'); buf=parts.pop();
          parts.forEach(function(p){ var line=p.split('\\n').filter(function(l){return l.indexOf('data:')===0;}).map(function(l){return l.slice(5).trim();}).join(''); if(!line)return;
            var ev; try{ ev=JSON.parse(line); }catch(e){ return; }
            if(ev.type==='session'){ sessionId=ev.sessionId||sessionId; }
            else if(ev.type==='token'){ if(!started){ bub.textContent=''; started=true; } acc+=(ev.content||''); bub.textContent=acc; body.scrollTop=body.scrollHeight; }
            // citations event is now always empty (RAG corpus removed 2026-08-02) \\u2014 ignored.
            else if(ev.type==='error'){ if(!started)bub.textContent=(ev.message||'Something went wrong.'); }
          });
          return pump();
        }); }
        function finish(){ if(!started&&!acc)bub.textContent='Mindy had no answer for that \\u2014 try rephrasing.'; history.push({role:'user',content:q}); history.push({role:'assistant',content:acc}); if(acc)followups(aEl); busy=false; if(send)send.disabled=false; body.scrollTop=body.scrollHeight; }
        return pump();
      })
      .catch(function(){ bub.textContent='Connection failed. Check your network and try again.'; busy=false; if(send)send.disabled=false; });
  }
  // Follow-up ACTION chips under an answer (the vision\\u2019s bottom row). Data-core next steps only.
  function followups(aEl){
    var c=viewCtx();
    var acts=[];
    if(c.count>0){ acts.push(['Who are the contacts?','Who are the buying-office contacts for opportunities in this view? Give names and emails.']);
      acts.push(['Set-aside breakdown','What is the set-aside breakdown for this view?']); }
    acts.push(['Write a capability statement','Draft a short capability statement tailored to the agencies in this view.']);
    acts.push(['Add to my pipeline','How do I add one of these to my pipeline to track it?']);
    var wrap=document.createElement('div'); wrap.className='amk-act';
    acts.slice(0,4).forEach(function(a){ var b=document.createElement('button'); b.textContent=a[0]; b.onclick=function(){ ask(a[1]); }; wrap.appendChild(b); });
    aEl.appendChild(wrap); body.scrollTop=body.scrollHeight;
  }
})();
</script>`;

// The sign-in modal's behavior. window.openSignInModal(phrase, onSuccess) is the ONE entry point;
// requireSignIn (in SAVE_JS) calls it instead of confirm()+redirect. On a successful sign-in the
// token lands in localStorage (same key the map reads) and onSuccess() re-fires the gated action.
// Decision-Card instrumentation (Eric 2026-08-03). Logs card IMPRESSION (scrolled into view, once
// per opp per page) + card CLICK through the EXISTING engagement pipe (/api/app/engagement →
// user_engagement). This is the prerequisite for the future A/B of hero treatments + "which opps
// get clicked" ranking — nothing about the card renders differently; it just measures.
//   • SIGNED-IN ONLY: /api/app/engagement verifies the email (verifyUserOwnsEmail), so a logged-out
//     browser would 400. Their behavior isn't attributable anyway — we skip cleanly (no email → no
//     beacon). Uses the same mi_beta_auth_token identity every other authed map fetch uses.
//   • FIRE-AND-FORGET: sendBeacon (survives the navigation the click triggers), never throws, never
//     blocks the drawer open. A tracking failure must never touch the user's flow.
//   • eventType is a VALID catalog type (link_click / tool_use); metadata carries {kind, opp, variant,
//     est, src} so the analysis can split click vs impression + the hero variant (estimate_only for v1).
const CARD_TRACK_JS = `<script>(function(){
  function em(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; var s=t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; var j=JSON.parse(atob(s)); if(j&&j.email)return String(j.email).toLowerCase(); }catch(e){} try{ var b=localStorage.getItem('briefings_access_email'); return b?b.toLowerCase().trim():''; }catch(e2){} return ''; }
  var seen={}; // opp id -> 1, so an impression fires at most ONCE per opp per page load
  window.__trackCard=function(kind,sol,o){
    try{
      var e=em(); if(!e||!sol) return;                 // signed-in only; no id → skip
      if(kind==='impression'){ if(seen[sol]) return; seen[sol]=1; }
      // The Expanded Decision Card measures the four questions the freeze exists to answer (Eric
      // 2026-08-04): which popup OPENS (kind:'popup_open'), which CTA CLICKS (kind:'cta_click'),
      // which LIFECYCLE converts (meta.lifecycle = open|recompete|forecast, so open→cta ratios
      // split by horizon), and which IDENTITY is remembered (meta.identity = the agency·story the
      // card leads with). 'estimate_only' variant is the A/B seed — Version B (hero 20% smaller)
      // stamps a different variant so title-read proxies (cta after open) are comparable.
      var lifecycle=(o&&o.src==='RECOMPETE')?'recompete':((o&&o.src==='FORECAST')?'forecast':'open');
      var identity=o?((o.subAgency&&String(o.subAgency).trim())?String(o.subAgency):String(o.agency||'')):'';
      // story = the DNA strand the card LEADS with (the dominant genome strand, matching dnaRow's
      // reveal), so the "which identity is remembered" analysis reflects what actually rendered.
      var story=''; try{ if(o&&o.dna&&o.dna.length){ var _t={good:0,watch:1,neutral:2};
        var _s=o.dna.slice().sort(function(a,b){return (a.tier-b.tier)||((_t[a.tone]||0)-(_t[b.tone]||0));});
        story=_s[0]&&_s[0].label||''; } }catch(_e){}
      // "WHY THIS OPPORTUNITY?" — the FULL set of grounded strand KEYS the user saw on this opp (sorted,
      // stable keys not labels). story is just the dominant one; dna is the complete genome the opp
      // CARRIED. With this on both impression AND click, the read side computes per-strand click-through:
      // which strands DRIVE the click (impression→click rate by strand) → the recommendation-engine seed.
      var dna=[]; try{ if(o&&o.dna&&o.dna.length){ dna=o.dna.map(function(s){return s.key;}).filter(Boolean).sort(); } }catch(_e2){}
      // ── RECENTLY VIEWED needs a JOINABLE id (Eric 2026-08-15: "add the notice_id to the view
      // event so recently viewed works"). opp was whatever the caller passed FIRST — measured
      // over 1,000 real events: 929 solicitation numbers, 57 forecast fc- ids, and only 14 real
      // notice_id hex. So a join against sam_opportunities.notice_id matched ~1.4% of views.
      // (Same id-shape mismatch as the paused decision-time note.)
      // Fix: stamp BOTH, explicitly. opp keeps its meaning for every existing read (the funnel
      // dashboard, per-strand click-through) — nothing downstream changes — and nid is the new
      // join key, present only when we genuinely have one. Never invent it: a card without a real
      // notice_id (a forecast) leaves nid null rather than falling back to the sol number, so a
      // null means "no notice" instead of "wrong id".
      var nid=''; try{ if(o&&o.nid&&/^[a-f0-9]{32}$/i.test(String(o.nid))) nid=String(o.nid);
                       else if(/^[a-f0-9]{32}$/i.test(String(sol))) nid=String(sol); }catch(_e3){}
      var meta={ kind:kind, opp:String(sol), nid:nid||null, variant:'estimate_only',
                 src:(o&&o.src)||'', est:(o&&Number(o.est))||0, title:(o&&o.title)?String(o.title).slice(0,140):'',
                 lifecycle:lifecycle, identity:identity, story:story, dna:dna };
      // A VIEW is not an IMPRESSION. Measured: 966 impressions (a pin scrolling into the viewport)
      // vs 18 popup_opens (someone actually looking). Recently Viewed reads ONLY the deliberate
      // ones — 'popup_open' and 'click'/'cta_click' — so it can never list an opp you never opened.
      var payload=JSON.stringify({ email:e,
        eventType:(kind==='cta_click'||kind==='click'?'link_click':'tool_use'),
        eventSource:'source_feed', metadata:meta });
      if(navigator.sendBeacon){ var bl=new Blob([payload],{type:'application/json'}); if(navigator.sendBeacon('/api/app/engagement',bl)) return; }
      fetch('/api/app/engagement',{method:'POST',headers:{'Content-Type':'application/json','x-user-email':e},body:payload,keepalive:true}).catch(function(){});
    }catch(e){}
  };
  // One shared observer; each card is observed as it's appended (see the card-append seam). Fires an
  // impression the first time ≥60% of the card is visible, then unobserves it (one event per card).
  try{
    window.__cardObs=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting && en.intersectionRatio>=0.6){
          var el=en.target, sol=el&&el.dataset&&el.dataset.sol;
          if(sol){ window.__trackCard('impression',sol,null); }
          try{ window.__cardObs.unobserve(el); }catch(e){}
        }
      });
    },{ threshold:[0.6] });
  }catch(e){ window.__cardObs=null; }
})();</script>`;

const LOGIN_MODAL_JS = `<script>(function(){
  var ov=document.getElementById('lgmOv');
  if(!ov) return;
  var s1=document.getElementById('lgmStep1'), s2=document.getElementById('lgmStep2');
  var s3=document.getElementById('lgmStep3'), s4=document.getElementById('lgmStep4');
  var emailIn=document.getElementById('lgmEmail'), passIn=document.getElementById('lgmPass');
  var suName=document.getElementById('lgmSuName'), suEmail=document.getElementById('lgmSuEmail'), suBtn=document.getElementById('lgmSuBtn');
  var fly=document.getElementById('lgmFly'), chip=document.getElementById('lgmEmailChip');
  var err1=document.getElementById('lgmErr1'), err2=document.getElementById('lgmErr2'), err3=document.getElementById('lgmErr3');
  var cont=document.getElementById('lgmCont'), signin=document.getElementById('lgmSignin');
  var setupRow=document.getElementById('lgmSetupRow');
  var _resume=null;      // in-memory callback to re-run the gated action after an in-page sign-in
  var _phrase='';        // the action phrase ("save this to your pursuits") — persisted with the queued intent
  var _signedUpEmail=''; // email used in the signup step (for Resend)

  function showErr(el,msg){ if(!el)return; el.textContent=msg||''; el.style.display=msg?'block':'none'; }
  // 4 steps: 1 email · 2 password · 3 create-account · 4 signup-success.
  function step(n){
    if(s1)s1.style.display=n===1?'block':'none';
    if(s2)s2.style.display=n===2?'block':'none';
    if(s3)s3.style.display=n===3?'block':'none';
    if(s4)s4.style.display=n===4?'block':'none';
  }
  function close(){ ov.classList.remove('show'); showErr(err1,''); showErr(err2,''); showErr(err3,''); }
  function open(){ ov.classList.add('show'); step(1); setTimeout(function(){ emailIn&&emailIn.focus(); },60); }

  // Preserve the caller's intent + a resume callback. next= keeps OAuth's return landing here.
  window.openSignInModal=function(phrase,onSuccess){
    _phrase = phrase||'';
    _resume = (typeof onSuccess==='function') ? onSuccess : function(){ location.reload(); };
    if(fly) fly.innerHTML='<b>Browsing is free.</b> Sign in to '+(phrase||'draft, save, and reach the players')+'.';
    open();
  };

  cont && cont.addEventListener('click', function(){
    var em=(emailIn.value||'').trim().toLowerCase();
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){ showErr(err1,'Enter a valid email.'); return; }
    showErr(err1,''); chip.textContent=em; if(setupRow)setupRow.style.display='none';
    step(2); setTimeout(function(){ passIn&&passIn.focus(); },60);
  });
  emailIn && emailIn.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); cont.click(); } });

  function doLogin(){
    var em=(emailIn.value||'').trim().toLowerCase(), pw=passIn.value||'';
    if(!pw){ showErr(err2,'Enter your password.'); return; }
    showErr(err2,''); signin.disabled=true; var was=signin.textContent; signin.textContent='Signing in\\u2026';
    fetch('/api/auth/mindy-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})})
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(d){
        signin.disabled=false; signin.textContent=was;
        if(!d||!d.success){
          // No account yet → point to the setup path (email-only beta users have no password).
          if(d&&d.needsAccountSetup&&setupRow) setupRow.style.display='block';
          showErr(err2,(d&&d.error)||'Could not sign in. Check your password.');
          return;
        }
        // Paid-MFA: server verified the password but wants a 2FA code (already emailed). The modal
        // doesn't do the code step yet — hand off to /app which owns that flow, preserving return.
        if(d.mfaRequired){ location.href='/app?next='+encodeURIComponent(location.pathname+location.search)+'&email='+encodeURIComponent(em); return; }
        try{ localStorage.setItem('mi_beta_auth_token',d.sessionToken); if(d.authenticatedAt)localStorage.setItem('mi_beta_authenticated_at',d.authenticatedAt); }catch(e){}
        close();
        var cb=_resume; _resume=null; if(cb) try{ cb(); }catch(e){}
      })
      .catch(function(){ signin.disabled=false; signin.textContent=was; showErr(err2,'Network error — try again.'); });
  }
  signin && signin.addEventListener('click', doLogin);
  passIn && passIn.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); doLogin(); } });

  // OAuth + setup + create + forgot all hand off to /app (OAuth can't complete inside the modal —
  // it redirects to the provider), preserving a same-page return so the user lands back here.
  function toApp(extra){ var n=encodeURIComponent(location.pathname+location.search); location.href='/app?next='+n+(extra||''); }
  var g=document.getElementById('lgmGoogle'); g&&g.addEventListener('click',function(){ toApp('&oauth=google'); });
  var ms=document.getElementById('lgmMs'); ms&&ms.addEventListener('click',function(){ toApp('&oauth=microsoft'); });
  // "Create a free account" now stays IN the modal (Step 3) — no page leave. Prefill the email if typed.
  var cr=document.getElementById('lgmCreate'); cr&&cr.addEventListener('click',function(){
    if(suEmail && emailIn && emailIn.value) suEmail.value=emailIn.value;
    step(3); setTimeout(function(){ var f=(suName&&!suName.value)?suName:suEmail; f&&f.focus(); },60);
  });
  var su=document.getElementById('lgmSetup'); su&&su.addEventListener('click',function(){ toApp('&setup=1&email='+encodeURIComponent((emailIn.value||'').trim().toLowerCase())); });
  var fg=document.getElementById('lgmForgot'); fg&&fg.addEventListener('click',function(){ toApp('&forgot=1&email='+encodeURIComponent((emailIn.value||'').trim().toLowerCase())); });

  // ── Step 3: create a free account (email-first; password set via the emailed setup link).
  // The pending action (Save/Pursuit) is QUEUED to localStorage BEFORE the email round-trip, so it
  // completes automatically when the user returns via the setup link — the intent is never lost.
  function queueIntent(em){
    try{
      var q=[]; try{ q=JSON.parse(localStorage.getItem('mindy_pending_intents')||'[]')||[]; }catch(e){}
      if(!Array.isArray(q))q=[];
      q.push({ path:location.pathname+location.search, phrase:_phrase||'', email:em, ts:Date.now() });
      var cut=Date.now()-864e5; q=q.filter(function(x){return x&&x.ts&&x.ts>cut;}).slice(-10); // last 10, 24h
      localStorage.setItem('mindy_pending_intents', JSON.stringify(q));
    }catch(e){}
  }
  function doSignup(){
    var em=(suEmail.value||'').trim().toLowerCase();
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){ showErr(err3,'Enter a valid work email.'); return; }
    showErr(err3,''); suBtn.disabled=true; var was=suBtn.textContent; suBtn.textContent='Creating\\u2026';
    var payload={ email:em, name:(suName&&suName.value||'').trim() };
    try{ var a=localStorage.getItem('gca_attribution'); if(a)payload.attribution=JSON.parse(a); }catch(e){}
    fetch('/api/auth/mindy-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(d){
        suBtn.disabled=false; suBtn.textContent=was;
        if(!d||!d.success){ showErr(err3,(d&&d.error)||'Could not create your account. Try again.'); return; }
        _signedUpEmail=em;
        queueIntent(em);                                        // intent now safe across the email round-trip
        try{ localStorage.setItem('briefings_access_email',em); }catch(e){} // return-boot knows who they are
        var resPhrase=document.getElementById('lgmOkResume');
        if(resPhrase) resPhrase.innerHTML='<b>Your work is safe.</b> When you finish setup, what you saved will already be waiting for you here.';
        step(4);
      })
      .catch(function(){ suBtn.disabled=false; suBtn.textContent=was; showErr(err3,'Network error \\u2014 try again.'); });
  }
  suBtn && suBtn.addEventListener('click', doSignup);
  suEmail && suEmail.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); doSignup(); } });
  suName && suName.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); suEmail&&suEmail.focus(); } });
  var toSi=document.getElementById('lgmToSignin'); toSi&&toSi.addEventListener('click',function(){ step(1); setTimeout(function(){ emailIn&&emailIn.focus(); },60); });
  var b3=document.getElementById('lgmBack3'); b3&&b3.addEventListener('click',function(){ step(1); });

  // ── Step 4: success. "Continue browsing" just closes (session stays unlocked — more saves keep
  // queueing). "Resend" re-hits signup for the same email.
  var okDone=document.getElementById('lgmOkDone'); okDone&&okDone.addEventListener('click',close);
  var resend=document.getElementById('lgmResend'); resend&&resend.addEventListener('click',function(){
    if(!_signedUpEmail)return; resend.textContent='Sending\\u2026';
    fetch('/api/auth/mindy-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:_signedUpEmail})})
      .then(function(){ resend.textContent='Sent \\u2713'; setTimeout(function(){ resend.textContent='Resend email'; },2500); })
      .catch(function(){ resend.textContent='Resend email'; });
  });

  document.getElementById('lgmX')&&document.getElementById('lgmX').addEventListener('click',close);
  document.getElementById('lgmBack')&&document.getElementById('lgmBack').addEventListener('click',function(){ step(1); });
  ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&ov.classList.contains('show')) close(); });

  // ── Return from the setup link: the user is now SIGNED IN and back on the map. If we queued an
  // intent for them during signup, greet them so the loop closes with a payoff, not silence. We show
  // the reassurance (their intent was remembered) and re-open the sign-in flow's resume path where we
  // safely can; we do NOT fabricate a completed save we can't verify — the banner points them at it.
  function isSignedIn(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; return t.split('.').length>=2; }catch(e){ return false; } }
  function drainPendingIntents(){
    if(!isSignedIn()) return;
    var q=[]; try{ q=JSON.parse(localStorage.getItem('mindy_pending_intents')||'[]')||[]; }catch(e){}
    if(!Array.isArray(q)||!q.length) return;
    var mine=q.filter(function(x){ return x && x.path && x.path.indexOf('/opportunity-map')===0; });
    if(!mine.length) return;
    try{ localStorage.removeItem('mindy_pending_intents'); }catch(e){}
    // Delightful, honest welcome-back — NOT a claim we auto-saved. Uses the existing toast if present.
    var msg='Welcome back — pick up right where you left off. What you were saving is ready to go.';
    try{ if(typeof window.__toast==='function'){ window.__toast(msg); return; } }catch(e){}
    var t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:3400;background:#0b1220;color:#fff;padding:12px 18px;border-radius:11px;font:600 13.5px Inter,system-ui,sans-serif;box-shadow:0 10px 30px -8px rgba(8,15,26,.5);max-width:92vw';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); },420); }, 6000);
  }
  try{ drainPendingIntents(); }catch(e){}
})();</script>`;

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
      // SOW card facts (Tier 1) — undefined when not yet computed or nothing found (never
      // fabricated). brandNameOrEqual is the 🚩 warning pill; evalBasis is the Best Value/LPTA
      // chip. Both cap-the-view: 2 highest-signal facts on the card, full set in the drawer.
      brandNameOrEqual: o.brandNameOrEqual || false,
      evalBasis: o.evalBasis || null,
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
    // Turn the (already-built) grid clustering ON for the embed only — see the CLUSTER_MAX_ZOOM
    // note in PIN_JS. Must be set BEFORE the pin script runs, so it goes in <head>.
    html = repl(html, '</head>', '<script>window.__EMBED_CLUSTER__=1;</script>' + EMBED_CSS + '</head>');
    // ⚠️ PIN_JS ONLY EVER SHIPPED ON THE NON-EMBED BRANCH (it was concatenated at the `else`
    // side's leaflet.js injection). The template calls its helpers behind `typeof` guards —
    // `(typeof clusterRows==='function') ? clusterRows(...) : {singles:rows}` — so in the embed
    // they were all undefined and the code SILENTLY took the fallback: no clustering, no mkPin,
    // just raw circleMarkers. That is why the front page rendered 600 opportunities as ~35
    // visible dots (measured: 600 path.leaflet-interactive nodes, 76 distinct coordinates, 403
    // of them stacked on one pixel over Columbus OH) while every `typeof` guard quietly passed.
    // A guard that degrades silently hides a missing dependency instead of surfacing it.
    // VTAG_CSS ships too — mkPin/cluster bubbles render divIcons that need those classes.
    html = repl(html, '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + PIN_JS);
    html = repl(html, '</head>', VTAG_CSS + '</head>');
    // ⚠️ BOOT_VIEW_JS MUST ship in the embed too (Eric 2026-08-15: "I thought zoom uses geo
    // location to find the people location"). It does — the map already has a four-tier cascade:
    // last view (localStorage) → IP state (__IP_STATE, from Vercel's edge header, no permission
    // prompt) → CONUS → navigator.geolocation → and for signed-in users /api/app/map-home.
    // But that whole cascade lived in `bodyInject` on the NON-embed branch only, so the embed
    // served __IP_STATE empty and fell straight through to the national view. Measured on prod:
    // `/opportunity-map` served __IP_STATE="VA"; `?embed=1` served none.
    //
    // Why it matters beyond aesthetics: a national frame of 145,775 opportunities renders ~50
    // lonely dots, which reads as "they don't have much data" — the exact opposite of true. The
    // same map zoomed to one metro shows 734 with dollar values. The hero on /today was showing
    // the empty version to every visitor.
    html = repl(html, '</body>', BOOT_VIEW_JS + EMBED_JS + '</body>');
    // BOOT_VIEW_JS carries five `__PLACEHOLDER__` tokens that the non-embed branch substitutes.
    // Shipping the script without them emits `window.__STATE_CENTROIDS=__STATE_CENTROIDS__` —
    // a SyntaxError that kills the entire boot script silently, so the cascade never runs and the
    // map sits on CONUS. (Measured: all five placeholders shipped literally in the embed.)
    // The embed only needs the centroid table + the IP state; the three preset tables belong to
    // filter UI it doesn't render, so they're emitted as empty objects rather than shipped whole.
    const ipCountryE = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();
    const ipRegionE = (request.headers.get('x-vercel-ip-country-region') || '').toUpperCase();
    const ipStateE = ipCountryE === 'US' && /^[A-Z]{2}$/.test(ipRegionE) && STATE_CENTROIDS[ipRegionE] ? ipRegionE : '';
    html = html.replace('__STATE_CENTROIDS__', () => JSON.stringify(STATE_CENTROIDS));
    html = html.replace('__IP_STATE__', () => ipStateE);
    html = html.replace('__INDUSTRY_PRESETS__', () => '{}');
    html = html.replace('__AGENCY_PRESETS__', () => '{}');
    html = html.replace('__FSC_PRESETS__', () => '{}');
  } else {
    // (Removed the "← Back to Mindy" link — the top nav + icon rail already have Home/Dashboard,
    // so it was leftover noise in the right-panel header. Zillow's header is title · count · sort.)
    html = repl(html, '</head>', PAGE_CSS + ZLAYOUT_CSS + DRAWER_CSS + VTAG_CSS + '<style>' + ACCOUNT_MENU_CSS + ASK_MINDY_CSS + LOGIN_MODAL_CSS + SETTINGS_DRAWER_CSS + '</style>' + '</head>');
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
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' + EARLY_INJECT + PIN_JS);
    // Color pins by SET-ASIDE eligibility (fixes the all-gray category mismatch).
    html = html.split('catColor(o.cat)').join('setColorFor(o)');
    // Office-vs-PoP location honesty is disclosed ONLY in the detail DRAWER now (Eric 2026-07-26:
    // ONE authoritative "(approximate)" note per dataset, in that dataset's drawer — never on the
    // pins/list/popup). So the Open-opp / Recompete popup + list card show the plain location text
    // (no "· approx." / "· buying office"); the drawer's place-of-performance line carries the
    // "(approximate location — based on state, not a confirmed address)" disclosure when
    // locSrc==='office'. All value-tag pins render SOLID regardless of precision (dashed dropped).
    // Buyer-office/approx text injections into the popup + list card were intentionally REMOVED
    // here — the template's plain `${o.loc}` stands.
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
    // (The popup's Win-probability FLD strip was removed with the four-box grid — the Expanded
    // Decision Card has no grid, and the recompete popup carries no scoring language, 2026-08-04.)
    // DLA is FSC-coded, not NAICS — relabel the code cell "FSC" for DLA pins (Eric 2026-08-01).
    // The value already carries the FSC for DLA (toRow puts it in o.naics for DLA). Card cell only —
    // the popup's NAICS FLD is gone with the grid (NAICS now lives at the listing level).
    html = repl(html, '<div class="st"><div class="k">NAICS</div><div class="v">${o.naics}</div></div>',
      '<div class="st"><div class="k">${o.isDla?\'FSC\':\'NAICS\'}</div><div class="v">${o.naics}</div></div>');
    // CARD (#1 Snapshot): NO action buttons on the card face (Eric). The card is the clickable
    // snapshot; Save/Draft live in the detail drawer. Card actions → a "View details →" hint.
    // "Review Opportunity →" — the action-labeled CTA (Eric 2026-08-05: rename the footer from
    // "Open Listing"). Also DROPS the sol# from the card footer (Eric: "nobody browsing needs
    // W912DS26A016 — it pulls the card back toward database"): the .solno span is emptied so only the
    // "Review Opportunity →" hint remains. (History: View details → Open Listing → Review Opportunity.)
    html = repl(html, '<span class="solno">${o.noPin?\'Forecast — not yet on SAM\':o.sol}</span>',
      '<span class="solno">${o.noPin?\'Forecast — not yet on SAM\':\'\'}</span>');
    html = repl(html, '<a class="act" href="${samURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SAM.gov</a>',
      '<span class="viewdet">Review Opportunity →</span>');
    // NOTE: the CTA literal is `${draftCTA(o)}` (the two-play label — Plan recompete / Plan outreach /
    // Start drafting, PR #528), NOT the old hardcoded "Start drafting". When PR #528 made it dynamic,
    // this strip stopped matching and the button REAPPEARED on the card face (Eric 2026-07-28: "those
    // buttons snuck in there"). Match the current markup so the card stays button-free — actions live
    // only in the drawer (the two-play CTA is rendered there).
    html = repl(html, '<a class="act pri" href="${draftURL(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${draftCTA(o)}</a>', '');
    // POPUP (map-pin quick peek) — the Expanded Decision Card (Eric 2026-08-04, frozen). The popup
    // now emits its FINAL markup directly in popupHTML (the lifecycle-matched drawer-opener CTA +
    // the 1-click heart), so the route no longer rewrites it. The prior route repls — View-on-SAM
    // strip, draftURL→"Should I bid?" button, the <div class="pvchips"> heart inject, the
    // Service-line→Notice-type field, and the popup SOW-pill inject — all targeted the OLD grid/
    // pvchips markup that the redesign removed, so they've been deleted (a repl that matches nothing
    // is a silent no-op; leaving them reads as live behavior that isn't). The CTA stays ON-MAP
    // (opens the drawer, never claude.ai) and, for an OPEN opp, still kicks runAI — same flywheel,
    // just a lifecycle-matched label. The heart + its CSS/JS (pv-heart, toggleFav) are unchanged.
    // The card's own SOW pills (the "Docs" — no "pulled" — literal) still inject below:
    html = repl(html, '${o.docs?\'<span class="chip docs">Docs</span>\':\'\'}',
      '${o.docs?\'<span class="chip docs">Docs</span>\':\'\'}'
      + '${o.brandNameOrEqual?\'<span class="chip brand">\\ud83d\\udea9 Brand-name</span>\':\'\'}'
      + '${o.evalBasis?\'<span class="chip evalb">\'+(o.evalBasis===\'lpta\'?\'LPTA\':o.evalBasis===\'tradeoff\'?\'Trade-off\':\'Best Value\')+\'</span>\':\'\'}');
    // Card click opens the detail drawer (was: flyTo + popup). Uses the notice_id (o.nid).
    // Also fires a Decision-Card CLICK track (see __trackCard below) so we can measure card
    // click-through — the prerequisite for the future A/B of hero treatments (Eric 2026-08-03).
    html = repl(html, 'c.onclick=()=>select(o.sol,true);',
      'c.onclick=()=>{try{window.__trackCard&&window.__trackCard(\'click\',o.nid||o.sol,o);}catch(e){}openOppDrawer(o.nid||o.sol);};'
      + 'try{if(window.__cardObs)window.__cardObs.observe(c);}catch(e){}');
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
    // Swap the map controls: drop Fit-to-results + Terrain, add a "Draw" button
    // (Zillow's Draw — drag a rectangle on the map to filter opportunities to inside it).
    html = repl(html, 
      '<button class="mpill" id="fitBtn">Fit to results</button>\n      <button class="mpill" id="basemapBtn">Terrain</button>',
      '<button class="mpill" id="drawBtn">Draw</button>'
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
    // MOBILE_HTML goes FIRST — a later injected block (LOGIN_MODAL_HTML) has a latent unclosed
    // <div>, so anything after it gets parsed INTO that hidden .lgm-ov (display:none) and the
    // fixed FAB/drawer compute to 0×0. Leading the body keeps the mobile chrome a direct <body> child.
    // SETTINGS_DRAWER_HTML sits BEFORE LOGIN_MODAL_HTML for the same reason MOBILE_HTML does —
    // LOGIN_MODAL_HTML has a latent unclosed <div>, so blocks parsed after it can nest inside a
    // hidden overlay. Its own HTML is div-balanced; the JS goes at the end with the other scripts.
    const bodyInject = MOBILE_HTML + SETTINGS_DRAWER_HTML + DRAWER_HTML + ASK_MINDY_HTML + LOGIN_MODAL_HTML + VIEWPORT_JS + DRAW_JS + SAVE_JS + DRAWER_JS + BOOT_VIEW_JS + SEARCH_PANEL_JS + SORT_EXTRA_JS + ASK_MINDY_JS + LOGIN_MODAL_JS + SETTINGS_DRAWER_JS + ACCOUNT_MENU_JS + CARD_TRACK_JS + MOBILE_JS + '</body>';
    html = html.replace('</body>', () => bodyInject);
    html = html.replace('__STATE_CENTROIDS__', () => JSON.stringify(STATE_CENTROIDS));
    // Boot the map in the visitor's own state without a permission prompt. Vercel's edge sets
    // x-vercel-ip-country-region to the ISO subdivision code ('VA', 'CA') — free, already on the
    // request, and no navigator.geolocation dialog on a cold open. US only: the region code for a
    // non-US visitor is a province/prefecture that has no entry in STATE_CENTROIDS, so it would
    // just miss and fall through to CONUS anyway. Empty string locally (no header) → same.
    const ipCountry = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();
    const ipRegion = (request.headers.get('x-vercel-ip-country-region') || '').toUpperCase();
    // Injected into a "…" JS string literal, so hard-clamp to two letters — never interpolate a
    // raw header into the page.
    const ipState = ipCountry === 'US' && /^[A-Z]{2}$/.test(ipRegion) && STATE_CENTROIDS[ipRegion] ? ipRegion : '';
    html = html.replace('__IP_STATE__', () => ipState);
    // Industry dropdown data — name + codes + description only (the client rolls a picked industry's
    // codes into the existing &naics= filter). Function-replacer so a '$' in a description can't corrupt.
    html = html.replace('__INDUSTRY_PRESETS__', () => JSON.stringify(
      // psc is carried through for PSC-defined industries (Cybersecurity) so the picker
      // can OR it into FILT.psc on Apply — cyber has no NAICS home, its market is PSC.
      INDUSTRY_PRESETS.map((p) => ({ name: p.name, codes: p.codes, psc: p.psc || [], description: p.description })),
    ));
    html = html.replace('__AGENCY_PRESETS__', () => JSON.stringify(AGENCY_PRESETS));
    html = html.replace('__FSC_PRESETS__', () => JSON.stringify(FSC_PRESETS));
  }
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
