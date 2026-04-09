/**
 * Admin endpoint to apply briefing_templates migration
 *
 * Usage: GET /api/admin/apply-briefing-templates-migration?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== process.env.ADMIN_PASSWORD && password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results: string[] = [];
  const errors: string[] = [];

  try {
    // Check if briefing_templates exists
    const { error: checkError } = await supabase
      .from('briefing_templates')
      .select('id')
      .limit(1);

    if (!checkError || checkError.code !== 'PGRST205') {
      results.push('briefing_templates table already exists');
    } else {
      // Table doesn't exist - create it via raw SQL
      // Note: This requires the table to be created via Supabase dashboard
      // or using supabase CLI. We'll try inserting to confirm.
      errors.push('briefing_templates table does not exist - please create via Supabase Dashboard SQL Editor');
    }

    // Check if briefing_precompute_runs exists
    const { error: checkError2 } = await supabase
      .from('briefing_precompute_runs')
      .select('id')
      .limit(1);

    if (!checkError2 || checkError2.code !== 'PGRST205') {
      results.push('briefing_precompute_runs table already exists');
    } else {
      errors.push('briefing_precompute_runs table does not exist - please create via Supabase Dashboard SQL Editor');
    }

    // If tables don't exist, provide the SQL to run
    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        message: 'Tables need to be created via Supabase Dashboard',
        results,
        errors,
        sql_to_run: `
-- Run this in Supabase Dashboard > SQL Editor:

-- Pre-computed briefing templates by NAICS profile
CREATE TABLE IF NOT EXISTS briefing_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  naics_profile TEXT NOT NULL,
  naics_profile_hash TEXT NOT NULL,
  template_date DATE NOT NULL DEFAULT CURRENT_DATE,
  briefing_type TEXT NOT NULL DEFAULT 'daily',
  briefing_content JSONB NOT NULL,
  opportunities_count INTEGER DEFAULT 0,
  teaming_plays_count INTEGER DEFAULT 0,
  processing_time_ms INTEGER,
  llm_provider TEXT,
  llm_model TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '36 hours',
  UNIQUE(naics_profile_hash, template_date, briefing_type)
);

-- Fast lookup index
CREATE INDEX IF NOT EXISTS idx_briefing_templates_lookup
  ON briefing_templates(naics_profile_hash, template_date, briefing_type);

-- Cleanup index for expired templates
CREATE INDEX IF NOT EXISTS idx_briefing_templates_expires
  ON briefing_templates(expires_at);

-- Track pre-computation runs
CREATE TABLE IF NOT EXISTS briefing_precompute_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  briefing_type TEXT NOT NULL DEFAULT 'daily',
  unique_profiles_found INTEGER,
  templates_generated INTEGER,
  templates_failed INTEGER,
  total_users_covered INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  error_messages JSONB,
  UNIQUE(run_date, briefing_type)
);

-- Comments
COMMENT ON TABLE briefing_templates IS 'Pre-computed briefing templates by NAICS profile. One template serves many users with the same NAICS codes.';
COMMENT ON TABLE briefing_precompute_runs IS 'Tracks nightly pre-computation jobs that generate templates.';
        `.trim(),
      });
    }

    return NextResponse.json({
      success: true,
      message: 'All required tables exist',
      results,
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
