/**
 * Redact tool arguments before they are written to an execution log — STRICT ALLOWLIST.
 *
 * Only approved, validated structured filter values are stored verbatim: NAICS/PSC/state codes,
 * record identifiers, agency names, dates, numeric limits, enum values and known boolean flags.
 * Every other value — descriptions, proposal text, past-performance narratives, capability lists,
 * contact names/emails/phones, free-text queries and keywords, company and client names,
 * credentials — is replaced by metadata only:
 *   { redacted: true, type, len? (string length), count? (array length), digest? }
 * `digest` is an HMAC-SHA256 (first 16 hex) keyed with LOG_DIGEST_KEY, so identical inputs can be
 * correlated without being reversible by dictionary. With no key configured, no digest is stored.
 *
 * An allowlisted field whose value fails validation is redacted too (with `invalid: true`), so a
 * free-text sentence placed in an id or code field can never be stored verbatim.
 */
import { createHmac } from 'node:crypto';

type Validator = (v: unknown) => boolean;

const str = (re: RegExp, max = 120): Validator => (v) => typeof v === 'string' && v.length <= max && re.test(v);
const listOf = (one: Validator, max = 50): Validator => (v) =>
  (Array.isArray(v) && v.length <= max && v.every(one)) ||
  (typeof v === 'string' && v.length <= 600 && v.split(',').map((s) => s.trim()).filter(Boolean).every(one));
const oneOrList = (one: Validator) => (v: unknown) => one(v) || listOf(one)(v);
const num: Validator = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrDigits: Validator = (v) => num(v) || (typeof v === 'string' && /^\d{1,6}$/.test(v));
const bool: Validator = (v) => typeof v === 'boolean';

const NAICS = str(/^\d{2,6}$/, 6);
const PSC = str(/^[A-Za-z0-9]{1,4}$/, 4);
const STATE = str(/^[A-Za-z]{2}$/, 2);
const ID = str(/^[A-Za-z0-9_.:-]{1,80}$/, 80);
const ENUM = str(/^[A-Za-z0-9_+ -]{1,40}$/, 40);
const AGENCY = (v: unknown) => str(/^[A-Za-z0-9 .,&()'/-]{1,100}$/, 100)(v) && String(v).trim().split(/\s+/).length <= 12;
const DATE = str(/^\d{4}-\d{2}-\d{2}$/, 10);

const ALLOW: Readonly<Record<string, Validator>> = {
  // classification codes
  naics: oneOrList(NAICS), naics_code: NAICS, naics_codes: listOf(NAICS),
  psc: oneOrList(PSC),
  state: oneOrList(STATE), states: listOf(STATE), country: str(/^[A-Za-z]{2,3}$/, 3),
  // record identifiers
  notice_id: ID, notice_ids: listOf(ID), confirm_notice_id: ID,
  solicitation_number: ID, piid: ID, piids: listOf(ID), contract_ids: listOf(ID),
  uei: str(/^[A-Za-z0-9]{12}$/, 12), cage: str(/^[A-Za-z0-9]{5}$/, 5), dodaac: str(/^[A-Za-z0-9]{6}$/, 6),
  schedule_id: ID, document_id: ID, document_ids: listOf(ID), job_id: ID, id: ID, parent_id: ID,
  vehicle: str(/^[A-Za-z0-9 +._()/-]{1,40}$/, 40),
  // agency identifiers
  agency: AGENCY, agency_name: AGENCY, subAgency: AGENCY, office: AGENCY,
  // dates and numeric limits
  date_from: DATE, date_to: DATE,
  limit: num, offset: num, page: num, months_window: num, months_min: num, months_ahead: num,
  min_value: num, max_value: num, fiscal_year: numOrDigits, from_fy: numOrDigits, to_fy: numOrDigits,
  as_of_year: numOrDigits, lead_months: num, days: num, days_back: num, closingDays: num, postedDays: num,
  recompete_months: num, open_closing_days: num, window_days: num, award_limit: num, limit_per_horizon: num,
  text_limit: num, text_offset: num, coverage_target: num, n: num, e: num, s: num, w: num,
  // enum-valued fields
  alert_frequency: ENUM, clearance: ENUM, document_type: ENUM, likelihood: ENUM, mode: ENUM, phase: ENUM,
  sapBuyer: ENUM, search_type: ENUM, sort_by: ENUM, source: ENUM, stage: ENUM, state_scope: ENUM,
  status: ENUM, noticeType: ENUM, setAside: ENUM, set_aside: ENUM, section_type: ENUM,
  // boolean flags
  alerts_enabled: bool, async: bool, coming_back: bool, coming_soon: bool, forecast: bool,
  forecast_include_past: bool, fullOpen: bool, hasContact: bool, hasDocs: bool, hideCommodity: bool,
  include_ai_discovery: bool, include_emerging: bool, include_ics: bool, include_idv: bool,
  include_owner_asserted: bool, open: bool, open_now: bool, recompete: bool, remote_only: bool,
  small_business_only: bool, paused: bool, enabled: bool,
};

/** Structured containers whose members are themselves checked against the allowlist. */
const CONTAINERS: ReadonlySet<string> = new Set(['filters', 'bbox', 'timeframe']);

const MAX_DEPTH = 3;

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

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (CONTAINERS.has(k) && v && typeof v === 'object' && !Array.isArray(v) && depth < MAX_DEPTH) {
      out[k] = redactObject(v as Record<string, unknown>, depth + 1);
      continue;
    }
    const check = Object.prototype.hasOwnProperty.call(ALLOW, k) ? ALLOW[k] : undefined;
    if (check) out[k] = check(v) ? v : meta(v, true);
    else out[k] = meta(v);
  }
  return out;
}

export function redactToolArgs(args: unknown): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) return { _args: meta(args, true) };
  return redactObject(args as Record<string, unknown>, 0);
}
