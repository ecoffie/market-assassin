/**
 * Aggregate Profiles Cron Job
 *
 * Runs nightly to aggregate user search history into briefing profiles.
 * Takes the most frequently searched NAICS codes, agencies, etc.
 * and updates user_notification_settings with their watchlist.
 *
 * Schedule: 1 AM ET daily (before snapshot jobs)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CRON_SECRET = process.env.CRON_SECRET;

interface SearchHistoryRow {
  search_type: string;
  search_value: string;
  tool: string;
  created_at: string;
}

interface AggregatedProfile {
  naics_codes: string[];
  agencies: string[];
  keywords: string[];
  zip_codes: string[];
  watched_companies: string[];
  watched_contracts: string[];
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('[Cron: aggregate-profiles] Starting profile aggregation');

  try {
    // Get all unique users from search history
    const { data: users, error: usersError } = await supabase
      .from('user_search_history')
      .select('user_email')
      .order('user_email');

    if (usersError) {
      console.error('[Cron] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Dedupe users
    const uniqueEmails = [...new Set(users?.map(u => u.user_email) || [])];

    if (uniqueEmails.length === 0) {
      console.log('[Cron] No search history found');
      return NextResponse.json({
        success: true,
        message: 'No search history to aggregate',
        processed: 0,
      });
    }

    console.log(`[Cron] Processing ${uniqueEmails.length} unique users`);

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const email of uniqueEmails) {
      try {
        // Get all search history for this user (last 90 days)
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const { data: searches, error: searchError } = await supabase
          .from('user_search_history')
          .select('search_type, search_value, tool, created_at')
          .eq('user_email', email)
          .gte('created_at', ninetyDaysAgo.toISOString())
          .order('created_at', { ascending: false });

        if (searchError || !searches) {
          console.error(`[Cron] Error fetching searches for ${email}:`, searchError);
          errors++;
          continue;
        }

        // Aggregate by search type with frequency weighting
        const aggregated = aggregateSearches(searches);

        // Check if profile exists
        const { data: existing } = await supabase
          .from('user_notification_settings')
          .select('id')
          .eq('user_email', email)
          .single();

        if (existing) {
          // Update existing profile — write BOTH individual columns AND aggregated_profile JSONB
          const { error: updateError } = await supabase
            .from('user_notification_settings')
            .update({
              naics_codes: aggregated.naics_codes,
              agencies: aggregated.agencies,
              keywords: aggregated.keywords,
              zip_codes: aggregated.zip_codes,
              watched_companies: aggregated.watched_companies,
              watched_contracts: aggregated.watched_contracts,
              aggregated_profile: aggregated,
              last_search_sync: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_email', email);

          if (updateError) {
            console.error(`[Cron] Error updating profile for ${email}:`, updateError);
            errors++;
          } else {
            updated++;
          }
        } else {
          // Create new profile — write BOTH individual columns AND aggregated_profile JSONB
          const { error: insertError } = await supabase
            .from('user_notification_settings')
            .insert({
              user_email: email,
              naics_codes: aggregated.naics_codes,
              agencies: aggregated.agencies,
              keywords: aggregated.keywords,
              zip_codes: aggregated.zip_codes,
              watched_companies: aggregated.watched_companies,
              watched_contracts: aggregated.watched_contracts,
              aggregated_profile: aggregated,
              timezone: 'America/New_York', // Default
              email_frequency: 'daily',
              sms_enabled: false,
              last_search_sync: new Date().toISOString(),
            });

          if (insertError) {
            console.error(`[Cron] Error creating profile for ${email}:`, insertError);
            errors++;
          } else {
            created++;
          }
        }

        processed++;

        // Log summary for this user
        const summary = [
          `${aggregated.naics_codes.length} NAICS`,
          `${aggregated.agencies.length} agencies`,
          `${aggregated.keywords.length} keywords`,
        ].join(', ');
        console.log(`[Cron] Aggregated ${email}: ${summary}`);

      } catch (err) {
        console.error(`[Cron] Error processing ${email}:`, err);
        errors++;
      }
    }

    console.log(`[Cron: aggregate-profiles] Complete: ${processed} processed (${created} created, ${updated} updated), ${errors} errors`);

    return NextResponse.json({
      success: true,
      processed,
      created,
      updated,
      errors,
      totalUsers: uniqueEmails.length,
    });

  } catch (error) {
    console.error('[Cron: aggregate-profiles] Fatal error:', error);
    return NextResponse.json(
      { error: 'Aggregation job failed', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Aggregate search history into ranked watchlist
 */
function aggregateSearches(searches: SearchHistoryRow[]): AggregatedProfile {
  // Count frequency by search type and value
  const counts: Record<string, Record<string, number>> = {
    naics: {},
    agency: {},
    keyword: {},
    zip: {},
    company: {},
    contract: {},
  };

  // Weight recent searches higher
  const now = new Date().getTime();

  for (const search of searches) {
    const type = mapSearchType(search.search_type);
    const value = search.search_value?.trim();
    if (!type || !value) continue;

    // Calculate recency weight (1.0 for today, 0.5 for 90 days ago)
    const searchTime = new Date(search.created_at).getTime();
    const daysAgo = (now - searchTime) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.max(0.5, 1 - (daysAgo / 180));

    counts[type][value] = (counts[type][value] || 0) + recencyWeight;
  }

  // Sort by frequency and take top N for each category
  const rankAndLimit = (items: Record<string, number>, limit: number): string[] => {
    return Object.entries(items)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value]) => value);
  };

  return {
    naics_codes: rankAndLimit(counts.naics, 10),
    agencies: rankAndLimit(counts.agency, 15),
    keywords: rankAndLimit(counts.keyword, 10),
    zip_codes: rankAndLimit(counts.zip, 5),
    watched_companies: rankAndLimit(counts.company, 20),
    watched_contracts: rankAndLimit(counts.contract, 10),
  };
}

/**
 * Map raw search_type to aggregation category
 */
function mapSearchType(searchType: string): string | null {
  const mapping: Record<string, string> = {
    naics: 'naics',
    agency: 'agency',
    keyword: 'keyword',
    zip: 'zip',
    company: 'company',
    contract: 'contract',
    psc: 'keyword', // PSC codes grouped with keywords
    set_aside: 'keyword', // Set-asides grouped with keywords
  };

  return mapping[searchType] || null;
}

export async function POST(request: NextRequest) {
  return GET(request);
}
