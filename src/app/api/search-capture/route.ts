import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Valid tool names
const VALID_TOOLS = [
  'market_assassin',
  'recompete',
  'opportunity_hunter',
  'contractor_db',
  'content_generator'
] as const;

// Valid search types
const VALID_SEARCH_TYPES = [
  'naics',
  'agency',
  'keyword',
  'company',
  'zip',
  'contract',
  'psc', // Product Service Code
  'set_aside'
] as const;

type Tool = typeof VALID_TOOLS[number];
type SearchType = typeof VALID_SEARCH_TYPES[number];

interface SearchCaptureRequest {
  user_email: string;
  tool: Tool;
  search_type?: SearchType;
  search_value: string;
  search_metadata?: Record<string, unknown>;
}

/**
 * POST /api/search-capture
 *
 * Captures user searches across all tools to auto-build briefing watchlists.
 * This endpoint is non-blocking — fire and forget from the frontend.
 *
 * Body:
 * {
 *   user_email: string (required)
 *   tool: 'market_assassin' | 'recompete' | 'opportunity_hunter' | 'contractor_db' | 'content_generator'
 *   search_type: 'naics' | 'agency' | 'keyword' | 'company' | 'zip' | 'contract' | 'psc' | 'set_aside'
 *   search_value: string (required)
 *   search_metadata?: object (optional - full search params for context)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body: SearchCaptureRequest = await request.json();

    // Validate required fields
    if (!body.user_email || !body.tool || !body.search_value) {
      return NextResponse.json(
        { error: 'Missing required fields: user_email, tool, search_value' },
        { status: 400 }
      );
    }

    // Validate email format (basic check)
    if (!body.user_email.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate tool
    if (!VALID_TOOLS.includes(body.tool)) {
      return NextResponse.json(
        { error: `Invalid tool. Must be one of: ${VALID_TOOLS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate search_type if provided
    if (body.search_type && !VALID_SEARCH_TYPES.includes(body.search_type)) {
      return NextResponse.json(
        { error: `Invalid search_type. Must be one of: ${VALID_SEARCH_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Normalize the search value (trim whitespace, lowercase for consistency)
    const normalizedValue = body.search_value.trim();

    // Skip empty values
    if (!normalizedValue) {
      return NextResponse.json({ success: true, message: 'Empty search value, skipped' });
    }

    // Insert into user_search_history
    const { error: insertError } = await supabase
      .from('user_search_history')
      .insert({
        user_email: body.user_email.toLowerCase().trim(),
        tool: body.tool,
        search_type: body.search_type || 'keyword', // Default to keyword if not specified
        search_value: normalizedValue,
        search_metadata: body.search_metadata || {}
      });

    if (insertError) {
      console.error('Error inserting search history:', insertError);
      // Don't fail the request — this is non-blocking
      return NextResponse.json({
        success: false,
        error: 'Failed to capture search',
        details: insertError.message
      });
    }

    // Real-time profile update: if this user has a briefing profile,
    // immediately add the new search value to it (don't wait for nightly cron)
    try {
      const email = body.user_email.toLowerCase().trim();
      const searchType = body.search_type || 'keyword';

      // Map search type to profile column
      const columnMap: Record<string, string> = {
        naics: 'naics_codes',
        agency: 'agencies',
        keyword: 'keywords',
        zip: 'zip_codes',
        company: 'watched_companies',
        contract: 'watched_contracts',
        psc: 'keywords',
        set_aside: 'keywords',
      };

      const column = columnMap[searchType];
      if (column) {
        const { data: profile } = await supabase
          .from('user_briefing_profile')
          .select(`${column}, aggregated_profile`)
          .eq('user_email', email)
          .single();

        if (profile) {
          const profileData = profile as Record<string, unknown>;
          const currentValues: string[] = Array.isArray(profileData[column]) ? profileData[column] as string[] : [];
          if (!currentValues.includes(normalizedValue)) {
            const updatedValues = [...currentValues, normalizedValue];
            // Also update aggregated_profile JSONB to stay in sync
            const currentJsonb = (profile.aggregated_profile && typeof profile.aggregated_profile === 'object')
              ? profile.aggregated_profile as Record<string, unknown>
              : {};
            const updatedJsonb = { ...currentJsonb, [column]: updatedValues };

            await supabase
              .from('user_briefing_profile')
              .update({ [column]: updatedValues, aggregated_profile: updatedJsonb, updated_at: new Date().toISOString() })
              .eq('user_email', email);
          }
        }
      }
    } catch (profileErr) {
      // Non-fatal — nightly cron will catch up
      console.error('Profile update error (non-fatal):', profileErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Search captured'
    });

  } catch (error) {
    console.error('Search capture error:', error);
    // Don't fail the request — this should be non-blocking
    return NextResponse.json({
      success: false,
      error: 'Internal error'
    });
  }
}

/**
 * GET /api/search-capture?email=user@example.com
 *
 * Returns search history for a user (for debugging/admin).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Missing email parameter' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('user_search_history')
      .select('*')
      .eq('user_email', email.toLowerCase().trim())
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching search history:', error);
      return NextResponse.json(
        { error: 'Failed to fetch search history' },
        { status: 500 }
      );
    }

    // Also get the aggregated profile
    const { data: profile } = await supabase
      .from('user_briefing_profile')
      .select('*')
      .eq('user_email', email.toLowerCase().trim())
      .single();

    return NextResponse.json({
      email,
      search_count: data?.length || 0,
      recent_searches: data || [],
      briefing_profile: profile || null
    });

  } catch (error) {
    console.error('Search capture GET error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
