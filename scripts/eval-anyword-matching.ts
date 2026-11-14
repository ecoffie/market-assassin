/**
 * READ-ONLY evaluation of the capability-list "any one word admits" rule (Agent 3, 2026-11-14).
 *
 *   build : FIXTURE_DIR=<dir> npx tsx scripts/eval-anyword-matching.ts build
 *           For each multi-word intent, runs the Map's canonical Open query (mapsOpenRequest →
 *           applyMapsOpenFilters, active notices) and draws a blind stratified sample: `current`
 *           (rows the search returns today) and `neither` (rows it misses, from an independent probe of
 *           target NAICS + title terms written per intent, not by the matcher). Writes pool.json (blind
 *           items) + key.json (strata, sizes, full row ids) + rows.json (fields needed to re-evaluate
 *           variants offline; contains public notice text only).
 *   score : FIXTURE_DIR=<dir> npx tsx scripts/eval-anyword-matching.ts score
 *           Scores each matching VARIANT (all narrowing: a subset of today's result) on the labels with a
 *           stratified ratio estimator. Variants are evaluated with the shared matcher's own JS mirror.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { mapsOpenRequest, applyMapsOpenFilters } from '@/lib/opportunities/maps-open-discovery';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { buildTextMatcher, conceptHit, matchesText, textPredicate, exclusionPredicate, type Concept } from '@/lib/discovery/matcher';
import { OPEN_TEXT_COLS } from '@/lib/discovery/plan';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const FX = (process.env.FIXTURE_DIR || 'tests/fixtures/anyword-matching-2026-11-14') + '/';

/** source: 'saved' = typed by a customer in a saved search; 'constructed' = written for this eval. */
export const INTENTS = [
  { id: 'janitorial_list', source: 'saved', q: 'janitorial custodial grounds turf waste removal', intent: 'Janitorial, custodial, grounds/turf maintenance or waste removal services for facilities', probeNaics: ['561720', '561730', '562111'], probeTerms: ['janitor', 'custodial', 'grounds maintenance', 'mowing', 'waste removal', 'trash'] },
  { id: 'construction_list', source: 'saved', q: 'construction renovation demolition carpentry framing drywall flooring concrete general trades', intent: 'Building construction, renovation, demolition or general trades work (carpentry, framing, drywall, flooring, concrete)', probeNaics: ['236220', '238'], probeTerms: ['renovat', 'demolition', 'carpentry', 'drywall', 'flooring', 'concrete'] },
  { id: 'construction_modern', source: 'saved', q: 'construction renovation building modernization', intent: 'Construction, renovation or modernization of buildings', probeNaics: ['236220', '236210'], probeTerms: ['renovat', 'moderniz', 'building construction'] },
  { id: 'marketing_list', source: 'saved', q: 'marketing branding graphic design digital media advertising', intent: 'Marketing, branding, graphic design, digital media or advertising services', probeNaics: ['541810', '541430', '541613', '541820', '541890'], probeTerms: ['marketing', 'advertis', 'graphic design', 'branding', 'outreach campaign'] },
  { id: 'bakery_list', source: 'saved', q: 'bakery bread pastries cakes catering meals food service', intent: 'Bakery goods, catering, prepared meals or food service', probeNaics: ['311811', '311812', '722310', '722320', '722330'], probeTerms: ['bakery', 'bread', 'catering', 'meals', 'food service'] },
  { id: 'elearning_list', source: 'saved', q: 'e-learning instructional design training development graphic design', intent: 'E-learning, instructional design or training course development (including its graphic design)', probeNaics: ['611430', '611710', '541430'], probeTerms: ['e-learning', 'elearning', 'instructional design', 'curriculum', 'courseware'] },
  { id: 'battery_list', source: 'saved', q: '12V lithium LiON battery', intent: '12-volt / lithium-ion batteries', probeNaics: ['335911', '335912'], probeTerms: ['battery', 'batteries', 'lithium'] },
  { id: 'novice_ac', source: 'constructed', q: 'I fix air conditioners for government buildings', intent: 'Repair or maintenance of air conditioning / HVAC equipment in buildings', probeNaics: ['238220'], probeTerms: ['hvac', 'air condition', 'chiller', 'heat pump'] },
  { id: 'hvac_list', source: 'constructed', q: 'hvac heating cooling ventilation repair maintenance', intent: 'HVAC (heating, ventilation, air conditioning) repair or maintenance', probeNaics: ['238220'], probeTerms: ['hvac', 'heating', 'chiller', 'boiler', 'ventilat'] },
  { id: 'novice_nurses', source: 'constructed', q: 'we provide nurses physicians and medical staff to VA hospitals', intent: 'Supplying nurses, physicians or other medical staff (healthcare staffing), especially to VA medical facilities', probeNaics: ['561320', '621399', '621111'], probeTerms: ['nurse', 'nursing', 'physician', 'staffing', 'locum'] },
  { id: 'guards_list', source: 'constructed', q: 'armed and unarmed security guards patrol and access control services', intent: 'Security guard services: armed or unarmed guards, patrol, access control', probeNaics: ['561612'], probeTerms: ['guard', 'security officer', 'protective service', 'patrol'] },
];

const COLS = 'notice_id,title,description,sow_text,department,sub_tier,solicitation_number,naics_code,psc_code,set_aside_code,pop_state';
const PER_CURRENT = 30, PER_NEITHER = 10;
const redact = (t: string) => t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone]');
const sample = <T,>(xs: T[], n: number, seed: number) => { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

async function all(build: (q: any) => any, sel: string, cap = 20000): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let f = 0; f < cap; f += 1000) {
    const { data, error } = await build(db.from('sam_opportunities').select(sel)).order('notice_id').range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function build() {
  fs.mkdirSync(FX, { recursive: true });
  const pool: unknown[] = []; const key: Record<string, unknown> = {}; const rows: Record<string, unknown> = {};
  let seed = 11;
  for (const it of INTENTS) {
    const req = mapsOpenRequest((k) => (k === 'q' ? it.q : null));
    const cur = await all((q) => applyMapsOpenFilters(q, req), 'notice_id');
    const curIds = new Set(cur.map((r) => r.notice_id));
    const base = parseMapFilters(() => null);
    const probeOr = [...it.probeNaics.map((n) => `naics_code.like.${n}%`), ...it.probeTerms.map((t) => `title.ilike.%${t}%`)].join(',');
    const probe = (await all((q) => applyMapFilters(q, base).or(probeOr), 'notice_id')).filter((r) => !curIds.has(r.notice_id));
    const strata = { current: sample(cur, PER_CURRENT, seed++), neither: sample(probe, PER_NEITHER, seed++) };
    const ids = [...strata.current, ...strata.neither].map((r) => r.notice_id);
    const full: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < ids.length; i += 50) { const { data, error } = await db.from('sam_opportunities').select(COLS).in('notice_id', ids.slice(i, i + 50)); if (error) throw error; full.push(...data!); }
    const byId = new Map(full.map((r) => [r.notice_id, r]));
    key[it.id] = { q: it.q, source: it.source, intent: it.intent, planStatus: req.plan.status, sizes: { current: cur.length, neither: probe.length }, items: {} as Record<string, string> };
    for (const [stratum, rs] of Object.entries(strata)) for (const r of rs) {
      const row = byId.get(r.notice_id); if (!row) continue;
      const item = `${it.id}:${r.notice_id}`;
      (key[it.id] as { items: Record<string, string> }).items[item] = stratum;
      rows[item] = row;
      pool.push({ item, intent: it.intent, title: row.title, agency: [row.department, row.sub_tier].filter(Boolean).join(' / '), naics: row.naics_code, psc: row.psc_code, state: row.pop_state, description: redact(String(row.description || '')).replace(/\s+/g, ' ').slice(0, 500) });
    }
    process.stderr.write(`${it.id}: current ${cur.length}, missed-probe ${probe.length}\n`);
  }
  fs.writeFileSync(FX + 'pool.json', JSON.stringify(sample(pool, pool.length, 99), null, 1));
  fs.writeFileSync(FX + 'key.json', JSON.stringify(key, null, 1));
  fs.writeFileSync(FX + 'rows.json', JSON.stringify(rows));
}

// ── Variants (all narrowing) ────────────────────────────────────────────────────────────────
type Row = Record<string, string | null>;
const VISIBLE = (r: Row) => [r.title, r.description].map((t) => String(t || '')).join(' \n ');
const ANYTEXT = (r: Row) => [r.title, r.description, r.sow_text, r.department, r.solicitation_number].map((t) => String(t || '')).join(' \n ');
let CUR_ROW: Row = {};
function byRare(e: Concept[], df: Record<string, number> | undefined, thr: number, rule: (rare: Concept[], t: { any: string; vis: string }) => boolean): boolean {
  const t = { any: ANYTEXT(CUR_ROW), vis: VISIBLE(CUR_ROW) };
  const rare = e.filter((c) => (df?.[c.label] ?? 0) < thr);
  if (!rare.length) return e.every((c) => conceptHit(c, t.any));
  return rule(rare, t);
}
export const VARIANTS: Record<string, (eligible: Concept[], r: Row, df?: Record<string, number>) => boolean> = {
  V0_current_any_one: (e, r) => e.some((c) => conceptHit(c, ANYTEXT(r))),
  V1_two_concepts: (e, r) => e.filter((c) => conceptHit(c, ANYTEXT(r))).length >= Math.min(2, e.length),
  V2_one_visible_or_two_anywhere: (e, r) => e.some((c) => conceptHit(c, VISIBLE(r))) || e.filter((c) => conceptHit(c, ANYTEXT(r))).length >= Math.min(2, e.length),
  // Apply the existing documented rule (mi-dashboard/search.ts COMMON_TERM_WEIGHT: "df ≥ ~5% of the corpus ⇒ common")
  // as the matcher would: common words become qualifiers (rank only); if no distinctive word is left, all are required.
  V5_common5_rank_only: (e, r, df) => byRare(e, df, 0.05, (rare, t) => rare.some((c) => conceptHit(c, t.any))),
  V6_common2_rank_only: (e, r, df) => byRare(e, df, 0.02, (rare, t) => rare.some((c) => conceptHit(c, t.any))),
  V7_common5_visible_or_two: (e, r, df) => byRare(e, df, 0.05, (rare, t) => rare.some((c) => conceptHit(c, t.vis)) || rare.filter((c) => conceptHit(c, t.any)).length >= Math.min(2, rare.length)),
  // Common words (df >= thr) cannot admit alone but still count toward a two-concept co-occurrence.
  V10_common1_needs_partner: (e, r, df) => { const t = ANYTEXT(CUR_ROW); const hit = e.filter((c) => conceptHit(c, t)); return hit.some((c) => (df?.[c.label] ?? 0) < 0.01) || hit.length >= Math.min(2, e.length); },
  V11_common05_needs_partner: (e, r, df) => { const t = ANYTEXT(CUR_ROW); const hit = e.filter((c) => conceptHit(c, t)); return hit.some((c) => (df?.[c.label] ?? 0) < 0.005) || hit.length >= Math.min(2, e.length); },
  V3_rare_words_only: (e, r, df) => e.filter((c) => (df?.[c.label] ?? 0) < 0.01).some((c) => conceptHit(c, ANYTEXT(r))),
  V4_rare_visible_or_two: (e, r, df) => { const rare = e.filter((c) => (df?.[c.label] ?? 0) < 0.01); return rare.some((c) => conceptHit(c, VISIBLE(r))) || rare.filter((c) => conceptHit(c, ANYTEXT(r))).length >= Math.min(2, rare.length || 1); },
};

async function score() {
  const key = JSON.parse(fs.readFileSync(FX + 'key.json', 'utf8'));
  const rows: Record<string, Row> = JSON.parse(fs.readFileSync(FX + 'rows.json', 'utf8'));
  const labels: Record<string, boolean> = JSON.parse(fs.readFileSync(FX + 'labels.json', 'utf8'));
  const df: Record<string, number> = fs.existsSync(FX + 'df.json') ? JSON.parse(fs.readFileSync(FX + 'df.json', 'utf8')) : {};
  // Which current rows TODAY's text rule admitted (recorded from main before any matcher change). A current row it
  // does not explain came in through the plan's taxonomy branch and is kept by every variant.
  const baselineText: Record<string, boolean> = JSON.parse(fs.readFileSync(FX + 'baseline-text-admitted.json', 'utf8'));
  // IMPL = the matcher in THIS checkout, end to end (buildTextMatcher + matchesText), on the same fields as the SQL path.
  const IMPL = (q: string, r: Row) => matchesText(buildTextMatcher(q), [r.title, r.description, r.sow_text, r.department, r.solicitation_number]);
  const out = [];
  for (const [id, k] of Object.entries<any>(key)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = buildTextMatcher(k.q); const alt = m.alternatives.find((a) => a.shape === 'capability_list') || m.alternatives[0];
    const items = Object.entries<string>(k.items).filter(([it]) => it in labels);
    const est = (keep: (it: string, s: string) => boolean) => { let rel = 0, ret = 0, n = 0; for (const s of ['current', 'neither']) { const its = items.filter(([, st]) => st === s); if (!its.length) continue; const w = k.sizes[s] / its.length; for (const [it] of its) { if (!keep(it, s)) continue; n++; ret += w; if (labels[it]) rel += w; } } return { rel, ret, n }; };
    const totalRel = est(() => true).rel;
    for (const [vn, v] of [...Object.entries(VARIANTS), ['IMPL', VARIANTS.V0_current_any_one] as const]) {
      // A current row that today's text rule does not explain was admitted by the plan's TAXONOMY branch (preset codes);
      // variants change only the text branch, so such rows are always kept.
      const keepRow = (it: string) => { CUR_ROW = rows[it]; return !baselineText[it] || (vn === 'IMPL' ? IMPL(k.q, rows[it]) : v(alt.eligible, rows[it], df)); };
      const e = est((it, s) => s === 'current' && keepRow(it));
      const lost = items.filter(([it, s]) => s === 'current' && labels[it] && !keepRow(it)).length;
      const dropped = items.filter(([it, s]) => s === 'current' && !labels[it] && !keepRow(it)).length;
      out.push({ intent: id, source: k.source, variant: vn, estResults: Math.round(e.ret), precision: e.ret ? Math.round((100 * e.rel) / e.ret) : null, recall: totalRel ? Math.round((100 * e.rel) / totalRel) : null, labeledKept: e.n, labeledRelevantLost: lost, labeledIrrelevantDropped: dropped });
    }
  }
  console.log(JSON.stringify(out));
}

/**
 * parity : FIXTURE_DIR=<dir> npx tsx scripts/eval-anyword-matching.ts parity
 * The SQL text predicate (textPredicate, run by Postgres) and the JS mirror (matchesText, used by the evidence
 * labellers) must give the SAME verdict for every labeled notice, or rows get fetched then silently dropped (or the
 * reverse). Live DB, read-only. Exits 1 on any disagreement.
 */
async function parity() {
  const key = JSON.parse(fs.readFileSync(FX + 'key.json', 'utf8'));
  let total = 0, bad = 0;
  for (const [id, k] of Object.entries<any>(key)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = buildTextMatcher(k.q);
    const pred = textPredicate(m, OPEN_TEXT_COLS); const excl = exclusionPredicate(m, OPEN_TEXT_COLS);
    const ids = Object.keys(k.items).map((it) => it.split(':')[1]);
    const rows: Row[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error } = await db.from('sam_opportunities').select(['notice_id', ...OPEN_TEXT_COLS].join(',')).in('notice_id', ids.slice(i, i + 50));
      if (error) throw new Error(error.message); rows.push(...(data as unknown as Row[]));
    }
    const sqlIds = new Set<string>();
    for (let i = 0; i < ids.length; i += 50) {
      let q = db.from('sam_opportunities').select('notice_id').in('notice_id', ids.slice(i, i + 50));
      if (pred) q = q.or(pred); if (excl) q = q.or(excl);
      const { data, error } = await q; if (error) throw new Error(`${id}: ${error.message}`);
      for (const r of data as Array<{ notice_id: string }>) sqlIds.add(r.notice_id);
    }
    let disagree = 0;
    for (const r of rows) { total++; const js = matchesText(m, OPEN_TEXT_COLS.map((c) => r[c])); if (js !== sqlIds.has(String(r.notice_id))) { disagree++; bad++; console.log(`  DISAGREE ${id} ${r.notice_id} js=${js} sql=${sqlIds.has(String(r.notice_id))}`); } }
    console.log(`${id}: ${rows.length} rows, ${disagree} disagreements`);
  }
  console.log(`parity: ${total} rows, ${bad} disagreements`);
  if (bad) process.exit(1);
}

const cmd = process.argv[2];
if (cmd === 'build') build().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'score') score().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'parity') parity().catch((e) => { console.error(e); process.exit(1); });
else { console.error('usage: build | score | parity'); process.exit(2); }
