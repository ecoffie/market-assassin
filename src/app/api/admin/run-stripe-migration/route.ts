import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/admin/run-stripe-migration?password=xxx
 * Creates Stripe data cache tables in Supabase
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const results: { table: string; status: string; error?: string }[] = [];

  // Define all tables with their CREATE statements (using individual statements)
  const tables = [
    {
      name: 'stripe_customers',
      check: 'stripe_customers',
      sql: `
        CREATE TABLE IF NOT EXISTS stripe_customers (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          phone TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now(),
          livemode BOOLEAN DEFAULT true,
          deleted BOOLEAN DEFAULT false
        )
      `
    },
    {
      name: 'stripe_charges',
      check: 'stripe_charges',
      sql: `
        CREATE TABLE IF NOT EXISTS stripe_charges (
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
        )
      `
    },
    {
      name: 'stripe_subscriptions',
      check: 'stripe_subscriptions',
      sql: `
        CREATE TABLE IF NOT EXISTS stripe_subscriptions (
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
        )
      `
    },
    {
      name: 'customer_classifications',
      check: 'customer_classifications',
      sql: `
        CREATE TABLE IF NOT EXISTS customer_classifications (
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
        )
      `
    },
    {
      name: 'stripe_webhook_log',
      check: 'stripe_webhook_log',
      sql: `
        CREATE TABLE IF NOT EXISTS stripe_webhook_log (
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
        )
      `
    }
  ];

  // Check each table first - if we can query it, it exists
  for (const table of tables) {
    const { error: checkError } = await supabase
      .from(table.check)
      .select('*')
      .limit(1);

    // "Could not find the table" or "relation does not exist" = table is missing
    const isMissing = checkError?.message?.includes('does not exist') ||
                      checkError?.message?.includes('Could not find the table') ||
                      checkError?.code === 'PGRST204';

    if (isMissing) {
      results.push({
        table: table.name,
        status: 'missing',
        error: 'Table needs to be created - see SQL below'
      });
    } else if (checkError) {
      results.push({
        table: table.name,
        status: 'error',
        error: checkError.message
      });
    } else {
      results.push({
        table: table.name,
        status: 'exists'
      });
    }
  }

  const missingTables = results.filter(r => r.status === 'missing');

  // Generate SQL for missing tables
  const sqlToRun = missingTables.length > 0
    ? tables
        .filter(t => missingTables.some(m => m.table === t.name))
        .map(t => t.sql.trim())
        .join(';\n\n') + ';'
    : null;

  return NextResponse.json({
    success: missingTables.length === 0,
    results,
    missingCount: missingTables.length,
    sqlToRun,
    instructions: missingTables.length > 0 ? [
      '1. Go to Supabase Dashboard SQL Editor:',
      '   https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new',
      '2. Copy the SQL below and paste it in the editor',
      '3. Click "Run" to execute',
      '4. Call this endpoint again to verify'
    ] : [
      'All tables exist! Next steps:',
      '1. Configure Stripe webhook: https://dashboard.stripe.com/webhooks',
      '2. Webhook URL: https://tools.govcongiants.org/api/webhooks/stripe',
      '3. Events: customer.*, charge.succeeded, charge.refunded, customer.subscription.*',
      '4. Run backfill: POST /api/admin/backfill-stripe?password=xxx'
    ]
  });
}

/**
 * GET /api/admin/run-stripe-migration?password=xxx
 * Check table status
 */
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const tables = ['stripe_customers', 'stripe_charges', 'stripe_subscriptions', 'customer_classifications', 'stripe_webhook_log'];
  const status: Record<string, { exists: boolean; rowCount?: number; error?: string }> = {};

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error?.message?.includes('does not exist')) {
      status[table] = { exists: false };
    } else if (error) {
      status[table] = { exists: false, error: error.message };
    } else {
      // Get count
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      status[table] = { exists: true, rowCount: count || 0 };
    }
  }

  const allExist = Object.values(status).every(s => s.exists);

  return NextResponse.json({
    success: allExist,
    tables: status,
    message: allExist
      ? 'All Stripe cache tables exist and are ready'
      : 'Some tables are missing - POST to this endpoint for SQL'
  });
}
