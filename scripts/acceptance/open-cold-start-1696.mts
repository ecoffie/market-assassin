/**
 * #1696 OPEN-COLD-START — live acceptance: N concurrent Maps Open requests against a deployment.
 *
 *   npx tsx scripts/acceptance/open-cold-start-1696.mts <base-url> [concurrency=4] [query="software license"]
 *
 * Before the fix, 4 concurrent Opens for "software license" returned 4/4 HTTP 500
 * "canceling statement due to statement timeout" at ~8.4 s (warm production) and ~10.7 s
 * (cold preview): each request ran the text regex twice and the 2-core DB crossed PostgREST's
 * 8 s authenticator statement_timeout. Run it against an IDLE preview for a genuine cold start.
 * Exits non-zero unless every request is HTTP 200 with success:true.
 */
const [base, nRaw, qRaw] = process.argv.slice(2);
if (!base) { console.error('usage: open-cold-start-1696.mts <base-url> [concurrency] [query]'); process.exit(2); }
const n = Number(nRaw) || 4;
const q = encodeURIComponent(qRaw || 'software license');
const results = await Promise.all(Array.from({ length: n }, async (_, i) => {
  const url = `${base.replace(/\/$/, '')}/api/app/opportunity-map?bbox=-125,24,${(-66 - i * 0.01).toFixed(2)},50&sources=sam&q=${q}`;
  const t = Date.now();
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return { i, status: res.status, ms: Date.now() - t, ok: res.status === 200 && body.success === true, total: body.totalForFilters, err: body.error };
}));
for (const r of results) console.log(`req${r.i} ${r.status} ${r.ms}ms ${r.ok ? `total=${r.total}` : `ERROR ${r.err}`}`);
const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `FAIL ${bad}/${n}` : `PASS ${n}/${n}`);
process.exit(bad ? 1 : 0);
