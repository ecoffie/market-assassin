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

/** Map one sheet row (34 cols) onto the DB shape. */
export function mapDojRow(r: unknown[]): DojParsedRow | null {
  const atn = dojCell(r[1]);
  // No identity = not reconcilable. NEVER fall back to a status or title: that is
  // precisely how 'Active' and 'DOJ:**LES** Xone Outrider' became external_ids.
  if (!atn) return null;
  const naics = splitCoded(r[15]);
  const psc = splitCoded(r[16]);
  const val = valueRange(r[23]);
  const place = placeOf(r[26]);
  const country = dojCell(r[27]);
  return {
    atn,
    fields: {
      external_id: atn,
      title: dojCell(r[9]) ?? null,
      description: dojCell(r[11]) ?? null,
      naics_code: naics.code ?? null,
      naics_description: naics.text ?? null,
      psc_code: psc.code ?? null,
      bureau: dojCell(r[2]) ?? null,
      contracting_office: dojCell(r[2]) ?? null,   // held stores the BUREAU code
      program_office: dojCell(r[2]) ?? null,
      estimated_value_min: val.min ?? null,
      estimated_value_max: val.max ?? null,
      estimated_value_range: val.label ?? null,
      contract_type: dojCell(r[13]) ?? null,
      set_aside_type: dojCell(r[18]) ?? null,
      competition_type: dojCell(r[17]) ?? null,
      poc_name: dojCell(r[5]) ?? null,
      poc_email: dojCell(r[6]) ?? null,
      incumbent_name: dojCell(r[29]) ?? null,
      incumbent_contract_number: dojCell(r[30]) ?? null,
      pop_state: place.state ?? null,
      pop_city: place.city ?? null,
      pop_country: country === 'United States' ? 'USA' : (country ?? null),
      status: dojCell(r[28]) ?? null,
    },
    derived: {
      fiscal_year: fyOf(r[0]) ?? null,
      anticipated_quarter: quarterOf(r[25]) ?? null,   // AWARD date, not solicitation
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
