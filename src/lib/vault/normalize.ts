/**
 * Vault normalization — the ONE place that turns loosely-typed parser output
 * (strings, formatted currency, single "period" strings, arbitrary arrays) into
 * the exact column shapes the Vault tables expect.
 *
 * Why this exists: the cap-statement review UI used to hand-assemble ~30 separate
 * POSTs, each re-deriving these mappings in the client. Every mismatch (string vs
 * numeric contract_value, "2022-2025" vs period_start/end dates, a missing agency
 * 400) silently dropped rows. This module + the /commit route move all coercion +
 * validation server-side, next to the columns, so there is a single source of
 * truth and a single place to fix. Also reusable by the manual Vault forms.
 *
 * Grounding rule (Eric #1): normalization NEVER invents facts. It only reshapes /
 * coerces what the parser produced; when a required field is absent it either
 * applies an explicit, visible placeholder (agency) or drops the field.
 */

// $ per the parser: "$10,900,000" | "$2.4M" | "1,176,585.00" | "900k". The DB
// contract_value column is NUMERIC. Returns null when there is no parseable number
// (e.g. "N/A", "TBD", "") so the caller omits the field rather than sending NaN.
export function parseCurrency(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*(k|m|b|million|billion|thousand)?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return null;
  const suffix = m[2];
  const mult =
    suffix === 'k' || suffix === 'thousand' ? 1e3
    : suffix === 'm' || suffix === 'million' ? 1e6
    : suffix === 'b' || suffix === 'billion' ? 1e9
    : 1;
  const val = Math.round(num * mult);
  return val > 0 ? val : null;
}

// "2022-2025" | "2021 – 2023" | "FY2024" → period_start / period_end as Jan-1 /
// Dec-31 date strings for the two date columns. Empty strings when no year found.
export function splitPeriod(raw: unknown): { start: string; end: string } {
  if (raw == null) return { start: '', end: '' };
  const years = String(raw).match(/(19|20)\d{2}/g);
  if (!years || years.length === 0) return { start: '', end: '' };
  const start = `${years[0]}-01-01`;
  const end = years.length > 1 ? `${years[years.length - 1]}-12-31` : '';
  return { start, end };
}

const str = (v: unknown) => String(v ?? '').trim();
const strArr = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : [];
const naicsArr = (v: unknown) =>
  Array.isArray(v)
    ? Array.from(new Set(v.map((x) => String(x).trim()).filter((c) => /^\d{6}$/.test(c)))).slice(0, 20)
    : [];

// ---- Row-shaped normalizers (parser object → DB column object) ---------

export interface ParsedPP {
  contract_title?: unknown; agency?: unknown; contract_number?: unknown;
  role?: unknown; scope_description?: unknown; period?: unknown; contract_value?: unknown;
}

/**
 * Normalize one parsed past-performance object into the columns
 * user_past_performance accepts. Returns { row, skipReason }:
 *  - row is null + skipReason set when the entry can't be a real row (no title).
 *  - a missing agency is FILLED with a visible placeholder (never dropped) so the
 *    row still lands and the user can fix it — this was the silent 400.
 */
export function normalizePastPerf(p: ParsedPP): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any> | null;
  skipReason?: string;
} {
  const contract_title = str(p.contract_title);
  if (!contract_title) return { row: null, skipReason: 'no contract title' };

  const agency = str(p.agency) || '(add customer/agency)';
  const value = parseCurrency(p.contract_value);
  const { start, end } = splitPeriod(p.period);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {
    contract_title,
    agency,
    contract_number: str(p.contract_number) || null,
    role: str(p.role) || null,
    scope_description: str(p.scope_description) || null,
  };
  if (value != null) row.contract_value = value;
  if (start) row.period_start = start;
  if (end) row.period_end = end;
  return { row };
}

export interface ParsedCap {
  capability_name?: unknown; description?: unknown; keywords?: unknown;
}

/**
 * Normalize one parsed capability. Requires a NAME (the only true requirement).
 * Cap statements often list competencies as a bare bullet list with NO supporting
 * sentence (e.g. "Historical Renovations") — those are valid capabilities, so a
 * missing description falls back to the name itself rather than dropping the row.
 * (This was silently losing all bullet-list competencies.)
 */
export function normalizeCapability(c: ParsedCap): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any> | null;
  skipReason?: string;
} {
  const capability_name = str(c.capability_name);
  if (!capability_name) return { row: null, skipReason: 'no capability name' };
  const description = str(c.description) || capability_name;
  return { row: { capability_name, description, keywords: strArr(c.keywords) } };
}

export interface ParsedIdentity { [k: string]: unknown }

// The identity fields the commit endpoint is allowed to write, with per-field
// coercion. certifications/primary_naics are arrays; the rest are trimmed strings.
const IDENTITY_STRING_FIELDS = [
  'legal_name', 'dba', 'uei', 'cage_code', 'duns', 'year_founded',
  'hq_city', 'hq_state', 'contact_name', 'contact_title', 'contact_email',
  'contact_phone', 'website', 'office_address', 'bonding_single', 'bonding_aggregate',
  'one_liner', 'elevator_pitch',
];

/**
 * Normalize the parsed overview + identity into a single user_identity_profile
 * patch. Only includes keys that carry a value (upsert preserves the rest).
 * `sourceText` (the doc's extracted text) grounds the website: a URL is kept only
 * if its host literally appears in the document — an invented one is dropped.
 */
export function normalizeIdentity(
  overview: { one_liner?: unknown; elevator_pitch?: unknown } | undefined,
  identity: ParsedIdentity | undefined,
  sourceText = '',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  const src = sourceText.toLowerCase();

  const merged: ParsedIdentity = {
    ...(identity || {}),
    ...(overview?.one_liner ? { one_liner: overview.one_liner } : {}),
    ...(overview?.elevator_pitch ? { elevator_pitch: overview.elevator_pitch } : {}),
  };

  for (const key of IDENTITY_STRING_FIELDS) {
    const v = str(merged[key]);
    if (!v) continue;
    if (key === 'website') {
      const host = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
      if (!host || !src.includes(host)) continue; // drop invented URLs
    }
    out[key] = v;
  }
  const certs = strArr(merged.certifications);
  if (certs.length) out.certifications = certs;
  const naics = naicsArr(merged.primary_naics);
  if (naics.length) out.primary_naics = naics;

  return out;
}
