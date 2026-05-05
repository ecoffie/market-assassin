#!/usr/bin/env node
/**
 * Batch Enroll Bootcamp Attendees into Daily Alerts
 *
 * Usage:
 *   node scripts/batch-enroll-alerts.js --dry-run     # Preview only
 *   node scripts/batch-enroll-alerts.js               # Execute enrollment
 *
 * Enrolls users from data/bootcamp-attendees-to-enroll.txt into MI Free tier
 * with default NAICS codes for daily alerts.
 *
 * Uses UPSERT with on_conflict to skip existing users.
 */

const fs = require('fs');
const path = require('path');

// Supabase config
const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

// Default NAICS for bootcamp attendees (general GovCon)
const DEFAULT_NAICS = ['541512', '541611', '541330', '541990', '561210'];

// Batch size for inserts
const BATCH_SIZE = 100;

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('Batch Enroll Bootcamp Attendees into Daily Alerts');
  console.log('='.repeat(60));
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log('');

  // Read email list
  const dataPath = path.join(__dirname, '../data/bootcamp-attendees-to-enroll.txt');
  if (!fs.existsSync(dataPath)) {
    console.error(`File not found: ${dataPath}`);
    process.exit(1);
  }

  const emails = fs.readFileSync(dataPath, 'utf8')
    .split('\n')
    .map(e => e.trim().toLowerCase())
    .filter(e => e && e.includes('@'));

  console.log(`Total emails to process: ${emails.length}`);
  console.log('Using UPSERT - existing users will be skipped automatically');
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN - No changes made');
    console.log('Sample of first 10 emails:');
    emails.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    return;
  }

  // Batch upsert - skips existing users via on_conflict
  let processed = 0;
  let failed = 0;
  const batches = Math.ceil(emails.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = emails.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const records = batch.map(email => ({
      user_email: email,
      naics_codes: DEFAULT_NAICS,
      alerts_enabled: true,
      briefings_enabled: false, // MI Free tier - no briefings
      treatment_type: 'alerts',
      is_active: true,
      invitation_source: 'bootcamp-batch-enroll',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    try {
      // Use UPSERT with on_conflict=user_email and ignoreDuplicates
      // This skips any rows where user_email already exists
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_notification_settings?on_conflict=user_email`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(records),
        }
      );

      if (res.ok) {
        processed += batch.length;
        process.stdout.write(`\rProgress: ${processed}/${emails.length} (${Math.round(processed/emails.length*100)}%)`);
      } else {
        const err = await res.text();
        console.error(`\nBatch ${i+1} failed: ${err}`);
        failed += batch.length;
      }
    } catch (err) {
      console.error(`\nBatch ${i+1} error: ${err.message}`);
      failed += batch.length;
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Total processed: ${emails.length}`);
  console.log(`Failed batches: ${failed}`);
  console.log('');
  console.log('Note: Existing users were automatically skipped (upsert).');
  console.log('New users will start receiving daily alerts at 7 AM.');
}

main().catch(console.error);
