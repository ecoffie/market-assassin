/**
 * USASpending spending_by_award field shapes (measured 2026-11-28).
 *
 * The flat columns we requested — 'NAICS Code', 'NAICS Description', 'Product or Service Code', 'PSC Code',
 * 'Recipient State Code' — come back NULL. The same data is returned under the current field names as objects:
 *   NAICS                        → { code, description }
 *   PSC                          → { code, description }
 *   Recipient Location           → { state_code, city_name, ... }   (recipient HQ / address)
 *   Primary Place of Performance → { state_code, city_name, ... }
 * ('Place of Performance State Code' still returns a value.) Request both shapes and read the object first, the flat
 * column second; a value absent from both stays empty — never stamped from the query filter.
 */
export const AWARD_SEARCH_NESTED_FIELDS = ['NAICS', 'PSC', 'Recipient Location', 'Primary Place of Performance'] as const;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function awardNaics(r: Row): { code: string; description: string } {
  const o = obj(r['NAICS']);
  return {
    code: str(o?.code) || str(r['NAICS Code']) || (typeof r['NAICS'] === 'string' ? str(r['NAICS']) : ''),
    description: str(o?.description) || str(r['NAICS Description']),
  };
}

export function awardPsc(r: Row): { code: string; description: string } {
  const o = obj(r['PSC']);
  return {
    code: str(o?.code) || str(r['Product or Service Code']) || str(r['PSC Code']) || (typeof r['PSC'] === 'string' ? str(r['PSC']) : ''),
    description: str(o?.description) || str(r['Product or Service Code Description']),
  };
}

/** Recipient HQ state (never the place of performance). */
export function awardRecipientState(r: Row): string {
  return str(obj(r['Recipient Location'])?.state_code) || str(r['Recipient State Code']);
}

/** Place-of-performance state (never the recipient HQ). */
export function awardPopState(r: Row): string {
  return str(obj(r['Primary Place of Performance'])?.state_code) || str(r['Place of Performance State Code']);
}

/** Place-of-performance city (never the recipient HQ city). Empty when USASpending reports none. */
export function awardPopCity(r: Row): string {
  return str(obj(r['Primary Place of Performance'])?.city_name);
}
