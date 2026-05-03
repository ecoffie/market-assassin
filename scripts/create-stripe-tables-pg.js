#!/usr/bin/env node
/**
 * Create Stripe data cache tables using direct PostgreSQL connection
 */

const { Pool } = require('pg');

// Supabase session pooler connection (Session mode, port 5432)
// Format: postgres://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
const connectionString = process.env.DATABASE_URL ||
  'postgresql://postgres.krpyelfrbicmvsmwovti:galata-supabase-2026@aws-0-us-east-1.pooler.supabase.com:5432/postgres';

const SQL_STATEMENTS = [
  // 1. Stripe Customers
  `CREATE TABLE IF NOT EXISTS stripe_customers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    livemode BOOLEAN DEFAULT true,
    deleted BOOLEAN DEFAULT false
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_customers_email ON stripe_customers(email)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_customers_email_lower ON stripe_customers(LOWER(email))`,

  // 2. Stripe Charges
  `CREATE TABLE IF NOT EXISTS stripe_charges (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL,
    description TEXT,
    receipt_email TEXT,
    invoice_id TEXT,
    payment_intent_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    livemode BOOLEAN DEFAULT true,
    refunded BOOLEAN DEFAULT false,
    amount_refunded INTEGER DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_charges_customer ON stripe_charges(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_charges_created ON stripe_charges(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_charges_amount ON stripe_charges(amount)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_charges_status ON stripe_charges(status)`,

  // 3. Stripe Subscriptions
  `CREATE TABLE IF NOT EXISTS stripe_subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    status TEXT NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT false,
    canceled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    livemode BOOLEAN DEFAULT true,
    plan_id TEXT,
    plan_amount INTEGER,
    plan_interval TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer ON stripe_subscriptions(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status ON stripe_subscriptions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_created ON stripe_subscriptions(created_at DESC)`,

  // 4. Customer Classifications
  `CREATE TABLE IF NOT EXISTS customer_classifications (
    email TEXT PRIMARY KEY,
    customer_id TEXT,
    classification TEXT NOT NULL,
    briefings_access TEXT,
    briefings_expiry TIMESTAMPTZ,
    bundle_tier TEXT,
    total_spend INTEGER DEFAULT 0,
    charge_count INTEGER DEFAULT 0,
    first_charge_at TIMESTAMPTZ,
    last_charge_at TIMESTAMPTZ,
    has_active_subscription BOOLEAN DEFAULT false,
    subscription_type TEXT,
    products_purchased TEXT[] DEFAULT '{}',
    classified_at TIMESTAMPTZ DEFAULT now(),
    classification_version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_customer_classifications_classification ON customer_classifications(classification)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_classifications_briefings_access ON customer_classifications(briefings_access)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_classifications_customer ON customer_classifications(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_classifications_bundle ON customer_classifications(bundle_tier)`,

  // 5. Stripe Webhook Log
  `CREATE TABLE IF NOT EXISTS stripe_webhook_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    object_id TEXT,
    object_type TEXT,
    livemode BOOLEAN DEFAULT true,
    processed BOOLEAN DEFAULT false,
    error_message TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_webhook_log_event_type ON stripe_webhook_log(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_stripe_webhook_log_created ON stripe_webhook_log(created_at DESC)`,
];

async function main() {
  console.log('🚀 Creating Stripe data cache tables via PostgreSQL...\n');

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connected to Supabase PostgreSQL\n');

    let success = 0;
    let skipped = 0;
    let errors = 0;

    for (const sql of SQL_STATEMENTS) {
      const preview = sql.substring(0, 60).replace(/\n/g, ' ').trim() + '...';
      try {
        await client.query(sql);
        if (sql.includes('CREATE TABLE')) {
          console.log(`✅ ${preview}`);
          success++;
        } else if (sql.includes('CREATE INDEX')) {
          console.log(`  📇 ${preview}`);
          success++;
        }
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`⏭️  (exists) ${preview}`);
          skipped++;
        } else {
          console.log(`❌ Error: ${err.message}`);
          console.log(`   SQL: ${sql.substring(0, 100)}...`);
          errors++;
        }
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Results: ${success} created, ${skipped} skipped, ${errors} errors`);
    console.log('='.repeat(50));

    // Verify tables
    console.log('\n📋 Verifying tables...');
    const tables = ['stripe_customers', 'stripe_charges', 'stripe_subscriptions', 'customer_classifications', 'stripe_webhook_log'];

    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`  ✅ ${table}: ${result.rows[0].count} rows`);
      } catch (err) {
        console.log(`  ❌ ${table}: ${err.message}`);
      }
    }

  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('\nTrying alternate connection string formats...');
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main();
