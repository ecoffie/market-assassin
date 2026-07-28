/**
 * Follow-on capture (Eric 2026-07-27, the NRWA case).
 *
 * The recompete sync only ingests contracts expiring within ~18 months, so a freshly-awarded LONG
 * follow-on (a 5-yr award ending years out) never enters the table — while its expired predecessor
 * lingered (now pruned). Result: when a tracked contract recompetes, the winner vanishes from view.
 *
 * This finds that follow-on the ONLY safe way: anchored on the recipient's exact **UEI**. A prior
 * hand-analysis proved that phrase/title matching returns confident GARBAGE — "technical assistance"
 * matched NRWA to Radiance Technologies' missile-defense SETA and to a Navy contractor "Group W".
 * UEI is an exact identity, so `recipient_uei = X AND naics = Y AND a LATER award` cannot drift to an
 * unrelated company. Verified live: from 12SAD121C0001 (NRWA, UEI FHNNYNLC22N3, NAICS 541611, expired
 * 2026-04-30) this returns exactly 12RADA26C0001 (NRWA, 2026-05-01→2030-12-31, $14.58M) — the real
 * follow-on, nothing else.
 *
 * STRICT, no-guess contract (skip → null rather than ingest a wrong row):
 *   - no UEI on the parent            → null (can't anchor safely)
 *   - zero later awards to that UEI+NAICS → null (honest: not recompeted yet, or a different vehicle)
 *   - the ONLY match is the parent's own PIID → null (that's the same award, not a follow-on)
 * A follow-on's PoP end must also be AFTER the parent's (a genuine successor, not an older award).
 */
import type { SyncedContract } from './usaspending-sync';

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

export interface FollowOnParent {
  piid: string;
  incumbent_uei: string | null;
  naics_code: string | null;
  awarding_agency: string | null;
  period_of_performance_current_end: string | null; // the parent's expiry (the "after" anchor)
}

export interface FindFollowOnOptions {
  fetchImpl?: typeof fetch;
  nowIso?: string; // injectable for tests; defaults to new Date().toISOString()
}

type AwardRow = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const num = (v: unknown): number => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Look up the already-awarded follow-on for an expired recompete contract. Returns a
 * SyncedContract ready to upsert (stamped with predecessor provenance), or null when there is no
 * safe, unambiguous match. NEVER throws — a lookup failure returns null (the caller just skips).
 */
export async function findFollowOnAward(
  parent: FollowOnParent,
  opts: FindFollowOnOptions = {},
): Promise<(SyncedContract & { predecessor_piid: string; followon_captured_at: string }) | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const uei = str(parent.incumbent_uei);
  const naics = str(parent.naics_code);
  const parentEnd = str(parent.period_of_performance_current_end);
  // UEI + NAICS are the anchor; without a UEI we refuse to guess (that's the garbage path).
  if (!uei || !naics) return null;

  // New awards to this exact recipient in this NAICS, starting on/after the parent's expiry window.
  // Bound the window from ~6 months BEFORE the parent's end (agencies often award the follow-on
  // shortly before expiry, with a small gap or overlap) through ~5 years out.
  const startWindow = shiftMonths(parentEnd || (opts.nowIso ?? new Date().toISOString()).slice(0, 10), -6);
  const endWindow = shiftMonths((opts.nowIso ?? new Date().toISOString()).slice(0, 10), 60);

  const body = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      recipient_search_text: [uei], // UEI — exact identity, the anti-garbage anchor
      naics_codes: [naics],
      time_period: [{ start_date: startWindow, end_date: endWindow, date_type: 'new_awards_only' }],
    },
    fields: [
      'Award ID', 'Recipient Name', 'recipient_id', 'Start Date', 'End Date', 'Award Amount',
      'Awarding Agency', 'Awarding Sub Agency', 'NAICS', 'generated_internal_id', 'Contract Award Type',
    ],
    sort: 'Start Date',
    order: 'desc',
    limit: 25,
    page: 1,
  };

  let rows: AwardRow[];
  try {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: AwardRow[] };
    rows = Array.isArray(j.results) ? j.results : [];
  } catch {
    return null; // fetch/JSON failure → skip, never throw into the cron
  }

  // Keep only genuine SUCCESSORS: a different PIID than the parent AND an end date after the parent's.
  const candidates = rows.filter((r) => {
    const piid = str(r['Award ID']);
    const end = str(r['End Date']);
    if (!piid || piid === parent.piid) return false;             // same award ≠ a follow-on
    if (parentEnd && end && end <= parentEnd) return false;       // must extend beyond the parent
    return true;
  });
  if (candidates.length === 0) return null;

  // Prefer the one with the LATEST start date (the freshest successor). Ties are rare; take the first.
  candidates.sort((a, b) => str(b['Start Date']).localeCompare(str(a['Start Date'])));
  const w = candidates[0];

  const piid = str(w['Award ID']);
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const amount = num(w['Award Amount']);

  return {
    contract_id: str(w['generated_internal_id']) || piid,
    award_id: piid,
    piid,
    incumbent_name: str(w['Recipient Name']) || 'Unknown',
    incumbent_uei: uei,
    awarding_agency: str(w['Awarding Agency']) || str(parent.awarding_agency) || 'Unknown',
    awarding_sub_agency: str(w['Awarding Sub Agency']) || null,
    awarding_office: null,
    funding_agency: null,
    naics_code: str(w['NAICS']) || naics,
    naics_description: null,
    psc_code: null,
    description: null,
    total_obligation: amount,
    potential_total_value: amount || null,
    period_of_performance_start: str(w['Start Date']) || null,
    period_of_performance_current_end: str(w['End Date']) || null,
    place_of_performance_state: null,
    place_of_performance_city: null,
    contract_type: str(w['Contract Award Type']) || null,
    data_source: 'usaspending_followon',
    source_url: str(w['generated_internal_id'])
      ? `https://www.usaspending.gov/award/${str(w['generated_internal_id'])}`
      : '',
    last_synced_at: nowIso,
    predecessor_piid: parent.piid,
    followon_captured_at: nowIso,
  };
}

/** Shift a YYYY-MM-DD date by N months (N may be negative). Pure, no Date-now dependency. */
function shiftMonths(ymd: string, months: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
