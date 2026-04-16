/**
 * Agency Forecasts Live - Queries real Supabase database (7,764+ forecasts)
 * Replaces the old static JSON-based agency-forecasts.ts
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface LiveForecast {
  id: string;
  source_agency: string;
  title: string;
  description: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  estimated_value_range: string | null;
  anticipated_award_date: string | null;
  solicitation_date: string | null;
  anticipated_quarter: string | null;
  fiscal_year: string | null;
  contract_type: string | null;
  set_aside_type: string | null;
  contracting_office: string | null;
  program_office: string | null;
  pop_state: string | null;
  status: string | null;
  incumbent_name: string | null;
}

// Adapter interface to match old API
export interface Forecast {
  id: string;
  agency: string;
  title: string;
  description: string;
  naicsCode: string;
  estimatedValue: number;
  solicitationDate: string;
  awardDate: string;
  quarter: string;
  contractType: string;
  setAside: string;
  performancePeriod: string;
  pointOfContact: string;
}

// Convert LiveForecast to legacy Forecast format
function toLegacyFormat(f: LiveForecast): Forecast {
  return {
    id: f.id,
    agency: f.source_agency,
    title: f.title,
    description: f.description || '',
    naicsCode: f.naics_code || '',
    estimatedValue: f.estimated_value_max || f.estimated_value_min || 0,
    solicitationDate: f.solicitation_date || f.anticipated_award_date || '',
    awardDate: f.anticipated_award_date || '',
    quarter: f.anticipated_quarter || f.fiscal_year || '',
    contractType: f.contract_type || '',
    setAside: f.set_aside_type || '',
    performancePeriod: '',
    pointOfContact: f.contracting_office || f.program_office || '',
  };
}

/**
 * Get forecasts for selected agencies from live Supabase database
 *
 * Strategy: Agency + NAICS intersection (focused intel for target agencies)
 * - User has already selected specific agencies to pursue
 * - Show forecasts from THOSE agencies matching their NAICS
 * - This is targeted intelligence, not a broad search
 */
export async function getLiveForecastsForSelectedAgencies(
  selectedAgencies: string[],
  naicsCode?: string,
  setAsideType?: string
): Promise<Forecast[]> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  let query = supabase
    .from('agency_forecasts')
    .select('*')
    .order('anticipated_award_date', { ascending: true, nullsFirst: false })
    .limit(100);

  // Filter by selected agencies
  if (selectedAgencies.length > 0) {
    const agencyFilters = selectedAgencies.map(agency => {
      const words = agency.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words[0] || agency.toLowerCase();
    });

    query = query.or(
      agencyFilters.map(a => `source_agency.ilike.%${a}%`).join(',')
    );
  }

  // Filter by NAICS - support prefix matching
  if (naicsCode) {
    const trimmedNaics = naicsCode.trim();
    if (trimmedNaics.length <= 4) {
      query = query.ilike('naics_code', `${trimmedNaics}%`);
    } else {
      query = query.eq('naics_code', trimmedNaics);
    }
  }

  // Filter by set-aside
  if (setAsideType) {
    query = query.ilike('set_aside_type', `%${setAsideType}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching live forecasts:', error);
    return [];
  }

  return (data as LiveForecast[]).map(toLegacyFormat);
}

/**
 * Get upcoming forecasts from a list (sorted by solicitation date)
 */
export function getUpcomingForecasts(
  forecasts: Forecast[],
  limit: number = 20
): Forecast[] {
  const now = new Date();

  return forecasts
    .filter(f => {
      const solDate = f.solicitationDate || f.awardDate;
      if (!solDate) return true; // Include forecasts without dates
      return new Date(solDate) >= now;
    })
    .sort((a, b) => {
      const dateA = a.solicitationDate || a.awardDate || '9999';
      const dateB = b.solicitationDate || b.awardDate || '9999';
      return dateA.localeCompare(dateB);
    })
    .slice(0, limit);
}

/**
 * Get forecast statistics
 */
export function getForecastStatistics(forecasts: Forecast[]): {
  totalValue: number;
  totalForecasts: number;
  averageValue: number;
  agencyCounts: Record<string, number>;
  naicsCounts: Record<string, number>;
  setAsideCounts: Record<string, number>;
} {
  const totalValue = forecasts.reduce((sum, f) => sum + (f.estimatedValue || 0), 0);
  const totalForecasts = forecasts.length;
  const averageValue = totalForecasts > 0 ? totalValue / totalForecasts : 0;

  const agencyCounts: Record<string, number> = {};
  const naicsCounts: Record<string, number> = {};
  const setAsideCounts: Record<string, number> = {};

  forecasts.forEach(forecast => {
    if (forecast.agency) {
      agencyCounts[forecast.agency] = (agencyCounts[forecast.agency] || 0) + 1;
    }
    if (forecast.naicsCode) {
      naicsCounts[forecast.naicsCode] = (naicsCounts[forecast.naicsCode] || 0) + 1;
    }
    if (forecast.setAside) {
      setAsideCounts[forecast.setAside] = (setAsideCounts[forecast.setAside] || 0) + 1;
    }
  });

  return {
    totalValue,
    totalForecasts,
    averageValue,
    agencyCounts,
    naicsCounts,
    setAsideCounts,
  };
}

/**
 * Search forecasts by NAICS code directly from Supabase
 */
export async function searchForecastsByNAICS(
  naicsCode: string,
  limit: number = 50
): Promise<Forecast[]> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const trimmedNaics = naicsCode.trim();

  let query = supabase
    .from('agency_forecasts')
    .select('*')
    .order('anticipated_award_date', { ascending: true, nullsFirst: false })
    .limit(limit);

  // Support prefix matching for shorter codes
  if (trimmedNaics.length <= 4) {
    query = query.ilike('naics_code', `${trimmedNaics}%`);
  } else {
    query = query.eq('naics_code', trimmedNaics);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error searching forecasts by NAICS:', error);
    return [];
  }

  return (data as LiveForecast[]).map(toLegacyFormat);
}
