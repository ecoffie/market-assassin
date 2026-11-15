// Read-only retrieval evaluator (Agent 3, 2026-11-14). Offline: no DB, no network.
// Emulates FIND Open retrieval exactly as Agent 4's harness_r4 does: code recall (cap.direct/related) OR the
// discovery text matcher over title/description/sow_text/department/solicitation_number. Scores against Agent 4's
// blind v4 labels (relevant = FIT or PARTIAL; lo = both reviewers, hi = either) and the trade code floor.
// usage: tsx eval.mts <corpus.json> <bench dir> <out.json>
import fs from 'fs';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { matchesText } from '@/lib/discovery/matcher';
import { interpretMarket } from '@/lib/opportunities/market-interpretation';
import { openRetrievalNaics, openRetrievalPsc } from '@/lib/opportunities/open-relevance';
import { OPEN_TEXT_COLS } from '@/lib/discovery/plan';

const [corpusPath, benchDir, outPath] = process.argv.slice(2);
const { rows } = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const Q = JSON.parse(fs.readFileSync(`${benchDir}/queries_v4.json`, 'utf8'));
const meta: Array<{ id: string; biz: string; notice_id: string }> = JSON.parse(fs.readFileSync(`${benchDir}/labels/r4_meta.json`, 'utf8'));
const byLab: Record<string, string[]> = {};
for (const f of fs.readdirSync(`${benchDir}/labels`).filter((f) => f.endsWith('.jsonl'))) {
  for (const l of fs.readFileSync(`${benchDir}/labels/${f}`, 'utf8').split('\n').filter(Boolean)) {
    const j = JSON.parse(l); (byLab[j.id] ||= []).push(j.label);
  }
}
const rel: Record<string, Record<string, 'lo' | 'hi' | 'no'>> = {};
for (const m of meta) {
  const ls = byLab[m.id] || []; if (!ls.length) continue;
  const r = ls.filter((x) => x === 'FIT' || x === 'PARTIAL').length;
  (rel[m.biz] ||= {})[m.notice_id] = r === ls.length ? 'lo' : r > 0 ? 'hi' : 'no';
}
const codeIn = (codes: string[], v: unknown, n: number) => { const s = String(v || ''); return codes.some((c) => (c.length < n ? s.startsWith(c) : s === c)); };
const cols = process.env.TEXT_COLS ? process.env.TEXT_COLS.split(",") : (OPEN_TEXT_COLS as readonly string[]);
const out: any = { corpus: rows.length, text_cols: cols, queries: {} };
for (const [biz, cfg] of Object.entries<any>(Q)) {
  cfg.q.forEach((q: string, qi: number) => {
    const plan: any = buildDiscoveryPlan({ query: q } as any, MCP_POLICY);
    const cap = interpretMarket(q, null).capability;
    const tn = openRetrievalNaics(cap), tp = openRetrievalPsc(cap);
    const m = plan.matcher;
    const matched = rows.filter((r: any) => codeIn(tn, r.naics_code, 6) || codeIn(tp, r.psc_code, 4) || matchesText(m, cols.map((c) => r[c])));
    const ids = new Set(matched.map((r: any) => String(r.notice_id)));
    const R = rel[biz] || {};
    const relLo = Object.keys(R).filter((k) => R[k] === 'lo'), relHi = Object.keys(R).filter((k) => R[k] !== 'no');
    const labelledMatched = Object.keys(R).filter((k) => ids.has(k));
    const floor = rows.filter((r: any) => codeIn(cfg.floor.naics, r.naics_code, 6) || codeIn(cfg.floor.psc, r.psc_code, 4)).map((r: any) => String(r.notice_id));
    out.queries[`${biz}#${qi}`] = {
      q, matched: ids.size,
      matcher: { mode: m.mode, alts: (m.alternatives || []).map((a: any) => ({ e: a.eligibility, eligible: a.eligible.map((c: any) => c.label), rankOnly: a.rankOnly.map((c: any) => c.label), pair: a.partnerRequired || [] })) },
      codes: { naics: tn, psc: tp },
      recall_lo: [relLo.filter((k) => ids.has(k)).length, relLo.length],
      recall_hi: [relHi.filter((k) => ids.has(k)).length, relHi.length],
      labelled_precision_hi: [labelledMatched.filter((k) => R[k] !== 'no').length, labelledMatched.length],
      floor: [floor.filter((k) => ids.has(k)).length, floor.length],
      ids: [...ids],
    };
  });
}
fs.writeFileSync(outPath, JSON.stringify(out));
const pad = (s: any, n: number) => String(s).padEnd(n);
console.log(pad('query', 14), pad('matched', 8), pad('recall_lo', 10), pad('recall_hi', 10), pad('lab_prec', 9), pad('floor', 10), 'matcher');
for (const [k, v] of Object.entries<any>(out.queries)) {
  const f = (x: number[]) => `${x[0]}/${x[1]}`;
  console.log(pad(k, 14), pad(v.matched, 8), pad(f(v.recall_lo), 10), pad(f(v.recall_hi), 10), pad(f(v.labelled_precision_hi), 9), pad(f(v.floor), 10),
    v.matcher.alts.map((a: any) => `${a.e.toUpperCase()}(${a.eligible.join('·')})${a.pair.length ? ` pair[${a.pair.join('·')}]` : ''}`).join(' | ') + (v.codes.naics.length + v.codes.psc.length ? ` +codes` : ''));
}
