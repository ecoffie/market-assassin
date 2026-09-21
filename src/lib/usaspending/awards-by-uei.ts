/**
 * Fetch a contractor's real contract awards (past performance) from USASpending
 * by UEI. Shared by vault/prefill (the "accept" flow) AND the capability-vector
 * builder (which uses these award scopes to build a hidden-match vector for any
 * UEI user — no Vault "accept" required). Extracted to a lib so both reuse one
 * implementation (CLAUDE.md rule #7).
 *
 * Live REST (not the cached usaspending_awards table) so a fresh UEI works the
 * first time. recipient_search_text is FUZZY, so we hard-filter on exact UEI.
 */

export interface UeiAwardRow {
  award_id: string;
  contract_title: string;
  agency: string | null;
  sub_agency: string | null;
  contract_number: string | null;
  period_start: string | null;
  period_end: string | null;
  contract_value: number | null;
  scope_description: string | null;
  naics: string | null;
  naics_description: string | null;
  psc: string | null;
}

export async function fetchUSASpendingAwardsByUei(uei: string, limit = 25): Promise<UeiAwardRow[]> {
  const cleanUei = (uei || '').trim();
  if (!cleanUei) return [];
  try {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          recipient_search_text: [cleanUei],
          // Contract awards only (no IDVs — umbrellas, not individual past perf).
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: '2018-10-01', end_date: '2026-09-30' }],
        },
        fields: [
          'Award ID', 'Recipient Name', 'Recipient UEI', 'Award Amount', 'Description',
          'Start Date', 'End Date', 'Awarding Agency', 'Awarding Sub Agency',
          'NAICS Code', 'NAICS', 'PSC Code', 'Last Modified Date',
        ],
        page: 1,
        limit,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!res.ok) {
      console.warn(`[awards-by-uei] USASpending ${res.status}`);
      return [];
    }
    const data = await res.json();
    const results = (data?.results || []) as Record<string, unknown>[];

    // recipient_search_text is fuzzy — hard-filter to the exact UEI.
    return results
      .filter((r) => String(r['Recipient UEI'] || '').toUpperCase() === cleanUei.toUpperCase())
      .map((r) => ({
        award_id: String(r['Award ID'] || ''),
        contract_title: String(r['Description'] || r['Award ID'] || '').slice(0, 200),
        agency: (r['Awarding Agency'] as string) || null,
        sub_agency: (r['Awarding Sub Agency'] as string) || null,
        contract_number: (r['Award ID'] as string) || null,
        period_start: (r['Start Date'] as string) || null,
        period_end: (r['End Date'] as string) || null,
        contract_value: Number(r['Award Amount']) || null,
        scope_description: r['Description'] ? String(r['Description']).slice(0, 1000) : null,
        naics: (r['NAICS Code'] as string) || (r['NAICS'] as string) || null,
        naics_description: null,
        psc: (r['PSC Code'] as string) || null,
      }));
  } catch (err) {
    console.warn('[awards-by-uei] fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
