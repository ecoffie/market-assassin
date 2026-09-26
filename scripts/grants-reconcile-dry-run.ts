/**
 * READ-ONLY dry run of the grants_cache reconcile (tasks/grants-cache-reconcile-2026-09-26.md).
 * Writes NOTHING. Fetches the live Grants.gov listings exactly like ingestGrants does, applies the same
 * completeness rule + breaker, reads grants_cache, and reports what a real run WOULD mark absent —
 * optionally checking a sample against the official fetchOpportunity API (--confirm N).
 *
 *   npx tsx scripts/grants-reconcile-dry-run.ts [--confirm 12] [--json]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

(async () => {
  const { searchGrants } = await import('../src/lib/grants/search');
  const { GRANT_INGEST_STATUSES } = await import('../src/lib/grants/ingest');
  const { statusCompleteness, runIsComplete, classifySourceRecord, grantsGovIdFromUrl } = await import('../src/lib/grants/reconcile');
  const { createClient } = await import('@supabase/supabase-js');
  const args = process.argv.slice(2);
  const confirmN = Number(args[args.indexOf('--confirm') + 1]) || 0;
  const today = new Date().toISOString().slice(0, 10);

  const seen = new Set<string>();
  const seenIds = new Map<string, string>(); // Grants.gov opportunity id → number listed this run
  const completeness: Record<string, ReturnType<typeof statusCompleteness>> = {};
  for (const status of GRANT_INGEST_STATUSES) {
    const hitCounts: number[] = []; const unique = new Set<string>();
    let pages = 0, degraded = false, error: string | null = null, exhausted = false;
    for (let offset = 0; offset < 5000; offset += 100) {
      let res;
      try { res = await searchGrants({ status, limit: 100, offset }); } catch (e) { error = (e as Error).message; break; }
      if (res.degraded) { degraded = true; break; }
      pages++; hitCounts.push(res.total);
      for (const g of res.grants) if (g.oppNumber) { unique.add(g.oppNumber); seen.add(g.oppNumber); const gid = grantsGovIdFromUrl(g.url); if (gid) seenIds.set(gid, g.oppNumber); }
      if (res.grants.length < 100) { exhausted = true; break; }
    }
    completeness[status] = statusCompleteness({ status, hitCounts, pages, fetchedUnique: unique.size, degraded, error, capped: !exhausted && !degraded && !error });
  }
  const complete = runIsComplete(completeness);

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const rows: Array<{ opp_number: string; status: string; close_date: string | null; url: string | null; map_lat: number | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('grants_cache').select('opp_number, status, close_date, url, map_lat').order('opp_number').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const actionable = (r: (typeof rows)[number]) => r.status === 'forecasted' || !r.close_date || r.close_date >= today;
  const tracked = rows.filter((r) => r.status === 'posted' || r.status === 'forecasted');
  const wouldAbsent = tracked.filter((r) => !seen.has(r.opp_number));
  const wouldAbsentActionable = wouldAbsent.filter(actionable);
  const wouldAbsentOnMap = wouldAbsentActionable.filter((r) => r.map_lat != null);
  // New rule (2026-09-26): absence never hides. A would-be-absent row whose Grants.gov id is listed under a
  // NEW number is a SUPERSEDED duplicate (hidden; the grant stays visible once via its current row). Every
  // other would-be-absent row stays VISIBLE as absent/unverified until an official lookup says closed/archived.
  const supersededBy = new Map<string, string>();
  for (const r of wouldAbsentActionable) { const gid = grantsGovIdFromUrl(r.url); const cur = gid ? seenIds.get(gid) : undefined; if (cur && cur !== r.opp_number) supersededBy.set(r.opp_number, cur); }
  const absentUnverified = wouldAbsentActionable.filter((r) => !supersededBy.has(r.opp_number));
  const actionableBefore = tracked.filter(actionable).length;
  const breakerTrips = wouldAbsentActionable.length > 0.2 * actionableBefore;

  const sample: Array<{ opp: string; source: string | null }> = [];
  // Official lookups only for the absent/unverified rows (a superseded duplicate needs none).
  for (const r of absentUnverified.slice(0, confirmN)) {
    const id = Number(String(r.url || '').match(/(\d+)\s*$/)?.[1]);
    let source: string | null = null;
    try {
      const res = await fetch('https://api.grants.gov/v1/api/fetchOpportunity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opportunityId: id }), signal: AbortSignal.timeout(10_000) });
      source = classifySourceRecord(res.status, await res.json().catch(() => null), today);
    } catch { source = null; }
    sample.push({ opp: r.opp_number, source });
  }

  const out = {
    measuredAt: new Date().toISOString(), complete, completeness,
    cache: { rows: rows.length, tracked: tracked.length, actionableBefore },
    wouldMarkAbsent: wouldAbsent.length, wouldMarkAbsentActionable: wouldAbsentActionable.length, wouldMarkAbsentOnMap: wouldAbsentOnMap.length,
    breaker: { fraction: 0.2, trips: breakerTrips },
    reconcileWouldRun: complete && !breakerTrips,
    // New rule: what the MAP would do right after one run, and after the lookups (--confirm N) resolve.
    identity: { supersededDuplicatesHidden: supersededBy.size, examples: [...supersededBy].slice(0, 5).map(([a, b]) => `${a}→${b}`) },
    afterRun: { hidden: supersededBy.size, hiddenReason: 'superseded duplicates only', visibleAbsentUnverified: absentUnverified.length },
    confirmationSample: sample,
    afterLookupsOfSample: sample.length ? {
      checked: sample.length,
      wouldHide_confirmedClosedOrArchived: sample.filter((x) => x.source === 'closed' || x.source === 'archived').length,
      staysVisible_confirmedLive: sample.filter((x) => x.source === 'posted' || x.source === 'forecast').length,
      staysVisible_notFoundAmbiguous: sample.filter((x) => x.source === 'not_found').length,
      staysVisible_lookupFailed: sample.filter((x) => x.source == null).length,
    } : null,
  };
  console.log(args.includes('--json') ? JSON.stringify(out, null, 2) : JSON.stringify(out));
})();
