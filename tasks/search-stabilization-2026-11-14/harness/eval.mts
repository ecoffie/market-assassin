// Read-only retrieval + ranking evaluator (Agent 3, 2026-11-14). Offline: no DB, no network.
// Emulates FIND Open: retrieval = code recall (openRetrievalNaics/Psc) OR preset vocabulary (exact phrase over
// cap.direct.vocabCols) OR the discovery text matcher over OPEN_TEXT_COLS (override with TEXT_COLS=a,b). Window = first
// 500 by response_deadline (ties by notice_id), labelled with labelOpenRow and ranked tier → breadth → score → order,
// exactly as queryOpenNow. Scores against Agent 4's blind v4 labels (relevant = FIT or PARTIAL; lo = both reviewers,
// hi = either) and the trade code floor.
// usage: tsx eval.mts <corpus.json> <bench dir> <out.json> [baseline.json to diff against]
import fs from 'fs';
import { buildDiscoveryPlan, OPEN_TEXT_COLS } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { matchesText, phraseRegex, jsRegex } from '@/lib/discovery/matcher';
import { rankRecords } from '@/lib/discovery/rank';
import { interpretMarket } from '@/lib/opportunities/market-interpretation';
import { openRetrievalNaics, openRetrievalPsc } from '@/lib/opportunities/open-relevance';
import { labelOpenRow } from '@/lib/opportunities/find-opportunities';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const [corpusPath, benchDir, outPath, basePath] = process.argv.slice(2);
const { rows } = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as { rows: Row[] };
const Q = JSON.parse(fs.readFileSync(`${benchDir}/queries_v4.json`, 'utf8'));
const meta: Array<{ id: string; biz: string; notice_id: string }> = JSON.parse(fs.readFileSync(`${benchDir}/labels/r4_meta.json`, 'utf8'));
const byLab: Record<string, Array<{ label: string; restriction: string }>> = {};
for (const f of fs.readdirSync(`${benchDir}/labels`).filter((f) => f.endsWith('.jsonl'))) {
  for (const l of fs.readFileSync(`${benchDir}/labels/${f}`, 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l); (byLab[j.id] ||= []).push({ label: j.label, restriction: j.restriction || 'NONE' });
  }
}
type Rel = { v: 'lo' | 'hi' | 'no'; restriction: string };
const rel: Record<string, Record<string, Rel>> = {};
for (const m of meta) {
  const ls = byLab[m.id] || []; if (!ls.length) continue;
  const r = ls.filter((x) => x.label === 'FIT' || x.label === 'PARTIAL').length;
  const restriction = ls.map((x) => x.restriction).find((x) => x && x !== 'NONE') || 'NONE';
  (rel[m.biz] ||= {})[m.notice_id] = { v: r === ls.length ? 'lo' : r > 0 ? 'hi' : 'no', restriction };
}
const base = basePath ? JSON.parse(fs.readFileSync(basePath, 'utf8')).queries : null;
const codeIn = (codes: string[], v: unknown, n: number) => { const s = String(v || ''); return codes.some((c) => (c.length < n ? s.startsWith(c) : s === c)); };
const cols = process.env.TEXT_COLS ? process.env.TEXT_COLS.split(',') : (OPEN_TEXT_COLS as readonly string[]);
const out: Row = { corpus: rows.length, text_cols: cols, queries: {} };
const frac = (xs: string[], R: Record<string, Rel>, ok: (r: Rel) => boolean) => xs.filter((k) => R[k] && ok(R[k])).length;

for (const [biz, cfg] of Object.entries<Row>(Q)) {
  cfg.q.forEach((q: string, qi: number) => {
    const plan: Row = buildDiscoveryPlan({ query: q } as Row as never, MCP_POLICY);
    const cap = interpretMarket(q, null).capability;
    const tn = openRetrievalNaics(cap), tp = openRetrievalPsc(cap);
    const vocab = (cap.direct.vocab || []).map((v) => jsRegex(phraseRegex(v.toLowerCase())));
    const vcols = cap.direct.vocabCols || ['title'];
    const m = plan.matcher;
    const matched = rows.filter((r) => codeIn(tn, r.naics_code, 6) || codeIn(tp, r.psc_code, 4)
      || vocab.some((re) => vcols.some((c) => re.test(String(r[c] || '')))) || matchesText(m, cols.map((c) => r[c])));
    const ids = matched.map((r) => String(r.notice_id));
    const idSet = new Set(ids);
    const win = [...matched].sort((a, b) => String(a.response_deadline || '9999').localeCompare(String(b.response_deadline || '9999'))
      || String(a.notice_id).localeCompare(String(b.notice_id))).slice(0, 500);
    const sc = new Map(rankRecords(plan as never, win, ['title', 'description', 'department']).map((s: Row) => [s.row, s]));
    const ranked = win.map((row, i) => ({ i, row, label: labelOpenRow(row, plan as never, cap, null), s: sc.get(row) as Row | undefined }))
      .sort((a, b) => a.label.tier - b.label.tier || (b.s?.breadth ?? 0) - (a.s?.breadth ?? 0) || (b.s?.score ?? 0) - (a.s?.score ?? 0) || a.i - b.i);
    const top20 = ranked.slice(0, 20).map((x) => String(x.row.notice_id));
    const R = rel[biz] || {};
    const relLo = Object.keys(R).filter((k) => R[k].v === 'lo'), relHi = Object.keys(R).filter((k) => R[k].v !== 'no');
    const floor = rows.filter((r) => codeIn(cfg.floor.naics, r.naics_code, 6) || codeIn(cfg.floor.psc, r.psc_code, 4)).map((r) => String(r.notice_id));
    const b = base?.[`${biz}#${qi}`];
    const bset = new Set<string>(b?.ids || []);
    const added = b ? ids.filter((k) => !bset.has(k)) : [];
    const removed = b ? (b.ids as string[]).filter((k) => !idSet.has(k)) : [];
    out.queries[`${biz}#${qi}`] = {
      q, matched: ids.length,
      cap: { kind: cap.kind, source: cap.direct.source, naics: cap.direct.naics, psc: cap.direct.psc, product_psc: cap.related_market?.psc || [], vocab: cap.direct.vocab || [] },
      matcher: { mode: m.mode, alts: (m.alternatives || []).map((a: Row) => ({ e: a.eligibility, eligible: a.eligible.map((c: Row) => c.label), pair: a.partnerRequired || [] })) },
      recall_lo: [relLo.filter((k) => idSet.has(k)).length, relLo.length],
      recall_hi: [relHi.filter((k) => idSet.has(k)).length, relHi.length],
      labelled_precision_hi: [frac(ids, R, (r) => r.v !== 'no'), frac(ids, R, () => true)],
      floor: [floor.filter((k) => idSet.has(k)).length, floor.length],
      top20: {
        relevant_lo: frac(top20, R, (r) => r.v === 'lo'), relevant_hi: frac(top20, R, (r) => r.v !== 'no'), labelled: frac(top20, R, () => true),
        n: top20.length, ids: top20, classes: ranked.slice(0, 20).map((x) => x.label.cls),
      },
      window_dropped: Math.max(0, ids.length - 500),
      vs_baseline: b ? {
        added: added.length, removed: removed.length,
        added_relevant_hi: frac(added, R, (r) => r.v !== 'no'), added_irrelevant_labelled: frac(added, R, (r) => r.v === 'no'),
        added_unlabelled: added.filter((k) => !R[k]).length,
        removed_relevant_hi: frac(removed, R, (r) => r.v !== 'no'),
        added_relevant_restricted: added.filter((k) => R[k] && R[k].v !== 'no' && R[k].restriction !== 'NONE').map((k) => R[k].restriction),
      } : null,
      ids,
    };
  });
}
fs.writeFileSync(outPath, JSON.stringify(out));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const f = (x: number[]) => `${x[0]}/${x[1]}`;
console.log(pad('query', 14), pad('matched', 8), pad('rel_lo', 7), pad('rel_hi', 7), pad('floor', 9), pad('top20 lo-hi/lab', 16), base ? '+added(rel/no/unlab) −removed(rel)' : '');
for (const [k, v] of Object.entries<Row>(out.queries)) {
  const d = v.vs_baseline;
  console.log(pad(k, 14), pad(v.matched, 8), pad(f(v.recall_lo), 7), pad(f(v.recall_hi), 7), pad(f(v.floor), 9),
    pad(`${v.top20.relevant_lo}-${v.top20.relevant_hi}/${v.top20.labelled}`, 16),
    d ? `+${d.added}(${d.added_relevant_hi}/${d.added_irrelevant_labelled}/${d.added_unlabelled}) −${d.removed}(${d.removed_relevant_hi})` : '');
}
