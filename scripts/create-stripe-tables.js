#!/usr/bin/env node
/**
 * Create Stripe data cache tables using Supabase service role
 * Uses fetch to call Supabase SQL executor
 */

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

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

async function executeSQL(sql) {
  // Use Supabase's RPC endpoint to execute raw SQL
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQL error: ${text}`);
  }
  return response.json();
}

async function checkTableExists(tableName) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=1`, {
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });

  // Table exists if we get 200, doesn't exist if we get 404 or specific error
  if (response.ok) return true;
  const text = await response.text();
  return !text.includes('does not exist') && !text.includes('Could not find');
}

async function main() {
  console.log('🚀 Checking Stripe data cache tables...\n');

  const tables = ['stripe_customers', 'stripe_charges', 'stripe_subscriptions', 'customer_classifications', 'stripe_webhook_log'];

  for (const table of tables) {
    const exists = await checkTableExists(table);
    console.log(`  ${exists ? '✅' : '❌'} ${table}: ${exists ? 'exists' : 'missing'}`);
  }

  console.log('\n📝 Since Supabase REST API cannot execute DDL directly,');
  console.log('   please run the following SQL in Supabase Dashboard:\n');
  console.log('   https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new\n');
  console.log('=' .repeat(70));
  console.log(SQL_STATEMENTS.join(';\n\n') + ';');
  console.log('=' .repeat(70));
}

main().catch(console.error);
