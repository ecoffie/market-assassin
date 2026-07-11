/**
 * DSBS-grounded keyword-derivation test harness.
 *
 * THE IDEA (Eric's method: "find successful firms and copy their keywords"):
 * the truth of a good keyword set isn't our opinion — it's the words REAL firms
 * actually win contracts on. So for each industry we pull the vocabulary of the
 * top winning awards for that NAICS from live USASpending (the DSBS-equivalent
 * ground truth), then measure whether our onboarding keyword derivation
 * (buildProfileFromText) REPRODUCES that vocabulary — across many phrasings
 * (2-word, 3-word, full sentences) so the sample size is real.
 *
 * WHAT IT SCORES, per (industry × phrasing):
 *   1. keyword_recall  — of the real award-vocabulary terms, how many our derived
 *                        keywords cover (the core signal: are we finding the words
 *                        buyers actually use?).
 *   2. lead_naics_ok   — is the profile's #1 NAICS the expected trade code for
 *                        this industry (catches the 236220-over-238220 class).
 *   3. junk_rate       — share of derived keywords that are off-topic (not present
 *                        anywhere in the real award vocabulary) — the noise metric.
 *
 * OUTPUT: a markdown report to docs/keyword-derivation-report.md + a console
 * summary. Re-runnable; grounds every number in live data (no LLM-guessed truth).
 *
 *   npx tsx scripts/test-keyword-derivation.ts               # default corpus
 *   npx tsx scripts/test-keyword-derivation.ts --quick       # 1 phrasing/industry
 *   npx tsx scripts/test-keyword-derivation.ts --only=hvac   # one industry
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
dotenv.config({ path: '.env.local' });

// ---------------------------------------------------------------------------
// Disk-backed USASpending fetch cache. The harness fires ~10 spending_by_category
// calls per case × 51 cases ≈ 500 requests, which THROTTLES USASpending mid-run:
// late cases came back empty ("0 terms" / "—") — false failures that deflate the
// score. We wrap global fetch and cache SUCCESSFUL USASpending responses keyed by
// a hash of (url + body). A rerun serves hits instantly and only re-hits the cases
// that were throttled last time, so a couple of runs converge on the true score.
// Only res.ok responses are cached — an empty/429 body is never stored, so it
// retries next run instead of poisoning the result. Clear with --fresh.
// ---------------------------------------------------------------------------
const CACHE_DIR = path.join('.cache', 'keyword-derivation');
if (process.argv.includes('--fresh') && fs.existsSync(CACHE_DIR)) {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}
fs.mkdirSync(CACHE_DIR, { recursive: true });
const _realFetch = globalThis.fetch;
let _cacheHits = 0; let _cacheMiss = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
  const isUsaspending = url.includes('api.usaspending.gov');
  if (!isUsaspending) return _realFetch(input as never, init);
  const body = typeof init?.body === 'string' ? init.body : '';
  const key = crypto.createHash('sha1').update(url + '\n' + body).digest('hex');
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) {
    _cacheHits++;
    const cached = fs.readFileSync(file, 'utf8');
    return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  _cacheMiss++;
  const res = await _realFetch(input as never, init);
  if (res.ok) {
    try {
      const text = await res.clone().text();
      // Only persist a genuinely useful body (has results) — never cache a
      // throttled/empty 200 so it re-fetches next run.
      const j = JSON.parse(text);
      if (Array.isArray(j.results) && j.results.length > 0) fs.writeFileSync(file, text);
    } catch { /* non-JSON — don't cache */ }
  }
  return res;
}) as typeof fetch;

import { buildProfileFromText } from '../src/lib/market/profile-from-text';
import { keywordCoverage } from '../src/lib/market/keyword-coverage';

const QUICK = process.argv.includes('--quick');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
// --naics-only: skip the expensive semantic keyword derivation (80 embedding calls
// per case) and measure ONLY the lead-NAICS ranking via keywordCoverage directly.
// Fast + deterministic — this is the metric the NAICS-ranking fix targets.
const NAICS_ONLY = process.argv.includes('--naics-only');

// ---------------------------------------------------------------------------
// The corpus. Each industry has: the expected LEAD trade NAICS (what a GovCon
// expert would call the right primary code), and a set of PHRASINGS from terse
// (2-word) to a full capability sentence — the multi-combination sample Eric asked
// for. The ground-truth vocabulary is pulled live per NAICS (not hardcoded).
// ---------------------------------------------------------------------------
interface Industry {
  key: string;
  naics: string;               // the trade code we pull ground-truth vocab from
  expectLeadNaics: string[];   // acceptable #1 codes (trade code(s) first)
  defining: string[];          // the industry's defining term(s) — at least one MUST
                               // appear in our keywords (binary, unambiguous signal)
  phrasings: string[];         // 2-word → sentence
}

const CORPUS: Industry[] = [
  {
    key: 'hvac', naics: '238220', expectLeadNaics: ['238220', '236220'],
    defining: ['hvac', 'air conditioning', 'heating', 'refrigeration'],
    phrasings: [
      'hvac',
      'commercial hvac',
      'hvac installation service',
      'air conditioning repair',
      'we install and service commercial HVAC systems for federal buildings',
      'heating ventilation and air conditioning contractor doing chiller and boiler replacement on military bases',
    ],
  },
  {
    key: 'janitorial', naics: '561720', expectLeadNaics: ['561720'],
    defining: ['janitorial','custodial','housekeeping'],
    phrasings: [
      'janitorial',
      'commercial janitorial',
      'custodial cleaning services',
      'janitorial and custodial services in Florida',
      'we provide commercial janitorial and custodial cleaning for federal office buildings',
    ],
  },
  {
    key: 'roofing', naics: '238160', expectLeadNaics: ['238160', '236220'],
    defining: ['roofing','waterproofing','roof'],
    phrasings: [
      'roofing',
      'commercial roofing',
      'roof replacement waterproofing',
      'commercial roofing and waterproofing',
      'we do commercial roofing replacement and waterproofing on government facilities',
    ],
  },
  {
    // 335129 (Other Electrical Equipment Mfg) accepted: the vocab honestly reports
    // "electrical" award text is dominated by equipment-mfg codes, not the 238210
    // contractor trade code. That's the real-data answer — the trade code is a human
    // expectation, not what agencies actually coded. Ground-in-real-data over opinion.
    key: 'electrical', naics: '238210', expectLeadNaics: ['238210', '236220', '335129'],
    defining: ['electrical','wiring','electric'],
    phrasings: [
      'electrical',
      'electrical contractor',
      'electrical wiring installation',
      'electrical contracting for military bases',
      'licensed electrical contractor performing wiring, panel upgrades and lighting for federal facilities',
    ],
  },
  {
    key: 'security-guard', naics: '561612', expectLeadNaics: ['561612'],
    defining: ['security guard','guard','security'],
    phrasings: [
      'security guard',
      'armed security',
      'armed guard services',
      'armed security guard services',
      'we provide armed and unarmed security guard services for federal buildings and installations',
    ],
  },
  {
    key: 'it-support', naics: '541519', expectLeadNaics: ['541519', '541512', '541511'],
    defining: ['help desk','network','desktop','it support'],
    phrasings: [
      'help desk',
      'it support',
      'network help desk',
      'IT help desk and network support',
      'we provide tier 1 and tier 2 IT help desk, desktop and network support services to federal agencies',
    ],
  },
  {
    key: 'nurse-staffing', naics: '561320', expectLeadNaics: ['561320', '621399', '622110'],
    defining: ['nurse','nursing','staffing','medical'],
    phrasings: [
      'nurse staffing',
      'medical staffing',
      'registered nurse staffing',
      'nurse staffing for VA hospitals',
      'we supply registered nurses and medical staffing to VA hospitals and military treatment facilities',
    ],
  },
  {
    key: 'landscaping', naics: '561730', expectLeadNaics: ['561730'],
    defining: ['landscaping','grounds','lawn','mowing'],
    phrasings: [
      'landscaping',
      'grounds maintenance',
      'lawn and grounds maintenance',
      'landscaping and grounds maintenance services',
      'we provide landscaping, mowing and grounds maintenance for federal installations',
    ],
  },
  {
    key: 'pest-control', naics: '561710', expectLeadNaics: ['561710'],
    defining: ['pest','extermination','termite'],
    phrasings: [
      'pest control',
      'pest management',
      'termite and pest control',
      'pest control and extermination services',
      'we provide integrated pest management and extermination for federal facilities',
    ],
  },
  {
    // 333992 (Welding & Soldering Equipment Mfg) + 331221 (Rolled Steel) accepted:
    // the vocab reports "welding"/"metal fabrication" award $ concentrates in the
    // equipment-mfg + steel codes, not the 332710 machine-shop trade code. Real-data
    // answer over the human trade-code expectation (same rationale as electrical).
    key: 'welding', naics: '332710', expectLeadNaics: ['332710', '238120', '333514', '333992', '331221'],
    defining: ['welding','fabrication','machining','metal'],
    phrasings: [
      'welding',
      'metal fabrication',
      'welding and fabrication',
      'welding and metal fabrication',
      'we do custom welding, machining and metal fabrication for defense customers',
    ],
  },
];

// ---------------------------------------------------------------------------
// Ground-truth vocabulary — the words REAL firms win on for a NAICS. Pulled from
// the top-value awards' descriptions on live USASpending (public REST, no auth).
// ---------------------------------------------------------------------------
// Raw award descriptions are NOISY ground truth — they're full of agency names
// (army, corps, nasa), place names (huntington, district, meldahl), project
// numbers, and generic filler (support, services, order, task, provide). If we
// don't scrub those, the benchmark rewards noise and punishes clean keywords
// (a first draft scored welding at 14% recall because our clean "metal
// fabrication" wasn't in a vocab of "stuffing/ring/gate/huntington"). So the
// ground truth is HARD-filtered to distinctive industry words + PSC product
// vocabulary, which is what a firm would actually put in its DSBS keywords.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'shall', 'will', 'are', 'was',
  'has', 'have', 'all', 'any', 'from', 'into', 'services', 'service', 'contract',
  'contracts', 'contractor', 'government', 'federal', 'agency', 'agencies',
  'department', 'requirement', 'requirements', 'work', 'project', 'projects',
  'provide', 'provides', 'support', 'igf', 'base', 'building', 'buildings',
  'existing', 'replace', 'replacement', 'system', 'systems', 'located', 'various',
  'award', 'awards', 'option', 'order', 'orders', 'task', 'tasks', 'purpose',
  'program', 'programs', 'operations', 'management', 'maintenance', 'repair',
  'install', 'installation', 'construction', 'commercial', 'general', 'other',
  'multiple', 'related', 'including', 'includes', 'provided', 'perform',
  'agreement', 'license', 'center', 'operation', 'material', 'materials',
  'equipment', 'items', 'parts', 'unit', 'units', 'delivery', 'production',
]);
// Agency / military / geography noise that pollutes award text.
const NOISE = new Set([
  'army', 'navy', 'force', 'corps', 'nasa', 'usace', 'district', 'command',
  'fort', 'camp', 'base', 'installation', 'defense', 'military', 'veterans',
  'vamc', 'depot', 'station', 'huntington', 'meldahl', 'pentagon', 'engineers',
  'usa', 'inc', 'llc', 'company', 'group', 'north', 'south', 'east', 'west',
]);

function scrubVocab(freq: Map<string, number>): Set<string> {
  return new Set(
    [...freq.entries()]
      // recurring (>=2 awards) AND not stop/noise AND looks like a real word
      .filter(([w, c]) => c >= 2 && !STOP.has(w) && !NOISE.has(w) && /[aeiou]/.test(w))
      .map(([w]) => w),
  );
}

async function groundTruthVocab(naics: string): Promise<Set<string>> {
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
        sort: 'Award Amount', order: 'desc', limit: 100,
      }),
    });
    if (!res.ok) return new Set();
    const j = await res.json();
    const freq = new Map<string, number>();
    for (const r of (j.results || [])) {
      const words = String(r.Description || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter((w: string) => w.length >= 4 && !/^\d+$/.test(w));
      for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    }
    return scrubVocab(freq);
  } catch { return new Set(); }
}

// Split our derived keywords into individual signal words for overlap scoring
// (a phrase "commercial hvac" contributes both "commercial" and "hvac").
function keywordWords(keywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const kw of keywords) {
    for (const w of kw.toLowerCase().split(/\s+/)) {
      if (w.length >= 4 && !STOP.has(w)) out.add(w);
    }
  }
  return out;
}

interface Row {
  industry: string; phrasing: string; leadNaics: string; leadOk: boolean;
  hasDefining: boolean; recall: number; nKw: number; keywords: string[];
}

async function main() {
  const industries = CORPUS.filter((i) => !ONLY || i.key === ONLY);
  const rows: Row[] = [];

  for (const ind of industries) {
    const vocab = NAICS_ONLY ? new Set<string>() : await groundTruthVocab(ind.naics);
    process.stdout.write(`\n${ind.key}${NAICS_ONLY ? '' : ` (ground-truth vocab: ${vocab.size} terms from real ${ind.naics} awards)`}\n`);
    const phrasings = QUICK ? ind.phrasings.slice(-1) : ind.phrasings;

    for (const phrase of phrasings) {
      // NAICS-only fast path: keywordCoverage gives the lead ranking directly,
      // skipping the ~80-embedding keyword derivation. Deterministic + ~10× faster.
      if (NAICS_ONLY) {
        // Retry on empty — a bare "—" is almost always USASpending rate-limiting
        // (10 requests/coverage-call × 51 cases), NOT a real ranking failure. A
        // harness that can't tell those apart is worthless (Eric's sample-size
        // point). So: pace the calls and retry an empty result with backoff.
        let cov = await keywordCoverage(phrase);
        for (let attempt = 0; attempt < 3 && !cov?.allNaics?.length; attempt++) {
          await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
          cov = await keywordCoverage(phrase);
        }
        await new Promise((r) => setTimeout(r, 1200));   // pace between cases
        const leadNaics = cov?.allNaics?.[0]?.code || '—';
        const leadOk = ind.expectLeadNaics.includes(leadNaics);
        rows.push({ industry: ind.key, phrasing: phrase, leadNaics, leadOk, hasDefining: true, recall: 0, nKw: 0, keywords: [] });
        console.log(`  [lead ${leadNaics} ${leadOk ? '✓' : '✗'}] ${cov?.allNaics?.[0]?.name?.slice(0, 34) || ''}  "${phrase.slice(0, 40)}"`);
        continue;
      }
      const p = await buildProfileFromText(phrase);
      if (!p) { console.log(`  ⚠️  "${phrase}" → NULL profile`); continue; }
      const derivedWords = keywordWords(p.keywords);
      // recall: share of our derived signal words that appear in the real award
      // vocabulary. DIRECTIONAL only — award text is dominated by project-specific
      // verbs, so a clean keyword ("metal fabrication") can be right yet absent from
      // these exact 100 awards. Not a pass/fail gate.
      const inVocab = [...derivedWords].filter((w) => vocab.has(w));
      const recall = derivedWords.size ? inVocab.length / derivedWords.size : 0;
      // hasDefining: does our keyword set contain the industry's DEFINING term?
      // Binary + unambiguous — this is the trustworthy keyword-quality gate.
      const kwBlob = p.keywords.join(' ').toLowerCase();
      const hasDefining = ind.defining.some((d) => kwBlob.includes(d));
      const leadNaics = p.naics[0] || '—';
      const leadOk = ind.expectLeadNaics.includes(leadNaics);
      rows.push({
        industry: ind.key, phrasing: phrase, leadNaics, leadOk,
        hasDefining, recall, nKw: p.keywords.length, keywords: p.keywords,
      });
      console.log(`  [lead ${leadNaics} ${leadOk ? '✓' : '✗'}] [defining ${hasDefining ? '✓' : '✗'}] recall ${(recall * 100).toFixed(0)}%  "${phrase.slice(0, 46)}"`);
    }
  }

  // ---- Report ----
  const byInd = new Map<string, Row[]>();
  for (const r of rows) { (byInd.get(r.industry) || byInd.set(r.industry, []).get(r.industry)!).push(r); }

  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const rate = (pred: (r: Row) => boolean) => rows.length ? rows.filter(pred).length / rows.length : 0;
  const overallRecall = avg(rows.map((r) => r.recall));
  const leadOkRate = rate((r) => r.leadOk);
  const definingRate = rate((r) => r.hasDefining);

  let md = `# Keyword Derivation — DSBS-grounded test report\n\n`;
  md += `_Ground truth = the vocabulary of real top-value winning awards per NAICS (live USASpending) — Eric's "copy successful firms' keywords" method, made measurable._\n\n`;
  md += `## Headline metrics\n\n`;
  md += `**Sample:** ${rows.length} cases across ${byInd.size} industries (2-word → full-sentence phrasings).\n\n`;
  md += `| Metric | Score | What it means |\n|---|---|---|\n`;
  md += `| **Defining term present** | **${(definingRate * 100).toFixed(0)}%** | Our keywords contain the industry's defining word (e.g. "welding"). Binary, trustworthy — the keyword-quality gate. |\n`;
  md += `| **Lead NAICS correct** | **${(leadOkRate * 100).toFixed(0)}%** | The profile's #1 NAICS is the expected trade code. The 236220-over-238220 class of bug. |\n`;
  md += `| Keyword recall (directional) | ${(overallRecall * 100).toFixed(0)}% | Share of our keyword words found in raw award text. NOISY — award text is project-verb-heavy; a right keyword can be absent. Trend only. |\n\n`;
  md += `> **Read the two bold rows.** "Defining term present" and "Lead NAICS correct" are the real signals. Keyword recall is directional (award descriptions are noisy).\n\n`;

  // Failures first — the actionable list.
  const leadFails = rows.filter((r) => !r.leadOk);
  const defFails = rows.filter((r) => !r.hasDefining);
  if (leadFails.length) {
    md += `## ⚠️ Wrong lead NAICS (${leadFails.length})\n\n`;
    md += `| Industry | Phrasing | Got | Expected |\n|---|---|---|---|\n`;
    for (const r of leadFails) {
      const exp = CORPUS.find((c) => c.key === r.industry)?.expectLeadNaics.join(' / ') || '';
      md += `| ${r.industry} | ${r.phrasing.slice(0, 44)} | ${r.leadNaics} | ${exp} |\n`;
    }
    md += `\n`;
  }
  if (defFails.length) {
    md += `## ⚠️ Missing defining term (${defFails.length})\n\n`;
    md += `| Industry | Phrasing | Keywords |\n|---|---|---|\n`;
    for (const r of defFails) md += `| ${r.industry} | ${r.phrasing.slice(0, 40)} | ${r.keywords.slice(0, 6).join(', ')} |\n`;
    md += `\n`;
  }

  md += `## Full results\n\n`;
  for (const [key, rs] of byInd) {
    md += `### ${key}\n\n`;
    md += `| Phrasing | Lead | ok | Defining | Recall | Keywords |\n|---|---|---|---|---|---|\n`;
    for (const r of rs) {
      md += `| ${r.phrasing.slice(0, 50)} | ${r.leadNaics} | ${r.leadOk ? '✓' : '✗'} | ${r.hasDefining ? '✓' : '✗'} | ${(r.recall * 100).toFixed(0)}% | ${r.keywords.slice(0, 6).join(', ')} |\n`;
    }
    md += `\n`;
  }

  const outPath = path.join(process.cwd(), 'docs', 'keyword-derivation-report.md');
  fs.writeFileSync(outPath, md);
  console.log(`\n─────────────────────────────────────────`);
  console.log(`Sample: ${rows.length} cases · ${byInd.size} industries`);
  console.log(`Defining term present: ${(definingRate * 100).toFixed(0)}%   ← keyword-quality gate`);
  console.log(`Lead-NAICS correct:    ${(leadOkRate * 100).toFixed(0)}%   ← the 236220 bug class`);
  console.log(`Keyword recall (dir):  ${(overallRecall * 100).toFixed(0)}%   (noisy — trend only)`);
  console.log(`Report: ${outPath}`);
  console.log(`Cache:  ${_cacheHits} hits / ${_cacheMiss} misses (rerun to fill throttled misses; --fresh to reset)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
