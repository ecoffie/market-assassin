/**
 * Treasury "Dynamic Forecast" (osdbu.forecast.treasury.gov).
 *
 * A Salesforce Experience Cloud site. Its data comes from
 * `/webruntime/api/apex/execute?...&asGuest=true` — explicitly UNAUTHENTICATED,
 * so this is automatable despite treasury.gov's other host (sbecs.treas.gov)
 * being WAF'd.
 *
 * WHY THIS WAS ALMOST MISSED: probing guessed URLs returned 404 and I recorded
 * Treasury as "no public forecast". The real page was two links deep from
 * home.treasury.gov and is served by a dedicated subdomain. Guessing paths
 * proves nothing; find the page, then watch what it calls.
 *
 * SHAPE: one payload carries 7 BUREAUS, each holding several typed arrays of
 * opportunities (above250kData, recompeteOppData, newOppData,
 * simplifiedAcquisitionAwardData, micropurchaseAwardData). Separate payloads
 * are LOOKUP TABLES — {Key, Value} pairs mapping Salesforce record ids to NAICS
 * codes, PSC codes and vendor names. Without them, naics/psc/incumbent come
 * through as opaque ids like "a0QSJ000002PSgM2AW".
 */

/** The arrays on a bureau object that hold opportunity records. */
export const TREASURY_DATA_KEYS = [
  'above250kData',
  'recompeteOppData',
  'newOppData',
  'simplifiedAcquisitionAwardData',
  'micropurchaseAwardData',
] as const;

export interface TreasuryForecastRow {
  id: string;
  title: string;
  description?: string;
  bureau?: string;
  requirementType?: string;
  acquisitionPhase?: string;
  shopCartReq?: string;
  naicsCode?: string;
  naicsDescription?: string;
  pscCode?: string;
  pscDescription?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  setAside?: string;
  contractType?: string;
  awardType?: string;
  contractVehicle?: string;
  competition?: string;
  fiscalYear?: string;
  quarter?: string;
  popState?: string;
  popCountry?: string;
  incumbentName?: string;
  bureauPoc?: string;
  programOfficePoc?: string;
  listingStage?: string;
  bucket: string;
  raw: Record<string, unknown>;
}

const BLANK = /^(tbd|tba|n\/?a|na|none|unknown|null|undefined|-{1,}|\.)$/i;

export function tCell(v: unknown): string | undefined {
  if (v === null || v === undefined || typeof v === 'boolean') return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** A Salesforce record id (15 or 18 char alphanumeric). */
export function isSalesforceId(v: unknown): boolean {
  return typeof v === 'string' && /^[a-zA-Z0-9]{15,18}$/.test(v);
}

/** Build the id→label map from the lookup payloads. */
export function buildTreasuryLookups(payloads: unknown[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of payloads) {
    const rv = (p as { returnValue?: unknown })?.returnValue;
    if (!Array.isArray(rv)) continue;
    for (const e of rv) {
      const k = (e as { Key?: string })?.Key;
      const v = (e as { Value?: string })?.Value;
      if (typeof k === 'string' && typeof v === 'string') m.set(k, v);
    }
  }
  return m;
}

/** "541519-Other Computer Related Services" → { code, label }. */
export function splitCodedLabel(v: string | undefined): { code?: string; label?: string } {
  if (!v) return {};
  const m = /^([A-Z0-9]{2,6})\s*[-–:]\s*(.+)$/i.exec(v.trim());
  if (m) return { code: m[1].toUpperCase(), label: m[2].trim() };
  return { label: v.trim() };
}

/** "> $250K to < or = $750K" / "$1M - $5M" → bounds. */
export function treasuryValueRange(v: string | undefined): { min?: number; max?: number } {
  if (!v) return {};
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

/** "FY 2025 Q2" → { fy: "FY2025", quarter: "Q2" }. */
export function treasuryTiming(v: string | undefined): { fy?: string; quarter?: string } {
  const s = v || '';
  const fm = /FY\s?(\d{4})|FY\s?(\d{2})\b|\b(20\d{2})\b/i.exec(s);
  let fy: string | undefined;
  if (fm) {
    const y = fm[1] || (fm[2] ? `20${fm[2]}` : fm[3]);
    const n = Number(y);
    if (n >= 2020 && n <= 2040) fy = `FY${y}`;
  }
  const qm = /\bQ([1-4])\b/i.exec(s);
  return { fy, quarter: qm ? `Q${qm[1]}` : undefined };
}

/** Treasury set-aside text → the app's vocabulary. */
export function treasurySetAside(typeOfSbsa: string | undefined, isSetAside: string | undefined, extent: string | undefined): string | undefined {
  const t = `${typeOfSbsa || ''} ${extent || ''}`.toLowerCase();
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|edwosb|women[-\s]?owned/.test(t)) return 'WOSB';
  if (/vosb|veteran[-\s]?owned/.test(t)) return 'VOSB';
  // "SB" is Treasury's own abbreviation in sbfTypeofSBSA__c.
  if (/\bsb\b|small business/.test(t)) return 'Small Business';
  if (/full and open|unrestricted/.test(t)) return 'Full and Open';
  if (/sole source/.test(t)) return 'Sole Source';
  // Fall back to the yes/no flag when the type field is empty.
  if (/^yes$/i.test(String(isSetAside || '').trim())) return 'Small Business';
  return undefined;
}

export interface TreasuryParseResult {
  rows: TreasuryForecastRow[];
  bureaus: number;
  skipped: number;
}

/**
 * Parse the bureau payload into flat opportunity rows.
 * `lookups` decodes the Salesforce ids on naics/psc/incumbent.
 */
export function parseTreasuryForecast(
  bureauPayload: unknown,
  lookups: Map<string, string>,
): TreasuryParseResult {
  const rv = (bureauPayload as { returnValue?: unknown })?.returnValue;
  if (!Array.isArray(rv)) return { rows: [], bureaus: 0, skipped: 0 };

  const rows: TreasuryForecastRow[] = [];
  let skipped = 0;

  const deref = (v: unknown): string | undefined => {
    const s = tCell(v);
    if (!s) return undefined;
    return isSalesforceId(s) ? (lookups.get(s) ?? undefined) : s;
  };

  for (const bureau of rv) {
    const bureauName = tCell((bureau as { Name?: string })?.Name);
    for (const key of TREASURY_DATA_KEYS) {
      const arr = (bureau as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) continue;
      for (const rec of arr) {
        const r = rec as Record<string, unknown>;
        const title = tCell(r.Name);
        // No title = not an opportunity (Salesforce returns shell rows).
        if (!title || title.length < 4) { skipped++; continue; }

        const naics = splitCodedLabel(deref(r.sbfNAICSCode__c));
        const psc = splitCodedLabel(deref(r.sbfPSCCode__c));
        const valueRange = tCell(r.sbfEstimatedTotalContractValue__c);
        const val = treasuryValueRange(valueRange);
        const timing = treasuryTiming(tCell(r.sbfFiscalYear_QtrforAward__c));

        rows.push({
          id: String(r.Id ?? ''),
          title,
          description: tCell(r.Description__c),
          bureau: bureauName,
          requirementType: tCell(r.sbfTypeofRequirement__c),
          acquisitionPhase: tCell(r.sbfAcquisitionPhase__c),
          shopCartReq: tCell(r.sbfShopCart_req__c),
          naicsCode: naics.code,
          naicsDescription: naics.label,
          pscCode: psc.code,
          pscDescription: psc.label,
          valueRange,
          valueMin: val.min,
          valueMax: val.max,
          setAside: treasurySetAside(
            tCell(r.sbfTypeofSBSA__c),
            tCell(r.sbfSmallBusinessSetaside__c),
            tCell(r.sbfExtentCompeted__c),
          ),
          contractType: tCell(r.sbfProjectedContractType__c),
          awardType: tCell(r.sbfProjectedAwardType__c),
          contractVehicle: tCell(r.sbfProjectedContractVehicle__c),
          competition: tCell(r.sbfExtentCompeted__c),
          fiscalYear: timing.fy,
          quarter: timing.quarter,
          popState: tCell(r.sbfPlaceofPerformanceState__c)?.toUpperCase().slice(0, 2),
          popCountry: tCell(r.sbfPlaceofPerformanceCountry__c),
          incumbentName: deref(r.sbfIncumbentVendorName__c),
          bureauPoc: tCell(r.sbfBureauPointofContact__c),
          programOfficePoc: tCell(r.sbfProgramOfficePointofContact__c),
          listingStage: tCell(r.sbfListingID__c),
          bucket: key,
          raw: r,
        });
      }
    }
  }

  return { rows, bureaus: rv.length, skipped };
}

/**
 * Deterministic id. Treasury's Salesforce record Id is genuinely unique and
 * stable across refreshes, so it is the key — no content hash needed, unlike
 * the sources whose titles repeat across offices.
 */
export function treasuryExternalId(r: TreasuryForecastRow): string {
  return `TREAS-${(r.id || r.title).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 110)}`;
}
