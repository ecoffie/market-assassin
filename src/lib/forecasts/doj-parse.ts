/**
 * DOJ workbook parsing + normalization to the held corpus's conventions.
 *
 * ⚠️ NORMALIZED, NOT RAW. Writing raw cell values would report every matched row
 * as CHANGED and then rewrite the corpus in a different dialect. Measured against
 * the live held rows, the conventions are:
 *   naics_code          the 6-digit code only ("623990--Other…" -> "623990")
 *   naics_description   the text after the "--"
 *   fiscal_year         "FY" + year   ("2026" -> "FY2026")
 *   anticipated_quarter the AWARD date's quarter (97.9% match) — NOT solicitation (24.9%)
 *   contracting_office  the BUREAU code (333/333), not the source's office name
 *   estimated_value_*   parsed from the range band; label whitespace collapsed
 *   pop_state/pop_city  split from "Seattle, WA"
 *   pop_country         "United States" -> "USA"
 */
export interface DojParsedRow {
  atn: string;
  fields: Record<string, unknown>;
  derived: Record<string, unknown>;
}

const BLANK = /^(\[?tbd\]?|\[?tba\]?|n\/?a|na|none|unknown|null|undefined|-{1,}|\.)$/i;

export function dojCell(v: unknown): string | undefined {
  if (v === null || v === undefined || typeof v === 'boolean') return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** "623990--Other Residential Care Facilities" -> code + description. */
export function splitCoded(v: unknown): { code?: string; text?: string } {
  const s = dojCell(v); if (!s) return {};
  const m = /^([A-Za-z0-9]+)\s*-{2,}\s*(.*)$/.exec(s);
  if (m) return { code: m[1], text: m[2].trim() || undefined };
  return { code: s };
}

/** "Q4, 2026" -> "Q4". */
export function quarterOf(v: unknown): string | undefined {
  const s = dojCell(v); if (!s) return undefined;
  const m = /^Q([1-4])/i.exec(s);
  return m ? `Q${m[1]}` : undefined;
}

/** "2026" -> "FY2026". Guarded so a stray value cannot become a fiscal year. */
export function fyOf(v: unknown): string | undefined {
  const s = dojCell(v); if (!s) return undefined;
  const m = /(\d{4})/.exec(s); if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 2020 && n <= 2040 ? `FY${m[1]}` : undefined;
}

/** "$800,001  -  $850,000" -> {min, max, label}. Whitespace collapsed to match held. */
export function valueRange(v: unknown): { min?: number; max?: number; label?: string } {
  const s = dojCell(v); if (!s) return {};
  const nums = [...s.matchAll(/\$\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const label = s.replace(/\s*-\s*/, ' - ');
  if (nums.length >= 2) return { min: nums[0], max: nums[1], label };
  if (nums.length === 1) return { min: nums[0], label };
  return { label };
}

/**
 * "Seattle, WA" -> {city:'Seattle', state:'WA'}.
 *
 * ⚠️ BRACKETED PLACEHOLDERS GO IN pop_state, NOT pop_city. DOJ writes
 * "[Nationwide]" (88 held rows), "[International]" and "[Many locations across
 * the United States]" where a place would be. The held corpus stores those in
 * pop_state with pop_city NULL. An earlier draft put them in pop_city, which
 * reported 92 rows as CHANGED and would have inverted the convention on every
 * one of them.
 *
 * A bare unbracketed token is a city with no state — never a guessed state.
 */
export function placeOf(v: unknown): { city?: string; state?: string } {
  const s = dojCell(v); if (!s) return {};
  const m = /^(.*),\s*([A-Z]{2})$/.exec(s);
  if (m) return { city: m[1].trim() || undefined, state: m[2] };
  if (/^\[.*\]$/.test(s)) return { state: s };      // placeholder, not a city
  return { city: s };
}

/**
 * The DOJ headers this parser reads, keyed by the role each plays.
 *
 * ⚠️ COLUMNS ARE FOUND BY HEADER NAME, NEVER BY POSITION. The 2026-11-18 edition
 * grew from 34 to 37 columns: DOJ inserted `Component`, `Actual Award Date` and
 * `Contract Canceled Date` ahead of `Incumbent Contractor PIID`, which moved from
 * index 30 to 33. A fixed-index parser kept reading index 30 and wrote component
 * codes ('BOP', 'FBI', …) into incumbent_contract_number. Added columns are
 * tolerated; a MISSING required header fails the run closed (`header_drift`)
 * rather than silently mapping some other column onto a field.
 */
export const DOJ_REQUIRED_HEADERS = {
  fiscalYear: 'Fiscal Year',
  atn: 'Action Tracking Number',
  bureau: 'Bureau',
  sbPocName: 'DOJ Small Business POC - Name',
  sbPocEmail: 'DOJ Small Business POC - Email Address',
  title: 'Contract Name',
  description: 'Description of Requirement',
  contractType: 'Contract Type (Pricing)',
  naics: 'NAICS Code',
  psc: 'Product Service Code',
  competition: 'Competition Approach',
  setAside: 'Small Business Approach',
  valueRange: 'Estimated Total Contract Value (Range)',
  awardDate: 'Target Award Date',
  place: 'Place of Performance',
  country: 'Country',
  status: 'Acquisition History',
  incumbentName: 'Incumbent Contractor',
  incumbentPiid: 'Incumbent Contractor PIID',
} as const;

export type DojColumn = keyof typeof DOJ_REQUIRED_HEADERS;
export type DojColumnMap = Record<DojColumn, number>;

/** Header comparison ignores case and whitespace runs only — no fuzzy matching. */
function headerKey(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Resolve every required column from the header row. A required header that is
 * absent — or present more than once (which column would be the real one?) —
 * is reported by name; the caller must refuse the run.
 */
export function resolveDojColumns(header: unknown[]):
  | { ok: true; columns: DojColumnMap }
  | { ok: false; missing: string[]; duplicated: string[] } {
  const positions = new Map<string, number[]>();
  header.forEach((h, i) => {
    const k = headerKey(h);
    if (!k) return;
    positions.set(k, [...(positions.get(k) ?? []), i]);
  });
  const missing: string[] = [];
  const duplicated: string[] = [];
  const columns = {} as DojColumnMap;
  for (const [role, name] of Object.entries(DOJ_REQUIRED_HEADERS) as Array<[DojColumn, string]>) {
    const at = positions.get(headerKey(name)) ?? [];
    if (at.length === 0) missing.push(name);
    else if (at.length > 1) duplicated.push(name);
    else columns[role] = at[0];
  }
  if (missing.length || duplicated.length) return { ok: false, missing, duplicated };
  return { ok: true, columns };
}

/** Map one sheet row onto the DB shape, reading each field from its NAMED column. */
export function mapDojRow(r: unknown[], c: DojColumnMap): DojParsedRow | null {
  const atn = dojCell(r[c.atn]);
  // No identity = not reconcilable. NEVER fall back to a status or title: that is
  // precisely how 'Active' and 'DOJ:**LES** Xone Outrider' became external_ids.
  if (!atn) return null;
  const naics = splitCoded(r[c.naics]);
  const psc = splitCoded(r[c.psc]);
  const val = valueRange(r[c.valueRange]);
  const place = placeOf(r[c.place]);
  const country = dojCell(r[c.country]);
  const bureau = dojCell(r[c.bureau]) ?? null;
  return {
    atn,
    fields: {
      external_id: atn,
      title: dojCell(r[c.title]) ?? null,
      description: dojCell(r[c.description]) ?? null,
      naics_code: naics.code ?? null,
      naics_description: naics.text ?? null,
      psc_code: psc.code ?? null,
      bureau,
      contracting_office: bureau,   // held stores the BUREAU code
      program_office: bureau,
      estimated_value_min: val.min ?? null,
      estimated_value_max: val.max ?? null,
      estimated_value_range: val.label ?? null,
      contract_type: dojCell(r[c.contractType]) ?? null,
      set_aside_type: dojCell(r[c.setAside]) ?? null,
      competition_type: dojCell(r[c.competition]) ?? null,
      poc_name: dojCell(r[c.sbPocName]) ?? null,
      poc_email: dojCell(r[c.sbPocEmail]) ?? null,
      incumbent_name: dojCell(r[c.incumbentName]) ?? null,
      incumbent_contract_number: dojCell(r[c.incumbentPiid]) ?? null,
      pop_state: place.state ?? null,
      pop_city: place.city ?? null,
      pop_country: country === 'United States' ? 'USA' : (country ?? null),
      status: dojCell(r[c.status]) ?? null,
    },
    derived: {
      fiscal_year: fyOf(r[c.fiscalYear]) ?? null,
      anticipated_quarter: quarterOf(r[c.awardDate]) ?? null,   // AWARD date, not solicitation
    },
  };
}

/**
 * DOJ SOLICITATION CODE — "2026-SG-0036", "2027-FS-0063".
 * DEA writes it as either a title prefix ("2026-SG-0036 - Widget") or a suffix
 * ("Widget - 2026-SG-0036"). The position moved between the June and August
 * editions, which is a formatting change, not a different procurement.
 */
const SOLICITATION_CODE = /\b\d{4}-[A-Z]{2}-\d{4}\b/g;

/**
 * Canonicalize a DOJ title for IDENTITY comparison only — never for storage.
 *
 * ⚠️ DELIBERATELY NARROW, AND DELIBERATELY NOT FUZZY. This removes ONLY
 * transformations proven present in the real matched population:
 *   • solicitation codes (they move between prefix and suffix)
 *   • separator/whitespace/punctuation noise
 *   • letter case
 * There is no edit-distance threshold, no token-overlap score, no similarity
 * model. Two titles are either mechanically equal after this, or they are NOT
 * the same record — because the alternative is deciding that "Parking Services"
 * and "Real Property Management Services" are close enough, which is exactly how
 * one procurement silently overwrites another.
 */
export function canonicalTitle(v: unknown): string {
  const s = dojCell(v);
  if (!s) return '';
  return s
    .replace(SOLICITATION_CODE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
