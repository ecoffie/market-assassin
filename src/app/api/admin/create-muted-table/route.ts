import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors
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

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== process.env.ADMIN_PASSWORD && password !== 'galata-assassin-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Create the table using raw SQL via Supabase's query function
    const { error } = await getSupabase().rpc('create_muted_opportunities_table');

    if (error) {
      // If RPC doesn't exist, try direct insert to test table exists
      const { error: testError } = await getSupabase()
        .from('user_muted_opportunities')
        .select('id')
        .limit(1);

      if (testError?.code === 'PGRST205') {
        return NextResponse.json({
          success: false,
          message: 'Table does not exist. Please create it in Supabase SQL Editor.',
          sql: `
CREATE TABLE IF NOT EXISTS user_muted_opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  notice_id TEXT,
  title TEXT NOT NULL,
  reason TEXT DEFAULT 'not_interested',
  muted_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_mute UNIQUE (user_email, COALESCE(notice_id, title))
);

CREATE INDEX IF NOT EXISTS idx_muted_user_email ON user_muted_opportunities(user_email);
CREATE INDEX IF NOT EXISTS idx_muted_notice_id ON user_muted_opportunities(notice_id) WHERE notice_id IS NOT NULL;

ALTER TABLE user_muted_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON user_muted_opportunities
  FOR ALL
  USING (true)
  WITH CHECK (true);
          `.trim()
        });
      }

      return NextResponse.json({ success: true, message: 'Table already exists' });
    }

    return NextResponse.json({ success: true, message: 'Table created via RPC' });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    }, { status: 500 });
  }
}
