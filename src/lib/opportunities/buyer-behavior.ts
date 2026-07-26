/**
 * "How this buyer buys" — a buyer-behavior profile computed from real award data.
 *
 * GOS Invariant #11 (docs/strategy/MINDY-OPERATING-THESIS.md): every field is a small-business-fit
 * signal — reveal the pattern, tell the story. A contract's `contract_type` is not just metadata: a
 * PURCHASE ORDER is a simplified-acquisition buy (≤ SAP threshold, low past-performance wall) that a
 * small business can win directly; a DELIVERY ORDER is a task order UNDER a vehicle you must already
 * hold (a teaming/sub play). So the MIX of how an agency buys tells a small firm "you can win here" vs
 * "get on the vehicle first."
 *
 * Measured 2026-07-26 (real, grounds this feature): PO share varies 14%–36% across agencies — DLA 36%
 * (very SB-friendly), VA 25%, NASA 15%, Army 14% — a 2.5× spread, a genuine differentiating signal.
 *
 * HONEST-DATA CAVEAT ([[ground_in_real_data]]): `recompete_opportunities.set_aside_type` is NULL on
 * every row (the USASpending recompete sync deliberately doesn't map it — the endpoint omits it, see
 * CLAUDE.md). So set-aside friendliness is NOT computed here — we surface "not tracked on awards" and
 * leave the set-aside signal to a source that carries it (BQ awards.set_aside / the SAM opp). We NEVER
 * fabricate a set-aside percentage onto recompete rows.
 */
import { getReadClient } from '@/lib/supabase/server-clients';

export interface BuyerBehaviorProfile {
  grounded: boolean;              // true when ≥ MIN_SAMPLE contracts back the profile
  sampleSize: number;             // contracts the mix is computed over
  agency: string | null;
  naics: string | null;           // set when NAICS-scoped, else agency-wide
  mix: {
    purchaseOrder: number;        // count
    deliveryOrder: number;
    definitiveContract: number;
    bpaCall: number;
    other: number;
  };
  poPct: number;                  // purchase-order share (0–100), the SB-friendly signal
  deliveryPct: number;            // delivery-order share — vehicle-gated signal
  medianValue: number | null;    // median potential_total_value ($) — the "too big?" signal
  // Plain-English verdict the drawer renders directly. Never a fabricated number — every field traces
  // to the mix above.
  verdict: {
    label: string;                // e.g. "Small-business friendly" / "Vehicle-gated"
    tone: 'friendly' | 'mixed' | 'gated';
    detail: string;               // the story, grounded in the measured shares
  };
}

const MIN_SAMPLE = 8; // below this the mix is noise — return grounded:false (drawer shows a placeholder)
const FETCH_CAP = 6000; // bound the scan; a share is stable well under this and it matches the recompete route's cap

/**
 * Compute the behavior profile for an agency (optionally NAICS-scoped). Reads `recompete_opportunities`
 * (quality_flag IS NULL — real per-contract rows only). Fail-soft: on any error returns grounded:false
 * so the drawer renders an honest placeholder, never a fabricated mix.
 *
 * ⚠️ SCOPE BEFORE LIMIT (rank-then-filter gate): the agency/NAICS filter is applied INSIDE the query,
 * before the row cap — never fetch-then-filter.
 */
export async function computeBuyerBehavior(
  agency: string | null | undefined,
  naics?: string | null,
): Promise<BuyerBehaviorProfile> {
  const ag = (agency || '').trim();
  const nc = (naics || '').trim();
  const emptyProfile = (reason: string): BuyerBehaviorProfile => ({
    grounded: false, sampleSize: 0, agency: ag || null, naics: nc || null,
    mix: { purchaseOrder: 0, deliveryOrder: 0, definitiveContract: 0, bpaCall: 0, other: 0 },
    poPct: 0, deliveryPct: 0, medianValue: null,
    verdict: { label: 'Not enough data', tone: 'mixed', detail: reason },
  });

  if (!ag) return emptyProfile('No agency to profile.');

  try {
    const db = getReadClient();
    // Match on either awarding_agency OR awarding_sub_agency so a sub-agency label (e.g. "Defense
    // Logistics Agency") and a department label ("Department of Defense") both resolve.
    let q = db
      .from('recompete_opportunities')
      .select('contract_type, potential_total_value')
      .is('quality_flag', null)
      .or(`awarding_agency.eq.${ag},awarding_sub_agency.eq.${ag}`)
      .limit(FETCH_CAP);
    if (nc) q = q.eq('naics_code', nc);

    const { data, error } = await q;
    if (error) {
      console.error('[buyer-behavior] query failed:', error.message);
      return emptyProfile('Behavior data unavailable.');
    }
    const rows = data || [];
    if (rows.length < MIN_SAMPLE) return emptyProfile(`Only ${rows.length} awards on record — too few to profile.`);

    const mix = { purchaseOrder: 0, deliveryOrder: 0, definitiveContract: 0, bpaCall: 0, other: 0 };
    const values: number[] = [];
    for (const r of rows) {
      const t = String(r.contract_type || '').toUpperCase();
      if (t === 'PURCHASE ORDER') mix.purchaseOrder++;
      else if (t === 'DELIVERY ORDER') mix.deliveryOrder++;
      else if (t === 'DEFINITIVE CONTRACT') mix.definitiveContract++;
      else if (t.startsWith('BPA')) mix.bpaCall++;
      else mix.other++;
      const v = Number(r.potential_total_value);
      if (Number.isFinite(v) && v > 0) values.push(v);
    }
    const n = rows.length;
    const poPct = Math.round((mix.purchaseOrder / n) * 100);
    const deliveryPct = Math.round((mix.deliveryOrder / n) * 100);
    const medianValue = values.length ? median(values) : null;

    return {
      grounded: true, sampleSize: n, agency: ag, naics: nc || null,
      mix, poPct, deliveryPct, medianValue,
      verdict: buildVerdict(poPct, deliveryPct, medianValue),
    };
  } catch (err) {
    console.error('[buyer-behavior] unexpected error:', err);
    return emptyProfile('Behavior data unavailable.');
  }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The plain-English story. Thresholds from the measured spread (PO 14%–36% across agencies):
 * ≥25% PO = friendly, ≥45% delivery-order = vehicle-gated, else mixed. Every clause traces to the
 * measured share — no invented claim.
 */
function buildVerdict(poPct: number, deliveryPct: number, medianValue: number | null): BuyerBehaviorProfile['verdict'] {
  const sizeNote = medianValue != null
    ? ` Typical award ≈ ${compactUsd(medianValue)}.`
    : '';
  if (poPct >= 25) {
    return {
      label: 'Small-business friendly',
      tone: 'friendly',
      detail: `${poPct}% of this buyer's awards are purchase orders — simplified-acquisition buys a small business can win directly, without a big past-performance wall.${sizeNote}`,
    };
  }
  if (deliveryPct >= 45) {
    return {
      label: 'Vehicle-gated',
      tone: 'gated',
      detail: `${deliveryPct}% of awards are delivery/task orders under existing contract vehicles — to win here you typically need to be on the vehicle already, or team with a prime who is.${sizeNote}`,
    };
  }
  return {
    label: 'Mixed buying',
    tone: 'mixed',
    detail: `A mix of buying methods (${poPct}% purchase orders, ${deliveryPct}% delivery orders) — some direct-bid room, some vehicle-gated.${sizeNote}`,
  };
}

function compactUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
