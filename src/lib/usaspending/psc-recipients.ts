/**
 * Top federal recipients of a set of PSC codes — the REAL performers of a
 * "what was bought" market, straight from USASpending's recipient category.
 *
 * FM-U10 (Eric/QA 2026-07-29): capability_market_match anchored a term-of-art
 * capability (EOD tools, pinned to PSC 1385/1386) to a NAICS, then pulled
 * "competitors" from that NAICS via BigQuery. But the pinned-PSC market's
 * biggest product NAICS (334511 detection/instruments) is far broader than the
 * capability — so the "competitors" came back as radar/instrument primes
 * (Raytheon / Lockheed / Northrop), NOT EOD-tool peers. The tight, honest signal
 * is the PSC itself: the actual recipients of PSC 1385/1386 are VideoRay,
 * Tomahawk Robotics, Foster-Miller (TALON), Vidisco — real EOD-equipment makers.
 *
 * This queries `spending_by_category/recipient` filtered by the pinned PSCs
 * (award types A/B/C/D, the canonical 3-FY window) and shapes the result like a
 * RecipientSearchRow so it drops into the same competitors slot. Real dollars,
 * never invented; degrades to [] on any error (never fabricates a peer).
 */
import { MARKET_SPEND_WINDOW } from '@/lib/utils/usaspending-helpers';
import { withCache } from '@/lib/mcp/external-cache';
import type { RecipientSearchRow } from '@/lib/bigquery/recipients';

const BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

interface UsaspendingRecipientRow {
  code?: string | null;
  name?: string;
  amount?: number;
  recipient_id?: string | null;
}

/**
 * Top recipients of the given PSC codes, shaped as RecipientSearchRow so a
 * caller can use them anywhere a contractor list is expected. The USASpending
 * recipient category gives name + obligated $; award_count / agency / NAICS
 * breadth are NOT available from this endpoint, so they ship as 0 (honest —
 * not fabricated, and the consumer treats 0 as "not measured here").
 */
export async function topRecipientsByPsc(
  pscCodes: string[],
  limit = 10,
): Promise<RecipientSearchRow[]> {
  const codes = (pscCodes || []).map((c) => String(c).trim()).filter(Boolean);
  if (!codes.length) return [];

  try {
    const { value } = await withCache(
      'usaspending_psc_recipients',
      { psc: codes.slice().sort(), limit },
      12 * 60 * 60, // 12h — award recipients move slowly
      async () => {
        const res = await fetch(`${BASE}/recipient`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'recipient',
            filters: {
              psc_codes: codes,
              time_period: [MARKET_SPEND_WINDOW],
              award_type_codes: ['A', 'B', 'C', 'D'],
            },
            limit: Math.min(Math.max(limit, 1), 100),
          }),
        });
        if (!res.ok) throw new Error(`USASpending PSC recipients ${res.status}`);
        const j = (await res.json()) as { results?: UsaspendingRecipientRow[] };
        return (j.results || [])
          .filter((r) => r.name && (r.amount || 0) > 0)
          .map((r) => ({
            recipient_uei: r.recipient_id ? String(r.recipient_id) : '',
            recipient_name: String(r.name),
            city: null,
            state: null,
            total_obligated: Number(r.amount || 0),
            award_count: 0,
            distinct_agency_count: 0,
            distinct_naics_count: 0,
          })) as RecipientSearchRow[];
      },
    );
    return value.slice(0, limit);
  } catch (err) {
    console.error('[topRecipientsByPsc] failed:', err);
    return [];
  }
}
