/**
 * Lindy API Documentation Endpoint
 *
 * GET /api/lindy - Returns API documentation for Lindy integration
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    name: 'GovCon Giants Lindy Intelligence API',
    version: '1.0.0',
    description: 'Unified intelligence API for Lindy AI integration. Provides daily briefings, recompete alerts, contractor activity, and recommended actions.',

    authentication: {
      required: true,
      how: 'Authorization: Bearer <Mindy connection key>',
      get_a_key: 'https://getmindy.ai/briefings/lindy-setup — create a connection key (scope: briefings:read). It reads only your own briefings and can be revoked any time from https://getmindy.ai/mcp/account.',
      note: 'An email address is never accepted as authentication.',
    },

    endpoints: {
      intelligence: {
        url: '/api/lindy/intelligence',
        method: 'GET',
        description: 'Get unified intelligence for the authenticated user',
        params: {
          days: {
            required: false,
            type: 'number',
            default: 1,
            max: 7,
            description: 'Number of days of history to include',
          },
          include: {
            required: false,
            type: 'string',
            default: 'briefing,recompetes,contractors,actions',
            description: 'Comma-separated sections to include',
            options: ['briefing', 'recompetes', 'contractors', 'actions'],
          },
        },
        example: 'GET /api/lindy/intelligence?days=1  (header: Authorization: Bearer <key>)',
      },
    },

    response_schema: {
      as_of: 'ISO 8601 timestamp of when intelligence was generated',
      user_email: 'The authenticated user',
      profile_summary: {
        naics_codes: 'Array of NAICS codes user tracks',
        agencies: 'Array of agencies user tracks',
        watched_companies: 'Array of competitor companies user monitors',
      },
      briefing: {
        date: 'Briefing date (YYYY-MM-DD)',
        headline: 'Main briefing headline',
        subheadline: 'Supporting context',
        total_items: 'Total intelligence items',
        urgent_alerts: 'Number of urgent items',
        quick_stats: 'Array of key metrics',
        top_items: 'Top 5 intelligence items with details',
      },
      recompetes: {
        critical: 'Contracts expiring within 30 days',
        high: 'Contracts expiring within 90 days',
        upcoming: 'Contracts expiring within 180 days',
        total_count: 'Total recompete opportunities tracked',
      },
      contractor_activity: {
        tier1_moves: 'Large contractor wins and movements',
        tier2_moves: 'Small business contractor activity',
        watched_company_alerts: 'Activity from user\'s watch list',
      },
      recommended_actions: {
        description: 'AI-generated action items based on intelligence',
        types: ['outreach', 'content', 'deadline', 'opportunity', 'competitor_watch'],
        priorities: ['high', 'medium', 'low'],
      },
      meta: {
        data_freshness: 'Timestamps showing when each data source was last updated',
        next_briefing_at: 'When the next daily briefing will be generated (7 AM UTC)',
        api_version: 'API version string',
      },
    },

    polling_recommendations: {
      frequency: 'Poll once daily after 7:00 AM UTC when briefings are generated',
      best_time: '9:30 AM UTC (allows briefing generation to complete)',
      rate_limit: 'No strict rate limit, but recommend max 10 requests per hour',
    },

    action_types: {
      deadline: 'Time-sensitive recompete or solicitation deadlines',
      opportunity: 'New opportunities matching user profile',
      competitor_watch: 'Activity from watched competitors',
      content: 'Content creation suggestions based on market signals',
      outreach: 'Teaming or partnership outreach suggestions',
    },

    use_cases: [
      {
        name: 'Daily Briefing Summary',
        description: 'Get top intelligence items for morning review',
        query: '?include=briefing',
      },
      {
        name: 'Urgent Deadline Alerts',
        description: 'Get critical recompetes needing immediate action',
        query: '?include=recompetes',
      },
      {
        name: 'Competitor Monitoring',
        description: 'Track watched company activity',
        query: '?include=contractors',
      },
      {
        name: 'Action Item Generation',
        description: 'Get AI-recommended actions for the day',
        query: '?include=actions',
      },
      {
        name: 'Full Intelligence Feed',
        description: 'Get everything for comprehensive analysis',
        query: '?days=7',
      },
    ],

    lindy_integration: {
      setup: 'Configure a Lindy scheduled trigger to GET /api/lindy/intelligence daily with your connection key in the Authorization header',
      knowledge_base: 'Route response to Lindy Knowledge Base for conversational Q&A',
      actions: 'Use recommended_actions array to trigger Lindy automations',
      calendar: 'Use deadline actions to create calendar reminders',
      email: 'Use outreach actions to draft email templates',
      content: 'Use content actions to generate LinkedIn post ideas',
    },
  });
}
