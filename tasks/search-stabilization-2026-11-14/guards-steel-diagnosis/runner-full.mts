// Headless search runner for the independent holdout (Agent 3, 2026-11-15; requested by Agent 4 via Agent 5).
//
// It runs the search code AS FROZEN AT A TAG against a snapshot of open SAM notices, and emits, per phrasing, the matched
// set and the top 20. The runner itself contains no ranking logic: every decision is imported from the --src checkout,
// so RC1, RC2 and any later tag are judged by their own code.
//
//   run   (offline, read-only): snapshot file + cutoff + phrasings  ->  JSON on stdout or --out
//   dump  (read-only DB select): writes a snapshot file of notices open at the cutoff (needs Supabase env; no writes)
//   verify (offline): compares a run output with a published matched-sets file (acceptance checks a and b)
//
// Emulation (identical to tasks/search-stabilization-2026-11-14/harness/eval.mts, which produced the published sets):
//   matched = code recall (openRetrievalNaics/Psc) OR preset vocabulary (exact phrase over cap.direct.vocabCols)
//             OR the discovery text matcher over OPEN_TEXT_COLS
//   window  = first 500 matched by response_deadline ascending, ties by notice_id
//   top 20  = window labelled by labelOpenRow, sorted tier -> breadth -> score -> window position,
//             then demoteDuplicateVersions when the tag has it (RC3+)
//
// Usage (run from INSIDE the tag checkout so its tsconfig "@/..." paths resolve):
//   cd <tag checkout> && npx tsx <path>/runner.mts run --src . --snapshot <corpus.json[.gz]> \
//       --phrasings <queries_v4.json> --cutoff 2026-12-12T00:00:00Z [--out result.json]
//   npx tsx <path>/runner.mts verify --result result.json --expected matched-sets-rc2-classification.json --key rc2
//   cd <any checkout with node_modules> && npx tsx <path>/runner.mts dump --cutoff <ISO> --out corpus.json   (read-only)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const RUNNER_VERSION = '1.1.0';
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function args(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2); const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}
const die = (m: string): never => { console.error(`runner: ${m}`); process.exit(2); };
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const iso = (s: string) => { const d = new Date(s); if (isNaN(d.getTime())) die(`bad date: ${s}`); return d.toISOString(); };

/** Stable JSON: object keys sorted recursively, so two runs are byte-identical. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Row)[k])]));
  return v;
}

function git(src: string, ...a: string[]) {
  try { return execFileSync('git', ['-C', src, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

/** Notices open at the cutoff: posted (and created, when the column exists) at or before it, deadline after it. */
function openAt(r: Row, cutoff: string) {
  if (r.active === false) return false;
  if (!r.response_deadline || iso(String(r.response_deadline)) <= cutoff) return false;
  if (r.posted_date && iso(String(r.posted_date)) > cutoff) return false;
  if (r.created_at && iso(String(r.created_at)) > cutoff) return false;
  return true;
}

/** Phrasings: { biz: { q: [..] } } (queries_v4.json) or [{ business, phrasing, query }]. */
function loadPhrasings(p: string): Array<{ business: string; phrasing: number; query: string }> {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(j)) return j.map((x: Row) => ({ business: String(x.business), phrasing: Number(x.phrasing), query: String(x.query) }));
  return Object.entries<Row>(j).flatMap(([business, cfg]) => (cfg.q as string[]).map((query, phrasing) => ({ business, phrasing, query })));
}

async function run(o: Record<string, string | boolean>) {
  const src = path.resolve(String(o.src || die('--src <tag checkout> required')));
  const snapPath = String(o.snapshot || die('--snapshot <file> required'));
  const phrasingsPath = String(o.phrasings || die('--phrasings <file> required'));
  const cutoff = iso(String(o.cutoff || die('--cutoff <ISO timestamp> required')));
  const today = o.today ? String(o.today) : cutoff.slice(0, 10);

  // Offline guarantee: any network call from imported code fails loudly instead of silently reaching a database.
  globalThis.fetch = (() => { throw new Error('runner is offline: network access attempted'); }) as typeof fetch;

  const commit = git(src, 'rev-parse', 'HEAD') || die(`not a git checkout: ${src}`);
  const dirty = (git(src, 'status', '--porcelain', '--untracked-files=no') || '') !== '';
  if (dirty && !o['allow-dirty']) die(`checkout ${src} has uncommitted changes; results would not be the tag's code (use --allow-dirty to override)`);
  const tags = (git(src, 'tag', '--points-at', 'HEAD') || '').split('\n').filter(Boolean).sort();

  const raw = fs.readFileSync(snapPath);
  const text = snapPath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const snap = JSON.parse(text) as { snapshot_at?: string; rows: Row[] };
  const rows = snap.rows.filter((r) => openAt(r, cutoff)).sort((a, b) => String(a.notice_id).localeCompare(String(b.notice_id)));

  const L = (f: string) => import(path.join(src, f));
  const [planM, policyM, matcherM, rankM, interpM, relM, findM] = await Promise.all([
    L('src/lib/discovery/plan.ts'), L('src/lib/discovery/policy.ts'), L('src/lib/discovery/matcher.ts'), L('src/lib/discovery/rank.ts'),
    L('src/lib/opportunities/market-interpretation.ts'), L('src/lib/opportunities/open-relevance.ts'), L('src/lib/opportunities/find-opportunities.ts'),
  ]);
  const { buildDiscoveryPlan, OPEN_TEXT_COLS } = planM; const { MCP_POLICY } = policyM;
  const { matchesText, phraseRegex, jsRegex } = matcherM; const { rankRecords } = rankM;
  const { interpretMarket } = interpM; const { openRetrievalNaics, openRetrievalPsc, openCodeWindowPsc, openCodeWindowNaics, OPEN_CODE_WINDOW_CAP } = relM;
  const { labelOpenRow, demoteDuplicateVersions } = findM;
  const fy = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 10 ? 1 : 0);
  const ctx = { today, fiscalYear: fy };
  const cols = OPEN_TEXT_COLS as string[];
  const codeIn = (codes: string[], v: unknown, n: number) => { const s = String(v || ''); return codes.some((c) => (c.length < n ? s.startsWith(c) : s === c)); };

  const results = loadPhrasings(phrasingsPath).map(({ business, phrasing, query }) => {
    const plan = buildDiscoveryPlan({ query }, MCP_POLICY, ctx);
    const cap = interpretMarket(query, null).capability;
    const tn: string[] = openRetrievalNaics(cap), tp: string[] = openRetrievalPsc(cap);
    const vocab = ((cap.direct.vocab || []) as string[]).map((v) => jsRegex(phraseRegex(v.toLowerCase())));
    const vcols: string[] = cap.direct.vocabCols || ['title'];
    const matched = rows.filter((r) => codeIn(tn, r.naics_code, 6) || codeIn(tp, r.psc_code, 4)
      || vocab.some((re: RegExp) => vcols.some((c) => re.test(String(r[c] || '')))) || matchesText(plan.matcher, cols.map((c) => r[c])));
    const byDeadline = (a: Row, b: Row) => String(a.response_deadline || '9999').localeCompare(String(b.response_deadline || '9999'))
      || String(a.notice_id).localeCompare(String(b.notice_id));
    const win = [...matched].sort(byDeadline).slice(0, 500);
    // Tags that export openCodeWindowPsc (code-recall sub-window, 2026-11-15) append the product preset's own coded
    // notices, deadline-ordered and capped, when the deadline window is full — exactly as queryOpenNow does.
    let codeWindowIds: string[] = [];
    if (typeof openCodeWindowPsc === 'function' && win.length >= 500) {
      const codes = new Set<string>(openCodeWindowPsc(cap));
      if (codes.size) {
        const inWin = new Set(win.map((r) => r.notice_id));
        const extra = matched.filter((r) => codes.has(String(r.psc_code || ''))).sort(byDeadline).slice(0, OPEN_CODE_WINDOW_CAP).filter((r) => !inWin.has(r.notice_id));
        win.push(...extra); codeWindowIds = extra.map((r) => String(r.notice_id));
      }
    }
    // Diagnosis emulation of CANDIDATE F1 (NAICS sub-window), when the src exports it.
    if (typeof openCodeWindowNaics === 'function' && win.length >= 500) {
      const nc = new Set<string>(openCodeWindowNaics(cap));
      if (nc.size) {
        const inWin = new Set(win.map((r) => r.notice_id));
        const extra = matched.filter((r) => nc.has(String(r.naics_code || ''))).sort(byDeadline).slice(0, OPEN_CODE_WINDOW_CAP).filter((r) => !inWin.has(r.notice_id));
        win.push(...extra); codeWindowIds = [...codeWindowIds, ...extra.map((r) => String(r.notice_id))];
      }
    }
    const sc = new Map(rankRecords(plan, win, ['title', 'description', 'department']).map((s: Row) => [s.row, s]));
    let ranked = win.map((row, i) => ({ i, row, label: labelOpenRow(row, plan, cap, null), s: sc.get(row) as Row | undefined }))
      .sort((a, b) => a.label.tier - b.label.tier || (b.s?.breadth ?? 0) - (a.s?.breadth ?? 0) || (b.s?.score ?? 0) - (a.s?.score ?? 0) || a.i - b.i);
    if (typeof demoteDuplicateVersions === 'function') ranked = demoteDuplicateVersions(ranked, (x: Row) => x.row);
    return {
      business, phrasing, query,
      interpretation: { kind: cap.kind ?? null, source: cap.direct.source ?? null, retrieval_naics: tn, retrieval_psc: tp },
      matched_count: matched.length,
      matched: matched.map((r) => String(r.notice_id)).sort(),
      window_count: win.length,
      code_window_ids: codeWindowIds,
      full: process.env.RUNNER_FULL ? ranked.map((x, k) => ({ rank: k + 1, notice_id: String(x.row.notice_id), cls: x.label.cls, tier: x.label.tier, basis: x.label.basis ?? [], breadth: x.s?.breadth ?? null, score: x.s?.score ?? null })) : undefined,
      top20: ranked.slice(0, 20).map((x, k) => ({ rank: k + 1, notice_id: String(x.row.notice_id), cls: x.label.cls, tier: x.label.tier, basis: x.label.basis ?? [] })),
    };
  });

  const out = stable({
    runner: { name: 'mindy-search-holdout-runner', version: RUNNER_VERSION, emulation: 'eval.mts FIND Open (500 by deadline, ties by notice_id; + code-recall sub-window when the tag has it; tier>breadth>score>position)' },
    src: { commit, tags, dirty },
    snapshot: {
      file: path.basename(snapPath), file_sha256: sha256(raw), snapshot_at: snap.snapshot_at ?? null,
      cutoff, rows_in_file: snap.rows.length, rows_open_at_cutoff: rows.length,
      open_ids_sha256: sha256(rows.map((r) => r.notice_id).join('\n')),
    },
    context: { today, fiscal_year: fy, policy: 'MCP_POLICY', text_cols: cols },
    phrasings: { file: path.basename(phrasingsPath), file_sha256: sha256(fs.readFileSync(phrasingsPath)) },
    results,
  });
  const json = JSON.stringify(out, null, 1) + '\n';
  if (o.out) fs.writeFileSync(String(o.out), json); else process.stdout.write(json);
  console.error(`runner: src ${commit.slice(0, 9)}${tags.length ? ' (' + tags.join(',') + ')' : ''} · ${rows.length} open at ${cutoff} · ${results.length} phrasings · output sha256 ${sha256(json).slice(0, 16)}`);
}

/** Acceptance checks (a) matched sets identical and (b) top 20 identical in order, against a published matched-sets file. */
function verify(o: Record<string, string | boolean>) {
  const res = JSON.parse(fs.readFileSync(String(o.result || die('--result required')), 'utf8'));
  const exp = JSON.parse(fs.readFileSync(String(o.expected || die('--expected required')), 'utf8'));
  const key = String(o.key || die('--key <rc1|rc2|...> required'));
  const E = new Map<string, Row>(Object.values<Row>(exp.queries).map((q) => [`${q.business}#${q.phrasing}`, q]));
  let fail = 0;
  for (const r of res.results as Row[]) {
    const e = E.get(`${r.business}#${r.phrasing}`);
    if (!e || !e[key]) { console.log(`MISSING ${r.business}#${r.phrasing}`); fail++; continue; }
    const em = [...e[key]].sort(); const sameM = em.length === r.matched.length && em.every((x: string, i: number) => x === r.matched[i]);
    const et = e[`${key}_top20`] as string[] | undefined; const rt = (r.top20 as Row[]).map((x) => x.notice_id);
    const sameT = !et ? null : et.length === rt.length && et.every((x, i) => x === rt[i]);
    if (!sameM || sameT === false) fail++;
    console.log(`${(r.business + '#' + r.phrasing).padEnd(14)} matched ${sameM ? 'SAME' : `DIFF (${em.length} vs ${r.matched.length})`}  top20 ${sameT === null ? 'n/a' : sameT ? 'SAME' : 'DIFF'}`);
  }
  console.log(fail ? `FAIL: ${fail} phrasing(s) differ` : `PASS: ${res.results.length} phrasings identical`);
  process.exit(fail ? 1 : 0);
}

/** Read-only snapshot of notices open at the cutoff. SELECT only; never writes. */
async function dump(o: Record<string, string | boolean>) {
  const cutoff = iso(String(o.cutoff || die('--cutoff <ISO> required')));
  const outPath = String(o.out || die('--out required'));
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || die('NEXT_PUBLIC_SUPABASE_URL not set');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || die('SUPABASE_SERVICE_ROLE_KEY not set');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const COLS = 'notice_id,title,description,sow_text,department,sub_tier,solicitation_number,naics_code,psc_code,notice_type,response_deadline,posted_date,created_at,active';
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('sam_opportunities').select(COLS).eq('active', true).gt('response_deadline', cutoff)
      .order('notice_id').range(from, from + 999);
    if (error) die(`select failed: ${error.message}`);
    rows.push(...(data as Row[]));
    if ((data as Row[]).length < 1000) break;
  }
  const { count, error: cErr } = await sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', cutoff);
  if (cErr || count == null) die(`count failed: ${cErr?.message ?? 'null count'}`);
  if (count !== rows.length) die(`incomplete snapshot: read ${rows.length} of ${count} rows (table changed during the read?) — rerun`);
  fs.writeFileSync(outPath, JSON.stringify({ snapshot_at: new Date().toISOString(), cutoff, rows }));
  console.error(`runner dump: ${rows.length} rows open at ${cutoff} -> ${path.basename(outPath)}`);
}

const [mode, ...rest] = process.argv.slice(2);
const o = args(rest);
if (mode === 'run') await run(o);
else if (mode === 'verify') verify(o);
else if (mode === 'dump') await dump(o);
else die('usage: runner.mts <run|verify|dump> ... (see header)');
