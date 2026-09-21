/**
 * Infer the BUYING OFFICE for an event/notice from its solicitation number.
 *
 * sam_events.agency is DEPARTMENT-level only ("DEPT OF DEFENSE" for every DoD
 * event — the real command lives in the title / sol number). A SAM solicitation
 * number (PIID) starts with a 6-char DoDAAC that encodes the contracting office,
 * e.g. N65236… = NUWC Keyport, FA8614… = AFLCMC Wright-Patterson, W912… = Army
 * Corps. We decode it and resolve a friendly office + sub-agency from the
 * dodaac_directory table — so an Army office's Event Radar stops showing USAF /
 * DISA notices (Eric, Jun 26).
 *
 * Civilian agencies don't use DoDAACs → returns nulls; callers keep the
 * department-level fallback for those.
 */
import { decodeDodaac } from './dodaac';
import { loadDodaacDirectory } from './dodaac-directory';
import { normalizeOfficeName } from './office-name';

export interface InferredOffice {
  dodaac: string | null;
  office: string | null;
  subAgency: string | null;
}

const EMPTY: InferredOffice = { dodaac: null, office: null, subAgency: null };

/** Decode a solicitation number → buying office + sub-agency (best-effort). */
export async function inferOfficeFromSolicitation(solicitationNumber: string | null | undefined): Promise<InferredOffice> {
  const decoded = decodeDodaac(solicitationNumber ?? null);
  if (!decoded) return EMPTY;
  let office: string | null = decoded.officeName; // curated in-code fallback
  let subAgency: string | null = null;
  try {
    const dir = await loadDodaacDirectory();
    const entry = dir.get(decoded.dodaac);
    if (entry) {
      office = entry.officeName || office;
      subAgency = entry.subAgency || null;
    }
  } catch { /* directory unreachable — keep the in-code office, no sub-agency */ }
  return { dodaac: decoded.dodaac, office, subAgency };
}

/**
 * Resolve an event's buying office for BOTH DoD and CIVILIAN agencies.
 *
 * DoDAAC decode only covers DoD (GSA/VA/HHS solicitation numbers carry no
 * DoDAAC) — but SAM already reports a real buying office for civilian notices in
 * its own `office` + `sub_tier` columns. So:
 *   1. DoD: decode the solicitation-number DoDAAC (finest granularity — names the
 *      exact command, e.g. NSWC Dahlgren).
 *   2. Civilian / undecodable DoD: fall back to SAM's office + sub_tier, run
 *      through the shared 'clean' normalizer (GSA slash-soup → readable names,
 *      acronym casing). This also rescues DoD notices whose DoDAAC we can't
 *      decode but whose SAM office IS populated.
 *
 * Result: Event Radar (and any office-scoped surface) shows a real office for
 * GSA/VA/HHS instead of falling back to "DEPT OF …".
 */
export async function resolveEventOffice(
  solicitationNumber: string | null | undefined,
  samOffice?: string | null,
  samSubTier?: string | null,
): Promise<InferredOffice> {
  const dod = await inferOfficeFromSolicitation(solicitationNumber);
  if (dod.office) return dod; // DoDAAC decoded a named office — best signal.

  const office = (samOffice || '').trim();
  if (office) {
    return {
      dodaac: dod.dodaac, // usually null for civilian
      office: normalizeOfficeName(office, { mode: 'clean' }),
      subAgency: (samSubTier || '').trim() || dod.subAgency || null,
    };
  }
  return dod; // nothing better — likely all-null
}
