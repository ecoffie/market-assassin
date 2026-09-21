/**
 * NAICS vocabulary PROBE v2 (measure-before-you-build, Eric Jul 11 2026).
 *
 * THE VISION: a persistent table of the REAL words federal buyers use, keyed by
 * NAICS/PSC, mined from actual award (and later SOW/PWS) text — so every Mindy
 * surface (onboarding keywords, expiring-contract match, forecasts, SOW/PWS
 * relevance, alerts) can test against the ACTUAL vocabulary instead of guessing
 * wildcards case-by-case. "Use the actual words across the board."
 *
 * v2 adds the CROSS-NAICS GENERIC FILTER — the cleaning step. A term that appears
 * across MANY unrelated NAICS ("center", "year", "services", "maintenance",
 * "funding") is filler; a term concentrated in a FEW related codes ("chiller",
 * "roof", "pest") is real industry signal. So we score each term by DISTINCTIVENESS
 * (inverse document frequency across NAICS) × its in-NAICS frequency — TF-IDF over
 * the code corpus. Ubiquitous filler drops out automatically; no hand-maintained
 * stoplist chasing every noise word.
 *
 * PROBE step only — ~50 representative NAICS, writes a review file. No DB writes.
 * The extractor here is exactly what the full backfill will reuse.
 *
 *   npx tsx scripts/build-naics-vocabulary-probe.ts
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config({ path: '.env.local' });

// ~50 NAICS spanning the small-biz trades + services + manufacturing + a few
// "hard" codes, so the cross-NAICS filter has a real corpus to compute IDF over.
const PROBE_NAICS: { code: string; label: string }[] = [
  { code: '238220', label: 'Plumbing/Heating/AC (HVAC)' },
  { code: '238210', label: 'Electrical Contractors' },
  { code: '238160', label: 'Roofing Contractors' },
  { code: '238110', label: 'Poured Concrete Foundation' },
  { code: '238910', label: 'Site Prep Contractors' },
  { code: '238320', label: 'Painting/Wall Covering' },
  { code: '238140', label: 'Masonry Contractors' },
  { code: '561720', label: 'Janitorial Services' },
  { code: '561730', label: 'Landscaping Services' },
  { code: '561710', label: 'Exterminating/Pest Control' },
  { code: '561612', label: 'Security Guard Services' },
  { code: '561320', label: 'Temporary Help (Staffing)' },
  { code: '561210', label: 'Facilities Support Services' },
  { code: '561621', label: 'Security Systems Services' },
  { code: '541512', label: 'Computer Systems Design' },
  { code: '541519', label: 'Other Computer Services' },
  { code: '541511', label: 'Custom Computer Programming' },
  { code: '541611', label: 'Admin/Management Consulting' },
  { code: '541330', label: 'Engineering Services' },
  { code: '541930', label: 'Translation/Interpretation' },
  { code: '541990', label: 'Other Professional/Technical' },
  { code: '541614', label: 'Logistics Consulting' },
  { code: '541620', label: 'Environmental Consulting' },
  { code: '541380', label: 'Testing Laboratories' },
  { code: '541712', label: 'Physical/Bio Research' },
  { code: '236220', label: 'Commercial Building Construction' },
  { code: '236210', label: 'Industrial Building Construction' },
  { code: '237310', label: 'Highway/Street/Bridge' },
  { code: '237110', label: 'Water/Sewer Line Construction' },
  { code: '332710', label: 'Machine Shops' },
  { code: '332312', label: 'Fabricated Structural Metal' },
  { code: '333415', label: 'AC/Refrigeration Equipment Mfg' },
  { code: '336611', label: 'Ship Building and Repair' },
  { code: '621111', label: 'Offices of Physicians' },
  { code: '622110', label: 'General Hospitals' },
  { code: '621399', label: 'Other Health Practitioners' },
  { code: '484121', label: 'General Freight Trucking' },
  { code: '488510', label: 'Freight Transportation Arrangement' },
  { code: '811310', label: 'Industrial Machinery Repair' },
  { code: '811210', label: 'Electronic Equipment Repair' },
  { code: '561499', label: 'Other Business Support' },
  { code: '561110', label: 'Office Administrative Services' },
  { code: '423450', label: 'Medical Equipment Wholesalers' },
  { code: '423610', label: 'Electrical Equipment Wholesalers' },
  { code: '511210', label: 'Software Publishers' },
  { code: '517311', label: 'Wired Telecom Carriers' },
  { code: '928110', label: 'National Security' },
  { code: '115310', label: 'Support for Forestry' },
  { code: '562910', label: 'Remediation Services' },
];

// Base stoplist — obvious scaffolding. The cross-NAICS IDF filter handles the
// rest (center/year/funding/services fall out because they're everywhere).
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'shall', 'will', 'are', 'was',
  'has', 'have', 'all', 'any', 'from', 'into', 'per', 'each', 'not', 'other',
  'contract', 'contracts', 'contractor', 'government', 'federal', 'agency',
  'agencies', 'department', 'requirement', 'requirements', 'provide', 'provides',
  'igf', 'existing', 'located', 'various', 'award', 'awards', 'option', 'order',
  'orders', 'task', 'tasks', 'purpose', 'including', 'includes', 'provided',
  'perform', 'multiple', 'related', 'agreement', 'number', 'furnish',
]);
// Agency / geography noise — these aren't caught by IDF (they're rare per-NAICS)
// but they're never industry vocabulary.
const NOISE = new Set([
  'army', 'navy', 'force', 'corps', 'nasa', 'usace', 'district', 'command',
  'fort', 'camp', 'installation', 'defense', 'military', 'veterans', 'vamc',
  'depot', 'station', 'pentagon', 'engineers', 'inc', 'llc', 'company',
  'north', 'south', 'east', 'west', 'iwakuni', 'yokosuka', 'guam', 'washington',
  'george', 'jasdf', 'naval', 'embassy', 'border', 'national', 'region',
]);

async function fetchDescriptions(naics: string): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            naics_codes: [naics],
            time_period: [{ start_date: '2024-10-01', end_date: '2025-09-30' }],
            award_type_codes: ['A', 'B', 'C', 'D'],
          },
          fields: ['Description', 'Award Amount'],
          sort: 'Award Amount', order: 'desc', limit: 100, page,
        }),
      });
      if (!res.ok) break;
      const j = await res.json();
      const rows = (j.results || []).map((r: { Description?: string }) => String(r.Description || '')).filter(Boolean);
      out.push(...rows);
      if (!j.page_metadata?.hasNext) break;
      await new Promise((r) => setTimeout(r, 400));
    } catch { break; }
  }
  return out;
}

function tokenize(desc: string): string[] {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && /[aeiou]/.test(w));
}

interface TermStat { term: string; df: number; kind: 'word' | 'bigram' }

/** Per-NAICS document-frequency terms + bigrams (before cross-NAICS filtering). */
function rawTerms(descs: string[]): Map<string, TermStat> {
  const wordDf = new Map<string, number>();
  const bigramDf = new Map<string, number>();
  for (const d of descs) {
    const ws = tokenize(d);
    const seenW = new Set<string>();
    const seenB = new Set<string>();
    for (const w of ws) {
      if (STOP.has(w) || NOISE.has(w)) continue;
      if (!seenW.has(w)) { seenW.add(w); wordDf.set(w, (wordDf.get(w) || 0) + 1); }
    }
    for (let i = 0; i < ws.length - 1; i++) {
      const a = ws[i], b = ws[i + 1];
      if ((STOP.has(a) && STOP.has(b)) || NOISE.has(a) || NOISE.has(b)) continue;
      const bg = `${a} ${b}`;
      if (!seenB.has(bg)) { seenB.add(bg); bigramDf.set(bg, (bigramDf.get(bg) || 0) + 1); }
    }
  }
  const n = descs.length || 1;
  const out = new Map<string, TermStat>();
  for (const [term, df] of wordDf) if (df >= Math.max(2, n * 0.03)) out.set(term, { term, df, kind: 'word' });
  for (const [term, df] of bigramDf) if (df >= Math.max(2, n * 0.03)) out.set(term, { term, df, kind: 'bigram' });
  return out;
}

async function main() {
  // PASS 1 — pull + raw-extract every NAICS, and count in how many NAICS each
  // term appears (the cross-NAICS document frequency for IDF).
  const perNaics: { code: string; label: string; n: number; terms: Map<string, TermStat> }[] = [];
  const naicsWithTerm = new Map<string, number>();   // term → # of NAICS it appears in

  for (const { code, label } of PROBE_NAICS) {
    process.stdout.write(`  [1/2] ${code} ${label} … `);
    const descs = await fetchDescriptions(code);
    const terms = rawTerms(descs);
    perNaics.push({ code, label, n: descs.length, terms });
    for (const t of terms.keys()) naicsWithTerm.set(t, (naicsWithTerm.get(t) || 0) + 1);
    console.log(`${descs.length} awards → ${terms.size} raw terms`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const N = perNaics.length;
  // A term in > GENERIC_FRACTION of all NAICS is filler (services/maintenance/
  // center/year) — down-weight hard. Distinctiveness = idf = log(N / df_naics).
  const GENERIC_FRACTION = 0.4;
  const idf = (term: string) => Math.log(N / (naicsWithTerm.get(term) || 1));

  // PASS 2 — score each NAICS's terms by tf-idf, keep the distinctive ones.
  let md = `# NAICS vocabulary PROBE v2 (cross-NAICS cleaned)\n\n`;
  md += `_Real federal-buyer vocabulary from live USASpending award text, ${N} NAICS. `;
  md += `Terms scored by TF-IDF: frequency IN the code × distinctiveness ACROSS codes. `;
  md += `Filler that appears in >${Math.round(GENERIC_FRACTION * 100)}% of codes (services, center, year, maintenance) is dropped automatically — no hand-stoplist._\n\n`;
  md += `## Dropped as cross-NAICS generic (top 25)\n\n`;
  const generic = [...naicsWithTerm.entries()]
    .filter(([, c]) => c > N * GENERIC_FRACTION)
    .sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([t, c]) => `${t} (${c}/${N})`);
  md += generic.join(', ') + `\n\n`;

  for (const { code, label, n, terms } of perNaics) {
    const scored = [...terms.values()]
      .filter((t) => (naicsWithTerm.get(t.term) || 0) <= N * GENERIC_FRACTION)  // drop ubiquitous
      .map((t) => ({ ...t, score: t.df * idf(t.term) * (t.kind === 'bigram' ? 1.3 : 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    md += `## ${code} — ${label}\n\n_${n} awards._\n\n`;
    md += scored.length
      ? scored.map((t) => `${t.term}${t.kind === 'bigram' ? '' : '·'}`).join(', ') + `\n\n`
      : `_(no distinctive vocabulary)_\n\n`;
  }

  const outPath = path.join(process.cwd(), 'docs', 'naics-vocabulary-probe.md');
  fs.writeFileSync(outPath, md);
  console.log(`\nReport: ${outPath}`);
  console.log(`Review the CLEANED vocabulary — filler should be gone, industry terms sharp.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
