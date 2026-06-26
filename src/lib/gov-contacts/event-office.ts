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
