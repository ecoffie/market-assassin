#!/usr/bin/env node
/**
 * Run Stripe data cache migration directly using pg
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Connection string from Supabase
const connectionString = 'postgresql://postgres:galata-supabase-2026@db.krpyelfrbicmvsmwovti.supabase.co:5432/postgres';

async function runMigration() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    console.log('Connecting to Supabase PostgreSQL...');
    const client = await pool.connect();
    console.log('Connected!\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../supabase/migrations/20260429_stripe_data_cache.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running Stripe data cache migration...\n');

    // Split by semicolons and run each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let successCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      try {
        // Skip empty statements
        if (!statement || statement.length < 5) continue;

        // Get first 50 chars for logging
        const preview = statement.substring(0, 60).replace(/\n/g, ' ') + '...';

        await client.query(statement);
        console.log(`✓ ${preview}`);
        successCount++;
      } catch (err) {
        // Ignore "already exists" errors
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`○ (exists) ${statement.substring(0, 40)}...`);
        } else {
          console.error(`✗ Error: ${err.message}`);
          console.error(`  Statement: ${statement.substring(0, 100)}...`);
          errorCount++;
        }
      }
    }

    console.log(`\n✅ Migration complete! ${successCount} statements succeeded, ${errorCount} errors`);

    // Verify tables exist
    console.log('\n📊 Verifying tables...');
    const tables = ['stripe_customers', 'stripe_charges', 'stripe_subscriptions', 'customer_classifications', 'stripe_webhook_log'];

    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`  ${table}: ${result.rows[0].count} rows`);
    }

    client.release();
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
