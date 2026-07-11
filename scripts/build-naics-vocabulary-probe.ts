/**
 * NAICS vocabulary PROBE (measure-before-you-build, Eric Jul 11 2026).
 *
 * THE VISION: a persistent table of the REAL words federal buyers use, keyed by
 * NAICS/PSC, mined from actual award (and later SOW/PWS) text — so every Mindy
 * surface (onboarding keywords, expiring-contract match, forecasts, SOW/PWS
 * relevance, alerts) can test against the ACTUAL vocabulary instead of guessing
 * wildcards case-by-case. "Use the actual words across the board."
 *
 * THIS SCRIPT is the PROBE step only: extract vocabulary for ~20 representative
 * NAICS and write a review file so we eyeball QUALITY before committing to the
 * full ~1,000-code backfill + Supabase table. No writes — read-only + a report.
 *
 * Source: live USASpending award descriptions (public REST). Portable (the future
 * backfill reuses this exact extractor). Terms = scrubbed single words + bigrams,
 * ranked by how many distinct awards use them (document frequency, not raw count —
 * so a single verbose award can't dominate).
 *
 *   npx tsx scripts/build-naics-vocabulary-probe.ts
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
dotenv.config({ path: '.env.local' });

// 20 representative NAICS spanning the small-biz trades + services + a few
// manufacturing/other codes to see how the extractor handles each shape.
const PROBE_NAICS: { code: string; label: string }[] = [
  { code: '238220', label: 'Plumbing/Heating/AC (HVAC)' },
  { code: '238210', label: 'Electrical Contractors' },
  { code: '238160', label: 'Roofing Contractors' },
  { code: '561720', label: 'Janitorial Services' },
  { code: '561730', label: 'Landscaping Services' },
  { code: '561710', label: 'Exterminating/Pest Control' },
  { code: '561612', label: 'Security Guard Services' },
  { code: '561320', label: 'Temporary Help (Staffing)' },
  { code: '541512', label: 'Computer Systems Design' },
  { code: '541519', label: 'Other Computer Services' },
  { code: '541611', label: 'Admin/Management Consulting' },
  { code: '541330', label: 'Engineering Services' },
  { code: '541930', label: 'Translation/Interpretation' },
  { code: '236220', label: 'Commercial Building Construction' },
  { code: '332710', label: 'Machine Shops' },
  { code: '333415', label: 'AC/Refrigeration Equipment Mfg' },
  { code: '621111', label: 'Offices of Physicians' },
  { code: '622110', label: 'General Hospitals' },
  { code: '484121', label: 'General Freight Trucking' },
  { code: '811310', label: 'Industrial Machinery Repair' },
];

// Noise that pollutes award text — agency/place names, generic filler, project
// scaffolding. Kept aggressive; the goal is the INDUSTRY vocabulary, not the
// specifics of any one contract.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'shall', 'will', 'are', 'was',
  'has', 'have', 'all', 'any', 'from', 'into', 'per', 'each', 'not', 'other',
  'services', 'service', 'contract', 'contracts', 'contractor', 'government',
  'federal', 'agency', 'agencies', 'department', 'requirement', 'requirements',
  'work', 'project', 'projects', 'provide', 'provides', 'support', 'igf',
  'existing', 'replace', 'replacement', 'located', 'various', 'award', 'awards',
  'option', 'order', 'orders', 'task', 'tasks', 'purpose', 'program', 'programs',
  'operations', 'including', 'includes', 'provided', 'perform', 'multiple',
  'related', 'agreement', 'located', 'base', 'building', 'buildings', 'new',
  'general', 'facility', 'facilities', 'site', 'number', 'located', 'furnish',
]);
const NOISE = new Set([
  'army', 'navy', 'force', 'corps', 'nasa', 'usace', 'district', 'command',
  'fort', 'camp', 'installation', 'defense', 'military', 'veterans', 'vamc',
  'depot', 'station', 'pentagon', 'engineers', 'inc', 'llc', 'company',
  'north', 'south', 'east', 'west', 'building', 'located', 'located',
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

function tokens(desc: string): string[] {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && /[aeiou]/.test(w));
}

/** Document-frequency vocabulary: terms + bigrams ranked by # awards using them. */
function extractVocab(descs: string[]): { term: string; df: number; kind: 'word' | 'bigram' }[] {
  const wordDf = new Map<string, number>();
  const bigramDf = new Map<string, number>();
  for (const d of descs) {
    const ws = tokens(d);
    const seenW = new Set<string>();
    const seenB = new Set<string>();
    for (const w of ws) {
      if (STOP.has(w) || NOISE.has(w)) continue;
      if (!seenW.has(w)) { seenW.add(w); wordDf.set(w, (wordDf.get(w) || 0) + 1); }
    }
    for (let i = 0; i < ws.length - 1; i++) {
      const a = ws[i], b = ws[i + 1];
      // bigram must have >=1 non-stop signal word on each side to be a real phrase
      if (STOP.has(a) && STOP.has(b)) continue;
      if (NOISE.has(a) || NOISE.has(b)) continue;
      const bg = `${a} ${b}`;
      if (!seenB.has(bg)) { seenB.add(bg); bigramDf.set(bg, (bigramDf.get(bg) || 0) + 1); }
    }
  }
  const n = descs.length || 1;
  const words = [...wordDf.entries()]
    .filter(([, df]) => df >= Math.max(2, n * 0.03))    // in >=3% of awards (min 2)
    .map(([term, df]) => ({ term, df, kind: 'word' as const }));
  const bigrams = [...bigramDf.entries()]
    .filter(([, df]) => df >= Math.max(2, n * 0.03))
    .map(([term, df]) => ({ term, df, kind: 'bigram' as const }));
  return [...bigrams, ...words].sort((a, b) => b.df - a.df);
}

async function main() {
  let md = `# NAICS vocabulary PROBE\n\n`;
  md += `_Real federal-buyer vocabulary mined from live USASpending award descriptions. `;
  md += `"df" = # of (top-value) awards using the term. This is the probe to judge quality `;
  md += `before the full backfill + naics_vocabulary table._\n\n`;

  for (const { code, label } of PROBE_NAICS) {
    process.stdout.write(`  ${code} ${label} … `);
    const descs = await fetchDescriptions(code);
    const vocab = extractVocab(descs).slice(0, 25);
    console.log(`${descs.length} awards → ${vocab.length} terms`);
    md += `## ${code} — ${label}\n\n`;
    md += `_${descs.length} awards sampled._\n\n`;
    if (vocab.length === 0) { md += `_(no vocabulary — too few awards or all noise)_\n\n`; continue; }
    const top = vocab.map((v) => `${v.term}${v.kind === 'bigram' ? '' : '·'} (${v.df})`).join(', ');
    md += `${top}\n\n`;
    await new Promise((r) => setTimeout(r, 600));
  }

  const outPath = path.join(process.cwd(), 'docs', 'naics-vocabulary-probe.md');
  fs.writeFileSync(outPath, md);
  console.log(`\nReport: ${outPath}`);
  console.log(`Review the quality, then we commit to the schema + full backfill.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
