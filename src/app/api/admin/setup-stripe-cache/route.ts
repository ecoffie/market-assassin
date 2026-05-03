import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const results: { step: string; status: string; error?: string }[] = [];

  // Step 1: Create stripe_customers table
  const { error: customersError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS stripe_customers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        phone TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now(),
        livemode BOOLEAN DEFAULT true,
        deleted BOOLEAN DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_customers_email ON stripe_customers(email);
      CREATE INDEX IF NOT EXISTS idx_stripe_customers_email_lower ON stripe_customers(LOWER(email));
    `
  });

  // If RPC doesn't exist, try direct table creation via raw SQL alternative
  // We'll handle this by creating tables through INSERT tests and ALTER TABLE

  // Let's try a different approach - create tables by testing inserts and catching errors

  // Test if tables exist, if not create them one by one
  const tables = [
    {
      name: 'stripe_customers',
      columns: {
        id: 'cus_test',
        email: 'test@test.com',
        name: 'Test',
        metadata: {},
        created_at: new Date().toISOString(),
        livemode: true
      }
    },
    {
      name: 'stripe_charges',
      columns: {
        id: 'ch_test',
        customer_id: null,
        amount: 0,
        currency: 'usd',
        status: 'test',
        description: 'test',
        created_at: new Date().toISOString(),
        livemode: true
      }
    },
    {
      name: 'stripe_subscriptions',
      columns: {
        id: 'sub_test',
        customer_id: null,
        status: 'test',
        created_at: new Date().toISOString(),
        livemode: true
      }
    },
    {
      name: 'customer_classifications',
      columns: {
        email: 'test@test.com',
        classification: 'test'
      }
    },
    {
      name: 'stripe_webhook_log',
      columns: {
        event_id: 'evt_test',
        event_type: 'test',
        livemode: true
      }
    }
  ];

  // Check each table
  for (const table of tables) {
    const { error: checkError } = await supabase
      .from(table.name)
      .select('*')
      .limit(1);

    if (checkError?.message?.includes('does not exist') || checkError?.code === 'PGRST205') {
      results.push({
        step: `Check ${table.name}`,
        status: 'missing',
        error: 'Table needs to be created via Supabase Dashboard SQL Editor'
      });
    } else {
      results.push({
        step: `Check ${table.name}`,
        status: 'exists'
      });
    }
  }

  // Check if any tables are missing
  const missingTables = results.filter(r => r.status === 'missing');

  return NextResponse.json({
    success: missingTables.length === 0,
    message: missingTables.length > 0
      ? 'Some tables are missing. Please run the migration in Supabase Dashboard SQL Editor.'
      : 'All tables exist and are ready.',
    results,
    migrationFile: 'supabase/migrations/20260429_stripe_data_cache.sql',
    instructions: missingTables.length > 0 ? [
      '1. Go to Supabase Dashboard: https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti',
      '2. Click on "SQL Editor" in the left sidebar',
      '3. Paste the contents of supabase/migrations/20260429_stripe_data_cache.sql',
      '4. Click "Run" to execute the migration',
      '5. Run this endpoint again to verify tables were created'
    ] : []
  });
}
