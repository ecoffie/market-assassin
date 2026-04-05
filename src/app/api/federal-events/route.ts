/**
 * Federal Events API
 *
 * Returns federal procurement events: industry days, matchmaking, training.
 * Part of the Federal Market Scanner Phase 3.
 *
 * GET /api/federal-events?agency=DOD
 * GET /api/federal-events?category=industry_day
 * GET /api/federal-events?naics=541512
 * GET /api/federal-events?all=true
 */

import { NextRequest, NextResponse } from 'next/server';
import eventsData from '@/data/federal-events-sources.json';

// Type definitions
interface EventSource {
  name: string;
  url: string;
  type: string;
  frequency: string;
  categories: string[];
  agencies: string[];
  notes: string;
}

interface EventCategory {
  name: string;
  description: string;
  value: string;
  actionRequired: string;
  typical_lead_time: string;
}

interface AnnualConference {
  name: string;
  typical_month: string;
  location: string;
  audience: string;
  registration_cost: string;
  value: string;
}

interface EventSourcesData {
  lastUpdated: string;
  eventSources: Record<string, EventSource>;
  eventCategories: Record<string, EventCategory>;
  majorAnnualConferences: AnnualConference[];
  recommendations: Record<string, string[]>;
}

const data = eventsData as EventSourcesData;

// Agency name normalization
function normalizeAgency(input: string): string {
  const mapping: Record<string, string> = {
    'DOD': 'DOD',
    'DEFENSE': 'DOD',
    'DEPARTMENT OF DEFENSE': 'DOD',
    'ARMY': 'Army',
    'NAVY': 'Navy',
    'AIR FORCE': 'Air Force',
    'USAF': 'Air Force',
    'VA': 'VA',
    'VETERANS': 'VA',
    'HHS': 'HHS',
    'HEALTH': 'HHS',
    'GSA': 'GSA',
    'NASA': 'NASA',
    'DHS': 'DHS',
    'HOMELAND': 'DHS',
    'DOE': 'DOE',
    'ENERGY': 'DOE',
    'SBA': 'SBA',
    'DLA': 'DLA',
  };

  const upper = input.toUpperCase().trim();
  return mapping[upper] || input;
}

// Find sources relevant to an agency
function getSourcesForAgency(agency: string): EventSource[] {
  const normalized = normalizeAgency(agency);
  const sources: EventSource[] = [];

  for (const [, source] of Object.entries(data.eventSources)) {
    if (
      source.agencies.includes(normalized) ||
      source.agencies.includes('Multi-Agency')
    ) {
      sources.push(source);
    }
  }

  return sources;
}

// Find sources by category
function getSourcesByCategory(category: string): EventSource[] {
  const sources: EventSource[] = [];

  for (const [, source] of Object.entries(data.eventSources)) {
    if (source.categories.includes(category)) {
      sources.push(source);
    }
  }

  return sources;
}

// NAICS to relevant agencies mapping
function getAgenciesForNaics(naics: string): string[] {
  const naicsAgencyMap: Record<string, string[]> = {
    '541': ['DOD', 'VA', 'HHS', 'GSA', 'DHS', 'NASA', 'DOE'], // Professional services
    '5415': ['DOD', 'VA', 'DHS', 'NASA'], // IT services
    '541512': ['DOD', 'VA', 'DHS', 'NASA'], // Computer systems design
    '541611': ['DOD', 'VA', 'HHS', 'GSA'], // Management consulting
    '541330': ['DOD', 'Navy', 'Army', 'Air Force', 'NASA'], // Engineering
    '541715': ['DOD', 'NASA', 'DOE', 'HHS'], // R&D physical sciences
    '541714': ['DOD', 'NASA', 'DOE', 'HHS', 'NIH'], // R&D biotech
    '236': ['DOD', 'VA', 'GSA'], // Construction
    '238': ['DOD', 'VA', 'GSA'], // Specialty trade contractors
    '561': ['DOD', 'GSA', 'DHS'], // Administrative services
    '561210': ['DOD', 'GSA', 'VA'], // Facilities support
    '561612': ['DOD', 'DHS', 'VA'], // Security guards
  };

  // Try exact match first
  if (naicsAgencyMap[naics]) {
    return naicsAgencyMap[naics];
  }

  // Try sector (first 3 digits)
  const sector = naics.substring(0, 3);
  if (naicsAgencyMap[sector]) {
    return naicsAgencyMap[sector];
  }

  // Try subsector (first 4 digits)
  const subsector = naics.substring(0, 4);
  if (naicsAgencyMap[subsector]) {
    return naicsAgencyMap[subsector];
  }

  // Default to major agencies
  return ['DOD', 'VA', 'GSA', 'HHS', 'DHS'];
}

// Build recommendations based on context
function getRecommendations(params: {
  agency?: string;
  category?: string;
  naics?: string;
  setAside?: string;
}): string[] {
  const recommendations: string[] = [];

  // General recommendations always apply
  recommendations.push(...data.recommendations.established_contractor);

  // Set-aside specific
  if (params.setAside) {
    const setAsideLower = params.setAside.toLowerCase();
    if (
      setAsideLower.includes('8a') ||
      setAsideLower.includes('sdvosb') ||
      setAsideLower.includes('hubzone') ||
      setAsideLower.includes('wosb')
    ) {
      recommendations.push(...data.recommendations.certification_seeking);
    }
  }

  // NAICS-specific
  if (params.naics) {
    const sector = params.naics.substring(0, 3);
    if (sector === '541') {
      recommendations.push(
        'Professional services: Focus on OASIS+ and Alliant 3 events'
      );
    } else if (sector === '236' || sector === '238') {
      recommendations.push(
        'Construction: Focus on Army Corps and GSA PBS events'
      );
    }
  }

  // Dedupe
  return [...new Set(recommendations)];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agencyParam = searchParams.get('agency');
  const categoryParam = searchParams.get('category');
  const naicsParam = searchParams.get('naics');
  const setAsideParam = searchParams.get('setAside');
  const allParam = searchParams.get('all');
  const sourcesParam = searchParams.get('sources');
  const categoriesParam = searchParams.get('categories');
  const conferencesParam = searchParams.get('conferences');

  // Return all event sources
  if (sourcesParam === 'true') {
    return NextResponse.json({
      success: true,
      count: Object.keys(data.eventSources).length,
      sources: data.eventSources,
      lastUpdated: data.lastUpdated,
    });
  }

  // Return all category definitions
  if (categoriesParam === 'true') {
    return NextResponse.json({
      success: true,
      categories: data.eventCategories,
    });
  }

  // Return major annual conferences
  if (conferencesParam === 'true') {
    return NextResponse.json({
      success: true,
      count: data.majorAnnualConferences.length,
      conferences: data.majorAnnualConferences,
    });
  }

  // Return everything
  if (allParam === 'true') {
    return NextResponse.json({
      success: true,
      eventSources: data.eventSources,
      eventCategories: data.eventCategories,
      majorAnnualConferences: data.majorAnnualConferences,
      recommendations: data.recommendations,
      lastUpdated: data.lastUpdated,
    });
  }

  // Filter by agency
  if (agencyParam) {
    const sources = getSourcesForAgency(agencyParam);
    const recommendations = getRecommendations({
      agency: agencyParam,
      setAside: setAsideParam || undefined,
    });

    return NextResponse.json({
      success: true,
      agency: normalizeAgency(agencyParam),
      count: sources.length,
      eventSources: sources,
      categories: data.eventCategories,
      recommendations: recommendations.slice(0, 5),
      relatedConferences: data.majorAnnualConferences.filter(
        (c) =>
          c.audience.toLowerCase().includes('all') ||
          c.audience.toLowerCase().includes(agencyParam.toLowerCase()) ||
          (agencyParam.toUpperCase() === 'DOD' &&
            c.audience.toLowerCase().includes('defense'))
      ),
    });
  }

  // Filter by category
  if (categoryParam) {
    const sources = getSourcesByCategory(categoryParam);
    const categoryInfo = data.eventCategories[categoryParam];

    if (!categoryInfo) {
      return NextResponse.json(
        {
          success: false,
          error: `Category "${categoryParam}" not found`,
          availableCategories: Object.keys(data.eventCategories),
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      category: categoryParam,
      categoryInfo,
      count: sources.length,
      eventSources: sources,
    });
  }

  // Filter by NAICS
  if (naicsParam) {
    const relevantAgencies = getAgenciesForNaics(naicsParam);
    const allSources: EventSource[] = [];

    for (const agency of relevantAgencies) {
      const agencySources = getSourcesForAgency(agency);
      allSources.push(...agencySources);
    }

    // Dedupe by name
    const uniqueSources = allSources.filter(
      (source, index, self) =>
        index === self.findIndex((s) => s.name === source.name)
    );

    const recommendations = getRecommendations({
      naics: naicsParam,
      setAside: setAsideParam || undefined,
    });

    return NextResponse.json({
      success: true,
      naics: naicsParam,
      relevantAgencies,
      count: uniqueSources.length,
      eventSources: uniqueSources,
      categories: data.eventCategories,
      recommendations: recommendations.slice(0, 5),
      tip: 'Events for agencies that commonly buy this NAICS. Register for Industry Days when posted.',
    });
  }

  // Default response - summary
  return NextResponse.json({
    success: true,
    message:
      'Use ?agency=DOD or ?naics=541512 or ?category=industry_day for filtered results. Use ?all=true for everything.',
    summary: {
      totalSources: Object.keys(data.eventSources).length,
      totalCategories: Object.keys(data.eventCategories).length,
      majorConferences: data.majorAnnualConferences.length,
    },
    quickStart: {
      highValueCategories: ['industry_day', 'pre_solicitation', 'matchmaking'],
      freeSources: ['PTAC Training Events', 'SBA Events Calendar'],
      tip: 'Industry Days have highest ROI - you learn requirements before solicitation.',
    },
    endpoints: {
      byAgency: '/api/federal-events?agency=DOD',
      byCategory: '/api/federal-events?category=industry_day',
      byNaics: '/api/federal-events?naics=541512',
      allSources: '/api/federal-events?sources=true',
      allCategories: '/api/federal-events?categories=true',
      conferences: '/api/federal-events?conferences=true',
      everything: '/api/federal-events?all=true',
    },
    lastUpdated: data.lastUpdated,
  });
}
