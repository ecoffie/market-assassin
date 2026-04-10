/**
 * AI Teaming Suggestions API
 *
 * Get AI-powered teaming partner suggestions based on opportunity requirements
 *
 * GET /api/teaming/suggest?naics=541512&setAside=8a&agency=VA
 */

import { NextRequest, NextResponse } from 'next/server';
import contractorData from '@/data/contractors.json';

// Actual structure from contractors.json
interface ContractorRaw {
  company: string;
  sblo_name: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  naics: string;
  source: string;
  contract_count: string;
  total_contract_value: string;
  agencies: string;
  has_subcontract_plan: string;
  has_email: boolean;
  has_phone: boolean;
  has_contact: boolean;
  contract_value_num: number;
}

export async function GET(request: NextRequest) {
  const naics = request.nextUrl.searchParams.get('naics');
  const setAside = request.nextUrl.searchParams.get('setAside');
  const agency = request.nextUrl.searchParams.get('agency');
  const state = request.nextUrl.searchParams.get('state');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10');

  if (!naics) {
    return NextResponse.json(
      { error: 'naics parameter required' },
      { status: 400 }
    );
  }

  try {
    // Load contractor database
    const contractors = contractorData as ContractorRaw[];

    // Score and filter contractors
    const scored = contractors
      .map(c => ({
        ...c,
        score: calculateMatchScore(c, {
          naics,
          setAside,
          agency,
          state
        })
      }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Format results
    const suggestions = scored.map(c => ({
      name: c.company,
      score: c.score,
      matchReasons: getMatchReasons(c, { naics, setAside, agency, state }),
      naicsCode: c.naics,
      agencies: c.agencies,
      address: c.address,
      contractCount: c.contract_count,
      contractValue: c.total_contract_value,
      contact: c.has_contact ? {
        name: c.sblo_name,
        title: c.title,
        email: c.email || null,
        phone: c.phone || null
      } : null,
      suggestedRole: suggestRole(c, setAside)
    }));

    return NextResponse.json({
      suggestions,
      criteria: { naics, setAside, agency, state },
      total: suggestions.length
    });
  } catch (error) {
    console.error('Teaming suggest error:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestions' },
      { status: 500 }
    );
  }
}

function calculateMatchScore(
  contractor: ContractorRaw,
  criteria: { naics?: string | null; setAside?: string | null; agency?: string | null; state?: string | null }
): number {
  let score = 0;

  // NAICS match (highest weight)
  if (criteria.naics && contractor.naics) {
    if (contractor.naics === criteria.naics) {
      score += 40; // Exact match
    } else if (contractor.naics.startsWith(criteria.naics.substring(0, 3))) {
      score += 20; // Same industry (3-digit prefix)
    }
  }

  // Agency match
  if (criteria.agency && contractor.agencies) {
    if (contractor.agencies.toLowerCase().includes(criteria.agency.toLowerCase())) {
      score += 25;
    }
  }

  // State match (check address field)
  if (criteria.state && contractor.address) {
    // Address often contains state abbreviation
    if (contractor.address.toUpperCase().includes(criteria.state.toUpperCase())) {
      score += 15;
    }
  }

  // Has contact info (useful for outreach)
  if (contractor.has_email || contractor.has_phone) {
    score += 10;
  }

  // Higher contract value = more established
  if (contractor.contract_value_num > 1_000_000) {
    score += 5;
  }

  return score;
}

function getMatchReasons(
  contractor: ContractorRaw,
  criteria: { naics?: string | null; setAside?: string | null; agency?: string | null; state?: string | null }
): string[] {
  const reasons: string[] = [];

  if (criteria.naics && contractor.naics === criteria.naics) {
    reasons.push(`NAICS ${criteria.naics} match`);
  } else if (criteria.naics && contractor.naics?.startsWith(criteria.naics.substring(0, 3))) {
    reasons.push(`Same NAICS industry (${contractor.naics})`);
  }

  if (criteria.agency && contractor.agencies?.toLowerCase().includes(criteria.agency.toLowerCase())) {
    reasons.push(`Works with ${criteria.agency}`);
  }

  if (contractor.has_email || contractor.has_phone) {
    reasons.push('Contact info available');
  }

  if (contractor.contract_value_num > 10_000_000) {
    reasons.push('Established prime contractor');
  }

  return reasons;
}

function suggestRole(
  contractor: ContractorRaw,
  setAside?: string | null
): 'prime' | 'sub' | 'jv' | 'mentor' {
  // Large contract value = likely prime
  if (contractor.contract_value_num > 10_000_000) {
    return 'prime';
  }

  // Has subcontract plan = potentially mentor
  if (contractor.has_subcontract_plan === 'True') {
    return 'mentor';
  }

  // Default to sub for most matches
  return 'sub';
}
