/**
 * Admin endpoint to apply user_engagement migration
 * GET /api/admin/apply-engagement-migration?password=xxx - Check status
 * POST /api/admin/apply-engagement-migration?password=xxx - Apply migration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Lazy init Supabase
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Check if tables exist
  const tables = ['user_engagement', 'email_tracking_tokens', 'engagement_daily_stats', 'user_engagement_scores'];
  const tableStatus: Record<string, boolean> = {};

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .limit(1);

    tableStatus[table] = !error;
  }

  const allExist = Object.values(tableStatus).every(v => v);

  return NextResponse.json({
    success: true,
    migrationStatus: allExist ? 'applied' : 'pending',
    tables: tableStatus,
    message: allExist
      ? 'All user_engagement tables exist'
      : 'Some tables missing - run POST to apply migration'
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const results: { table: string; status: string; error?: string }[] = [];

  // Create user_engagement table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: engagementError } = await (supabase.rpc as any)('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS user_engagement (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_source TEXT,
        metadata JSONB DEFAULT '{}',
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_engagement_email ON user_engagement(user_email);
      CREATE INDEX IF NOT EXISTS idx_user_engagement_type ON user_engagement(event_type);
      CREATE INDEX IF NOT EXISTS idx_user_engagement_source ON user_engagement(event_source);
      CREATE INDEX IF NOT EXISTS idx_user_engagement_created ON user_engagement(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_engagement_email_date ON user_engagement(user_email, created_at DESC);
    `
  });

  if (engagementError) {
    // Try direct SQL approach
    const { error: directError } = await supabase
      .from('user_engagement')
      .select('id')
      .limit(1);

    if (directError && directError.code === '42P01') {
      // Table doesn't exist, create via REST
      results.push({
        table: 'user_engagement',
        status: 'needs_manual_creation',
        error: 'Run migration SQL directly in Supabase dashboard'
      });
    } else {
      results.push({ table: 'user_engagement', status: 'exists' });
    }
  } else {
    results.push({ table: 'user_engagement', status: 'created' });
  }

  // Create email_tracking_tokens table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: tokensError } = await (supabase.rpc as any)('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS email_tracking_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token TEXT UNIQUE NOT NULL,
        user_email TEXT NOT NULL,
        email_type TEXT NOT NULL,
        email_date DATE NOT NULL,
        opens INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        first_open_at TIMESTAMPTZ,
        last_open_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
      );
      CREATE INDEX IF NOT EXISTS idx_email_tracking_token ON email_tracking_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_email_tracking_email ON email_tracking_tokens(user_email);
    `
  });

  if (tokensError) {
    const { error: directError } = await supabase
      .from('email_tracking_tokens')
      .select('id')
      .limit(1);

    results.push({
      table: 'email_tracking_tokens',
      status: directError?.code === '42P01' ? 'needs_manual_creation' : 'exists'
    });
  } else {
    results.push({ table: 'email_tracking_tokens', status: 'created' });
  }

  // Create engagement_daily_stats table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: statsError } = await (supabase.rpc as any)('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS engagement_daily_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stat_date DATE NOT NULL,
        email_type TEXT,
        emails_sent INTEGER DEFAULT 0,
        emails_opened INTEGER DEFAULT 0,
        unique_opens INTEGER DEFAULT 0,
        links_clicked INTEGER DEFAULT 0,
        unique_clickers INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        active_users INTEGER DEFAULT 0,
        reports_generated INTEGER DEFAULT 0,
        exports_count INTEGER DEFAULT 0,
        open_rate DECIMAL(5,2),
        click_rate DECIMAL(5,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(stat_date, email_type)
      );
      CREATE INDEX IF NOT EXISTS idx_engagement_daily_date ON engagement_daily_stats(stat_date DESC);
    `
  });

  if (statsError) {
    const { error: directError } = await supabase
      .from('engagement_daily_stats')
      .select('id')
      .limit(1);

    results.push({
      table: 'engagement_daily_stats',
      status: directError?.code === '42P01' ? 'needs_manual_creation' : 'exists'
    });
  } else {
    results.push({ table: 'engagement_daily_stats', status: 'created' });
  }

  // Create user_engagement_scores table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: scoresError } = await (supabase.rpc as any)('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS user_engagement_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email TEXT NOT NULL UNIQUE,
        engagement_score INTEGER DEFAULT 50,
        emails_opened_30d INTEGER DEFAULT 0,
        emails_sent_30d INTEGER DEFAULT 0,
        links_clicked_30d INTEGER DEFAULT 0,
        page_views_30d INTEGER DEFAULT 0,
        logins_30d INTEGER DEFAULT 0,
        reports_generated_30d INTEGER DEFAULT 0,
        profile_completeness INTEGER DEFAULT 0,
        days_since_last_activity INTEGER,
        last_activity_at TIMESTAMPTZ,
        churn_risk TEXT DEFAULT 'low',
        computed_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_scores_email ON user_engagement_scores(user_email);
      CREATE INDEX IF NOT EXISTS idx_user_scores_churn ON user_engagement_scores(churn_risk);
      CREATE INDEX IF NOT EXISTS idx_user_scores_score ON user_engagement_scores(engagement_score DESC);
    `
  });

  if (scoresError) {
    const { error: directError } = await supabase
      .from('user_engagement_scores')
      .select('id')
      .limit(1);

    results.push({
      table: 'user_engagement_scores',
      status: directError?.code === '42P01' ? 'needs_manual_creation' : 'exists'
    });
  } else {
    results.push({ table: 'user_engagement_scores', status: 'created' });
  }

  const needsManual = results.filter(r => r.status === 'needs_manual_creation');

  return NextResponse.json({
    success: needsManual.length === 0,
    results,
    message: needsManual.length > 0
      ? `${needsManual.length} tables need manual creation. Run the SQL from supabase/migrations/20260419_user_engagement.sql in Supabase dashboard.`
      : 'All tables created successfully'
  });
}
