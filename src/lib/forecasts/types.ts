/**
 * Forecast Intelligence - Shared Types
 */

export interface ForecastRecord {
  source_agency: string;
  source_type: 'excel' | 'puppeteer' | 'api';
  source_url?: string;
  external_id: string;

  title: string;
  description?: string;

  department?: string;
  bureau?: string;
  contracting_office?: string;
  program_office?: string;

  naics_code?: string;
  naics_description?: string;
  psc_code?: string;
  psc_description?: string;

  fiscal_year?: string;
  anticipated_quarter?: string;
  anticipated_award_date?: string;
  solicitation_date?: string;
  performance_end_date?: string;

  estimated_value_min?: number;
  estimated_value_max?: number;
  estimated_value_range?: string;

  contract_type?: string;
  set_aside_type?: string;
  competition_type?: string;

  incumbent_name?: string;
  incumbent_contract_number?: string;

  poc_name?: string;
  poc_email?: string;
  poc_phone?: string;

  pop_state?: string;
  pop_city?: string;
  pop_zip?: string;
  pop_country?: string;

  status?: 'forecast' | 'pre-solicitation' | 'solicitation' | 'awarded' | 'cancelled';

  raw_data?: string;
}

export interface ScraperResult {
  success: boolean;
  agency: string;
  records: ForecastRecord[];
  errors: string[];
  timing: number;
}

export interface ScraperConfig {
  agency_code: string;
  agency_name: string;
  source_url: string;
  source_type: 'excel_direct' | 'puppeteer' | 'api' | 'multi_source';
  timeout?: number;
  headers?: Record<string, string>;
  selectors?: Record<string, string>;
  pagination?: {
    type: 'scroll' | 'button' | 'url';
    selector?: string;
    maxPages?: number;
  };
}

// Utility functions
export function normalizeNaics(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const match = code.toString().match(/(\d{4,6})/);
  return match ? match[1] : undefined;
}

export function normalizeFY(fy: string | null | undefined): string | undefined {
  if (!fy) return undefined;
  const str = fy.toString();
  if (str.match(/^FY\d{2,4}$/i)) return str.toUpperCase();
  if (str.match(/^\d{4}$/)) return `FY${str}`;
  if (str.match(/^\d{2}$/)) return `FY20${str}`;
  return str;
}

export function normalizeSetAside(setAside: string | null | undefined): string | undefined {
  if (!setAside) return undefined;
  const lower = setAside.toString().toLowerCase();

  if (lower.includes('8(a)') || lower.includes('8a')) return '8(a)';
  if (lower.includes('hubzone')) return 'HUBZone';
  if (lower.includes('sdvosb') || lower.includes('service-disabled')) return 'SDVOSB';
  if (lower.includes('vosb') || lower.includes('veteran')) return 'VOSB';
  if (lower.includes('wosb') || lower.includes('women')) return 'WOSB';
  if (lower.includes('small business') || lower.includes('sb set-aside') || lower.includes('total small')) return 'Small Business';
  if (lower.includes('full and open') || lower.includes('unrestricted')) return 'Full & Open';
  if (lower.includes('sole source')) return 'Sole Source';

  return setAside;
}

export function parseValueRange(value: string | number | null | undefined): { min: number | undefined; max: number | undefined } {
  if (!value) return { min: undefined, max: undefined };

  const str = value.toString().replace(/,/g, '');

  // Handle ranges like "$250K–$7.5M" or "$5M - $25M"
  const rangeMatch = str.match(/\$?([\d.]+)\s*([KMB])?\s*[-–]\s*\$?([\d.]+)\s*([KMB])?/i);
  if (rangeMatch) {
    const minNum = parseFloat(rangeMatch[1]) * getMultiplier(rangeMatch[2]);
    const maxNum = parseFloat(rangeMatch[3]) * getMultiplier(rangeMatch[4]);
    return { min: Math.round(minNum), max: Math.round(maxNum) };
  }

  // Handle single values like "$5M" or "5000000"
  const singleMatch = str.match(/\$?([\d.]+)\s*([KMB])?/i);
  if (singleMatch) {
    const num = parseFloat(singleMatch[1]) * getMultiplier(singleMatch[2]);
    return { min: Math.round(num), max: Math.round(num) };
  }

  return { min: undefined, max: undefined };
}

/**
 * Helper to add a delay (replacement for deprecated waitForTimeout)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildDeterministicExternalId(
  prefix: string,
  parts: Array<string | number | null | undefined>
): string {
  const normalized = parts
    .map(part => String(part ?? '').trim().toLowerCase())
    .filter(Boolean)
    .map(part => part.replace(/\s+/g, ' ').replace(/[^a-z0-9]+/g, '-'))
    .join('|');

  const base = normalized || 'unknown';
  let hash = 0;
  for (let index = 0; index < base.length; index++) {
    hash = (hash * 31 + base.charCodeAt(index)) >>> 0;
  }

  return `${prefix}-${hash.toString(36)}`;
}

function getMultiplier(suffix: string | undefined): number {
  if (!suffix) return 1;
  switch (suffix.toUpperCase()) {
    case 'K': return 1000;
    case 'M': return 1000000;
    case 'B': return 1000000000;
    default: return 1;
  }
}
