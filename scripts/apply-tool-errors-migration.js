#!/usr/bin/env node
/**
 * Apply Tool Errors Migration
 *
 * Usage: node scripts/apply-tool-errors-migration.js
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY env var
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('Applying Tool Errors Migration...\n');
  const results = [];
  const errors = [];

  // 1. Create tool_errors table
  console.log('1. Creating tool_errors table...');
  const { error: e1 } = await supabase.from('tool_errors').select('id').limit(1);

  if (e1 && e1.message.includes('does not exist')) {
    console.log('   Table does not exist. Please run the SQL migration manually in Supabase SQL Editor.');
    console.log('\n   Go to: https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new');
    console.log('   Copy and paste the contents of: supabase/migrations/20260419_tool_errors.sql\n');
    results.push('tool_errors: needs manual creation');
  } else if (e1) {
    errors.push(`tool_errors check failed: ${e1.message}`);
  } else {
    results.push('tool_errors: already exists');
  }

  // 2. Check tool_health_metrics table
  console.log('2. Checking tool_health_metrics table...');
  const { error: e2 } = await supabase.from('tool_health_metrics').select('id').limit(1);

  if (e2 && e2.message.includes('does not exist')) {
    results.push('tool_health_metrics: needs manual creation');
  } else if (e2) {
    errors.push(`tool_health_metrics check failed: ${e2.message}`);
  } else {
    results.push('tool_health_metrics: already exists');
  }

  // 3. Check api_provider_status table
  console.log('3. Checking api_provider_status table...');
  const { error: e3 } = await supabase.from('api_provider_status').select('id').limit(1);

  if (e3 && e3.message.includes('does not exist')) {
    results.push('api_provider_status: needs manual creation');
  } else if (e3) {
    errors.push(`api_provider_status check failed: ${e3.message}`);
  } else {
    // Table exists, ensure providers are initialized
    const providers = ['groq', 'openai', 'sam_gov', 'usaspending', 'grants_gov'];

    for (const provider of providers) {
      const { error: insertErr } = await supabase
        .from('api_provider_status')
        .upsert({ provider, status: 'unknown' }, { onConflict: 'provider' });

      if (insertErr) {
        errors.push(`Provider ${provider}: ${insertErr.message}`);
      }
    }

    results.push('api_provider_status: exists and providers initialized');
  }

  console.log('\n=== Results ===');
  results.forEach(r => console.log(`✓ ${r}`));

  if (errors.length > 0) {
    console.log('\n=== Errors ===');
    errors.forEach(e => console.log(`✗ ${e}`));
  }

  const needsManual = results.some(r => r.includes('needs manual creation'));

  if (needsManual) {
    console.log('\n=== Action Required ===');
    console.log('One or more tables need to be created manually.');
    console.log('\n1. Open Supabase SQL Editor:');
    console.log('   https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new');
    console.log('\n2. Copy the contents of:');
    console.log('   supabase/migrations/20260419_tool_errors.sql');
    console.log('\n3. Paste and run the SQL');
    console.log('\n4. Run this script again to verify');
  } else {
    console.log('\n✅ All tables exist! Migration complete.');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
