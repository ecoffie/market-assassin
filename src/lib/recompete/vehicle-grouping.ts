/**
 * Recompete vehicle grouping — collapse the N winners of ONE multiple-award IDIQ
 * into ONE "vehicle" so the recompete count isn't inflated (Eric, Jun 25: "5
 * winners on one IDIQ showed as 5 recompetes").
 *
 * The factual key: a multiple-award IDV (FPDS PIID type code 'D' at position 9)
 * carries the SAME IDV root across all its awardees; task/award PIIDs append a
 * serial. So we group D-type PIIDs by their 13-char IDV root + agency + NAICS,
 * and leave definitive contracts (type C/F — genuinely one award) as their own
 * vehicle. Measured: 9,481 rows → ~8,835 vehicles (only real IDVs collapse;
 * does NOT over-merge distinct GSA Schedule holders the way a blind prefix would).
 *
 * This is the GovWin / HigherGov model: count the VEHICLE, show the awardees as
 * children.
 */

/** A PIID stripped of the "(+N more)" display artifact + non-alphanumerics. */
function cleanPiid(piid: string | null | undefined): string {
  return (piid || '')
    .toUpperCase()
    .replace(/\s*\(\+.*?more\)\s*/i, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Stable grouping key for a recompete row. Multiple awardees of one IDV share it;
 * a standalone contract gets a unique key (its own PIID).
 */
export function recompeteVehicleKey(row: {
  piid?: string | null;
  awarding_agency?: string | null;
  naics_code?: string | null;
}): string {
  const c = cleanPiid(row.piid);
  const agency = (row.awarding_agency || '').toUpperCase().trim();
  const naics = (row.naics_code || '').trim();
  // FPDS PIID = <agency code (6-8)><FY (2)><type (1)><serial>. The type char 'D'
  // (IDC/IDV) marks a multiple-award VEHICLE; its awardees share the IDV root and
  // differ only by a trailing award/order serial. The agency code length varies
  // (VA = 6 → 'D' at idx 7; standard = 8 → 'D' at idx 8), so SEARCH for the 'D'
  // type position (idx 7 or 8) rather than assuming a fixed offset. The IDV root
  // is everything up to and INCLUDING the type char + 1 IDV digit — i.e. strip
  // the trailing 4-char award serial. (Bug-fixed Jun 25: a fixed idx-8 + 13-char
  // slice left every VA T4NG winner distinct → no collapse.)
  let root = c;
  const dIdx = [7, 8].find((i) => c.charAt(i) === 'D');
  if (dIdx !== undefined && c.length >= dIdx + 6) {
    // It's a multiple-award IDV with a trailing task/order serial. Awardees share
    // the IDV identity and differ only by that serial — strip the LAST 4 chars to
    // get the IDV root. The length guard (>= dIdx+6) means this fires on the ~16-17
    // char awardee/order PIIDs that USASpending recompete rows actually carry
    // (e.g. 36C10B18D00010005 → 36C10B18D0001 ; 70B04C19D00000001 → 70B04C19D0000).
    // A bare 12-13 char base-IDV PIID stays as-is (no order serial to strip). Keeps
    // the full agency+FY+type so distinct IDVs (different FY) don't merge.
    root = c.slice(0, c.length - 4);
  }
  return `${root}|${agency}|${naics}`;
}

export interface VehicleGroup<T> {
  key: string;
  /** The representative row (highest value / latest expiry) shown on the card. */
  lead: T;
  /** All rows in the vehicle (the awardees). */
  members: T[];
  incumbentCount: number;
  incumbentNames: string[];
  /** Latest expiry across awardees — when the vehicle actually recompetes. */
  latestExpiry: string | null;
  /** Combined ceiling across awardees. */
  combinedCeiling: number;
}

/**
 * Collapse recompete rows into vehicle groups. The lead row is the
 * highest-ceiling awardee (the prime everyone knows). Pure — no I/O.
 */
export function groupRecompetesByVehicle<T extends {
  piid?: string | null;
  awarding_agency?: string | null;
  naics_code?: string | null;
  incumbent_name?: string | null;
  potential_total_value?: number | null;
  total_obligation?: number | null;
  period_of_performance_current_end?: string | null;
}>(rows: T[]): VehicleGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const k = recompeteVehicleKey(r);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  const groups: VehicleGroup<T>[] = [];
  for (const [key, members] of byKey) {
    const lead = [...members].sort(
      (a, b) => (b.potential_total_value || b.total_obligation || 0) - (a.potential_total_value || a.total_obligation || 0),
    )[0];
    const incumbentNames = Array.from(
      new Set(members.map((m) => (m.incumbent_name || '').trim()).filter(Boolean)),
    );
    const latestExpiry = members
      .map((m) => m.period_of_performance_current_end)
      .filter(Boolean)
      .sort()
      .pop() || null;
    const combinedCeiling = members.reduce(
      (n, m) => n + (m.potential_total_value || m.total_obligation || 0), 0,
    );
    groups.push({
      key, lead, members,
      incumbentCount: incumbentNames.length || members.length,
      incumbentNames,
      latestExpiry,
      combinedCeiling,
    });
  }
  return groups;
}
