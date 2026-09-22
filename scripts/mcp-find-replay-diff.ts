/**
 * Old MCP vs canonical MCP — every changed result must be CLASSIFIED, or this exits 1.
 *
 *   npx tsx scripts/mcp-find-replay-diff.ts old.json new.json [--md]
 *
 * Inputs are snapshots from scripts/mcp-find-replay.ts. A horizon "changed" when its status,
 * matched count, or ordered top-N identities differ. Each change needs an entry in CLASSIFIED
 * (fixture → class + evidence). Anything unclassified is an UNEXPLAINED change and fails the run.
 */
import { readFileSync } from 'node:fs';

type Cls = 'bug_correction' | 'intentional_canonical_change' | 'unexpected_regression';

/** The reviewed classification (Phase B, 2026-09-22). Evidence cites the measured replay. */
export const CLASSIFIED: Record<string, { cls: Cls; why: string }> = {
  pam: { cls: 'bug_correction', why: 'Old %pam% substring (Pamunkey, Pamela, IPAM, camera specs). 26 dropped Open rows: none contain the word PAM.' },
  'ai governance': { cls: 'bug_correction', why: 'Old %ai% substring (m-ai-ntenance, rep-ai-r) → 5,067 Open. Canonical: AI ∧ governance, word-bounded → 10.' },
  'artificial intelligence governance': { cls: 'bug_correction', why: 'Old token-OR matched "intelligence"/"governance" boilerplate; now identical to "ai governance". Forecast 0→13 (old phrase ILIKE missed "AI Governance").' },
  cybersecurity: { cls: 'bug_correction', why: 'Recompete −546 = MCP SIEM→SIEMENS substring removed. Open +56 / Forecast +116 = "cyber"/"cyber security" forms of the one cyber concept (MCP CYBER_DIRECT_RE). 0 old Open rows dropped.' },
  janitorial: { cls: 'intentional_canonical_change', why: 'Identical Open set (116/116, 0 dropped); top-10 re-ranked so text hits ("NRS St Paul Janitorial") precede NAICS-only hits.' },
  'market research': { cls: 'bug_correction', why: 'Old token-OR: any "market" or "research" → 933. Canonical requires both qualifiers → 465; recompete +4 via "Marketing Research"; forecast +22.' },
  'veterans affairs': { cls: 'bug_correction', why: 'Now a VA buyer filter (was keyword text) → 386 VA notices, all DIRECT (old labeller called them WEAK). Forecast 695→1,390 = VA identity.' },
  'janitorial + agency=VA': { cls: 'bug_correction', why: 'VA needle no longer substring-matches; 1 row difference; order by text evidence.' },
  'janitorial + agency=USDA': { cls: 'bug_correction', why: 'Old USDA sibling alias "AG" ⊂ "Defense Logistics AGency" / EPA / Pretrial Services AGency. Recompete 487→172, Open 13→9 — all remaining rows are USDA buyers.' },
  management: { cls: 'intentional_canonical_change', why: 'Same Open set; ranking by breadth/position. Recompete −1 / Forecast −4 = "management" inside a longer word (substring → word-bounded).' },
  drones: { cls: 'bug_correction', why: 'Open −10: all matched "uas" inside "q-uas-i-religious". Forecast 5→52: term-of-art aliases (drone, UAS, unmanned aircraft) now apply to forecasts too.' },
  '"ai governance"': { cls: 'bug_correction', why: 'Old treated quotes as characters (HVAC, Blast Shield). Now an exact phrase: Open 2 genuine, Forecast 0→3 incl. "AI Governance - RFI".' },
  'follow-on support': { cls: 'intentional_canonical_change', why: 'Hyphenated compound is one unit; "support" is a shared stop word. Forecast 0→421 (old whole-phrase ILIKE found none). Known breadth: follow-on alone admits.' },
  'Show me USDA opportunities': { cls: 'bug_correction', why: 'Structured agency intent: 5,522 → 218 USDA notices (was %me% substring). Recompete/Forecast now return USDA (4,602 / 5,028) instead of empty.' },
  'SDVOSB cybersecurity opportunities in Virginia': { cls: 'bug_correction', why: 'Old resolved the WHOLE query as a set-aside and ignored cyber + Virginia. Now SDVOSB ∧ VA ∧ cyber: Open 0 (true empty: pairs 19/5/64), Recompete 145 (5 direct, 140 related IT), Forecast 1.' },
  'cyber cloud compliance network server': { cls: 'intentional_canonical_change', why: 'Capability list (decision 2): ANY of cybersecurity/cloud/server admits; compliance/network rank only. Open 1,521 → 528, DIRECT 68 → 272. Forecast 0→719 (old phrase ILIKE).' },
  'cyber, cloud': { cls: 'intentional_canonical_change', why: 'Explicit alternatives (decision 2): cybersecurity OR cloud, word-bounded ∪ cyber taxonomy. Open 487 → 459.' },
  'janitorial or landscaping': { cls: 'intentional_canonical_change', why: '"or" = alternatives; same Open count (140), re-ranked; Forecast 0→350 (old whole-phrase ILIKE).' },
  'Pro Audio': { cls: 'bug_correction', why: 'Old %pro% substring → 4,500. Now audio admits, "pro" ranks: 84 Open; recompete/forecast now searched word-bounded.' },
  '541512 -computers': { cls: 'bug_correction', why: 'Old searched the literal text "541512 -computers" (5). Now NAICS 541512 minus notices mentioning computers (13); recompete 4,267, forecast 287.' },
  '-computers': { cls: 'intentional_canonical_change', why: 'Decision 5: exclusion-only query → needs_positive_scope on every horizon, billing_outcome nonbillable_invalid_input (old: three empty horizons, charged).' },
  'Naval facilities in Nevada': { cls: 'bug_correction', why: 'State NV extracted; naval ∧ facilities in NV = 0 (true empty: naval 533, NV 24). Old: token-OR 1,311.' },
  'IT services + location=VA': { cls: 'bug_correction', why: 'Old: %it% substring → 837. Now the IT concept (acronym case-sensitive — the pronoun "it" excluded) ∪ IT taxonomy in VA → 45; Forecast 8 → 93.' },
  '5413': { cls: 'bug_correction', why: 'Evidence labels only: structured NAICS rows were labelled WEAK_NON_MARKET; now DIRECT (162/162). Same rows, same order.' },
  '8a': { cls: 'bug_correction', why: 'Evidence labels only: set-aside-only rows were labelled WEAK_NON_MARKET; now DIRECT (47/47). Same rows, same order, same counts on every horizon.' },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const [oldPath, newPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const md = process.argv.includes('--md');
const o = JSON.parse(readFileSync(oldPath, 'utf8'));
const n = JSON.parse(readFileSync(newPath, 'utf8'));
const H = ['open_now', 'coming_back', 'coming_soon'];

let unexplained = 0;
let regressions = 0;
const rows: string[] = [];
for (const k of Object.keys(o)) {
  const changes: string[] = [];
  for (const h of H) {
    const a = o[k]?.horizons?.[h]; const b = n[k]?.horizons?.[h];
    if (!a || !b) { changes.push(`${h}: missing`); continue; }
    const ia = a.items.map((x: any) => x.id); const ib = b.items.map((x: any) => x.id);
    const same = new Set(ia.filter((x: string) => ib.includes(x))).size;
    const ev = JSON.stringify(a.evidence_counts) !== JSON.stringify(b.evidence_counts);
    if (a.status === b.status && a.matched_count === b.matched_count && JSON.stringify(ia) === JSON.stringify(ib) && !ev) continue;
    changes.push(`${h} ${a.status}/${a.matched_count}→${b.status}/${b.matched_count}${b.error ? `(${b.error})` : ''} top-${Math.max(ia.length, ib.length)} shared ${same}${ev ? ` · ev ${JSON.stringify(a.evidence_counts)}→${JSON.stringify(b.evidence_counts)}` : ''}`);
  }
  if (!changes.length) { rows.push(`| ${k} | unchanged | — | — |`); continue; }
  const c = CLASSIFIED[k];
  if (!c) unexplained++;
  if (c?.cls === 'unexpected_regression') regressions++;
  rows.push(`| ${k} | ${c ? c.cls : '**UNEXPLAINED**'} | ${changes.join('<br>')} | ${c ? c.why : 'no classification — investigate'} |`);
}
if (md) {
  console.log('| fixture | class | changes (status/matched, top-10 identity overlap, evidence) | evidence for the class |');
  console.log('|---|---|---|---|');
}
for (const r of rows) console.log(md ? r : r.replace(/<br>/g, '\n      '));
console.error(`\nfixtures ${Object.keys(o).length} · unexplained ${unexplained} · unexpected regressions ${regressions}`);
process.exit(unexplained || regressions ? 1 : 0);
