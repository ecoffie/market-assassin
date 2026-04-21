#!/usr/bin/env node
/**
 * Create user_engagement tables via direct pg connection
 */

const { Pool } = require('pg');

// Supabase connection string (transaction pooler)
const connectionString = 'postgresql://postgres.krpyelfrbicmvsmwovti:PostgresPassword2024!@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({ connectionString });

const createTableSQL = `
-- Table 1: user_engagement (main event log)
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

-- Table 2: email_tracking_tokens
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

-- Table 3: engagement_daily_stats
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

-- Table 4: user_engagement_scores
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
`;

async function main() {
  console.log('Connecting to Supabase...');

  try {
    const client = await pool.connect();
    console.log('Connected!\n');

    console.log('Creating tables...');
    await client.query(createTableSQL);
    console.log('Tables created successfully!\n');

    // Verify tables exist
    const tables = ['user_engagement', 'email_tracking_tokens', 'engagement_daily_stats', 'user_engagement_scores'];
    console.log('Verifying tables:');

    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`  ✅ ${table}: ${result.rows[0].count} rows`);
    }

    // Test insert
    console.log('\nTesting insert...');
    const insertResult = await client.query(`
      INSERT INTO user_engagement (user_email, event_type, event_source, metadata)
      VALUES ('test@example.com', 'test', 'migration_test', '{"test": true}')
      RETURNING id
    `);
    console.log(`  ✅ Test insert successful, id: ${insertResult.rows[0].id}`);

    // Clean up
    await client.query(`DELETE FROM user_engagement WHERE event_source = 'migration_test'`);
    console.log('  ✅ Test row deleted');

    client.release();
    await pool.end();

    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
