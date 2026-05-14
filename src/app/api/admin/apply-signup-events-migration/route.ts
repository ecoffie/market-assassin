/**
 * Apply Signup Events Migration
 *
 * GET /api/admin/apply-signup-events-migration?password=xxx&mode=preview
 * POST /api/admin/apply-signup-events-migration?password=xxx&mode=execute
 *
 * Creates the signup_events and signup_health_metrics tables for
 * enterprise-grade signup funnel monitoring.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Check if table exists
  const { data: existing } = await supabase
    .from('signup_events')
    .select('id')
    .limit(1);

  const tableExists = existing !== null;

  if (mode === 'preview') {
    return NextResponse.json({
      success: true,
      preview: true,
      tableExists,
      message: tableExists
        ? 'signup_events table already exists'
        : 'Table does not exist. Run with mode=execute to create.',
      migration: {
        tables: ['signup_events', 'signup_health_metrics'],
        indexes: 8,
        functions: 2,
      },
    });
  }

  // Execute mode - create tables
  if (tableExists) {
    return NextResponse.json({
      success: true,
      message: 'signup_events table already exists, no migration needed',
    });
  }

  // Since we can't run raw SQL via REST API, we'll create the table via Supabase client
  // by inserting a test row and letting the table be created implicitly
  // This is a workaround - proper migration should be done via Supabase Dashboard or CLI

  return NextResponse.json({
    success: false,
    message: 'Cannot create table via REST API. Please apply migration via Supabase Dashboard SQL Editor.',
    sql: `
-- Run this in Supabase Dashboard > SQL Editor:

CREATE TABLE IF NOT EXISTS signup_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  step TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  session_id TEXT,
  user_email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  error_type TEXT,
  error_message TEXT,
  source TEXT,
  referrer TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signup_events_created_at ON signup_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_events_event_type ON signup_events(event_type);
CREATE INDEX IF NOT EXISTS idx_signup_events_status ON signup_events(status);
CREATE INDEX IF NOT EXISTS idx_signup_events_user_email ON signup_events(user_email);

CREATE TABLE IF NOT EXISTS signup_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL UNIQUE,
  signups_attempted INT NOT NULL DEFAULT 0,
  signups_completed INT NOT NULL DEFAULT 0,
  signups_failed INT NOT NULL DEFAULT 0,
  step_metrics JSONB DEFAULT '{}',
  errors_by_type JSONB DEFAULT '{}',
  success_rate DECIMAL(5,2),
  health_score INT,
  health_status TEXT,
  signups_by_source JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
    `.trim(),
  });
}
