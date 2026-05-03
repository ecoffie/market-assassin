import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const statements = [
  `CREATE TABLE IF NOT EXISTS email_provider_sends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'resend',
    provider_message_id TEXT,
    user_email TEXT,
    subject TEXT,
    email_type TEXT,
    event_source TEXT,
    tags JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'sent',
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_sends_provider_message
    ON email_provider_sends(provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_sends_email
    ON email_provider_sends(user_email, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_sends_type
    ON email_provider_sends(email_type, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_sends_tags
    ON email_provider_sends USING GIN(tags)`,
  `CREATE TABLE IF NOT EXISTS email_provider_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'resend',
    provider_event_id TEXT,
    provider_message_id TEXT,
    event_type TEXT NOT NULL,
    user_email TEXT,
    email_type TEXT,
    event_source TEXT,
    tags JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    raw_payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_events_provider_event
    ON email_provider_events(provider, provider_event_id)
    WHERE provider_event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_events_message
    ON email_provider_events(provider_message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_events_email
    ON email_provider_events(user_email, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_events_type
    ON email_provider_events(event_type, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_email_provider_events_tags
    ON email_provider_events USING GIN(tags)`,
];

async function executeSql(supabase: ReturnType<typeof getSupabase>, sql: string) {
  const execSql = await supabase.rpc('exec_sql', { sql });
  if (!execSql.error) {
    return execSql;
  }

  const exec = await supabase.rpc('exec', { query: sql });
  if (!exec.error) {
    return exec;
  }

  return { error: execSql.error || exec.error };
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const results: Array<{ statement: number; success: boolean; error?: string }> = [];

  for (const [index, sql] of statements.entries()) {
    const { error } = await executeSql(supabase, sql);
    results.push({
      statement: index + 1,
      success: !error,
      error: error?.message,
    });

    if (error) {
      return NextResponse.json({
        success: false,
        message: 'Failed to apply Resend events migration. Run the SQL file manually if exec_sql is unavailable.',
        failedStatement: index + 1,
        error: error.message,
        results,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, results });
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [sends, events] = await Promise.all([
    getSupabase().from('email_provider_sends').select('id', { count: 'exact', head: true }),
    getSupabase().from('email_provider_events').select('id', { count: 'exact', head: true }),
  ]);

  return NextResponse.json({
    success: !sends.error && !events.error,
    sends: { exists: !sends.error, count: sends.count || 0, error: sends.error?.message },
    events: { exists: !events.error, count: events.count || 0, error: events.error?.message },
  });
}
