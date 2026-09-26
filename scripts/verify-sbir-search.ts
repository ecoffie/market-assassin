/**
 * Live, READ-ONLY oracle for search_sbir (NIH RePORTER + the two Supabase reads). No writes.
 *
 *   npx tsx scripts/verify-sbir-search.ts            # human output, exit 1 on any failure
 *   npx tsx scripts/verify-sbir-search.ts --json
 *
 * Asserts, per keyword (Reed Analytics' logged searches, 2026-09):
 *   1. no source ERRORS on a valid query (the multisite select named a column that does not exist
 *      from #158 until this fix — every multisite call failed, silently, for ~2.5 months);
 *   2. nothing in open_topics is an award, and every open topic has a close_date >= today;
 *   3. nothing in award_history carries a close_date (a project end is not a deadline);
 *   4. every requested source reports a status.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const KEYWORDS = ['cybersecurity', 'zero trust', 'data provenance', 'trustworthy AI', 'cross domain', 'cybersecurity, AI'];

(async () => {
  const { searchSbir } = await import('../src/lib/sbir/search');
  const today = new Date().toISOString().slice(0, 10);
  const failures: string[] = [];
  const rows: unknown[] = [];
  for (const keyword of KEYWORDS) {
    const r = await searchSbir({ keyword, source: 'all' });
    const errored = r.sources.filter((s) => s.status === 'error');
    if (errored.length) failures.push(`${keyword}: source error ${errored.map((s) => `${s.source} (${s.detail})`).join(', ')}`);
    if (r.sources.length !== 3) failures.push(`${keyword}: expected 3 source reports, got ${r.sources.length}`);
    for (const o of r.open_topics) {
      if (o.record_kind !== 'open_topic') failures.push(`${keyword}: non-topic in open_topics (${o.id})`);
      if (!o.close_date || o.close_date < today) failures.push(`${keyword}: open topic without a future close_date (${o.id})`);
    }
    for (const a of r.award_history) if (a.close_date) failures.push(`${keyword}: award carries a close_date (${a.id})`);
    rows.push({
      keyword,
      open_topics: r.open_topics.length,
      award_history: r.award_history.length,
      title_relevant_awards: r.award_history.filter((a) => a.relevance === 'title').length,
      open_topics_established: r.open_topics_established,
      sources: r.sources.map((s) => `${s.source}:${s.status}${s.detail ? ` (${s.detail})` : ''} ${s.ms}ms`),
    });
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: failures.length === 0, failures, rows }, null, 2));
  else {
    for (const r of rows) console.log(JSON.stringify(r));
    console.log(failures.length ? `\n✗ ${failures.length} failure(s):\n  ${failures.join('\n  ')}` : '\n✓ search_sbir live oracle passed');
  }
  process.exit(failures.length ? 1 : 0);
})();
