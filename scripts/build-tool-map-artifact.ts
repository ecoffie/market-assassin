/**
 * build-tool-map-artifact — render the claude.ai "Mindy MCP Tool Map" from the LIVE public catalog.
 *
 *   npx tsx scripts/build-tool-map-artifact.ts        → writes docs/mcp-tool-map.html
 *
 * Then publish docs/mcp-tool-map.html to the artifact URL in docs/mcp-tool-catalog.json, and run
 * `node scripts/audit-tool-catalog-drift.mjs --update`.
 *
 * WHY A GENERATOR: the map was hand-written once (2026-08-06) and drifted to 54 tools with wrong
 * prices and a false billing claim while the mirror file said 64. Names, credits, tiers, write
 * annotations and the count now come from what external hosts actually receive
 * (mcpRegistrationList() + listPublicMcpTools()). Lanes come from the same TOOL_GROUPS the
 * /mcp/tools page uses. Only the one-line card copy is editorial, and the build FAILS if a public
 * tool has no line or a line names a tool that is not public.
 */
import { writeFileSync } from 'fs';
import { listPublicMcpTools } from '../src/lib/mcp/public-catalog';
import { mcpRegistrationList } from '../src/lib/mcp/tool-schemas';
import { PROPRIETARY_TOOLS } from '../src/lib/mcp/tool-registry';
import { TOOL_GROUPS } from '../src/app/mcp/tools/tool-groups';

const OUT = 'docs/mcp-tool-map.html';

/** Card copy: what the tool does for a bidder, in plain words. One line each. */
const LINE: Record<string, string> = {
  find_opportunities: 'Where the money is for what you sell: open now, coming back, coming soon',
  lookup_solicitation: 'Find one specific solicitation by id, or a past one by what you remember',
  get_current_acquisition_intelligence: 'What changed in how this buyer is buying, and what to do differently',
  match_company_to_pathways: 'Which buying doors your company can prove it walks through',
  search_sam_opportunities: 'Open SAM.gov notices only, by keyword, NAICS, set-aside or state',
  search_agency_opps_by_office: 'Open buys anchored to one buying office, not the whole department',
  get_agency_forecasts: 'Planned buys 6 to 18 months before a solicitation posts',
  get_expiring_contracts: 'Recompete targets: contracts about to expire, with the incumbent',
  search_grants: 'Federal grants from Grants.gov, a separate lane from contracts',
  search_idv_contracts: 'IDIQ, GWAC and BPA vehicles and the task orders flowing through them',
  search_past_contracts: 'Awarded contracts by place of performance, recipient HQ, NAICS or agency',
  match_recompete_sow: 'Find the open solicitation that is likely a recompete, by SOW similarity',
  lookup_sam_entity: 'SAM registration, UEI, CAGE, certifications and registered contacts',
  search_contractors: 'Top contractors in a market by obligated dollars and agency reach',
  get_contractor_profile: 'One firm in depth: totals, top agencies, recent awards',
  get_contractor_award_history: "A named firm's full prime-award history and trend",
  get_recipient_annual_obligations: 'Dollars per fiscal year, parent-consolidated, never summed lifetime values',
  find_capable_contractors: 'Every firm that has won under a NAICS or PSC: partners, subs or rivals',
  find_predecessor_award: 'The likely incumbent behind an open opportunity, with confidence',
  get_solicitation_incumbent: 'Paste a solicitation number, get who held the prior work',
  assess_market_depth: 'Rule of Two: are there enough capable small businesses to set it aside?',
  get_keyword_coverage: 'Real market size for a keyword and the NAICS codes that cover it',
  get_market_vocabulary: 'The words winning contracts actually use in a market',
  derive_company_keywords: "Turn a company's own words into the keywords buyers use",
  get_pricing_intel: 'GSA CALC labor rates for price-to-win (p25, p50, p75)',
  get_winning_playbook: 'Eight years of GovCon Giants coaching on how to win this scenario',
  search_podcast_lessons: 'Lessons from real contractor and agency podcast guests',
  get_agency_intel: 'The buyer brief: priorities, pain points, hierarchy and spend',
  understand_customer: 'After a FIND hit: what this customer cares about and what to emphasize',
  get_agency_spending_detail: 'Who inside the department buys, and its set-aside mix',
  get_sba_goaling_share: "Small-business goals against the agency's set-aside dollars",
  get_award_detail: "One award's full record: ceiling, parent vehicle, period of performance",
  schedule_market_search: 'Watch a market and get new matches by email, daily or weekly',
  list_market_schedules: 'See the market watches you have set up',
  update_market_schedule: 'Change a watch: cadence, pause, resume or rename',
  delete_market_schedule: 'Remove a market watch permanently',
  search_federal_contacts: 'The named contracting people at a buying office',
  lookup_federal_osbp: 'The small-business front door for a command or agency',
  get_sblo_contact: "The prime's Small Business Liaison Officer: who to call to team",
  search_federal_events: 'Industry days, matchmaking and sources-sought events for an agency',
  get_federal_event_series: 'The recurring conference calendar: AFCEA, NDIA, SAME, APEX',
  get_legislation_status: 'NDAA and bill status from Mindy’s stored Congress record',
  evaluate_bid_decision: 'Bid or no-bid: 5 eliminator gates and a 10-factor scorecard',
  extract_compliance_matrix: 'Every shall, must and Section L/M/C requirement, source-verified',
  get_solicitation_documents: 'The full RFP text and every attachment',
  draft_proposal: 'A full multi-section proposal draft grounded in your Vault',
  draft_proposal_section: 'Draft or rework one section without re-running the whole proposal',
  scan_proposal_compliance: 'Pre-submit scan for what gets a bid thrown out',
  referee_proposal_compliance: 'An independent model scores the draft: met, partial or missing',
  build_pursuit_dossier: 'The whole capture package on one opportunity in a single call',
  capability_market_match: 'Your own words in, addressable market out',
  generate_market_report: 'A full market report with a shareable client-ready link',
  get_balance: 'Your current credit balance',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const reg = new Map(mcpRegistrationList().map((t) => [t.name, t]));
const rows = new Map(
  listPublicMcpTools().map((t) => {
    const name = (t.function as { name: string }).name;
    return [name, { credits: Number(t._credits ?? 0), tier: String(t._tier ?? 'metered') }];
  }),
);
const publicNames = [...reg.keys()].sort();

// ── guards: copy ⇄ catalog ⇄ lanes must agree ─────────────────────────────────
const missingLine = publicNames.filter((n) => !LINE[n]);
const staleLine = Object.keys(LINE).filter((n) => !reg.has(n));
const laned = new Set(TOOL_GROUPS.flatMap((g) => g.tools));
const unlaned = publicNames.filter((n) => !laned.has(n));
if (missingLine.length || staleLine.length || unlaned.length) {
  console.error('[tool-map] refusing to build:');
  if (missingLine.length) console.error('  public tools with no card line:', missingLine.join(', '));
  if (staleLine.length) console.error('  card lines for tools that are not public:', staleLine.join(', '));
  if (unlaned.length) console.error('  public tools in no TOOL_GROUPS lane:', unlaned.join(', '));
  process.exit(1);
}

const writes = publicNames.filter((n) => reg.get(n)!.annotations.readOnlyHint === false);
const proprietary = publicNames.filter((n) => PROPRIETARY_TOOLS.has(n));
const pro = publicNames.filter((n) => rows.get(n)!.tier === 'pro');

function card(name: string): string {
  const r = rows.get(name)!;
  const a = reg.get(name)!.annotations;
  const kind = a.readOnlyHint === false ? 'write' : PROPRIETARY_TOOLS.has(name) ? 'prop' : '';
  const mark = kind === 'write' ? '<span class="mk" aria-label="writes">✎</span>' : kind === 'prop' ? '<span class="mk" aria-label="proprietary">◆</span>' : '';
  const badges = [
    r.tier === 'pro' ? '<span class="badge pro">Pro</span>' : '',
    a.destructiveHint ? '<span class="badge warn">asks first</span>' : '',
  ].join('');
  const cost = r.credits > 0 ? `<span class="cost">${r.credits} cr</span>` : '<span class="cost free">free</span>';
  return `<li class="tool ${kind}"><div class="trow">${mark}<code class="tname">${esc(name)}</code>${badges}${cost}</div><p class="tdesc">${esc(LINE[name])}</p></li>`;
}

const lanes = TOOL_GROUPS.map((g) => {
  const tools = g.tools.filter((n) => reg.has(n));
  if (!tools.length) return '';
  return `<section class="lane" aria-labelledby="l-${g.id}"><header class="lhead"><h2 id="l-${g.id}">${esc(g.label)}</h2><span class="lcount">${tools.length}</span></header><p class="lsub">${esc(g.blurb)}</p><ul class="tools">${tools.map(card).join('')}</ul></section>`;
}).join('');

const generated = new Date().toISOString().slice(0, 10);

const html = `<title>Mindy MCP Tool Map</title>
<style>
/* Layout: one masthead, then a responsive grid of job lanes; each lane is a list of tool cards. */
:root{
  --bg:#0a0d13; --panel:#111826; --panel2:#0d131f; --chip:#0f1522;
  --line:#1d2636; --line2:#141b28;
  --ink:#e8eef7; --ink2:#a3afc3; --ink3:#6f7a8f;
  --accent:#34d399; --accent-dim:rgba(52,211,153,.12); --accent-line:rgba(52,211,153,.32);
  --gold:#f0b866; --gold-dim:rgba(240,184,102,.12);
  --write:#fb923c; --write-dim:rgba(251,146,60,.13); --write-line:rgba(251,146,60,.36);
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 620px at 82% -8%,rgba(52,211,153,.07),transparent 60%),var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding-inline:20px;padding-block:34px 60px}
.mast{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:26px;display:grid;gap:14px}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin:0}
h1{font-size:clamp(26px,4.4vw,42px);line-height:1.06;margin:0;letter-spacing:-.02em;text-wrap:balance;font-weight:680}
h1 .u{color:var(--accent)}
.lede{font-size:16px;color:var(--ink2);max-width:72ch;margin:0}
.lede strong{color:var(--ink);font-weight:620}
.stats{display:flex;flex-wrap:wrap;gap:10px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:10px 14px;min-width:112px}
.stat b{display:block;font-family:var(--mono);font-size:22px;font-variant-numeric:tabular-nums}
.stat span{font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
.legend{display:flex;flex-wrap:wrap;gap:12px 20px;font-size:12.5px;color:var(--ink2);align-items:center}
.legend .item{display:inline-flex;align-items:center;gap:7px}
.lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.lane{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:16px;padding:16px 15px 15px;display:flex;flex-direction:column;min-width:0}
.lhead{display:flex;align-items:baseline;gap:10px}
.lhead h2{font-size:16px;font-weight:640;letter-spacing:-.01em;margin:0}
.lcount{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--ink3)}
.lsub{font-size:12.5px;color:var(--ink3);margin:4px 0 12px}
.tools{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.tool{background:var(--chip);border:1px solid var(--line2);border-radius:11px;padding:10px 11px;min-width:0}
.tool.prop{border-color:var(--accent-line);background:linear-gradient(180deg,var(--accent-dim),var(--chip) 62%)}
.tool.write{border-color:var(--write-line);background:linear-gradient(180deg,var(--write-dim),var(--chip) 60%)}
.trow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:3px}
.tname{font-family:var(--mono);font-size:12.5px;color:var(--ink);word-break:break-word;min-width:0}
.tool.prop .tname{color:#7ee7bf}
.tool.write .tname{color:#fdba74}
.mk{font-size:12px;line-height:1;color:var(--accent)}
.tool.write .mk{color:var(--write)}
.tdesc{font-size:12px;color:var(--ink2);line-height:1.42;margin:0}
.cost{margin-left:auto;font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--gold);background:var(--gold-dim);border:1px solid rgba(240,184,102,.24);border-radius:16px;padding:1px 7px;font-variant-numeric:tabular-nums}
.cost.free{color:var(--ink3);background:transparent;border-color:var(--line)}
.badge{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:5px;padding:1.5px 5px}
.badge.pro{color:var(--bg);background:var(--gold)}
.badge.warn{color:var(--bg);background:var(--write)}
.foot{margin-top:30px;border-top:1px solid var(--line);padding-top:18px;font-size:12.5px;color:var(--ink3);display:grid;gap:9px;max-width:90ch}
.foot b{color:var(--ink2);font-weight:600}
.foot code{font-family:var(--mono);color:var(--ink2)}
</style>
<div class="wrap">
  <header class="mast">
    <p class="kicker">Mindy · Model Context Protocol server · mcp.getmindy.ai</p>
    <h1>Federal capture intelligence,<br><span class="u">as tools an agent can call.</span></h1>
    <p class="lede">Mindy exposes <strong>${publicNames.length} tools</strong> to any MCP agent: finding work, reading the buyer, sizing up the competition, watching a market and working a proposal. Each one is directly callable by Claude, Cursor or an autonomous BD agent, and each returns real records or says plainly that it found none.</p>
    <div class="stats">
      <div class="stat"><b>${publicNames.length}</b><span>tools</span></div>
      <div class="stat"><b>${TOOL_GROUPS.filter((g) => g.tools.some((n) => reg.has(n))).length}</b><span>jobs</span></div>
      <div class="stat"><b>${proprietary.length}</b><span>proprietary ◆</span></div>
      <div class="stat"><b>${pro.length}</b><span>Mindy Pro</span></div>
    </div>
    <div class="legend">
      <span class="item"><span class="cost">5 cr</span> credits per call</span>
      <span class="item"><span class="mk">◆</span> proprietary Mindy data</span>
      <span class="item"><span class="mk" style="color:var(--write)">✎</span> saves to your own Mindy account</span>
      <span class="item"><span class="badge pro">Pro</span> Mindy Pro tier</span>
    </div>
  </header>
  <div class="lanes">${lanes}</div>
  <footer class="foot">
    <div><b>Billing:</b> you are charged when Mindy does the research. A search that is measured and honestly finds nothing is still a paid answer (<code>grounded=false</code>). You are not charged when a call does no work: a refused request, a failure on Mindy's side, or a call stopped before it runs.</div>
    <div><b>Read-only by default:</b> ${publicNames.length - writes.length} of ${publicNames.length} tools only read. The ${writes.length} that write save to your own Mindy account, such as a market watch or a shareable report (${writes.map((w) => `<code>${esc(w)}</code>`).join(', ')}). Deleting a watch asks first. No public tool writes to a system outside Mindy.</div>
    <div><b>Tiering:</b> ${pro.map((p) => `<code>${esc(p)}</code>`).join(', ')} require${pro.length === 1 ? 's' : ''} Mindy Pro. Every other tool runs on credits.</div>
    <div>Generated ${generated} by <code>scripts/build-tool-map-artifact.ts</code> from the public catalog external hosts receive. A gate (<code>scripts/audit-tool-catalog-drift.mjs</code>) blocks a push when this map disagrees with the server. The always-current version is <code>getmindy.ai/mcp/tools</code>.</div>
  </footer>
</div>
`;

writeFileSync(OUT, html);
console.log(`[tool-map] wrote ${OUT}: ${publicNames.length} tools, ${writes.length} write, ${proprietary.length} proprietary, ${pro.length} pro.`);
