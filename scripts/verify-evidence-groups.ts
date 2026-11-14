/**
 * Live, READ-ONLY check for C2 evidence groups (src/lib/opportunities/evidence-groups.ts).
 * For each search, counts direct / related / other over the FULL matched set of the Map's canonical plan with Agent 1's
 * labelOpenRow and asserts direct + related + other === total. Reports the time each takes (the Map request path budget).
 *
 *   npx tsx scripts/verify-evidence-groups.ts ["query" ...]
 * Exits 1 if any search breaks the invariant. A search above EVIDENCE_TOTALS_MAX reports "not computed", never 0.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true } as never);
import { createClient } from '@supabase/supabase-js';
import { mapsOpenRequest, applyMapsOpenFilters } from '@/lib/opportunities/maps-open-discovery';
import { openEvidenceTotals, evidenceCapability, EVIDENCE_COLS } from '@/lib/opportunities/evidence-groups';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const DEFAULT = ['janitorial services', 'hvac maintenance', 'medical staffing', 'security guard services', 'construction', 'cyber cloud compliance network server'];
const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

(async () => {
  let broken = 0;
  for (const q of queries) {
    const req = mapsOpenRequest((k) => (k === 'q' ? q : null));
    const apply = (x: any) => applyMapsOpenFilters(x, req); // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = Date.now();
    const r = await openEvidenceTotals({
      count: () => apply(db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true })),
      page: () => apply(db.from('sam_opportunities').select(EVIDENCE_COLS)),
      plan: req.plan, cap: evidenceCapability(req.plan),
    });
    const ms = Date.now() - t;
    if (r.complete) {
      const ok = r.direct + r.related + r.other === r.total;
      if (!ok) broken++;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${q}: direct ${r.direct} + related ${r.related} + other ${r.other} = ${r.total} (${ms} ms)`);
    } else {
      console.log(`--   ${q}: not computed, total ${r.total ?? 'unknown'} (${r.reason}) (${ms} ms)`);
    }
  }
  if (broken) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
