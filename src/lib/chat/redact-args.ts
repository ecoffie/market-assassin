/**
 * Redact tool arguments before they are written to an execution log — STRICT ALLOWLIST.
 *
 * A value is stored verbatim ONLY when its meaning is validated, not just its characters:
 *   - enum fields:   the value must be one of the tool schema's declared enum values
 *   - codes:         NAICS (2–6 digits), PSC (≤4 uppercase alnum), real US state/territory codes
 *   - identifiers:   per-field patterns (SAM notice id = 32 hex, UUIDs, uppercase PIID/solicitation
 *                    forms with a letter and a digit, USASpending generated ids, UEI/CAGE/DoDAAC
 *                    shapes). Lowercase tokens, phone/SSN shapes, "." and "_" never match a PIID.
 *                    Residual: an uppercase token of PIID shape cannot be told apart from a PIID.
 *   - agencies:      must match a known agency name or alias (src/data/agency-aliases.json)
 *   - dates/numbers: ISO dates, finite numbers, 4-digit fiscal years
 *   - flags:         known boolean keys
 * Lists are capped (≤ MAX_LIST items) and every item must validate. Everything else — descriptions,
 * proposal text, past performance, capabilities, contact names/emails/phones, free-text queries and
 * keywords, company/client names, credentials, unknown keys — is replaced with metadata only:
 *   { redacted: true, type, len? (string length), count? (array length), digest?, invalid? }
 * `digest` is HMAC-SHA256 (16 hex) keyed with LOG_DIGEST_KEY; with no key, no digest is stored.
 */
import { createHmac } from 'node:crypto';
import aliasData from '@/data/agency-aliases.json';

type JsonSchema = { properties?: Record<string, JsonSchema>; enum?: unknown[]; items?: JsonSchema; type?: unknown };
type Validator = (v: unknown) => boolean;

const MAX_LIST = 25;
const MAX_DEPTH = 3;

const US_CODES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP UM').split(' '),
);

const KNOWN_AGENCIES: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  const aliases = (aliasData as { aliases?: Record<string, string> }).aliases ?? {};
  for (const [k, v] of Object.entries(aliases)) {
    s.add(k.trim().toLowerCase());
    if (typeof v === 'string') s.add(v.trim().toLowerCase());
  }
  return s;
})();

const re = (pattern: RegExp, max: number): Validator => (v) => typeof v === 'string' && v.length <= max && pattern.test(v);
const hasDigit = (v: unknown) => typeof v === 'string' && /\d/.test(v);
const items = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v.length <= MAX_LIST ? v : null;
  if (typeof v === 'string' && v.includes(',')) {
    const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
    return parts.length <= MAX_LIST ? parts : null;
  }
  return null;
};
const listOf = (one: Validator): Validator => (v) => { const xs = items(v); return !!xs && xs.length > 0 && xs.every(one); };
const oneOrList = (one: Validator): Validator => (v) => one(v) || listOf(one)(v);

const NAICS = re(/^\d{2,6}$/, 6);
const PSC = re(/^[A-Z0-9]{1,4}$/, 4);
const STATE: Validator = (v) => typeof v === 'string' && US_CODES.has(v.toUpperCase()) && v.length === 2;
const SAM_NOTICE_ID = re(/^[0-9a-f]{32}$/, 32);
const UUID = re(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 36);
/**
 * PIID / solicitation number: uppercase letters + digits, optional hyphen groups (≤ 4), at least one
 * letter and one digit, no "." or "_". Phone, SSN and digit-only shapes are rejected.
 * RESIDUAL RISK (documented, not claimed away): an uppercase alphanumeric string of PIID length is
 * indistinguishable from a real PIID by shape alone, so such a value can still be stored verbatim.
 */
const PHONE_OR_SSN = /^(\d{3}-\d{2}-\d{4}|\d{3}-\d{3}-\d{4}|\d{10,11})$/;
/** Known credential prefixes (AWS, GoHighLevel PIT, OpenAI/Stripe sk-, GitHub, Slack, Google). */
const SECRET_PREFIX = /^(AKIA|ASIA|AGPA|AIDA|PIT-|SK-|RK-|PK-|GHP|GHO|GHU|GHS|XOX|AIZA)/;
const AWARD_ID: Validator = (v) =>
  typeof v === 'string' && /^[A-Z0-9]+(-[A-Z0-9]+){0,4}$/.test(v) && v.replace(/-/g, '').length >= 6 &&
  v.length <= 30 && /[A-Z]/.test(v) && hasDigit(v) && !PHONE_OR_SSN.test(v) && !SECRET_PREFIX.test(v);
/** USASpending generated ids (e.g. CONT_AWD_W912EQ24P0035_9700_-NONE-_-NONE-, CONT_IDV_GS07F0060N_4730). */
const GENERATED_AWARD_ID = re(/^(CONT_(AWD|IDV)|ASST_(NON|AGG))_[A-Z0-9_-]{4,90}$/, 100);
const CONTRACT_ID: Validator = (v) => AWARD_ID(v) || GENERATED_AWARD_ID(v);
const UEI: Validator = (v) => re(/^[A-Z0-9]{12}$/, 12)(v) && hasDigit(v) && /[A-Z]/.test(String(v));
const CAGE = re(/^[A-Z0-9]{5}$/, 5);
const DODAAC = re(/^[A-Z][A-Z0-9]{5}$/, 6);
const AGENCY: Validator = (v) => typeof v === 'string' && v.length <= 100 && KNOWN_AGENCIES.has(v.trim().toLowerCase());
const DATE = re(/^\d{4}-\d{2}-\d{2}$/, 10);
const NUM: Validator = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12;
const FY: Validator = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1990 && v <= 2100) || re(/^(19|20)\d{2}$/, 4)(v);
const BOOL: Validator = (v) => typeof v === 'boolean';

const STRUCTURED: Readonly<Record<string, Validator>> = {
  naics: oneOrList(NAICS), naics_code: NAICS, naics_codes: listOf(NAICS),
  psc: oneOrList(PSC),
  state: oneOrList(STATE), states: listOf(STATE),
  notice_id: SAM_NOTICE_ID, notice_ids: listOf(SAM_NOTICE_ID), confirm_notice_id: SAM_NOTICE_ID,
  solicitation_number: AWARD_ID, piid: AWARD_ID, piids: listOf(AWARD_ID), contract_ids: listOf(CONTRACT_ID), parent_id: CONTRACT_ID,
  schedule_id: UUID, document_id: UUID, document_ids: listOf(UUID), job_id: UUID, id: UUID,
  uei: UEI, cage: CAGE, dodaac: DODAAC,
  agency: AGENCY, agency_name: AGENCY, subAgency: AGENCY, office: AGENCY,
  date_from: DATE, date_to: DATE,
  limit: NUM, offset: NUM, page: NUM, months_window: NUM, months_min: NUM, months_ahead: NUM,
  min_value: NUM, max_value: NUM, lead_months: NUM, days: NUM, days_back: NUM, closingDays: NUM, postedDays: NUM,
  recompete_months: NUM, open_closing_days: NUM, window_days: NUM, award_limit: NUM, limit_per_horizon: NUM,
  text_limit: NUM, text_offset: NUM, coverage_target: NUM, n: NUM, e: NUM, s: NUM, w: NUM,
  fiscal_year: FY, from_fy: FY, to_fy: FY, as_of_year: FY,
  alerts_enabled: BOOL, async: BOOL, coming_back: BOOL, coming_soon: BOOL, forecast: BOOL,
  forecast_include_past: BOOL, fullOpen: BOOL, hasContact: BOOL, hasDocs: BOOL, hideCommodity: BOOL,
  include_ai_discovery: BOOL, include_emerging: BOOL, include_ics: BOOL, include_idv: BOOL,
  include_owner_asserted: BOOL, open: BOOL, open_now: BOOL, recompete: BOOL, remote_only: BOOL,
  small_business_only: BOOL, paused: BOOL, enabled: BOOL,
};

/** Structured containers whose members are checked against the same rules. */
const CONTAINERS: ReadonlySet<string> = new Set(['filters', 'bbox', 'timeframe', 'advanced']);

function digest(s: string): string | undefined {
  const key = process.env.LOG_DIGEST_KEY;
  if (!key) return undefined;
  return createHmac('sha256', key).update(s).digest('hex').slice(0, 16);
}

function meta(value: unknown, invalid = false): Record<string, unknown> {
  const out: Record<string, unknown> = { redacted: true };
  if (invalid) out.invalid = true;
  if (typeof value === 'string') {
    out.type = 'string';
    out.len = value.length;
    const d = digest(value);
    if (d) out.digest = d;
  } else if (Array.isArray(value)) {
    out.type = 'array';
    out.count = value.length;
  } else if (value === null) {
    out.type = 'null';
  } else {
    out.type = typeof value;
  }
  return out;
}

function enumAllows(prop: JsonSchema | undefined, v: unknown): boolean | undefined {
  const list = prop?.enum ?? prop?.items?.enum;
  if (!Array.isArray(list)) return undefined; // field has no declared enum
  if (Array.isArray(v)) return v.length <= MAX_LIST && v.every((x) => list.includes(x));
  return list.includes(v);
}

function redactObject(obj: Record<string, unknown>, schema: JsonSchema | undefined, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const prop = schema?.properties?.[k];
    if (CONTAINERS.has(k) && v && typeof v === 'object' && !Array.isArray(v) && depth < MAX_DEPTH) {
      out[k] = redactObject(v as Record<string, unknown>, prop, depth + 1);
      continue;
    }
    const byEnum = enumAllows(prop, v);
    if (byEnum !== undefined) { out[k] = byEnum ? v : meta(v, true); continue; }
    const check = Object.prototype.hasOwnProperty.call(STRUCTURED, k) ? STRUCTURED[k] : undefined;
    if (check) out[k] = check(v) ? v : meta(v, true);
    else out[k] = meta(v);
  }
  return out;
}

/**
 * @param schema the tool's JSON Schema `parameters` (enables the enum check). Without it, enum
 *   fields are not recognized and are redacted — the safe default.
 */
export function redactToolArgs(args: unknown, schema?: JsonSchema): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) return { _args: meta(args, true) };
  return redactObject(args as Record<string, unknown>, schema, 0);
}
