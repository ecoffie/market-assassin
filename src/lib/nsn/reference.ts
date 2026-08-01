/**
 * NSN Intelligence Layer — reference lookup.
 *
 * Given an NSN (or bare NIIN), returns the DLA FLIS/PUB LOG reference data we ingested:
 * item name, government reference unit price, and manufacturer part numbers (+ CAGE/company).
 * Source tables: nsn_reference (1/NIIN, price+identity) + nsn_part_numbers (many/NIIN).
 * Loaded by scripts/load-nsn-intelligence.ts from the monthly DLA Reading Room CSVs.
 *
 * HONEST CONTRACT (grounded/degraded), matching the MCP tool discipline:
 *   - grounded=true  → we found a real reference row for this NSN.
 *   - grounded=false → this NSN isn't in the catalog (mil-spec-only / cancelled / unknown).
 *                      Callers MUST show "no catalog match", NEVER fabricate a price or part.
 *   - degraded=true  → the lookup itself ERRORED (DB down). Distinct from a genuine miss —
 *                      surface it; do not present a miss as authoritative "no data".
 *   - unit_price is the FLIS management STANDARD reference price (a cataloged reference, not a
 *     live market quote). Present it labeled as such. NULL price = no reference price (never $0).
 */
import { getReadClient } from '@/lib/supabase/server-clients';

export interface NsnPartNumber {
  partNumber: string;
  cageCode: string | null;
  companyName: string | null;
}

export interface NsnReference {
  niin: string;
  nsn: string | null;
  fsc: string | null;
  itemName: string | null;
  /** FLIS management standard reference unit price (USD). null = no reference price on file. */
  unitPrice: number | null;
  unitOfIssue: string | null;
  /** EFFECTIVE_DATE of the price row (freshness of the reference). ISO date. */
  priceDate: string | null;
  parts: NsnPartNumber[];
  _meta: { grounded: boolean; degraded: boolean; source: 'DLA PUB LOG / FLIS' };
}

/** Normalize an NSN or NIIN input to the 9-digit NIIN key. Accepts dashed/spaced NSN or bare NIIN. */
export function niinFromNsn(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^0-9]/g, '');
  if (digits.length === 13) return digits.slice(4);   // FSC(4)+NIIN(9)
  if (digits.length === 9) return digits;             // bare NIIN
  return null;
}

/**
 * Look up the NSN reference (identity + price + part numbers). Returns null-grounded on a genuine
 * miss, degraded on error — NEVER throws, NEVER fabricates.
 */
export async function getNsnReference(nsnOrNiin: string | null | undefined): Promise<NsnReference | null> {
  const niin = niinFromNsn(nsnOrNiin);
  if (!niin) return null;

  const miss = (degraded: boolean): NsnReference => ({
    niin, nsn: null, fsc: null, itemName: null, unitPrice: null, unitOfIssue: null,
    priceDate: null, parts: [],
    _meta: { grounded: false, degraded, source: 'DLA PUB LOG / FLIS' },
  });

  try {
    const sb = getReadClient();
    // Bind BOTH error + data (silent-failure gate): a swallowed error must not read as a miss.
    const { data: ref, error: refErr } = await sb
      .from('nsn_reference')
      .select('niin, nsn, fsc, item_name, unit_price, unit_of_issue, price_date')
      .eq('niin', niin)
      .maybeSingle();
    if (refErr) return miss(true);           // DEGRADED — the query errored, not a real miss
    if (!ref) return miss(false);            // genuine miss — NSN not in catalog

    const { data: parts, error: partErr } = await sb
      .from('nsn_part_numbers')
      .select('part_number, cage_code, company_name')
      .eq('niin', niin)
      .limit(25);
    // A part-lookup error doesn't invalidate the (grounded) reference — degrade only the parts list.
    const partList: NsnPartNumber[] = (partErr || !parts) ? [] : parts.map(p => ({
      partNumber: p.part_number, cageCode: p.cage_code ?? null, companyName: p.company_name ?? null,
    }));

    return {
      niin,
      nsn: ref.nsn ?? null,
      fsc: ref.fsc ?? null,
      itemName: ref.item_name ?? null,
      unitPrice: ref.unit_price != null ? Number(ref.unit_price) : null,
      unitOfIssue: ref.unit_of_issue ?? null,
      priceDate: ref.price_date ?? null,
      parts: partList,
      _meta: { grounded: true, degraded: false, source: 'DLA PUB LOG / FLIS' },
    };
  } catch {
    return miss(true);                        // DEGRADED — never throw to the caller
  }
}
