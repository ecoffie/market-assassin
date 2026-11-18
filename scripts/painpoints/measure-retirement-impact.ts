/**
 * READ-ONLY. What would change if the 278 legacy "(Source: GAO)" pain points were
 * retired and the proposed candidates adopted? Prints markdown tables.
 *
 *   npx tsx scripts/painpoints/measure-retirement-impact.ts
 *
 * Inputs (all read-only): the served JSON, the historical archive, the proposal
 * file from build-replacement-candidates.ts --write, and src/data/agencies-seo.ts.
 * No database access; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractLegacyGaoTagged, type PainPointJson } from '../../src/lib/strategic-intel/legacy-gao-painpoints';
import { resolveAgency } from '../../src/lib/strategic-intel/agency-resolver';
import { isUnsupportedBudgetClaim } from '../../src/lib/strategic-intel/unsupported-budget-claim';
import { sanitizeLegacyClaimText } from '../../src/lib/strategic-intel/sourced-pain-points';

const ROOT = resolve(__dirname, '../..');
const json = JSON.parse(readFileSync(resolve(ROOT, 'src/data/agency-pain-points.json'), 'utf8')) as PainPointJson;
const proposal = JSON.parse(readFileSync(resolve(ROOT, 'tasks/painpoints-replacement-candidates-2026-11-17.json'), 'utf8')) as {
  candidates: Array<{ agency: string; origin: string; already_served_living: boolean; requires_review: boolean }>;
};
const seo = readFileSync(resolve(ROOT, 'src/data/agencies-seo.ts'), 'utf8');

const tagged = extractLegacyGaoTagged(json);
const legacySet = new Set(tagged.map((t) => `${t.agency}\u0000${t.text}`));

/** What the shared reader serves for one agency's legacy list (same filters, same cap). */
function servedCount(list: string[], cap: number): number {
  let n = 0;
  for (const pp of list) {
    if (isUnsupportedBudgetClaim(pp)) continue;
    if (!sanitizeLegacyClaimText(pp)) continue;
    n++;
  }
  return Math.min(n, cap);
}

type Row = {
  agency: string; canonical: string | null; total: number; legacy: number; after: number;
  reader50Before: number; reader50After: number; tmr40Before: number; tmr40After: number;
  legacyWithinReaderCap: number;
};
const rows: Row[] = [];
let agenciesWithAny = 0, agenciesWithAnyAfter = 0;
for (const [agency, entry] of Object.entries(json.agencies)) {
  const pps = (entry.painPoints ?? []).filter((p): p is string => typeof p === 'string');
  const kept = pps.filter((p) => !legacySet.has(`${agency}\u0000${p}`));
  if (pps.length) agenciesWithAny++;
  if (kept.length) agenciesWithAnyAfter++;
  const legacy = pps.length - kept.length;
  if (!legacy) continue;
  // Which of this agency's legacy strings are inside the reader's first-50 window today?
  let idx = 0, within = 0;
  for (const pp of pps) {
    if (isUnsupportedBudgetClaim(pp) || !sanitizeLegacyClaimText(pp)) continue;
    if (idx < 50 && legacySet.has(`${agency}\u0000${pp}`)) within++;
    idx++;
  }
  const r = resolveAgency({ agencyName: agency });
  rows.push({
    agency, canonical: r.resolved ? r.canonicalAgency : null, total: pps.length, legacy, after: kept.length,
    reader50Before: servedCount(pps, 50), reader50After: servedCount(kept, 50),
    tmr40Before: servedCount(pps, 40), tmr40After: servedCount(kept, 40),
    legacyWithinReaderCap: within,
  });
}
rows.sort((a, b) => b.legacy - a.legacy || a.agency.localeCompare(b.agency));

const gain = new Map<string, { hr: number; instNew: number; instServed: number; review: number }>();
for (const c of proposal.candidates) {
  const g = gain.get(c.agency) ?? { hr: 0, instNew: 0, instServed: 0, review: 0 };
  if (c.origin === 'gao_high_risk_2025') g.hr++;
  else if (c.already_served_living) g.instServed++;
  else g.instNew++;
  if (c.requires_review) g.review++;
  gain.set(c.agency, g);
}

const totalBefore = Object.values(json.agencies).reduce((n, e) => n + (e.painPoints?.length ?? 0), 0);
console.log('## Totals\n');
console.log('| measure | today | if the 278 were retired | change |');
console.log('|---|---:|---:|---:|');
console.log(`| pain point strings in the served JSON | ${totalBefore} | ${totalBefore - tagged.length} | -${tagged.length} |`);
console.log(`| agencies with at least one pain point | ${agenciesWithAny} | ${agenciesWithAnyAfter} | ${agenciesWithAnyAfter - agenciesWithAny} |`);
console.log(`| agency keys in the JSON (unchanged by retirement) | ${Object.keys(json.agencies).length} | ${Object.keys(json.agencies).length} | 0 |`);
console.log(`| agencies that hold legacy GAO strings | ${rows.length} | 0 | -${rows.length} |`);
const zeroed = rows.filter((r) => r.after === 0);
console.log(`| agencies left with ZERO pain points | — | ${zeroed.length} (${zeroed.map((r) => `"${r.agency}"`).join(', ') || 'none'}) | |`);
const readerLoss = rows.reduce((n, r) => n + (r.reader50Before - r.reader50After), 0);
const legacyInWindow = rows.reduce((n, r) => n + r.legacyWithinReaderCap, 0);
console.log(`| legacy strings inside the shared reader's 50-item window today | ${legacyInWindow} | 0 | -${legacyInWindow} |`);
console.log(`| net items the shared reader serves (cap 50, summed over affected agencies) | ${rows.reduce((n, r) => n + r.reader50Before, 0)} | ${rows.reduce((n, r) => n + r.reader50After, 0)} | -${readerLoss} |`);

console.log('\n## Per agency — loss if retired, gain if candidates adopted\n');
console.log('"Reader" = what `getAgencySourcedIntelligence` serves from the JSON (legacy cap 50). "TMR" = the pain-point count Target Market Research uses (cap 40, plus sourced + priorities). "Canonical" is shown only when the JSON key resolves exactly; junk keys do not, and get no candidates.\n');
console.log('| JSON agency key | canonical | strings now | legacy GAO | after | reader now→after | TMR legacy now→after | +High-Risk | +Institute new | (Institute already served) | needs review |');
console.log('|---|---|---:|---:|---:|---|---|---:|---:|---:|---:|');
const seenCanon = new Set<string>();
for (const r of rows) {
  const g = r.canonical ? gain.get(r.canonical) : undefined;
  if (r.canonical) seenCanon.add(r.canonical);
  console.log(`| ${r.agency} | ${r.canonical ?? '— (unresolved)'} | ${r.total} | ${r.legacy} | ${r.after} | ${r.reader50Before}→${r.reader50After} | ${r.tmr40Before}→${r.tmr40After} | ${g?.hr ?? 0} | ${g?.instNew ?? 0} | ${g?.instServed ?? 0} | ${g?.review ?? 0} |`);
}
const extra = [...gain.entries()].filter(([a]) => !seenCanon.has(a)).sort((a, b) => a[0].localeCompare(b[0]));
if (extra.length) {
  console.log('\nAgencies that GAIN candidates but hold no legacy GAO strings:\n');
  console.log('| canonical agency | +High-Risk | +Institute new | (Institute already served) | needs review |');
  console.log('|---|---:|---:|---:|---:|');
  for (const [a, g] of extra) console.log(`| ${a} | ${g.hr} | ${g.instNew} | ${g.instServed} | ${g.review} |`);
}

const totHr = proposal.candidates.filter((c) => c.origin === 'gao_high_risk_2025').length;
const totNew = proposal.candidates.filter((c) => c.origin !== 'gao_high_risk_2025' && !c.already_served_living).length;
const totServed = proposal.candidates.filter((c) => c.already_served_living).length;
console.log(`\nCandidate totals: ${totHr} High-Risk + ${totNew} new Institute + ${totServed} Institute rows the reader ALREADY serves (not a gain).`);

// Search: which common queries hit legacy strings today?
console.log('\n## Search — legacy strings matched by sample queries (substring, as `searchAgencies` / `searchPainPoints` do)\n');
console.log('| query | legacy strings matched today |');
console.log('|---|---:|');
for (const q of ['year 2000', 'acquisition', 'financial management', 'contract', 'information technology', 'cyber', 'strategic plan', 'testimony']) {
  console.log(`| ${q} | ${tagged.filter((t) => t.text.toLowerCase().includes(q)).length} |`);
}

const titles = [...new Set(tagged.map((t) => t.title))];
const inSeo = titles.filter((t) => seo.includes(t)).length;
console.log(`\n## SEO\n\nLegacy titles found in src/data/agencies-seo.ts (the /agencies/[slug] pain-point source): ${inSeo} of ${titles.length}.`);
