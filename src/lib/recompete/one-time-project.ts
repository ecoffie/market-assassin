/**
 * One-time construction projects are not recompetes.
 *
 * recompete_likelihood comes from the DB function compute_recompete_likelihood (20260405 / trigger
 * 20260716): 'high' when the PoP ends within 12 months AND COALESCE(options_remaining,0)=0 AND obligation
 * > $1M. No writer fills options_remaining, and NAICS / PSC / contract type are not inputs — so every
 * $1M+ project ending within a year reads 'high'. Reported 2026-11-22: 36C24825C0020 (VA NCO 8, "RENOVATE
 * 5 WEST", PSC Y1DA construction of hospitals, definitive contract) was presented as a high-likelihood
 * recompete. A renovation is finished, not re-bid; a follow-on is a different project.
 *
 * Read-time correction over EXISTING columns (no migration, no writer change; Eric/Agent 4 2026-11-22):
 *   definitive contract AND (PSC Y* construction OR PSC Z2* repair/alteration of real property
 *                            OR, when PSC is absent, NAICS 236 building / 237 heavy-civil construction)
 *   → recompete_likelihood 'not_recurring' with a stated basis.
 * Deliberately NOT included: PSC Z1* (MAINTENANCE of real property — often recurring service), NAICS 238
 * alone (specialty trades include recurring maintenance such as elevator service), IDV task orders (their
 * vehicle is the recompete signal), and anything without a contract type.
 */
export const NOT_RECURRING = 'not_recurring' as const;
export const ONE_TIME_BASIS =
  'One-time construction or alteration project (definitive contract, construction PSC/NAICS): the work is completed, not re-competed — a follow-on would be a different project.';

export function isOneTimeConstruction(row: {
  contract_type?: string | null;
  psc_code?: string | null;
  naics_code?: string | null;
}): boolean {
  if (!/DEFINITIVE/i.test(String(row.contract_type ?? ''))) return false;
  const psc = String(row.psc_code ?? '').trim().toUpperCase();
  if (psc) return psc.startsWith('Y') || psc.startsWith('Z2');
  const naics = String(row.naics_code ?? '').trim();
  return naics.startsWith('236') || naics.startsWith('237');
}

/**
 * PostgREST `.or()` body for the COMPLEMENT of isOneTimeConstruction — attached when a caller filters on
 * likelihood, so likelihood='high' never pages in rows that display as not_recurring. NULL-safe: a NULL
 * column never makes a row match the one-time predicate.
 */
export const NOT_ONE_TIME_CONSTRUCTION_OR = [
  'contract_type.is.null',
  'contract_type.not.ilike.*DEFINITIVE*',
  'and(' + [
    'or(psc_code.is.null,psc_code.not.like.Y*)',
    'or(psc_code.is.null,psc_code.not.like.Z2*)',
    'or(psc_code.not.is.null,naics_code.is.null,and(naics_code.not.like.236*,naics_code.not.like.237*))',
  ].join(',') + ')',
].join(',');
