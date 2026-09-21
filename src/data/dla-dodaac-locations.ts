/**
 * DLA purchasing-office DoDAAC → physical location, for mapping DIBBS RFQs.
 *
 * WHY THIS FILE EXISTS
 * `dibbs_rfqs` has NO geography column — its 14 columns are solicitation_number,
 * nsn, fsc, description, quantity, unit_of_issue, return_by_date, buyer, status,
 * url, pdf_url, raw, scraped_at, synced_at. The `raw` blob (19 keys) has no
 * location either, and the `buyer` field is a 1–3 char internal buyer-desk
 * initial ("ME", "S", "HEA") with 100+ distinct values and no geographic
 * meaning. So a DIBBS RFQ cannot be plotted on the opportunity map as-is.
 *
 * The first 6 characters of every DIBBS solicitation number ARE the purchasing
 * office's DoDAAC (e.g. SPE4A6-26-T-1523 → SPE4A6). That resolves to a real
 * DLA buying activity with a real street address. Derive location from the
 * prefix at query time — no new column, no backfill, works retroactively on
 * every existing row and automatically on every future one.
 *
 * HOW THESE WERE GROUNDED (CLAUDE.md rule #1 — never an LLM guess)
 * City/state/ZIP come from SAM.gov `raw_data->officeAddress` on
 * `sam_opportunities`, aggregated by DoDAAC prefix with a majority vote:
 *
 *   WITH x AS (
 *     SELECT substring(solicitation_number from 1 for 6) AS dodaac,
 *            upper(raw_data->'officeAddress'->>'city')   AS city,
 *            raw_data->'officeAddress'->>'state'         AS state,
 *            split_part(raw_data->'officeAddress'->>'zipcode','-',1) AS zip5
 *     FROM sam_opportunities
 *     WHERE solicitation_number ~ '^SPE'
 *       AND raw_data->'officeAddress'->>'state' IS NOT NULL)
 *   SELECT dodaac, city, state, zip5, count(*) ... GROUP BY ... -- top row per dodaac
 *
 * Every entry below is the top city for its DoDAAC at **83–100% consensus**
 * (most are 100%) across 55,000+ real SAM records. Offices with fewer than 5
 * SAM records were excluded as too thin to trust.
 *
 * `office` names are cross-confirmed by TWO independent sources that agree
 * exactly: our `dodaac_directory` table (built from FPDS awards) and
 * USASpending's award-detail `awarding_agency.office_agency_name`.
 *
 * Coordinates are ZIP-centroid lookups from `src/data/us-zip-coords.json`
 * (ZIP-level, not city-level — 19111 is NE Philadelphia where the DLA Troop
 * Support campus actually sits, ~15mi from the Philadelphia city centroid).
 *
 * ⚠️ WHAT THESE PINS MEAN — read before surfacing on a map
 * This is the **purchasing office** location, NOT place of performance. DLA
 * buys NSN parts shipped to depots worldwide; USASpending place-of-performance
 * on these awards is the *vendor's* location (AL, FL, CA, TX...), which is a
 * different question and not what this file answers. Consequence: DIBBS pins
 * cluster hard — in the current 895-row corpus ~73% land on Richmond VA and
 * the rest almost entirely on Philadelphia PA. Label the layer as buying-office
 * so the map doesn't imply nationwide opportunity spread.
 *
 * Regenerate when: new SPE-prefix DoDAACs start appearing in dibbs_rfqs that
 * aren't in this table (see getUnmappedDodaacs() usage in the map layer).
 * Last grounded: 2026-07-27.
 */

export interface DlaOfficeLocation {
  /** Canonical office name — matches dodaac_directory.office_name + USASpending. */
  office: string;
  city: string;
  state: string;
  /** 5-digit ZIP of the buying office. */
  zip: string;
  /** [lat, lng] — ZIP centroid from us-zip-coords.json. */
  coords: [number, number];
}

/**
 * 6-char DoDAAC → buying-office location.
 * Keys are uppercase, hyphens already stripped.
 */
export const DLA_DODAAC_LOCATIONS: Record<string, DlaOfficeLocation> = {
  // ── DLA AVIATION — Richmond, VA (ZIP 23237) ────────────────────────────
  SPE4A0: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A1: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A2: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A4: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A5: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A6: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A7: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4A8: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4AX: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  SPE4AK: { office: 'DEFENSE LOGISTICS AGENCY (DLA)', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },
  // SPE4AC — same DLA Aviation Richmond family (ground-truth 2026-07-30: sam_opportunities
  // rows under this DoDAAC are 100% VA). Added to close the last unmapped open-bid gap.
  SPE4AC: { office: 'DLA AVIATION', city: 'Richmond', state: 'VA', zip: '23237', coords: [37.4011, -77.4615] },

  // DLA Aviation forward sites (co-located with the fleet they support)
  SPEFA1: { office: 'DLA AVIATION AT SAN DIEGO', city: 'San Diego', state: 'CA', zip: '92135', coords: [32.7153, -117.1573] },
  // SPEFA3 — DLA Aviation forward site, Jacksonville FL (NAS Jacksonville). Ground-truth
  // 2026-07-30: sam_opportunities rows under this DoDAAC are majority FL. Added to close
  // the last unmapped open-bid gap.
  SPEFA3: { office: 'DLA AVIATION AT JACKSONVILLE, FL', city: 'Jacksonville', state: 'FL', zip: '32212', coords: [30.2358, -81.6806] },
  SPEFA5: { office: 'DLA AVIATION AT CHERRY POINT, NC', city: 'Cherry Point', state: 'NC', zip: '28533', coords: [34.9038, -76.9] },

  // ── DLA LAND AND MARITIME — Columbus, OH (ZIP 43218) ───────────────────
  SPE7L0: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L1: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L2: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L3: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L4: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L5: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7L7: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7LX: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M0: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M1: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M2: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M3: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M4: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M5: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M8: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7M9: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7MC: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },
  SPE7MX: { office: 'DLA LAND AND MARITIME', city: 'Columbus', state: 'OH', zip: '43218', coords: [39.969, -83.0114] },

  // ── DLA TROOP SUPPORT — Philadelphia, PA (ZIP 19111) ───────────────────
  // NOTE: the SPE2D*/SPE3S*/SPE8E* families are Troop Support (Philadelphia),
  // NOT Land & Maritime. Confirmed 100% by SAM officeAddress + FPDS + USASpending.
  SPE1C1: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2D1: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2D2: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2DE: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2DF: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2DH: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2DP: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE2DS: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE300: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE3S1: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE3SE: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E3: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E4: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E5: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E6: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E7: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E8: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8E9: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8ED: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8EE: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8EF: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8EG: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8EN: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },
  SPE8ES: { office: 'DLA TROOP SUPPORT', city: 'Philadelphia', state: 'PA', zip: '19111', coords: [40.0596, -75.0818] },

  // ── DLA ENERGY — Fort Belvoir, VA (ZIP 22060) ──────────────────────────
  SPE602: { office: 'DLA ENERGY', city: 'Fort Belvoir', state: 'VA', zip: '22060', coords: [38.6947, -77.1433] },
  SPE603: { office: 'DLA ENERGY', city: 'Fort Belvoir', state: 'VA', zip: '22060', coords: [38.6947, -77.1433] },
  SPE604: { office: 'DLA ENERGY', city: 'Fort Belvoir', state: 'VA', zip: '22060', coords: [38.6947, -77.1433] },
  SPE605: { office: 'DLA ENERGY', city: 'Fort Belvoir', state: 'VA', zip: '22060', coords: [38.6947, -77.1433] },
  SPE608: { office: 'DLA ENERGY', city: 'Fort Belvoir', state: 'VA', zip: '22060', coords: [38.6947, -77.1433] },
  SPE601: { office: 'DLA ENERGY AEROSPACE ENRGY-DLAE-M', city: 'JBSA Lackland', state: 'TX', zip: '78236', coords: [29.4241, -98.4936] },
};

/**
 * Extract the 6-char DoDAAC from a DIBBS solicitation number.
 * Handles both hyphenated ("SPE4A6-26-T-1523") and raw ("SPE4A626T1523") forms —
 * dibbs_rfqs stores the hyphenated form, raw.solicitationNumberRaw the other.
 * Returns null for anything too short to carry a DoDAAC.
 */
export function extractDodaac(solicitationNumber: string | null | undefined): string | null {
  if (!solicitationNumber) return null;
  const stripped = solicitationNumber.replace(/-/g, '').toUpperCase();
  if (stripped.length < 6) return null;
  return stripped.slice(0, 6);
}

/**
 * Resolve a DIBBS solicitation number to its buying-office location.
 * Returns null when the DoDAAC isn't mapped — callers MUST handle null rather
 * than defaulting to a placeholder pin (a wrong pin is worse than no pin).
 */
export function getDlaOfficeLocation(
  solicitationNumber: string | null | undefined
): DlaOfficeLocation | null {
  const dodaac = extractDodaac(solicitationNumber);
  if (!dodaac) return null;
  return DLA_DODAAC_LOCATIONS[dodaac] ?? null;
}

/**
 * Given a batch of solicitation numbers, return the distinct DoDAACs that have
 * NO entry above. Log this in the map/ingest path: DLA adds buying activities
 * over time, and unmapped codes silently vanish from the map otherwise.
 */
export function getUnmappedDodaacs(solicitationNumbers: Array<string | null | undefined>): string[] {
  const missing = new Set<string>();
  for (const sn of solicitationNumbers) {
    const dodaac = extractDodaac(sn);
    if (dodaac && !DLA_DODAAC_LOCATIONS[dodaac]) missing.add(dodaac);
  }
  return Array.from(missing).sort();
}
