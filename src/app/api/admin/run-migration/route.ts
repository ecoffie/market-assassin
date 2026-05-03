import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * POST /api/admin/run-migration?password=xxx
 * Run a specific migration to add missing columns
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const migration = body.migration || 'add-notification-columns';

  const migrations: Record<string, string[]> = {
    'add-notification-columns': [
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS location_states TEXT[] DEFAULT '{}'`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS naics_profile_hash TEXT`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ`,
      `ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS primary_industry TEXT`,
    ],
    'stripe-cache': [
      // 1. Stripe Customers Table
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
      // 2. Stripe Charges Table
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
      // 3. Stripe Subscriptions Table
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
      // 4. Customer Classifications Table
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
    ],
  };

  const statements = migrations[migration];
  if (!statements) {
    return NextResponse.json({
      error: `Unknown migration: ${migration}`,
      available: Object.keys(migrations)
    }, { status: 400 });
  }

  const results: { sql: string; success: boolean; error?: string }[] = [];

  for (const sql of statements) {
    try {
      // Use raw SQL via pg (Supabase REST API doesn't support ALTER TABLE)
      // For now, just try to read/write to test the columns
      results.push({ sql, success: true, error: 'DDL must be run directly in Supabase Dashboard' });
    } catch (error) {
      results.push({ sql, success: false, error: String(error) });
    }
  }

  // Return the SQL to run manually
  return NextResponse.json({
    success: true,
    message: 'Copy this SQL to Supabase Dashboard SQL Editor and run it',
    sql: statements.join(';\n') + ';',
    migration,
  });
}

/**
 * GET /api/admin/run-migration?password=xxx
 * Check if columns exist
 */
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, location_states, naics_profile_hash, profile_updated_at, primary_industry')
      .limit(1);

    if (error) {
      return NextResponse.json({
        success: false,
        columnsExist: false,
        error: error.message,
        sqlToRun: `
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS location_states TEXT[] DEFAULT '{}';
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS naics_profile_hash TEXT;
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;
ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS primary_industry TEXT;
CREATE INDEX IF NOT EXISTS idx_notif_settings_naics_hash ON user_notification_settings(naics_profile_hash);
        `.trim()
      });
    }

    return NextResponse.json({
      success: true,
      columnsExist: true,
      sampleData: data,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
