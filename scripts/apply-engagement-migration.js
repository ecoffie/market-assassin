#!/usr/bin/env node
/**
 * Apply user_engagement tables migration to Supabase
 * Run: node scripts/apply-engagement-migration.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://krpyelfrbicmvsmwovti.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTables() {
  console.log('Creating user engagement tables...\n');

  // Table 1: user_engagement
  console.log('1. Creating user_engagement table...');

  // Try to insert/select to check if table exists
  const { error: checkError } = await supabase.from('user_engagement').select('id').limit(1);

  if (checkError && checkError.code === 'PGRST205') {
    // Table doesn't exist - need to create via SQL Editor in Supabase dashboard
    console.log('   ❌ Table does not exist');
    console.log('   Please run the migration SQL in Supabase dashboard:');
    console.log('   supabase/migrations/20260419_user_engagement.sql\n');
    console.log('   Or use the SQL Editor at:');
    console.log('   https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new\n');

    return false;
  } else if (!checkError) {
    console.log('   ✅ Table already exists');
    return true;
  } else {
    console.log('   ❓ Unknown error:', checkError.message);
    return false;
  }
}

async function testInsert() {
  console.log('\nTesting insert...');

  const { data, error } = await supabase
    .from('user_engagement')
    .insert({
      user_email: 'test@example.com',
      event_type: 'test',
      event_source: 'migration_test',
      metadata: { test: true }
    })
    .select('id')
    .single();

  if (error) {
    console.log('   ❌ Insert failed:', error.message);
    return false;
  }

  console.log('   ✅ Insert successful, id:', data.id);

  // Clean up test row
  await supabase.from('user_engagement').delete().eq('id', data.id);
  console.log('   ✅ Test row deleted');

  return true;
}

async function main() {
  const tablesExist = await createTables();

  if (tablesExist) {
    await testInsert();
    console.log('\n✅ Migration complete!');
  } else {
    console.log('\n⚠️  Tables need to be created manually.');
    console.log('\nCopy this SQL to Supabase dashboard SQL Editor:\n');
    console.log('─'.repeat(60));
    console.log(`
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
CREATE INDEX IF NOT EXISTS idx_email_tracking_email_type ON email_tracking_tokens(email_type, email_date);

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
CREATE INDEX IF NOT EXISTS idx_engagement_daily_type ON engagement_daily_stats(email_type, stat_date DESC);

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
CREATE INDEX IF NOT EXISTS idx_user_scores_last_activity ON user_engagement_scores(days_since_last_activity DESC);
`);
    console.log('─'.repeat(60));
  }
}

main().catch(console.error);
