/**
 * "Work in the scope" — OFFLINE, READ-ONLY prototype (Agent 4, research only).
 *
 * Not a product surface. No route, no flag, no writes, no new model or vector store.
 * Reads sam_opportunities (SELECT only) and calls the EXISTING embedding model once per new
 * description (text-embedding-3-small, ~$0.000001; cached in --vector-cache).
 *
 *   npx tsx docs/benchmarks/data-core-hidden-opportunity-v1/v2/scope-lane.ts --q "We erect steel buildings and install metal roofing."
 *   flags: --k 100            semantic candidate depth (rank over ALL open vectors)
 *          --snapshot FILE    read open notices + vectors from a local JSONL snapshot instead of the DB
 *          --posted-after D   holdout: only candidates posted after D (YYYY-MM-DD; needs DB mode)
 *          --json FILE        also write machine-readable output
 *          --vector-cache F   JSON {description: vector} (default: none)
 *          --env FILE         env file with NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY
 *
 * Separation kept (Agent 3, 2026-11-14): rows the released FIND Open plan retrieves keep their class
 * (DIRECT_MATCH / RELATED_MARKET_CANDIDATE / other) and are never moved into the lane; their direct +
 * related + other counts are printed unchanged. Only rows the plan did NOT retrieve can enter the lane.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { applyOpenPlan } from '@/lib/discovery/apply';
import { matchesText } from '@/lib/discovery/matcher';
import { interpretMarket } from '@/lib/opportunities/market-interpretation';
import { classifyOpenRecord } from '@/lib/opportunities/open-relevance';
import { embedText, cosineSimilarity } from '@/lib/market/embeddings';

// ── args ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const Q = arg('q');
if (!Q) { console.error('usage: --q "plain-English business description"'); process.exit(2); }
const K = parseInt(arg('k', '100')!, 10);
const SNAP = arg('snapshot');
const POSTED_AFTER = arg('posted-after');
const JSON_OUT = arg('json');
const VCACHE = arg('vector-cache');
const ENV = arg('env', '/Users/ericcoffie/Market Assasin/market-assassin/.env.local')!;
const HERE = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const RULES = JSON.parse(fs.readFileSync(path.join(HERE, 'rules_v2.json'), 'utf8'));

for (const l of fs.readFileSync(ENV, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// ── evidence rules v2 (frozen in rules_v2.json) ───────────────────────────────────────────────
type Row = Record<string, any>;
const clean = (t: string) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
function* sentences(t: string) {
  for (let s of t.split(/(?<=[.!?;])\s+|\s+(?=\(\w\)\s)|\s+(?=\d+\.\d*\s+[A-Z])|\s+[•▪●]\s+/)) {
    s = (s || '').trim();
    while (s.length > 400) { yield s.slice(0, 400); s = s.slice(350); }
    if (s.length >= 12) yield s;
  }
}
const norm = (w: string) => w.toLowerCase().replace(/-/g, '').replace(/[^a-z0-9]/g, '');
const stem = (w: string) => { w = norm(w); for (const suf of ['ies', 'es', 's']) if (w.length > 4 && w.endsWith(suf)) return w.slice(0, -suf.length) + (suf === 'ies' ? 'y' : ''); return w; };
const words = (s: string) => new Set(s.split(/[\s,/;:()."'’]+/).filter(Boolean).map(stem));
const phraseRe = (p: string) => new RegExp('\\b' + p.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*') + '(?:s|es)?\\b', 'i');
const TOC_SEC = new RegExp(RULES.toc_rule.section_number_regex, 'g');
const TOC_DIV = new RegExp(RULES.toc_rule.division_regex, 'i');
const isToc = (s: string) => { const n = (s.match(TOC_SEC) || []).length; return n >= RULES.toc_rule.min_section_numbers || (TOC_DIV.test(s) && n >= 1); };
const CUES = new Set<string>(RULES.requirement_cues.map(stem));
const hasCue = (s: string) => [...words(s)].some((w) => CUES.has(w)) || /\bscope of work\b/i.test(s);

interface TermHit { term: string; kind: 'profile' | 'census'; census_naics?: string }
function termHits(biz: string, s: string): TermHit[] {
  const out: TermHit[] = [];
  for (const p of RULES.profile_phrases[biz] || []) if (phraseRe(p).test(s)) out.push({ term: p, kind: 'profile' });
  const ws = words(s);
  for (const e of RULES.census_entries[biz] || []) if (e.words.every((w: string) => ws.has(w))) out.push({ term: e.entry, kind: 'census', census_naics: e.naics });
  return out;
}
export interface Evidence { role: 'PRIME_CANDIDATE' | 'SUB_SCOPE' | 'UNCERTAIN' | 'NONE'; sentence: string | null; source: 'description' | 'sow' | null; terms: TermHit[]; reason: string }
function evidence(biz: string, row: Row): Evidence {
  const titleHit = termHits(biz, String(row.title || '')).length > 0;
  let sawTerm: { s: string; src: 'description' | 'sow'; why: string } | null = null;
  for (const [src, txt] of [['description', row.description], ['sow', row.sow_text]] as const) {
    for (const s of sentences(clean(txt))) {
      const hits = termHits(biz, s);
      if (!hits.length) continue;
      if (isToc(s)) { sawTerm ??= { s, src, why: 'term only in a specification table-of-contents line' }; continue; }
      if (!hasCue(s)) { sawTerm ??= { s, src, why: 'term present but no requirement cue in the sentence' }; continue; }
      return { role: titleHit ? 'PRIME_CANDIDATE' : 'SUB_SCOPE', sentence: s, source: src, terms: hits, reason: 'body sentence states the trade with a requirement cue' };
    }
  }
  if (sawTerm) return { role: 'UNCERTAIN', sentence: sawTerm.s, source: sawTerm.src, terms: termHits(biz, sawTerm.s), reason: sawTerm.why };
  return { role: 'NONE', sentence: null, source: null, terms: [], reason: 'no trade term in description or SOW' };
}

// Which benchmark trade's frozen term list applies. The prototype maps a description to the closest of the
// six benchmark trades by embedding similarity to their profile descriptions (no new model); 'none' if weak.
const QUERIES = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'queries.json'), 'utf8')) as Record<string, string[]>;

async function vec(text: string, cache: Record<string, number[]>): Promise<number[]> {
  if (cache[text]) return cache[text];
  const v = await embedText(text); cache[text] = v; return v;
}

const isUmbrella = (c: string | null) => !!c && RULES.umbrella_naics_prefixes.some((p: string) => c.startsWith(p));
const parseVec = (e: unknown): number[] | null => { const a = typeof e === 'string' ? JSON.parse(e) : e; return Array.isArray(a) && a.length > 100 ? a.map(Number) : null; };

async function pageAll(build: (from: number) => any, max = 30000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const cache: Record<string, number[]> = VCACHE && fs.existsSync(VCACHE) ? JSON.parse(fs.readFileSync(VCACHE, 'utf8')) : {};
  const nowIso = new Date().toISOString();

  // 1 · RELEASED FIND OPEN PLAN (the "ordinary retrieval" baseline). Full matched set, not the 500 display cap.
  const plan = buildDiscoveryPlan({ query: Q! }, MCP_POLICY);
  const cap = interpretMarket(Q!, null).capability;
  let planRows: Row[] = [];
  if (plan.status === 'ok') {
    const COLS = 'notice_id, title, department, sub_tier, naics_code, psc_code, description, solicitation_number, response_deadline';
    planRows = await pageAll(() => applyOpenPlan(sb.from('sam_opportunities').select(COLS), plan).order('notice_id'));
  }
  const planClass = new Map<string, string>();
  const counts: Record<string, number> = { DIRECT_MATCH: 0, RELATED_MARKET_CANDIDATE: 0, other: 0 };
  for (const r of planRows) {
    // mirror of find-opportunities.ts openEvidenceClass (released): classifier first, then matcher on visible text
    let cls: string = classifyOpenRecord({ title: r.title || '', description: r.description || '', naics_code: r.naics_code || '', psc_code: r.psc_code || '', department: r.department || '', solicitation_number: r.solicitation_number || '', response_deadline: r.response_deadline || null }, cap);
    if (cls === 'WEAK_NON_MARKET' && cap.kind !== 'cyber_with_related_it') {
      if (plan.matcher.mode === 'none' || matchesText(plan.matcher, [r.title, r.description, r.department, r.solicitation_number])) cls = 'DIRECT_MATCH';
    }
    const bucket = cls === 'DIRECT_MATCH' || cls === 'RELATED_MARKET_CANDIDATE' ? cls : 'other';
    counts[bucket]++; planClass.set(r.notice_id, bucket);
  }
  const tPlan = Date.now();

  // 2 · OPEN NOTICES + STORED VECTORS (all open, so "top-k" is over the whole open corpus as pre-registered)
  let open: Row[];
  if (SNAP) {
    open = fs.readFileSync(SNAP, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => ({ ...r, vec: r.emb || null }));
  } else {
    const COLS = 'notice_id, title, department, sub_tier, naics_code, psc_code, notice_type, response_deadline, posted_date, solicitation_number, embedding_source, sow_embedding';
    const raw = await pageAll(() => sb.from('sam_opportunities').select(COLS).gt('response_deadline', nowIso).order('notice_id'));
    open = raw.map((r) => ({ ...r, vec: r.embedding_source === 'none' ? null : parseVec(r.sow_embedding), sow_embedding: undefined }));
  }
  const tLoad = Date.now();

  // 3 · TRADE: nearest benchmark profile (frozen term lists exist only for these six)
  const qv = await vec(Q!, cache);
  let biz = 'none', best = -1;
  for (const [b, [, prof]] of Object.entries(QUERIES)) { const s = cosineSimilarity(qv, await vec(prof, cache)); if (s > best) { best = s; biz = b; } }
  if (VCACHE) fs.writeFileSync(VCACHE, JSON.stringify(cache));

  // 4 · CANDIDATES (retrieval only — never proof): semantic top-K over ALL open vectors ∪ body term hits
  const scored = open.filter((r) => r.vec).map((r) => ({ r, s: cosineSimilarity(qv, r.vec) })).sort((a, b) => b.s - a.s);
  const rank = new Map<string, { rank: number; score: number }>();
  scored.forEach((x, i) => rank.set(x.r.notice_id, { rank: i + 1, score: x.s }));
  const umb = open.filter((r) => isUmbrella(r.naics_code) && !planClass.has(r.notice_id) && (!POSTED_AFTER || String(r.posted_date || '') > POSTED_AFTER));
  // body text for umbrella rows (snapshot already has it)
  if (!SNAP && umb.length) {
    const ids = umb.map((r) => r.notice_id); const txt = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from('sam_opportunities').select('notice_id, description, sow_text').in('notice_id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const d of data || []) txt.set(d.notice_id, d);
    }
    for (const r of umb) Object.assign(r, txt.get(r.notice_id) || {});
  }
  const semSet = new Set(scored.slice(0, K).map((x) => x.r.notice_id));
  const lane: Array<Row & { ev: Evidence; via: string[] }> = [];
  for (const r of umb) {
    const via: string[] = [];
    if (semSet.has(r.notice_id)) via.push('semantic');
    const ev = evidence(biz, r);
    if (ev.role !== 'NONE') via.push('body_terms');
    if (!via.length) continue;
    lane.push({ ...r, ev, via });
  }
  // plan-retrieved "other" rows: attach the scope sentence as a BASIS, never a new class (Agent 3)
  const otherWithBasis = planRows.filter((r) => planClass.get(r.notice_id) === 'other').length;
  const tDone = Date.now();

  const shown = lane.filter((x) => x.ev.role === 'PRIME_CANDIDATE' || x.ev.role === 'SUB_SCOPE')
    .sort((a, b) => (rank.get(a.notice_id)?.rank ?? 1e9) - (rank.get(b.notice_id)?.rank ?? 1e9));
  const uncertain = lane.filter((x) => x.ev.role === 'UNCERTAIN');
  const card = (x: (typeof lane)[number]) => ({
    title: x.title, solicitation_number: x.solicitation_number, notice_id: x.notice_id,
    naics_code: x.naics_code, psc_code: x.psc_code, agency: [x.department, x.sub_tier].filter(Boolean).join(' / '),
    response_deadline: x.response_deadline, posted_date: x.posted_date ?? null,
    evidence_class: 'SCOPE_EVIDENCE', role: x.ev.role, scope_sentence: x.ev.sentence, sentence_source: x.ev.source,
    matched_terms: x.ev.terms, evidence_reason: x.ev.reason,
    why_ordinary_retrieval_missed: `Released FIND Open plan for this description did not retrieve it (no direct/related code match and its visible title/description lack the query concepts); filed under ${x.naics_code} (umbrella code).`,
    retrieved_via: x.via, semantic_rank: rank.get(x.notice_id)?.rank ?? null, semantic_score: rank.get(x.notice_id) ? +rank.get(x.notice_id)!.score.toFixed(4) : null,
    sam_url: `https://sam.gov/opp/${x.notice_id}/view`,
  });
  const out = {
    query: Q, trade_term_list: biz, trade_similarity: +best.toFixed(4), rules_version: RULES.version,
    plan_status: plan.status, released_counts_unchanged: { ...counts, matched_total: planRows.length },
    lane: { candidates: lane.length, shown: shown.length, uncertain_not_shown: uncertain.length, other_rows_eligible_for_scope_basis: otherWithBasis },
    timing_ms: { plan: tPlan - t0, load_vectors: tLoad - tPlan, rank_and_gate: tDone - tLoad, total: tDone - t0 },
    shown: shown.map(card), uncertain: uncertain.map(card),
    plan_class: Object.fromEntries(planClass),
  };
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));

  // ── human-readable ──
  const p = (s = '') => console.log(s);
  p(`\nWORK IN THE SCOPE — offline prototype (research, read-only)  rules ${RULES.version}`);
  p(`Description: "${Q}"`);
  p(`Term list used: ${biz} (similarity ${best.toFixed(3)})`);
  p(`Released FIND Open results (UNCHANGED): direct ${counts.DIRECT_MATCH} · related ${counts.RELATED_MARKET_CANDIDATE} · other ${counts.other} · matched ${planRows.length}${plan.status !== 'ok' ? ` (plan ${plan.status})` : ''}`);
  p(`Scope lane (separate, not counted above): ${shown.length} shown · ${uncertain.length} uncertain (not shown) · from ${lane.length} candidates\n`);
  shown.forEach((c, i) => {
    const x = card(c);
    p(`${i + 1}. ${x.title}`);
    p(`   ${x.solicitation_number || '(no solicitation #)'} · NAICS ${x.naics_code ?? '—'} · PSC ${x.psc_code ?? '—'} · ${x.agency} · due ${String(x.response_deadline || '').slice(0, 10)}`);
    p(`   ${x.role === 'PRIME_CANDIDATE' ? 'Looks like PRIME work' : 'Looks like SUBCONTRACT SCOPE (part of a larger job)'} · evidence SCOPE_EVIDENCE · meaning rank ${x.semantic_rank ?? '—'} (${x.semantic_score ?? '—'}) · via ${x.retrieved_via.join('+')}`);
    p(`   From the ${x.sentence_source === 'sow' ? 'SOW / attachment text' : 'notice description'}: “${String(x.scope_sentence).slice(0, 300)}”`);
    p(`   Why ordinary search missed it: ${x.why_ordinary_retrieval_missed}`);
    p(`   ${x.sam_url}\n`);
  });
  if (uncertain.length) {
    p(`UNCERTAIN (term found, work not established — not shown to a customer):`);
    uncertain.slice(0, 10).forEach((c) => p(`   - ${c.title} [${c.naics_code}] — ${c.ev.reason}: “${String(c.ev.sentence).slice(0, 140)}”`));
  }
  p(`\ntiming: ${JSON.stringify(out.timing_ms)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
