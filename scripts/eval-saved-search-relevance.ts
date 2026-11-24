/**
 * Precision/recall evaluation of the saved-search Open evaluators (READ-ONLY).
 *
 *   build  : npx tsx scripts/eval-saved-search-relevance.ts build  > pool.json
 *            For each test intent, runs legacy (applyMapFilters) and canonical (applyMapsOpenFilters)
 *            under the alert cron's 30-day posted window, then draws a STRATIFIED sample from four
 *            strata: legacy-only, canonical-only, both, and a recall pool NEITHER returned (rows in the
 *            intent's target NAICS or with a loose title term — built independently of both evaluators).
 *            Emits a blind pool (no stratum on the item) + a key file with stratum sizes.
 *   score  : npx tsx scripts/eval-saved-search-relevance.ts score <pool.json> <labels.json>
 *            Stratum-weighted precision for each evaluator and pooled recall (TREC-style: relevant =
 *            labeled-relevant rows found by ANY stratum, weighted back to stratum size).
 */
import { config } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { mapsOpenRequest, applyMapsOpenFilters } from '@/lib/opportunities/maps-open-discovery';

config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env.local'), quiet: true } as never);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** Each intent: the saved filters, a plain-language description the labeler judges against, and an
 *  INDEPENDENT recall probe (target NAICS + loose title terms) that neither evaluator authored. */
export const INTENTS: Array<{ id: string; filters: Record<string, unknown>; intent: string; probeNaics: string[]; probeTerms: string[] }> = [
  { id: 'hvac', filters: { q: 'hvac maintenance' }, intent: 'HVAC (heating, ventilation, air conditioning) maintenance, repair or service work', probeNaics: ['238220'], probeTerms: ['hvac', 'air condition', 'chiller', 'boiler', 'heating', 'ventilat'] },
  { id: 'medstaff', filters: { q: 'medical staffing' }, intent: 'Medical/clinical staffing: supplying nurses, physicians, technicians or other healthcare personnel', probeNaics: ['561320', '621111', '621399', '561311'], probeTerms: ['staffing', 'nurse', 'physician', 'clinical', 'locum', 'medical personnel'] },
  { id: 'janitorial', filters: { q: 'janitorial services' }, intent: 'Janitorial / custodial cleaning services for facilities', probeNaics: ['561720'], probeTerms: ['janitor', 'custodial', 'cleaning', 'housekeeping'] },
  { id: 'novice_clean', filters: { q: 'we clean office buildings' }, intent: 'Commercial cleaning of office buildings (janitorial/custodial)', probeNaics: ['561720'], probeTerms: ['janitor', 'custodial', 'cleaning'] },
  { id: 'novice_ac', filters: { q: 'I fix air conditioners for government buildings' }, intent: 'Repair/maintenance of air conditioning or HVAC equipment in buildings', probeNaics: ['238220'], probeTerms: ['hvac', 'air condition', 'chiller'] },
  { id: 'novice_nurses', filters: { q: 'nurses for VA hospitals' }, intent: 'Nurse staffing for Department of Veterans Affairs medical facilities', probeNaics: ['561320', '621399'], probeTerms: ['nurse', 'nursing', 'rn ', 'lpn'] },
  { id: 'geo_guard_tx', filters: { q: 'security guard services in Texas' }, intent: 'Security guard / protective services performed in or bought for Texas', probeNaics: ['561612'], probeTerms: ['guard', 'security officer', 'protective service'] },
  { id: 'geo_georgia', filters: { q: 'construction in Georgia' }, intent: 'Construction work in the US state of Georgia (not the country)', probeNaics: ['236220', '237310', '238'], probeTerms: ['construct', 'renovat', 'repair'] },
  { id: 'setaside_8a', filters: { q: 'IT help desk', setAside: '8a' }, intent: 'IT help desk / service desk support set aside for 8(a) firms', probeNaics: ['541513', '541519', '541512'], probeTerms: ['help desk', 'service desk', 'it support'] },
  { id: 'multi_naics', filters: { naics: '561720,561730', state: 'VA,MD' }, intent: 'Janitorial (561720) or landscaping (561730) work in Virginia or Maryland', probeNaics: ['561720', '561730'], probeTerms: ['janitor', 'custodial', 'landscap', 'grounds'] },
  { id: 'agency_va', filters: { agency: 'Department of Veterans Affairs', naics: '561720' }, intent: 'Janitorial work bought by the Department of Veterans Affairs', probeNaics: ['561720'], probeTerms: ['janitor', 'custodial', 'housekeeping'] },
  { id: 'broad_construction', filters: { q: 'construction' }, intent: 'Construction work of any kind', probeNaics: ['236', '237', '238'], probeTerms: ['construct'] },
  { id: 'garbage', filters: { q: 'xqzv blorptastic' }, intent: '(nonsense query: nothing should be relevant)', probeNaics: [], probeTerms: [] },
];

const COLS = 'notice_id, title, department, naics_code, pop_state, set_aside_code, description';
const PER_STRATUM = 15;
/** Public notice text quotes named contracting officers; a committed fixture keeps the work, not the people. */
const redact = (t: string) => t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone]');
const sample = <T,>(xs: T[], n: number, seed: number) => {
  const a = [...xs]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all(build: (q: any) => any, cap = 10000): Promise<any[]> {
  const out = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(db.from('sam_opportunities').select(COLS)).order('notice_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function build() {
  const pool: unknown[] = []; const key: Record<string, unknown> = {};
  let seed = 7;
  for (const it of INTENTS) {
    const get = (k: string) => (it.filters as Record<string, any>)[k] ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lf = parseMapFilters(get); lf.postedDays = 30;
    const req = mapsOpenRequest(get); req.filters.postedDays = 30;
    const base = parseMapFilters(() => null); base.postedDays = 30;
    const probeOr = [...it.probeNaics.map((n) => `naics_code.like.${n}%`), ...it.probeTerms.map((t) => `title.ilike.%${t}%`)].join(',');
    const [L, C, P] = await Promise.all([
      all((q) => applyMapFilters(q, lf)),
      all((q) => applyMapsOpenFilters(q, req)),
      probeOr ? all((q) => applyMapFilters(q, base).or(probeOr)) : Promise.resolve([]),
    ]);
    const Ls = new Set(L.map((r) => r.notice_id)), Cs = new Set(C.map((r) => r.notice_id));
    const strata = {
      legacy_only: L.filter((r) => !Cs.has(r.notice_id)),
      canonical_only: C.filter((r) => !Ls.has(r.notice_id)),
      both: C.filter((r) => Ls.has(r.notice_id)),
      neither: P.filter((r) => !Ls.has(r.notice_id) && !Cs.has(r.notice_id)),
    };
    key[it.id] = { intent: it.intent, filters: it.filters, planStatus: req.plan.status, via: req.plan.horizons.open.via, legacyTotal: L.length, canonicalTotal: C.length, sizes: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, v.length])), items: {} as Record<string, string> };
    for (const [stratum, rows] of Object.entries(strata)) {
      for (const r of sample(rows, PER_STRATUM, seed++)) {
        const item = `${it.id}:${r.notice_id}`;
        (key[it.id] as { items: Record<string, string> }).items[item] = stratum;
        pool.push({ item, intent: it.intent, title: r.title, agency: r.department, naics: r.naics_code, state: r.pop_state, setAside: r.set_aside_code, description: redact(String(r.description || '')).replace(/\s+/g, ' ').slice(0, 400) });
      }
    }
  }
  console.log(JSON.stringify({ key, pool: sample(pool, pool.length, 99) }, null, 1));
}

function score(poolPath: string, labelsPath: string) {
  const { key } = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
  const labels: Record<string, boolean> = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  const rows = [];
  for (const [id, k] of Object.entries<any>(key)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const est: Record<string, { rel: number; n: number; size: number }> = {};
    for (const [item, stratum] of Object.entries<string>(k.items)) {
      if (!(item in labels)) continue;
      est[stratum] ??= { rel: 0, n: 0, size: k.sizes[stratum] };
      est[stratum].n++; if (labels[item]) est[stratum].rel++;
    }
    const relIn = (s: string) => (est[s] ? (est[s].rel / est[s].n) * est[s].size : 0);
    const R = { lo: relIn('legacy_only'), co: relIn('canonical_only'), b: relIn('both'), ne: relIn('neither') };
    const totalRel = R.lo + R.co + R.b + R.ne;
    const pct = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) : null);
    rows.push({
      intent: id, status: k.planStatus, legacyN: k.legacyTotal, canonN: k.canonicalTotal,
      legacyPrecision: k.legacyTotal ? pct((R.lo + R.b) / k.legacyTotal) : null,
      canonPrecision: k.canonicalTotal ? pct((R.co + R.b) / k.canonicalTotal) : null,
      legacyRecall: totalRel ? pct((R.lo + R.b) / totalRel) : null,
      canonRecall: totalRel ? pct((R.co + R.b) / totalRel) : null,
      estRelevant: Math.round(totalRel),
    });
  }
  console.table(rows);
  console.log(JSON.stringify(rows));
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'build') build().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'score') score(a, b);
else { console.error('usage: build | score <pool.json> <labels.json>'); process.exit(2); }
