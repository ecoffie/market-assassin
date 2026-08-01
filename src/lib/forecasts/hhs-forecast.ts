/**
 * HHS Small Business Customer Experience (SBCX) opportunity forecast.
 *
 * A PLAIN, UNAUTHENTICATED JSON API — the best-shaped source we ingest:
 *
 *   GET https://osdbu.hhs.gov/api/sbcxopportunities/?filter=
 *   → 3,679 records, ~3 MB, no auth, no browser needed
 *
 * WHY THIS WAS TWICE RECORDED AS "CLOSED": I probed eight GUESSED urls
 * (cdc.gov/contracts/forecast.html, hrsa.gov/about/contracting/forecast, …),
 * got 403s and 404s, and concluded HHS publishes nothing. Then I loaded
 * osdbu.hhs.gov, saw a JS app, and called it "login-gated". Both conclusions
 * were wrong. The site is public; the forecast lives at
 * /industry/opportunity-forecast, and clicking its "View All" fires this API.
 *
 * A 404 on a URL you invented is evidence of nothing. Find the page, follow its
 * links, then watch what it calls. That method found the Navy LRAE (8,821 rows),
 * Treasury (200) and this (3,679) — all after each was written off.
 *
 * Coverage on the live payload: NAICS 100%, value 100%, program POC email 100%,
 * contracting-officer email 99%, incumbent 29%, solicitation year 67%.
 * Divisions: IHS 2,265 · CDC 561 · FDA 516 · HRSA 178 · CMS 53 · ACF 34 · NIH 31.
 */

export const HHS_FORECAST_URL = 'https://osdbu.hhs.gov/api/sbcxopportunities/?filter=';

export interface HhsForecastRow {
  uuid: string;
  title: string;
  description?: string;
  division?: string;
  status?: string;
  naicsCode?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  strategy?: string;
  solicitationFy?: string;
  solicitationMonth?: string;
  awardFy?: string;
  awardMonth?: string;
  pocName?: string;
  pocEmail?: string;
  pocOffice?: string;
  coName?: string;
  coEmail?: string;
  contractingOfficeCode?: string;
  incumbentName?: string;
  incumbentContractNumber?: string;
  raw: Record<string, unknown>;
}

const BLANK = /^(tbd|tba|n\/?a|na|none|unknown|null|undefined|-{1,}|\.)$/i;

export function hhsCell(v: unknown): string | undefined {
  if (v === null || v === undefined || typeof v === 'boolean') return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/**
 * HHS stores the contract value as an ENUM ("RANGE_3"), not dollar text — so a
 * money regex over the raw field matches nothing and every row silently loses
 * its value. The labels come from /api/sbcxforecastchoices/ (contractRanges);
 * they are pinned here so the parser does not need a second network call and
 * cannot be broken by that endpoint moving.
 *
 * Verified against the live choices payload 2026-08-01.
 */
export const HHS_VALUE_RANGES: Record<string, { label: string; min?: number; max?: number }> = {
  RANGE_1:  { label: '> $0 and <= $10K',        min: 0,        max: 10_000 },
  RANGE_2:  { label: '> $10K and <= $25K',      min: 10_000,   max: 25_000 },
  RANGE_3:  { label: '> $25K and < $250K',      min: 25_000,   max: 250_000 },
  RANGE_4:  { label: '>= $250K and < $700K',    min: 250_000,  max: 700_000 },
  RANGE_5:  { label: '>= $700K and < $1.5M',    min: 700_000,  max: 1_500_000 },
  RANGE_6:  { label: '>= $1.5M and < $3M',      min: 1_500_000, max: 3_000_000 },
  RANGE_7:  { label: '>= $3M and < $7M',        min: 3_000_000, max: 7_000_000 },
  RANGE_8:  { label: '>= $7M and < $13M',       min: 7_000_000, max: 13_000_000 },
  RANGE_9:  { label: '>= $13M and < $20M',      min: 13_000_000, max: 20_000_000 },
  RANGE_10: { label: '>= $20M and < $50M',      min: 20_000_000, max: 50_000_000 },
  RANGE_11: { label: '>= $50M and < $100M',     min: 50_000_000, max: 100_000_000 },
  // Open-ended: a max would be invented, so only the floor is stored.
  RANGE_12: { label: '>= $100M',                min: 100_000_000 },
};

/** Enum code → human label, for display. */
export function hhsValueLabel(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return HHS_VALUE_RANGES[v.trim().toUpperCase()]?.label ?? v;
}

/** "RANGE_7" → bounds; falls through to dollar-text parsing for other shapes. */
export function hhsValueRange(v: string | undefined): { min?: number; max?: number } {
  if (!v) return {};
  const band = HHS_VALUE_RANGES[v.trim().toUpperCase()];
  if (band) {
    // A $0 floor is not information — drop it rather than store a fake bound.
    return { min: band.min && band.min >= 1000 ? band.min : undefined, max: band.max };
  }
  const toks = v.match(/\$\s?[\d,.]+\s*[KMB]?/gi) || [];
  const nums = toks.map(t => {
    const m = /\$\s?([\d,.]+)\s*([KMB])?/i.exec(t);
    if (!m) return NaN;
    const n = parseFloat(m[1].replace(/,/g, ''));
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
    return n * mult;
  }).filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return {};
  const min = Math.round(Math.min(...nums)), max = Math.round(Math.max(...nums));
  // A federal forecast bounded below $1,000 is a malformed cell, not a figure.
  if (min < 1000) return max >= 1000 ? { max } : {};
  return { min, max };
}

/** 2026 | "2026" | "FY2026" → "FY2026"; rejects anything outside a sane range. */
export function hhsFy(v: unknown): string | undefined {
  const m = /(\d{4})/.exec(String(v ?? ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 2020 && n <= 2040 ? `FY${m[1]}` : undefined;
}

/** Month number/name → fiscal quarter. The federal FY starts in October. */
export function hhsQuarter(month: unknown): string | undefined {
  const s = String(month ?? '').trim();
  if (!s) return undefined;
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = Number(s);
  if (!Number.isFinite(m) || m < 1 || m > 12) {
    const key = s.slice(0, 3).toLowerCase();
    m = MONTHS[key] ?? NaN;
  }
  if (!Number.isFinite(m) || m < 1 || m > 12) return undefined;
  // Oct-Dec = Q1, Jan-Mar = Q2, Apr-Jun = Q3, Jul-Sep = Q4.
  if (m >= 10) return 'Q1';
  if (m <= 3) return 'Q2';
  if (m <= 6) return 'Q3';
  return 'Q4';
}

/** "541512 - Computer Systems Design" or a bare code → the 6-digit code. */
export function hhsNaics(v: unknown): string | undefined {
  const m = /\b(\d{6})\b/.exec(String(v ?? ''));
  return m ? m[1] : undefined;
}

export interface HhsParseResult {
  rows: HhsForecastRow[];
  skipped: number;
}

export function parseHhsForecast(payload: unknown): HhsParseResult {
  const arr = Array.isArray(payload)
    ? payload
    : ((payload as { results?: unknown[]; data?: unknown[] })?.results
       ?? (payload as { data?: unknown[] })?.data
       ?? []);
  if (!Array.isArray(arr)) return { rows: [], skipped: 0 };

  const rows: HhsForecastRow[] = [];
  let skipped = 0;

  for (const rec of arr) {
    const r = rec as Record<string, unknown>;
    const title = hhsCell(r.title);
    // No title = not an opportunity.
    if (!title || title.length < 4) { skipped++; continue; }

    const valueRange = hhsCell(r.totalContractRange);
    const val = hhsValueRange(valueRange);
    const pocName = [hhsCell(r.programPocFirstName), hhsCell(r.programPocLastName)]
      .filter(Boolean).join(' ') || undefined;
    const coName = [hhsCell(r.coFirstName), hhsCell(r.coLastName)]
      .filter(Boolean).join(' ') || undefined;

    rows.push({
      uuid: String(r.uuid ?? ''),
      title,
      description: hhsCell(r.description),
      division: hhsCell(r.divisionAcronym),
      status: hhsCell(r.status),
      naicsCode: hhsNaics(r.primaryNAICS),
      valueRange,
      valueMin: val.min,
      valueMax: val.max,
      strategy: hhsCell(r.anticipatedStrategy),
      solicitationFy: hhsFy(r.targetSolicitationYear),
      solicitationMonth: hhsCell(r.targetSolicitationMonth),
      awardFy: hhsFy(r.targetAwardYear),
      awardMonth: hhsCell(r.targetAwardMonth),
      pocName,
      pocEmail: hhsCell(r.programPocEmail),
      pocOffice: hhsCell(r.programPocOffice),
      coName,
      coEmail: hhsCell(r.coEmail),
      contractingOfficeCode: hhsCell(r.contractingOfficeCode),
      incumbentName: hhsCell(r.incumbentContractorName),
      incumbentContractNumber: hhsCell(r.contractNumber),
      raw: r,
    });
  }

  return { rows, skipped };
}

/**
 * Deterministic id. HHS supplies a real uuid per opportunity, so no content
 * hash is needed — unlike USACE and NAVSUP, whose titles repeat across offices.
 */
export function hhsExternalId(r: HhsForecastRow): string {
  return `HHS-${(r.uuid || r.title).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 112)}`;
}
