/**
 * NSN Intelligence Layer — reference lookup (BigQuery).
 *
 * Given an NSN (or bare NIIN), returns the DLA FLIS/PUB LOG reference data:
 * item name, government reference unit price, and manufacturer part numbers (+ CAGE/company).
 * Data lives in BigQuery dataset `nsn` (project market-assasin), NOT Supabase — a ~50M-row STATIC
 * federal catalog belongs next to the 317K-contractor `usaspending` data, not on the transactional
 * prod DB (loading it into Postgres caused disk-full/pooler/timeout failures — see memory
 * `nsn_catalog_in_bigquery`). Loaded monthly via `bq load` from the DLA Reading Room CSVs.
 *   - nsn.reference_lookup (VIEW) — identity + newest-price-per-NIIN, one row/NIIN
 *   - nsn.parts ⋈ nsn.cage — part numbers + manufacturer (many/NIIN)
 *
 * HONEST CONTRACT (grounded/degraded), matching the MCP tool discipline:
 *   - grounded=true  → we found a real reference row for this NSN.
 *   - grounded=false → this NSN isn't in the catalog (mil-spec-only / cancelled / unknown).
 *                      Callers MUST show "no catalog match", NEVER fabricate a price or part.
 *   - degraded=true  → the lookup itself ERRORED / BQ unavailable. Distinct from a genuine miss.
 *   - unit_price is the FLIS management STANDARD reference price (a cataloged reference, not a
 *     live market quote). Present it labeled as such. NULL price = no reference price (never $0).
 */
import { queryCached } from '@/lib/bigquery/cache';

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

interface RefRow {
  niin: string; nsn: string | null; fsc: string | null; item_name: string | null;
  unit_price: string | number | null; unit_of_issue: string | null; price_date: { value: string } | string | null;
}
interface PartRow { part_number: string; cage_code: string | null; company_name: string | null; }

function bqDate(v: RefRow['price_date']): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.value ?? null;   // BigQuery DATE comes back as { value: 'YYYY-MM-DD' }
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
    // liveBq via cacheOnly:false — NSN lookups are cheap (<100MB, keyed on niin) + warm-cacheable.
    const refRows = await queryCached<RefRow>({
      cacheKey: `nsn:ref:${niin}`,
      query: `SELECT niin, nsn, fsc, item_name, unit_price, unit_of_issue, price_date
              FROM \`market-assasin.nsn.reference_lookup\` WHERE niin = @niin LIMIT 1`,
      params: { niin },
      cacheOnly: false,
      ttlSeconds: 60 * 60 * 24 * 7,   // reference data changes monthly; 7-day cache is safe
    });
    const ref = refRows[0];
    if (!ref) return miss(false);   // genuine miss — NSN not in catalog

    const partRows = await queryCached<PartRow>({
      cacheKey: `nsn:parts:${niin}`,
      query: `SELECT p.PART_NUMBER AS part_number, p.CAGE_CODE AS cage_code, c.COMPANY AS company_name
              FROM \`market-assasin.nsn.parts\` p
              LEFT JOIN \`market-assasin.nsn.cage\` c ON c.CAGE_CODE = p.CAGE_CODE
              WHERE p.NIIN = @niin LIMIT 25`,
      params: { niin },
      cacheOnly: false,
      ttlSeconds: 60 * 60 * 24 * 7,
    });
    const parts: NsnPartNumber[] = (partRows || []).map(p => ({
      partNumber: p.part_number, cageCode: p.cage_code ?? null, companyName: p.company_name ?? null,
    }));

    const up = ref.unit_price == null ? null : Number(ref.unit_price);
    return {
      niin,
      nsn: ref.nsn ?? null,
      fsc: ref.fsc ?? null,
      itemName: ref.item_name ?? null,
      unitPrice: (up != null && Number.isFinite(up) && up > 0) ? up : null,
      unitOfIssue: ref.unit_of_issue ?? null,
      priceDate: bqDate(ref.price_date),
      parts,
      _meta: { grounded: true, degraded: false, source: 'DLA PUB LOG / FLIS' },
    };
  } catch {
    return miss(true);   // DEGRADED — never throw to the caller
  }
}
