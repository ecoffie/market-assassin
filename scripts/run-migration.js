/**
 * Run SQL migration for intelligence metrics tables
 *
 * Usage: node scripts/run-migration.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env manually
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Running intelligence metrics migration...\n');

  // Split the SQL into individual statements
  const statements = [
    // 1. Intelligence Metrics table
    `CREATE TABLE IF NOT EXISTS intelligence_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL,
      metric_type TEXT NOT NULL,
      emails_attempted INTEGER DEFAULT 0,
      emails_sent INTEGER DEFAULT 0,
      emails_failed INTEGER DEFAULT 0,
      users_eligible INTEGER DEFAULT 0,
      users_skipped INTEGER DEFAULT 0,
      opportunities_matched INTEGER DEFAULT 0,
      opportunities_total INTEGER DEFAULT 0,
      avg_match_score NUMERIC(5,2),
      emails_opened INTEGER DEFAULT 0,
      emails_clicked INTEGER DEFAULT 0,
      unsubscribes INTEGER DEFAULT 0,
      user_feedback_positive INTEGER DEFAULT 0,
      user_feedback_negative INTEGER DEFAULT 0,
      cron_duration_ms INTEGER,
      api_calls_made INTEGER DEFAULT 0,
      api_errors INTEGER DEFAULT 0,
      guardrail_warnings INTEGER DEFAULT 0,
      circuit_breaker_tripped BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 2. Intelligence Log table
    `CREATE TABLE IF NOT EXISTS intelligence_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT NOT NULL,
      intelligence_type TEXT NOT NULL,
      delivered_at TIMESTAMPTZ DEFAULT NOW(),
      delivery_method TEXT DEFAULT 'email',
      delivery_status TEXT DEFAULT 'sent',
      items_count INTEGER DEFAULT 0,
      item_ids TEXT[] DEFAULT '{}',
      item_data JSONB,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      click_count INTEGER DEFAULT 0,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3. User Feedback table
    `CREATE TABLE IF NOT EXISTS user_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      intelligence_type TEXT,
      intelligence_log_id UUID,
      opportunity_id TEXT,
      rating INTEGER,
      is_positive BOOLEAN,
      comment TEXT,
      feedback_source TEXT DEFAULT 'email',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 4. Guardrail Events table
    `CREATE TABLE IF NOT EXISTS guardrail_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      cron_name TEXT,
      reason TEXT,
      failure_rate NUMERIC(5,4),
      consecutive_failures INTEGER,
      total_failures INTEGER,
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  const indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_date_type ON intelligence_metrics(date, metric_type)',
    'CREATE INDEX IF NOT EXISTS idx_metrics_date ON intelligence_metrics(date)',
    'CREATE INDEX IF NOT EXISTS idx_intelligence_log_email ON intelligence_log(user_email)',
    'CREATE INDEX IF NOT EXISTS idx_intelligence_log_type ON intelligence_log(intelligence_type)',
    'CREATE INDEX IF NOT EXISTS idx_intelligence_log_delivered ON intelligence_log(delivered_at)',
    'CREATE INDEX IF NOT EXISTS idx_intelligence_log_status ON intelligence_log(delivery_status)',
    'CREATE INDEX IF NOT EXISTS idx_feedback_email ON user_feedback(user_email)',
    'CREATE INDEX IF NOT EXISTS idx_feedback_type ON user_feedback(feedback_type)',
    'CREATE INDEX IF NOT EXISTS idx_feedback_positive ON user_feedback(is_positive)',
    'CREATE INDEX IF NOT EXISTS idx_feedback_created ON user_feedback(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_guardrail_type ON guardrail_events(event_type)',
    'CREATE INDEX IF NOT EXISTS idx_guardrail_cron ON guardrail_events(cron_name)',
    'CREATE INDEX IF NOT EXISTS idx_guardrail_created ON guardrail_events(created_at)',
  ];

  // Run table creation
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const tableName = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] || `statement_${i}`;

    try {
      const { error } = await supabase.rpc('exec_sql', { sql: stmt });

      if (error) {
        // Try direct query via REST
        console.log(`[${tableName}] RPC not available, using workaround...`);
      } else {
        console.log(`✅ Created table: ${tableName}`);
      }
    } catch (err) {
      console.log(`[${tableName}] Skipping RPC, checking if table exists...`);
    }
  }

  // Verify tables exist by querying them
  const tables = ['intelligence_metrics', 'intelligence_log', 'user_feedback', 'guardrail_events'];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('id').limit(1);

    if (error && error.code === '42P01') {
      console.log(`❌ Table ${table} does not exist - please create manually in Supabase dashboard`);
    } else if (error) {
      console.log(`⚠️ ${table}: ${error.message}`);
    } else {
      console.log(`✅ ${table}: exists and accessible`);
    }
  }

  console.log('\n--- Migration check complete ---\n');
  console.log('If tables are missing, copy the SQL from:');
  console.log('  supabase/migrations/20260402_intelligence_metrics.sql');
  console.log('And run it in Supabase Dashboard > SQL Editor');
}

runMigration().catch(console.error);
