/**
 * Event data quality: the three read/classify rules shared by the events query and the SAM event
 * extractor. Measured 2026-11-07 against sam_events (7,576 rows) — see docs/REPAIR-LEDGER.md.
 *
 * 1. LOCATION. The extractor's old pattern `(?:at|location:|venue:)` had no word boundary, so the
 *    "at" inside "solicitATion" / "mATerial" captured the rest of the sentence: 4,985 of 6,208
 *    stored locations start mid-word ("ion", "ion (RFI)", "erial & Waste Disposal ..."). A location
 *    is shown only when it has the shape of a place ("City, ST" with a real state code).
 * 2. CLASSIFICATION. Keywords were matched as substrings, so "airfield" read as "rfi", and the first
 *    hit anywhere in title + description won, so an RFI whose body mentions an industry day became
 *    one. Keywords now match whole words, and an RFI title outranks body text.
 * 3. AGENCY. The query ORed `%term%` over three columns, so "VA" matched NAVAL / SAVANNAH offices and
 *    "Department of Energy" (key ENERGY) matched DLA ENERGY. Abbreviations resolve through
 *    agency-aliases.json, a department-level request matches the department column only, and
 *    everything else matches on word boundaries.
 */
import aliasData from '@/data/agency-aliases.json';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';
import { imatchClause } from '@/lib/discovery/matcher';

// ── 1. Location ──────────────────────────────────────────────────────────────

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR',
  'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI', 'AS', 'MP',
]);

/**
 * "Huntington, WV 25701": a capitalised first word of 3+ letters, an UPPERCASE state code, and a ZIP.
 * The ZIP is required because "City, ST" alone is ambiguous in this data: the old extractor took the
 * first two letters of a spelled-out state, so "MALMSTROM AIR FORCE BASE, MO" is a cut-off "MONTANA"
 * and "Malcom Randall VA Medical Center, Ga" a cut-off "Gainesville". A ZIP proves an address.
 */
const PLACE_SHAPE = /^([A-Z][A-Za-z.'-]{2,}(?:[ -][A-Za-z.'()&-]+)*),\s?([A-Z]{2})\s+\d{5}(?:-\d{4})?$/;

/** A location, or null when it is not provably a place. Never repairs; only withholds. */
export function cleanEventLocation(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 60) return null;
  const m = PLACE_SHAPE.exec(s);
  if (!m) return null;
  return US_STATE_CODES.has(m[2]) ? s : null;
}

/** Location from notice text, for the extractor: an explicit label, or a "City, ST 12345" address. */
export function extractEventLocation(text: string): string | null {
  const labelled = /\b(?:location|venue)\s*:\s*([^\n;]{3,80})/i.exec(text);
  if (labelled) {
    const v = cleanEventLocation(labelled[1].split(/[.]/)[0]);
    if (v) return v;
  }
  const address = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\s+\d{5})\b/.exec(text);
  return address ? cleanEventLocation(address[1]) : null;
}

// ── 2. Classification ────────────────────────────────────────────────────────

export const EVENT_KEYWORDS: Record<string, string[]> = {
  industry_day: ['industry day', 'vendor day', 'industry conference', 'vendor outreach', 'market research event', 'industry engagement'],
  webinar: ['webinar', 'virtual event', 'online session', 'video conference', 'zoom meeting'],
  rfi: ['request for information', 'rfi', 'sources sought', 'market survey'],
  forecast: ['forecast', 'projection', 'upcoming procurement', 'planned acquisition'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RE: Record<string, RegExp> = Object.fromEntries(
  Object.entries(EVENT_KEYWORDS).map(([type, words]) => [type, new RegExp(`(?<![a-z])(?:${words.map(escapeRe).join('|')})s?(?![a-z])`, 'i')]),
);

function firstType(text: string): string | null {
  for (const type of Object.keys(EVENT_KEYWORDS)) if (KEYWORD_RE[type].test(text)) return type;
  return null;
}

/**
 * Event type for a SAM notice, or null. Keywords match whole words. The title decides first: a title
 * that names an RFI / sources sought and no attendable event stays an RFI, whatever the body says.
 */
export function classifyEventText(title: string, description: string | null): string | null {
  const t = title || '';
  if (KEYWORD_RE.rfi.test(t) && !KEYWORD_RE.industry_day.test(t) && !KEYWORD_RE.webinar.test(t)) return 'rfi';
  return firstType(`${t} ${description || ''}`);
}

// ── 3. Agency matching ───────────────────────────────────────────────────────

const ALIASES = (aliasData as { aliases: Record<string, string> }).aliases;

/** Department names as sam_events.agency stores them (measured 2026-11-07), normalized to keys. */
const DEPARTMENT_KEYS = new Set(
  [
    'DEPT OF DEFENSE', 'VETERANS AFFAIRS, DEPARTMENT OF', 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
    'HOMELAND SECURITY, DEPARTMENT OF', 'COMMERCE, DEPARTMENT OF', 'GENERAL SERVICES ADMINISTRATION',
    'JUSTICE, DEPARTMENT OF', 'TRANSPORTATION, DEPARTMENT OF', 'INTERIOR, DEPARTMENT OF THE',
    'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION', 'ENERGY, DEPARTMENT OF', 'AGRICULTURE, DEPARTMENT OF',
    'STATE, DEPARTMENT OF', 'TREASURY, DEPARTMENT OF THE', 'ENVIRONMENTAL PROTECTION AGENCY', 'LABOR, DEPARTMENT OF',
    'HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF', 'EDUCATION, DEPARTMENT OF', 'SOCIAL SECURITY ADMINISTRATION',
  ].map(normalizeAgencyKey),
);

export interface EventAgencyScope {
  /** Normalized, regex-safe key, or '' when nothing usable was given. */
  key: string;
  /** True when the request names a department: match the department column only. */
  departmentOnly: boolean;
}

export function resolveEventAgencyScope(input: string): EventAgencyScope {
  const raw = (input || '').trim();
  const name = ALIASES[raw] ?? ALIASES[raw.toUpperCase()] ?? raw;
  const key = (normalizeAgencyKey(name) || normalizeAgencyKey(raw) || raw.toUpperCase())
    .replace(/[^A-Z0-9& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { key, departmentOnly: DEPARTMENT_KEYS.has(key) };
}

/** PostgREST `.or()` expression for sam_events rows in this agency scope ('' = no usable scope). */
export function eventAgencyOrClause(scope: EventAgencyScope): string {
  if (!scope.key) return '';
  const re = `\\m${scope.key}\\M`;
  const cols = scope.departmentOnly ? ['agency'] : ['agency', 'inferred_office', 'inferred_subagency'];
  return cols.map((c) => imatchClause(c, re)).join(',');
}
