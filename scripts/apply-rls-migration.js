#!/usr/bin/env node

/**
 * Apply RLS Migration to Supabase
 *
 * Usage:
 *   node scripts/apply-rls-migration.js [--dry-run]
 *
 * Options:
 *   --dry-run   Show what would be done without executing
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { getDatabaseUrl } = require('./lib/db-url');

// Supabase connection string (pooler) — read from env, never hardcoded.
const DATABASE_URL = getDatabaseUrl();

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

async function main() {
  console.log('======================================');
  console.log('RLS Migration Script');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('======================================\n');

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // First, check which tables don't have RLS enabled
    console.log('Checking tables without RLS...\n');
    const { rows: tablesWithoutRLS } = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false
      ORDER BY tablename
    `);

    console.log(`Found ${tablesWithoutRLS.length} tables without RLS:\n`);
    tablesWithoutRLS.forEach((t, i) => console.log(`  ${i + 1}. ${t.tablename}`));

    if (dryRun) {
      console.log('\nDry run complete. Run without --dry-run to apply changes.');
      return;
    }

    // Apply RLS to each table
    console.log('\n======================================');
    console.log('Enabling RLS on tables...');
    console.log('======================================\n');

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const { tablename } of tablesWithoutRLS) {
      try {
        // Enable RLS
        await pool.query(`ALTER TABLE "${tablename}" ENABLE ROW LEVEL SECURITY`);

        // Check if policy already exists
        const { rows: existingPolicies } = await pool.query(`
          SELECT policyname FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'Service role has full access'
        `, [tablename]);

        if (existingPolicies.length === 0) {
          // Create the default policy
          await pool.query(`
            CREATE POLICY "Service role has full access" ON "${tablename}"
            FOR ALL USING (true) WITH CHECK (true)
          `);
        }

        console.log(`✅ ${tablename} - RLS enabled + policy created`);
        successCount++;
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`⏭️  ${tablename} - Policy already exists`);
          skipCount++;
        } else {
          console.log(`❌ ${tablename} - Error: ${err.message}`);
          errorCount++;
        }
      }
    }

    // Drop Security Definer views (they bypass RLS)
    console.log('\n======================================');
    console.log('Checking Security Definer views...');
    console.log('======================================\n');

    const { rows: securityDefinerViews } = await pool.query(`
      SELECT viewname
      FROM pg_views
      WHERE schemaname = 'public'
    `);

    // Note: pg_views doesn't directly show security definer status
    // Views are security definer by default in Postgres
    // The fix is to recreate them with SECURITY INVOKER

    const problemViews = [
      'user_briefing_engagement',
      'recompete_opportunities_v',
      'briefing_delivery_stats',
      'customer_stripe_summary',
      'agency_intelligence_full',
      'briefing_retry_summary',
    ];

    for (const viewName of problemViews) {
      const exists = securityDefinerViews.some(v => v.viewname === viewName);
      if (exists) {
        try {
          await pool.query(`DROP VIEW IF EXISTS "${viewName}" CASCADE`);
          console.log(`🗑️  Dropped view: ${viewName}`);
        } catch (err) {
          console.log(`⚠️  Could not drop ${viewName}: ${err.message}`);
        }
      } else {
        console.log(`⏭️  View not found: ${viewName}`);
      }
    }

    // Final status check
    console.log('\n======================================');
    console.log('Final Status Check');
    console.log('======================================\n');

    const { rows: finalCheck } = await pool.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false
      ORDER BY tablename
    `);

    if (finalCheck.length === 0) {
      console.log('✅ All tables now have RLS enabled!');
    } else {
      console.log(`⚠️  ${finalCheck.length} tables still without RLS:`);
      finalCheck.forEach(t => console.log(`   - ${t.tablename}`));
    }

    console.log('\n======================================');
    console.log('Summary');
    console.log('======================================');
    console.log(`✅ Success: ${successCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
