// Agency Forecasts Database Utilities
import forecastsData from '@/data/agency-forecasts-database.json';

interface Forecast {
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

interface ForecastsDatabase {
  forecasts: Forecast[];
  metadata: {
    version: string;
    lastUpdated: string;
    totalForecasts: number;
    source: string;
    coverage: string;
    agencies: string[];
  };
}

const forecastsDB = forecastsData as ForecastsDatabase;

/**
 * Get all forecasts
 */
export function getAllForecasts(): Forecast[] {
  return forecastsDB.forecasts;
}

/**
 * Get forecasts by agency
 */
export function getForecastsByAgency(agencyName: string): Forecast[] {
  return forecastsDB.forecasts.filter(forecast =>
    forecast.agency.toLowerCase().includes(agencyName.toLowerCase()) ||
    agencyName.toLowerCase().includes(forecast.agency.toLowerCase())
  );
}

/**
 * Get forecasts by NAICS code
 */
export function getForecastsByNAICS(naicsCode: string): Forecast[] {
  const trimmedNaics = naicsCode.trim();

  // Try exact match first
  let matches = forecastsDB.forecasts.filter(
    forecast => forecast.naicsCode === trimmedNaics
  );

  // If no exact matches and code is 6 digits, try 5-digit prefix
  if (matches.length === 0 && trimmedNaics.length === 6) {
    const prefix5 = trimmedNaics.substring(0, 5);
    matches = forecastsDB.forecasts.filter(
      forecast => forecast.naicsCode.startsWith(prefix5)
    );
  }

  // If no matches and code is 5+ digits, try 3-digit prefix
  if (matches.length === 0 && trimmedNaics.length >= 5) {
    const prefix3 = trimmedNaics.substring(0, 3);
    matches = forecastsDB.forecasts.filter(
      forecast => forecast.naicsCode.startsWith(prefix3)
    );
  }

  return matches;
}

/**
 * Get forecasts by set-aside type
 */
export function getForecastsBySetAside(setAsideType: string): Forecast[] {
  return forecastsDB.forecasts.filter(forecast =>
    forecast.setAside.toLowerCase().includes(setAsideType.toLowerCase())
  );
}

/**
 * Get forecasts by selected agencies
 */
export function getForecastsForSelectedAgencies(
  selectedAgencies: string[],
  naicsCode?: string,
  setAsideType?: string
): Forecast[] {
  let results: Forecast[] = [];

  // Get forecasts for each selected agency
  selectedAgencies.forEach(agencyName => {
    const agencyForecasts = getForecastsByAgency(agencyName);
    results.push(...agencyForecasts);
  });

  // Remove duplicates
  results = results.filter((forecast, index, self) =>
    index === self.findIndex(f => f.id === forecast.id)
  );

  // Filter by NAICS if provided
  if (naicsCode) {
    const naicsMatches = getForecastsByNAICS(naicsCode);
    const naicsIds = new Set(naicsMatches.map(f => f.id));
    results = results.filter(f => naicsIds.has(f.id));

    // If we filtered everything out, include NAICS matches from other agencies
    if (results.length === 0) {
      results = naicsMatches;
    }
  }

  // Filter by set-aside if provided
  if (setAsideType) {
    const setAsideFiltered = results.filter(forecast =>
      forecast.setAside.toLowerCase().includes(setAsideType.toLowerCase())
    );

    // If we have matches, use them; otherwise keep all results
    if (setAsideFiltered.length > 0) {
      results = setAsideFiltered;
    }
  }

  // Sort by estimated value (highest first)
  return results.sort((a, b) => b.estimatedValue - a.estimatedValue);
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
  const totalValue = forecasts.reduce((sum, f) => sum + f.estimatedValue, 0);
  const totalForecasts = forecasts.length;
  const averageValue = totalForecasts > 0 ? totalValue / totalForecasts : 0;

  const agencyCounts: Record<string, number> = {};
  const naicsCounts: Record<string, number> = {};
  const setAsideCounts: Record<string, number> = {};

  forecasts.forEach(forecast => {
    agencyCounts[forecast.agency] = (agencyCounts[forecast.agency] || 0) + 1;
    naicsCounts[forecast.naicsCode] = (naicsCounts[forecast.naicsCode] || 0) + 1;
    setAsideCounts[forecast.setAside] = (setAsideCounts[forecast.setAside] || 0) + 1;
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
 * Get upcoming forecasts (by solicitation date)
 */
export function getUpcomingForecasts(
  forecasts: Forecast[],
  limit: number = 10
): Forecast[] {
  const now = new Date();

  return forecasts
    .filter(f => new Date(f.solicitationDate) >= now)
    .sort((a, b) =>
      new Date(a.solicitationDate).getTime() - new Date(b.solicitationDate).getTime()
    )
    .slice(0, limit);
}

export { forecastsDB };
export type { Forecast, ForecastsDatabase };
