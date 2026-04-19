import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * POST /api/admin/apply-tool-errors-migration
 *
 * Applies the tool_errors migration to create monitoring tables.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const results: string[] = [];
  const errors: string[] = [];

  // Create tool_errors table
  const { error: e1 } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS tool_errors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tool_name TEXT NOT NULL,
        error_type TEXT NOT NULL,
        user_email TEXT,
        request_path TEXT,
        request_params JSONB,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        ai_provider TEXT,
        ai_model TEXT,
        tokens_used INTEGER,
        is_resolved BOOLEAN DEFAULT false,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        resolution_notes TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  });

  if (e1) {
    // Try direct insert
    const { error: directError } = await supabase.from('tool_errors').select('id').limit(1);
    if (directError && directError.message.includes('does not exist')) {
      errors.push(`tool_errors table: ${e1.message}`);
    } else {
      results.push('tool_errors table already exists');
    }
  } else {
    results.push('tool_errors table created');
  }

  // Create tool_health_metrics table
  const { error: e2 } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS tool_health_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        tool_name TEXT NOT NULL,
        requests_total INTEGER DEFAULT 0,
        requests_success INTEGER DEFAULT 0,
        requests_failed INTEGER DEFAULT 0,
        ai_calls INTEGER DEFAULT 0,
        ai_errors INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        avg_latency_ms INTEGER,
        errors_ai_timeout INTEGER DEFAULT 0,
        errors_ai_rate_limit INTEGER DEFAULT 0,
        errors_ai_token_limit INTEGER DEFAULT 0,
        errors_api INTEGER DEFAULT 0,
        errors_validation INTEGER DEFAULT 0,
        errors_internal INTEGER DEFAULT 0,
        unique_users_affected INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  });

  if (e2) {
    const { error: directError } = await supabase.from('tool_health_metrics').select('id').limit(1);
    if (directError && directError.message.includes('does not exist')) {
      errors.push(`tool_health_metrics table: ${e2.message}`);
    } else {
      results.push('tool_health_metrics table already exists');
    }
  } else {
    results.push('tool_health_metrics table created');
  }

  // Create api_provider_status table
  const { error: e3 } = await supabase.rpc('exec', {
    query: `
      CREATE TABLE IF NOT EXISTS api_provider_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider TEXT NOT NULL,
        status TEXT DEFAULT 'unknown',
        last_check_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        last_error_at TIMESTAMPTZ,
        last_error_message TEXT,
        avg_latency_ms INTEGER,
        success_rate_24h NUMERIC(5,2),
        rate_limit_remaining INTEGER,
        rate_limit_reset_at TIMESTAMPTZ,
        tokens_remaining INTEGER,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  });

  if (e3) {
    const { error: directError } = await supabase.from('api_provider_status').select('id').limit(1);
    if (directError && directError.message.includes('does not exist')) {
      errors.push(`api_provider_status table: ${e3.message}`);
    } else {
      results.push('api_provider_status table already exists');
    }
  } else {
    results.push('api_provider_status table created');
  }

  // Insert default provider statuses
  const providers = ['groq', 'openai', 'sam_gov', 'usaspending', 'grants_gov'];
  for (const provider of providers) {
    const { error: insertError } = await supabase
      .from('api_provider_status')
      .upsert({ provider, status: 'unknown' }, { onConflict: 'provider' });

    if (insertError) {
      errors.push(`Provider ${provider}: ${insertError.message}`);
    }
  }
  results.push('Provider status records initialized');

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
