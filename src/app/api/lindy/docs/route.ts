/**
 * Lindy API Documentation
 *
 * GET /api/lindy/docs
 *
 * Returns documentation for all Lindy API endpoints
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    api_name: 'GovCon Giants Lindy Integration API',
    version: '1.0.0',
    base_url: 'https://tools.govcongiants.org/api/lindy',

    endpoints: [
      {
        path: '/intelligence',
        method: 'GET',
        description: 'Get personalized GovCon intelligence for a user',
        parameters: {
          email: {
            type: 'string',
            required: true,
            description: 'User email address',
          },
          days: {
            type: 'number',
            required: false,
            default: 1,
            max: 7,
            description: 'Number of days of history',
          },
          include: {
            type: 'string',
            required: false,
            default: 'briefing,recompetes,contractors,actions',
            description: 'Comma-separated sections to include',
          },
        },
        example_request: 'GET /api/lindy/intelligence?email=user@example.com',
        returns: {
          briefing: 'Latest briefing with opportunities, teaming plays, market intel',
          recompetes: 'Expiring contracts by risk level (critical, high, upcoming)',
          contractor_activity: 'Recent awards and competitor moves',
          recommended_actions: 'AI-generated action items',
        },
      },
      {
        path: '/match',
        method: 'POST',
        description: 'Match user knowledge base against opportunities and agency pain points',
        parameters: {
          email: {
            type: 'string',
            required: true,
            description: 'User email address',
          },
          user_kb: {
            type: 'object',
            required: true,
            description: 'User knowledge base with capabilities, certifications, etc.',
            fields: {
              capabilities: 'Array of capability keywords (cybersecurity, cloud migration, etc.)',
              past_performance: 'Array of past performance descriptions',
              certifications: 'Array of certifications (ISO 27001, FedRAMP, CMMC)',
              set_asides: 'Array of set-aside types (SDVOSB, 8(a), HUBZone)',
              naics_codes: 'Array of NAICS codes',
              target_agencies: 'Array of agency acronyms (DHS, VA, DOD)',
              teaming_interests: 'Array of teaming preferences (prime, sub, JV)',
              geographic_presence: 'Array of locations',
            },
          },
          query: {
            type: 'string',
            required: false,
            description: 'Natural language filter (e.g., "find cyber opportunities at DHS")',
          },
        },
        example_request: {
          method: 'POST',
          url: '/api/lindy/match',
          body: {
            email: 'user@example.com',
            user_kb: {
              capabilities: ['cybersecurity', 'cloud migration', 'zero trust'],
              set_asides: ['SDVOSB'],
              naics_codes: ['541511', '541512'],
              target_agencies: ['DHS', 'VA'],
              teaming_interests: ['sub'],
            },
            query: 'find cyber opportunities',
          },
        },
        returns: {
          matched_opportunities: 'Opportunities ranked by fit score with talking points',
          agency_matches: 'Agencies where capabilities match pain points',
          teaming_synergies: 'Potential teaming opportunities',
          recommendations: 'Strategic recommendations based on analysis',
        },
      },
    ],

    use_cases: [
      {
        scenario: 'User asks: "What opportunities should I focus on?"',
        approach: [
          '1. Call /intelligence to get current briefing',
          '2. Call /match with user KB to get fit scores',
          '3. Present top matched opportunities with talking points',
        ],
      },
      {
        scenario: 'User asks: "Which agencies need my capabilities?"',
        approach: [
          '1. Call /match with user KB',
          '2. Present agency_matches showing pain point overlaps',
          '3. Provide positioning statements for each agency',
        ],
      },
      {
        scenario: 'User asks: "Find me teaming opportunities"',
        approach: [
          '1. Call /match with teaming_interests set to "sub"',
          '2. Present teaming_synergies and suggested primes',
          '3. Recommend specific outreach actions',
        ],
      },
      {
        scenario: 'User asks: "What\'s happening in GovCon today?"',
        approach: [
          '1. Call /intelligence to get latest briefing',
          '2. Present market_intel items and recent competitor moves',
          '3. Highlight any urgent deadlines',
        ],
      },
    ],

    lindy_prompts: {
      intelligence_pull: 'When user asks about opportunities, market news, or "what\'s happening", call GET /api/lindy/intelligence?email={user_email} first to get current data.',
      match_analysis: 'When user asks about fit, capabilities match, or agency targeting, call POST /api/lindy/match with their knowledge base.',
      combine_for_strategy: 'For strategic questions, combine intelligence data with match analysis to provide actionable recommendations.',
    },
  });
}
