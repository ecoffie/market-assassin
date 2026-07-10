/**
 * DoDAAC decoder — pull the contracting OFFICE out of a DoD solicitation number.
 *
 * A DoD solicitation number (PIID) is structured:
 *   ┌─ DoDAAC (chars 1-6) — the contracting office / activity address code
 *   │      ┌─ FY (chars 7-8)
 *   │      │  ┌─ 9th char — instrument type (Eric 2026-06-05):
 *   │      │  │     A/B = BPA, C/D = IDIQ, 9 = OTA, P = purchase order,
 *   │      │  │     Q/R/T = solicitation (RFQ/RFP/etc.)
 *   │      │  │  ┌─ sequential number
 *   N00104 26 R X19785
 *
 * Some (mostly Navy) use a dashed form: N61331-26-Q-KS35 — the DoDAAC is still
 * the first 6 chars; FY/type follow the dashes.
 *
 * The DoDAAC gives office-level granularity (297 distinct offices in just 1000
 * DoD contacts) — far finer than the parent agency. We decode the CODE always,
 * and resolve a friendly OFFICE NAME for the common ones via DODAAC_NAMES.
 */
import { normalizeOfficeName } from './office-name';

// 9th-char instrument type. Per Eric + DFARS PGI 204.7003.
const TYPE_BY_CHAR: Record<string, string> = {
  A: 'BPA', B: 'BPA',
  C: 'IDIQ', D: 'IDIQ',
  G: 'BOA',
  P: 'Purchase Order',
  V: 'IDIQ (orders)',
  '9': 'OTA',
  // Solicitation (pre-award) markers — common in this dataset:
  Q: 'RFQ', R: 'RFP', T: 'Solicitation', U: 'Solicitation', S: 'Sources Sought',
};

// Friendly names for the most common DoDAACs (the top ~ cover most contacts).
// Curated — there's no complete free public DoDAAC directory, so we name the
// frequent ones and fall back to the code + branch for the rest.
const DODAAC_NAMES: Record<string, string> = {
  N00104: 'NAVSUP Weapon Systems Support',
  N00189: 'NAVSUP Fleet Logistics Center Norfolk',
  N00178: 'NSWC Dahlgren',
  N40085: 'NAVFAC Mid-Atlantic',
  N61331: 'NSWC Panama City',
  SPE7M1: 'DLA Land and Maritime',
  SPE7M5: 'DLA Land and Maritime',
  SPE7L1: 'DLA Land and Maritime',
  SPE7LX: 'DLA Land and Maritime',
  SPE4A6: 'DLA Aviation',
  SPE4A7: 'DLA Aviation',
  SPE8E9: 'DLA Maritime',
  SPRMM1: 'DLA Maritime - Mechanicsburg',
  SPRDL1: 'DLA Distribution',
  HT9410: 'Defense Health Agency',
  M67001: 'Marine Corps Regional Contracting (MCRC)',
  W911SA: 'Army - Fort McCoy',
  FA3016: 'Air Force - JBSA Lackland',
};

export interface DodaacInfo {
  dodaac: string;          // the 6-char office code
  officeName: string | null; // friendly name if known
  fiscalYear: number | null;
  instrumentType: string | null; // BPA / IDIQ / OTA / Purchase Order / RFQ ...
}

function isValidFy(fy: number | null): fy is number {
  return fy != null && fy >= 2010 && fy <= 2035;
}

/**
 * @param solicitationNumber the PIID / sol number to decode.
 * @param knownDodaacs optional set of REAL DoDAAC codes (from the directory).
 *   When the sol number carries no parseable fiscal year (e.g. underscore
 *   formats like `FA8105_CCR_Rev2`), we normally reject it as garbage. But if
 *   the 6-char prefix IS a known real DoDAAC, that membership is itself strong
 *   proof — so we accept it. This rescues valid codes without weakening the
 *   anti-false-positive guard for UNKNOWN prefixes (e.g. `GASKET_26` stays
 *   rejected because GASKET isn't a real DoDAAC).
 */
export function decodeDodaac(
  solicitationNumber: string | null,
  knownDodaacs?: Set<string> | Map<string, unknown> | null,
): DodaacInfo | null {
  if (!solicitationNumber) return null;
  const raw = solicitationNumber.toUpperCase().trim();
  // DoDAAC = first 6 alphanumerics (works for both dashed and undashed forms).
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  // Reject SAM notice UUIDs (32-char hex blobs) — they aren't solicitation
  // numbers and a fragment can falsely look like a DoDAAC (e.g. "C164A7...").
  if (/^[0-9A-F]{32}$/.test(compact)) return null;

  const dodaac = compact.slice(0, 6);
  // A valid DoDAAC is 6 chars and starts with a letter (N/W/F/S/M/H...).
  if (dodaac.length !== 6 || !/^[A-Z]/.test(dodaac)) return null;

  // Fiscal-year position: the FY lives at COMPACT chars 7-8 for both packed
  // (N0010426R...) and suffix forms (W911S626QA025-SSN — the '-SSN' is a suffix,
  // NOT the FY delimiter). Try compact first; only fall back to the dashed-split
  // FY (N61331-26-Q-... where the DoDAAC itself contains no interior digits at
  // 7-8) when compact doesn't yield a valid year. This fixes the old bug where a
  // trailing '-<suffix>' sent parsing down the dashed branch and dropped the FY.
  const compactFy = /^\d{2}$/.test(compact.slice(6, 8)) ? 2000 + parseInt(compact.slice(6, 8), 10) : null;
  let fyNum: number | null = isValidFy(compactFy) ? compactFy : null;
  let typeChar = compact.charAt(8);

  if (!fyNum && raw.includes('-')) {
    const parts = raw.split('-');
    const dashedFyStr = (parts[1] || '').replace(/[^0-9]/g, '').slice(0, 2);
    const dashedFy = /^\d{2}$/.test(dashedFyStr) ? 2000 + parseInt(dashedFyStr, 10) : null;
    if (isValidFy(dashedFy)) {
      fyNum = dashedFy;
      typeChar = (parts[2] || '').replace(/[^A-Z0-9]/g, '').charAt(0);
    }
  }

  // Directory membership (passed in) or the curated in-code map is proof the
  // prefix is a genuine office code.
  const hasDirectory = knownDodaacs != null;
  const inDirectory =
    (knownDodaacs instanceof Map ? knownDodaacs.has(dodaac) : knownDodaacs?.has(dodaac)) ||
    DODAAC_NAMES[dodaac] !== undefined;

  if (hasDirectory) {
    // A directory was provided → treat it as AUTHORITATIVE (a whitelist). Only
    // real DoDAACs decode. This rescues no-FY underscore formats (FA8105_CCR)
    // AND rejects plausible-but-fake prefixes that happen to carry a valid-
    // looking FY (GASKET_26 → GASKET/FY26 structurally, but not a real code).
    if (!inDirectory) return null;
  } else {
    // No directory → fall back to the FY heuristic: a plausible fiscal year at
    // the FY position is the strongest available signal that this is a real
    // PIID and not a UUID/random id. (in-code DODAAC_NAMES also counts.)
    if (!isValidFy(fyNum) && DODAAC_NAMES[dodaac] === undefined) return null;
  }

  return {
    dodaac,
    officeName: DODAAC_NAMES[dodaac] || null,
    fiscalYear: isValidFy(fyNum) ? fyNum : null,
    instrumentType: typeChar ? (TYPE_BY_CHAR[typeChar] || null) : null,
  };
}

/**
 * One-line office label for a solicitation number, for inline display across
 * Mindy (Alerts, Pipeline, Recompetes, ...). Returns null when it can't decode
 * (civilian formats, non-DoD) so callers can fall back to the agency name.
 * e.g. "NAVSUP Weapon Systems Support" or "DLA Aviation · IDIQ" or "N00104".
 */
export function formatDodaacOffice(
  solicitationNumber: string | null,
  nameMap?: Map<string, string>,
): string | null {
  const d = decodeDodaac(solicitationNumber);
  if (!d) return null;
  // Name resolution: directory table (passed in) > in-code map > raw code.
  const raw = (nameMap && nameMap.get(d.dodaac)) || d.officeName || d.dodaac;
  // FPDS office names are terse military abbreviations ("87 CONS PK") — the
  // 'expand' mode of the shared normalizer expands the common tokens.
  const office = normalizeOfficeName(raw, { mode: 'expand' });
  return d.instrumentType ? `${office} · ${d.instrumentType}` : office;
}
