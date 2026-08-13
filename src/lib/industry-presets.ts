/**
 * Industry Presets Configuration
 *
 * Shared configuration for industry categories and their NAICS codes.
 * Used by preferences UI and briefing generators.
 */

export interface IndustryPreset {
  label: string;      // Display label with emoji
  name: string;       // Clean name without emoji
  codes: string[];    // NAICS codes for this industry
  /**
   * PSC codes that define this industry by WHAT WAS BOUGHT — for industries that
   * NAICS can't cleanly separate. Cybersecurity is the case: it has no NAICS of its
   * own (it spreads across every IT code), so the honest signal is PSC DJ01/DJ10
   * "IT Security & Compliance" (grounded in live USASpending — a real $4.1B+ market).
   * Optional: NAICS-only industries omit it. (Memory: naics_vs_psc_search — PSC = what
   * was bought, the more accurate axis for a capability like cyber.)
   */
  psc?: string[];
  description: string;
}

/**
 * ⚠️ TAXONOMY RULE (Eric 2026-08-02, "getting the industry right is a big deal"): every
 * NAICS code below lives in EXACTLY ONE industry — the presets are mutually exclusive so
 * a user who separates two searches (e.g. "IT Services" vs "Cybersecurity") gets two
 * DISTINCT markets, not overlapping ones. Grounded in Census NAICS defs + live
 * USASpending. Two rules the data forced:
 *  1. Cyber has no NAICS home — it's PSC (DJ01/DJ10) + 518210 hosting, NOT the IT codes
 *     (which stay with IT Services). 541512/541519 were double-listed IT↔Cyber — REMOVED
 *     from Cyber.
 *  2. A broad "parent" code must NOT carry children that have their own bucket: Professional
 *     Services was bare '541' (swallowed ALL of IT + Cyber) → narrowed to the consulting/
 *     management/engineering codes only. (The picker also de-dups on Apply so overlapping
 *     selections aren't double-counted.)
 *
 * ⚠️ ONE KNOWN, MEASURED EXCEPTION to rule 1 — do not "discover" it again and panic:
 * Medical Supplies owns 423450 (medical wholesale), which is a CHILD of Products & Wholesale's
 * '423'. Selecting Products & Wholesale therefore also returns medical wholesale. Measured
 * 2026-08-13: 22 active opportunities, 3% of the Medical Supplies bucket. Enforcing exclusivity
 * would mean enumerating ~40 sibling codes under 423 to express "423 EXCEPT 423450", which is a
 * worse artifact than the 22-row overlap it removes. Documented rather than hidden. If the
 * wholesale corpus ever grows, revisit with a fresh count — not from memory.
 *
 * 📏 THE BUCKETS ARE SIZED FROM REAL DATA, not intuition (35,007 active opportunities,
 * 2026-08-13). Two edits came straight out of that census and are recorded at their entries:
 * Manufacturing was 41.7% of the map on its own (split), and Office & Industrial Supplies held
 * 15 rows that were 100% inside Products & Wholesale (merged). Before renaming or re-cutting a
 * category, COUNT IT — the last round of intuition put a nearly-empty bucket ("Products &
 * Wholesale", 202 rows) next to a 14,581-row one under equal visual weight.
 */

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  {
    label: 'Construction',
    name: 'Construction',
    codes: ['236', '237', '238'],
    description: 'Building, heavy civil, specialty trades'
  },
  {
    label: 'IT Services',
    name: 'IT Services',
    // The full IT/computer NAICS family — GENERAL IT (software, systems design, data).
    // Cyber's shared codes (541512/541519) stay HERE; cyber is split out by PSC below.
    codes: ['541511', '541512', '541513', '541519'],
    description: 'Software, systems design, data processing'
  },
  {
    label: 'Cybersecurity',
    name: 'Cybersecurity',
    // Cyber has NO NAICS of its own (it's billed across every IT code) — so the market is
    // defined by WHAT WAS BOUGHT: PSC DJ01/DJ10 "IT Security & Compliance" (a real $4.1B+
    // market), plus NAICS 518210 (hosting/data-protection) for managed-security/cloud
    // firms billed there. A network-security firm picks THIS and gets security + hosting
    // work, not all of IT. NO 541512/541519 here (that was the IT↔Cyber overlap).
    codes: ['518210'],
    psc: ['DJ01', 'DJ10'],
    description: 'Security & compliance work, data protection'
  },
  {
    label: 'Professional Services',
    name: 'Professional Services',
    // The CONSULTING / management / engineering / R&D core of 541 — NOT bare '541', which
    // swallowed all of IT Services + Cybersecurity. Each of those has its own bucket, so
    // this excludes the 5415xx IT codes and keeps the pro-services 6-digit codes.
    codes: ['541611', '541612', '541618', '541690', '541330', '541990', '541211', '541310', '541910'],
    description: 'Consulting, engineering, R&D, management'
  },
  {
    label: 'Healthcare',
    name: 'Healthcare',
    codes: ['621', '622', '623'],
    description: 'Medical, hospitals, nursing care'
  },
  {
    label: 'Logistics & Supply',
    name: 'Logistics & Supply',
    codes: ['493', '484', '488'],
    description: 'Warehousing, trucking, transportation'
  },
  {
    label: 'Facilities & Maintenance',
    name: 'Facilities & Maintenance',
    codes: ['561210', '561720', '561730'],
    description: 'Janitorial, landscaping, building services'
  },
  {
    label: 'Training & Education',
    name: 'Training & Education',
    codes: ['611430', '611420', '611710'],
    description: 'Professional training, educational services'
  },
  // PRODUCT / RESELLER verticals (added Jun 2026 — the picker was all SERVICES;
  // sellers of goods, esp. medical-supply students, had nowhere to land. NAICS
  // grounded in real USASpending "medical supplies" spend: 423450 wholesale,
  // 339112/339113 instruments+appliances, 325412 pharma.)
  {
    label: 'Medical Supplies & Equipment',
    name: 'Medical Supplies & Equipment',
    codes: ['423450', '339112', '339113', '325412', '339115'],
    description: 'Sell medical/dental/hospital supplies, devices, instruments'
  },
  {
    label: 'Products & Wholesale',
    name: 'Products & Wholesale',
    // ABSORBED "Office & Industrial Supplies" (measured 2026-08-13). That bucket held 15 active
    // opportunities and 100% of them already fell inside 423/424 — a strict subset competing with
    // its own parent for the same 15 rows. Only 453210 (office-supply RETAIL) sat outside, so it
    // moves here and the category is retired.
    codes: ['423', '424', '453210'],
    description: 'Resell/distribute goods — office, industrial, MRO, any product line'
  },
  // Manufacturing was SPLIT (measured 2026-08-13): 332/333/334/335 together matched 14,581 active
  // opportunities = 41.7% of the whole map, more than the other eleven categories combined. One
  // label over 42% of the market tells a contractor nothing about whether it is their work. The
  // split is even (332: 4,756 · 333: 3,245 · 334: 4,795 · 335: 1,785) and falls on the natural
  // seam: things you fabricate/machine vs things that are electronic or electrical.
  {
    label: 'Machinery & Metal Fabrication',
    name: 'Machinery & Metal Fabrication',
    codes: ['332', '333'],
    description: 'Machine shops, structural metal, valves, industrial machinery'
  },
  {
    label: 'Electronics & Electrical',
    name: 'Electronics & Electrical',
    codes: ['334', '335'],
    description: 'Computers, comms gear, instruments, motors, wiring'
  },
  {
    // NEW (measured 2026-08-13). 336xxx was the single largest blind spot in the browse list:
    // 3,878 active opportunities — 11% of the map, bigger than every category except Manufacturing
    // and Construction — reachable only by typing exact NAICS into Filters.
    label: 'Vehicles & Transportation Equipment',
    name: 'Vehicles & Transportation Equipment',
    codes: ['336'],
    description: 'Aircraft, ships, vehicles, engines and parts'
  },
];

/**
 * Get industry preset by name
 */
export function getIndustryPreset(name: string): IndustryPreset | undefined {
  return INDUSTRY_PRESETS.find(
    p => p.name === name || p.label === name || p.label.includes(name)
  );
}

/**
 * Get NAICS codes for an industry name
 */
export function getIndustryNaicsCodes(name: string): string[] {
  const preset = getIndustryPreset(name);
  return preset?.codes || [];
}

/**
 * Prioritize NAICS codes by primary industry
 *
 * @param naicsCodes - All user NAICS codes
 * @param primaryIndustry - Primary industry name
 * @returns Reordered NAICS codes with primary industry codes first
 */
export function prioritizeNaicsByIndustry(
  naicsCodes: string[],
  primaryIndustry: string | null | undefined
): string[] {
  if (!primaryIndustry || naicsCodes.length === 0) {
    return naicsCodes;
  }

  const primaryCodes = getIndustryNaicsCodes(primaryIndustry);
  if (primaryCodes.length === 0) {
    return naicsCodes;
  }

  // Split into primary and secondary codes
  const primaryMatches: string[] = [];
  const secondary: string[] = [];

  for (const code of naicsCodes) {
    // Check if code matches any primary industry code (prefix match)
    const isPrimary = primaryCodes.some(primaryCode =>
      code.startsWith(primaryCode) || primaryCode.startsWith(code)
    );

    if (isPrimary) {
      primaryMatches.push(code);
    } else {
      secondary.push(code);
    }
  }

  // Return primary codes first, then secondary
  return [...primaryMatches, ...secondary];
}

/**
 * Common 6-digit NAICS codes for 3-digit prefixes
 * USASpending API requires full 6-digit codes - doesn't accept prefixes
 */
const NAICS_EXPANSION_MAP: Record<string, string[]> = {
  // Construction (236, 237, 238)
  '236': ['236115', '236116', '236118', '236210', '236220'],  // Building construction
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'],  // Heavy/civil construction
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'],  // Specialty trade contractors

  // Professional Services (541)
  '541': ['541110', '541211', '541310', '541330', '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541710', '541715', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541990'],

  // Healthcare (621, 622, 623)
  '621': ['621111', '621112', '621210', '621310', '621320', '621330', '621340', '621391', '621399', '621410', '621420', '621491', '621492', '621493', '621498', '621511', '621512', '621610', '621910', '621991', '621999'],
  '622': ['622110', '622210', '622310'],
  '623': ['623110', '623210', '623220', '623311', '623312', '623990'],

  // Logistics/Warehousing (493, 484, 488)
  '493': ['493110', '493120', '493130', '493190'],
  '484': ['484110', '484121', '484122', '484210', '484220', '484230'],
  '488': ['488111', '488119', '488190', '488210', '488310', '488320', '488330', '488390', '488410', '488490', '488510', '488991', '488999'],
};

/**
 * Expand short NAICS codes (3-4 digits) to full 6-digit codes
 *
 * USASpending API requires full 6-digit NAICS codes and returns null for prefixes.
 * This function expands common prefixes to their most common full codes.
 *
 * @param naicsCodes - Array of NAICS codes (may include 3-4 digit prefixes)
 * @returns Array of 6-digit NAICS codes
 */
export function expandNaicsPrefixes(naicsCodes: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const code of naicsCodes) {
    const trimmed = code.trim();

    // Already 6 digits - use as-is
    if (trimmed.length >= 6) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        expanded.push(trimmed);
      }
      continue;
    }

    // Check if we have an expansion for this prefix
    const expansions = NAICS_EXPANSION_MAP[trimmed];
    if (expansions && expansions.length > 0) {
      for (const fullCode of expansions) {
        if (!seen.has(fullCode)) {
          seen.add(fullCode);
          expanded.push(fullCode);
        }
      }
    } else {
      // No expansion map - pad with zeros (e.g., "5415" -> "541500")
      const padded = trimmed.padEnd(6, '0');
      if (!seen.has(padded)) {
        seen.add(padded);
        expanded.push(padded);
      }
    }
  }

  return expanded;
}

/**
 * Check if a NAICS code is a prefix (less than 6 digits)
 */
export function isNaicsPrefix(code: string): boolean {
  return code.trim().length < 6;
}

/**
 * Check if any NAICS codes in the array need expansion
 */
export function hasNaicsPrefixes(naicsCodes: string[]): boolean {
  return naicsCodes.some(code => isNaicsPrefix(code));
}
