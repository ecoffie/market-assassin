/**
 * Competition Depth — average bidders + single-bid rate for a buyer (the FPDS competition extract).
 *
 * The marquee Competition-Health metric a procurement director is graded on, and the number that
 * grounds the Institute's "under-served markets" thesis. Deferred until now because
 * `number_of_offers_received` is NULL on the `spending_by_award` SEARCH endpoint (documented in
 * usaspending-sync.ts). But the PER-AWARD DETAIL endpoint (`/api/v2/awards/<id>/`) DOES carry it.
 *
 * SO — no bulk download, no BigQuery, no schema migration, no touching the awards/pipeline tables:
 * sample a buyer's recent awards, fetch offers-received per award, compute avg + single-bid rate.
 * A ~60-award sample gives a statistically sound average; the result is CACHED (24h) so the
 * dashboard never re-hammers USASpending.
 *
 * HONESTY: awards with no offers field (IDVs, some SAP) are EXCLUDED from the denominator and
 * counted (`sampledWithData` vs `sampled`), never coerced to 0. If the sample is too small to be
 * meaningful, `grounded=false` — the dashboard shows the honest "not enough data", never a fake avg.
 */

import { withCache } from '@/lib/mcp/external-cache';

const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const AWARD_URL = (id: string) => `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(id)}/`;

// A buyer's dashboard uses the SAM long-form department name; USASpending's agency filter wants the
// toptier name. Map the common ones; fall back to a cleaned form for the rest.
const TOPTIER: Record<string, string> = {
  'VETERANS AFFAIRS, DEPARTMENT OF': 'Department of Veterans Affairs',
  'DEPT OF DEFENSE': 'Department of Defense',
  'HOMELAND SECURITY, DEPARTMENT OF': 'Department of Homeland Security',
  'HEALTH AND HUMAN SERVICES, DEPARTMENT OF': 'Department of Health and Human Services',
  'GENERAL SERVICES ADMINISTRATION': 'General Services Administration',
  'AGRICULTURE, DEPARTMENT OF': 'Department of Agriculture',
  'ENERGY, DEPARTMENT OF': 'Department of Energy',
  'JUSTICE, DEPARTMENT OF': 'Department of Justice',
  'INTERIOR, DEPARTMENT OF THE': 'Department of the Interior',
  'STATE, DEPARTMENT OF': 'Department of State',
  'TRANSPORTATION, DEPARTMENT OF': 'Department of Transportation',
  'TREASURY, DEPARTMENT OF THE': 'Department of the Treasury',
  'ENVIRONMENTAL PROTECTION AGENCY': 'Environmental Protection Agency',
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': 'National Aeronautics and Space Administration',
};
function toptierName(agency: string): string {
  const key = agency.trim().toUpperCase();
  if (TOPTIER[key]) return TOPTIER[key];
  // Fallback: "X, DEPARTMENT OF" -> "Department of X"; leave others as-is.
  const m = key.match(/^(.*),\s*DEPARTMENT OF( THE)?$/);
  if (m) return `Department of${m[2] ? ' the' : ''} ${m[1].split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`;
  return agency.trim();
}

export interface CompetitionDepth {
  agency: string;
  grounded: boolean;         // enough real offers data to report a meaningful number
  sampled: number;           // awards pulled
  sampledWithData: number;   // of those, how many carried a real offers count (denominator)
  avgBidders: number | null; // mean offers received (null when not grounded)
  medianBidders: number | null;
  singleBidCount: number;    // awards with ≤1 offer
  singleBidPct: number | null; // % single-bid — the "under-competed" signal
  note: string;
}

const MIN_SAMPLE = 12; // below this, the average isn't meaningful — say so, don't fake it.

/**
 * Compute competition depth for one agency. `sampleSize` awards are pulled (default 60 → ~40-50 with
 * offers data). CACHED 24h via the shared external cache. Best-effort: any fetch failure yields a
 * grounded=false result (never a fabricated average).
 */
export async function computeCompetitionDepth(agency: string, sampleSize = 60): Promise<CompetitionDepth> {
  const AG = agency.trim();
  const empty = (note: string): CompetitionDepth => ({
    agency: AG, grounded: false, sampled: 0, sampledWithData: 0,
    avgBidders: null, medianBidders: null, singleBidCount: 0, singleBidPct: null, note,
  });

  try {
    const { value } = await withCache<CompetitionDepth>(
      'fpds_competition_depth',
      { agency: AG, sampleSize },
      24 * 3600,
      async () => {
        // 1) recent awards for this agency (ids only)
        const sinceDays = 365;
        const start = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
        const searchRes = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: {
              award_type_codes: ['A', 'B', 'C', 'D'],
              agencies: [{ type: 'awarding', tier: 'toptier', name: toptierName(AG) }],
              time_period: [{ start_date: start, end_date: new Date().toISOString().slice(0, 10) }],
            },
            fields: ['Award ID'],
            limit: Math.min(Math.max(sampleSize, 20), 100),
            sort: 'Award ID',
          }),
        });
        if (!searchRes.ok) return empty(`USASpending search returned ${searchRes.status}`);
        const searchJson = await searchRes.json();
        const ids: string[] = (searchJson.results || []).map((r: { generated_internal_id?: string }) => r.generated_internal_id).filter(Boolean);
        if (ids.length === 0) return empty('No recent awards found for this agency.');

        // 2) offers-received per award, concurrency-limited (8 at a time)
        const offers: number[] = [];
        for (let i = 0; i < ids.length; i += 8) {
          const batch = ids.slice(i, i + 8);
          const res = await Promise.all(batch.map((id) =>
            fetch(AWARD_URL(id))
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                const n = d?.latest_transaction_contract_data?.number_of_offers_received;
                const v = n == null || n === '' ? null : Number(n);
                return v != null && isFinite(v) && v >= 0 ? v : null;
              })
              .catch(() => null),
          ));
          for (const v of res) if (v != null) offers.push(v);
        }

        const sampled = ids.length;
        const withData = offers.length;
        if (withData < MIN_SAMPLE) {
          // Not enough real offers data to report a meaningful average — say so, and PRESERVE the
          // real counts (`sampled`/`sampledWithData`) so the card can disclose "only N of M carried
          // offers", never a fabricated average.
          return {
            ...empty(`Only ${withData} of ${sampled} sampled awards carried an offers count — too few to report a meaningful average. (IDVs and some SAP awards don't record offers.)`),
            sampled,
            sampledWithData: withData,
          };
        }
        offers.sort((a, b) => a - b);
        const avg = Math.round((offers.reduce((s, x) => s + x, 0) / withData) * 10) / 10;
        const median = offers[Math.floor(withData / 2)];
        const single = offers.filter((x) => x <= 1).length;
        return {
          agency: AG,
          grounded: true,
          sampled,
          sampledWithData: withData,
          avgBidders: avg,
          medianBidders: median,
          singleBidCount: single,
          singleBidPct: Math.round((single / withData) * 1000) / 10,
          note: `Sampled ${withData} recent awards with an offers count (of ${sampled} pulled). IDVs/SAP awards without an offers field are excluded, not counted as zero.`,
        };
      },
    );
    return value;
  } catch (e) {
    return empty(`competition depth failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
