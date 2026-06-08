/**
 * USASpending award-detail fetch (#50) — the shared foundation for both Sport/
 * Market Research drill-down (#51) and Proposal Assist grounding (#52). Eric: the
 * Contract Summary page is the single source of truth for a specific award — it
 * ties amounts, the parent vehicle, dates, and the recipient together.
 *
 * GET /api/v2/awards/{generated_internal_id}/ → the full Contract Summary. The
 * generated_internal_id is already in our spending_by_award results.
 */

export interface AwardDetail {
  awardId: string;                 // PIID / display id
  generatedId: string;
  description: string;
  recipientName: string;
  recipientCity: string;
  recipientState: string;
  recipientCongressionalDistrict: string;
  recipientUei: string;
  // $ trajectory — obligated (spent) → ceiling (the real prize size)
  obligated: number;
  currentValue: number;
  ceiling: number;                 // base_and_all_options_value — the potential max
  // The parent vehicle (IDV) this task/order flows under — the gate to compete
  parentIdvId: string | null;
  parentIdvPiid: string | null;
  // Period of performance — the recompete timing window
  popStart: string | null;
  popEnd: string | null;
  popPotentialEnd: string | null;
  // Codes (with readable hierarchy)
  naicsCode: string;
  naicsDescription: string;
  pscCode: string;
  pscDescription: string;
  awardingAgency: string;
  awardingSubAgency: string;
  awardingOffice: string;
  fundingAccount: string | null;
  usaSpendingUrl: string;
}

const BASE = 'https://api.usaspending.gov/api/v2/awards';

/** Fetch + normalize the full award detail for a USASpending generated_internal_id. */
export async function fetchAwardDetail(generatedId: string): Promise<AwardDetail | null> {
  if (!generatedId) return null;
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(generatedId)}/`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await res.json();
    const loc = d.recipient?.location || {};
    const pop = d.period_of_performance || {};
    const obligated = Number(d.total_obligation || 0);
    // Ceiling: base_and_all_options_value is the max potential; fall back to
    // base_exercised_options, then obligated (Eric: ceiling sometimes null).
    const ceiling = Number(d.base_and_all_options_value || d.base_exercised_options_val || d.total_obligation || 0);
    return {
      awardId: d.piid || d.fain || d.uri || generatedId,
      generatedId,
      description: d.description || '',
      recipientName: d.recipient?.recipient_name || '',
      recipientCity: loc.city_name || '',
      recipientState: loc.state_code || '',
      recipientCongressionalDistrict: loc.congressional_code || '',
      recipientUei: d.recipient?.recipient_uei || '',
      obligated,
      currentValue: Number(d.total_obligation || 0),
      ceiling,
      parentIdvId: d.parent_award?.generated_unique_award_id || null,
      parentIdvPiid: d.parent_award?.piid || null,
      popStart: pop.start_date || null,
      popEnd: pop.end_date || null,
      popPotentialEnd: (pop.potential_end_date || pop.end_date || '').slice(0, 10) || null,
      naicsCode: d.naics_hierarchy?.base_code?.code || d.naics || '',
      naicsDescription: d.naics_hierarchy?.base_code?.description || d.naics_description || '',
      pscCode: d.psc_hierarchy?.base_code?.code || d.product_or_service_code || '',
      pscDescription: d.psc_hierarchy?.base_code?.description || '',
      awardingAgency: d.awarding_agency?.toptier_agency?.name || '',
      awardingSubAgency: d.awarding_agency?.subtier_agency?.name || '',
      awardingOffice: d.awarding_agency?.office_agency_name || '',
      fundingAccount: d.funding_account?.federal_account_name
        || (Array.isArray(d.federal_accounts) ? d.federal_accounts[0]?.federal_account_name : null)
        || null,
      usaSpendingUrl: `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}`,
    };
  } catch {
    return null;
  }
}
