/**
 * Six DARPA rows inserted 2026-04-05 from a hardcoded list in
 * grantsgov-darpa.ts (commit f62b51f6f). Every row was given NAICS 541715.
 * Grants.gov did not supply that code. The rows are not deleted here.
 * Customer reads must not present 541715 as source data.
 *
 * HR001125S0011 is also on the live Grants.gov feed (TTO Office-Wide BAA 2025).
 * After a real ingest its naics_code is null, so this predicate stops matching.
 */
export const MANUFACTURED_DARPA_EXTERNAL_IDS = [
  'HR001125S0013',
  'HR001126S0003',
  'HR001125S0011',
  'HR001126S0001',
  'HR001126S0008',
  'DARPARA2601',
] as const;

export const MANUFACTURED_DARPA_NAICS = '541715';

const IDS = new Set<string>(MANUFACTURED_DARPA_EXTERNAL_IDS);

export function isManufacturedDarpaRow(row: {
  source?: string | null;
  external_id?: string | null;
  externalId?: string | null;
  naics_code?: string | null;
  naicsCode?: string | null;
}): boolean {
  if (row.source !== 'darpa_baa') return false;
  const id = row.external_id ?? row.externalId ?? '';
  const naics = row.naics_code ?? row.naicsCode ?? '';
  return IDS.has(id) && naics === MANUFACTURED_DARPA_NAICS;
}

export const MANUFACTURED_DARPA_NOTE =
  'Stored DARPA row from the 2026-04-05 hardcoded list. NAICS 541715 was written by the collector, not by Grants.gov, and is not shown.';
