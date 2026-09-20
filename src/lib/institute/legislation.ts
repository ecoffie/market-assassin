/**
 * THE MINDY INSTITUTE — ingestion of federal LEGISLATIVE documents.
 *
 *   CONGRESS -> INSTITUTE CORPUS -> STRATEGIC INTELLIGENCE -> product
 *
 * Sibling of src/lib/institute/sources.ts (GAO). Same contract, different body:
 * this layer decides what a legislative document IS, which version of it this is,
 * who it is ABOUT, and where it CAME FROM. It makes no interpretive claim —
 * derivation stays in src/lib/strategic-intel/derive.ts.
 *
 * ── WHY THIS EXISTS (the incident, 2026-09-18) ────────────────────────────────
 * Mindy had no legislative store at all. "FY2026 NDAA" existed only as 45 hardcoded
 * PROSE STRINGS in src/data/agency-pain-points.json, matched by `pp.includes('FY2026
 * NDAA')`. Their producer was ~/Bootcamp/scan-ndaa-sections.py — OUTSIDE the repo,
 * last touched 2026-01-14, with the bill number HARDCODED
 * (".../senate-bill/2296/text") and an error path that tells a human to download a
 * PDF by hand. So FY2027 was never "missed by a watcher": no watcher was ever
 * pointed at Congress. `grep api.congress.gov src` returned zero hits.
 *
 * ⚠️ THOSE 45 STRINGS ARE NOT AUTHORITATIVE NDAA RECORDS and this module does not
 * treat them as such. They are a separate, still-open correctness incident (they
 * cite S.2296, which never became law — "Held at the desk", laws:null). Nothing here
 * reads them, writes them, or blesses them.
 *
 * ── DISCOVERY IS DYNAMIC, BY CONSTRUCTION ─────────────────────────────────────
 * No bill number, no fiscal year, and no Congress number is hardcoded as the
 * steady-state discovery mechanism. We page the /bill/{congress} feed sorted by
 * updateDate desc and match on the TITLE pattern, so next year's FY2028 bill — with
 * a number nobody can know today — is found without a code change. `currentCongress()`
 * derives the Congress from the date. Proven live 2026-09-18: a title-pattern scan of
 * the recent-update window found HR8800 and S4784 with zero hardcoded identifiers,
 * plus S1071 (a second FY2026 NDAA vehicle) that the hardcoded script never knew existed.
 *
 * ── ONE ROW PER VERSION, NEVER ONE PER BILL ───────────────────────────────────
 * "NDAA 2027" is not a document; it is a FAMILY of documents that disagree with each
 * other. House-introduced, House-reported, House-engrossed, Senate-reported, the HASC
 * and SASC committee reports, conference text and the eventual enacted law are
 * SEPARATE records with separate provenance. Collapsing them would destroy the only
 * thing that makes legislative intelligence useful: knowing WHICH text you are reading
 * and whether it survived. The existing UNIQUE (source_type, document_number) enforces
 * this mechanically — each version carries its own document_number.
 *
 * ⚠️ AGENCY IDENTITY GOES THROUGH resolveAgency() ONLY — same rule as the GAO
 * collector, for the same reason (Potato 0: unanchored substring matching fanned one
 * report across four agencies).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAgency, type AgencyResolution } from '@/lib/strategic-intel/agency-resolver';
import type { InstituteDocument } from '@/lib/institute/sources';

const API_BASE = 'https://api.congress.gov/v3';

/**
 * api.congress.gov is an api.data.gov property and accepts the SAME key already
 * stored as GOVINFO_API_KEY. Verified live 2026-09-18.
 *
 * ⚠️ Distinct from govinfo.gov itself, whose key is separately recorded as
 * API_KEY_INVALID (src/lib/institute/sources.ts). Do not "fix" one by way of the other.
 */
export function congressApiKey(): string {
  return process.env.CONGRESS_API_KEY || process.env.GOVINFO_API_KEY || '';
}

/**
 * ⚠️ A DEFAULT User-Agent IS SILENTLY 403'd. Measured 2026-09-18: identical URLs
 * returned 200 under curl and HTTP 403 under a stock urllib UA. A 403 here would
 * surface as "no legislation found" — the exact missing-vs-empty confusion this whole
 * incident is about — so the UA is not optional politeness.
 */
const UA = 'Mindy-Institute (hello@getmindy.ai)';

/** The 119th Congress convened 2025-01-03; a new one begins every odd year. */
export function currentCongress(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const startYear = y % 2 === 0 ? y - 1 : y;
  const beforeConvening = y % 2 === 1 && now.getUTCMonth() === 0 && now.getUTCDate() < 3;
  return 119 + Math.floor((startYear - 2025) / 2) - (beforeConvening ? 1 : 0);
}

// ── VERSION VOCABULARY ───────────────────────────────────────────────────────
/**
 * Congress's own version codes. The short code becomes part of document_number, so
 * two versions of one bill can never collide on the unique key.
 * Reference: https://www.govinfo.gov/help/bills (bill version codes)
 */
const VERSION_CODES: Record<string, string> = {
  'introduced in house': 'IH',
  'introduced in senate': 'IS',
  'reported in house': 'RH',
  'reported in senate': 'RS',
  'reported to house': 'RH',
  'reported to senate': 'RS',
  'engrossed in house': 'EH',
  'engrossed in senate': 'ES',
  'engrossed amendment house': 'EAH',
  'engrossed amendment senate': 'EAS',
  'enrolled bill': 'ENR',
  'placed on calendar house': 'PCH',
  'placed on calendar senate': 'PCS',
  'referred in house': 'RFH',
  'referred in senate': 'RFS',
  'received in house': 'RDH',
  'received in senate': 'RDS',
  'considered and passed house': 'CPH',
  'considered and passed senate': 'CPS',
  'public print': 'PP',
};

/**
 * Map a version label to a stable short code. An UNKNOWN label is slugified rather
 * than dropped or bucketed — a version we cannot name is still a distinct version,
 * and silently merging it into a sibling is precisely the collapse this module exists
 * to prevent.
 */
export function versionCode(label: string): string {
  const key = label.trim().toLowerCase();
  if (VERSION_CODES[key]) return VERSION_CODES[key];
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().slice(0, 24) || 'UNKNOWN';
}

/** Chamber of origin from the bill type. Deliberately explicit, never inferred from a title. */
export function chamberOf(billType: string): 'House' | 'Senate' | 'unknown' {
  const t = billType.trim().toUpperCase();
  if (t.startsWith('HR') || t.startsWith('HJRES') || t.startsWith('HCONRES') || t.startsWith('HRES')) return 'House';
  if (t.startsWith('S') && !t.startsWith('SA')) return 'Senate';
  return 'unknown';
}

/**
 * The fiscal year a measure AUTHORIZES, parsed from its own title — never assumed
 * from the calendar. An FY2027 bill is worked in CY2026, so a calendar-derived guess
 * would be wrong for most of its life.
 */
export function fiscalYearFromTitle(title: string): number | null {
  const m = title.match(/fiscal year\s+(\d{4})/i) ?? title.match(/\bFY\s?(\d{4})\b/i);
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  return y >= 1900 && y <= 2200 ? y : null;
}

/**
 * Every source_type this collector can emit — the SCOPE of the legislative corpus.
 *
 * ⚠️ THIS IS A CLOCK BOUNDARY, NOT A CONVENIENCE LIST. institute_sources is SHARED
 * with the GAO collector, which writes to it daily. Any "newest row" query that does
 * not filter by these types reports GAO's activity as legislative activity — a
 * legislative ingest could be dead for months while its clock looked fresh, which is
 * this workstream's founding failure mode wearing a different hat.
 *
 * Kept in sync with the source_type CHECK (20260918 migration) by a unit test.
 */
export const LEGISLATIVE_SOURCE_TYPES = [
  'introduced_bill',
  'enacted_law',
  'committee_report',
] as const;

// ── TYPES ────────────────────────────────────────────────────────────────────
export interface BillRef {
  congress: number;
  billType: string;   // 'HR' | 'S' | ...
  number: string;     // '8800'
  title: string;
  updateDate: string | null;
  originChamber: string | null;
}

export interface LegislativeStatus {
  latestActionDate: string | null;
  latestActionText: string | null;
  becameLaw: boolean;
  lawNumber: string | null;
}

/**
 * What a discovery pass OBSERVED — the honest four-state answer.
 *
 * ⚠️ THE WHOLE POINT. "Mindy has nothing" must never be indistinguishable from
 * "nothing exists". These states are mutually exclusive and each is reported as
 * ITSELF:
 *   source_unavailable  — the API failed. NOT "no legislation".
 *   not_yet_introduced  — the API answered and the measure genuinely does not exist.
 *   introduced          — it exists; whether it has advanced is `advanced`.
 *   enacted             — it became law.
 */
export type DiscoveryState = 'source_unavailable' | 'not_yet_introduced' | 'introduced' | 'enacted';

export interface DiscoveryOutcome {
  state: DiscoveryState;
  pollOk: boolean;
  billsSeen: number;
  matched: BillRef[];
  scannedPages: number;
  error?: string;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`congress.gov ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * ⚠️ DO NOT BUILD THIS URL WITH URLSearchParams.
 *
 * congress.gov's sort value is literally `updateDate+desc`. URLSearchParams
 * percent-encodes that `+` to `%2B`, and the API DOES NOT ERROR on the malformed
 * value — it silently ignores the sort and returns a DIFFERENT ordering.
 *
 * Measured 2026-09-18: with `%2B`, H.R. 8800 was absent from the offset=1000 page;
 * with a literal `+` it was present at that exact offset. A collector built on the
 * encoded form scans real pages, gets real 200s, and quietly never sees the bill —
 * a silent-coverage failure indistinguishable from "no such legislation", which is
 * the precise class of bug this whole workstream exists to eliminate.
 *
 * So params are appended verbatim. Values here are internal constants (never user
 * input), and the api_key is appended last.
 */
function withKey(path: string, params: Record<string, string | number> = {}): string {
  const qs = ['format=json', ...Object.entries(params).map(([k, v]) => `${k}=${v}`)];
  return `${API_BASE}${path}?${qs.join('&')}&api_key=${congressApiKey()}`;
}

// ── DISCOVERY (pure predicate + paged scan) ──────────────────────────────────
/** Default subject. Title-based so a renumbered/reintroduced measure is still found. */
export const NDAA_TITLE_PATTERN = /national defense authorization act/i;

/** Pure, unit-testable: does this feed row match the subject we watch? */
export function matchesSubject(bill: { title?: string | null }, pattern: RegExp): boolean {
  return pattern.test(bill.title ?? '');
}

/**
 * Walk the recently-updated bill feed and return every measure matching `pattern`.
 *
 * NO BILL NUMBER, FISCAL YEAR, OR CONGRESS IS HARDCODED. `congress` defaults to
 * whatever Congress is sitting today, so the FY2028 cycle needs no code change.
 */
/**
 * @deprecated SUPERSEDED 2026-09-20 by `discoverSince` in legislation-discovery.ts.
 *
 * ⚠️ DO NOT WIRE THIS BACK INTO A COLLECTOR. It scans a FIXED number of recent-update
 * pages, which silently misses any measure that has drifted past the window: on prod,
 * S.4784 sat at position 2948 and vanished from a 1500-row scan that still reported
 * pollOk:true / partial:false / 'introduced'. A page count can never prove coverage —
 * only comparison against the API's own `pagination.count` for a watermarked window
 * can. Retained solely because its unit tests pin the shared discovery predicate,
 * chamber/version parsing and the %2B sort-encoding guard.
 */
export async function discoverBills(opts: {
  pattern?: RegExp;
  congress?: number;
  maxPages?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<DiscoveryOutcome> {
  const pattern = opts.pattern ?? NDAA_TITLE_PATTERN;
  const congress = opts.congress ?? currentCongress(opts.now);
  const maxPages = opts.maxPages ?? 6;
  const pageSize = opts.pageSize ?? 250;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const matched: BillRef[] = [];
  let billsSeen = 0;
  let scannedPages = 0;

  for (let page = 0; page < maxPages; page++) {
    let payload: unknown;
    try {
      payload = await getJson(
        withKey(`/bill/${congress}`, { limit: pageSize, offset: page * pageSize, sort: 'updateDate+desc' }),
        fetchImpl,
      );
    } catch (e) {
      // ⚠️ A transport failure is SOURCE_UNAVAILABLE, never "nothing exists".
      return {
        state: 'source_unavailable',
        pollOk: false,
        billsSeen,
        matched,
        scannedPages,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    scannedPages++;
    const bills = (payload as { bills?: unknown[] })?.bills ?? [];
    if (!Array.isArray(bills) || bills.length === 0) break;
    billsSeen += bills.length;

    for (const raw of bills as Array<Record<string, unknown>>) {
      if (!matchesSubject({ title: raw.title as string }, pattern)) continue;
      matched.push({
        congress: Number(raw.congress) || congress,
        billType: String(raw.type ?? '').toUpperCase(),
        number: String(raw.number ?? ''),
        title: String(raw.title ?? ''),
        updateDate: (raw.updateDate as string) ?? null,
        originChamber: (raw.originChamber as string) ?? null,
      });
    }
  }

  // The feed answered. Zero matches is a REAL observation: not yet introduced.
  return {
    state: matched.length === 0 ? 'not_yet_introduced' : 'introduced',
    pollOk: true,
    billsSeen,
    matched,
    scannedPages,
  };
}

// ── STATUS ───────────────────────────────────────────────────────────────────
/** Pure: read enactment + latest action off a bill payload. */
export function readStatus(bill: Record<string, unknown>): LegislativeStatus {
  const la = (bill.latestAction ?? null) as { actionDate?: string; text?: string } | null;
  const laws = bill.laws as Array<{ number?: string; type?: string }> | null | undefined;
  const lawNumber = Array.isArray(laws) && laws.length > 0 ? (laws[0].number ?? null) : null;
  return {
    latestActionDate: la?.actionDate ?? null,
    latestActionText: la?.text ?? null,
    becameLaw: Boolean(lawNumber),
    lawNumber,
  };
}

// ── TITLE DECORATION (idempotent by construction) ────────────────────────────
/**
 * Mindy's own version decoration: ` [HR 8800 — Introduced in House]`.
 *
 * ⚠️ PRODUCTION INCIDENT 2026-09-20. `knownMeasures` rebuilt a BillRef from the
 * PERSISTED (already-decorated) title, and `billVersionsToDocuments` decorated it
 * again — so every tracking-path run appended one more suffix. Observed live on
 * H.R. 5180: four stacked copies, growing to five on the next run. Identity,
 * attribution and raw data were untouched; only `title` compounded.
 *
 * The real fix is that the tracking path now carries `raw.billTitle` (the
 * authoritative undecorated title). This matcher exists for (a) idempotence as a
 * belt-and-braces guarantee and (b) repairing rows written before that fix.
 *
 * The pattern is deliberately NARROW — it matches only Mindy's exact format:
 * a space, `[`, the bill type + number, a spaced em dash, a version label, `]`,
 * anchored to the END of the string. A legitimate source title containing brackets
 * or an em dash in its own text is NOT touched.
 */
const MINDY_TITLE_SUFFIX = /\s\[(?:[A-Z]+\.? ?\d+|[A-Z]\.\s?Rept\.[^\]]*) — [^\]]*\]$/;

/** Strip EVERY trailing Mindy decoration, however many have accumulated. */
export function undecorateTitle(title: string): string {
  let out = title;
  // Bounded: a compounded title has a handful of suffixes, never hundreds. The cap
  // makes this terminate even on a pathological input rather than spinning.
  for (let i = 0; i < 16; i++) {
    const next = out.replace(MINDY_TITLE_SUFFIX, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/**
 * Apply EXACTLY ONE decoration. Idempotent: decorate(decorate(x)) === decorate(x),
 * and a title carrying N stacked suffixes converges to exactly one.
 */
export function decorateTitle(title: string, suffix: string): string {
  return `${undecorateTitle(title)} [${suffix}]`;
}

// ── VERSION -> INSTITUTE DOCUMENT (pure) ─────────────────────────────────────
/**
 * Build ONE InstituteDocument per bill text version.
 *
 * document_number: `<congress>-<TYPE><NUM>-<VERSIONCODE>`  e.g. `119-HR8800-EH`
 * The version code is IN the key, so House-engrossed and House-reported are
 * structurally different rows under UNIQUE (source_type, document_number).
 */
export function billVersionsToDocuments(
  ref: BillRef,
  textVersions: Array<Record<string, unknown>>,
  status: LegislativeStatus,
  retrievedAt: string,
): InstituteDocument[] {
  const out: InstituteDocument[] = [];
  const chamber = chamberOf(ref.billType);
  const fy = fiscalYearFromTitle(ref.title);

  for (const v of textVersions) {
    const label = String(v.type ?? '').trim();
    if (!label) continue;
    const code = versionCode(label);
    const date = typeof v.date === 'string' && v.date ? v.date.slice(0, 10) : null;

    const formats = (v.formats ?? []) as Array<{ type?: string; url?: string }>;
    const preferred =
      formats.find((f) => /formatted text/i.test(f.type ?? ''))?.url ??
      formats.find((f) => /xml/i.test(f.type ?? ''))?.url ??
      formats.find((f) => /pdf/i.test(f.type ?? ''))?.url ??
      `https://www.congress.gov/bill/${ref.congress}th-congress/${chamber === 'House' ? 'house' : 'senate'}-bill/${ref.number}/text`;

    // Enacted law is its OWN source_type. Both the ENROLLED text and the PUBLIC LAW
    // print of a measure that became law are the enacted artifact — categorically
    // different from a mid-process version that may not have survived.
    //
    // ⚠️ 'Public Law' is a real version label returned by the API (observed live on
    // S.1071 / PL 119-60, the FY2026 NDAA). Typing it 'introduced_bill' would have
    // filed ENACTED STATUTE as a proposal — exactly the provenance collapse this
    // module exists to prevent.
    const ENACTED_CODES = new Set(['ENR', 'PUBLIC-LAW', 'PP']);
    const isEnactedText = status.becameLaw && ENACTED_CODES.has(code);

    out.push({
      sourceOrg: 'Congress',
      sourceType: isEnactedText ? 'enacted_law' : 'introduced_bill',
      documentNumber: `${ref.congress}-${ref.billType}${ref.number}-${code}`,
      // decorateTitle() is IDEMPOTENT — see its contract. The undecorated title is
      // ALSO persisted in raw.billTitle so the tracking path never has to recover it
      // from presentation text.
      title: decorateTitle(ref.title, `${ref.billType} ${ref.number} — ${label}`),
      url: preferred,
      publicationDate: date,
      abstract: null,
      sourceWatermark: date ?? ref.updateDate ?? null,
      raw: {
        congress: ref.congress,
        chamber,
        /**
         * THE AUTHORITATIVE, UNDECORATED bill title exactly as Congress returned it.
         * The tracking path reads THIS, never the decorated `title` column — that is
         * what made decoration compound (raw -> decorated -> read back as raw ->
         * decorated again, one suffix per run).
         */
        billTitle: undecorateTitle(ref.title),
        billType: ref.billType,
        billNumber: ref.number,
        legislativeVersion: label,
        versionCode: code,
        fiscalYear: fy,
        versionDate: date,
        latestActionDate: status.latestActionDate,
        latestActionText: status.latestActionText,
        becameLaw: status.becameLaw,
        lawNumber: status.lawNumber,
        retrievedAt,
        formats: formats.map((f) => ({ type: f.type ?? null, url: f.url ?? null })),
      },
    });
  }
  return out;
}

/**
 * Congress appends a qualifier after the citation number for errata and other
 * supplemental prints ("S. Rept. 119-39,Errata"). That qualifier is the ONLY thing
 * distinguishing two otherwise-identical report identities, so it belongs in the key.
 * A bare citation yields '' and the id is unchanged (no churn for normal reports).
 */
export function citationSuffix(citation: string): string {
  const after = citation.split(',').slice(1).join(' ').trim();
  if (!after) return '';
  const slug = after.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  return slug ? `-${slug}` : '';
}

/**
 * A committee report is EVIDENCE IN ITS OWN RIGHT, not an attribute of the bill —
 * report language is where congressional direction actually lives. Conference reports
 * are flagged from the API's own `isConferenceReport`, never guessed from the title.
 */
export function committeeReportToDocument(
  rpt: Record<string, unknown>,
  retrievedAt: string,
): InstituteDocument | null {
  const type = String(rpt.type ?? '').toUpperCase();   // HRPT | SRPT
  const number = rpt.number;
  const congress = Number(rpt.congress);
  if (!type || number === undefined || number === null || !Number.isFinite(congress)) return null;

  const part = rpt.part === undefined || rpt.part === null ? null : Number(rpt.part);
  const isConference = Boolean(rpt.isConferenceReport);
  const citation = String(rpt.citation ?? `${type} ${congress}-${number}`);
  const issued = typeof rpt.issueDate === 'string' ? rpt.issueDate.slice(0, 10) : null;
  const title = String(rpt.title ?? citation);

  const assoc = (rpt.associatedBill ?? []) as Array<Record<string, unknown>>;
  const bill = assoc[0];

  return {
    sourceOrg: 'Congress',
    sourceType: 'committee_report',
    // Part AND citation-suffix are in the key: multi-part reports and errata/
    // supplemental prints are distinct documents.
    //
    // ⚠️ Congress lists SEPARATE artifacts under ONE report number. Observed live on
    // S.2296: `S. Rept. 119-39` and `S. Rept. 119-39,Errata` both come back with
    // part=1. Keying on number+part alone collapsed them to one id, so a backfill
    // would have inserted the first and SILENTLY DROPPED the errata on the unique
    // key — losing a correction to the report language, which is exactly the kind of
    // provenance this corpus exists to preserve.
    documentNumber: `${congress}-${type}-${number}`
      + (part && part > 1 ? `-PT${part}` : '')
      + citationSuffix(citation),
    title: `${title} [${citation}${isConference ? ' — Conference Report' : ''}]`,
    url: `https://www.congress.gov/congressional-report/${congress}th-congress/${
      type === 'HRPT' ? 'house-report' : 'senate-report'
    }/${number}`,
    publicationDate: issued,
    abstract: null,
    sourceWatermark: issued ?? (typeof rpt.updateDate === 'string' ? rpt.updateDate.slice(0, 10) : null),
    raw: {
      congress,
      chamber: String(rpt.chamber ?? (type === 'HRPT' ? 'House' : 'Senate')),
      reportType: type,
      reportNumber: number,
      part,
      citation,
      isConferenceReport: isConference,
      fiscalYear: fiscalYearFromTitle(title),
      committees: (rpt.committees ?? []) as unknown,
      associatedBill: bill
        ? { congress: bill.congress, type: bill.type, number: bill.number }
        : null,
      issueDate: issued,
      retrievedAt,
    },
  };
}

// ── NETWORK FETCHERS ─────────────────────────────────────────────────────────
export async function fetchBillDetail(
  ref: BillRef,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const payload = await getJson(
    withKey(`/bill/${ref.congress}/${ref.billType.toLowerCase()}/${ref.number}`),
    fetchImpl,
  );
  return ((payload as { bill?: Record<string, unknown> })?.bill ?? {}) as Record<string, unknown>;
}

export async function fetchTextVersions(
  ref: BillRef,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<Record<string, unknown>>> {
  const payload = await getJson(
    withKey(`/bill/${ref.congress}/${ref.billType.toLowerCase()}/${ref.number}/text`),
    fetchImpl,
  );
  const v = (payload as { textVersions?: unknown[] })?.textVersions;
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

/**
 * ⚠️ RETURNS EVERY ARTIFACT UNDER THE REPORT NUMBER, not just the first.
 *
 * One report number can carry several distinct artifacts. Verified live on
 * /committee-report/119/SRPT/39, which returns TWO entries:
 *   [0] 'S. Rept. 119-39'         part=1 issueDate=2025-07-15
 *   [1] 'S. Rept. 119-39,Errata'  part=1 issueDate=null
 * Taking `arr[0]` silently discarded the errata — a correction to report language —
 * and made the bill's two list entries both resolve to the same record, which is how
 * the production preview produced 29 documents with only 28 distinct identities.
 */
export async function fetchCommitteeReport(
  congress: number,
  type: string,
  number: number | string,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<Record<string, unknown>>> {
  const payload = await getJson(
    withKey(`/committee-report/${congress}/${type.toUpperCase()}/${number}`),
    fetchImpl,
  );
  const arr = (payload as { committeeReports?: unknown[] })?.committeeReports;
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}

/** `committeeReports[].url` -> (type, number), so we never hand-build report ids. */
export function parseReportRef(url: string): { type: string; number: string } | null {
  const m = url.match(/committee-report\/(\d+)\/([A-Z]+)\/(\d+)/i);
  return m ? { type: m[2].toUpperCase(), number: m[3] } : null;
}

/**
 * Collect EVERY Institute document for one measure: all text versions + its
 * committee reports. Returns them flat; the caller ingests each independently so a
 * single bad document cannot sink the run.
 */
export async function collectBillDocuments(
  ref: BillRef,
  fetchImpl: typeof fetch = fetch,
  now: () => string = () => new Date().toISOString(),
): Promise<{ documents: InstituteDocument[]; status: LegislativeStatus }> {
  const retrievedAt = now();
  const detail = await fetchBillDetail(ref, fetchImpl);
  const status = readStatus(detail);

  const versions = await fetchTextVersions(ref, fetchImpl);
  const documents = billVersionsToDocuments(ref, versions, status, retrievedAt);

  // The bill lists one entry PER ARTIFACT but every entry points at the SAME report
  // URL, so fetch each report number ONCE and expand it into all of its artifacts.
  // Fetching per list-entry would re-request the same document and, before the
  // arr[0] fix, yield the same record twice.
  const reports = (detail.committeeReports ?? []) as Array<{ url?: string }>;
  const seenReportRefs = new Set<string>();
  for (const r of reports) {
    const parsed = r.url ? parseReportRef(r.url) : null;
    if (!parsed) continue;
    const refKey = `${parsed.type}/${parsed.number}`;
    if (seenReportRefs.has(refKey)) continue;
    seenReportRefs.add(refKey);

    const artifacts = await fetchCommitteeReport(ref.congress, parsed.type, parsed.number, fetchImpl);
    for (const rpt of artifacts) {
      const doc = committeeReportToDocument(rpt, retrievedAt);
      if (doc) documents.push(doc);
    }
  }

  return { documents, status };
}

/**
 * Which agency does a legislative document CONCERN?
 *
 * Reuses the shared resolver. Defense authorization/appropriation measures resolve to
 * DoD via the title; anything we cannot name stays UNRESOLVED rather than guessing —
 * identical refusal semantics to the GAO collector.
 */
export function resolveLegislationAgency(doc: InstituteDocument, canonicalNames: string[]): AgencyResolution {
  const haystack = `${doc.title}\n${doc.abstract ?? ''}`;
  if (/national defense authorization|department of defense appropriation/i.test(haystack)) {
    return resolveAgency({ agencyName: 'Department of Defense' });
  }
  const hits = new Set<string>();
  for (const name of canonicalNames) {
    const re = new RegExp(`(?:^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z]|$)`, 'i');
    if (re.test(haystack)) hits.add(name);
  }
  return resolveAgency({ agencyName: hits.size === 1 ? [...hits][0] : '' });
}
