#!/usr/bin/env node
/**
 * Schema Sync Test
 * Verifies that columns referenced in code actually exist in the database.
 * Run this before every deploy to catch code-database mismatches.
 *
 * Usage: node tests/test-schema-sync.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Define expected columns for critical tables
// Add columns here when you add them to API code
const EXPECTED_SCHEMA = {
  user_notification_settings: [
    'id',
    'user_email',
    'naics_codes',
    'keywords',
    'agencies',
    'business_type',
    'location_state',
    'location_states',        // Added April 2026
    'naics_profile_hash',     // Added April 2026
    'profile_updated_at',     // Added April 2026
    'primary_industry',       // Added April 2026
    'timezone',
    'alerts_enabled',
    'alert_frequency',
    'briefings_enabled',
    'briefing_frequency',
    'sms_enabled',
    'phone_number',
    'is_active',
    'created_at',
    'updated_at',
  ],
  briefing_templates: [
    'id',
    'naics_profile',
    'naics_profile_hash',
    'template_date',
    'briefing_type',
    'briefing_content',
  ],
  alert_log: [
    'id',
    'user_email',
    'alert_date',
    'opportunities_count',
    'sent_at',
    'delivery_status',
  ],
};

async function checkTable(tableName, expectedColumns) {
  // Try to select all expected columns
  const selectStr = expectedColumns.join(', ');

  const { data, error } = await supabase
    .from(tableName)
    .select(selectStr)
    .limit(1);

  if (error) {
    // Parse error to find missing column
    const match = error.message.match(/column (\w+)\.(\w+) does not exist/);
    if (match) {
      return { success: false, missingColumn: match[2], error: error.message };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

async function runTests() {
  console.log('\n🔍 SCHEMA SYNC TEST\n');
  console.log('Checking that database columns match code expectations...\n');

  let allPassed = true;

  for (const [table, columns] of Object.entries(EXPECTED_SCHEMA)) {
    const result = await checkTable(table, columns);

    if (result.success) {
      console.log(`✅ ${table}: All ${columns.length} columns exist`);
    } else {
      allPassed = false;
      if (result.missingColumn) {
        console.log(`❌ ${table}: Missing column "${result.missingColumn}"`);
        console.log(`   Run migration to add this column before deploying!`);
      } else {
        console.log(`❌ ${table}: ${result.error}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(50));

  if (allPassed) {
    console.log('✅ All schema checks passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Schema mismatch detected! Fix before deploying.\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
